const { randomUUID } = require('crypto');
const amqp = require('amqplib');
const Redis = require('ioredis');

const asPositiveInteger = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.floor(parsed)
    : fallback;
};

const getEventBusConfig = () => ({
  retryLimit: asPositiveInteger(process.env.EVENT_BUS_RETRY_LIMIT, 5),
  retryDelayMs: asPositiveInteger(process.env.EVENT_BUS_RETRY_DELAY_MS, 5000),
  retryMaxDelayMs: asPositiveInteger(process.env.EVENT_BUS_RETRY_MAX_DELAY_MS, 5 * 60 * 1000),
  redisNamespace: String(process.env.EVENT_BUS_REDIS_NAMESPACE || 'aisle:event-bus').trim() || 'aisle:event-bus',
  redisPollIntervalMs: asPositiveInteger(process.env.EVENT_BUS_REDIS_POLL_INTERVAL_MS, 2000),
  redisVisibilityTimeoutMs: asPositiveInteger(process.env.EVENT_BUS_REDIS_VISIBILITY_TIMEOUT_MS, 60 * 1000),
  redisBlockTimeoutSeconds: asPositiveInteger(process.env.EVENT_BUS_REDIS_BLOCK_TIMEOUT_SECONDS, 5)
});

const createEnvelope = (event, data, overrides = {}) => {
  return {
    id: overrides.id || randomUUID(),
    event,
    timestamp: overrides.timestamp || new Date().toISOString(),
    retry_count: Number(overrides.retry_count || 0),
    last_error: overrides.last_error || null,
    last_error_at: overrides.last_error_at || null,
    data
  };
};

const sleep = (durationMs) => new Promise((resolve) => {
  setTimeout(resolve, durationMs);
});

const calculateRetryDelayMs = (retryCount, eventBusConfig) => {
  const attempt = Math.max(1, Number(retryCount || 1));
  const baseDelayMs = asPositiveInteger(eventBusConfig.retryDelayMs, 5000);
  const maxDelayMs = asPositiveInteger(eventBusConfig.retryMaxDelayMs, 5 * 60 * 1000);
  return Math.min(maxDelayMs, baseDelayMs * Math.pow(2, attempt - 1));
};

const getSafeErrorMessage = (error, fallback = 'Unknown event bus processing error.') => {
  const message = String(error?.message || fallback).trim();
  return message.slice(0, 500) || fallback;
};

const normalizeRetryCount = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0
    ? Math.floor(parsed)
    : 0;
};

const buildRabbitRetryExchange = (exchangeName) => `${exchangeName}.retry`;
const buildRabbitDeadLetterExchange = (exchangeName) => `${exchangeName}.dlx`;
const buildRabbitRetryQueue = (queueName, event) => `${queueName}.${event}.retry`;
const buildRabbitDeadLetterQueue = (queueName) => `${queueName}.dead-letter`;

const buildRedisQueueKeys = (namespace, queueName) => ({
  ready: `${namespace}:queue:${queueName}:ready`,
  processing: `${namespace}:queue:${queueName}:processing`,
  inflight: `${namespace}:queue:${queueName}:inflight`,
  delayed: `${namespace}:queue:${queueName}:delayed`,
  deadLetter: `${namespace}:queue:${queueName}:dead-letter`,
  payloads: `${namespace}:queue:${queueName}:payloads`
});

const buildRedisSubscriptionKey = (namespace, event) => `${namespace}:subscriptions:${event}`;

const acknowledgeRedisMessage = async (redis, keys, messageId, keepPayload = false) => {
  const pipeline = redis.multi();
  pipeline.lrem(keys.processing, 0, messageId);
  pipeline.zrem(keys.inflight, messageId);
  if (!keepPayload) {
    pipeline.hdel(keys.payloads, messageId);
  }
  await pipeline.exec();
};

const moveRedisMessageToDeadLetter = async ({
  redis,
  keys,
  logger,
  queueName,
  messageId,
  payload,
  error,
  retryCount
}) => {
  const deadPayload = {
    ...payload,
    retry_count: retryCount,
    last_error: getSafeErrorMessage(error),
    last_error_at: new Date().toISOString()
  };

  await redis.multi()
    .lrem(keys.processing, 0, messageId)
    .zrem(keys.inflight, messageId)
    .hset(keys.payloads, messageId, JSON.stringify(deadPayload))
    .rpush(keys.deadLetter, messageId)
    .exec();

  logger.error('Redis fallback moved event to dead-letter queue', {
    queueName,
    event: payload.event,
    messageId,
    retryCount
  });
};

