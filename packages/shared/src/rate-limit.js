const createRedisRateLimitStore = ({ redis, prefix = 'rate-limit', windowMs = 60 * 1000 }) => {
  return {
    localKeys: false,
    prefix,
    async increment(key) {
      const redisKey = `${prefix}:${key}`;
      const totalHits = await redis.incr(redisKey);
      let ttlMs = await redis.pttl(redisKey);

      if (ttlMs <= 0) {
        await redis.pexpire(redisKey, windowMs);
        ttlMs = windowMs;
      }

      return {
        totalHits,
        resetTime: new Date(Date.now() + ttlMs)
      };
    },
    async decrement(key) {
      const redisKey = `${prefix}:${key}`;
      const totalHits = await redis.decr(redisKey);
      if (totalHits <= 0) {
        await redis.del(redisKey);
      }
    },
    async resetKey(key) {
      await redis.del(`${prefix}:${key}`);
    },
    async shutdown() {}
  };
};

module.exports = {
  createRedisRateLimitStore
};
