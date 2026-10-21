const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');
const moment = require('moment');

/**
 * Draws a single Unpaid Fee Reminder Notice slip based on the school notice slip format.
 * Formatted to fit exactly 4 slips on a single A4 sheet (2 columns x 2 rows).
 */
function drawSingleFeeNoticeSlip(doc, student, schoolInfo, x, y, width, height) {
  doc.save();

  // Outer Border Box
  doc.lineWidth(0.8).strokeColor('#1e293b');
  doc.rect(x, y, width, height).stroke();

  const padX = x + 10;
  const contentW = width - 20;

  // Header Section with Logo
  const logoPath = path.join(__dirname, '../public/img/logo.png');
  const logoSize = 32;
  let textStartX = padX;
  let textAvailableW = contentW;

  if (fs.existsSync(logoPath)) {
    try {
      doc.image(logoPath, padX, y + 6, { width: logoSize, height: logoSize });
      textStartX = padX + logoSize + 6;
      textAvailableW = contentW - logoSize - 6;
    } catch (e) {}
  }

  // School Name (Uppercase, bold)
  const schoolName = (schoolInfo && schoolInfo.name)
    ? schoolInfo.name.toUpperCase()
    : 'SHRI AMRIT LAL SMARAK SCHOOL AND COLLEGE';
  
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#0f172a');
  doc.text(schoolName, textStartX, y + 6, { width: textAvailableW, align: 'center', lineGap: 1 });

  // School Address
  const schoolAddress = (schoolInfo && schoolInfo.address)
    ? schoolInfo.address
    : 'Vijay Nagar, Karma Bazar, Prayagraj (U.P.)';
  
  doc.font('Helvetica').fontSize(6.5).fillColor('#475569');
  doc.text(schoolAddress, textStartX, doc.y + 1, { width: textAvailableW, align: 'center', lineGap: 1 });

  // Document Heading: Unpaid Fee Notice
  doc.font('Helvetica-Bold').fontSize(8).fillColor('#000000');
  doc.text('Unpaid Fee Notice', textStartX, doc.y + 2, { width: textAvailableW, align: 'center' });

  // Dividing Line Under Header
  const headerBottomY = Math.max(y + 45, doc.y + 4);
  doc.lineWidth(0.6).strokeColor('#334155');
  doc.moveTo(x, headerBottomY).lineTo(x + width, headerBottomY).stroke();

  // Student Details Key-Value Section
  let curY = headerBottomY + 6;
  const labelColW = 50;
  const colonX = padX + labelColW;
  const valColX = colonX + 6;
  const valColW = contentW - labelColW - 6;
  const rowHeight = 12.5;

  const studentDetails = [
    { label: 'Adm No.', val: student.admission_no || '-' },
    { label: 'Student', val: student.name || '-' },
    { label: 'Father', val: student.father_name || '-' },
    { label: 'Class/Sec', val: `${student.class_name || '-'} / ${student.section || 'A'}` },
    { label: 'Address', val: (student.address || 'Karma Bazar, Prayagraj').replace(/\r?\n|\r/g, ' ') }
  ];

  studentDetails.forEach(item => {
    doc.font('Helvetica').fontSize(7.5).fillColor('#334155');
    doc.text(item.label, padX, curY, { width: labelColW });
    doc.text(':', colonX, curY);
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#000000');
    doc.text(item.val, valColX, curY, { width: valColW, lineBreak: false, ellipsis: true });
    curY += rowHeight;
  });

  // Salutation: Dear Parents/ Guardians
  curY += 2;
  doc.font('Helvetica-Bold').fontSize(8).fillColor('#0f172a');
  doc.text('Dear Parents/ Guardians', padX, curY);
  curY += 12;

  // Notice Body Paragraph
  // Build breakdown string: e.g. Bal. SEP (1500),OCT (1700)
  const prevBal = parseFloat(student.previous_balance || 0);
  const monthlyRate = parseFloat(student.monthly_rate || student.monthly_tuition || 500);
  const unpaidMonths = student.unpaid_months || [];

  let breakdownItems = [];
  if (prevBal > 0) {
    breakdownItems.push(`Bal. (${Math.round(prevBal)})`);
  }
  unpaidMonths.forEach(m => {
    breakdownItems.push(`${m} (${Math.round(monthlyRate)})`);
  });

  let breakdownText = breakdownItems.join(',');
  if (!breakdownText) {
    breakdownText = student.pending_months_text || 'Current Session';
  }

  const totalAmount = Math.round(parseFloat(student.balance || student.total_fees || 0));

  const noticeBodyText = `This is to remind you that your ward fees due for the month(s) of ${breakdownText} total amount Rs. ${totalAmount} . Kindly Co-Operate and Pay immediately.`;

  doc.font('Helvetica').fontSize(7.6).fillColor('#1e293b');
  doc.text(noticeBodyText, padX, curY, {
    width: contentW,
    align: 'left',
    lineGap: 2.2
  });

  // Thank You
  const thankYouY = y + height - 36;
  doc.font('Helvetica-Bold').fontSize(8).fillColor('#0f172a');
  doc.text('Thank You', padX, thankYouY);

  // Footer: Date on Left, Principal on Right
  const footerY = y + height - 20;
  const todayDateStr = moment().format('DD/MM/YYYY');
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#000000');
  doc.text(`Date: ${todayDateStr}`, padX, footerY);

  doc.font('Helvetica-Bold').fontSize(8).fillColor('#000000');
  doc.text('Principal', padX + contentW - 75, footerY, { width: 75, align: 'right' });

  doc.restore();
}

