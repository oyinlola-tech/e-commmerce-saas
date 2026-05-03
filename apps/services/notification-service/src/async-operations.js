const amqp = require('amqplib');
const Redis = require('ioredis');
const {
  EVENT_QUEUE_CATALOG,
  PLATFORM_ROLES
} = require('../../../../packages/shared/src/constants');
const { createHttpError } = require('../../../../packages/shared/src/errors');
const { sanitizePlainText } = require('../../../../packages/shared/src/sanitization');

const DEFAULT_FAILURE_LIMIT = 25;
const MAX_FAILURE_LIMIT = 50;
const MAX_RABBITMQ_REPLAY_SCAN = Math.max(
  25,
  Number(process.env.ASYNC_OPS_RABBITMQ_REPLAY_MAX_MESSAGES || 250)
);

const getEventBusOpsConfig = () => ({
  redisNamespace: String(process.env.EVENT_BUS_REDIS_NAMESPACE || 'aisle:event-bus').trim() || 'aisle:event-bus'
});

const normalizeAsyncFailureLimit = (value, fallback = DEFAULT_FAILURE_LIMIT) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.min(MAX_FAILURE_LIMIT, Math.max(1, Math.floor(parsed)));
};

const buildRabbitDeadLetterQueue = (queueName) => `${queueName}.dead-letter`;

const buildRedisQueueKeys = (namespace, queueName) => ({
  deadLetter: `${namespace}:queue:${queueName}:dead-letter`,
  payloads: `${namespace}:queue:${queueName}:payloads`,
  ready: `${namespace}:queue:${queueName}:ready`,
  processing: `${namespace}:queue:${queueName}:processing`,
  inflight: `${namespace}:queue:${queueName}:inflight`,
  delayed: `${namespace}:queue:${queueName}:delayed`
});

const normalizeRole = (value = '') => String(value || '').trim().toLowerCase();

const isPlatformOperationsUser = (authContext = {}) => {
  if (String(authContext.actorType || '').trim() !== 'platform_user') {
    return false;
  }

  const role = normalizeRole(authContext.actorRole);
  return role === PLATFORM_ROLES.PLATFORM_OWNER || role === PLATFORM_ROLES.SUPPORT_AGENT;
};

const safeParseJson = (value, fallback = {}) => {
  if (!value) {
    return fallback;
  }

  if (typeof value === 'object') {
    return value;
  }

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch {
    return fallback;
  }
};

const sanitizeMessage = (value, fallback = '') => {
  return sanitizePlainText(value || fallback, { maxLength: 500 }) || fallback;
};

const queueCatalogMap = new Map(EVENT_QUEUE_CATALOG.map((entry) => [entry.queueName, entry]));

const getQueueCatalogEntry = (queueName) => {
  const catalogEntry = queueCatalogMap.get(String(queueName || '').trim());
  if (catalogEntry) {
    return catalogEntry;
  }

  return {
    queueName,
    service: String(queueName || '').split('.')[0] || 'unknown-service',
    label: String(queueName || '').trim() || 'Unknown queue'
  };
};

const buildEventContextItems = (payload = {}) => {
  const data = payload && typeof payload.data === 'object' && payload.data
    ? payload.data
    : {};
  const labels = [
    ['store_id', 'Store'],
    ['order_id', 'Order'],
    ['payment_id', 'Payment'],
    ['customer_id', 'Customer'],
    ['owner_id', 'Owner'],
    ['subscription_id', 'Subscription'],
    ['invoice_id', 'Invoice'],
    ['entity_type', 'Entity'],
    ['reference', 'Reference'],
    ['status', 'Status']
  ];

  return labels
    .map(([key, label]) => {
      const rawValue = data[key];
      if (rawValue === undefined || rawValue === null || rawValue === '') {
        return '';
      }

      return `${label}: ${sanitizePlainText(String(rawValue), { maxLength: 120 })}`;
    })
    .filter(Boolean)
    .slice(0, 6);
};

const buildEventFailureItem = ({
  transport,
  queueName,
  payload,
  properties = {},
  fields = {}
}) => {
  const queueInfo = getQueueCatalogEntry(queueName);
  const headers = properties.headers || {};
  const eventName = sanitizePlainText(
    payload.event || fields.routingKey || headers['x-routing-key'] || 'unknown',
    { maxLength: 120 }
  ) || 'unknown';

  return {
    transport,
    queue_name: queueName,
    queue_label: queueInfo.label,
    service: queueInfo.service,
    message_id: String(payload.id || properties.messageId || '').trim(),
    event: eventName,
    retry_count: Number(payload.retry_count || headers['x-retry-count'] || 0),
    last_error: sanitizeMessage(
      payload.last_error
        || headers['x-final-failure']
        || 'Dead-lettered after retry exhaustion.',
      'Dead-lettered after retry exhaustion.'
    ),
    last_error_at: payload.last_error_at || null,
    timestamp: payload.timestamp || null,
    context_items: buildEventContextItems(payload)
  };
};

