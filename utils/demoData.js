const bcrypt = require('bcryptjs');
const db = require('../config/db');

/**
 * Gets the next strictly sequential admission number (e.g. ADM260007, ADM260008...)
 */
async function getNextSequentialAdmissionNo() {
  const year = new Date().getFullYear().toString().slice(-2);
  const [rows] = await db.query('SELECT admission_no FROM students');
  let maxSeq = 0;
  
  rows.forEach(r => {
    if (!r.admission_no) return;
    const m = r.admission_no.match(/(\d+)$/);
    if (m) {
      const fullNum = m[1];
      let seqNum = parseInt(fullNum, 10);
      if (fullNum.length >= 4 && fullNum.startsWith(year)) {
        seqNum = parseInt(fullNum.slice(year.length), 10);
      }
      if (seqNum > maxSeq) maxSeq = seqNum;
    }
  });

  let nextSeq = maxSeq + 1;
  let candidate = `ADM${year}${String(nextSeq).padStart(4, '0')}`;
  
  while (true) {
    const [[existing]] = await db.query('SELECT id FROM students WHERE admission_no = ?', [candidate]);
    if (!existing) break;
    nextSeq++;
    candidate = `ADM${year}${String(nextSeq).padStart(4, '0')}`;
  }
  return candidate;
}

/**
 * Ensures the is_demo column exists on the users table across all MySQL environments
 */
