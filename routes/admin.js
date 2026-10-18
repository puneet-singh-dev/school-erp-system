const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../config/db');
const { isAdmin } = require('../middleware/auth');
const PDFDocument = require('pdfkit');
const moment = require('moment');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { generateFeeReceiptPDF } = require('../utils/receiptPdf');
const { generateClassMarksPDF } = require('../utils/marksheetPdf');
const { generateClassFeeRemindersHindiPDF } = require('../utils/feeReminderHindiPdf');
const { generateClassStudentListPDF } = require('../utils/classListPdf');

// Configure Multer for student profile photo uploads
const uploadDir = path.join(__dirname, '../public/uploads/students');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, `student-${unique}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files (JPG, PNG, WEBP) are allowed!'));
    }
  }
});

// Configure Multer for gallery uploads
const galleryUploadDir = path.join(__dirname, '../public/uploads/gallery');
if (!fs.existsSync(galleryUploadDir)) {
  fs.mkdirSync(galleryUploadDir, { recursive: true });
}

const galleryStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, galleryUploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, `gallery-${unique}${ext}`);
  }
});

const uploadGallery = multer({
  storage: galleryStorage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'));
    }
  }
});

router.use(isAdmin);

// ==================== DASHBOARD ====================
router.get('/', async (req, res) => {
  try {
    let totalStudents = 0, totalTeachers = 0, totalClasses = 0, feesCollected = 0, totalAllFees = 0;
    let attendanceData = [], feeMonthly = [], recentStudents = [], notices = [];

    // 1. Total Students
    try {
      const [[sRow]] = await db.query('SELECT COUNT(*) as totalStudents FROM students');
      totalStudents = sRow ? sRow.totalStudents : 0;
    } catch (e) { console.error('Dashboard student count error:', e.message); }

    // 2. Total Teachers
    try {
      const [[tRow]] = await db.query('SELECT COUNT(*) as totalTeachers FROM teachers');
      totalTeachers = tRow ? tRow.totalTeachers : 0;
    } catch (e) { console.error('Dashboard teacher count error:', e.message); }

    // 3. Total Classes
    try {
      const [[cRow]] = await db.query('SELECT COUNT(*) as totalClasses FROM classes');
      totalClasses = cRow ? cRow.totalClasses : 0;
    } catch (e) { console.error('Dashboard class count error:', e.message); }

    // 4. Fees collected this month
    try {
      const [[fRow]] = await db.query('SELECT COALESCE(SUM(amount_paid),0) as feesCollected FROM fee_payments WHERE MONTH(payment_date)=MONTH(CURDATE()) AND YEAR(payment_date)=YEAR(CURDATE())');
      feesCollected = fRow ? fRow.feesCollected : 0;
    } catch (e) { console.error('Dashboard fee this month error:', e.message); }

    // 5. Total all-time fee collections
    try {
      const [[afRow]] = await db.query('SELECT COALESCE(SUM(amount_paid),0) as totalAllFees FROM fee_payments');
      totalAllFees = afRow ? afRow.totalAllFees : 0;
    } catch (e) { console.error('Dashboard all fees error:', e.message); }

    // 6. Attendance summary this month
    try {
      const [att] = await db.query(`
        SELECT status, COUNT(*) as count FROM attendance
        WHERE MONTH(date)=MONTH(CURDATE()) AND YEAR(date)=YEAR(CURDATE())
        GROUP BY status
      `);
      attendanceData = att || [];
    } catch (e) { console.error('Dashboard attendance error:', e.message); }

    // 7. Fee collection last 6 months (Always populates all 6 months so chart is never blank)
    try {
      const [feeM] = await db.query(`
        SELECT DATE_FORMAT(MIN(payment_date),'%b %Y') as month,
               YEAR(payment_date) as yr,
               MONTH(payment_date) as mo,
               COALESCE(SUM(amount_paid), 0) as total
        FROM fee_payments 
        WHERE payment_date >= DATE_SUB(CURDATE(), INTERVAL 6 MONTH)
        GROUP BY YEAR(payment_date), MONTH(payment_date) 
        ORDER BY YEAR(payment_date) ASC, MONTH(payment_date) ASC
      `);

      const feeMap = {};
      (feeM || []).forEach(f => {
        feeMap[`${f.yr}-${f.mo}`] = parseFloat(f.total) || 0;
      });

      const months = [];
      const now = new Date();
      for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const yr = d.getFullYear();
        const mo = d.getMonth() + 1;
        const monthLabel = d.toLocaleString('en-US', { month: 'short' }) + ' ' + yr;
        const total = feeMap[`${yr}-${mo}`] || 0;
        months.push({ month: monthLabel, total });
      }
      feeMonthly = months;
    } catch (e) {
      console.error('Dashboard fee monthly error:', e.message);
      const now = new Date();
      feeMonthly = [];
      for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        feeMonthly.push({
          month: d.toLocaleString('en-US', { month: 'short' }) + ' ' + d.getFullYear(),
          total: 0
        });
      }
    }

    // 8. Recent students
    try {
      const [rStudents] = await db.query(`
        SELECT u.name, u.email, s.admission_no, c.name as class_name, s.admission_date
        FROM students s JOIN users u ON s.user_id=u.id LEFT JOIN classes c ON s.class_id=c.id
        ORDER BY s.id DESC LIMIT 5
      `);
      recentStudents = rStudents || [];
    } catch (e) { console.error('Dashboard recent students error:', e.message); }

    // 9. Recent notices
    try {
      const [nList] = await db.query('SELECT * FROM notices ORDER BY created_at DESC LIMIT 3');
      notices = nList || [];
    } catch (e) { console.error('Dashboard notices error:', e.message); }

    res.render('admin/dashboard', {
      title: 'Admin Dashboard',
      totalStudents, totalTeachers, totalClasses, feesCollected, totalAllFees,
      attendanceData, feeMonthly, recentStudents, notices
    });
  } catch (err) {
    console.error('Dashboard fatal error:', err.message);
    res.render('admin/dashboard', {
      title: 'Admin Dashboard',
      totalStudents: 0, totalTeachers: 0, totalClasses: 0, feesCollected: 0, totalAllFees: 0,
      attendanceData: [], feeMonthly: [], recentStudents: [], notices: []
    });
  }
});

// ==================== API: AUTO-ID PREVIEW ====================
router.get('/api/next-ids', async (req, res) => {
  try {
    const year = new Date().getFullYear().toString().slice(-2);
    const [[{ lastStudId }]] = await db.query('SELECT COALESCE(MAX(id),0) as lastStudId FROM students');
    const [[{ lastTeachId }]] = await db.query('SELECT COALESCE(MAX(id),0) as lastTeachId FROM teachers');
    const admission_no = `ADM${year}${String(lastStudId + 1).padStart(4, '0')}`;
    const employee_id = `EMP${year}${String(lastTeachId + 1).padStart(4, '0')}`;
    let roll_number = 1;
    const class_id = parseInt(req.query.class_id) || null;
    if (class_id) {
      const [[{ maxRoll }]] = await db.query('SELECT COALESCE(MAX(roll_number),0) as maxRoll FROM students WHERE class_id=?', [class_id]);
      roll_number = maxRoll + 1;
    }
    res.json({ admission_no, employee_id, roll_number });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== STUDENTS ====================
router.get('/students', async (req, res) => {
  const search = req.query.search || '';
  const classFilter = req.query.class_id || '';
  try {
    let query = `SELECT s.*, u.name, u.email, u.phone, u.profile_photo, u.is_active, c.name as class_name, c.section
      FROM students s JOIN users u ON s.user_id=u.id LEFT JOIN classes c ON s.class_id=c.id
      WHERE 1=1`;
    const params = [];
    if (search) { query += ` AND (u.name LIKE ? OR s.admission_no LIKE ? OR u.email LIKE ?)`; params.push(`%${search}%`, `%${search}%`, `%${search}%`); }
    if (classFilter) { query += ` AND s.class_id=?`; params.push(classFilter); }
    query += ` ORDER BY s.id DESC`;
    const [students] = await db.query(query, params);
    const [classes] = await db.query('SELECT * FROM classes ORDER BY name, section');
    res.render('admin/students', { title: 'Students', students, classes, search, classFilter });
  } catch (err) {
    console.error(err); req.flash('error_msg', 'Error loading students'); res.redirect('/admin');
  }
});

router.get('/students/add', async (req, res) => {
  const [classes] = await db.query('SELECT * FROM classes ORDER BY name, section');
  res.render('admin/student-form', { title: 'Add Student', student: null, classes });
});

router.post('/students/add', upload.single('profile_photo'), async (req, res) => {
  let {
    name, email, phone, password, address, admission_no, class_id, roll_number,
    date_of_birth, gender, father_name, mother_name, guardian_name, guardian_phone,
    emergency_contact, blood_group, category, aadhaar_no, admission_date,
    previous_balance, previous_balance_remarks,
    uses_transport, transport_route, transport_fee
  } = req.body;

  try {
    // Auto-generate admission_no if blank
    if (!admission_no || admission_no.trim() === '') {
      const [[{ lastId }]] = await db.query('SELECT COALESCE(MAX(id),0) as lastId FROM students');
      const year = new Date().getFullYear().toString().slice(-2);
      admission_no = `ADM${year}${String(lastId + 1).padStart(4, '0')}`;
    }
    // Auto-generate roll_number if blank
    if ((!roll_number || roll_number.toString().trim() === '') && class_id) {
      const [[{ maxRoll }]] = await db.query('SELECT COALESCE(MAX(roll_number),0) as maxRoll FROM students WHERE class_id=?', [class_id]);
      roll_number = maxRoll + 1;
    }

    // Auto-generate placeholder email if blank
    if (!email || email.trim() === '') {
      email = `${admission_no.toLowerCase()}@school.erp`;
    }

    const profilePhoto = req.file ? req.file.filename : 'default.png';
    const studentDefaultPassword = (password && password.trim()) || (phone && phone.trim()) || (emergency_contact && emergency_contact.trim()) || 'student123';
    const hashed = await bcrypt.hash(studentDefaultPassword, 10);
    const [userResult] = await db.query(
      'INSERT INTO users (name,email,password,role,phone,address,profile_photo) VALUES (?,?,?,?,?,?,?)',
      [name, email, hashed, 'student', phone || null, address || null, profilePhoto]
    );

    const cleanUsesTransport = (uses_transport === '1' || uses_transport === 1 || uses_transport === true) ? 1 : 0;
    const cleanTransportRoute = cleanUsesTransport ? ((transport_route && transport_route.trim()) || null) : null;
    const cleanTransportFee = cleanUsesTransport ? (Math.max(0, parseFloat(transport_fee) || 0)) : 0.00;

    await db.query(
      `INSERT INTO students 
       (user_id, admission_no, class_id, roll_number, date_of_birth, gender, 
        father_name, mother_name, guardian_name, guardian_phone, emergency_contact, 
        blood_group, category, aadhaar_no, admission_date, previous_balance, previous_balance_remarks,
        uses_transport, transport_route, transport_fee) 
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        userResult.insertId, admission_no, class_id || null, roll_number || null,
        date_of_birth || null, gender || null,
        father_name || guardian_name || null, mother_name || null,
        guardian_name || father_name || null, guardian_phone || null, emergency_contact || null,
        blood_group || null, category || null, aadhaar_no || null,
        admission_date || new Date().toISOString().split('T')[0],
        Math.max(0, parseFloat(previous_balance) || 0),
        (previous_balance_remarks && previous_balance_remarks.trim()) || null,
        cleanUsesTransport, cleanTransportRoute, cleanTransportFee
      ]
    );

    req.flash('success_msg', `Student added! Admission No: ${admission_no}, Roll No: ${roll_number || 'N/A'}`);
    res.redirect('/admin/students');
  } catch (err) {
    console.error(err);
    req.flash('error_msg', 'Error adding student: ' + err.message);
    res.redirect('/admin/students/add');
  }
});