const compareByNewestFailure = (left, right) => {
  const leftTime = new Date(left?.last_error_at || left?.timestamp || 0).getTime();
  const rightTime = new Date(right?.last_error_at || right?.timestamp || 0).getTime();
  return rightTime - leftTime;
};

const withRabbitMqConnection = async (config, callback) => {
  const connection = await amqp.connect(config.rabbitmqUrl);
  try {
    return await callback(connection);
  } finally {
    await connection.close().catch(() => undefined);
  }
};

const peekRabbitQueueItems = async (channel, queueName, limit) => {
  const items = [];

  for (let index = 0; index < limit; index += 1) {
    const message = await channel.get(queueName, { noAck: false });
    if (!message) {
      break;
    }

    let payload = null;
    try {
      payload = JSON.parse(message.content.toString());
    } catch {
      payload = {
        id: '',
        event: message.fields.routingKey || 'unknown',
        timestamp: null,
        retry_count: 0,
        last_error: 'Unable to parse dead-letter payload.',
        last_error_at: null,
        data: {}
      };
    }

    items.push(buildEventFailureItem({
      transport: 'rabbitmq',
      queueName,
      payload,
      properties: message.properties,
      fields: message.fields
    }));
  }

  return items;
};

const listRabbitMqEventFailures = async (config, limit) => {
  return withRabbitMqConnection(config, async (connection) => {
    const channel = await connection.createChannel();

    try {
      const queues = [];
      const items = [];
      for (const entry of EVENT_QUEUE_CATALOG) {
        const deadLetterQueue = buildRabbitDeadLetterQueue(entry.queueName);
        let messageCount = 0;

        try {
          const queueInfo = await channel.checkQueue(deadLetterQueue);
          messageCount = Number(queueInfo.messageCount || 0);
        } catch {
          messageCount = 0;
        }

        queues.push({
          queue_name: entry.queueName,
          queue_label: entry.label,
          service: entry.service,
          rabbitmq_dead_letter_count: messageCount,
          redis_dead_letter_count: 0,
          total_dead_letter_count: messageCount
        });

        if (messageCount > 0 && items.length < limit) {
          const nextItems = await peekRabbitQueueItems(channel, deadLetterQueue, limit - items.length);
          items.push(...nextItems);
        }
      }

      return {
        available: true,
        error: null,
        queues,
        items,
        total_count: queues.reduce((sum, entry) => sum + Number(entry.rabbitmq_dead_letter_count || 0), 0)
      };
    } finally {
      await channel.close().catch(() => undefined);
    }
  });
};

const listRedisEventFailures = async (config, limit) => {
  const redis = new Redis(config.redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false
  });
  const eventBusConfig = getEventBusOpsConfig();

  try {
    await redis.connect();
    const queues = [];
    const items = [];

    for (const entry of EVENT_QUEUE_CATALOG) {
      const keys = buildRedisQueueKeys(eventBusConfig.redisNamespace, entry.queueName);
      const deadLetterCount = Number(await redis.llen(keys.deadLetter));
      queues.push({
        queue_name: entry.queueName,
        queue_label: entry.label,
        service: entry.service,
        rabbitmq_dead_letter_count: 0,
        redis_dead_letter_count: deadLetterCount,
        total_dead_letter_count: deadLetterCount
      });

      if (deadLetterCount > 0 && items.length < limit) {
        const messageIds = await redis.lrange(keys.deadLetter, 0, limit - items.length - 1);
        if (!messageIds.length) {
          continue;
        }

        const payloads = await redis.hmget(keys.payloads, ...messageIds);
        payloads.forEach((rawPayload, index) => {
          const payload = safeParseJson(rawPayload, {
            id: messageIds[index],
            event: 'unknown',
            timestamp: null,
            retry_count: 0,
            last_error: 'Missing dead-letter payload.',
            last_error_at: null,
            data: {}
          });
          items.push(buildEventFailureItem({
            transport: 'redis',
            queueName: entry.queueName,
            payload
          }));
        });
      }
    }

    return {
      available: true,
      error: null,
      queues,
      items,
      total_count: queues.reduce((sum, entry) => sum + Number(entry.redis_dead_letter_count || 0), 0)
    };
  } finally {
    if (redis.status !== 'end') {
      redis.disconnect();
    }
  }
};

