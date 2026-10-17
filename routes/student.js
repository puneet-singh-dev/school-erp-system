const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { isAuthenticated } = require('../middleware/auth');
const PDFDocument = require('pdfkit');
const moment = require('moment');

router.use(isAuthenticated);
router.use((req, res, next) => {
  if (req.session.user.role !== 'student') return res.redirect(`/${req.session.user.role}`);
  next();
});

// Dashboard
router.get('/', async (req, res) => {
  try {
    const userId = req.session.user.id;
    const [students] = await db.query(`SELECT s.*, c.name as class_name, c.section FROM students s JOIN users u ON s.user_id=u.id LEFT JOIN classes c ON s.class_id=c.id WHERE s.user_id=?`, [userId]);
    if (!students.length) return res.render('student/dashboard', { title: 'Student Dashboard', student: null, attendance: null, fees: null, notices: [] });
    const student = students[0];

    // Attendance this month
    const [[attendance]] = await db.query(`SELECT
      SUM(CASE WHEN status='Present' THEN 1 ELSE 0 END) as present,
      SUM(CASE WHEN status='Absent' THEN 1 ELSE 0 END) as absent,
      COUNT(id) as total FROM attendance WHERE student_id=? AND MONTH(date)=MONTH(CURDATE()) AND YEAR(date)=YEAR(CURDATE())`, [student.id]);

    // Fee balance
    const [[fees]] = await db.query(`SELECT COALESCE(SUM(fs.amount),0) as total_fees, COALESCE(SUM(fp.amount_paid),0) as paid
      FROM fee_structure fs LEFT JOIN fee_payments fp ON fs.id=fp.fee_structure_id AND fp.student_id=?
      WHERE fs.class_id=?`, [student.id, student.class_id]);

    // Recent exams/results
    const [recentResults] = await db.query(`SELECT e.name as exam_name, SUM(r.marks_obtained) as total_obtained, SUM(r.max_marks) as total_max
      FROM results r JOIN exams e ON r.exam_id=e.id WHERE r.student_id=? GROUP BY r.exam_id ORDER BY e.exam_date DESC LIMIT 3`, [student.id]);

    // Notices
    const [notices] = await db.query("SELECT * FROM notices WHERE target_role IN ('all','student') ORDER BY created_at DESC LIMIT 5");

    res.render('student/dashboard', { title: 'Student Dashboard', student, attendance, fees, recentResults, notices });
  } catch (err) { console.error(err); res.redirect('/login'); }
});

// View attendance
router.get('/attendance', async (req, res) => {
  const userId = req.session.user.id;
  const { month, year } = req.query;
  const [students] = await db.query('SELECT * FROM students WHERE user_id=?', [userId]);
  if (!students.length) return res.redirect('/student');
  const student = students[0];
  const m = month || new Date().getMonth() + 1;
  const y = year || new Date().getFullYear();
  const [attendance] = await db.query('SELECT * FROM attendance WHERE student_id=? AND MONTH(date)=? AND YEAR(date)=? ORDER BY date', [student.id, m, y]);
  const [[summary]] = await db.query(`SELECT SUM(CASE WHEN status='Present' THEN 1 ELSE 0 END) as present, SUM(CASE WHEN status='Absent' THEN 1 ELSE 0 END) as absent, COUNT(*) as total FROM attendance WHERE student_id=? AND MONTH(date)=? AND YEAR(date)=?`, [student.id, m, y]);
  res.render('student/attendance', { title: 'My Attendance', attendance, summary, month: m, year: y });
});

// View results
router.get('/results', async (req, res) => {
  const userId = req.session.user.id;
  const [students] = await db.query(`SELECT s.*, c.name as class_name, c.section FROM students s LEFT JOIN classes c ON s.class_id=c.id WHERE s.user_id=?`, [userId]);
  if (!students.length) return res.redirect('/student');
  const student = students[0];
  const [exams] = await db.query(`SELECT e.*, SUM(r.marks_obtained) as obtained, SUM(r.max_marks) as max_marks FROM exams e LEFT JOIN results r ON e.id=r.exam_id AND r.student_id=? WHERE e.class_id=? GROUP BY e.id ORDER BY e.exam_date DESC`, [student.id, student.class_id]);
  res.render('student/results', { title: 'My Results', student, exams });
});