router.get('/students/edit/:id', async (req, res) => {
  try {
    const [rows] = await db.query(`SELECT s.*, u.name, u.email, u.phone, u.address, u.profile_photo FROM students s JOIN users u ON s.user_id=u.id WHERE s.id=?`, [req.params.id]);
    const [classes] = await db.query('SELECT * FROM classes ORDER BY name, section');
    if (!rows.length) { req.flash('error_msg', 'Student not found'); return res.redirect('/admin/students'); }
    res.render('admin/student-form', { title: 'Edit Student', student: rows[0], classes });
  } catch (err) { console.error(err); res.redirect('/admin/students'); }
});

router.post('/students/edit/:id', upload.single('profile_photo'), async (req, res) => {
  const {
    name, email, phone, address, class_id, roll_number, date_of_birth, gender,
    father_name, mother_name, guardian_name, guardian_phone, emergency_contact,
    blood_group, category, aadhaar_no, previous_balance, previous_balance_remarks,
    uses_transport, transport_route, transport_fee
  } = req.body;

  try {
    const [students] = await db.query('SELECT user_id FROM students WHERE id=?', [req.params.id]);
    if (!students.length) {
      req.flash('error_msg', 'Student not found');
      return res.redirect('/admin/students');
    }

    const userId = students[0].user_id;
    if (req.file) {
      await db.query('UPDATE users SET name=?,email=?,phone=?,address=?,profile_photo=? WHERE id=?',
        [name, email, phone, address, req.file.filename, userId]);
    } else {
      await db.query('UPDATE users SET name=?,email=?,phone=?,address=? WHERE id=?',
        [name, email, phone, address, userId]);
    }

    const cleanUsesTransport = (uses_transport === '1' || uses_transport === 1 || uses_transport === true) ? 1 : 0;
    const cleanTransportRoute = cleanUsesTransport ? ((transport_route && transport_route.trim()) || null) : null;
    const cleanTransportFee = cleanUsesTransport ? (Math.max(0, parseFloat(transport_fee) || 0)) : 0.00;

    await db.query(
      `UPDATE students SET 
        class_id=?, roll_number=?, date_of_birth=?, gender=?, 
        father_name=?, mother_name=?, guardian_name=?, guardian_phone=?, 
        emergency_contact=?, blood_group=?, category=?, aadhaar_no=?,
        previous_balance=?, previous_balance_remarks=?,
        uses_transport=?, transport_route=?, transport_fee=?
       WHERE id=?`,
      [
        class_id || null, roll_number || null, date_of_birth || null, gender || null,
        father_name || guardian_name || null, mother_name || null,
        guardian_name || father_name || null, guardian_phone || null,
        emergency_contact || null, blood_group || null, category || null, aadhaar_no || null,
        Math.max(0, parseFloat(previous_balance) || 0),
        (previous_balance_remarks && previous_balance_remarks.trim()) || null,
        cleanUsesTransport, cleanTransportRoute, cleanTransportFee,
        req.params.id
      ]
    );

    req.flash('success_msg', 'Student updated successfully');
    res.redirect('/admin/students');
  } catch (err) {
    console.error(err);
    req.flash('error_msg', 'Error updating student: ' + err.message);
    res.redirect('/admin/students');
  }
});

router.post('/students/delete/:id', async (req, res) => {
  try {
    const [students] = await db.query('SELECT user_id FROM students WHERE id=?', [req.params.id]);
    if (students.length) await db.query('DELETE FROM users WHERE id=?', [students[0].user_id]);
    req.flash('success_msg', 'Student deleted');
    res.redirect('/admin/students');
  } catch (err) { console.error(err); req.flash('error_msg', 'Error deleting student'); res.redirect('/admin/students'); }
});

// ==================== TEACHERS ====================
router.get('/teachers', async (req, res) => {
  const [teachers] = await db.query(`SELECT t.*, u.name, u.email, u.phone, u.is_active FROM teachers t JOIN users u ON t.user_id=u.id ORDER BY t.id DESC`);
  res.render('admin/teachers', { title: 'Teachers', teachers });
});

router.get('/teachers/add', (req, res) => {
  res.render('admin/teacher-form', { title: 'Add Teacher', teacher: null });
});

router.post('/teachers/add', async (req, res) => {
  let { name, email, phone, password, address, employee_id, department, designation, date_of_joining, qualification, salary } = req.body;
  try {
    // Auto-generate employee_id if blank
    if (!employee_id || employee_id.trim() === '') {
      const [[{ lastId }]] = await db.query('SELECT COALESCE(MAX(id),0) as lastId FROM teachers');
      const year = new Date().getFullYear().toString().slice(-2);
      employee_id = `EMP${year}${String(lastId + 1).padStart(4, '0')}`;
    }
    const hashed = await bcrypt.hash(password || 'teacher123', 10);
    const [userResult] = await db.query('INSERT INTO users (name,email,password,role,phone,address) VALUES (?,?,?,?,?,?)',
      [name, email, hashed, 'teacher', phone, address]);
    await db.query('INSERT INTO teachers (user_id,employee_id,department,designation,date_of_joining,qualification,salary) VALUES (?,?,?,?,?,?,?)',
      [userResult.insertId, employee_id, department, designation, date_of_joining || null, qualification, salary || 0]);
    req.flash('success_msg', `Teacher added! Employee ID: ${employee_id}`);
    res.redirect('/admin/teachers');
  } catch (err) { console.error(err); req.flash('error_msg', 'Error: ' + err.message); res.redirect('/admin/teachers/add'); }
});

router.get('/teachers/edit/:id', async (req, res) => {
  const [rows] = await db.query(`SELECT t.*, u.name, u.email, u.phone, u.address FROM teachers t JOIN users u ON t.user_id=u.id WHERE t.id=?`, [req.params.id]);
  if (!rows.length) { req.flash('error_msg', 'Teacher not found'); return res.redirect('/admin/teachers'); }
  res.render('admin/teacher-form', { title: 'Edit Teacher', teacher: rows[0] });
});