const listEventFailures = async ({ config, logger, limit }) => {
  const resolvedLimit = normalizeAsyncFailureLimit(limit);
  const rabbitmqResult = {
    available: false,
    error: null,
    queues: [],
    items: [],
    total_count: 0
  };
  const redisResult = {
    available: false,
    error: null,
    queues: [],
    items: [],
    total_count: 0
  };

  try {
    Object.assign(rabbitmqResult, await listRabbitMqEventFailures(config, resolvedLimit));
  } catch (error) {
    rabbitmqResult.error = sanitizeMessage(error?.message, 'RabbitMQ dead-letter queues are unavailable.');
    logger?.warn?.('async_ops_rabbitmq_unavailable', {
      error: error.message
    });
  }

  try {
    Object.assign(redisResult, await listRedisEventFailures(config, resolvedLimit));
  } catch (error) {
    redisResult.error = sanitizeMessage(error?.message, 'Redis fallback dead-letter queues are unavailable.');
    logger?.warn?.('async_ops_redis_unavailable', {
      error: error.message
    });
  }

  const queueMap = new Map();
  [...rabbitmqResult.queues, ...redisResult.queues].forEach((entry) => {
    const existing = queueMap.get(entry.queue_name) || {
      queue_name: entry.queue_name,
      queue_label: entry.queue_label,
      service: entry.service,
      rabbitmq_dead_letter_count: 0,
      redis_dead_letter_count: 0,
      total_dead_letter_count: 0
    };

    existing.rabbitmq_dead_letter_count += Number(entry.rabbitmq_dead_letter_count || 0);
    existing.redis_dead_letter_count += Number(entry.redis_dead_letter_count || 0);
    existing.total_dead_letter_count = existing.rabbitmq_dead_letter_count + existing.redis_dead_letter_count;
    queueMap.set(entry.queue_name, existing);
  });

  return {
    summary: {
      rabbitmq_count: rabbitmqResult.total_count,
      redis_count: redisResult.total_count,
      total_count: rabbitmqResult.total_count + redisResult.total_count
    },
    transports: {
      rabbitmq: {
        available: rabbitmqResult.available,
        error: rabbitmqResult.error
      },
      redis: {
        available: redisResult.available,
        error: redisResult.error
      }
    },
    queues: Array.from(queueMap.values())
      .sort((left, right) => Number(right.total_dead_letter_count || 0) - Number(left.total_dead_letter_count || 0)),
    items: [...rabbitmqResult.items, ...redisResult.items]
      .filter((item) => item.message_id)
      .sort(compareByNewestFailure)
      .slice(0, resolvedLimit)
  };
};

const replayRabbitMqEventFailure = async ({ config, queueName, messageId, actor }) => {
  const queueInfo = getQueueCatalogEntry(queueName);
  const deadLetterQueue = buildRabbitDeadLetterQueue(queueName);

  return withRabbitMqConnection(config, async (connection) => {
    const channel = await connection.createConfirmChannel();
    let matchedMessage = null;
    let matchedPayload = null;
    let routingKey = '';

    try {
      const queueState = await channel.checkQueue(deadLetterQueue);
      const totalMessages = Number(queueState.messageCount || 0);
      if (!totalMessages) {
        throw createHttpError(404, 'That dead-lettered event is no longer present.', null, { expose: true });
      }

      if (totalMessages > MAX_RABBITMQ_REPLAY_SCAN) {
        throw createHttpError(
          409,
          `RabbitMQ dead-letter backlog for ${queueInfo.label} is too large for UI replay. Reduce the backlog below ${MAX_RABBITMQ_REPLAY_SCAN} messages first.`,
          null,
          { expose: true }
        );
      }

      for (let index = 0; index < totalMessages; index += 1) {
        const message = await channel.get(deadLetterQueue, { noAck: false });
        if (!message) {
          break;
        }

        const payload = safeParseJson(message.content.toString(), {
          id: '',
          event: message.fields.routingKey || 'unknown',
          timestamp: null,
          retry_count: 0,
          last_error: 'Unable to parse dead-letter payload.',
          last_error_at: null,
          data: {}
        });

        if (String(payload.id || '').trim() === String(messageId || '').trim()) {
          matchedMessage = message;
          matchedPayload = payload;
          routingKey = message.fields.routingKey || payload.event || 'unknown';
          break;
        }
      }

      if (!matchedMessage || !matchedPayload) {
        throw createHttpError(404, 'That dead-lettered event is no longer present.', null, { expose: true });
      }

      const replayPayload = {
        ...matchedPayload,
        retry_count: 0,
        last_error: null,
        last_error_at: null,
        replayed_at: new Date().toISOString(),
        replayed_by: actor?.userId || null,
        replayed_role: actor?.actorRole || null
      };

      channel.publish(
        config.eventExchange,
        routingKey || matchedPayload.event || 'unknown',
        Buffer.from(JSON.stringify(replayPayload)),
        {
          persistent: true,
          contentType: 'application/json',
          headers: {
            'x-operator-replay': true,
            'x-operator-user-id': actor?.userId || '',
            'x-original-queue': queueName
          }
        }
      );

      await channel.waitForConfirms();
      channel.ack(matchedMessage);

      return {
        transport: 'rabbitmq',
        queue_name: queueName,
        queue_label: queueInfo.label,
        service: queueInfo.service,
        message_id: String(replayPayload.id || ''),
        event: replayPayload.event || routingKey || 'unknown'
      };
    } finally {
      await channel.close().catch(() => undefined);
    }
  });
};