const scheduleRedisRetry = async ({
  redis,
  keys,
  logger,
  queueName,
  messageId,
  payload,
  error,
  retryCount,
  eventBusConfig
}) => {
  if (retryCount > eventBusConfig.retryLimit) {
    await moveRedisMessageToDeadLetter({
      redis,
      keys,
      logger,
      queueName,
      messageId,
      payload,
      error,
      retryCount
    });
    return;
  }

  const nextAttemptAt = Date.now() + calculateRetryDelayMs(retryCount, eventBusConfig);
  const retriedPayload = {
    ...payload,
    retry_count: retryCount,
    last_error: getSafeErrorMessage(error),
    last_error_at: new Date().toISOString()
  };

  await redis.multi()
    .lrem(keys.processing, 0, messageId)
    .zrem(keys.inflight, messageId)
    .hset(keys.payloads, messageId, JSON.stringify(retriedPayload))
    .zadd(keys.delayed, nextAttemptAt, messageId)
    .exec();

  logger.warn('Redis fallback scheduled event retry', {
    queueName,
    event: payload.event,
    messageId,
    retryCount,
    nextAttemptAt: new Date(nextAttemptAt).toISOString()
  });
};

const flushRedisDelayedMessages = async (redis, keys, batchSize = 50) => {
  const dueMessageIds = await redis.zrangebyscore(keys.delayed, 0, Date.now(), 'LIMIT', 0, batchSize);
  if (!dueMessageIds.length) {
    return 0;
  }

  await redis.multi()
    .zrem(keys.delayed, ...dueMessageIds)
    .rpush(keys.ready, ...dueMessageIds)
    .exec();

  return dueMessageIds.length;
};

const recoverRedisInflightMessages = async ({
  redis,
  keys,
  logger,
  queueName,
  eventBusConfig
}) => {
  const staleBefore = Date.now() - eventBusConfig.redisVisibilityTimeoutMs;
  const staleMessageIds = await redis.zrangebyscore(keys.inflight, 0, staleBefore, 'LIMIT', 0, 25);

  if (!staleMessageIds.length) {
    return 0;
  }

  for (const messageId of staleMessageIds) {
    const rawPayload = await redis.hget(keys.payloads, messageId);
    if (!rawPayload) {
      await redis.multi()
        .lrem(keys.processing, 0, messageId)
        .zrem(keys.inflight, messageId)
        .exec();
      continue;
    }

    let payload = null;
    try {
      payload = JSON.parse(rawPayload);
    } catch (error) {
      payload = createEnvelope('unknown', {
        raw_payload: rawPayload
      }, {
        id: messageId
      });
      await moveRedisMessageToDeadLetter({
        redis,
        keys,
        logger,
        queueName,
        messageId,
        payload,
        error,
        retryCount: eventBusConfig.retryLimit + 1
      });
      continue;
    }

    await scheduleRedisRetry({
      redis,
      keys,
      logger,
      queueName,
      messageId,
      payload,
      error: new Error('Event processing timed out before acknowledgement.'),
      retryCount: normalizeRetryCount(payload.retry_count) + 1,
      eventBusConfig
    });
  }

  return staleMessageIds.length;
};