router.post('/teachers/edit/:id', async (req, res) => {
  const { name, email, phone, address, department, designation, qualification, salary } = req.body;
  try {
    const [teachers] = await db.query('SELECT user_id FROM teachers WHERE id=?', [req.params.id]);
    await db.query('UPDATE users SET name=?,email=?,phone=?,address=? WHERE id=?', [name, email, phone, address, teachers[0].user_id]);
    await db.query('UPDATE teachers SET department=?,designation=?,qualification=?,salary=? WHERE id=?', [department, designation, qualification, salary, req.params.id]);
    req.flash('success_msg', 'Teacher updated');
    res.redirect('/admin/teachers');
  } catch (err) { console.error(err); req.flash('error_msg', 'Error'); res.redirect('/admin/teachers'); }
});

router.post('/teachers/delete/:id', async (req, res) => {
  try {
    const [teachers] = await db.query('SELECT user_id FROM teachers WHERE id=?', [req.params.id]);
    if (teachers.length) await db.query('DELETE FROM users WHERE id=?', [teachers[0].user_id]);
    req.flash('success_msg', 'Teacher deleted');
    res.redirect('/admin/teachers');
  } catch (err) { console.error(err); req.flash('error_msg', 'Error'); res.redirect('/admin/teachers'); }
});

// ==================== CLASSES ====================
router.get('/classes', async (req, res) => {
  try {
    const [classes] = await db.query(`
      SELECT c.*, u.name as teacher_name, 
             (SELECT COUNT(*) FROM students s WHERE s.class_id = c.id) as student_count
      FROM classes c 
      LEFT JOIN users u ON c.teacher_id = u.id 
      ORDER BY c.name, c.section
    `);
    const [teachers] = await db.query("SELECT u.id, u.name FROM users u WHERE u.role='teacher' ORDER BY u.name");
    res.render('admin/classes', { title: 'Classes', classes, teachers });
  } catch (err) {
    console.error('Classes error:', err);
    req.flash('error_msg', 'Error loading classes: ' + err.message);
    res.render('admin/classes', { title: 'Classes', classes: [], teachers: [] });
  }
});

router.post('/classes/add', async (req, res) => {
  const { name, section, teacher_id, academic_year } = req.body;
  try {
    await db.query('INSERT INTO classes (name,section,teacher_id,academic_year) VALUES (?,?,?,?)', [name, section, teacher_id || null, academic_year]);
    req.flash('success_msg', 'Class added');
    res.redirect('/admin/classes');
  } catch (err) { req.flash('error_msg', 'Error: ' + err.message); res.redirect('/admin/classes'); }
});

router.post('/classes/delete/:id', async (req, res) => {
  await db.query('DELETE FROM classes WHERE id=?', [req.params.id]);
  req.flash('success_msg', 'Class deleted');
  res.redirect('/admin/classes');
});

router.post('/classes/assign-teacher/:id', async (req, res) => {
  const { teacher_id } = req.body;
  const validTeacherId = teacher_id && parseInt(teacher_id) ? parseInt(teacher_id) : null;
  try {
    await db.query('UPDATE classes SET teacher_id = ? WHERE id = ?', [validTeacherId, req.params.id]);
    req.flash('success_msg', 'Class teacher assigned successfully!');
  } catch (err) {
    console.error('Assign teacher error:', err);
    req.flash('error_msg', 'Failed to assign class teacher: ' + err.message);
  }
  res.redirect('/admin/classes');
});

// Class Student List / Roll Sheet
router.get('/classes/student-list', async (req, res) => {
  try {
    const [classes] = await db.query(`
      SELECT c.*, u.name as teacher_name,
             (SELECT COUNT(*) FROM students s WHERE s.class_id = c.id) as student_count
      FROM classes c
      LEFT JOIN users u ON c.teacher_id = u.id
      ORDER BY c.name, c.section
    `);

    let selectedClass = null;
    let students = [];

    const classId = req.query.class_id ? parseInt(req.query.class_id) : (classes.length ? classes[0].id : null);

    if (classId) {
      selectedClass = classes.find(c => c.id === classId) || null;
      if (selectedClass) {
        const [studs] = await db.query(`
          SELECT s.*, u.name, u.email, u.phone, u.profile_photo, u.is_active,
                 c.name as class_name, c.section as class_section
          FROM students s
          JOIN users u ON s.user_id = u.id
          LEFT JOIN classes c ON s.class_id = c.id
          WHERE s.class_id = ?
          ORDER BY (s.roll_number IS NULL), s.roll_number ASC, u.name ASC
        `, [classId]);
        students = studs || [];
      }
    }

    res.render('admin/class-student-list', {
      title: 'Class Student List',
      classes,
      selectedClass,
      students
    });
  } catch (err) {
    console.error('Class student list error:', err);
    req.flash('error_msg', 'Error loading class student list: ' + err.message);
    res.redirect('/admin/classes');
  }
});

// Class Student List Downloadable Official PDF
router.get('/classes/student-list-pdf/:classId', async (req, res) => {
  try {
    const classId = parseInt(req.params.classId);
    const [classRows] = await db.query(`
      SELECT c.*, u.name as teacher_name
      FROM classes c
      LEFT JOIN users u ON c.teacher_id = u.id
      WHERE c.id = ?
    `, [classId]);

    if (!classRows.length) {
      req.flash('error_msg', 'Class not found');
      return res.redirect('/admin/classes/student-list');
    }

    const selectedClass = classRows[0];
    const [students] = await db.query(`
      SELECT s.*, u.name, u.email, u.phone, u.profile_photo
      FROM students s
      JOIN users u ON s.user_id = u.id
      WHERE s.class_id = ?
      ORDER BY (s.roll_number IS NULL), s.roll_number ASC, u.name ASC
    `, [classId]);

    generateClassStudentListPDF(res, selectedClass, students);
  } catch (err) {
    console.error('Error generating class student list PDF:', err);
    res.status(500).send('Error generating student list PDF: ' + err.message);
  }
});

// ==================== SUBJECTS ====================
router.get('/subjects', async (req, res) => {
  const [subjects] = await db.query(`SELECT sub.*, c.name as class_name, c.section, u.name as teacher_name
    FROM subjects sub LEFT JOIN classes c ON sub.class_id=c.id LEFT JOIN users u ON sub.teacher_id=u.id ORDER BY c.name, sub.name`);
  const [classes] = await db.query('SELECT * FROM classes ORDER BY name, section');
  const [teachers] = await db.query("SELECT id, name FROM users WHERE role='teacher' ORDER BY name");
  res.render('admin/subjects', { title: 'Subjects', subjects, classes, teachers });
});

router.post('/subjects/add', async (req, res) => {
  const { name, code, class_id, teacher_id, max_marks } = req.body;
  await db.query('INSERT INTO subjects (name,code,class_id,teacher_id,max_marks) VALUES (?,?,?,?,?)', [name, code, class_id, teacher_id || null, max_marks || 100]);
  req.flash('success_msg', 'Subject added');
  res.redirect('/admin/subjects');
});

router.post('/subjects/delete/:id', async (req, res) => {
  await db.query('DELETE FROM subjects WHERE id=?', [req.params.id]);
  req.flash('success_msg', 'Subject deleted');
  res.redirect('/admin/subjects');
});

// ==================== ATTENDANCE ====================
router.get('/attendance', async (req, res) => {
  const [classes] = await db.query('SELECT * FROM classes ORDER BY name, section');
  const { class_id, date } = req.query;
  let students = [], attendanceMap = {}, selectedDate = date || new Date().toISOString().split('T')[0];
  if (class_id) {
    [students] = await db.query(`SELECT s.id, u.name, s.roll_number, s.admission_no FROM students s JOIN users u ON s.user_id=u.id WHERE s.class_id=? ORDER BY s.roll_number`, [class_id]);
    const [attendance] = await db.query('SELECT student_id, status FROM attendance WHERE class_id=? AND date=?', [class_id, selectedDate]);
    attendance.forEach(a => attendanceMap[a.student_id] = a.status);
  }
  res.render('admin/attendance', { title: 'Attendance', classes, students, class_id, selectedDate, attendanceMap });
});