const replayRedisEventFailure = async ({ config, queueName, messageId, actor }) => {
  const redis = new Redis(config.redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false
  });
  const queueInfo = getQueueCatalogEntry(queueName);
  const eventBusConfig = getEventBusOpsConfig();
  const keys = buildRedisQueueKeys(eventBusConfig.redisNamespace, queueName);

  try {
    await redis.connect();
    const removedCount = Number(await redis.lrem(keys.deadLetter, 1, messageId));
    if (!removedCount) {
      throw createHttpError(404, 'That dead-lettered event is no longer present.', null, { expose: true });
    }

    const rawPayload = await redis.hget(keys.payloads, messageId);
    if (!rawPayload) {
      await redis.multi()
        .zrem(keys.inflight, messageId)
        .zrem(keys.delayed, messageId)
        .lrem(keys.processing, 0, messageId)
        .exec();
      throw createHttpError(404, 'That dead-lettered event no longer has a recoverable payload.', null, { expose: true });
    }

    const payload = safeParseJson(rawPayload, {
      id: messageId,
      event: 'unknown',
      timestamp: null,
      retry_count: 0,
      last_error: null,
      last_error_at: null,
      data: {}
    });
    const replayPayload = {
      ...payload,
      retry_count: 0,
      last_error: null,
      last_error_at: null,
      replayed_at: new Date().toISOString(),
      replayed_by: actor?.userId || null,
      replayed_role: actor?.actorRole || null
    };

    await redis.multi()
      .zrem(keys.inflight, messageId)
      .zrem(keys.delayed, messageId)
      .lrem(keys.processing, 0, messageId)
      .hset(keys.payloads, messageId, JSON.stringify(replayPayload))
      .rpush(keys.ready, messageId)
      .exec();

    return {
      transport: 'redis',
      queue_name: queueName,
      queue_label: queueInfo.label,
      service: queueInfo.service,
      message_id: String(replayPayload.id || messageId),
      event: replayPayload.event || 'unknown'
    };
  } finally {
    if (redis.status !== 'end') {
      redis.disconnect();
    }
  }
};

const replayEventFailure = async ({ config, queueName, messageId, transport, actor }) => {
  const normalizedTransport = String(transport || '').trim().toLowerCase();
  const normalizedQueueName = String(queueName || '').trim();
  const normalizedMessageId = String(messageId || '').trim();

  if (!normalizedQueueName || !queueCatalogMap.has(normalizedQueueName)) {
    throw createHttpError(422, 'Choose a valid async queue before replaying the event.', null, { expose: true });
  }

  if (!normalizedMessageId) {
    throw createHttpError(422, 'A dead-letter message ID is required for replay.', null, { expose: true });
  }

  if (normalizedTransport === 'rabbitmq') {
    return replayRabbitMqEventFailure({
      config,
      queueName: normalizedQueueName,
      messageId: normalizedMessageId,
      actor
    });
  }

  if (normalizedTransport === 'redis') {
    return replayRedisEventFailure({
      config,
      queueName: normalizedQueueName,
      messageId: normalizedMessageId,
      actor
    });
  }

  throw createHttpError(422, 'Choose RabbitMQ or Redis before replaying the event.', null, { expose: true });
};

module.exports = {
  DEFAULT_FAILURE_LIMIT,
  MAX_FAILURE_LIMIT,
  isPlatformOperationsUser,
  normalizeAsyncFailureLimit,
  listEventFailures,
  replayEventFailure,
  buildEventContextItems
};