async function ensureDemoColumn() {
  try {
    const [exists] = await db.query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'is_demo'`
    );
    if (!exists || exists.length === 0) {
      await db.query(`ALTER TABLE users ADD COLUMN is_demo BOOLEAN DEFAULT FALSE`);
    }
  } catch (err) {
    try {
      await db.query(`ALTER TABLE users ADD COLUMN is_demo BOOLEAN DEFAULT FALSE`);
    } catch (ignore) {}
  }
}

/**
 * Generates 10-15 demo students per class and 4 demo teachers
 */
async function generateDemoData(adminUserId = 1) {
  // Ensure the is_demo column exists in users table across all MySQL environments
  await ensureDemoColumn();

  // Reconcile any existing demo users by email pattern
  try {
    await db.query(`UPDATE users SET is_demo = 1 WHERE email LIKE '%.demo@school.erp' OR email LIKE 'adm%@school.erp'`);
  } catch (recErr) {}

  // Check if demo data already exists
  const [[{ existingDemo }]] = await db.query('SELECT COUNT(*) as existingDemo FROM users WHERE is_demo = 1');
  if (existingDemo > 0) {
    return { count: existingDemo, alreadyExists: true };
  }

  const defaultPasswordHash = await bcrypt.hash('student123', 10);
  const teacherPasswordHash = await bcrypt.hash('teacher123', 10);

  // 1. Fetch existing classes or create default classes if none exist
  let [classes] = await db.query('SELECT * FROM classes ORDER BY id ASC');
  if (classes.length === 0) {
    await db.query(`
      INSERT INTO classes (name, section, academic_year) VALUES 
      ('Class 9', 'A', '2026-27'),
      ('Class 10', 'A', '2026-27'),
      ('Class 8', 'A', '2026-27')
    `);
    [classes] = await db.query('SELECT * FROM classes ORDER BY id ASC');
  }

  // 2. Ensure each class has a Tuition Fee structure
  for (const c of classes) {
    const [structures] = await db.query('SELECT id FROM fee_structure WHERE class_id = ?', [c.id]);
    if (structures.length === 0) {
      await db.query(
        'INSERT INTO fee_structure (class_id, fee_type, amount, academic_year) VALUES (?, ?, ?, ?)',
        [c.id, 'Monthly Tuition Fee', 500.00, c.academic_year || '2026-27']
      );
    }
  }

  // 3. Create 4 Demo Teachers
  const demoTeachers = [
    { name: 'Dr. Anand Verma', dept: 'Science', desig: 'Senior PGT Teacher', phone: '9838112233', qual: 'M.Sc, B.Ed, Ph.D' },
    { name: 'Mrs. Sunita Devi', dept: 'Hindi', desig: 'TGT Hindi Teacher', phone: '9838223344', qual: 'M.A Hindi, B.Ed' },
    { name: 'Mr. Rakesh Pandey', dept: 'Mathematics', desig: 'PGT Math Teacher', phone: '9838334455', qual: 'M.Sc Math, B.Ed' },
    { name: 'Ms. Neha Gupta', dept: 'English', desig: 'TGT English Teacher', phone: '9838445566', qual: 'M.A English, B.Ed' }
  ];

  const year = new Date().getFullYear().toString().slice(-2);
  let teachCount = 10;
  for (const t of demoTeachers) {
    const email = `teacher.${t.name.split(' ')[1].toLowerCase()}.demo@school.erp`;
    const [[existing]] = await db.query('SELECT id FROM users WHERE email = ?', [email]);
    if (existing) {
      await db.query('UPDATE users SET is_demo = 1 WHERE id = ?', [existing.id]);
      continue;
    }
    const [uRes] = await db.query(
      `INSERT INTO users (name, email, password, role, phone, is_demo) VALUES (?, ?, ?, 'teacher', ?, 1)`,
      [t.name, email, teacherPasswordHash, t.phone]
    );
    const empId = `EMP${year}${String(teachCount++).padStart(4, '0')}`;
    await db.query(
      `INSERT INTO teachers (user_id, employee_id, department, designation, qualification, salary) VALUES (?, ?, ?, ?, ?, 25000.00)`,
      [uRes.insertId, empId, t.dept, t.desig, t.qual]
    );
  }

  // 4. Student Name Pools
  const studentProfiles = [
    { name: 'Aarav Sharma', gender: 'Male', father: 'Rajesh Sharma', mother: 'Sunita Sharma', van: true, route: 'Karma Bazar', fee: 500, prevBal: 0, paidUpto: 'NOV' },
    { name: 'Ananya Verma', gender: 'Female', father: 'Sunil Verma', mother: 'Geeta Verma', van: false, route: null, fee: 0, prevBal: 0, paidUpto: 'NOV' },
    { name: 'Aryan Singh', gender: 'Male', father: 'Mahendra Singh', mother: 'Rekha Singh', van: true, route: 'Vijay Nagar', fee: 450, prevBal: 800, prevRemarks: 'Class 8 pending fee', paidUpto: 'OCT' },
    { name: 'Diya Yadav', gender: 'Female', father: 'Santosh Yadav', mother: 'Pooja Yadav', van: true, route: 'Karma Bazar', fee: 500, prevBal: 0, paidUpto: 'DEC' },
    { name: 'Ishaan Mishra', gender: 'Male', father: 'Vinod Mishra', mother: 'Meera Mishra', van: false, route: null, fee: 0, prevBal: 0, paidUpto: 'OCT' },
    { name: 'Kavya Pandey', gender: 'Female', father: 'Dinesh Pandey', mother: 'Usha Pandey', van: true, route: 'Gohania', fee: 600, prevBal: 0, paidUpto: 'DEC' },
    { name: 'Manish Gupta', gender: 'Male', father: 'Ashok Gupta', mother: 'Shanti Gupta', van: false, route: null, fee: 0, prevBal: 500, prevRemarks: 'Exam fee balance', paidUpto: 'SEP' },
    { name: 'Neha Patel', gender: 'Female', father: 'Sanjay Patel', mother: 'Kamla Patel', van: true, route: 'Vijay Nagar', fee: 450, prevBal: 0, paidUpto: 'NOV' },
    { name: 'Pooja Dubey', gender: 'Female', father: 'Akhilesh Dubey', mother: 'Suman Dubey', van: false, route: null, fee: 0, prevBal: 0, paidUpto: 'AUG' },
    { name: 'Rahul Tiwari', gender: 'Male', father: 'Manoj Tiwari', mother: 'Sangeeta Tiwari', van: true, route: 'Kaurihar', fee: 550, prevBal: 0, paidUpto: 'APR' },
    { name: 'Riya Chauhan', gender: 'Female', father: 'Pramod Chauhan', mother: 'Kavita Chauhan', van: false, route: null, fee: 0, prevBal: 0, paidUpto: null },
    { name: 'Rohan Maurya', gender: 'Male', father: 'Arun Maurya', mother: 'Anita Maurya', van: true, route: 'Karma Bazar', fee: 500, prevBal: 1200, prevRemarks: 'Old session arrears', paidUpto: 'OCT' }
  ];

  const sessionMonthsOrder = ['APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC', 'JAN', 'FEB', 'MAR'];
  let totalCreatedStudents = 0;

  for (const c of classes) {
    // Get tuition fee structure for this class
    const [[struct]] = await db.query('SELECT id, amount FROM fee_structure WHERE class_id = ? LIMIT 1', [c.id]);
    const tuitionRate = struct ? parseFloat(struct.amount) : 500;

    let roll = 1;
    for (const p of studentProfiles) {
      const admNo = await getNextSequentialAdmissionNo();
      const email = `${admNo.toLowerCase()}@school.erp`;
      const phone = `9838${Math.floor(100000 + Math.random() * 900000)}`;
      const aadhaar = `76${Math.floor(10 + Math.random() * 89)}${Math.floor(1000 + Math.random() * 9000)}${Math.floor(1000 + Math.random() * 9000)}`;
      
      const birthYear = 2010 + (roll % 4);
      const dob = `${birthYear}-0${(roll % 9) + 1}-1${roll % 8}`;

      const [uRes] = await db.query(
        `INSERT INTO users (name, email, password, role, phone, address, is_demo) VALUES (?, ?, ?, 'student', ?, ?, 1)`,
        [p.name, email, defaultPasswordHash, phone, `${p.route || 'Vijay Nagar'}, Karma Bazar, Prayagraj`]
      );

      const [sRes] = await db.query(
        `INSERT INTO students 
         (user_id, admission_no, class_id, roll_number, date_of_birth, gender,
          father_name, mother_name, guardian_name, guardian_phone, emergency_contact,
          aadhaar_no, previous_balance, previous_balance_remarks, uses_transport,
          transport_route, transport_fee) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          uRes.insertId,
          admNo,
          c.id,
          roll++,
          dob,
          p.gender,
          p.father,
          p.mother,
          p.father,
          phone,
          phone,
          aadhaar,
          p.prevBal || 0,
          p.prevRemarks || null,
          p.van ? 1 : 0,
          p.route || null,
          p.fee || 0
        ]
      );

      const studentId = sRes.insertId;
      totalCreatedStudents++;

      // Create fee payment history according to paidUpto
      if (p.paidUpto) {
        const uptoIndex = sessionMonthsOrder.indexOf(p.paidUpto);
        if (uptoIndex >= 0) {
          const paidMonths = sessionMonthsOrder.slice(0, uptoIndex + 1);
          const totalMonthsCount = paidMonths.length;
          const monthlyFeeTotal = tuitionRate + (p.van ? p.fee : 0);
          const totalPaidAmt = monthlyFeeTotal * totalMonthsCount;
          
          const breakdown = [
            { name: `Tuition Fee (${paidMonths.join(', ')})`, amount: tuitionRate * totalMonthsCount }
          ];
          if (p.van && p.fee > 0) {
            breakdown.push({
              name: `School Van / Transport Fee (${paidMonths.join(', ')})`,
              amount: p.fee * totalMonthsCount
            });
          }

          const receiptNo = 'RCP' + (Date.now() + totalCreatedStudents);
          await db.query(
            `INSERT INTO fee_payments 
             (student_id, fee_structure_id, amount_paid, payment_mode, receipt_no, remarks, collected_by, payment_date, months_paid, breakdown_json)
             VALUES (?, ?, ?, 'Cash', ?, ?, ?, CURDATE(), ?, ?)`,
            [
              studentId,
              struct ? struct.id : null,
              totalPaidAmt,
              receiptNo,
              'Demo Fee Collection Record',
              adminUserId,
              paidMonths.join(', '),
              JSON.stringify(breakdown)
            ]
          );
        }
      }
    }
  }

  return { students: totalCreatedStudents, teachers: demoTeachers.length };
}

/**
 * Deletes all demo students, demo teachers, and all related demo data
 */
async function clearDemoData() {
  await ensureDemoColumn();
  const [[{ count }]] = await db.query(
    "SELECT COUNT(*) as count FROM users WHERE is_demo = 1 OR email LIKE '%.demo@school.erp'"
  );
  if (count > 0) {
    // ON DELETE CASCADE on students and teachers automatically cleans all related records
    await db.query("DELETE FROM users WHERE is_demo = 1 OR email LIKE '%.demo@school.erp'");
  }
  return count;
}

module.exports = {
  ensureDemoColumn,
  getNextSequentialAdmissionNo,
  generateDemoData,
  clearDemoData
};