router.post('/attendance/save', async (req, res) => {
  const { class_id, date, statuses } = req.body;
  const cleanClassId = parseInt(class_id, 10);
  const cleanDate = date ? moment(date).format('YYYY-MM-DD') : moment().format('YYYY-MM-DD');

  if (!cleanClassId || isNaN(cleanClassId)) {
    req.flash('error_msg', 'Invalid class selected.');
    return res.redirect('/admin/attendance');
  }

  try {
    const [validStudents] = await db.query(
      'SELECT id, user_id FROM students WHERE class_id = ? ORDER BY roll_number, id',
      [cleanClassId]
    );

    if (!validStudents || validStudents.length === 0) {
      req.flash('error_msg', 'No students found in this class.');
      return res.redirect(`/admin/attendance?class_id=${cleanClassId}&date=${cleanDate}`);
    }

    const validStatuses = ['Present', 'Absent', 'Late', 'Leave'];
    const markedBy = req.session && req.session.user ? req.session.user.id : null;

    for (let idx = 0; idx < validStudents.length; idx++) {
      const s = validStudents[idx];
      let status = 'Present';

      if (Array.isArray(statuses)) {
        status = statuses[idx] || 'Present';
      } else if (statuses && typeof statuses === 'object') {
        status = statuses[`s_${s.id}`] ||
                 statuses[s.id] ||
                 statuses[`student_${s.id}`] ||
                 statuses[`s_${s.user_id}`] ||
                 statuses[s.user_id] ||
                 'Present';
      }

      if (!validStatuses.includes(status)) {
        status = 'Present';
      }

      await db.query(`INSERT INTO attendance (student_id,class_id,date,status,marked_by) VALUES (?,?,?,?,?)
        ON DUPLICATE KEY UPDATE status=?, marked_by=?`,
        [s.id, cleanClassId, cleanDate, status, markedBy, status, markedBy]);
    }

    req.flash('success_msg', 'Attendance saved successfully!');
    res.redirect(`/admin/attendance?class_id=${cleanClassId}&date=${cleanDate}`);
  } catch (err) {
    console.error('Error saving attendance:', err);
    req.flash('error_msg', 'Error saving attendance: ' + err.message);
    res.redirect(`/admin/attendance?class_id=${cleanClassId || ''}&date=${cleanDate}`);
  }
});

router.get('/attendance/report', async (req, res) => {
  try {
    const [classes] = await db.query('SELECT * FROM classes ORDER BY name, section');
    const { class_id, month, year } = req.query;
    let report = [], selectedClass = null;
    if (class_id && month && year) {
      [report] = await db.query(`
        SELECT u.name, s.admission_no, s.roll_number,
          SUM(CASE WHEN a.status='Present' THEN 1 ELSE 0 END) as present,
          SUM(CASE WHEN a.status='Absent' THEN 1 ELSE 0 END) as absent,
          SUM(CASE WHEN a.status='Late' THEN 1 ELSE 0 END) as late,
          COUNT(a.id) as total_days
        FROM students s JOIN users u ON s.user_id=u.id
        LEFT JOIN attendance a ON s.id=a.student_id AND MONTH(a.date)=? AND YEAR(a.date)=?
        WHERE s.class_id=? 
        GROUP BY s.id, u.name, s.admission_no, s.roll_number 
        ORDER BY s.roll_number`, [month, year, class_id]);
      [[selectedClass]] = await db.query('SELECT *, name as class_name FROM classes WHERE id=?', [class_id]);
    }
    res.render('admin/attendance-report', { title: 'Attendance Report', classes, report, class_id, month: month || new Date().getMonth()+1, year: year || new Date().getFullYear(), selectedClass });
  } catch (err) {
    console.error('Attendance report error:', err);
    req.flash('error_msg', 'Error loading report: ' + err.message);
    res.render('admin/attendance-report', { title: 'Attendance Report', classes: [], report: [], class_id: null, month: new Date().getMonth()+1, year: new Date().getFullYear(), selectedClass: null });
  }
});

// ==================== FEES ====================
router.get('/fees', async (req, res) => {
  const [classes] = await db.query('SELECT * FROM classes ORDER BY name, section');
  const [feeStructures] = await db.query(`SELECT fs.*, c.name as class_name, c.section FROM fee_structure fs JOIN classes c ON fs.class_id=c.id ORDER BY c.name, fs.fee_type`);
  res.render('admin/fees', { title: 'Fee Management', classes, feeStructures });
});

router.post('/fees/structure/add', async (req, res) => {
  const { class_id, fee_type, amount, due_date, academic_year } = req.body;
  await db.query('INSERT INTO fee_structure (class_id,fee_type,amount,due_date,academic_year) VALUES (?,?,?,?,?)', [class_id, fee_type, amount, due_date || null, academic_year]);
  req.flash('success_msg', 'Fee structure added');
  res.redirect('/admin/fees');
});

router.post('/fees/structure/delete/:id', async (req, res) => {
  await db.query('DELETE FROM fee_structure WHERE id=?', [req.params.id]);
  req.flash('success_msg', 'Fee structure deleted');
  res.redirect('/admin/fees');
});

router.get('/fees/collect', async (req, res) => {
  const [classes] = await db.query('SELECT * FROM classes ORDER BY name, section');
  // Parse as integers — empty string becomes NaN, preventing broken SQL queries
  const class_id = parseInt(req.query.class_id) || null;
  const student_id = parseInt(req.query.student_id) || null;
  const new_receipt_id = parseInt(req.query.new_receipt_id) || null;
  let students = [], feeStructures = [], payments = [], selectedStudent = null;
  if (class_id) {
    [students] = await db.query(`SELECT s.id, u.name, s.admission_no, s.roll_number FROM students s JOIN users u ON s.user_id=u.id WHERE s.class_id=? ORDER BY s.roll_number, u.name`, [class_id]);
    [feeStructures] = await db.query('SELECT * FROM fee_structure WHERE class_id=? ORDER BY fee_type', [class_id]);
  }
  if (student_id) {
    [payments] = await db.query(`SELECT fp.*, fs.fee_type, fs.amount as total_amount FROM fee_payments fp LEFT JOIN fee_structure fs ON fp.fee_structure_id=fs.id WHERE fp.student_id=? ORDER BY fp.payment_date DESC, fp.id DESC`, [student_id]);
    [[selectedStudent]] = await db.query(`SELECT s.*, u.name, u.phone, c.name as class_name, c.section, c.academic_year FROM students s JOIN users u ON s.user_id=u.id LEFT JOIN classes c ON s.class_id=c.id WHERE s.id=?`, [student_id]);
  }
  res.render('admin/fee-collect', { title: 'Collect Fees', classes, students, feeStructures, payments, class_id, student_id, selectedStudent, new_receipt_id });
});

