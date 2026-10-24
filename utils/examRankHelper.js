const db = require('../config/db');

/**
 * Calculates student ranks / positions (1st, 2nd, 3rd Position) for a given class and exam (or consolidated annual exams)
 * Criteria:
 * - Minimum passing marks: 33% in each subject and 33% aggregate
 * - Sorted by passing status first, then percentage descending, then total obtained marks descending
 */
async function calculateClassRanks(classId, targetExamId = null, isConsolidated = false) {
  if (!classId) return { ranksMap: {}, topThree: [] };

  const [students] = await db.query(
    `SELECT s.id, u.name, s.admission_no, s.roll_number
     FROM students s
     JOIN users u ON s.user_id = u.id
     WHERE s.class_id = ?
     ORDER BY (s.roll_number IS NULL OR s.roll_number = 0), s.roll_number ASC, u.name ASC`,
    [classId]
  );
  if (!students.length) return { ranksMap: {}, topThree: [] };

  const [subjects] = await db.query('SELECT * FROM subjects WHERE class_id = ?', [classId]);
  const studentIds = students.map(s => s.id);

  let resultsQuery = `SELECT * FROM results WHERE student_id IN (?)`;
  const params = [studentIds];
  if (targetExamId && !isConsolidated) {
    resultsQuery += ` AND exam_id = ?`;
    params.push(targetExamId);
  }
  const [results] = await db.query(resultsQuery, params);

  // Group marks by student
  const studentStats = {};
  students.forEach(s => {
    studentStats[s.id] = {
      student_id: s.id,
      name: s.name,
      admission_no: s.admission_no,
      roll_number: s.roll_number,
      totalObtained: 0,
      totalMax: 0,
      hasFailedSubject: false,
      enteredSubjectsCount: 0
    };
  });

  results.forEach(r => {
    if (studentStats[r.student_id]) {
      const obt = parseFloat(r.marks_obtained) || 0;
      const max = parseFloat(r.max_marks) || 100;
      studentStats[r.student_id].totalObtained += obt;
      studentStats[r.student_id].totalMax += max;
      studentStats[r.student_id].enteredSubjectsCount++;
      if (max > 0 && (obt / max) < 0.33) {
        studentStats[r.student_id].hasFailedSubject = true;
      }
    }
  });

  const studentList = Object.values(studentStats).map(st => {
    const pct = st.totalMax > 0 ? (st.totalObtained / st.totalMax) * 100 : 0;
    const isPass = st.enteredSubjectsCount > 0 && !st.hasFailedSubject && pct >= 33;
    return {
      ...st,
      percentage: pct,
      isPass
    };
  });

  // Sort: Passing students first by percentage descending, then failing students with marks, then unentered
  studentList.sort((a, b) => {
    if (a.isPass !== b.isPass) return a.isPass ? -1 : 1;
    if (a.totalMax > 0 && b.totalMax === 0) return -1;
    if (a.totalMax === 0 && b.totalMax > 0) return 1;
    if (b.percentage !== a.percentage) return b.percentage - a.percentage;
    return b.totalObtained - a.totalObtained;
  });

  const ranksMap = {};
  const topThree = [];
  let currentRank = 1;

  studentList.forEach((st) => {
    if (st.totalMax === 0 || st.enteredSubjectsCount === 0) {
      ranksMap[st.student_id] = {
        rank: null,
        rankText: '-',
        badgeText: '-',
        isTopThree: false,
        percentage: 0,
        totalObtained: 0,
        totalMax: 0,
        isPass: false,
        hasFailedSubject: false
      };
      return;
    }

    const rankNum = currentRank++;
    let rankText = `${rankNum}th Position`;
    let badgeText = `${rankNum}th`;
    if (rankNum === 1) { rankText = '1st Position (Rank 1)'; badgeText = '1st Position'; }
    else if (rankNum === 2) { rankText = '2nd Position (Rank 2)'; badgeText = '2nd Position'; }
    else if (rankNum === 3) { rankText = '3rd Position (Rank 3)'; badgeText = '3rd Position'; }

    const isTopThree = rankNum <= 3 && st.isPass;

    const rankObj = {
      rank: rankNum,
      rankText: st.isPass ? rankText : (st.hasFailedSubject ? 'Fail (Sub <33%)' : 'Fail (<33%)'),
      badgeText: st.isPass ? badgeText : 'Fail',
      isTopThree,
      percentage: st.percentage,
      totalObtained: st.totalObtained,
      totalMax: st.totalMax,
      isPass: st.isPass,
      hasFailedSubject: st.hasFailedSubject
    };

    ranksMap[st.student_id] = rankObj;

    if (isTopThree) {
      topThree.push({
        rank: rankNum,
        rankText,
        badgeText,
        name: st.name,
        admission_no: st.admission_no,
        roll_number: st.roll_number,
        percentage: st.percentage.toFixed(1),
        isPass: st.isPass
      });
    }
  });

  return { ranksMap, topThree };
}

module.exports = { calculateClassRanks };
