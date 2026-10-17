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

// Auto-migration helper: ensures extra student & fee columns exist
async function ensureSchema() {
  try {
    const studentColumns = [
      { name: 'mother_name', def: 'VARCHAR(100) NULL' },
      { name: 'father_name', def: 'VARCHAR(100) NULL' },
      { name: 'blood_group', def: 'VARCHAR(10) NULL' },
      { name: 'category', def: 'VARCHAR(20) NULL' },
      { name: 'aadhaar_no', def: 'VARCHAR(20) NULL' },
      { name: 'emergency_contact', def: 'VARCHAR(15) NULL' }
    ];

    for (const col of studentColumns) {
      const [exists] = await pool.query(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'students' AND COLUMN_NAME = ?`,
        [col.name]
      );
      if (exists.length === 0) {
        await pool.query(`ALTER TABLE students ADD COLUMN ${col.name} ${col.def}`);
      }
    }

    // Fee payments extra columns for month-wise collection & breakdown
    const feeColumns = [
      { name: 'months_paid', def: 'VARCHAR(255) NULL' },
      { name: 'breakdown_json', def: 'TEXT NULL' }
    ];

    for (const col of feeColumns) {
      const [exists] = await pool.query(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'fee_payments' AND COLUMN_NAME = ?`,
        [col.name]
      );
      if (exists.length === 0) {
        await pool.query(`ALTER TABLE fee_payments ADD COLUMN ${col.name} ${col.def}`);
      }
    }

    // Allow fee_structure_id to be nullable for composite/multi-component fees
    try {
      await pool.query(`ALTER TABLE fee_payments MODIFY COLUMN fee_structure_id INT NULL`);
    } catch (e) {
      // Ignore if already nullable or constrained
    }
  } catch (err) {
    // Database may not be connected or tables not yet created on first boot
  }
}

ensureSchema();

module.exports = pool;