router.post('/fees/collect', async (req, res) => {
  const { 
    student_id, 
    class_id, 
    fee_structure_id, 
    months_paid, 
    primary_fee_name, 
    primary_fee_amount,
    component_name, 
    component_amount, 
    amount_paid, 
    payment_mode, 
    payment_date,
    remarks 
  } = req.body;

  try {
    const receiptNo = 'RCP' + Date.now();
    
    // Build breakdown array
    const breakdown = [];
    const pAmt = parseFloat(primary_fee_amount) || 0;
    if (pAmt > 0) {
      const pName = (primary_fee_name && primary_fee_name.trim()) ? primary_fee_name.trim() : 'Tuition Fee';
      breakdown.push({
        name: months_paid ? `${pName} (${months_paid})` : pName,
        amount: pAmt
      });
    }

    // Additional components (Admission Fee, ID card, Annual, Diary, Development, Exam, etc.)
    const rawCompNames = req.body['component_name[]'] || req.body.component_name || [];
    const rawCompAmts = req.body['component_amount[]'] || req.body.component_amount || [];
    const compNames = Array.isArray(rawCompNames) ? rawCompNames : (rawCompNames ? [rawCompNames] : []);
    const compAmts = Array.isArray(rawCompAmts) ? rawCompAmts : (rawCompAmts ? [rawCompAmts] : []);

    for (let i = 0; i < compNames.length; i++) {
      const cName = (compNames[i] || '').trim();
      const cAmt = parseFloat(compAmts[i]) || 0;
      if (cName && cAmt > 0) {
        breakdown.push({ name: cName, amount: cAmt });
      }
    }

    // Determine total amount paid
    let totalPaid = parseFloat(amount_paid);
    const breakdownSum = breakdown.reduce((sum, item) => sum + item.amount, 0);
    if (isNaN(totalPaid) || totalPaid <= 0) {
      totalPaid = breakdownSum;
    }

    // If breakdown was empty but totalPaid was specified
    if (breakdown.length === 0 && totalPaid > 0) {
      breakdown.push({
        name: months_paid ? `Fee (${months_paid})` : 'Fee Payment',
        amount: totalPaid
      });
    }

    const breakdownJson = JSON.stringify(breakdown);
    const payDate = payment_date || new Date().toISOString().slice(0, 10);
    const validFeeStructureId = parseInt(fee_structure_id) || null;

    const [result] = await db.query(
      `INSERT INTO fee_payments 
       (student_id, fee_structure_id, amount_paid, payment_mode, receipt_no, remarks, collected_by, payment_date, months_paid, breakdown_json) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        student_id,
        validFeeStructureId,
        totalPaid,
        payment_mode || 'Cash',
        receiptNo,
        remarks || null,
        req.session.user.id,
        payDate,
        months_paid || null,
        breakdownJson
      ]
    );

    // If any amount was paid towards Previous Balance, deduct from student's remaining previous balance
    let prevBalancePaid = 0;
    for (const item of breakdown) {
      if (item.name && item.name.toLowerCase().includes('previous balance')) {
        prevBalancePaid += parseFloat(item.amount) || 0;
      }
    }
    if (prevBalancePaid > 0) {
      await db.query(
        'UPDATE students SET previous_balance = GREATEST(0, COALESCE(previous_balance, 0) - ?) WHERE id = ?',
        [prevBalancePaid, student_id]
      );
    }

    req.flash('success_msg', `Fee collected successfully! Receipt No: ${receiptNo}`);
    res.redirect(`/admin/fees/collect?class_id=${class_id}&student_id=${student_id}&new_receipt_id=${result.insertId}`);
  } catch (err) {
    console.error('Fee collection error:', err);
    req.flash('error_msg', 'Error collecting fee: ' + err.message);
    res.redirect(`/admin/fees/collect?class_id=${class_id}&student_id=${student_id}`);
  }
});

// Update Student Previous Balance Directly from Fee Collect Page
router.post('/fees/student-balance/:studentId', async (req, res) => {
  const { previous_balance, previous_balance_remarks, class_id } = req.body;
  const cleanBal = Math.max(0, parseFloat(previous_balance) || 0);
  const cleanRem = (previous_balance_remarks || '').trim() || null;
  try {
    await db.query(
      'UPDATE students SET previous_balance=?, previous_balance_remarks=? WHERE id=?',
      [cleanBal, cleanRem, req.params.studentId]
    );
    req.flash('success_msg', 'Previous class balance updated successfully!');
  } catch (err) {
    console.error('Error updating previous balance:', err);
    req.flash('error_msg', 'Error updating previous balance: ' + err.message);
  }
  res.redirect(`/admin/fees/collect?class_id=${class_id || ''}&student_id=${req.params.studentId}`);
});

// Configure / Update School Transport Facility for a student
router.post('/fees/student-transport/:studentId', async (req, res) => {
  const { uses_transport, transport_route, transport_fee, class_id } = req.body;
  const cleanUsesTransport = (uses_transport === '1' || uses_transport === 1 || uses_transport === true) ? 1 : 0;
  const cleanTransportRoute = cleanUsesTransport ? ((transport_route && transport_route.trim()) || null) : null;
  const cleanTransportFee = cleanUsesTransport ? Math.max(0, parseFloat(transport_fee) || 0) : 0.00;
  try {
    await db.query(
      'UPDATE students SET uses_transport=?, transport_route=?, transport_fee=? WHERE id=?',
      [cleanUsesTransport, cleanTransportRoute, cleanTransportFee, req.params.studentId]
    );
    req.flash('success_msg', 'Transport / Van facility updated successfully!');
  } catch (err) {
    console.error('Error updating transport details:', err);
    req.flash('error_msg', 'Error updating transport details: ' + err.message);
  }
  res.redirect(`/admin/fees/collect?class_id=${class_id || ''}&student_id=${req.params.studentId}`);
});

// Fee Receipt PDF
// Fee Receipt PDF (A4 split: Left=Student Copy, Right=College Copy, Half=Next Student)
router.get('/fees/receipt/:id', async (req, res) => {
  try {
    const query = `
      SELECT fp.*, fs.fee_type, fs.amount as total_amount, 
             u.name as student_name, s.admission_no, s.mother_name, s.father_name, s.guardian_name,
             c.name as class_name, c.section, c.academic_year,
             admin_u.name as collector_name,
             (SELECT COALESCE(SUM(amount_paid),0) FROM fee_payments WHERE student_id=fp.student_id AND (fee_structure_id=fp.fee_structure_id OR fp.fee_structure_id IS NULL)) as cumulative_paid
      FROM fee_payments fp 
      LEFT JOIN fee_structure fs ON fp.fee_structure_id=fs.id 
      JOIN students s ON fp.student_id=s.id 
      JOIN users u ON s.user_id=u.id 
      LEFT JOIN classes c ON s.class_id=c.id 
      LEFT JOIN users admin_u ON fp.collected_by=admin_u.id 
      WHERE fp.id=?`;

    const [rows] = await db.query(query, [req.params.id]);
    if (!rows.length) return res.status(404).send('Receipt not found');
    const p1 = rows[0];

    let p2 = null;
    if (req.query.second_id) {
      const [secondRows] = await db.query(query, [req.query.second_id]);
      if (secondRows.length) p2 = secondRows[0];
    }

    generateFeeReceiptPDF(res, p1, p2);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error generating receipt: ' + err.message);
  }
});

// Fee Reminder Notice PDF
router.get('/fees/reminder/:studentId', async (req, res) => {
  try {
    const [students] = await db.query(`SELECT s.*, u.name as student_name, u.email, u.phone, c.name as class_name, c.section, u.address
      FROM students s JOIN users u ON s.user_id=u.id LEFT JOIN classes c ON s.class_id=c.id WHERE s.id=?`, [req.params.studentId]);
    if (!students.length) return res.status(404).send('Student not found');
    const student = students[0];

    const [classFeeStructure] = await db.query('SELECT * FROM fee_structure WHERE class_id=?', [student.class_id]);

    const [[feeSummary]] = await db.query(`
      SELECT COALESCE(SUM(amount), 0) as total_fees
      FROM fee_structure 
      WHERE class_id=?`, [student.class_id]);

    const [[paidSummary]] = await db.query(`
      SELECT COALESCE(SUM(amount_paid), 0) as paid
      FROM fee_payments 
      WHERE student_id=?`, [student.id]);

    const prevBal = parseFloat(student.previous_balance || 0);
    const currFees = feeSummary ? parseFloat(feeSummary.total_fees || 0) : 0;
    const paidFees = paidSummary ? parseFloat(paidSummary.paid || 0) : 0;

    student.total_fees = currFees + prevBal;
    student.paid = paidFees;
    student.balance = Math.max(0, student.total_fees - student.paid);

    const selectedClass = { name: student.class_name, section: student.section, id: student.class_id };
    generateClassFeeRemindersHindiPDF(res, selectedClass, [student], classFeeStructure);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error generating notice: ' + err.message);
  }
});

// Class-wise Fee Reminder Notices in Hindi (3 students per A4 page)
router.get('/fees/reminder-class/:classId', async (req, res) => {
  try {
    const classId = parseInt(req.params.classId, 10);
    const [[selectedClass]] = await db.query('SELECT * FROM classes WHERE id=?', [classId]);
    if (!selectedClass) return res.status(404).send('Class not found');

    const [classFeeStructure] = await db.query('SELECT * FROM fee_structure WHERE class_id=?', [classId]);

    const [studentsWithPending] = await db.query(`
      SELECT 
        s.id as student_id, 
        u.name, 
        s.admission_no, 
        s.roll_number, 
        c.name as class_name, 
        c.section,
        COALESCE(s.previous_balance, 0) as previous_balance,
        s.previous_balance_remarks,
        COALESCE(fee_totals.total_fees, 0) as total_fees,
        COALESCE(paid_totals.paid, 0) as paid,
        (COALESCE(fee_totals.total_fees, 0) + COALESCE(s.previous_balance, 0) - COALESCE(paid_totals.paid, 0)) as balance
      FROM students s 
      JOIN users u ON s.user_id=u.id 
      LEFT JOIN classes c ON s.class_id=c.id
      LEFT JOIN (
        SELECT class_id, SUM(amount) as total_fees
        FROM fee_structure
        GROUP BY class_id
      ) fee_totals ON fee_totals.class_id = s.class_id
      LEFT JOIN (
        SELECT student_id, SUM(amount_paid) as paid
        FROM fee_payments
        GROUP BY student_id
      ) paid_totals ON paid_totals.student_id = s.id
      WHERE s.class_id=? 
      HAVING balance > 0 
      ORDER BY s.roll_number, u.name`, [classId]);

    if (!studentsWithPending.length) {
      return res.send(`
        <script>
          alert('No students with pending fees in this class!');
          window.close();
        </script>
      `);
    }

    generateClassFeeRemindersHindiPDF(res, selectedClass, studentsWithPending, classFeeStructure);
  } catch (err) {
    console.error('Error generating class fee reminders:', err);
    res.status(500).send('Error generating class fee reminders: ' + err.message);
  }
});

// Pending Fees List
router.get('/fees/pending', async (req, res) => {
  const [classes] = await db.query('SELECT * FROM classes ORDER BY name, section');
  const { class_id } = req.query;
  let pendingFees = [];
  if (class_id) {
    [pendingFees] = await db.query(`
      SELECT 
        s.id as student_id, 
        u.name, 
        s.admission_no, 
        c.name as class_name, 
        c.section,
        COALESCE(s.previous_balance, 0) as previous_balance,
        s.previous_balance_remarks,
        COALESCE(fee_totals.total_fees, 0) as total_fees,
        COALESCE(paid_totals.paid, 0) as paid,
        (COALESCE(fee_totals.total_fees, 0) + COALESCE(s.previous_balance, 0) - COALESCE(paid_totals.paid, 0)) as balance
      FROM students s 
      JOIN users u ON s.user_id=u.id 
      LEFT JOIN classes c ON s.class_id=c.id
      LEFT JOIN (
        SELECT class_id, SUM(amount) as total_fees
        FROM fee_structure
        GROUP BY class_id
      ) fee_totals ON fee_totals.class_id = s.class_id
      LEFT JOIN (
        SELECT student_id, SUM(amount_paid) as paid
        FROM fee_payments
        GROUP BY student_id
      ) paid_totals ON paid_totals.student_id = s.id
      WHERE s.class_id=? 
      HAVING balance > 0 
      ORDER BY balance DESC`, [class_id]);
  }
  res.render('admin/fee-pending', { title: 'Pending Fees', classes, pendingFees, class_id });
});

// Fee Payment History Ledger
router.get('/fees/history', async (req, res) => {
  try {
    const { class_id, from_date, to_date, search } = req.query;
    const [classes] = await db.query('SELECT * FROM classes ORDER BY name, section');

    let query = `
      SELECT fp.*, 
             s.admission_no, s.roll_number,
             u.name as student_name, u.phone as student_phone,
             c.name as class_name, c.section as class_section,
             collector.name as collector_name
      FROM fee_payments fp
      JOIN students s ON fp.student_id = s.id
      JOIN users u ON s.user_id = u.id
      LEFT JOIN classes c ON s.class_id = c.id
      LEFT JOIN users collector ON fp.collected_by = collector.id
      WHERE 1=1
    `;
    const params = [];

    if (class_id) {
      query += ` AND s.class_id = ?`;
      params.push(class_id);
    }
    if (from_date) {
      query += ` AND fp.payment_date >= ?`;
      params.push(from_date);
    }
    if (to_date) {
      query += ` AND fp.payment_date <= ?`;
      params.push(to_date);
    }
    if (search && search.trim()) {
      query += ` AND (u.name LIKE ? OR s.admission_no LIKE ? OR fp.receipt_no LIKE ? OR fp.remarks LIKE ?)`;
      const term = `%${search.trim()}%`;
      params.push(term, term, term, term);
    }

    query += ` ORDER BY fp.payment_date DESC, fp.id DESC`;

    const [payments] = await db.query(query, params);

    // Compute summary metrics based on the filtered payments
    let filteredTotal = 0;
    let cashTotal = 0;
    let todayTotal = 0;
    const todayStr = new Date().toISOString().slice(0, 10);

    payments.forEach(p => {
      const amt = parseFloat(p.amount_paid) || 0;
      filteredTotal += amt;
      if ((p.payment_mode || '').toLowerCase() === 'cash') {
        cashTotal += amt;
      }
      const pDateStr = p.payment_date ? (p.payment_date instanceof Date ? p.payment_date.toISOString().slice(0, 10) : String(p.payment_date).slice(0, 10)) : '';
      if (pDateStr === todayStr) {
        todayTotal += amt;
      }
    });

    res.render('admin/fee-history', {
      title: 'Fee Payment History',
      classes,
      payments,
      class_id: class_id || '',
      from_date: from_date || '',
      to_date: to_date || '',
      search: search || '',
      summary: {
        filteredTotal,
        cashTotal,
        todayTotal
      }
    });
  } catch (err) {
    console.error('Fee history error:', err);
    req.flash('error_msg', 'Error loading fee payment history: ' + err.message);
    res.redirect('/admin/fees');
  }
});

// ==================== RESULTS ====================
router.get('/results', async (req, res) => {
  const [classes] = await db.query('SELECT * FROM classes ORDER BY name, section');
  const [exams] = await db.query('SELECT e.*, c.name as class_name FROM exams e JOIN classes c ON e.class_id=c.id ORDER BY e.exam_date DESC');
  res.render('admin/results', { title: 'Results', classes, exams });
});

router.post('/exams/add', async (req, res) => {
  const { name, class_id, exam_date, academic_year } = req.body;
  await db.query('INSERT INTO exams (name,class_id,exam_date,academic_year) VALUES (?,?,?,?)', [name, class_id, exam_date || null, academic_year]);
  req.flash('success_msg', 'Exam added');
  res.redirect('/admin/results');
});

router.get('/results/enter/:examId', async (req, res) => {
  const [exams] = await db.query('SELECT e.*, c.name as class_name, c.id as class_id FROM exams e JOIN classes c ON e.class_id=c.id WHERE e.id=?', [req.params.examId]);
  if (!exams.length) { req.flash('error_msg', 'Exam not found'); return res.redirect('/admin/results'); }
  const exam = exams[0];
  const [students] = await db.query(`SELECT s.id, u.name, s.roll_number, s.admission_no FROM students s JOIN users u ON s.user_id=u.id WHERE s.class_id=? ORDER BY s.roll_number`, [exam.class_id]);
  const [subjects] = await db.query('SELECT * FROM subjects WHERE class_id=? ORDER BY name', [exam.class_id]);
  const [existingResults] = await db.query('SELECT * FROM results WHERE exam_id=?', [req.params.examId]);
  const resultsMap = {};
  existingResults.forEach(r => { resultsMap[`${r.student_id}_${r.subject_id}`] = r; });
  res.render('admin/result-entry', { title: 'Enter Results', exam, students, subjects, resultsMap });
});

router.post('/results/save/:examId', async (req, res) => {
  const { marks } = req.body;
  try {
    if (marks && typeof marks === 'object') {
      for (const [key, marksVal] of Object.entries(marks)) {
        const [studentId, subjectId] = key.split('_');
        const [subjects] = await db.query('SELECT max_marks FROM subjects WHERE id=?', [subjectId]);
        const maxMarks = subjects[0]?.max_marks || 100;
        const pct = (marksVal / maxMarks) * 100;
        const grade = pct >= 90 ? 'A+' : pct >= 80 ? 'A' : pct >= 70 ? 'B' : pct >= 60 ? 'C' : pct >= 50 ? 'D' : 'F';
        await db.query(`INSERT INTO results (student_id,exam_id,subject_id,marks_obtained,max_marks,grade,entered_by) VALUES (?,?,?,?,?,?,?)
          ON DUPLICATE KEY UPDATE marks_obtained=?,grade=?,entered_by=?`,
          [studentId, req.params.examId, subjectId, marksVal, maxMarks, grade, req.session.user.id, marksVal, grade, req.session.user.id]);
      }
    }
    req.flash('success_msg', 'Results saved');
    res.redirect(`/admin/results/enter/${req.params.examId}`);
  } catch (err) { console.error(err); req.flash('error_msg', 'Error saving results'); res.redirect('/admin/results'); }
});

// Report Card PDF
router.get('/results/report-card/:studentId/:examId', async (req, res) => {
  try {
    const [students] = await db.query(`SELECT s.*, u.name as student_name, u.email, c.name as class_name, c.section, c.academic_year FROM students s JOIN users u ON s.user_id=u.id LEFT JOIN classes c ON s.class_id=c.id WHERE s.id=?`, [req.params.studentId]);
    if (!students.length) return res.status(404).send('Student not found');
    const student = students[0];
    const [exams] = await db.query('SELECT * FROM exams WHERE id=?', [req.params.examId]);
    if (!exams.length) return res.status(404).send('Exam not found');
    const exam = exams[0];
    const [results] = await db.query(`SELECT r.*, sub.name as subject_name, sub.max_marks FROM results r JOIN subjects sub ON r.subject_id=sub.id WHERE r.student_id=? AND r.exam_id=? ORDER BY sub.name`, [req.params.studentId, req.params.examId]);

    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename=report_card_${student.admission_no}.pdf`);
    doc.pipe(res);

    // Header Box with School Logo & Branding
    const logoPath = path.join(__dirname, '../public/img/logo.png');
    doc.rect(40, 36, 515, 88).fill('#1a365d').stroke();
    
    if (fs.existsSync(logoPath)) {
      try {
        doc.image(logoPath, 52, 44, { width: 70, height: 70 });
      } catch (err) {}
    }

    const headerTextX = 130;
    const headerTextW = 415;
    const schoolName = process.env.SCHOOL_NAME || 'Shri Amrit Lal Smarak School And College';
    const schoolAddress = process.env.SCHOOL_ADDRESS || 'Vijay Nagar, Karma Bazar, Prayagraj (U.P) - Mob: 9129914501';

    doc.fillColor('white').fontSize(15).font('Helvetica-Bold')
       .text(schoolName.toUpperCase(), headerTextX, 48, { width: headerTextW, align: 'center' });
    doc.fontSize(8.5).font('Helvetica')
       .text(schoolAddress, headerTextX, 70, { width: headerTextW, align: 'center' });
    doc.fontSize(11).font('Helvetica-Bold').fillColor('#f6e05e')
       .text('PROGRESS REPORT CARD (SESSION 2026-27)', headerTextX, 86, { width: headerTextW, align: 'center' });
    
    doc.fillColor('black');

    doc.fontSize(12).font('Helvetica-Bold').text('STUDENT ACADEMIC PROFILE', 40, 136);
    doc.moveTo(40, 152).lineTo(555, 152).stroke();

    doc.fontSize(10).font('Helvetica');
    const y1 = 158;
    doc.font('Helvetica-Bold').text('Name:', 40, y1).font('Helvetica').text(student.student_name, 90, y1);
    doc.font('Helvetica-Bold').text('Class:', 300, y1).font('Helvetica').text(`${student.class_name} - ${student.section}`, 340, y1);
    doc.font('Helvetica-Bold').text('Adm. No:', 40, y1 + 18).font('Helvetica').text(student.admission_no, 95, y1 + 18);
    doc.font('Helvetica-Bold').text('Roll No:', 300, y1 + 18).font('Helvetica').text(student.roll_number || '-', 345, y1 + 18);
    doc.font('Helvetica-Bold').text('Exam:', 40, y1 + 36).font('Helvetica').text(exam.name, 80, y1 + 36);
    doc.font('Helvetica-Bold').text('Session:', 300, y1 + 36).font('Helvetica').text(student.academic_year || '2026-27', 350, y1 + 36);

    const tableY = y1 + 65;
    doc.rect(40, tableY, 515, 22).fill('#1a5276').stroke();
    doc.fillColor('white').font('Helvetica-Bold').fontSize(10);
    doc.text('Subject', 50, tableY + 6);
    doc.text('Max Marks', 230, tableY + 6);
    doc.text('Marks Obtained', 310, tableY + 6);
    doc.text('Grade', 450, tableY + 6);
    doc.text('Remarks', 490, tableY + 6);
    doc.fillColor('black');

    let rowY = tableY + 22;
    let totalObtained = 0, totalMax = 0;
    results.forEach((r, i) => {
      if (i % 2 === 0) doc.rect(40, rowY, 515, 20).fill('#eaf4fb').stroke();
      doc.font('Helvetica').fontSize(10).fillColor('black');
      doc.text(r.subject_name, 50, rowY + 5);
      doc.text(String(r.max_marks), 248, rowY + 5);
      doc.text(String(parseFloat(r.marks_obtained).toFixed(1)), 345, rowY + 5);
      doc.text(r.grade || '-', 458, rowY + 5);
      doc.text(r.remarks || '', 490, rowY + 5);
      totalObtained += parseFloat(r.marks_obtained);
      totalMax += r.max_marks;
      rowY += 20;
    });

    doc.rect(40, rowY, 515, 24).fill('#1a5276').stroke();
    doc.fillColor('white').font('Helvetica-Bold').fontSize(11);
    doc.text('TOTAL', 50, rowY + 6);
    doc.text(String(totalMax), 248, rowY + 6);
    doc.text(String(totalObtained.toFixed(1)), 345, rowY + 6);
    const pct = totalMax > 0 ? (totalObtained / totalMax * 100).toFixed(1) : 0;
    doc.text(`${pct}%`, 430, rowY + 6);
    const finalGrade = pct >= 90 ? 'A+' : pct >= 80 ? 'A' : pct >= 70 ? 'B' : pct >= 60 ? 'C' : pct >= 50 ? 'D' : 'F';
    const status = pct >= 33 ? 'PASS' : 'FAIL';
    doc.fillColor('black');

    rowY += 35;
    doc.fontSize(12).font('Helvetica-Bold').text(`Overall Grade: ${finalGrade}`, 40, rowY);
    doc.text(`Result: ${status}`, 300, rowY, { color: status === 'PASS' ? 'green' : 'red' });

    doc.moveDown(3).moveTo(40, doc.y).lineTo(555, doc.y).stroke().moveDown();
    doc.fontSize(10).font('Helvetica').text("Principal's Signature", 40, doc.y);
    doc.text("Class Teacher's Signature", 200, doc.y - 14);
    doc.text("Parent's Signature", 430, doc.y - 14);
    doc.moveDown(2).fontSize(9).fillColor('gray').text('This is a computer generated report card.', { align: 'center' });
    doc.end();
  } catch (err) { console.error(err); res.status(500).send('Error generating report card'); }
});

