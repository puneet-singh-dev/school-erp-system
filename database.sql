-- School ERP Database Schema
CREATE DATABASE IF NOT EXISTS school_erp;
USE school_erp;

-- Users table (admin, teacher, student)
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
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Classes
CREATE TABLE IF NOT EXISTS classes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(50) NOT NULL,
  section VARCHAR(10) NOT NULL,
  teacher_id INT,
  academic_year VARCHAR(9) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (teacher_id) REFERENCES users(id) ON DELETE SET NULL
);

-- Subjects
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
);

-- Students table (extra info)
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
  admission_date DATE DEFAULT (CURRENT_DATE),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE SET NULL
);

-- Teachers table (extra info)
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
);

-- Attendance
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
);

-- Fee structure
CREATE TABLE IF NOT EXISTS fee_structure (
  id INT AUTO_INCREMENT PRIMARY KEY,
  class_id INT NOT NULL,
  fee_type VARCHAR(100) NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  due_date DATE,
  academic_year VARCHAR(9) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE
);

-- Fee payments
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
);

-- Exams
CREATE TABLE IF NOT EXISTS exams (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  class_id INT NOT NULL,
  exam_date DATE,
  academic_year VARCHAR(9) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE
);

-- Results / Marks
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
);

-- Notices
CREATE TABLE IF NOT EXISTS notices (
  id INT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(200) NOT NULL,
  content TEXT NOT NULL,
  target_role ENUM('all','student','teacher') DEFAULT 'all',
  created_by INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

-- Timetable
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
);

-- Default admin user (password: admin123)
-- Hash generated with bcrypt.hash('admin123', 10)
INSERT IGNORE INTO users (name, email, password, role) VALUES
('Admin User', 'admin@school.com', '$2b$10$eb4cZiUN.IRI21Xf9f9w0ePVFZr5oOoqaRfU/ITzN1OWP8l3b/B/u', 'admin');
