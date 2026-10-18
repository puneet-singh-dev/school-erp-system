const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');

/**
 * Generates an official A4 Landscape Class Student Roll List & Report PDF
 */
function generateClassStudentListPDF(res, selectedClass, students) {
  const doc = new PDFDocument({
    size: 'A4',
    layout: 'landscape',
    margin: 25,
    bufferPages: true
  });

  const filename = `student_list_${(selectedClass.name || 'class').replace(/[^a-zA-Z0-9]/g, '_')}_${(selectedClass.section || '').replace(/[^a-zA-Z0-9]/g, '_')}.pdf`;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
  doc.pipe(res);

  const schoolName = process.env.SCHOOL_NAME || 'Shri Amrit Lal Smarak School And College';
  const schoolAddress = process.env.SCHOOL_ADDRESS || 'Vijay Nagar, Karma Bazar, Prayagraj (U.P)';
  const schoolPhone = process.env.SCHOOL_PHONE || '9129914501';

  function drawHeader() {
    // School Banner
    doc.rect(25, 20, 792, 58).fillAndStroke('#1e293b', '#0f172a');

    // Logo
    const logoPath = path.join(__dirname, '../public/img/logo.png');
    if (fs.existsSync(logoPath)) {
      try {
        doc.image(logoPath, 34, 24, { width: 48, height: 48 });
      } catch (e) {}
    }

    // Header Text
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(14)
       .text(schoolName.toUpperCase(), 90, 25, { width: 630, align: 'center' });
    doc.font('Helvetica').fontSize(8.5).fillColor('#cbd5e1')
       .text(`${schoolAddress}   |   Mobile: ${schoolPhone}`, 90, 42, { width: 630, align: 'center' });
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#fbbf24')
       .text(`OFFICIAL CLASS STUDENT LIST & ENROLLMENT SHEET (SESSION: ${selectedClass.academic_year || '2026-27'})`, 90, 56, { width: 630, align: 'center' });

    // Class Sub-Bar
    doc.rect(25, 82, 792, 22).fillAndStroke('#f1f5f9', '#cbd5e1');
    doc.fillColor('#1e293b').font('Helvetica-Bold').fontSize(9);
    doc.text(`Class & Section: ${selectedClass.name} - ${selectedClass.section}`, 35, 88);
    doc.text(`Class Teacher: ${selectedClass.teacher_name || 'Not Assigned'}`, 280, 88);
    doc.text(`Total Students: ${students.length}`, 520, 88);
    doc.font('Helvetica').fontSize(8.5).fillColor('#475569');
    doc.text(`Date: ${new Date().toLocaleDateString('en-IN')}`, 700, 88, { width: 105, align: 'right' });

    // Table Header
    const curY = 108;
    doc.rect(25, curY, 792, 22).fillAndStroke('#334155', '#1e293b');
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(8);

    doc.text('Sr.', 28, curY + 6, { width: 22, align: 'center' });
    doc.text('Roll', 52, curY + 6, { width: 32, align: 'center' });
    doc.text('Adm No', 86, curY + 6, { width: 56, align: 'left' });
    doc.text('Student Name', 144, curY + 6, { width: 125, align: 'left' });
    doc.text("Father's Name", 271, curY + 6, { width: 120, align: 'left' });
    doc.text("Mother's Name", 393, curY + 6, { width: 110, align: 'left' });
    doc.text('Contact No', 505, curY + 6, { width: 68, align: 'left' });
    doc.text('Van Route', 575, curY + 6, { width: 85, align: 'left' });
    doc.text('DOB', 662, curY + 6, { width: 55, align: 'center' });
    doc.text('Gen', 719, curY + 6, { width: 25, align: 'center' });
    doc.text('Remarks / Sign', 746, curY + 6, { width: 68, align: 'center' });
  }

  drawHeader();

  let curY = 130;
  const rowH = 19;
  const maxY = 515;

  if (!students.length) {
    doc.rect(25, curY, 792, 35).fillAndStroke('#ffffff', '#e2e8f0');
    doc.fillColor('#64748b').font('Helvetica-Bold').fontSize(10)
       .text('No students enrolled in this class yet.', 25, curY + 12, { width: 792, align: 'center' });
    curY += 35;
  } else {
    students.forEach((s, idx) => {
      if (curY + rowH > maxY) {
        doc.addPage();
        drawHeader();
        curY = 130;
      }

      const bgColor = idx % 2 === 0 ? '#ffffff' : '#f8fafc';
      doc.rect(25, curY, 792, rowH).fillAndStroke(bgColor, '#cbd5e1');
      doc.fillColor('#1e293b').font('Helvetica').fontSize(8);

      const dobStr = s.date_of_birth ? new Date(s.date_of_birth).toLocaleDateString('en-IN') : '-';
      const vanInfo = (s.uses_transport == 1 || s.uses_transport === true)
        ? (s.transport_route || 'Adopted')
        : 'Self';

      doc.text(String(idx + 1), 28, curY + 5, { width: 22, align: 'center' });
      doc.font('Helvetica-Bold').text(s.roll_number != null ? String(s.roll_number) : '-', 52, curY + 5, { width: 32, align: 'center' });
      doc.font('Helvetica').text(s.admission_no || '-', 86, curY + 5, { width: 56, align: 'left' });
      doc.font('Helvetica-Bold').text(s.name || '-', 144, curY + 5, { width: 125, align: 'left' });
      doc.font('Helvetica').text(s.father_name || '-', 271, curY + 5, { width: 120, align: 'left' });
      doc.text(s.mother_name || '-', 393, curY + 5, { width: 110, align: 'left' });
      doc.text(s.phone || s.guardian_phone || '-', 505, curY + 5, { width: 68, align: 'left' });
      
      // Van route in distinct color if adopted
      if (vanInfo !== 'Self') {
        doc.fillColor('#0284c7').font('Helvetica-Bold').text(vanInfo, 575, curY + 5, { width: 85, align: 'left' });
      } else {
        doc.fillColor('#64748b').text('Self', 575, curY + 5, { width: 85, align: 'left' });
      }
      doc.fillColor('#1e293b').font('Helvetica');

      doc.text(dobStr, 662, curY + 5, { width: 55, align: 'center' });
      doc.text(s.gender ? s.gender.charAt(0).toUpperCase() : '-', 719, curY + 5, { width: 25, align: 'center' });
      doc.text('', 746, curY + 5, { width: 68, align: 'center' });

      curY += rowH;
    });
  }

  // Signature Blocks on final page
  const sigY = Math.max(curY + 25, 520);
  if (sigY + 40 > 565) {
    doc.addPage();
    drawHeader();
  }
  const finalSigY = Math.min(sigY, 525);
  doc.strokeColor('#94a3b8').lineWidth(1);

  // Line 1: Class Teacher
  doc.moveTo(40, finalSigY).lineTo(200, finalSigY).stroke();
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#1e293b')
     .text("Class Teacher's Signature", 40, finalSigY + 5, { width: 160, align: 'center' });

  // Line 2: Checked By / Exam Incharge
  doc.moveTo(330, finalSigY).lineTo(490, finalSigY).stroke();
  doc.text('Office / Checked By', 330, finalSigY + 5, { width: 160, align: 'center' });

  // Line 3: Principal & Seal
  doc.moveTo(620, finalSigY).lineTo(780, finalSigY).stroke();
  doc.text("Principal's Signature & Seal", 620, finalSigY + 5, { width: 160, align: 'center' });

  // Page Numbers in Footer
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.font('Helvetica').fontSize(7.5).fillColor('#64748b')
       .text(
         `Page ${i + 1} of ${range.count}   •   Generated from ${schoolName} ERP System`,
         25,
         570,
         { width: 792, align: 'center' }
       );
  }

  doc.end();
}

module.exports = { generateClassStudentListPDF };
