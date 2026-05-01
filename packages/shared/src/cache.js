const Redis = require('ioredis');

const memoryStore = new Map();

const now = () => Date.now();

const withPrefix = (prefix, key) => `${prefix}:${key}`;

const normalizePattern = (prefix, pattern = '*') => {
  return `${prefix}:${pattern}`;
};

const cleanupMemory = () => {
  const timestamp = now();
  for (const [key, value] of memoryStore.entries()) {
    if (value.expiresAt && value.expiresAt <= timestamp) {
      memoryStore.delete(key);
    }
  }
};

const createMemoryAdapter = (prefix) => {
  return {
    type: 'memory',
    status: 'ready',
    redis: null,
    async get(key) {
      cleanupMemory();
      const record = memoryStore.get(withPrefix(prefix, key));
      if (!record) {
        return null;
      }

      if (record.expiresAt && record.expiresAt <= now()) {
        memoryStore.delete(withPrefix(prefix, key));
        return null;
      }

      return record.value;
    },
    async set(key, value, ttlSeconds) {
      memoryStore.set(withPrefix(prefix, key), {
        value,
        expiresAt: ttlSeconds ? now() + ttlSeconds * 1000 : null
      });
    },
    async del(key) {
      memoryStore.delete(withPrefix(prefix, key));
    },
    async delByPattern(pattern = '*') {
      cleanupMemory();
      const regex = new RegExp(`^${normalizePattern(prefix, pattern).replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '.*')}$`);
      for (const key of memoryStore.keys()) {
        if (regex.test(key)) {
          memoryStore.delete(key);
        }
      }
    },
    async healthCheck() {
      cleanupMemory();
      return 'memory';
    },
    async close() {}
  };
};

const createRedisAdapter = async ({ prefix, redisUrl, logger }) => {
  const redis = new Redis(redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false
  });

  let hasConnected = false;
  let latestErrorMessage = '';
  let lastLoggedErrorMessage = '';
  const handleRedisError = (error) => {
    const message = String(error?.message || error || 'Redis client error');
    latestErrorMessage = message;

    if (!hasConnected || message === lastLoggedErrorMessage) {
      return;
    }

    lastLoggedErrorMessage = message;
    if (logger) {
      logger.warn('Redis client error', {
        prefix,
        error: message
      });
    }
  };

  redis.on('error', handleRedisError);
  redis.once('ready', () => {
    hasConnected = true;
    lastLoggedErrorMessage = '';
  });

  try {
    await redis.connect();
  } catch (error) {
    const failureMessage = latestErrorMessage || String(error?.message || 'Redis connection failed');
    redis.removeListener('error', handleRedisError);
    redis.disconnect();
    throw new Error(failureMessage);
  }

  return {
    type: 'redis',
    status: 'ready',
    redis,
    async get(key) {
      return redis.get(withPrefix(prefix, key));
    },
    async set(key, value, ttlSeconds) {
      const namespacedKey = withPrefix(prefix, key);
      if (ttlSeconds) {
        await redis.set(namespacedKey, value, 'EX', ttlSeconds);
        return;
      }

      await redis.set(namespacedKey, value);
    },
    async del(key) {
      await redis.del(withPrefix(prefix, key));
    },
    async delByPattern(pattern = '*') {
      const match = normalizePattern(prefix, pattern);
      let cursor = '0';

      do {
        const result = await redis.scan(cursor, 'MATCH', match, 'COUNT', 100);
        cursor = result[0];
        const keys = result[1];
        if (keys.length) {
          await redis.del(...keys);
        }
      } while (cursor !== '0');
    },
    async healthCheck() {
      const response = await redis.ping();
      return response === 'PONG' ? 'connected' : response;
    },
    async close() {
      redis.removeListener('error', handleRedisError);
      if (redis.status !== 'end') {
        redis.disconnect();
      }
    }
  };
};

const createCache = async (config, logger) => {
  const prefix = config.redisPrefix || config.serviceName || 'aisle';
  let adapter;

  try {
    if (config.disableRedis) {
      throw new Error('Redis disabled by configuration.');
    }

    adapter = await createRedisAdapter({
      prefix,
      redisUrl: config.redisUrl,
      logger
    });
    logger.info('Redis cache connected', { prefix });
  } catch (error) {
    logger.warn('Falling back to in-memory cache', {
      prefix,
      error: error.message
    });
    adapter = createMemoryAdapter(prefix);
  }

  return {
    adapter,
    redis: adapter.redis || null,
    async get(key) {
      return adapter.get(key);
    },
    async getJson(key) {
      const value = await adapter.get(key);
      if (!value) {
        return null;
      }

      try {
        return JSON.parse(value);
      } catch {
        return null;
      }
    },
    async set(key, value, ttlSeconds) {
      return adapter.set(key, value, ttlSeconds);
    },
    async setJson(key, value, ttlSeconds) {
      return adapter.set(key, JSON.stringify(value), ttlSeconds);
    },
    async del(key) {
      return adapter.del(key);
    },
    async delByPattern(pattern = '*') {
      return adapter.delByPattern(pattern);
    },
    async getOrSetJson(key, ttlSeconds, loader) {
      const cached = await this.getJson(key);
      if (cached !== null) {
        return { value: cached, cacheHit: true };
      }

      const fresh = await loader();
      await this.setJson(key, fresh, ttlSeconds);
      return { value: fresh, cacheHit: false };
    },
    async healthCheck() {
      return adapter.healthCheck();
    },
    async close() {
      return adapter.close();
    }
  };
};

module.exports = {
  createCache
};
