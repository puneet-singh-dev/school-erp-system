const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { isTeacher } = require('../middleware/auth');
const moment = require('moment');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { isSubjectApplicableToStudent, generateMarksCSVTemplate, parseMarksCSV } = require('../utils/csvMarksHelper');

const tempUploadDir = path.join(__dirname, '../public/uploads/temp');
if (!fs.existsSync(tempUploadDir)) fs.mkdirSync(tempUploadDir, { recursive: true });
const tempUpload = multer({ dest: tempUploadDir });

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

  if (!cleanClassId || isNaN(cleanClassId)) {
    req.flash('error_msg', 'Invalid class selected.');
    return res.redirect('/teacher/attendance');
  }

  try {
    const [validStudents] = await db.query(
      'SELECT id, user_id FROM students WHERE class_id = ? ORDER BY roll_number, id',
      [cleanClassId]
    );

    if (!validStudents || validStudents.length === 0) {
      req.flash('error_msg', 'No students found in this class.');
      return res.redirect(`/teacher/attendance?class_id=${cleanClassId}&date=${cleanDate}`);
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
    res.redirect(`/teacher/attendance?class_id=${cleanClassId}&date=${cleanDate}`);
  } catch (err) {
    console.error('Error saving attendance:', err);
    req.flash('error_msg', 'Error saving attendance: ' + err.message);
    res.redirect(`/teacher/attendance?class_id=${cleanClassId || ''}&date=${cleanDate}`);
  }
});

const { generateReportCardPDF } = require('../utils/reportCardPdf');
const { calculateClassRanks } = require('../utils/examRankHelper');

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
  const [students] = await db.query(`SELECT s.id, u.name, s.roll_number, s.admission_no, s.optional_subject 
    FROM students s 
    JOIN users u ON s.user_id=u.id 
    WHERE s.class_id=? 
    ORDER BY (s.roll_number IS NULL OR s.roll_number = 0), s.roll_number ASC, u.name ASC`, [exam.class_id]);
  const [subjects] = await db.query(`SELECT * FROM subjects WHERE class_id=? AND (teacher_id=? OR teacher_id IS NULL OR class_id IN (SELECT id FROM classes WHERE teacher_id=?)) ORDER BY name`, [exam.class_id, req.session.user.id, req.session.user.id]);
  const [existingResults] = await db.query('SELECT * FROM results WHERE exam_id=?', [req.params.examId]);
  const resultsMap = {};
  existingResults.forEach(r => { resultsMap[`${r.student_id}_${r.subject_id}`] = r; });
  res.render('teacher/result-entry', { title: 'Enter Results', exam, students, subjects, resultsMap });
});