// ==================== CLASS-WISE & SUBJECT-WISE MARKS STATEMENT ====================
router.get('/results/class-marks', async (req, res) => {
  try {
    const [classes] = await db.query('SELECT * FROM classes ORDER BY name, section');
    const classId = parseInt(req.query.class_id, 10) || (classes.length > 0 ? classes[0].id : null);
    
    let exams = [];
    let selectedClass = null;
    let selectedExam = null;
    let students = [];
    let subjects = [];
    const marksMap = {};

    if (classId) {
      [[selectedClass]] = await db.query('SELECT * FROM classes WHERE id=?', [classId]);
      [exams] = await db.query('SELECT * FROM exams WHERE class_id=? ORDER BY id DESC', [classId]);
      const examId = parseInt(req.query.exam_id, 10) || (exams.length > 0 ? exams[0].id : null);

      if (examId) {
        [[selectedExam]] = await db.query('SELECT * FROM exams WHERE id=?', [examId]);
        [students] = await db.query(`
          SELECT s.id, u.name, s.roll_number, s.admission_no 
          FROM students s 
          JOIN users u ON s.user_id=u.id 
          WHERE s.class_id=? 
          ORDER BY s.roll_number, u.name`, [classId]);
        
        [subjects] = await db.query('SELECT * FROM subjects WHERE class_id=? ORDER BY name', [classId]);
        const [results] = await db.query('SELECT * FROM results WHERE exam_id=?', [examId]);
        results.forEach(r => {
          marksMap[`${r.student_id}_${r.subject_id}`] = r;
        });
      }
    }

    res.render('admin/class-marks', {
      title: 'Class & Subject-Wise Marks Statement',
      classes,
      selectedClass,
      exams,
      selectedExam,
      students,
      subjects,
      marksMap
    });
  } catch (err) {
    console.error('Error loading class marks:', err);
    req.flash('error_msg', 'Error loading marks statement: ' + err.message);
    res.redirect('/admin/results');
  }
});

