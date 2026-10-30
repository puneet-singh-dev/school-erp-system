const db = require('../config/db');
const { isSubjectApplicableToStudent } = require('./csvMarksHelper');
const { calculateClassRanks } = require('./examRankHelper');
const { getPendingFeeReport } = require('./feeReport');
const { getSettings, updateSettings } = require('./settingsHelper');

/**
 * Extracts a numeric or standard grade rank from class names:
 * e.g. "Nursery" -> 0.1, "LKG" -> 0.2, "UKG" -> 0.3, "Class 1" -> 1, "Class 12" -> 12
 */
function parseGradeLevel(className) {
  if (!className) return 999;
  const name = String(className).trim().toLowerCase();
  if (name.includes('nursery')) return 0.1;
  if (name.includes('lkg') || name.includes('lower kg')) return 0.2;
  if (name.includes('ukg') || name.includes('upper kg') || name.includes('kg')) return 0.3;

  const match = name.match(/(?:class|grade|std)?\s*(\d+)/i);
  if (match) {
    return parseInt(match[1], 10);
  }
  return 999;
}

/**
 * Formats a grade rank back into a standard class name
 */
function getNextGradeInfo(gradeLevel) {
  if (gradeLevel === 0.1) return { nextGradeNumber: 0.2, nextGradeName: 'LKG', isGraduating: false };
  if (gradeLevel === 0.2) return { nextGradeNumber: 0.3, nextGradeName: 'UKG', isGraduating: false };
  if (gradeLevel === 0.3) return { nextGradeNumber: 1, nextGradeName: 'Class 1', isGraduating: false };
  if (gradeLevel >= 1 && gradeLevel < 12) {
    return { nextGradeNumber: gradeLevel + 1, nextGradeName: `Class ${gradeLevel + 1}`, isGraduating: false };
  }
  if (gradeLevel >= 12 && gradeLevel < 999) {
    return { nextGradeNumber: null, nextGradeName: 'Class 12 (Passed Out / Alumni)', isGraduating: true };
  }
  return { nextGradeNumber: null, nextGradeName: 'Graduated / Alumni', isGraduating: true };
}

/**
 * Generates default next academic year string from current:
 * e.g. "2026-27" -> "2027-28", "2026-2027" -> "2027-2028"
 */
function getSuggestedNextAcademicYear(currentYear) {
  if (!currentYear) return '2027-28';
  const match = currentYear.match(/(\d{4})[-/](\d{2,4})/);
  if (match) {
    const startYr = parseInt(match[1], 10);
    const endYrStr = match[2];
    if (endYrStr.length === 2) {
      const endYr = parseInt(endYrStr, 10);
      return `${startYr + 1}-${String((endYr + 1) % 100).padStart(2, '0')}`;
    } else {
      const endYr = parseInt(endYrStr, 10);
      return `${startYr + 1}-${endYr + 1}`;
    }
  }
  return '2027-28';
}

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
      statusLabel: hasExams ? (isPass ? 'Passed' : 'Failed') : 'Eligible (No Exam)',
      pendingFee: parseFloat(feeData.balance || 0),
      isFeeCleared: feeData.is_cleared || (parseFloat(feeData.balance || 0) <= 0)
    };
  });
}

/**
 * Prepares the complete school-wide promotion pipeline:
 * - Orders all active classes from lowest to highest grade (Class 1 -> Class 12)
 * - Evaluates each student's pass/fail status and pre-selects default actions
 * - Identifies target next grades, UP Board optional subject requirements, and graduation
 */
