const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { isTeacher } = require('../middleware/auth');
const moment = require('moment');

router.use(isTeacher);

// Dashboard
router.get('/', async (req, res) => {
  try {
    const userId = req.session.user.id;
    // Classes assigned to this teacher
    const [myClasses] = await db.query('SELECT * FROM classes WHERE teacher_id=?', [userId]);
    // Subjects taught
    const [mySubjects] = await db.query(`SELECT sub.*, c.name as class_name, c.section FROM subjects sub JOIN classes c ON sub.class_id=c.id WHERE sub.teacher_id=?`, [userId]);
    // Today's attendance status
    const today = new Date().toISOString().split('T')[0];
    const [todayAttendance] = await db.query(`SELECT COUNT(*) as count FROM attendance WHERE marked_by=? AND date=?`, [userId, today]);
    // Recent notices
    const [notices] = await db.query("SELECT * FROM notices WHERE target_role IN ('all','teacher') ORDER BY created_at DESC LIMIT 5");

    res.render('teacher/dashboard', { title: 'Teacher Dashboard', myClasses, mySubjects, todayAttendance: todayAttendance[0].count, notices });
  } catch (err) { console.error(err); res.redirect('/login'); }
});

// Attendance - mark
router.get('/attendance', async (req, res) => {
  const userId = req.session.user.id;
  const [classes] = await db.query('SELECT * FROM classes WHERE teacher_id=? ORDER BY name', [userId]);
  const { class_id, date } = req.query;
  let students = [], attendanceMap = {}, selectedDate = date || new Date().toISOString().split('T')[0];
  if (class_id) {
    [students] = await db.query(`SELECT s.id, u.name, s.roll_number, s.admission_no FROM students s JOIN users u ON s.user_id=u.id WHERE s.class_id=? ORDER BY s.roll_number`, [class_id]);
    const [attendance] = await db.query('SELECT student_id, status FROM attendance WHERE class_id=? AND date=?', [class_id, selectedDate]);
    attendance.forEach(a => attendanceMap[a.student_id] = a.status);
  }
  res.render('teacher/attendance', { title: 'Mark Attendance', classes, students, class_id, selectedDate, attendanceMap });
});

router.post('/attendance/save', async (req, res) => {
  const { class_id, date, statuses } = req.body;
  const cleanClassId = parseInt(class_id, 10);
  const cleanDate = date || new Date().toISOString().split('T')[0];
  try {
    if (statuses && typeof statuses === 'object') {
      for (const [studentId, status] of Object.entries(statuses)) {
        const cleanStudentId = parseInt(studentId, 10);
        if (!isNaN(cleanStudentId)) {
          await db.query(`INSERT INTO attendance (student_id,class_id,date,status,marked_by) VALUES (?,?,?,?,?)
            ON DUPLICATE KEY UPDATE status=?, marked_by=?`,
            [cleanStudentId, cleanClassId, cleanDate, status, req.session.user.id, status, req.session.user.id]);
        }
      }
    }
    req.flash('success_msg', 'Attendance saved successfully!');
    res.redirect(`/teacher/attendance?class_id=${cleanClassId}&date=${cleanDate}`);
  } catch (err) {
    console.error('Error saving attendance:', err);
    req.flash('error_msg', 'Error saving attendance: ' + err.message);
    res.redirect(`/teacher/attendance?class_id=${cleanClassId || ''}&date=${cleanDate}`);
  }
});

// Results entry
router.get('/results', async (req, res) => {
  const userId = req.session.user.id;
  const [myClasses] = await db.query('SELECT * FROM classes WHERE teacher_id=? ORDER BY name', [userId]);
  const { class_id } = req.query;
  let exams = [];
  if (class_id) {
    [exams] = await db.query('SELECT * FROM exams WHERE class_id=? ORDER BY exam_date DESC', [class_id]);
  }
  res.render('teacher/results', { title: 'Results', myClasses, exams, class_id });
});

