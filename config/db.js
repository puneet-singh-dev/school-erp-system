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
      { name: 'emergency_contact', def: 'VARCHAR(15) NULL' },
      { name: 'previous_balance', def: 'DECIMAL(10,2) DEFAULT 0.00' },
      { name: 'previous_balance_remarks', def: 'VARCHAR(255) NULL' },
      { name: 'uses_transport', def: 'BOOLEAN DEFAULT FALSE' },
      { name: 'transport_route', def: 'VARCHAR(150) NULL' },
      { name: 'transport_fee', def: 'DECIMAL(10,2) DEFAULT 0.00' }
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

    // 1. Gallery Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS gallery (
        id INT AUTO_INCREMENT PRIMARY KEY,
        title VARCHAR(200) NOT NULL,
        description TEXT,
        category VARCHAR(100) DEFAULT 'General',
        image_path VARCHAR(255) NOT NULL,
        uploaded_by INT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 2. Homework Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS homework (
        id INT AUTO_INCREMENT PRIMARY KEY,
        class_id INT NOT NULL,
        subject_id INT NULL,
        title VARCHAR(200) NOT NULL,
        description TEXT NOT NULL,
        assigned_date DATE NOT NULL,
        due_date DATE NOT NULL,
        assigned_by INT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 3. Leave Applications Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS leave_applications (
        id INT AUTO_INCREMENT PRIMARY KEY,
        student_id INT NOT NULL,
        from_date DATE NOT NULL,
        to_date DATE NOT NULL,
        reason TEXT NOT NULL,
        status ENUM('Pending','Approved','Rejected') DEFAULT 'Pending',
        reviewed_by INT,
        admin_remarks TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 4. Events & Holidays Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS events (
        id INT AUTO_INCREMENT PRIMARY KEY,
        title VARCHAR(200) NOT NULL,
        event_type ENUM('Holiday','Event','Activity','Exam') DEFAULT 'Holiday',
        start_date DATE NOT NULL,
        end_date DATE,
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Seed sample holidays & events if empty
    const [[{ eventCount }]] = await pool.query('SELECT COUNT(*) as eventCount FROM events');
    if (eventCount === 0) {
      await pool.query(`
        INSERT INTO events (title, event_type, start_date, end_date, description) VALUES
        ('Diwali & Chhath Puja Break', 'Holiday', '2026-11-08', '2026-11-13', 'School will remain closed for Diwali and Chhath festivals.'),
        ('Guru Nanak Jayanti', 'Holiday', '2026-11-24', '2026-11-24', 'Gazetted Holiday.'),
        ('Winter Sports Meet 2026', 'Event', '2026-12-18', '2026-12-20', 'Annual Inter-House Sports and Athletics Championship.'),
        ('Christmas & Winter Vacation', 'Holiday', '2026-12-25', '2027-01-05', 'School closes for winter break.'),
        ('Republic Day Celebration', 'Event', '2027-01-26', '2027-01-26', 'Flag hoisting ceremony at 8:30 AM.'),
        ('Annual Examination 2026-27', 'Exam', '2027-03-01', '2027-03-15', 'Annual term examinations for all classes.')
      `);
    }

    // 5. Contact Information Requests & Direct Inquiries
    await pool.query(`
      CREATE TABLE IF NOT EXISTS contact_requests (
        id INT AUTO_INCREMENT PRIMARY KEY,
        student_id INT NOT NULL,
        request_type ENUM('Profile_Update','Message_Teacher','Message_Admin') NOT NULL DEFAULT 'Profile_Update',
        new_phone VARCHAR(20),
        new_email VARCHAR(100),
        new_address TEXT,
        new_emergency_contact VARCHAR(20),
        message TEXT,
        target_teacher_id INT,
        status ENUM('Pending','Approved','Rejected') DEFAULT 'Pending',
        reviewed_by INT,
        admin_notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

  } catch (err) {
    console.error('ensureSchema error:', err.message);
  }
}

ensureSchema();

module.exports = pool;