async function getSchoolWidePromotionPlan(selectedYear = null) {
  const settings = await getSettings();
  const currentAcademicYear = (selectedYear && selectedYear.trim()) || settings.academic_year || '2026-27';
  const newAcademicYear = getSuggestedNextAcademicYear(currentAcademicYear);

  // Fetch all classes
  const [classes] = await db.query('SELECT * FROM classes ORDER BY name, section');
  
  // Sort classes in ladder progression order (Nursery, LKG, UKG, Class 1, Class 2 ... Class 12)
  classes.sort((a, b) => {
    const gradeA = parseGradeLevel(a.name);
    const gradeB = parseGradeLevel(b.name);
    if (gradeA !== gradeB) return gradeA - gradeB;
    return (a.section || '').localeCompare(b.section || '');
  });

  const ladder = [];
  let totalSchoolStudents = 0;
  let totalEligiblePassed = 0;
  let totalFailed = 0;
  let totalFeesDue = 0;

  for (const c of classes) {
    const gradeNum = parseGradeLevel(c.name);
    const nextInfo = getNextGradeInfo(gradeNum);
    const students = await getPromotionStudentsData(c.id);

    const isGraduating = nextInfo.isGraduating || gradeNum >= 12;
    const isTargetHigh = (nextInfo.nextGradeNumber === 9 || nextInfo.nextGradeNumber === 10);
    const isTargetSenior = (nextInfo.nextGradeNumber === 11 || nextInfo.nextGradeNumber === 12);

    let classPassed = 0;
    let classFailed = 0;
    let classPendingFees = 0;

    const studentList = students.map((s, idx) => {
      totalSchoolStudents++;
      classPendingFees += (s.pendingFee || 0);

      if (s.isPass) {
        classPassed++;
        totalEligiblePassed++;
      } else if (s.hasExams) {
        classFailed++;
        totalFailed++;
      } else {
        classPassed++;
        totalEligiblePassed++;
      }

      // Default decision:
      // - Class 12: 'graduate' (Pass Out as Alumni)
      // - Passing students: 'promote' (Jump to next class)
      // - Failed students: 'repeat' (Retain in same class for new session)
      let defaultDecision = 'promote';
      if (isGraduating) {
        defaultDecision = 'graduate';
      } else if (!s.isPass && s.hasExams) {
        defaultDecision = 'repeat';
      }

      // Default UP Board Optional Subjects
      let defaultOptSubject = s.optional_subject;
      if (isTargetHigh && !defaultOptSubject) {
        defaultOptSubject = 'Drawing';
      } else if (isTargetSenior && !defaultOptSubject) {
        defaultOptSubject = 'Mathematics';
      }

      return {
        ...s,
        defaultDecision,
        suggestedRollNumber: idx + 1,
        defaultOptSubject
      };
    });

    totalFeesDue += classPendingFees;

    ladder.push({
      sourceClass: c,
      gradeNum,
      nextInfo,
      isGraduating,
      isTargetHigh,
      isTargetSenior,
      targetGradeName: nextInfo.nextGradeName,
      targetSection: c.section || 'A',
      students: studentList,
      classPassed,
      classFailed,
      classPendingFees
    });
  }

  return {
    currentAcademicYear,
    newAcademicYear,
    ladder,
    stats: {
      totalClasses: classes.length,
      totalSchoolStudents,
      totalEligiblePassed,
      totalFailed,
      totalFeesDue
    }
  };
}

/**
 * Safely copies subjects and fee structure from an old class to a new academic year class
 */
async function copySubjectsAndFeesToNewClass(connection, oldClassId, newClassId, newAcademicYear) {
  if (!oldClassId || !newClassId || oldClassId === newClassId) return;

  // 1. Copy subjects if target has none
  const [[{ subCount }]] = await connection.query('SELECT COUNT(*) as subCount FROM subjects WHERE class_id = ?', [newClassId]);
  if (subCount === 0) {
    const [oldSubjects] = await connection.query('SELECT * FROM subjects WHERE class_id = ?', [oldClassId]);
    for (const sub of oldSubjects) {
      await connection.query(
        'INSERT INTO subjects (name, code, class_id, teacher_id, max_marks) VALUES (?, ?, ?, ?, ?)',
        [sub.name, sub.code, newClassId, sub.teacher_id, sub.max_marks || 100]
      );
    }
  }

  // 2. Copy fee structures if target has none
  const [[{ feeCount }]] = await connection.query('SELECT COUNT(*) as feeCount FROM fee_structure WHERE class_id = ?', [newClassId]);
  if (feeCount === 0) {
    const [oldFees] = await connection.query('SELECT * FROM fee_structure WHERE class_id = ?', [oldClassId]);
    for (const fs of oldFees) {
      await connection.query(
        'INSERT INTO fee_structure (class_id, fee_type, amount, due_date, academic_year) VALUES (?, ?, ?, ?, ?)',
        [newClassId, fs.fee_type, fs.amount, fs.due_date, newAcademicYear]
      );
    }
  }
}

/**
 * Finds or auto-creates a class in the database for the given academic year
 */
async function getOrCreateClass(connection, name, section, academicYear) {
  const [existing] = await connection.query(
    'SELECT * FROM classes WHERE name = ? AND section = ? AND academic_year = ? LIMIT 1',
    [name, section, academicYear]
  );
  if (existing.length > 0) {
    return existing[0];
  }

  // Find any previous class of same name to copy teacher
  const [prev] = await connection.query(
    'SELECT teacher_id FROM classes WHERE name = ? AND section = ? ORDER BY id DESC LIMIT 1',
    [name, section]
  );
  const teacherId = prev.length ? prev[0].teacher_id : null;

  const [res] = await connection.query(
    'INSERT INTO classes (name, section, teacher_id, academic_year) VALUES (?, ?, ?, ?)',
    [name, section, teacherId, academicYear]
  );

  return {
    id: res.insertId,
    name,
    section,
    teacher_id: teacherId,
    academic_year: academicYear
  };
}

