import mysql from 'mysql2';
import dotenv from 'dotenv';
dotenv.config();

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  ssl: { rejectUnauthorized: false },
});

const createTables = async () => {
  const conn = pool.promise();
  await conn.query(`
    CREATE TABLE IF NOT EXISTS countries (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) UNIQUE NOT NULL,
      capital VARCHAR(255),
      region VARCHAR(255),
      population BIGINT,
      currency_code VARCHAR(10),
      exchange_rate FLOAT,
      estimated_gdp DOUBLE,
      flag_url TEXT,
      last_refreshed_at DATETIME
    )
  `);
  await conn.query(`
    CREATE TABLE IF NOT EXISTS refresh_log (
      id INT PRIMARY KEY,
      last_refreshed_at DATETIME
    )
  `);
  await conn.query(`
    INSERT INTO refresh_log (id, last_refreshed_at)
    VALUES (1, NOW())
    ON DUPLICATE KEY UPDATE last_refreshed_at=last_refreshed_at
  `);
};

pool.getConnection((err, connection) => {
  if (err) console.error('Database connection failed:', err);
  else {
    console.log('Connected to MySQL');
    connection.release();
  }
});

export { createTables };
export default pool;