router.get('/results/class-marks/pdf', async (req, res) => {
  try {
    const classId = parseInt(req.query.class_id, 10);
    const examId = parseInt(req.query.exam_id, 10);
    if (!classId || !examId) return res.status(400).send('Class ID and Exam ID are required');

    const [[selectedClass]] = await db.query('SELECT * FROM classes WHERE id=?', [classId]);
    const [[selectedExam]] = await db.query('SELECT * FROM exams WHERE id=?', [examId]);
    if (!selectedClass || !selectedExam) return res.status(404).send('Class or Exam not found');

    const [students] = await db.query(`
      SELECT s.id, u.name, s.roll_number, s.admission_no 
      FROM students s 
      JOIN users u ON s.user_id=u.id 
      WHERE s.class_id=? 
      ORDER BY s.roll_number, u.name`, [classId]);

    const [subjects] = await db.query('SELECT * FROM subjects WHERE class_id=? ORDER BY name', [classId]);
    const [results] = await db.query('SELECT * FROM results WHERE exam_id=?', [examId]);
    const marksMap = {};
    results.forEach(r => {
      marksMap[`${r.student_id}_${r.subject_id}`] = r;
    });

    generateClassMarksPDF(res, selectedClass, selectedExam, students, subjects, marksMap);
  } catch (err) {
    console.error('Error generating marksheet PDF:', err);
    res.status(500).send('Error generating marksheet PDF: ' + err.message);
  }
});

// ==================== NOTICES ====================
router.get('/notices', async (req, res) => {
  const [notices] = await db.query('SELECT n.*, u.name as created_by_name FROM notices n LEFT JOIN users u ON n.created_by=u.id ORDER BY n.created_at DESC');
  res.render('admin/notices', { title: 'Notices', notices });
});

router.post('/notices/add', async (req, res) => {
  const { title, content, target_role } = req.body;
  await db.query('INSERT INTO notices (title,content,target_role,created_by) VALUES (?,?,?,?)', [title, content, target_role, req.session.user.id]);
  req.flash('success_msg', 'Notice published');
  res.redirect('/admin/notices');
});

router.post('/notices/delete/:id', async (req, res) => {
  await db.query('DELETE FROM notices WHERE id=?', [req.params.id]);
  req.flash('success_msg', 'Notice deleted');
  res.redirect('/admin/notices');
});

// ==================== GALLERY ====================
router.get('/gallery', async (req, res) => {
  try {
    const category = req.query.category || '';
    let query = `SELECT g.*, u.name as uploaded_by_name FROM gallery g LEFT JOIN users u ON g.uploaded_by=u.id`;
    const params = [];
    if (category) {
      query += ` WHERE g.category=?`;
      params.push(category);
    }
    query += ` ORDER BY g.created_at DESC`;
    const [images] = await db.query(query, params);
    const [categories] = await db.query(`SELECT DISTINCT category FROM gallery WHERE category IS NOT NULL AND category != ''`);

    res.render('admin/gallery', {
      title: 'School Photo Gallery',
      images,
      categories: categories.map(c => c.category),
      selectedCategory: category
    });
  } catch (err) {
    console.error('Gallery error:', err);
    req.flash('error_msg', 'Error loading gallery: ' + err.message);
    res.redirect('/admin');
  }
});