// CSV Template Download for Teacher
router.get('/results/template/:examId', async (req, res) => {
  try {
    const [exams] = await db.query('SELECT e.*, c.name as class_name, c.id as class_id FROM exams e JOIN classes c ON e.class_id=c.id WHERE e.id=?', [req.params.examId]);
    if (!exams.length) return res.status(404).send('Exam not found');
    const exam = exams[0];
    const [students] = await db.query(`SELECT s.id, u.name, s.roll_number, s.admission_no, s.optional_subject 
      FROM students s 
      JOIN users u ON s.user_id=u.id 
      WHERE s.class_id=? 
      ORDER BY (s.roll_number IS NULL OR s.roll_number = 0), s.roll_number ASC, u.name ASC`, [exam.class_id]);
    const [subjects] = await db.query(`SELECT * FROM subjects WHERE class_id=? AND (teacher_id=? OR teacher_id IS NULL OR class_id IN (SELECT id FROM classes WHERE teacher_id=?)) ORDER BY name`, [exam.class_id, req.session.user.id, req.session.user.id]);
    const [existingResults] = await db.query('SELECT * FROM results WHERE exam_id=?', [req.params.examId]);
    const resultsMap = {};
    existingResults.forEach(r => { resultsMap[`${r.student_id}_${r.subject_id}`] = r; });

    const csvData = generateMarksCSVTemplate(exam, students, subjects, resultsMap);
    const filename = `marks_template_${exam.class_name.replace(/\s+/g, '_')}_${exam.name.replace(/\s+/g, '_')}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csvData);
  } catch (err) {
    console.error('Error generating teacher marks template:', err);
    res.status(500).send('Error generating marks template: ' + err.message);
  }
});

// CSV Marks Bulk Upload for Teacher
router.post('/results/upload-csv/:examId', tempUpload.single('csv_file'), async (req, res) => {
  try {
    if (!req.file) {
      req.flash('error_msg', 'Please choose a CSV file to upload.');
      return res.redirect(`/teacher/results/enter/${req.params.examId}`);
    }

    const [exams] = await db.query('SELECT e.*, c.name as class_name, c.id as class_id FROM exams e JOIN classes c ON e.class_id=c.id WHERE e.id=?', [req.params.examId]);
    if (!exams.length) return res.status(404).send('Exam not found');
    const exam = exams[0];

    const [students] = await db.query(`SELECT s.id, u.name, s.roll_number, s.admission_no, s.optional_subject FROM students s JOIN users u ON s.user_id=u.id WHERE s.class_id=?`, [exam.class_id]);
    const [subjects] = await db.query('SELECT * FROM subjects WHERE class_id=?', [exam.class_id]);

    const fileContent = fs.readFileSync(req.file.path, 'utf8');
    const parsedMarks = parseMarksCSV(fileContent, students, subjects);

    let savedCount = 0;
    for (const item of parsedMarks) {
      const pct = (item.marks_obtained / item.max_marks) * 100;
      const grade = pct >= 90 ? 'A+' : pct >= 80 ? 'A' : pct >= 70 ? 'B' : pct >= 60 ? 'C' : pct >= 50 ? 'D' : (pct >= 33 ? 'E' : 'F');
      await db.query(
        `INSERT INTO results (student_id, exam_id, subject_id, marks_obtained, max_marks, grade, entered_by)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE marks_obtained=?, grade=?, entered_by=?`,
        [item.student_id, exam.id, item.subject_id, item.marks_obtained, item.max_marks, grade, req.session.user.id, item.marks_obtained, grade, req.session.user.id]
      );
      savedCount++;
    }

    try { fs.unlinkSync(req.file.path); } catch (uErr) {}

    req.flash('success_msg', `CSV Upload Successful! Imported ${savedCount} student marks.`);
    res.redirect(`/teacher/results/enter/${req.params.examId}`);
  } catch (err) {
    console.error('Error uploading CSV marks:', err);
    req.flash('error_msg', 'Error uploading CSV: ' + err.message);
    res.redirect(`/teacher/results/enter/${req.params.examId}`);
  }
});

router.post('/results/save/:examId', async (req, res) => {
  const { marks } = req.body;
  try {
    if (marks && typeof marks === 'object') {
      for (const [key, marksVal] of Object.entries(marks)) {
        if (marksVal === '' || marksVal === undefined || marksVal === null) continue;
        const [studentId, subjectId] = key.split('_');
        const [subjectRows] = await db.query('SELECT max_marks FROM subjects WHERE id=?', [subjectId]);
        const maxMarks = subjectRows[0]?.max_marks || 100;
        const numVal = parseFloat(marksVal) || 0;
        const pct = (numVal / maxMarks) * 100;
        const grade = pct >= 90 ? 'A+' : pct >= 80 ? 'A' : pct >= 70 ? 'B' : pct >= 60 ? 'C' : pct >= 50 ? 'D' : (pct >= 33 ? 'E' : 'F');
        await db.query(`INSERT INTO results (student_id,exam_id,subject_id,marks_obtained,max_marks,grade,entered_by) VALUES (?,?,?,?,?,?,?)
          ON DUPLICATE KEY UPDATE marks_obtained=?,grade=?,entered_by=?`,
          [studentId, req.params.examId, subjectId, numVal, maxMarks, grade, req.session.user.id, numVal, grade, req.session.user.id]);
      }
    }
    req.flash('success_msg', 'Results saved successfully');
    res.redirect(`/teacher/results/enter/${req.params.examId}`);
  } catch (err) { console.error(err); req.flash('error_msg', 'Error saving results: ' + err.message); res.redirect('/teacher/results'); }
});

// Teacher Report Card view/download
router.get('/results/report-card/:studentId/:examId', async (req, res) => {
  try {
    const [students] = await db.query(`SELECT s.*, u.name as student_name, u.email, c.name as class_name, c.section, c.academic_year 
      FROM students s 
      JOIN users u ON s.user_id=u.id 
      LEFT JOIN classes c ON s.class_id=c.id 
      WHERE s.id=?`, [req.params.studentId]);
    if (!students.length) return res.status(404).send('Student not found');
    const student = students[0];

    const [exams] = await db.query('SELECT * FROM exams WHERE id=?', [req.params.examId]);
    if (!exams.length) return res.status(404).send('Exam not found');
    const currentExam = exams[0];

    const [subjects] = await db.query('SELECT * FROM subjects WHERE class_id=? ORDER BY name', [student.class_id]);
    const [currentResults] = await db.query('SELECT * FROM results WHERE student_id=? AND exam_id=?', [student.id, currentExam.id]);

    const isAnnual = /annual|3rd|third|final/i.test(currentExam.name) || req.query.consolidated === '1';

    const [allExams] = await db.query('SELECT * FROM exams WHERE class_id=? ORDER BY id ASC', [student.class_id]);
    let allResults = [];
    if (allExams.length > 0) {
      const examIds = allExams.map(e => e.id);
      const [resRows] = await db.query('SELECT * FROM results WHERE student_id=? AND exam_id IN (?)', [student.id, examIds]);
      allResults = resRows;
    }

    const { ranksMap } = await calculateClassRanks(student.class_id, currentExam.id, isAnnual);

    generateReportCardPDF(res, student, currentExam, subjects, currentResults, ranksMap, allExams, allResults);
  } catch (err) {
    console.error('Error generating report card:', err);
    res.status(500).send('Error generating report card: ' + err.message);
  }
});

// View my students
router.get('/students', async (req, res) => {
  const userId = req.session.user.id;
  const [students] = await db.query(`SELECT s.*, u.name, u.email, u.phone, c.name as class_name, c.section FROM students s JOIN users u ON s.user_id=u.id JOIN classes c ON s.class_id=c.id WHERE c.teacher_id=? ORDER BY u.name`, [userId]);
  res.render('teacher/students', { title: 'My Students', students });
});

// Attendance report
router.get('/attendance/report', async (req, res) => {
  try {
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
        WHERE s.class_id=? 
        GROUP BY s.id, u.name, s.admission_no, s.roll_number 
        ORDER BY s.roll_number`, [month, year, class_id]);
      [[selectedClass]] = await db.query('SELECT *, name as class_name FROM classes WHERE id=?', [class_id]);
    }
    res.render('teacher/attendance-report', { title: 'Attendance Report', classes, report, class_id, month: month || new Date().getMonth()+1, year: year || new Date().getFullYear(), selectedClass });
  } catch (err) {
    console.error('Teacher attendance report error:', err);
    res.render('teacher/attendance-report', { title: 'Attendance Report', classes: [], report: [], class_id: null, month: new Date().getMonth()+1, year: new Date().getFullYear(), selectedClass: null });
  }
});