const createRedisFallbackSubscription = async ({
  redis,
  queueName,
  events,
  onMessage,
  logger,
  eventBusConfig
}) => {
  const normalizedEvents = Array.from(new Set((events || []).filter(Boolean)));
  const namespace = eventBusConfig.redisNamespace;
  const keys = buildRedisQueueKeys(namespace, queueName);
  const blockingRedis = redis.duplicate({
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false
  });

  await blockingRedis.connect();

  const registrationPipeline = redis.multi();
  registrationPipeline.sadd(`${namespace}:queues`, queueName);
  normalizedEvents.forEach((event) => {
    registrationPipeline.sadd(buildRedisSubscriptionKey(namespace, event), queueName);
  });
  await registrationPipeline.exec();

  let closed = false;
  let shutdownRequested = false;
  let consumerLoopPromise = null;

  const maintenanceTick = async () => {
    try {
      await flushRedisDelayedMessages(redis, keys);
      await recoverRedisInflightMessages({
        redis,
        keys,
        logger,
        queueName,
        eventBusConfig
      });
    } catch (error) {
      logger.error('Redis fallback maintenance tick failed', {
        queueName,
        error: error.message
      });
    }
  };

  const maintenanceInterval = globalThis.setInterval(() => {
    void maintenanceTick();
  }, eventBusConfig.redisPollIntervalMs);

  if (typeof maintenanceInterval.unref === 'function') {
    maintenanceInterval.unref();
  }

  consumerLoopPromise = (async () => {
    while (!closed) {
      await maintenanceTick();

      let messageId = null;
      try {
        messageId = await blockingRedis.brpoplpush(
          keys.ready,
          keys.processing,
          eventBusConfig.redisBlockTimeoutSeconds
        );
      } catch (error) {
        if (closed) {
          break;
        }

        logger.error('Redis fallback consumer failed to claim message', {
          queueName,
          error: error.message
        });
        await sleep(1000);
        continue;
      }

      if (!messageId) {
        continue;
      }

      try {
        await redis.zadd(keys.inflight, Date.now(), messageId);
        const rawPayload = await redis.hget(keys.payloads, messageId);

        if (!rawPayload) {
          await acknowledgeRedisMessage(redis, keys, messageId);
          continue;
        }

        const payload = JSON.parse(rawPayload);
        if (!normalizedEvents.includes(payload.event)) {
          await acknowledgeRedisMessage(redis, keys, messageId);
          continue;
        }

        await onMessage(payload);
        await acknowledgeRedisMessage(redis, keys, messageId);
      } catch (error) {
        let payload = null;
        try {
          const rawPayload = await redis.hget(keys.payloads, messageId);
          payload = rawPayload
            ? JSON.parse(rawPayload)
            : createEnvelope('unknown', {
              queue_name: queueName
            }, {
              id: messageId
            });
        } catch {
          payload = createEnvelope('unknown', {
            queue_name: queueName
          }, {
            id: messageId
          });
        }

        await scheduleRedisRetry({
          redis,
          keys,
          logger,
          queueName,
          messageId,
          payload,
          error,
          retryCount: normalizeRetryCount(payload.retry_count) + 1,
          eventBusConfig
        });
      }
    }
  })();

  return {
    close: async () => {
      if (shutdownRequested) {
        return;
      }

      shutdownRequested = true;
      closed = true;
      globalThis.clearInterval(maintenanceInterval);
      try {
        blockingRedis.disconnect();
      } catch {}
      await Promise.resolve(consumerLoopPromise).catch(() => undefined);
      if (blockingRedis.status !== 'end') {
        blockingRedis.disconnect();
      }
    }
  };
};

const createRabbitEventBus = async (config, logger, eventBusConfig) => {
  const connection = await amqp.connect(config.rabbitmqUrl);
  const channel = await connection.createChannel();
  const exchangeName = config.eventExchange;
  const retryExchange = buildRabbitRetryExchange(exchangeName);
  const deadLetterExchange = buildRabbitDeadLetterExchange(exchangeName);
  const subscriptions = [];

  await channel.assertExchange(exchangeName, 'topic', { durable: true });
  await channel.assertExchange(retryExchange, 'topic', { durable: true });
  await channel.assertExchange(deadLetterExchange, 'topic', { durable: true });
  await channel.prefetch(10);

  return {
    transport: 'rabbitmq',
    connected: true,
    durable: true,
    publish: async (event, data) => {
      const envelope = createEnvelope(event, data);
      channel.publish(
        exchangeName,
        event,
        Buffer.from(JSON.stringify(envelope)),
        { persistent: true, contentType: 'application/json' }
      );
      logger.info('Published event via RabbitMQ', { event, messageId: envelope.id });
      return envelope;
    },
    subscribe: async ({ queueName, events, onMessage }) => {
      const normalizedEvents = Array.from(new Set((events || []).filter(Boolean)));
      const deadLetterQueue = buildRabbitDeadLetterQueue(queueName);

      await channel.assertQueue(queueName, { durable: true });
      await channel.assertQueue(deadLetterQueue, { durable: true });

      for (const event of normalizedEvents) {
        const retryQueue = buildRabbitRetryQueue(queueName, event);
        await channel.assertQueue(retryQueue, {
          durable: true,
          arguments: {
            'x-dead-letter-exchange': exchangeName
          }
        });
        await channel.bindQueue(queueName, exchangeName, event);
        await channel.bindQueue(retryQueue, retryExchange, event);
        await channel.bindQueue(deadLetterQueue, deadLetterExchange, event);
      }

      await channel.consume(queueName, async (message) => {
        if (!message) {
          return;
        }

        let payload = null;
        try {
          payload = JSON.parse(message.content.toString());
          await onMessage(payload);
          channel.ack(message);
        } catch (error) {
          const currentPayload = payload || createEnvelope(message.fields.routingKey, {
            raw_payload: message.content.toString()
          }, {
            retry_count: normalizeRetryCount(message.properties?.headers?.['x-retry-count'])
          });
          const retryCount = normalizeRetryCount(currentPayload.retry_count) + 1;
          const nextPayload = {
            ...currentPayload,
            retry_count: retryCount,
            last_error: getSafeErrorMessage(error),
            last_error_at: new Date().toISOString()
          };
          const serializedPayload = Buffer.from(JSON.stringify(nextPayload));

          try {
            if (retryCount > eventBusConfig.retryLimit) {
              channel.publish(deadLetterExchange, message.fields.routingKey, serializedPayload, {
                persistent: true,
                contentType: 'application/json',
                headers: {
                  'x-original-queue': queueName,
                  'x-final-failure': getSafeErrorMessage(error)
                }
              });
              logger.error('RabbitMQ moved event to dead-letter queue', {
                queueName,
                event: currentPayload.event,
                messageId: currentPayload.id,
                retryCount
              });
            } else {
              channel.publish(retryExchange, message.fields.routingKey, serializedPayload, {
                persistent: true,
                contentType: 'application/json',
                expiration: String(calculateRetryDelayMs(retryCount, eventBusConfig)),
                headers: {
                  'x-retry-count': retryCount,
                  'x-original-queue': queueName
                }
              });
              logger.warn('RabbitMQ scheduled event retry', {
                queueName,
                event: currentPayload.event,
                messageId: currentPayload.id,
                retryCount
              });
            }

            channel.ack(message);
          } catch (publishError) {
            logger.error('RabbitMQ failed to schedule retry or dead-letter publish', {
              queueName,
              event: currentPayload.event,
              messageId: currentPayload.id,
              error: publishError.message
            });
            channel.nack(message, false, false);
          }
        }
      }, {
        noAck: false
      });

      subscriptions.push({ queueName });
    },
    close: async () => {
      while (subscriptions.length) {
        subscriptions.pop();
      }
      await channel.close();
      await connection.close();
    }
  };
};