router.post('/gallery/upload', uploadGallery.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      req.flash('error_msg', 'Please select an image file to upload.');
      return res.redirect('/admin/gallery');
    }
    const { title, description, category } = req.body;
    const finalCategory = (category && category.trim()) ? category.trim() : 'General';
    await db.query(
      `INSERT INTO gallery (title, description, category, image_path, uploaded_by) VALUES (?, ?, ?, ?, ?)`,
      [title || 'Campus Photo', description || '', finalCategory, req.file.filename, req.session.user.id]
    );
    req.flash('success_msg', 'Photo uploaded to school gallery successfully!');
    res.redirect('/admin/gallery');
  } catch (err) {
    console.error('Upload error:', err);
    req.flash('error_msg', 'Error uploading image: ' + err.message);
    res.redirect('/admin/gallery');
  }
});

router.post('/gallery/delete/:id', async (req, res) => {
  try {
    const [[img]] = await db.query('SELECT * FROM gallery WHERE id=?', [req.params.id]);
    if (img) {
      const filePath = path.join(galleryUploadDir, img.image_path);
      if (fs.existsSync(filePath)) {
        try { fs.unlinkSync(filePath); } catch (e) {}
      }
      await db.query('DELETE FROM gallery WHERE id=?', [req.params.id]);
      req.flash('success_msg', 'Photo deleted from gallery.');
    }
    res.redirect('/admin/gallery');
  } catch (err) {
    console.error('Delete error:', err);
    req.flash('error_msg', 'Error deleting photo: ' + err.message);
    res.redirect('/admin/gallery');
  }
});

// ==================== LEAVE APPLICATIONS ====================
router.get('/leaves', async (req, res) => {
  try {
    const status = req.query.status || '';
    let query = `
      SELECT la.*, u.name as student_name, s.admission_no, s.roll_number, c.name as class_name, c.section,
             reviewer.name as reviewed_by_name
      FROM leave_applications la
      JOIN students s ON la.student_id=s.id
      JOIN users u ON s.user_id=u.id
      LEFT JOIN classes c ON s.class_id=c.id
      LEFT JOIN users reviewer ON la.reviewed_by=reviewer.id
    `;
    const params = [];
    if (status) {
      query += ` WHERE la.status=?`;
      params.push(status);
    }
    query += ` ORDER BY la.created_at DESC`;
    const [leaves] = await db.query(query, params);

    res.render('admin/leaves', {
      title: 'Student Leave Applications',
      leaves,
      selectedStatus: status
    });
  } catch (err) {
    console.error('Leaves error:', err);
    req.flash('error_msg', 'Error loading leaves: ' + err.message);
    res.redirect('/admin');
  }
});

router.post('/leaves/:id/approve', async (req, res) => {
  try {
    const remarks = req.body.admin_remarks || 'Approved by Administration';
    await db.query(
      `UPDATE leave_applications SET status='Approved', reviewed_by=?, admin_remarks=? WHERE id=?`,
      [req.session.user.id, remarks, req.params.id]
    );
    req.flash('success_msg', 'Leave application approved.');
    res.redirect('/admin/leaves');
  } catch (err) {
    req.flash('error_msg', 'Error updating leave: ' + err.message);
    res.redirect('/admin/leaves');
  }
});

router.post('/leaves/:id/reject', async (req, res) => {
  try {
    const remarks = req.body.admin_remarks || 'Rejected by Administration';
    await db.query(
      `UPDATE leave_applications SET status='Rejected', reviewed_by=?, admin_remarks=? WHERE id=?`,
      [req.session.user.id, remarks, req.params.id]
    );
    req.flash('success_msg', 'Leave application rejected.');
    res.redirect('/admin/leaves');
  } catch (err) {
    req.flash('error_msg', 'Error updating leave: ' + err.message);
    res.redirect('/admin/leaves');
  }
});

// ==================== CONTACT UPDATE REQUESTS ====================
router.get('/contact-requests', async (req, res) => {
  try {
    const [requests] = await db.query(`
      SELECT cr.*, u.name as student_name, u.phone as current_phone, u.address as current_address,
             s.emergency_contact as current_emergency, s.admission_no, c.name as class_name, c.section,
             rev.name as reviewer_name
      FROM contact_requests cr
      JOIN students s ON cr.student_id=s.id
      JOIN users u ON s.user_id=u.id
      LEFT JOIN classes c ON s.class_id=c.id
      LEFT JOIN users rev ON cr.reviewed_by=rev.id
      ORDER BY cr.created_at DESC
    `);
    res.render('admin/contact-requests', {
      title: 'Student Contact Update Requests',
      requests
    });
  } catch (err) {
    console.error('Contact requests error:', err);
    req.flash('error_msg', 'Error loading requests: ' + err.message);
    res.redirect('/admin');
  }
});

router.post('/contact-requests/:id/approve', async (req, res) => {
  try {
    const [[cr]] = await db.query('SELECT * FROM contact_requests WHERE id=?', [req.params.id]);
    if (!cr) {
      req.flash('error_msg', 'Request not found');
      return res.redirect('/admin/contact-requests');
    }

    const [[student]] = await db.query('SELECT user_id FROM students WHERE id=?', [cr.student_id]);
    if (student) {
      // Update users phone/address
      if (cr.new_phone) {
        await db.query('UPDATE users SET phone=? WHERE id=?', [cr.new_phone, student.user_id]);
      }
      if (cr.new_address) {
        await db.query('UPDATE users SET address=? WHERE id=?', [cr.new_address, student.user_id]);
      }
      if (cr.new_emergency_contact) {
        await db.query('UPDATE students SET emergency_contact=? WHERE id=?', [cr.new_emergency_contact, cr.student_id]);
      }
    }

    await db.query(
      `UPDATE contact_requests SET status='Approved', reviewed_by=?, admin_notes=? WHERE id=?`,
      [req.session.user.id, req.body.admin_notes || 'Approved and contact information updated.', req.params.id]
    );

    req.flash('success_msg', 'Contact information update approved and applied!');
    res.redirect('/admin/contact-requests');
  } catch (err) {
    console.error(err);
    req.flash('error_msg', 'Error approving request: ' + err.message);
    res.redirect('/admin/contact-requests');
  }
});

router.post('/contact-requests/:id/reject', async (req, res) => {
  try {
    await db.query(
      `UPDATE contact_requests SET status='Rejected', reviewed_by=?, admin_notes=? WHERE id=?`,
      [req.session.user.id, req.body.admin_notes || 'Rejected by administration.', req.params.id]
    );
    req.flash('success_msg', 'Contact information request rejected.');
    res.redirect('/admin/contact-requests');
  } catch (err) {
    req.flash('error_msg', 'Error rejecting request: ' + err.message);
    res.redirect('/admin/contact-requests');
  }
});

// ==================== HOMEWORK MANAGEMENT ====================
router.get('/homework', async (req, res) => {
  try {
    const classId = parseInt(req.query.class_id, 10) || null;
    let query = `
      SELECT h.*, c.name as class_name, c.section, sub.name as subject_name, u.name as teacher_name
      FROM homework h
      JOIN classes c ON h.class_id=c.id
      LEFT JOIN subjects sub ON h.subject_id=sub.id
      LEFT JOIN users u ON h.assigned_by=u.id
    `;
    const params = [];
    if (classId) {
      query += ` WHERE h.class_id=?`;
      params.push(classId);
    }
    query += ` ORDER BY h.due_date DESC, h.created_at DESC`;
    const [homeworkList] = await db.query(query, params);
    const [classes] = await db.query('SELECT * FROM classes ORDER BY name, section');
    const [subjects] = await db.query('SELECT * FROM subjects ORDER BY name');

    res.render('admin/homework', {
      title: 'Homework & Assignments',
      homeworkList,
      classes,
      subjects,
      classId
    });
  } catch (err) {
    console.error('Homework error:', err);
    req.flash('error_msg', 'Error loading homework: ' + err.message);
    res.redirect('/admin');
  }
});

router.post('/homework/add', async (req, res) => {
  try {
    const { class_id, subject_id, title, description, assigned_date, due_date } = req.body;
    await db.query(
      `INSERT INTO homework (class_id, subject_id, title, description, assigned_date, due_date, assigned_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [class_id, subject_id || null, title, description, assigned_date || new Date().toISOString().split('T')[0], due_date, req.session.user.id]
    );
    req.flash('success_msg', 'Homework assignment posted successfully!');
    res.redirect(`/admin/homework?class_id=${class_id}`);
  } catch (err) {
    req.flash('error_msg', 'Error posting homework: ' + err.message);
    res.redirect('/admin/homework');
  }
});

router.post('/homework/delete/:id', async (req, res) => {
  try {
    await db.query('DELETE FROM homework WHERE id=?', [req.params.id]);
    req.flash('success_msg', 'Homework assignment deleted.');
    res.redirect('/admin/homework');
  } catch (err) {
    req.flash('error_msg', 'Error deleting homework: ' + err.message);
    res.redirect('/admin/homework');
  }
});

module.exports = router;
