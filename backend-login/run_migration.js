const { Pool } = require('pg');
require('dotenv').config({ path: 'f:/18Sept/SFCS-Unit2-Backend/backend-login/.env' });

const pool = new Pool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '5432'),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

async function run() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS rrh_inward_sessions (
          id SERIAL PRIMARY KEY,
          work_order_id VARCHAR(255) NOT NULL,
          status VARCHAR(50) DEFAULT 'In Progress',
          duplicate_scan_count INTEGER DEFAULT 0,
          created_by VARCHAR(255),
          created_by_name VARCHAR(255),
          updated_by VARCHAR(255),
          updated_by_name VARCHAR(255),
          deleted_by VARCHAR(255),
          deleted_by_name VARCHAR(255),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          deleted_at TIMESTAMP,
          is_deleted BOOLEAN DEFAULT false
      );
    `);
    console.log("rrh_inward_sessions created");

    await pool.query(`
      CREATE TABLE IF NOT EXISTS rrh_inward_scans (
          id SERIAL PRIMARY KEY,
          rrh_inward_session_id INTEGER REFERENCES rrh_inward_sessions(id),
          work_order_id VARCHAR(255) NOT NULL,
          serial_number VARCHAR(255) NOT NULL,
          status VARCHAR(50) DEFAULT 'PASS',
          scanned_by VARCHAR(255),
          scanned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          is_deleted BOOLEAN DEFAULT false
      );
    `);
    console.log("rrh_inward_scans created");

  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}

run();
