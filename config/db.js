const mysql = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'school_erp',
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Auto-migration helper: ensures extra student fields exist
async function ensureSchema() {
  try {
    const columns = [
      { name: 'mother_name', def: 'VARCHAR(100) NULL' },
      { name: 'father_name', def: 'VARCHAR(100) NULL' },
      { name: 'blood_group', def: 'VARCHAR(10) NULL' },
      { name: 'category', def: 'VARCHAR(20) NULL' },
      { name: 'aadhaar_no', def: 'VARCHAR(20) NULL' },
      { name: 'emergency_contact', def: 'VARCHAR(15) NULL' }
    ];

    for (const col of columns) {
      const [exists] = await pool.query(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'students' AND COLUMN_NAME = ?`,
        [col.name]
      );
      if (exists.length === 0) {
        await pool.query(`ALTER TABLE students ADD COLUMN ${col.name} ${col.def}`);
      }
    }
  } catch (err) {
    // Database may not be connected or tables not yet created on first boot
  }
}

ensureSchema();

module.exports = pool;
