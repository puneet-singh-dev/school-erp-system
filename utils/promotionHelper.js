const db = require('../config/db');
const { isSubjectApplicableToStudent } = require('./csvMarksHelper');
const { calculateClassRanks } = require('./examRankHelper');
const { getPendingFeeReport } = require('./feeReport');

/**
 * Fetches all students enrolled in a class along with their academic exam performance,
 * UP Board optional subject, and pending fee dues for promotion review.
 */
async function getPromotionStudentsData(sourceClassId) {
  if (!sourceClassId) return [];

  // 1. Query students currently in the source class
  const [students] = await db.query(`
    SELECT s.*, u.name, u.phone, u.profile_photo, u.email,
           c.name as class_name, c.section, c.academic_year
    FROM students s
    JOIN users u ON s.user_id = u.id
    LEFT JOIN classes c ON s.class_id = c.id
    WHERE s.class_id = ?
    ORDER BY (s.roll_number IS NULL OR s.roll_number = 0), s.roll_number ASC, u.name ASC
  `, [sourceClassId]);

  if (!students.length) return [];

  const studentIds = students.map(s => s.id);

  // 2. Fetch all exams and subjects for this class
  const [exams] = await db.query(
    'SELECT * FROM exams WHERE class_id = ? ORDER BY id ASC',
    [sourceClassId]
  );
  const [subjects] = await db.query(
    'SELECT * FROM subjects WHERE class_id = ?',
    [sourceClassId]
  );
  const subjectMap = {};
  subjects.forEach(sub => { subjectMap[sub.id] = sub; });

  // 3. Fetch results for these students in this source class
  let results = [];
  if (exams.length > 0) {
    const examIds = exams.map(e => e.id);
    const [resRows] = await db.query(
      'SELECT * FROM results WHERE student_id IN (?) AND exam_id IN (?)',
      [studentIds, examIds]
    );
    results = resRows;
  }

  // 4. Identify if an annual or final exam was conducted
  const annualExam = exams.find(e => /annual|3rd|third|final/i.test(e.name));

  // 5. Fetch accurate month-by-month fee pending report
  const feeReportMap = {};
  try {
    const feeReport = await getPendingFeeReport({ class_id: sourceClassId, includeCleared: true });
    if (feeReport && feeReport.students) {
      feeReport.students.forEach(st => {
        feeReportMap[st.id] = st;
      });
    }
  } catch (fErr) {
    console.warn('Promotion fee report warning:', fErr.message);
  }

  // 6. Calculate academic status & fee status per student
  return students.map(s => {
    // If annual exam exists, judge passing by annual exam; otherwise use all exams recorded
    const studentResults = results.filter(r => {
      if (r.student_id !== s.id) return false;
      if (annualExam) return r.exam_id === annualExam.id;
      return true;
    });

    let totalObtained = 0;
    let totalMax = 0;
    let hasFailed = false;
    let subjectCount = 0;

    studentResults.forEach(r => {
      const sub = subjectMap[r.subject_id];
      if (sub && !isSubjectApplicableToStudent(sub.name, s.optional_subject)) {
        return;
      }
      const obt = parseFloat(r.marks_obtained) || 0;
      const max = parseFloat(r.max_marks) || (sub ? parseFloat(sub.max_marks) : 100);
      totalObtained += obt;
      totalMax += max;
      subjectCount++;
      if (max > 0 && (obt / max) < 0.33) {
        hasFailed = true;
      }
    });

    const hasExams = subjectCount > 0;
    const percentage = totalMax > 0 ? (totalObtained / totalMax) * 100 : null;
    const isPass = hasExams ? (!hasFailed && percentage >= 33) : true; // Eligible if passed or no exam taken yet

    const feeData = feeReportMap[s.id] || {
      balance: parseFloat(s.previous_balance || 0),
      is_cleared: parseFloat(s.previous_balance || 0) <= 0
    };

    return {
      ...s,
      totalObtained: Math.round(totalObtained * 100) / 100,
      totalMax: Math.round(totalMax * 100) / 100,
      percentage: percentage !== null ? Math.round(percentage * 10) / 10 : null,
      hasExams,
      isPass,
      hasFailed,
      statusLabel: hasExams ? (isPass ? 'Passed' : 'Failed') : 'No Exams Recorded',
      pendingFee: parseFloat(feeData.balance || 0),
      isFeeCleared: feeData.is_cleared || (parseFloat(feeData.balance || 0) <= 0)
    };
  });
}

/**
 * Executes batch promotion of students from source class to target class.
 * Preserves past class records in `student_academic_history` and updates students.
 */
