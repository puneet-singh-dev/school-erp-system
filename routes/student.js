const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { isAuthenticated } = require('../middleware/auth');
const moment = require('moment');
const { generateFeeReceiptPDF } = require('../utils/receiptPdf');
const { getPendingFeeReport } = require('../utils/feeReport');

router.use(isAuthenticated);
router.use((req, res, next) => {
  if (req.session.user.role !== 'student') return res.redirect(`/${req.session.user.role}`);
  next();
});

// Helper: Get student record for currently logged-in user
async function getStudentForUser(userId) {
  const [students] = await db.query(`
    SELECT s.*, u.name as student_name, u.email, u.phone, u.address, u.profile_photo, u.is_active,
           c.name as class_name, c.section, c.academic_year
    FROM students s
    JOIN users u ON s.user_id=u.id
    LEFT JOIN classes c ON s.class_id=c.id
    WHERE s.user_id=?
  `, [userId]);
  return students.length ? students[0] : null;
}

// ==================== DASHBOARD ====================
router.get('/', async (req, res) => {
  try {
    const student = await getStudentForUser(req.session.user.id);
    if (!student) {
      return res.render('student/dashboard', {
        title: 'Student Dashboard',
        student: null,
        attendance: null,
        fees: null,
        homeworkCount: 0,
        notices: [],
        upcomingEvents: []
      });
    }

    // Attendance summary this month
    const [[attendance]] = await db.query(`
      SELECT
        SUM(CASE WHEN status='Present' THEN 1 ELSE 0 END) as present,
        SUM(CASE WHEN status='Absent' THEN 1 ELSE 0 END) as absent,
        COUNT(id) as total
      FROM attendance
      WHERE student_id=? AND MONTH(date)=MONTH(CURDATE()) AND YEAR(date)=YEAR(CURDATE())
    `, [student.id]);

    // Accurate month-by-month fee summary
    let feeData = {
      total_fees: 0,
      paid: 0,
      balance: 0,
      pending_months_count: 0,
      pending_months_text: 'None',
      paid_months: 'None',
      monthly_rate: 0,
      monthly_tuition: 0,
      monthly_van: 0,
      previous_balance: parseFloat(student.previous_balance || 0),
      session_due: 0
    };
    let feeReport = null;

    try {
      feeReport = await getPendingFeeReport({ student_id: student.id, includeCleared: true });
      if (feeReport.students.length) {
        feeData = feeReport.students[0];
      }
    } catch (fErr) {
      console.error('Student dashboard fee calculation error:', fErr.message);
    }

    // Active homework assignments count
    const [[{ homeworkCount }]] = await db.query(`
      SELECT COUNT(*) as homeworkCount FROM homework WHERE class_id=? AND due_date >= CURDATE()
    `, [student.class_id]);

    // Recent announcements / notices
    const [notices] = await db.query(
      "SELECT * FROM notices WHERE target_role IN ('all','student') ORDER BY created_at DESC LIMIT 5"
    );

    // Upcoming events / holidays
    const [upcomingEvents] = await db.query(
      "SELECT * FROM events WHERE start_date >= CURDATE() ORDER BY start_date ASC LIMIT 4"
    );

    res.render('student/dashboard', {
      title: 'Student Dashboard',
      student,
      attendance,
      fees: { total_fees: feeData.total_fees, paid: feeData.paid },
      feeData,
      feeReport,
      homeworkCount,
      notices,
      upcomingEvents
    });
  } catch (err) {
    console.error('Student dashboard error:', err);
    res.redirect('/login');
  }
});

// ==================== FULL PROFILE ====================
router.get('/profile', async (req, res) => {
  try {
    const student = await getStudentForUser(req.session.user.id);
    if (!student) return res.redirect('/student');

    res.render('student/profile', {
      title: 'My Full Profile',
      student
    });
  } catch (err) {
    console.error('Profile error:', err);
    res.redirect('/student');
  }
});

// ==================== ATTENDANCE ====================
router.get('/attendance', async (req, res) => {
  try {
    const student = await getStudentForUser(req.session.user.id);
    if (!student) return res.redirect('/student');

    const m = parseInt(req.query.month) || (new Date().getMonth() + 1);
    const y = parseInt(req.query.year) || new Date().getFullYear();

    const [attendance] = await db.query(
      'SELECT * FROM attendance WHERE student_id=? AND MONTH(date)=? AND YEAR(date)=? ORDER BY date',
      [student.id, m, y]
    );

    const [[summary]] = await db.query(`
      SELECT
        SUM(CASE WHEN status='Present' THEN 1 ELSE 0 END) as present,
        SUM(CASE WHEN status='Absent' THEN 1 ELSE 0 END) as absent,
        SUM(CASE WHEN status='Late' THEN 1 ELSE 0 END) as late,
        SUM(CASE WHEN status='Leave' THEN 1 ELSE 0 END) as leave_days,
        COUNT(*) as total
      FROM attendance
      WHERE student_id=? AND MONTH(date)=? AND YEAR(date)=?
    `, [student.id, m, y]);

    res.render('student/attendance', {
      title: 'My Attendance',
      student,
      attendance,
      summary,
      month: m,
      year: y
    });
  } catch (err) {
    console.error('Attendance error:', err);
    res.redirect('/student');
  }
});