/**
 * Draws dashed scissor cutting lines between the 4 notice slots on an A4 page.
 */
function drawCutLines(doc) {
  doc.save();

  // Vertical center cut line at X = 297.64
  const vCutX = 297.64;
  doc.lineWidth(0.5).strokeColor('#94a3b8').dash(3, { space: 3 });
  doc.moveTo(vCutX, 10).lineTo(vCutX, 831.89).stroke();

  // Horizontal center cut line at Y = 420.94
  const hCutY = 420.94;
  doc.lineWidth(0.5).strokeColor('#94a3b8').dash(3, { space: 3 });
  doc.moveTo(10, hCutY).lineTo(585.28, hCutY).stroke();

  // Scissor icon / text helpers on the cutting guides
  doc.font('Helvetica').fontSize(6).fillColor('#64748b');
  doc.text('✂', vCutX - 3, 14);
  doc.text('✂', vCutX - 3, hCutY - 3);
  doc.text('✂', vCutX - 3, 824);

  doc.text('✂', 14, hCutY - 3);
  doc.text('✂', 574, hCutY - 3);

  doc.restore();
}

/**
 * Generates Fee Reminder Notice PDF with exactly 4 student notices per A4 sheet (2x2 grid).
 */
function generateClassFeeRemindersHindiPDF(res, selectedClass, studentsList, classFeeStructure = []) {
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 0, bottom: 0, left: 0, right: 0 }
  });

  const className = (selectedClass && selectedClass.name) ? selectedClass.name.replace(/\s+/g, '_') : 'Class';
  const classSec = (selectedClass && selectedClass.section) ? selectedClass.section : 'All';
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename=fee_notices_${className}_${classSec}.pdf`);
  doc.pipe(res);

  const schoolInfo = {
    name: (process.env.SCHOOL_NAME && process.env.SCHOOL_NAME !== 'School ERP')
      ? process.env.SCHOOL_NAME
      : 'Shri Amrit Lal Smarak School And College',
    address: process.env.SCHOOL_ADDRESS || 'Vijay Nagar, Karma Bazar, Prayagraj (U.P) - 211010'
  };

  // Dimensions for 2x2 layout on A4 (595.28 pt x 841.89 pt)
  const slipW = 268;
  const slipH = 390;

  // 4 Slot Coordinates
  const slots = [
    { x: 18, y: 16 },   // Top-Left (Slot 0)
    { x: 307, y: 16 },  // Top-Right (Slot 1)
    { x: 18, y: 434 },  // Bottom-Left (Slot 2)
    { x: 307, y: 434 }  // Bottom-Right (Slot 3)
  ];

  studentsList.forEach((student, index) => {
    const slotIndex = index % 4;

    // Start a new A4 page every 4 students
    if (index > 0 && slotIndex === 0) {
      doc.addPage({ size: 'A4', margins: { top: 0, bottom: 0, left: 0, right: 0 } });
    }

    // Draw cut lines once per new page
    if (slotIndex === 0) {
      drawCutLines(doc);
    }

    const pos = slots[slotIndex];
    drawSingleFeeNoticeSlip(doc, student, schoolInfo, pos.x, pos.y, slipW, slipH);
  });

  doc.end();
}

module.exports = {
  generateClassFeeRemindersHindiPDF,
  generateFeeReminderNoticesPDF: generateClassFeeRemindersHindiPDF
};
