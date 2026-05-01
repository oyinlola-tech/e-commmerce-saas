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

const createPoolOptions = (databaseConfig) => {
  return {
    host: databaseConfig.host,
    port: databaseConfig.port,
    user: databaseConfig.user,
    password: databaseConfig.password,
    database: databaseConfig.database,
    waitForConnections: true,
    connectionLimit: 10,
    namedPlaceholders: true
  };
};

const bootstrapDatabase = async ({
  databaseUrl,
  statements = [],
  logger
}) => {
  const parsed = parseDatabaseUrl(databaseUrl);
  const adminPool = mysql.createPool({
    host: parsed.host,
    port: parsed.port,
    user: parsed.user,
    password: parsed.password,
    waitForConnections: true,
    connectionLimit: 5
  });

  await adminPool.query(`CREATE DATABASE IF NOT EXISTS \`${parsed.database}\``);
  await adminPool.end();

  const pool = mysql.createPool(createPoolOptions(parsed));
  for (const statement of statements) {
    await pool.query(statement);
  }

  if (logger) {
    logger.info('Database bootstrap completed', { database: parsed.database });
  }

  return {
    pool,
    parsed,
    query: async (sql, params) => {
      const [rows] = await pool.query(sql, params);
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
    }
  };
};

module.exports = {
  parseDatabaseUrl,
  bootstrapDatabase
};