async function executeBatchPromotion({
  connection,
  sourceClassId,
  targetClassId,
  targetAcademicYear,
  carryForwardFees = true,
  studentPromotions = [], // [{ studentId, newRollNumber, optionalSubject }]
  adminUserId = null,
  promotionRemarks = null
}) {
  const [[sourceClass]] = await connection.query('SELECT * FROM classes WHERE id = ?', [sourceClassId]);
  const [[targetClass]] = await connection.query('SELECT * FROM classes WHERE id = ?', [targetClassId]);

  if (!sourceClass || !targetClass) {
    throw new Error('Source or target class not found');
  }

  const promoYear = (targetAcademicYear && targetAcademicYear.trim()) || targetClass.academic_year || '2027-28';

  // Get source performance data
  const promoStudentsData = await getPromotionStudentsData(sourceClassId);
  const promoDataMap = {};
  promoStudentsData.forEach(st => { promoDataMap[st.id] = st; });

  let promotedCount = 0;

  for (const promoItem of studentPromotions) {
    const sId = promoItem.studentId;
    const stData = promoDataMap[sId];
    if (!stData) continue;

    const newRoll = (promoItem.newRollNumber && parseInt(promoItem.newRollNumber, 10)) ? parseInt(promoItem.newRollNumber, 10) : null;
    const newOpt = promoItem.optionalSubject !== undefined ? promoItem.optionalSubject : stData.optional_subject;
    const carriedFee = carryForwardFees ? Math.max(0, parseFloat(stData.pendingFee) || 0) : 0.00;

    // 1. Snapshot old class into historical archive table
    await connection.query(`
      INSERT INTO student_academic_history (
        student_id, class_id, class_name, section, academic_year,
        roll_number, optional_subject, total_marks_obtained, total_max_marks,
        final_percentage, final_result_status, fee_balance_carried,
        promoted_to_class_id, promoted_to_academic_year, promoted_at,
        promoted_by, remarks
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?)
    `, [
      sId,
      sourceClass.id,
      sourceClass.name,
      sourceClass.section,
      sourceClass.academic_year || '2026-27',
      stData.roll_number,
      stData.optional_subject,
      stData.totalObtained || null,
      stData.totalMax || null,
      stData.percentage,
      stData.isPass ? 'Promoted' : 'Promoted (Conditional)',
      carriedFee,
      targetClass.id,
      promoYear,
      adminUserId,
      (promotionRemarks && promotionRemarks.trim()) || `Promoted from ${sourceClass.name} - ${sourceClass.section} to ${targetClass.name} - ${targetClass.section} (${promoYear})`
    ]);

    // 2. Update students table to new class and new optional subject
    let updateQuery = `
      UPDATE students
      SET class_id = ?,
          roll_number = ?,
          optional_subject = ?
    `;
    const updateParams = [targetClass.id, newRoll, newOpt || null];

    if (carryForwardFees) {
      updateQuery += `, previous_balance = ?, previous_balance_remarks = ?`;
      updateParams.push(
        carriedFee,
        carriedFee > 0 ? `Carried forward from ${sourceClass.name} - ${sourceClass.section} (${sourceClass.academic_year || ''})` : null
      );
    }

    updateQuery += ` WHERE id = ?`;
    updateParams.push(sId);

    await connection.query(updateQuery, updateParams);
    promotedCount++;
  }

  return {
    promotedCount,
    sourceClass,
    targetClass,
    promoYear
  };
}

/**
 * Fetches a student's full historical record across all years and classes:
 * - Profile and current enrollment
 * - Class-by-class promotion timeline
 * - All exams, subject marks, grades, and report cards grouped by session/class
 * - Complete fee payment history with downloadable receipts
 * - Multi-session attendance records
 */
