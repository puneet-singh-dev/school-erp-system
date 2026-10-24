const db = require('../config/db');

/**
 * Calculates month-by-month pending fees against the academic session calendar (APR - MAR).
 * Shared across Admin & Student portals.
 */
async function getPendingFeeReport({ class_id = null, student_id = null, up_to_month = null, includeCleared = false } = {}) {
  const sessionMonthsOrder = ['APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC', 'JAN', 'FEB', 'MAR'];
  const calMonthToSession = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  
  const currentCalMonth = new Date().getMonth();
  const currentOngoingMonth = calMonthToSession[currentCalMonth];
  const targetMonth = (up_to_month && sessionMonthsOrder.includes(up_to_month.toUpperCase()))
    ? up_to_month.toUpperCase()
    : currentOngoingMonth;

  const targetIndex = sessionMonthsOrder.indexOf(targetMonth);
  const expectedMonths = targetIndex >= 0 
    ? sessionMonthsOrder.slice(0, targetIndex + 1) 
    : sessionMonthsOrder.slice(0, sessionMonthsOrder.indexOf(currentOngoingMonth) + 1);

  // Query students
  let query = `
    SELECT s.*, u.name, u.email, u.phone, u.address,
           c.name as class_name, c.section, c.academic_year
    FROM students s
    JOIN users u ON s.user_id = u.id
    LEFT JOIN classes c ON s.class_id = c.id
    WHERE 1=1
  `;
  const params = [];
  if (class_id) {
    query += ` AND s.class_id = ?`;
    params.push(class_id);
  }
  if (student_id) {
    query += ` AND s.id = ?`;
    params.push(student_id);
  }
  query += ` ORDER BY (s.roll_number IS NULL OR s.roll_number = 0), s.roll_number ASC, u.name ASC`;

  const [students] = await db.query(query, params);
  if (!students.length) {
    return { students: [], targetMonth, currentOngoingMonth, expectedMonths, sessionMonthsOrder };
  }

  // Fetch fee structures by class
  const [feeStructures] = await db.query('SELECT * FROM fee_structure');
  const classFeeMap = {};
  feeStructures.forEach(fs => {
    if (!classFeeMap[fs.class_id]) classFeeMap[fs.class_id] = [];
    classFeeMap[fs.class_id].push(fs);
  });

  // Fetch all fee payments for these students
  const studentIds = students.map(s => s.id);
  const [payments] = await db.query(
    `SELECT student_id, amount_paid, months_paid, breakdown_json FROM fee_payments WHERE student_id IN (?)`,
    [studentIds]
  );
  const studentPaymentsMap = {};
  payments.forEach(p => {
    if (!studentPaymentsMap[p.student_id]) studentPaymentsMap[p.student_id] = [];
    studentPaymentsMap[p.student_id].push(p);
  });

  const pendingList = [];

  for (const s of students) {
    // 1. Determine monthly tuition fee
    const structs = classFeeMap[s.class_id] || [];
    let monthlyTuition = 0;
    if (structs.length > 0) {
      const tuitionStruct = structs.find(st => st.fee_type && /tuit|tuition/i.test(st.fee_type)) || structs[0];
      monthlyTuition = parseFloat(tuitionStruct.amount) || 0;
    }
    if (monthlyTuition <= 0) monthlyTuition = 500; // fallback sensible default

    // 2. Transport fee
    const monthlyVan = (s.uses_transport == 1 || s.uses_transport === true) ? (parseFloat(s.transport_fee) || 0) : 0;
    const monthlyRate = monthlyTuition + monthlyVan;

    // 3. Paid months
    const sPayments = studentPaymentsMap[s.id] || [];
    const paidMonthsSet = new Set();
    let totalPaidAmt = 0;
    sPayments.forEach(p => {
      totalPaidAmt += parseFloat(p.amount_paid) || 0;
      if (p.months_paid) {
        p.months_paid.split(',').forEach(m => {
          const clean = m.trim().toUpperCase();
          if (clean) paidMonthsSet.add(clean);
        });
      }
    });

    // 4. Pending months up to targetMonth
    const unpaidMonths = expectedMonths.filter(m => !paidMonthsSet.has(m));
    const pendingMonthsCount = unpaidMonths.length;
    const sessionDue = pendingMonthsCount * monthlyRate;
    const prevBalance = parseFloat(s.previous_balance) || 0;
    const totalDue = sessionDue + prevBalance;

    if (totalDue > 0 || includeCleared || student_id) {
      pendingList.push({
        student_id: s.id,
        id: s.id,
        name: s.name,
        admission_no: s.admission_no,
        roll_number: s.roll_number,
        class_id: s.class_id,
        class_name: s.class_name,
        section: s.section,
        phone: s.phone,
        address: s.address,
        father_name: s.father_name,
        uses_transport: s.uses_transport,
        transport_route: s.transport_route,
        monthly_tuition: monthlyTuition,
        monthly_van: monthlyVan,
        monthly_rate: monthlyRate,
        paid_months: Array.from(paidMonthsSet).join(', ') || 'None',
        paid_months_list: Array.from(paidMonthsSet),
        unpaid_months: unpaidMonths,
        pending_months_text: unpaidMonths.join(', ') || 'None',
        pending_months_count: pendingMonthsCount,
        session_due: sessionDue,
        previous_balance: prevBalance,
        previous_balance_remarks: s.previous_balance_remarks,
        total_fees: sessionDue + prevBalance,
        paid: totalPaidAmt,
        balance: totalDue,
        is_cleared: totalDue <= 0
      });
    }
  }

  return {
    students: pendingList,
    targetMonth,
    currentOngoingMonth,
    expectedMonths,
    sessionMonthsOrder
  };
}

module.exports = { getPendingFeeReport };