// ==================== FEES & RECEIPTS ====================
router.get('/fees', async (req, res) => {
  try {
    const student = await getStudentForUser(req.session.user.id);
    if (!student) return res.redirect('/student');

    const [feeStructures] = await db.query('SELECT * FROM fee_structure WHERE class_id=? ORDER BY fee_type', [student.class_id]);
    const [payments] = await db.query(`
      SELECT fp.*, fs.fee_type, fs.amount as total_amount
      FROM fee_payments fp
      LEFT JOIN fee_structure fs ON fp.fee_structure_id=fs.id
      WHERE fp.student_id=?
      ORDER BY fp.payment_date DESC, fp.id DESC
    `, [student.id]);

    const feeReport = await getPendingFeeReport({ student_id: student.id, includeCleared: true });
    const feeData = feeReport.students.length ? feeReport.students[0] : {
      total_fees: 0,
      paid: 0,
      balance: 0,
      pending_months_count: 0,
      pending_months_text: 'None',
      paid_months: 'None',
      monthly_rate: 0,
      monthly_tuition: 0,
      monthly_van: 0,
      previous_balance: parseFloat(student.previous_balance || 0),
      session_due: 0,
      is_cleared: true
    };

    // Calculate total paid across all payments
    let allPaidSum = 0;
    payments.forEach(p => {
      allPaidSum += parseFloat(p.amount_paid) || 0;
    });

    const summary = {
      total_fees: feeData.total_fees,
      paid: allPaidSum,
      balance: feeData.balance,
      previous_balance: feeData.previous_balance,
      previous_balance_remarks: feeData.previous_balance_remarks
    };

    res.render('student/fees', {
      title: 'My Fees & Receipts',
      student,
      feeStructures,
      payments,
      summary,
      feeData,
      feeReport
    });
  } catch (err) {
    console.error('Fees error:', err);
    res.redirect('/student');
  }
});