async function getStudentFullAcademicHistory(studentId) {
  if (!studentId) return null;

  // 1. Fetch Student profile & Current Class
  const [students] = await db.query(`
    SELECT s.*, u.name as student_name, u.email, u.phone, u.address, u.profile_photo, u.is_active,
           c.name as current_class_name, c.section as current_section, c.academic_year as current_academic_year
    FROM students s
    JOIN users u ON s.user_id = u.id
    LEFT JOIN classes c ON s.class_id = c.id
    WHERE s.id = ?
  `, [studentId]);

  if (!students.length) return null;
  const student = students[0];

  // 2. Fetch Academic Promotion History records
  const [historyRows] = await db.query(`
    SELECT sah.*, u.name as promoted_by_name,
           tc.name as target_class_name, tc.section as target_section
    FROM student_academic_history sah
    LEFT JOIN users u ON sah.promoted_by = u.id
    LEFT JOIN classes tc ON sah.promoted_to_class_id = tc.id
    WHERE sah.student_id = ?
    ORDER BY sah.promoted_at DESC, sah.id DESC
  `, [studentId]);

  // 3. Fetch ALL exams & results taken by this student across all classes
  const [rawResults] = await db.query(`
    SELECT r.*, e.id as exam_id, e.name as exam_name, e.exam_date, e.academic_year as exam_academic_year, e.class_id as exam_class_id,
           c.name as class_name, c.section as class_section,
           sub.name as subject_name, sub.code as subject_code, sub.max_marks as default_max_marks
    FROM results r
    JOIN exams e ON r.exam_id = e.id
    JOIN classes c ON e.class_id = c.id
    JOIN subjects sub ON r.subject_id = sub.id
    WHERE r.student_id = ?
    ORDER BY e.exam_date DESC, e.id DESC, sub.name ASC
  `, [studentId]);

  // Group marks by Exam
  const examMap = {};
  for (const r of rawResults) {
    if (!examMap[r.exam_id]) {
      examMap[r.exam_id] = {
        exam_id: r.exam_id,
        exam_name: r.exam_name,
        exam_date: r.exam_date,
        academic_year: r.exam_academic_year,
        class_id: r.exam_class_id,
        class_name: r.class_name,
        class_section: r.class_section,
        results: [],
        totalObtained: 0,
        totalMax: 0,
        hasFailedSubject: false
      };
    }
    examMap[r.exam_id].results.push(r);
    const obt = parseFloat(r.marks_obtained) || 0;
    const max = parseFloat(r.max_marks) || parseFloat(r.default_max_marks) || 100;
    examMap[r.exam_id].totalObtained += obt;
    examMap[r.exam_id].totalMax += max;
    if (max > 0 && (obt / max) < 0.33) {
      examMap[r.exam_id].hasFailedSubject = true;
    }
  }

  // Calculate percentages and attach positions/ranks for each exam
  const examsList = Object.values(examMap);
  for (const ex of examsList) {
    ex.percentage = ex.totalMax > 0 ? (ex.totalObtained / ex.totalMax) * 100 : 0;
    ex.percentage = Math.round(ex.percentage * 10) / 10;
    ex.isPass = !ex.hasFailedSubject && ex.percentage >= 33;
    try {
      const isAnnual = /annual|3rd|third|final/i.test(ex.exam_name);
      const { ranksMap } = await calculateClassRanks(ex.class_id, ex.exam_id, isAnnual);
      ex.rankInfo = ranksMap[studentId] || null;
    } catch (rErr) {
      ex.rankInfo = null;
    }
  }

  // Group exams by Class / Academic Year
  const classExamsGrouped = {};
  examsList.forEach(ex => {
    const key = `${ex.class_name} - ${ex.class_section} (${ex.academic_year || 'General'})`;
    if (!classExamsGrouped[key]) classExamsGrouped[key] = [];
    classExamsGrouped[key].push(ex);
  });

  // 4. Fetch ALL fee payments ever made by this student
  const [payments] = await db.query(`
    SELECT fp.*, fs.fee_type, fs.amount as structure_amount, fs.academic_year as fee_academic_year,
           u.name as collected_by_name
    FROM fee_payments fp
    LEFT JOIN fee_structure fs ON fp.fee_structure_id = fs.id
    LEFT JOIN users u ON fp.collected_by = u.id
    WHERE fp.student_id = ?
    ORDER BY fp.payment_date DESC, fp.id DESC
  `, [studentId]);

  // Current fee status
  let feeData = { balance: 0, total_fees: 0, paid: 0, is_cleared: true };
  try {
    const feeReport = await getPendingFeeReport({ student_id: studentId, includeCleared: true });
    if (feeReport && feeReport.students && feeReport.students.length) {
      feeData = feeReport.students[0];
    }
  } catch (fErr) {}

  // Lifetime fee paid
  let lifetimeFeePaid = 0;
  payments.forEach(p => { lifetimeFeePaid += parseFloat(p.amount_paid) || 0; });

  // 5. Multi-session attendance records
  const [attendanceSummary] = await db.query(`
    SELECT c.name as class_name, c.section as class_section,
           YEAR(a.date) as yr,
           COUNT(a.id) as total_days,
           SUM(CASE WHEN a.status='Present' THEN 1 ELSE 0 END) as present_days,
           SUM(CASE WHEN a.status='Absent' THEN 1 ELSE 0 END) as absent_days,
           SUM(CASE WHEN a.status='Late' THEN 1 ELSE 0 END) as late_days,
           SUM(CASE WHEN a.status='Leave' THEN 1 ELSE 0 END) as leave_days
    FROM attendance a
    JOIN classes c ON a.class_id = c.id
    WHERE a.student_id = ?
    GROUP BY c.name, c.section, YEAR(a.date)
    ORDER BY yr DESC
  `, [studentId]);

  return {
    student,
    historyRows,
    classExamsGrouped,
    examsList,
    payments,
    feeData,
    lifetimeFeePaid,
    attendanceSummary
  };
}

module.exports = {
  getPromotionStudentsData,
  executeBatchPromotion,
  getStudentFullAcademicHistory
};