/**
 * Executes a School-Wide Academic Year Transition:
 * - Runs in top-down order (Class 12 down to Class 1) so no student records are mixed up
 * - Archives completed session marks and fee dues in `student_academic_history`
 * - Class 12 is archived under previous academic year (e.g. 2026-27) as passed out alumni
 * - Class 11 -> Class 12, Class 10 -> Class 11, ..., Class 1 -> Class 2
 * - Class 1 in the new session becomes EMPTY ready for fresh admissions
 * - Repeaters stay in the same grade for the new session
 * - Updates global system setting `academic_year`
 */
async function executeSchoolWideAcademicTransition({
  connection,
  currentAcademicYear,
  newAcademicYear,
  carryForwardFees = true,
  studentDecisions = {}, // { [studentId]: { decision: 'promote'|'repeat'|'graduate'|'left', newRollNumber, optionalSubject } }
  adminUserId = null,
  transitionRemarks = null
}) {
  const curYear = (currentAcademicYear && currentAcademicYear.trim()) || '2026-27';
  const nextYear = (newAcademicYear && newAcademicYear.trim()) || getSuggestedNextAcademicYear(curYear);

  // 1. Fetch all classes
  const [classes] = await connection.query('SELECT * FROM classes ORDER BY name, section');
  if (!classes.length) {
    throw new Error('No classes found in the system to promote');
  }

  // 2. Sort classes in DESCENDING TOP-DOWN order (Class 12 down to Class 1)
  classes.sort((a, b) => {
    const gradeA = parseGradeLevel(a.name);
    const gradeB = parseGradeLevel(b.name);
    if (gradeA !== gradeB) return gradeB - gradeA; // Top-Down order!
    return (b.section || '').localeCompare(a.section || '');
  });

  let totalPromoted = 0;
  let totalRepeated = 0;
  let totalGraduated = 0;
  let totalLeft = 0;

  for (const sourceClass of classes) {
    const gradeNum = parseGradeLevel(sourceClass.name);
    const nextInfo = getNextGradeInfo(gradeNum);
    const isGraduatingClass = nextInfo.isGraduating || gradeNum >= 12;

    // Load students for this class directly on this transaction connection
    const [studentsData] = await connection.query(`
      SELECT s.*, u.name, u.phone, u.profile_photo, u.email
      FROM students s
      JOIN users u ON s.user_id = u.id
      WHERE s.class_id = ?
      ORDER BY (s.roll_number IS NULL OR s.roll_number = 0), s.roll_number ASC, u.name ASC
    `, [sourceClass.id]);
    if (!studentsData.length) continue;

    // Load marks summary for this class directly on connection
    const [marksRows] = await connection.query(`
      SELECT r.student_id, SUM(r.marks_obtained) as total_obt, SUM(r.max_marks) as total_max
      FROM results r
      JOIN exams e ON r.exam_id = e.id
      WHERE e.class_id = ?
      GROUP BY r.student_id
    `, [sourceClass.id]);
    const marksMap = {};
    marksRows.forEach(r => { marksMap[r.student_id] = r; });

    // Determine target classes for the new session:
    // a) Target class if promoted (e.g. Class 1 -> Class 2 of nextYear)
    let promotedTargetClass = null;
    if (!isGraduatingClass) {
      promotedTargetClass = await getOrCreateClass(connection, nextInfo.nextGradeName, sourceClass.section || 'A', nextYear);
      await copySubjectsAndFeesToNewClass(connection, sourceClass.id, promotedTargetClass.id, nextYear);
    }

    // b) Target class if repeated (same grade in nextYear, e.g. Class 2 -> Class 2 of nextYear)
    let repeatedTargetClass = await getOrCreateClass(connection, sourceClass.name, sourceClass.section || 'A', nextYear);
    await copySubjectsAndFeesToNewClass(connection, sourceClass.id, repeatedTargetClass.id, nextYear);

    // c) For graduating Class 12 students:
    // Keep them linked to sourceClass (which has curYear e.g. 2026-27), or mark an archive class
    let graduateArchiveClass = sourceClass;
    if (isGraduatingClass) {
      // Ensure sourceClass has curYear explicitly set
      await connection.query('UPDATE classes SET academic_year = ? WHERE id = ?', [curYear, sourceClass.id]);
    }

    // Process every student in this class
    for (const st of studentsData) {
      const decisionObj = studentDecisions[st.id] || {};
      let decision = decisionObj.decision;
      if (!decision) {
        decision = isGraduatingClass ? 'graduate' : 'promote';
      }

      const mRow = marksMap[st.id] || {};
      const totalObt = mRow.total_obt ? parseFloat(mRow.total_obt) : null;
      const totalMax = mRow.total_max ? parseFloat(mRow.total_max) : null;
      const pct = (totalMax && totalMax > 0) ? Math.round((totalObt / totalMax) * 1000) / 10 : null;

      const newRoll = (decisionObj.newRollNumber && parseInt(decisionObj.newRollNumber, 10))
        ? parseInt(decisionObj.newRollNumber, 10)
        : null;
      const newOpt = decisionObj.optionalSubject !== undefined ? decisionObj.optionalSubject : st.optional_subject;
      const carriedFee = carryForwardFees ? Math.max(0, parseFloat(st.previous_balance) || 0) : 0.00;

      // Result status string for historical archive
      let resultStatus = 'Promoted';
      if (decision === 'graduate') resultStatus = 'Graduated / Passed Out';
      else if (decision === 'repeat') resultStatus = 'Retained / Repeating';
      else if (decision === 'left') resultStatus = 'Left School / TC Issued';
      else if (!st.isPass) resultStatus = 'Promoted (Parent Request / Conditional)';

      let targetClassId = null;
      let targetYearForHistory = nextYear;

      if (decision === 'graduate') {
        targetClassId = graduateArchiveClass.id;
        targetYearForHistory = 'Passed Out';
      } else if (decision === 'repeat') {
        targetClassId = repeatedTargetClass.id;
        targetYearForHistory = nextYear;
      } else if (decision === 'left') {
        targetClassId = null;
        targetYearForHistory = 'Left School';
      } else {
        targetClassId = promotedTargetClass ? promotedTargetClass.id : null;
        targetYearForHistory = nextYear;
      }

      // 1. Snapshot old session into student_academic_history
      await connection.query(`
        INSERT INTO student_academic_history (
          student_id, class_id, class_name, section, academic_year,
          roll_number, optional_subject, total_marks_obtained, total_max_marks,
          final_percentage, final_result_status, fee_balance_carried,
          promoted_to_class_id, promoted_to_academic_year, promoted_at,
          promoted_by, remarks
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?)
      `, [
        st.id,
        sourceClass.id,
        sourceClass.name,
        sourceClass.section || 'A',
        sourceClass.academic_year || curYear,
        st.roll_number,
        st.optional_subject,
        totalObt,
        totalMax,
        pct,
        resultStatus,
        carriedFee,
        targetClassId,
        targetYearForHistory,
        adminUserId,
        (transitionRemarks && transitionRemarks.trim()) || `Academic Year Transition: ${curYear} -> ${nextYear}`
      ]);

      // 2. Update students table
      let updateSql = `
        UPDATE students
        SET class_id = ?,
            roll_number = ?,
            optional_subject = ?
      `;
      const updateParams = [targetClassId, newRoll, newOpt || null];

      if (carryForwardFees) {
        updateSql += `, previous_balance = ?, previous_balance_remarks = ?`;
        updateParams.push(
          carriedFee,
          carriedFee > 0 ? `Carried forward from ${sourceClass.name} - ${sourceClass.section} (${curYear})` : null
        );
      }

      updateSql += ` WHERE id = ?`;
      updateParams.push(st.id);
      await connection.query(updateSql, updateParams);

      if (decision === 'graduate') totalGraduated++;
      else if (decision === 'repeat') totalRepeated++;
      else if (decision === 'left') totalLeft++;
      else totalPromoted++;
    }
  }

  // 3. Ensure lowest class (e.g. Class 1 Section A) exists for newAcademicYear
  // Since all Class 1 students jumped to Class 2, Class 1 is now EMPTY ready for fresh admissions!
  const firstClass = await getOrCreateClass(connection, 'Class 1', 'A', nextYear);
  // Find any old Class 1 to copy subjects/fees
  const [oldClass1] = await connection.query("SELECT id FROM classes WHERE name = 'Class 1' AND academic_year != ? ORDER BY id DESC LIMIT 1", [nextYear]);
  if (oldClass1.length) {
    await copySubjectsAndFeesToNewClass(connection, oldClass1[0].id, firstClass.id, nextYear);
  }

  // 4. Update system setting for active academic year in transaction
  await connection.query("INSERT INTO settings (key_name, key_value) VALUES ('academic_year', ?) ON DUPLICATE KEY UPDATE key_value = ?", [nextYear, nextYear]);

  return {
    currentAcademicYear: curYear,
    newAcademicYear: nextYear,
    totalPromoted,
    totalRepeated,
    totalGraduated,
    totalLeft,
    totalProcessed: totalPromoted + totalRepeated + totalGraduated + totalLeft
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
  parseGradeLevel,
  getNextGradeInfo,
  getSuggestedNextAcademicYear,
  getPromotionStudentsData,
  getSchoolWidePromotionPlan,
  executeSchoolWideAcademicTransition,
  getStudentFullAcademicHistory
};