router.get('/results/:examId', async (req, res) => {
  const userId = req.session.user.id;
  const [students] = await db.query(`SELECT s.*, u.name as student_name, c.name as class_name, c.section, c.academic_year FROM students s JOIN users u ON s.user_id=u.id LEFT JOIN classes c ON s.class_id=c.id WHERE s.user_id=?`, [userId]);
  if (!students.length) return res.redirect('/student');
  const student = students[0];
  const [exams] = await db.query('SELECT * FROM exams WHERE id=?', [req.params.examId]);
  if (!exams.length) return res.redirect('/student/results');
  const exam = exams[0];
  const [results] = await db.query(`SELECT r.*, sub.name as subject_name FROM results r JOIN subjects sub ON r.subject_id=sub.id WHERE r.student_id=? AND r.exam_id=? ORDER BY sub.name`, [student.id, req.params.examId]);
  res.render('student/result-detail', { title: 'Result Detail', student, exam, results });
});

// Download report card
router.get('/results/:examId/download', async (req, res) => {
  res.redirect(`/admin/results/report-card/${(await db.query('SELECT id FROM students WHERE user_id=?', [req.session.user.id]))[0][0]?.id}/${req.params.examId}`);
});

// Fee payments
router.get('/fees', async (req, res) => {
  const userId = req.session.user.id;
  const [students] = await db.query(`SELECT s.*, c.name as class_name FROM students s LEFT JOIN classes c ON s.class_id=c.id WHERE s.user_id=?`, [userId]);
  if (!students.length) return res.redirect('/student');
  const student = students[0];
  const [feeStructures] = await db.query('SELECT * FROM fee_structure WHERE class_id=? ORDER BY fee_type', [student.class_id]);
  const [payments] = await db.query(`SELECT fp.*, fs.fee_type, fs.amount as total_amount FROM fee_payments fp JOIN fee_structure fs ON fp.fee_structure_id=fs.id WHERE fp.student_id=? ORDER BY fp.payment_date DESC`, [student.id]);
  const [[summary]] = await db.query(`SELECT COALESCE(SUM(fs.amount),0) as total_fees, COALESCE(SUM(fp.amount_paid),0) as paid FROM fee_structure fs LEFT JOIN fee_payments fp ON fs.id=fp.fee_structure_id AND fp.student_id=? WHERE fs.class_id=?`, [student.id, student.class_id]);
  res.render('student/fees', { title: 'My Fees', student, feeStructures, payments, summary });
});

// Download fee receipt
const { generateFeeReceiptPDF } = require('../utils/receiptPdf');

router.get('/fees/receipt/:paymentId', async (req, res) => {
  try {
    const [students] = await db.query('SELECT * FROM students WHERE user_id=?', [req.session.user.id]);
    if (!students.length) return res.status(404).send('Student not found');
    const student = students[0];

    const query = `
      SELECT fp.*, fs.fee_type, fs.amount as total_amount, 
             u.name as student_name, s.admission_no, s.mother_name, s.father_name, s.guardian_name,
             c.name as class_name, c.section, c.academic_year,
             admin_u.name as collector_name,
             (SELECT COALESCE(SUM(amount_paid),0) FROM fee_payments WHERE student_id=fp.student_id AND fee_structure_id=fp.fee_structure_id) as cumulative_paid
      FROM fee_payments fp 
      JOIN fee_structure fs ON fp.fee_structure_id=fs.id 
      JOIN students s ON fp.student_id=s.id 
      JOIN users u ON s.user_id=u.id 
      LEFT JOIN classes c ON s.class_id=c.id 
      LEFT JOIN users admin_u ON fp.collected_by=admin_u.id 
      WHERE fp.id=? AND fp.student_id=?`;

    const [rows] = await db.query(query, [req.params.paymentId, student.id]);
    if (!rows.length) return res.status(404).send('Receipt not found');

    generateFeeReceiptPDF(res, rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error generating receipt');
  }
});

module.exports = router;
