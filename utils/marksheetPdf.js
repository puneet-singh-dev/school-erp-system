const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');

/**
 * Generates an A4 Landscape Tabulation Sheet / Class-wise Marks Broadsheet PDF
 */
function generateClassMarksPDF(res, selectedClass, selectedExam, students, subjects, marksMap) {
  const doc = new PDFDocument({
    size: 'A4',
    layout: 'landscape',
    margin: 25
  });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename=marks_sheet_${selectedClass.name}_${selectedExam.name}.pdf`);
  doc.pipe(res);

  const schoolName = process.env.SCHOOL_NAME || 'Shri Amrit Lal Smarak School And College';
  const schoolAddress = process.env.SCHOOL_ADDRESS || 'Vijay Nagar, Karma Bazar, Prayagraj (U.P)';
  const schoolPhone = '9129914501';

  // Header Box
  doc.rect(25, 20, 791, 62).fillAndStroke('#1a365d', '#000');

  // School Logo
  const logoPath = path.join(__dirname, '../public/img/logo.png');
  if (fs.existsSync(logoPath)) {
    try {
      doc.image(logoPath, 34, 25, { width: 52, height: 52 });
    } catch (e) {}
  }

  // Header Titles
  doc.fillColor('white').font('Helvetica-Bold').fontSize(14)
     .text(schoolName.toUpperCase(), 95, 26, { width: 620, align: 'center' });
  doc.font('Helvetica').fontSize(8.5).fillColor('#e2e8f0')
     .text(`${schoolAddress}  |  Contact: ${schoolPhone}`, 95, 43, { width: 620, align: 'center' });
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#f6e05e')
     .text(`TABULATION SHEET & MARKS STATEMENT  (SESSION 2026-27)`, 95, 56, { width: 620, align: 'center' });

  // Class & Exam Sub-Bar
  doc.rect(25, 86, 791, 20).fillAndStroke('#edf2f7', '#cbd5e0');
  doc.fillColor('#2d3748').font('Helvetica-Bold').fontSize(8.5);
  doc.text(`Class: ${selectedClass.name} - ${selectedClass.section}`, 35, 92);
  doc.text(`Examination: ${selectedExam.name}`, 300, 92);
  doc.text(`Date: ${new Date().toLocaleDateString('en-IN')}`, 700, 92, { width: 105, align: 'right' });

  // Table Configuration
  const startX = 25;
  let curY = 112;
  const colRollW = 32;
  const colAdmW = 60;
  const colNameW = 120;
  const colTotW = 55;
  const colPctW = 42;
  const colGrdW = 38;
  const colResW = 48;

  const fixedWidths = colRollW + colAdmW + colNameW + colTotW + colPctW + colGrdW + colResW;
  const availableForSubs = 791 - fixedWidths;
  const subColW = subjects.length > 0 ? Math.floor(availableForSubs / subjects.length) : 60;

  // Table Header Row
  doc.rect(startX, curY, 791, 22).fillAndStroke('#2b6cb0', '#000');
  doc.fillColor('white').font('Helvetica-Bold').fontSize(7.5);

  let x = startX;
  doc.text('Roll', x, curY + 6, { width: colRollW, align: 'center' }); x += colRollW;
  doc.text('Adm No', x, curY + 6, { width: colAdmW, align: 'center' }); x += colAdmW;
  doc.text('Student Name', x + 4, curY + 6, { width: colNameW - 8, align: 'left' }); x += colNameW;

  subjects.forEach(sub => {
    doc.text(`${sub.name.slice(0, 10)}\n(${sub.max_marks})`, x, curY + 2, { width: subColW, align: 'center' });
    x += subColW;
  });

  doc.text('Total', x, curY + 6, { width: colTotW, align: 'center' }); x += colTotW;
  doc.text('%', x, curY + 6, { width: colPctW, align: 'center' }); x += colPctW;
  doc.text('Grade', x, curY + 6, { width: colGrdW, align: 'center' }); x += colGrdW;
  doc.text('Result', x, curY + 6, { width: colResW, align: 'center' });

  curY += 22;

  // Student Data Rows
  let passCount = 0;
  let failCount = 0;

  students.forEach((s, idx) => {
    // Check if new page is needed
    if (curY > 520) {
      doc.addPage({ size: 'A4', layout: 'landscape', margin: 25 });
      curY = 30;
    }

    let totalObt = 0;
    let totalMax = 0;
    let isPass = true;

    const rowH = 16;
    if (idx % 2 === 0) {
      doc.rect(startX, curY, 791, rowH).fill('#f7fafc');
    }
    doc.rect(startX, curY, 791, rowH).stroke('#cbd5e0');

    doc.fillColor('#000').font('Helvetica').fontSize(7);
    x = startX;
    doc.text(String(s.roll_number || '-'), x, curY + 4, { width: colRollW, align: 'center' }); x += colRollW;
    doc.text(s.admission_no, x, curY + 4, { width: colAdmW, align: 'center' }); x += colAdmW;
    doc.font('Helvetica-Bold').text(s.name, x + 4, curY + 4, { width: colNameW - 8, align: 'left' }).font('Helvetica'); x += colNameW;

    subjects.forEach(sub => {
      const res = marksMap[`${s.id}_${sub.id}`];
      const marks = res ? parseFloat(res.marks_obtained) : null;
      if (marks !== null) {
        totalObt += marks;
        totalMax += sub.max_marks;
        if ((marks / sub.max_marks) * 100 < 33) isPass = false;
        doc.text(marks.toFixed(1), x, curY + 4, { width: subColW, align: 'center' });
      } else {
        totalMax += sub.max_marks;
        doc.fillColor('#a0aec0').text('-', x, curY + 4, { width: subColW, align: 'center' }).fillColor('#000');
      }
      x += subColW;
    });

    const pct = totalMax > 0 ? (totalObt / totalMax * 100).toFixed(1) : 0;
    const grade = pct >= 90 ? 'A+' : pct >= 80 ? 'A' : pct >= 70 ? 'B' : pct >= 60 ? 'C' : pct >= 50 ? 'D' : 'F';
    const status = isPass && pct >= 33 ? 'PASS' : 'FAIL';
    if (status === 'PASS') passCount++; else failCount++;

    doc.font('Helvetica-Bold').text(`${totalObt.toFixed(0)}/${totalMax}`, x, curY + 4, { width: colTotW, align: 'center' }); x += colTotW;
    doc.text(`${pct}%`, x, curY + 4, { width: colPctW, align: 'center' }); x += colPctW;
    doc.text(grade, x, curY + 4, { width: colGrdW, align: 'center' }); x += colGrdW;
    doc.fillColor(status === 'PASS' ? '#22543d' : '#742a2a').text(status, x, curY + 4, { width: colResW, align: 'center' }).fillColor('#000');

    curY += rowH;
  });

  // Footer Summary & Signatures
  if (curY > 500) {
    doc.addPage({ size: 'A4', layout: 'landscape', margin: 25 });
    curY = 30;
  }

  curY += 16;
  doc.rect(startX, curY, 320, 36).fillAndStroke('#edf2f7', '#cbd5e0');
  doc.fillColor('#2d3748').font('Helvetica-Bold').fontSize(8);
  doc.text(`Class Strength: ${students.length}   |   Passed: ${passCount}   |   Failed: ${failCount}`, startX + 10, curY + 8);
  doc.text(`Overall Class Pass Percentage: ${students.length > 0 ? ((passCount / students.length) * 100).toFixed(1) : 0}%`, startX + 10, curY + 20);

  // Signatures on right
  const sigY = curY + 28;
  doc.fillColor('#000').font('Helvetica').fontSize(8.5);
  doc.moveTo(420, sigY).lineTo(520, sigY).stroke('#4a5568');
  doc.text('Class Teacher', 420, sigY + 4, { width: 100, align: 'center' });

  doc.moveTo(560, sigY).lineTo(660, sigY).stroke('#4a5568');
  doc.text('Exam Incharge', 560, sigY + 4, { width: 100, align: 'center' });

  doc.moveTo(700, sigY).lineTo(800, sigY).stroke('#4a5568');
  doc.font('Helvetica-Bold').text('Principal', 700, sigY + 4, { width: 100, align: 'center' });

  doc.end();
}

module.exports = { generateClassMarksPDF };
