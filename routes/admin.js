const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../config/db');
const { isAdmin } = require('../middleware/auth');
const PDFDocument = require('pdfkit');
const moment = require('moment');

router.use(isAdmin);

// ==================== DASHBOARD ====================
router.get('/', async (req, res) => {
  try {
    const [[{ totalStudents }]] = await db.query('SELECT COUNT(*) as totalStudents FROM students');
    const [[{ totalTeachers }]] = await db.query('SELECT COUNT(*) as totalTeachers FROM teachers');
    const [[{ totalClasses }]] = await db.query('SELECT COUNT(*) as totalClasses FROM classes');
    const [[{ feesCollected }]] = await db.query('SELECT COALESCE(SUM(amount_paid),0) as feesCollected FROM fee_payments WHERE MONTH(payment_date)=MONTH(CURDATE()) AND YEAR(payment_date)=YEAR(CURDATE())');

    // Attendance summary this month
    const [attendanceData] = await db.query(`
      SELECT status, COUNT(*) as count FROM attendance
      WHERE MONTH(date)=MONTH(CURDATE()) AND YEAR(date)=YEAR(CURDATE())
      GROUP BY status
    `);

    // Fee collection last 6 months
    const [feeMonthly] = await db.query(`
      SELECT DATE_FORMAT(payment_date,'%b %Y') as month, SUM(amount_paid) as total
      FROM fee_payments WHERE payment_date >= DATE_SUB(CURDATE(), INTERVAL 6 MONTH)
      GROUP BY YEAR(payment_date), MONTH(payment_date) ORDER BY payment_date
    `);

    // Recent students
    const [recentStudents] = await db.query(`
      SELECT u.name, u.email, s.admission_no, c.name as class_name, s.admission_date
      FROM students s JOIN users u ON s.user_id=u.id LEFT JOIN classes c ON s.class_id=c.id
      ORDER BY s.id DESC LIMIT 5
    `);

    // Recent notices
    const [notices] = await db.query('SELECT * FROM notices ORDER BY created_at DESC LIMIT 3');

    res.render('admin/dashboard', {
      title: 'Admin Dashboard',
      totalStudents, totalTeachers, totalClasses, feesCollected,
      attendanceData, feeMonthly, recentStudents, notices
    });
  } catch (err) {
    console.error('Dashboard error:', err.message);
    // IMPORTANT: Do NOT redirect to /login here — causes infinite redirect loop
    res.render('admin/dashboard', {
      title: 'Admin Dashboard',
      totalStudents: 0, totalTeachers: 0, totalClasses: 0, feesCollected: 0,
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
    let query = `SELECT s.*, u.name, u.email, u.phone, u.is_active, c.name as class_name, c.section
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

router.post('/students/add', async (req, res) => {
  let { name, email, phone, password, address, admission_no, class_id, roll_number, date_of_birth, gender, guardian_name, guardian_phone, admission_date } = req.body;
  try {
    // Auto-generate admission_no if blank
    if (!admission_no || admission_no.trim() === '') {
      const [[{ lastId }]] = await db.query('SELECT COALESCE(MAX(id),0) as lastId FROM students');
      const year = new Date().getFullYear().toString().slice(-2);
      admission_no = `ADM${year}${String(lastId + 1).padStart(4, '0')}`;
    }
    // Auto-generate roll_number if blank
    if ((!roll_number || roll_number.trim() === '') && class_id) {
      const [[{ maxRoll }]] = await db.query('SELECT COALESCE(MAX(roll_number),0) as maxRoll FROM students WHERE class_id=?', [class_id]);
      roll_number = maxRoll + 1;
    }
    const hashed = await bcrypt.hash(password || 'student123', 10);
    const [userResult] = await db.query('INSERT INTO users (name,email,password,role,phone,address) VALUES (?,?,?,?,?,?)',
      [name, email, hashed, 'student', phone, address]);
    await db.query('INSERT INTO students (user_id,admission_no,class_id,roll_number,date_of_birth,gender,guardian_name,guardian_phone,admission_date) VALUES (?,?,?,?,?,?,?,?,?)',
      [userResult.insertId, admission_no, class_id || null, roll_number || null, date_of_birth || null, gender, guardian_name, guardian_phone, admission_date || new Date().toISOString().split('T')[0]]);
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
    const [rows] = await db.query(`SELECT s.*, u.name, u.email, u.phone, u.address FROM students s JOIN users u ON s.user_id=u.id WHERE s.id=?`, [req.params.id]);
    const [classes] = await db.query('SELECT * FROM classes ORDER BY name, section');
    if (!rows.length) { req.flash('error_msg', 'Student not found'); return res.redirect('/admin/students'); }
    res.render('admin/student-form', { title: 'Edit Student', student: rows[0], classes });
  } catch (err) { console.error(err); res.redirect('/admin/students'); }
});

router.post('/students/edit/:id', async (req, res) => {
  const { name, email, phone, address, class_id, roll_number, date_of_birth, gender, guardian_name, guardian_phone } = req.body;
  try {
    const [students] = await db.query('SELECT user_id FROM students WHERE id=?', [req.params.id]);
    await db.query('UPDATE users SET name=?,email=?,phone=?,address=? WHERE id=?', [name, email, phone, address, students[0].user_id]);
    await db.query('UPDATE students SET class_id=?,roll_number=?,date_of_birth=?,gender=?,guardian_name=?,guardian_phone=? WHERE id=?',
      [class_id || null, roll_number || null, date_of_birth || null, gender, guardian_name, guardian_phone, req.params.id]);
    req.flash('success_msg', 'Student updated successfully');
    res.redirect('/admin/students');
  } catch (err) { console.error(err); req.flash('error_msg', 'Error updating student'); res.redirect('/admin/students'); }
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
  const [classes] = await db.query(`SELECT c.*, u.name as teacher_name, COUNT(DISTINCT s.id) as student_count
    FROM classes c LEFT JOIN users u ON c.teacher_id=u.id LEFT JOIN students s ON c.id=s.class_id GROUP BY c.id ORDER BY c.name, c.section`);
  const [teachers] = await db.query("SELECT u.id, u.name FROM users u WHERE u.role='teacher' ORDER BY u.name");
  res.render('admin/classes', { title: 'Classes', classes, teachers });
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
  try {
    if (statuses && typeof statuses === 'object') {
      for (const [studentId, status] of Object.entries(statuses)) {
        await db.query(`INSERT INTO attendance (student_id,class_id,date,status,marked_by) VALUES (?,?,?,?,?)
          ON DUPLICATE KEY UPDATE status=?, marked_by=?`,
          [studentId, class_id, date, status, req.session.user.id, status, req.session.user.id]);
      }
    }
    req.flash('success_msg', 'Attendance saved');
    res.redirect(`/admin/attendance?class_id=${class_id}&date=${date}`);
  } catch (err) { console.error(err); req.flash('error_msg', 'Error saving attendance'); res.redirect('/admin/attendance'); }
});

router.get('/attendance/report', async (req, res) => {
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
      WHERE s.class_id=? GROUP BY s.id ORDER BY s.roll_number`, [month, year, class_id]);
    [[selectedClass]] = await db.query('SELECT *, name as class_name FROM classes WHERE id=?', [class_id]);
  }
  res.render('admin/attendance-report', { title: 'Attendance Report', classes, report, class_id, month: month || new Date().getMonth()+1, year: year || new Date().getFullYear(), selectedClass });
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
  let students = [], feeStructures = [], payments = [], selectedStudent = null;
  if (class_id) {
    [students] = await db.query(`SELECT s.id, u.name, s.admission_no, s.roll_number FROM students s JOIN users u ON s.user_id=u.id WHERE s.class_id=? ORDER BY s.roll_number, u.name`, [class_id]);
    [feeStructures] = await db.query('SELECT * FROM fee_structure WHERE class_id=? ORDER BY fee_type', [class_id]);
  }
  if (student_id) {
    [payments] = await db.query(`SELECT fp.*, fs.fee_type, fs.amount as total_amount FROM fee_payments fp JOIN fee_structure fs ON fp.fee_structure_id=fs.id WHERE fp.student_id=? ORDER BY fp.payment_date DESC`, [student_id]);
    [[selectedStudent]] = await db.query('SELECT s.*, u.name FROM students s JOIN users u ON s.user_id=u.id WHERE s.id=?', [student_id]);
  }
  res.render('admin/fee-collect', { title: 'Collect Fees', classes, students, feeStructures, payments, class_id, student_id, selectedStudent });
});

router.post('/fees/collect', async (req, res) => {
  const { student_id, fee_structure_id, amount_paid, payment_mode, remarks, class_id } = req.body;
  try {
    const receiptNo = 'RCP' + Date.now();
    await db.query('INSERT INTO fee_payments (student_id,fee_structure_id,amount_paid,payment_mode,receipt_no,remarks,collected_by,payment_date) VALUES (?,?,?,?,?,?,?,CURDATE())',
      [student_id, fee_structure_id, amount_paid, payment_mode, receiptNo, remarks, req.session.user.id]);
    req.flash('success_msg', `Fee collected. Receipt: ${receiptNo}`);
    res.redirect(`/admin/fees/collect?class_id=${class_id}&student_id=${student_id}`);
  } catch (err) { console.error(err); req.flash('error_msg', 'Error: ' + err.message); res.redirect('/admin/fees/collect'); }
});

// Fee Receipt PDF
router.get('/fees/receipt/:id', async (req, res) => {
  try {
    const [rows] = await db.query(`SELECT fp.*, fs.fee_type, fs.amount as total_amount, u.name as student_name, s.admission_no, c.name as class_name, c.section
      FROM fee_payments fp JOIN fee_structure fs ON fp.fee_structure_id=fs.id JOIN students s ON fp.student_id=s.id JOIN users u ON s.user_id=u.id LEFT JOIN classes c ON s.class_id=c.id WHERE fp.id=?`, [req.params.id]);
    if (!rows.length) return res.status(404).send('Receipt not found');
    const p = rows[0];
    const doc = new PDFDocument({ size: 'A5', margin: 40 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename=receipt_${p.receipt_no}.pdf`);
    doc.pipe(res);
    doc.fontSize(18).font('Helvetica-Bold').text('SCHOOL ERP', { align: 'center' });
    doc.fontSize(12).font('Helvetica').text('Fee Payment Receipt', { align: 'center' });
    doc.moveDown().moveTo(40, doc.y).lineTo(400, doc.y).stroke();
    doc.moveDown(0.5);
    const line = (label, val) => { doc.font('Helvetica-Bold').text(label + ': ', { continued: true }).font('Helvetica').text(val || '-'); };
    line('Receipt No', p.receipt_no);
    line('Date', moment(p.payment_date).format('DD-MM-YYYY'));
    line('Student Name', p.student_name);
    line('Admission No', p.admission_no);
    line('Class', `${p.class_name} - ${p.section}`);
    line('Fee Type', p.fee_type);
    line('Amount Paid', '₹ ' + parseFloat(p.amount_paid).toFixed(2));
    line('Payment Mode', p.payment_mode);
    if (p.remarks) line('Remarks', p.remarks);
    doc.moveDown().moveTo(40, doc.y).lineTo(400, doc.y).stroke().moveDown();
    doc.font('Helvetica-Oblique').fontSize(10).text('This is a computer generated receipt.', { align: 'center' });
    doc.end();
  } catch (err) { console.error(err); res.status(500).send('Error generating receipt'); }
});

// Fee Reminder Notice PDF
router.get('/fees/reminder/:studentId', async (req, res) => {
  try {
    const [students] = await db.query(`SELECT s.*, u.name as student_name, u.email, u.phone, c.name as class_name, c.section, u.address
      FROM students s JOIN users u ON s.user_id=u.id LEFT JOIN classes c ON s.class_id=c.id WHERE s.id=?`, [req.params.studentId]);
    if (!students.length) return res.status(404).send('Student not found');
    const student = students[0];

    const [pending] = await db.query(`
      SELECT fs.fee_type, fs.amount, fs.due_date, COALESCE(SUM(fp.amount_paid),0) as paid
      FROM fee_structure fs LEFT JOIN fee_payments fp ON fs.id=fp.fee_structure_id AND fp.student_id=?
      WHERE fs.class_id=? GROUP BY fs.id HAVING (fs.amount - COALESCE(SUM(fp.amount_paid),0)) > 0`, [req.params.studentId, student.class_id]);

    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename=reminder_${student.admission_no}.pdf`);
    doc.pipe(res);

    // Header
    doc.fontSize(22).font('Helvetica-Bold').text('SCHOOL ERP', { align: 'center' });
    doc.fontSize(11).font('Helvetica').text('Phone: 9876543210 | Email: info@school.com', { align: 'center' });
    doc.moveDown(0.5).moveTo(50, doc.y).lineTo(545, doc.y).lineWidth(2).stroke().moveDown(0.5);
    doc.fontSize(14).font('Helvetica-Bold').text('FEE REMINDER NOTICE', { align: 'center' }).moveDown();

    doc.fontSize(11).font('Helvetica');
    doc.text(`Date: ${moment().format('DD MMMM YYYY')}`, { align: 'right' });
    doc.text(`To,`);
    doc.text(`${student.guardian_name || student.student_name}`);
    doc.text(`Parent/Guardian of ${student.student_name}`);
    doc.text(`Class: ${student.class_name} - ${student.section} | Adm. No: ${student.admission_no}`);
    doc.moveDown();
    doc.text('Dear Parent/Guardian,');
    doc.moveDown(0.5);
    doc.text('This is to inform you that the following fees are due/pending for your ward. Kindly arrange to clear the outstanding amount at the earliest to avoid any inconvenience.', { align: 'justify' });
    doc.moveDown();

    // Table header
    const tableTop = doc.y;
    doc.font('Helvetica-Bold').fontSize(10);
    doc.rect(50, tableTop, 495, 20).fill('#1a5276').stroke();
    doc.fillColor('white').text('Fee Type', 55, tableTop + 5, { width: 180 });
    doc.text('Total Amount', 235, tableTop + 5, { width: 100 });
    doc.text('Amount Paid', 335, tableTop + 5, { width: 100 });
    doc.text('Balance Due', 435, tableTop + 5, { width: 105 });
    doc.fillColor('black');

    let y = tableTop + 20;
    let totalBalance = 0;
    pending.forEach((fee, i) => {
      const balance = fee.amount - fee.paid;
      totalBalance += balance;
      if (i % 2 === 0) doc.rect(50, y, 495, 20).fill('#eaf4fb').stroke();
      doc.font('Helvetica').fontSize(10).fillColor('black');
      doc.text(fee.fee_type, 55, y + 5, { width: 180 });
      doc.text('₹ ' + parseFloat(fee.amount).toFixed(2), 235, y + 5, { width: 100 });
      doc.text('₹ ' + parseFloat(fee.paid).toFixed(2), 335, y + 5, { width: 100 });
      doc.text('₹ ' + parseFloat(balance).toFixed(2), 435, y + 5, { width: 105 });
      y += 20;
    });

    doc.rect(50, y, 495, 22).fill('#1a5276').stroke();
    doc.font('Helvetica-Bold').fontSize(11).fillColor('white');
    doc.text('TOTAL PENDING', 55, y + 5);
    doc.text('₹ ' + totalBalance.toFixed(2), 435, y + 5);
    doc.fillColor('black');

    doc.moveDown(2);
    doc.font('Helvetica').fontSize(10);
    doc.text('Please visit the school office or pay online at your earliest convenience.');
    doc.moveDown();
    doc.text('Thanking You,');
    doc.moveDown(2);
    doc.font('Helvetica-Bold').text('Principal / Administrator');
    doc.font('Helvetica').text('School ERP');
    doc.moveDown().moveTo(50, doc.y).lineTo(545, doc.y).stroke();
    doc.fontSize(9).fillColor('gray').text('This is a computer generated notice.', { align: 'center' });
    doc.end();
  } catch (err) { console.error(err); res.status(500).send('Error generating notice'); }
});

// Pending Fees List
router.get('/fees/pending', async (req, res) => {
  const [classes] = await db.query('SELECT * FROM classes ORDER BY name, section');
  const { class_id } = req.query;
  let pendingFees = [];
  if (class_id) {
    [pendingFees] = await db.query(`
      SELECT s.id as student_id, u.name, s.admission_no, c.name as class_name, c.section,
        SUM(fs.amount) as total_fees, COALESCE(SUM(fp.amount_paid),0) as paid,
        SUM(fs.amount) - COALESCE(SUM(fp.amount_paid),0) as balance
      FROM students s JOIN users u ON s.user_id=u.id LEFT JOIN classes c ON s.class_id=c.id
      JOIN fee_structure fs ON fs.class_id=s.class_id
      LEFT JOIN fee_payments fp ON fp.student_id=s.id AND fp.fee_structure_id=fs.id
      WHERE s.class_id=? GROUP BY s.id HAVING balance > 0 ORDER BY balance DESC`, [class_id]);
  }
  res.render('admin/fee-pending', { title: 'Pending Fees', classes, pendingFees, class_id });
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

    // Header
    doc.rect(40, 40, 515, 80).fill('#1a5276').stroke();
    doc.fillColor('white').fontSize(22).font('Helvetica-Bold').text('SCHOOL ERP', 50, 55, { align: 'center', width: 495 });
    doc.fontSize(11).font('Helvetica').text('Progress Report Card', 50, 82, { align: 'center', width: 495 });
    doc.fillColor('black').moveDown(4);

    doc.fontSize(13).font('Helvetica-Bold').text('STUDENT INFORMATION', 40, 135);
    doc.moveTo(40, 152).lineTo(555, 152).stroke();

    doc.fontSize(10).font('Helvetica');
    const y1 = 158;
    doc.font('Helvetica-Bold').text('Name:', 40, y1).font('Helvetica').text(student.student_name, 90, y1);
    doc.font('Helvetica-Bold').text('Class:', 300, y1).font('Helvetica').text(`${student.class_name} - ${student.section}`, 340, y1);
    doc.font('Helvetica-Bold').text('Adm. No:', 40, y1 + 18).font('Helvetica').text(student.admission_no, 95, y1 + 18);
    doc.font('Helvetica-Bold').text('Roll No:', 300, y1 + 18).font('Helvetica').text(student.roll_number || '-', 345, y1 + 18);
    doc.font('Helvetica-Bold').text('Exam:', 40, y1 + 36).font('Helvetica').text(exam.name, 80, y1 + 36);
    doc.font('Helvetica-Bold').text('Year:', 300, y1 + 36).font('Helvetica').text(student.academic_year || '', 335, y1 + 36);

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

module.exports = router;