const createRedisEventBus = async (config, logger, eventBusConfig) => {
  const redis = new Redis(config.redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false
  });
  const subscriptions = [];

  await redis.connect();

  return {
    transport: 'redis',
    connected: true,
    durable: true,
    publish: async (event, data) => {
      const envelope = createEnvelope(event, data);
      const subscriberQueueNames = await redis.smembers(
        buildRedisSubscriptionKey(eventBusConfig.redisNamespace, event)
      );

      if (subscriberQueueNames.length) {
        const pipeline = redis.multi();
        subscriberQueueNames.forEach((queueName) => {
          const keys = buildRedisQueueKeys(eventBusConfig.redisNamespace, queueName);
          pipeline.hset(keys.payloads, envelope.id, JSON.stringify(envelope));
          pipeline.rpush(keys.ready, envelope.id);
        });
        await pipeline.exec();
      }

      logger.info('Published event via Redis fallback', {
        event,
        messageId: envelope.id,
        subscribers: subscriberQueueNames.length
      });
      return envelope;
    },
    subscribe: async ({ queueName, events, onMessage }) => {
      const subscription = await createRedisFallbackSubscription({
        redis,
        queueName,
        events,
        onMessage,
        logger,
        eventBusConfig
      });
      subscriptions.push(subscription);
    },
    close: async () => {
      while (subscriptions.length) {
        const subscription = subscriptions.pop();
        await subscription.close();
      }
      if (redis.status !== 'end') {
        redis.disconnect();
      }
    }
  };
};

const createUnavailableEventBus = (logger, errors = []) => {
  const message = errors.length
    ? errors.join(' | ')
    : 'No durable event bus transport is available.';

  logger.error('Event bus transport unavailable', {
    error: message
  });

  return {
    transport: 'unavailable',
    connected: false,
    durable: false,
    publish: async (event) => {
      throw new Error(`Unable to publish ${event}: ${message}`);
    },
    subscribe: async ({ queueName }) => {
      throw new Error(`Unable to subscribe ${queueName}: ${message}`);
    },
    close: async () => undefined
  };
};

const createEventBus = async (config, logger) => {
  const eventBusConfig = getEventBusConfig();
  const errors = [];

  try {
    return await createRabbitEventBus(config, logger, eventBusConfig);
  } catch (error) {
    const message = getSafeErrorMessage(error, 'RabbitMQ connection failed.');
    errors.push(`RabbitMQ: ${message}`);
    logger.warn('RabbitMQ unavailable, falling back to Redis event bus', {
      error: message
    });
  }

  try {
    return await createRedisEventBus(config, logger, eventBusConfig);
  } catch (error) {
    const message = getSafeErrorMessage(error, 'Redis event bus connection failed.');
    errors.push(`Redis: ${message}`);
  }

  return createUnavailableEventBus(logger, errors);
};

module.exports = {
  createEnvelope,
  createEventBus
};
