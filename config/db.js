const mysql = require('mysql2/promise');
require('dotenv').config();

function getPoolConfig() {
  const dbUri = (process.env.DATABASE_URL || process.env.MYSQL_URL || process.env.JAWSDB_URL || process.env.CLEARDB_DATABASE_URL || '').trim();

  if (dbUri) {
    try {
      // Safely parse URI by normalizing protocol
      const parsed = new URL(dbUri.replace(/^[a-z]+:\/\//i, 'http://'));
      let dbName = parsed.pathname ? parsed.pathname.replace(/^\//, '').split('?')[0] : '';
      // 'sys' is a reserved system database in MySQL/TiDB. Default to 'test' if sys is given.
      if (!dbName || dbName === 'sys') dbName = 'test';

      const config = {
        host: parsed.hostname,
        port: parsed.port ? parseInt(parsed.port, 10) : 4000,
        user: decodeURIComponent(parsed.username || 'root'),
        password: decodeURIComponent(parsed.password || ''),
        database: dbName,
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0
      };

      // For cloud databases (TiDB, Aiven, Railway, etc.), provide TLS config
      if (process.env.DB_SSL !== 'false') {
        config.ssl = { minVersion: 'TLSv1.2', rejectUnauthorized: false };
      }

      console.log(`📡 Connecting to Cloud Database: ${config.host}:${config.port}/${config.database} (User: ${config.user})`);
      return config;
    } catch (err) {
      console.warn('Could not parse database URI as URL, stripping query parameters:', err.message);
      const sanitizedUri = dbUri.replace(/\?.*$/, '');
      return {
        uri: sanitizedUri,
        ssl: { rejectUnauthorized: false },
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0
      };
    }
  }

  // Standard environment variables fallback (localhost / local dev)
  return {
    host: process.env.DB_HOST || process.env.MYSQLHOST || 'localhost',
    port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : (process.env.MYSQLPORT ? parseInt(process.env.MYSQLPORT, 10) : 3306),
    user: process.env.DB_USER || process.env.MYSQLUSER || 'root',
    password: process.env.DB_PASSWORD !== undefined ? process.env.DB_PASSWORD : (process.env.MYSQLPASSWORD || ''),
    database: (process.env.DB_NAME && process.env.DB_NAME !== 'sys') ? process.env.DB_NAME : (process.env.MYSQLDATABASE || 'school_erp'),
    ssl: (process.env.DB_SSL === 'true' || process.env.MYSQL_SSL === 'true') ? { rejectUnauthorized: false } : undefined,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
  };
}

const pool = mysql.createPool(getPoolConfig());

// Auto-migration & Schema helper: auto-provisions base schema & extra columns
async function ensureSchema() {
  try {
    // 0. Ensure base tables exist (vital for fresh cloud deployments)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        email VARCHAR(100) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        role ENUM('admin','teacher','student') NOT NULL,
        phone VARCHAR(15),
        address TEXT,
        profile_photo VARCHAR(255) DEFAULT 'default.png',
        is_active BOOLEAN DEFAULT TRUE,
        is_demo BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Ensure default admin user exists (admin@school.com / admin123)
    await pool.query(`
      INSERT IGNORE INTO users (name, email, password, role) VALUES
      ('Admin User', 'admin@school.com', '$2b$10$eb4cZiUN.IRI21Xf9f9w0ePVFZr5oOoqaRfU/ITzN1OWP8l3b/B/u', 'admin')
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS classes (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(50) NOT NULL,
        section VARCHAR(10) NOT NULL,
        teacher_id INT,
        academic_year VARCHAR(9) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (teacher_id) REFERENCES users(id) ON DELETE SET NULL
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS subjects (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        code VARCHAR(20),
        class_id INT NOT NULL,
        teacher_id INT,
        max_marks INT DEFAULT 100,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE,
        FOREIGN KEY (teacher_id) REFERENCES users(id) ON DELETE SET NULL
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS students (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL UNIQUE,
        admission_no VARCHAR(30) UNIQUE NOT NULL,
        class_id INT,
        roll_number INT,
        date_of_birth DATE,
        gender ENUM('Male','Female','Other'),
        father_name VARCHAR(100),
        mother_name VARCHAR(100),
        guardian_name VARCHAR(100),
        guardian_phone VARCHAR(15),
        emergency_contact VARCHAR(15),
        blood_group VARCHAR(10),
        category VARCHAR(20),
        aadhaar_no VARCHAR(20),
        previous_balance DECIMAL(10,2) DEFAULT 0.00,
        previous_balance_remarks VARCHAR(255),
        uses_transport BOOLEAN DEFAULT FALSE,
        transport_route VARCHAR(150),
        transport_fee DECIMAL(10,2) DEFAULT 0.00,
        admission_date DATE DEFAULT (CURRENT_DATE),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE SET NULL
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS teachers (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL UNIQUE,
        employee_id VARCHAR(30) UNIQUE NOT NULL,
        department VARCHAR(100),
        designation VARCHAR(100),
        date_of_joining DATE,
        qualification VARCHAR(200),
        salary DECIMAL(10,2) DEFAULT 0,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS attendance (
        id INT AUTO_INCREMENT PRIMARY KEY,
        student_id INT NOT NULL,
        class_id INT NOT NULL,
        date DATE NOT NULL,
        status ENUM('Present','Absent','Late','Leave') NOT NULL DEFAULT 'Present',
        marked_by INT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY unique_attendance (student_id, date),
        FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
        FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE,
        FOREIGN KEY (marked_by) REFERENCES users(id) ON DELETE SET NULL
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS fee_structure (
        id INT AUTO_INCREMENT PRIMARY KEY,
        class_id INT NOT NULL,
        fee_type VARCHAR(100) NOT NULL,
        amount DECIMAL(10,2) NOT NULL,
        due_date DATE,
        academic_year VARCHAR(9) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS fee_payments (
        id INT AUTO_INCREMENT PRIMARY KEY,
        student_id INT NOT NULL,
        fee_structure_id INT NULL,
        amount_paid DECIMAL(10,2) NOT NULL,
        payment_date DATE DEFAULT (CURRENT_DATE),
        payment_mode ENUM('Cash','Online','Cheque','DD') DEFAULT 'Cash',
        receipt_no VARCHAR(50) UNIQUE,
        remarks TEXT,
        months_paid VARCHAR(255) NULL,
        breakdown_json TEXT NULL,
        collected_by INT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
        FOREIGN KEY (fee_structure_id) REFERENCES fee_structure(id) ON DELETE SET NULL,
        FOREIGN KEY (collected_by) REFERENCES users(id) ON DELETE SET NULL
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS exams (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        class_id INT NOT NULL,
        exam_date DATE,
        academic_year VARCHAR(9) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS results (
        id INT AUTO_INCREMENT PRIMARY KEY,
        student_id INT NOT NULL,
        exam_id INT NOT NULL,
        subject_id INT NOT NULL,
        marks_obtained DECIMAL(5,2) DEFAULT 0,
        max_marks INT DEFAULT 100,
        grade VARCHAR(5),
        remarks TEXT,
        entered_by INT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY unique_result (student_id, exam_id, subject_id),
        FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
        FOREIGN KEY (exam_id) REFERENCES exams(id) ON DELETE CASCADE,
        FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE CASCADE,
        FOREIGN KEY (entered_by) REFERENCES users(id) ON DELETE SET NULL
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS notices (
        id INT AUTO_INCREMENT PRIMARY KEY,
        title VARCHAR(200) NOT NULL,
        content TEXT NOT NULL,
        target_role ENUM('all','student','teacher') DEFAULT 'all',
        created_by INT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS timetable (
        id INT AUTO_INCREMENT PRIMARY KEY,
        class_id INT NOT NULL,
        subject_id INT NOT NULL,
        teacher_id INT,
        day_of_week ENUM('Monday','Tuesday','Wednesday','Thursday','Friday','Saturday') NOT NULL,
        start_time TIME NOT NULL,
        end_time TIME NOT NULL,
        FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE,
        FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE CASCADE,
        FOREIGN KEY (teacher_id) REFERENCES users(id) ON DELETE SET NULL
      )
    `);

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

    // Users extra columns (e.g. is_demo)
    const userColumns = [
      { name: 'is_demo', def: 'BOOLEAN DEFAULT FALSE' }
    ];

    for (const col of userColumns) {
      try {
        const [exists] = await pool.query(
          `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = ?`,
          [col.name]
        );
        if (exists.length === 0) {
          await pool.query(`ALTER TABLE users ADD COLUMN ${col.name} ${col.def}`);
        }
      } catch (uErr) {
        try {
          await pool.query(`ALTER TABLE users ADD COLUMN ${col.name} ${col.def}`);
        } catch (ignore) {}
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

    // 6. Ensure initial classes exist if table is empty
    const [[{ classCount }]] = await pool.query('SELECT COUNT(*) as classCount FROM classes');
    if (classCount === 0) {
      await pool.query(`
        INSERT INTO classes (name, section, academic_year) VALUES
        ('Class 1', 'A', '2026-27'),
        ('Class 2', 'A', '2026-27'),
        ('Class 3', 'A', '2026-27'),
        ('Class 4', 'A', '2026-27'),
        ('Class 5', 'A', '2026-27'),
        ('Class 6', 'A', '2026-27'),
        ('Class 7', 'A', '2026-27'),
        ('Class 8', 'A', '2026-27'),
        ('Class 9', 'A', '2026-27'),
        ('Class 10', 'A', '2026-27')
      `);
      console.log('✅ Default classes initialized (Class 1 to 10).');
    }

    // 7. Auto-seed demo data once on initial deployment
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS system_settings (setting_key VARCHAR(50) PRIMARY KEY, setting_val VARCHAR(255))`);
      const [[initSetting]] = await pool.query(`SELECT setting_val FROM system_settings WHERE setting_key = 'demo_initialized'`);
      if (!initSetting) {
        const { generateDemoData } = require('../utils/demoData');
        await generateDemoData(1);
        await pool.query(`INSERT INTO system_settings (setting_key, setting_val) VALUES ('demo_initialized', 'true') ON DUPLICATE KEY UPDATE setting_val = 'true'`);
        console.log('✅ Initial demo data auto-populated for testing.');
      }
    } catch (dErr) {
      console.log('Demo initial seed notice:', dErr.message);
    }

    console.log('✅ All database schema checks and seeding completed.');
  } catch (err) {
    console.error('ensureSchema error:', err.message);
  }
}

ensureSchema();

module.exports = pool;