// Download fee receipt PDF
router.get('/fees/receipt/:paymentId', async (req, res) => {
  try {
    const student = await getStudentForUser(req.session.user.id);
    if (!student) return res.status(404).send('Student not found');

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
      WHERE fp.id=? AND fp.student_id=?
    `;

    const [rows] = await db.query(query, [req.params.paymentId, student.id]);
    if (!rows.length) return res.status(404).send('Receipt not found');

    generateFeeReceiptPDF(res, rows[0]);
  } catch (err) {
    console.error('Receipt download error:', err);
    res.status(500).send('Error generating receipt');
  }
});

// ==================== HOMEWORK & ASSIGNMENTS ====================
router.get('/homework', async (req, res) => {
  try {
    const student = await getStudentForUser(req.session.user.id);
    if (!student) return res.redirect('/student');

    // Auto-seed sample homework if empty for class
    const [[{ hwCount }]] = await db.query('SELECT COUNT(*) as hwCount FROM homework WHERE class_id=?', [student.class_id]);
    if (hwCount === 0) {
      await db.query(`
        INSERT INTO homework (class_id, title, description, assigned_date, due_date) VALUES
        (?, 'Mathematics Chapter 4 Exercises', 'Complete questions 1 to 15 from Chapter 4 (Quadratic Equations). Show step-by-step working.', CURDATE(), DATE_ADD(CURDATE(), INTERVAL 3 DAY)),
        (?, 'English Essay Writing', 'Write an essay on Importance of Digital Literacy in 250 words. Submit in homework notebook.', DATE_SUB(CURDATE(), INTERVAL 1 DAY), DATE_ADD(CURDATE(), INTERVAL 2 DAY)),
        (?, 'Science Lab Diagram', 'Draw and label the human digestive system in your science practical record book.', DATE_SUB(CURDATE(), INTERVAL 2 DAY), DATE_ADD(CURDATE(), INTERVAL 4 DAY))
      `, [student.class_id, student.class_id, student.class_id]);
    }

    const [homeworkList] = await db.query(`
      SELECT h.*, sub.name as subject_name, u.name as teacher_name
      FROM homework h
      LEFT JOIN subjects sub ON h.subject_id=sub.id
      LEFT JOIN users u ON h.assigned_by=u.id
      WHERE h.class_id=?
      ORDER BY h.due_date DESC, h.created_at DESC
    `, [student.class_id]);

    res.render('student/homework', {
      title: 'Homework & Assignments',
      student,
      homeworkList
    });
  } catch (err) {
    console.error('Homework error:', err);
    res.redirect('/student');
  }
});

// ==================== SCHOOL TIMETABLE ====================
router.get('/timetable', async (req, res) => {
  try {
    const student = await getStudentForUser(req.session.user.id);
    if (!student) return res.redirect('/student');

    // Auto-seed sample timetable if empty for this class
    const [[{ ttCount }]] = await db.query('SELECT COUNT(*) as ttCount FROM timetable WHERE class_id=?', [student.class_id]);
    if (ttCount === 0) {
      const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      const [subjects] = await db.query('SELECT id FROM subjects WHERE class_id=? LIMIT 5', [student.class_id]);
      if (subjects.length > 0) {
        for (const day of days) {
          await db.query(`
            INSERT INTO timetable (class_id, subject_id, day_of_week, start_time, end_time) VALUES
            (?, ?, ?, '08:30:00', '09:15:00'),
            (?, ?, ?, '09:15:00', '10:00:00'),
            (?, ?, ?, '10:15:00', '11:00:00')
          `, [
            student.class_id, subjects[0].id, day,
            student.class_id, subjects[1 % subjects.length].id, day,
            student.class_id, subjects[2 % subjects.length].id, day
          ]);
        }
      }
    }

    const [schedule] = await db.query(`
      SELECT t.*, sub.name as subject_name, sub.code as subject_code, u.name as teacher_name
      FROM timetable t
      JOIN subjects sub ON t.subject_id=sub.id
      LEFT JOIN users u ON t.teacher_id=u.id
      WHERE t.class_id=?
      ORDER BY FIELD(t.day_of_week, 'Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'), t.start_time
    `, [student.class_id]);

    res.render('student/timetable', {
      title: 'Class Timetable',
      student,
      schedule
    });
  } catch (err) {
    console.error('Timetable error:', err);
    res.redirect('/student');
  }
});

// ==================== ANNOUNCEMENTS / NOTICES ====================
router.get('/notices', async (req, res) => {
  try {
    const student = await getStudentForUser(req.session.user.id);
    const [notices] = await db.query(`
      SELECT n.*, u.name as created_by_name
      FROM notices n
      LEFT JOIN users u ON n.created_by=u.id
      WHERE n.target_role IN ('all','student')
      ORDER BY n.created_at DESC
    `);

    res.render('student/notices', {
      title: 'School Announcements',
      student,
      notices
    });
  } catch (err) {
    console.error('Notices error:', err);
    res.redirect('/student');
  }
});

// ==================== HOLIDAYS & UPCOMING EVENTS ====================
router.get('/events', async (req, res) => {
  try {
    const student = await getStudentForUser(req.session.user.id);
    const [events] = await db.query('SELECT * FROM events ORDER BY start_date ASC');

    res.render('student/events', {
      title: 'Holidays & Events',
      student,
      events
    });
  } catch (err) {
    console.error('Events error:', err);
    res.redirect('/student');
  }
});

// ==================== LEAVE APPLICATIONS ====================
router.get('/leaves', async (req, res) => {
  try {
    const student = await getStudentForUser(req.session.user.id);
    if (!student) return res.redirect('/student');

    const [leaves] = await db.query(`
      SELECT la.*, rev.name as reviewer_name
      FROM leave_applications la
      LEFT JOIN users rev ON la.reviewed_by=rev.id
      WHERE la.student_id=?
      ORDER BY la.created_at DESC
    `, [student.id]);

    res.render('student/leaves', {
      title: 'Submit Leave Application',
      student,
      leaves
    });
  } catch (err) {
    console.error('Leaves error:', err);
    res.redirect('/student');
  }
});

router.post('/leaves', async (req, res) => {
  try {
    const student = await getStudentForUser(req.session.user.id);
    if (!student) return res.redirect('/student');

    const { from_date, to_date, reason } = req.body;
    if (!from_date || !to_date || !reason) {
      req.flash('error_msg', 'Please fill all required fields for the leave application.');
      return res.redirect('/student/leaves');
    }

    await db.query(
      `INSERT INTO leave_applications (student_id, from_date, to_date, reason) VALUES (?, ?, ?, ?)`,
      [student.id, from_date, to_date, reason.trim()]
    );

    req.flash('success_msg', 'Leave application submitted successfully. It is currently under review by administration.');
    res.redirect('/student/leaves');
  } catch (err) {
    console.error('Leave submission error:', err);
    req.flash('error_msg', 'Error submitting leave application: ' + err.message);
    res.redirect('/student/leaves');
  }
});

// ==================== CONTACT UPDATE (APPROVAL WORKFLOW) ====================
router.get('/contact-update', async (req, res) => {
  try {
    const student = await getStudentForUser(req.session.user.id);
    if (!student) return res.redirect('/student');

    const [requests] = await db.query(`
      SELECT cr.*, rev.name as reviewer_name
      FROM contact_requests cr
      LEFT JOIN users rev ON cr.reviewed_by=rev.id
      WHERE cr.student_id=? AND cr.request_type='Profile_Update'
      ORDER BY cr.created_at DESC
    `, [student.id]);

    res.render('student/contact-update', {
      title: 'Update Contact Information',
      student,
      requests
    });
  } catch (err) {
    console.error('Contact update error:', err);
    res.redirect('/student');
  }
});

router.post('/contact-update', async (req, res) => {
  try {
    const student = await getStudentForUser(req.session.user.id);
    if (!student) return res.redirect('/student');

    const { new_phone, new_address, new_emergency_contact, message } = req.body;
    await db.query(
      `INSERT INTO contact_requests 
       (student_id, request_type, new_phone, new_address, new_emergency_contact, message) 
       VALUES (?, 'Profile_Update', ?, ?, ?, ?)`,
      [student.id, new_phone || null, new_address || null, new_emergency_contact || null, message || 'Profile update requested']
    );

    req.flash('success_msg', 'Contact update request submitted for administrative verification and approval.');
    res.redirect('/student/contact-update');
  } catch (err) {
    console.error('Contact update submission error:', err);
    req.flash('error_msg', 'Error submitting request: ' + err.message);
    res.redirect('/student/contact-update');
  }
});

// ==================== CONTACT SCHOOL / TEACHERS ====================
router.get('/contact', async (req, res) => {
  try {
    const student = await getStudentForUser(req.session.user.id);
    if (!student) return res.redirect('/student');

    // Get subject teachers for this student's class
    const [teachers] = await db.query(`
      SELECT DISTINCT t.id as teacher_id, u.name as teacher_name, u.email as teacher_email, u.phone as teacher_phone,
             sub.name as subject_name
      FROM subjects sub
      JOIN teachers t ON sub.teacher_id=t.user_id
      JOIN users u ON t.user_id=u.id
      WHERE sub.class_id=?
    `, [student.class_id]);

    res.render('student/contact', {
      title: 'Contact Administration & Teachers',
      student,
      teachers
    });
  } catch (err) {
    console.error('Contact page error:', err);
    res.redirect('/student');
  }
});

router.post('/contact', async (req, res) => {
  try {
    const student = await getStudentForUser(req.session.user.id);
    if (!student) return res.redirect('/student');

    const { recipient_type, target_teacher_id, message } = req.body;
    const reqType = recipient_type === 'teacher' ? 'Message_Teacher' : 'Message_Admin';

    await db.query(
      `INSERT INTO contact_requests (student_id, request_type, target_teacher_id, message) VALUES (?, ?, ?, ?)`,
      [student.id, reqType, target_teacher_id ? parseInt(target_teacher_id, 10) : null, message]
    );

    req.flash('success_msg', 'Your message has been sent to the administration/teacher.');
    res.redirect('/student/contact');
  } catch (err) {
    console.error('Contact send error:', err);
    req.flash('error_msg', 'Error sending message: ' + err.message);
    res.redirect('/student/contact');
  }
});

// ==================== PHOTO GALLERY ====================
router.get('/gallery', async (req, res) => {
  try {
    const student = await getStudentForUser(req.session.user.id);
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

    res.render('student/gallery', {
      title: 'School Photo Gallery',
      student,
      images,
      categories: categories.map(c => c.category),
      selectedCategory: category
    });
  } catch (err) {
    console.error('Gallery error:', err);
    res.redirect('/student');
  }
});

// ==================== RESULTS ACCESS RESTRICTION ====================
// Student has NO permission to see result marksheet as requested by school policy
const restrictResults = (req, res) => {
  req.flash('error_msg', 'Notice: Result marksheets are issued directly by the school office and examination authority. Students cannot view or download marksheets from the online portal.');
  res.redirect('/student');
};

router.get('/results', restrictResults);
router.get('/results/:examId', restrictResults);
router.get('/results/:examId/download', restrictResults);

module.exports = router;