router.get('/results/enter/:examId', async (req, res) => {
  const [exams] = await db.query('SELECT e.*, c.name as class_name, c.id as class_id FROM exams e JOIN classes c ON e.class_id=c.id WHERE e.id=?', [req.params.examId]);
  if (!exams.length) { req.flash('error_msg', 'Exam not found'); return res.redirect('/teacher/results'); }
  const exam = exams[0];
  const [students] = await db.query(`SELECT s.id, u.name, s.roll_number, s.admission_no FROM students s JOIN users u ON s.user_id=u.id WHERE s.class_id=? ORDER BY s.roll_number`, [exam.class_id]);
  const [subjects] = await db.query('SELECT * FROM subjects WHERE class_id=? AND teacher_id=? ORDER BY name', [exam.class_id, req.session.user.id]);
  const [existingResults] = await db.query('SELECT * FROM results WHERE exam_id=?', [req.params.examId]);
  const resultsMap = {};
  existingResults.forEach(r => { resultsMap[`${r.student_id}_${r.subject_id}`] = r; });
  res.render('teacher/result-entry', { title: 'Enter Results', exam, students, subjects, resultsMap });
});

router.post('/results/save/:examId', async (req, res) => {
  const { marks } = req.body;
  try {
    if (marks && typeof marks === 'object') {
      for (const [key, marksVal] of Object.entries(marks)) {
        const [studentId, subjectId] = key.split('_');
        const [subjectRows] = await db.query('SELECT max_marks FROM subjects WHERE id=?', [subjectId]);
        const maxMarks = subjectRows[0]?.max_marks || 100;
        const pct = (marksVal / maxMarks) * 100;
        const grade = pct >= 90 ? 'A+' : pct >= 80 ? 'A' : pct >= 70 ? 'B' : pct >= 60 ? 'C' : pct >= 50 ? 'D' : 'F';
        await db.query(`INSERT INTO results (student_id,exam_id,subject_id,marks_obtained,max_marks,grade,entered_by) VALUES (?,?,?,?,?,?,?)
          ON DUPLICATE KEY UPDATE marks_obtained=?,grade=?,entered_by=?`,
          [studentId, req.params.examId, subjectId, marksVal, maxMarks, grade, req.session.user.id, marksVal, grade, req.session.user.id]);
      }
    }
    req.flash('success_msg', 'Results saved');
    res.redirect(`/teacher/results/enter/${req.params.examId}`);
  } catch (err) { console.error(err); req.flash('error_msg', 'Error'); res.redirect('/teacher/results'); }
});

// View my students
router.get('/students', async (req, res) => {
  const userId = req.session.user.id;
  const [students] = await db.query(`SELECT s.*, u.name, u.email, u.phone, c.name as class_name, c.section FROM students s JOIN users u ON s.user_id=u.id JOIN classes c ON s.class_id=c.id WHERE c.teacher_id=? ORDER BY u.name`, [userId]);
  res.render('teacher/students', { title: 'My Students', students });
});

// Attendance report
router.get('/attendance/report', async (req, res) => {
  const userId = req.session.user.id;
  const [classes] = await db.query('SELECT * FROM classes WHERE teacher_id=?', [userId]);
  const { class_id, month, year } = req.query;
  let report = [], selectedClass = null;
  if (class_id && month && year) {
    [report] = await db.query(`
      SELECT u.name, s.admission_no, s.roll_number,
        SUM(CASE WHEN a.status='Present' THEN 1 ELSE 0 END) as present,
        SUM(CASE WHEN a.status='Absent' THEN 1 ELSE 0 END) as absent,
        COUNT(a.id) as total_days
      FROM students s JOIN users u ON s.user_id=u.id
      LEFT JOIN attendance a ON s.id=a.student_id AND MONTH(a.date)=? AND YEAR(a.date)=?
      WHERE s.class_id=? GROUP BY s.id ORDER BY s.roll_number`, [month, year, class_id]);
    [[selectedClass]] = await db.query('SELECT *, name as class_name FROM classes WHERE id=?', [class_id]);
  }
  res.render('teacher/attendance-report', { title: 'Attendance Report', classes, report, class_id, month: month || new Date().getMonth()+1, year: year || new Date().getFullYear(), selectedClass });
});

module.exports = router;