// ==================== HOMEWORK ====================
router.get('/homework', async (req, res) => {
  try {
    const userId = req.session.user.id;
    const [classes] = await db.query('SELECT * FROM classes WHERE teacher_id=? ORDER BY name', [userId]);
    const [mySubjects] = await db.query('SELECT * FROM subjects WHERE teacher_id=? ORDER BY name', [userId]);
    
    // Get homework assigned by this teacher or for their classes
    const [homeworkList] = await db.query(`
      SELECT h.*, c.name as class_name, c.section, sub.name as subject_name
      FROM homework h
      JOIN classes c ON h.class_id=c.id
      LEFT JOIN subjects sub ON h.subject_id=sub.id
      WHERE h.assigned_by=? OR c.teacher_id=?
      ORDER BY h.due_date DESC, h.created_at DESC
    `, [userId, userId]);

    res.render('teacher/homework', {
      title: 'Homework & Assignments',
      homeworkList,
      classes,
      mySubjects
    });
  } catch (err) {
    console.error('Teacher homework error:', err);
    req.flash('error_msg', 'Error loading homework: ' + err.message);
    res.redirect('/teacher');
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
    res.redirect('/teacher/homework');
  } catch (err) {
    req.flash('error_msg', 'Error posting homework: ' + err.message);
    res.redirect('/teacher/homework');
  }
});

// ==================== GALLERY ====================
router.get('/gallery', async (req, res) => {
  try {
    const category = req.query.category || '';
    let query = `SELECT * FROM gallery`;
    const params = [];
    if (category) {
      query += ` WHERE category=?`;
      params.push(category);
    }
    query += ` ORDER BY created_at DESC`;
    const [images] = await db.query(query, params);
    const [categories] = await db.query(`SELECT DISTINCT category FROM gallery WHERE category IS NOT NULL AND category != ''`);

    res.render('teacher/gallery', {
      title: 'School Photo Gallery',
      images,
      categories: categories.map(c => c.category),
      selectedCategory: category
    });
  } catch (err) {
    console.error('Teacher gallery error:', err);
    req.flash('error_msg', 'Error loading gallery: ' + err.message);
    res.redirect('/teacher');
  }
});

module.exports = router;
