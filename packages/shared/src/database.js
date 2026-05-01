const mysql = require('mysql2/promise');

const parseDatabaseUrl = (databaseUrl) => {
  const url = new URL(databaseUrl);
  return {
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username || 'root'),
    password: decodeURIComponent(url.password || ''),
    database: url.pathname.replace(/^\//, '')
  };
};

const createPoolOptions = (databaseConfig, poolConfig = {}) => {
  return {
    host: databaseConfig.host,
    port: databaseConfig.port,
    user: databaseConfig.user,
    password: databaseConfig.password,
    database: databaseConfig.database,
    waitForConnections: true,
    namedPlaceholders: true,
    decimalNumbers: true,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
    connectionLimit: Number(poolConfig.max || 12),
    maxIdle: Number(poolConfig.min || 2),
    idleTimeout: Number(poolConfig.idleTimeoutMs || 60 * 1000),
    queueLimit: 0
  };
};

const delay = (durationMs) => new Promise((resolve) => setTimeout(resolve, durationMs));

const withRetry = async (handler, { retries = 5, delayMs = 1000, logger, label = 'operation' } = {}) => {
  let attempt = 0;
  while (true) {
    try {
      return await handler();
    } catch (error) {
      attempt += 1;
      if (attempt > retries) {
        throw error;
      }

      logger?.warn('Retrying database operation', {
        label,
        attempt,
        retries,
        error: error.message
      });
      await delay(delayMs);
    }
  }
};

const bootstrapDatabase = async ({
  databaseUrl,
  readDatabaseUrls = [],
  statements = [],
  logger,
  poolConfig = {},
  retryConfig = {}
}) => {
  const parsed = parseDatabaseUrl(databaseUrl);
  const adminPool = await withRetry(async () => {
    return mysql.createPool({
      host: parsed.host,
      port: parsed.port,
      user: parsed.user,
      password: parsed.password,
      waitForConnections: true,
      connectionLimit: 3
    });
  }, {
    retries: retryConfig.retries,
    delayMs: retryConfig.delayMs,
    logger,
    label: 'database-admin-connect'
  });

  await withRetry(async () => {
    await adminPool.query(`CREATE DATABASE IF NOT EXISTS \`${parsed.database}\``);
  }, {
    retries: retryConfig.retries,
    delayMs: retryConfig.delayMs,
    logger,
    label: 'database-bootstrap'
  });
  await adminPool.end();

  const pool = await withRetry(async () => {
    const connectionPool = mysql.createPool(createPoolOptions(parsed, poolConfig));
    await connectionPool.query('SELECT 1 AS ok');
    return connectionPool;
  }, {
    retries: retryConfig.retries,
    delayMs: retryConfig.delayMs,
    logger,
    label: 'database-write-pool'
  });

  const readPools = [];
  for (const readDatabaseUrl of readDatabaseUrls) {
    const readParsed = parseDatabaseUrl(readDatabaseUrl);
    const readPool = await withRetry(async () => {
      const connectionPool = mysql.createPool(createPoolOptions(readParsed, poolConfig));
      await connectionPool.query('SELECT 1 AS ok');
      return connectionPool;
    }, {
      retries: retryConfig.retries,
      delayMs: retryConfig.delayMs,
      logger,
      label: 'database-read-pool'
    });
    readPools.push(readPool);
  }

  for (const statement of statements) {
    await pool.query(statement);
  }

  if (logger) {
    logger.info('Database bootstrap completed', { database: parsed.database });
  }

  return {
    pool,
    readPools,
    parsed,
    query: async (sql, params, options = {}) => {
      const targetPool = options.useReplica && readPools.length
        ? readPools[Math.floor(Math.random() * readPools.length)]
        : pool;
      const [rows] = await targetPool.query(sql, params);
      return rows;
    },
    execute: async (sql, params) => {
      const [result] = await pool.execute(sql, params);
      return result;
    },
    withTransaction: async (handler) => {
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        const result = await handler(connection);
        await connection.commit();
        return result;
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    },
    healthCheck: async () => {
      await pool.query('SELECT 1 AS ok');
      if (readPools.length) {
        await readPools[0].query('SELECT 1 AS ok');
      }
      return {
        write: 'ok',
        read: readPools.length ? 'ok' : 'not-configured'
      };
    },
    close: async () => {
      for (const readPool of readPools) {
        await readPool.end();
      }
      await pool.end();
    }
  };
};

module.exports = {
  parseDatabaseUrl,
  bootstrapDatabase
};
