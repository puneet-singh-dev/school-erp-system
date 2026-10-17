const PDFDocument = require('pdfkit');
const moment = require('moment');
const path = require('path');
const fs = require('fs');
const { numberToWordsINR } = require('./numberToWords');

/**
 * Draws the school logo from public/img/logo.png with vector fallback
 */
function drawSchoolLogo(doc, x, y, size) {
  const logoPath = path.join(__dirname, '../public/img/logo.png');
  if (fs.existsSync(logoPath)) {
    try {
      doc.image(logoPath, x, y, { width: size, height: size });
      return;
    } catch (err) {
      console.warn('Could not render logo image, using fallback:', err.message);
    }
  }
  doc.save();
  // Fallback vector shield
  doc.lineWidth(1).strokeColor('#1b3a57').fillColor('#f4f7fb');
  doc.path(`M ${x} ${y} 
            L ${x + size} ${y} 
            L ${x + size} ${y + size * 0.6} 
            Q ${x + size * 0.5} ${y + size * 1.15} ${x} ${y + size * 0.6} 
            Z`).fillAndStroke();
  
  doc.fillColor('#1b3a57');
  doc.fontSize(size * 0.35).font('Helvetica-Bold');
  doc.text('ERP', x, y + size * 0.28, { width: size, align: 'center' });
  doc.restore();
}

/**
 * Draws a single receipt voucher (Student or College copy) inside specified bounds
 */
function drawReceiptVoucher(doc, p, x, y, w, h, copyType) {
  const schoolName = process.env.SCHOOL_NAME || 'Shri Amrit Lal Smarak School And College';
  const schoolAddress = process.env.SCHOOL_ADDRESS || 'Vijay Nagar, Karma Bazar, Prayagraj (U.P)';
  const schoolPhone = '9129914501'; // User specifically specified 9129914501

  // Outer voucher border
  doc.lineWidth(0.8).strokeColor('#000000');
  doc.rect(x, y, w, h).stroke();

  // 1. Header Box
  const headerBoxY = y + 4;
  const headerBoxH = 44;
  doc.roundedRect(x + 4, headerBoxY, w - 8, headerBoxH, 2).lineWidth(0.6).stroke('#333333');

  // School Emblem / Logo on the left
  drawSchoolLogo(doc, x + 7, headerBoxY + 5, 34);

  // School Info
  const textX = x + 44;
  const textW = w - 50;
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#000000')
     .text(schoolName.toUpperCase(), textX, headerBoxY + 4, { width: textW, align: 'center' });
  
  doc.font('Helvetica').fontSize(6.5).fillColor('#222222')
     .text(schoolAddress, textX, headerBoxY + 18, { width: textW, align: 'center' });
  
  doc.font('Helvetica-Bold').fontSize(6.5).fillColor('#000000')
     .text(`Mob - ${schoolPhone}`, textX, headerBoxY + 30, { width: textW, align: 'center' });

  // 2. Sub-Header (Academic year, Badge, Copy Type)
  const subY = y + 51;
  const academicYear = p.academic_year || '2026-27';
  doc.font('Helvetica-Bold').fontSize(7).fillColor('#000000')
     .text(academicYear, x + 6, subY + 3);

  // FEES RECEIPT badge box in center
  const badgeW = 66;
  const badgeH = 13;
  const badgeX = x + (w - badgeW) / 2;
  doc.rect(badgeX, subY, badgeW, badgeH).lineWidth(0.7).stroke('#000000');
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#000000')
     .text('FEES RECEIPT', badgeX, subY + 2.5, { width: badgeW, align: 'center' });

  // Copy Type on the right (Student copy / College copy)
  doc.font('Helvetica-BoldOblique').fontSize(7.5).fillColor('#000000')
     .text(copyType, x + w - 85, subY + 3, { width: 80, align: 'right' });

  // 3. Receipt No & Date Row
  const metaY = y + 67;
  const metaH = 13;
  doc.rect(x + 4, metaY, w - 8, metaH).lineWidth(0.6).stroke('#000000');
  doc.font('Helvetica-Bold').fontSize(7).fillColor('#000000')
     .text(`RECEIPT NO: ${p.receipt_no || '-'}`, x + 7, metaY + 2.5);
  doc.text(`DATE: ${moment(p.payment_date).format('DD/MM/YYYY')}`, x + w - 90, metaY + 2.5, { width: 84, align: 'right' });

  // 4. Student Information Box
  const infoY = y + 83;
  const infoH = 46;
  doc.rect(x + 4, infoY, w - 8, infoH).lineWidth(0.6).stroke('#000000');

  // Row 1: Admission No & Class
  doc.font('Helvetica-Bold').fontSize(6.5).text('Admission No: ', x + 7, infoY + 3, { continued: true })
     .font('Helvetica').text(p.admission_no || '-');
  doc.font('Helvetica-Bold').fontSize(6.5).text('Class: ', x + 160, infoY + 3, { continued: true })
     .font('Helvetica').text(`${p.class_name || ''} - ${p.section || ''}`);

  // Row 2: Student Name
  doc.font('Helvetica-Bold').fontSize(6.5).text('Student Name: ', x + 7, infoY + 13, { continued: true })
     .font('Helvetica-Bold').text(p.student_name || '-');

  // Row 3: Father's Name & Mother's Name
  doc.font('Helvetica-Bold').fontSize(6.5).text("Father's Name: ", x + 7, infoY + 23, { continued: true })
     .font('Helvetica').text(p.father_name || p.guardian_name || '-');
  doc.font('Helvetica-Bold').fontSize(6.5).text("MOTHER'S NAME: ", x + 145, infoY + 23, { continued: true })
     .font('Helvetica').text(p.mother_name || '-');

  // Row 4: Fee For
  doc.font('Helvetica-Bold').fontSize(6.5).text('Fee For: ', x + 7, infoY + 33, { continued: true })
     .font('Helvetica').text(p.fee_type || 'Tuition Fee');

  // 5. Particulars Table Grid
  const tableY = y + 132;
  const colSrW = 20;
  const colPartW = 180;
  const colAmtW = w - 8 - colSrW - colPartW; // ~68 pt
  const rowH = 13;

  // Table Header
  doc.rect(x + 4, tableY, w - 8, rowH).fillAndStroke('#f0f0f0', '#000000');
  doc.fillColor('#000000').font('Helvetica-Bold').fontSize(6.5);
  doc.text('Sr.', x + 4, tableY + 3, { width: colSrW, align: 'center' });
  doc.text('Particulars', x + 4 + colSrW + 4, tableY + 3, { width: colPartW - 6, align: 'left' });
  doc.text('Amount (₹)', x + 4 + colSrW + colPartW, tableY + 3, { width: colAmtW - 5, align: 'right' });

  // Vertical column dividers
  const tableBottomY = tableY + rowH * 7; // 7 rows total
  doc.moveTo(x + 4 + colSrW, tableY).lineTo(x + 4 + colSrW, tableBottomY).stroke('#000000');
  doc.moveTo(x + 4 + colSrW + colPartW, tableY).lineTo(x + 4 + colSrW + colPartW, tableBottomY).stroke('#000000');

  // Data rows (Fee breakdown)
  const feeItems = [
    { name: p.fee_type || 'FEE PAYMENT', amount: parseFloat(p.amount_paid) },
    { name: 'DEVELOPMENT & LAB FEES', amount: null },
    { name: 'EXAM & ACTIVITY FEES', amount: null }
  ];

  for (let i = 0; i < 3; i++) {
    const curRowY = tableY + rowH * (i + 1);
    doc.rect(x + 4, curRowY, w - 8, rowH).stroke('#000000');
    doc.font('Helvetica').fontSize(6.5).fillColor('#000000');
    doc.text(String(i + 1), x + 4, curRowY + 3, { width: colSrW, align: 'center' });
    doc.text(feeItems[i] ? feeItems[i].name : '', x + 4 + colSrW + 4, curRowY + 3, { width: colPartW - 6, align: 'left' });
    if (feeItems[i] && feeItems[i].amount !== null) {
      doc.text(feeItems[i].amount.toFixed(2), x + 4 + colSrW + colPartW, curRowY + 3, { width: colAmtW - 5, align: 'right' });
    }
  }

  // Row 4: Total Amount
  const totalRowY = tableY + rowH * 4;
  const totalAmount = parseFloat(p.total_amount || p.amount_paid);
  doc.rect(x + 4, totalRowY, w - 8, rowH).stroke('#000000');
  doc.font('Helvetica-Bold').fontSize(6.5).fillColor('#000000');
  doc.text('Total Amount', x + 4 + 6, totalRowY + 3, { width: colSrW + colPartW - 10, align: 'left' });
  doc.text(totalAmount.toFixed(2), x + 4 + colSrW + colPartW, totalRowY + 3, { width: colAmtW - 5, align: 'right' });

  // Row 5: Received Amt
  const recRowY = tableY + rowH * 5;
  const receivedAmount = parseFloat(p.amount_paid);
  doc.rect(x + 4, recRowY, w - 8, rowH).stroke('#000000');
  doc.font('Helvetica-Bold').fontSize(6.5).fillColor('#000000');
  doc.text('Received Amt:', x + 4 + 6, recRowY + 3, { width: colSrW + colPartW - 10, align: 'left' });
  doc.text(receivedAmount.toFixed(2), x + 4 + colSrW + colPartW, recRowY + 3, { width: colAmtW - 5, align: 'right' });

  // Row 6: Balance
  const balRowY = tableY + rowH * 6;
  const balance = Math.max(0, totalAmount - (parseFloat(p.cumulative_paid) || receivedAmount));
  doc.rect(x + 4, balRowY, w - 8, rowH).stroke('#000000');
  doc.font('Helvetica-Bold').fontSize(6.5).fillColor('#000000');
  doc.text('Balance:', x + 4 + 6, balRowY + 3, { width: colSrW + colPartW - 10, align: 'left' });
  doc.text(balance.toFixed(2), x + 4 + colSrW + colPartW, balRowY + 3, { width: colAmtW - 5, align: 'right' });

  // 6. Amount in words & Payment Mode
  const wordsY = balRowY + rowH + 4;
  doc.font('Helvetica-Bold').fontSize(6.2).fillColor('#000000')
     .text('Amount in words: ', x + 6, wordsY, { continued: true })
     .font('Helvetica').text(numberToWordsINR(receivedAmount));

  const modeY = wordsY + 12;
  doc.font('Helvetica-Bold').fontSize(6.5)
     .text('Payment Mode : ', x + 6, modeY, { continued: true })
     .font('Helvetica').text(p.payment_mode || 'Cash');

  // 7. Footer Box: Date Time & Collected By / Authorized Signatory
  const footerY = y + h - 42;
  const footerH = 38;
  doc.rect(x + 4, footerY, w - 8, footerH).lineWidth(0.6).stroke('#000000');
  
  // Left: Date Time
  doc.font('Helvetica-Bold').fontSize(6.5).fillColor('#000000')
     .text('Date Time', x + 7, footerY + 4);
  const paymentTime = p.created_at || p.payment_date;
  doc.font('Helvetica').fontSize(6.5)
     .text(moment(paymentTime).format('DD-MM-YYYY HH:mm:ss'), x + 7, footerY + 16);

  // Right: Collected By & Authorized Signatory
  const rightColW = 120;
  const rightColX = x + w - rightColW - 8;
  doc.font('Helvetica-Bold').fontSize(6.5)
     .text(`Collected By: ${p.collector_name || 'Admin'}`, rightColX, footerY + 4, { width: rightColW, align: 'right' });
  
  doc.moveTo(rightColX + 20, footerY + 23).lineTo(x + w - 8, footerY + 23).lineWidth(0.5).stroke('#888888');
  doc.font('Helvetica').fontSize(5.5).fillColor('#444444')
     .text('Authorized Signatory', rightColX, footerY + 26, { width: rightColW, align: 'right' });
}

/**
 * Generates the full A4 Sheet Fee Receipt:
 * - Top Half: Left = Student Copy, Right = College Copy
 * - Middle: Dotted cutting line
 * - Bottom Half: If second receipt provided, prints second student's copies.
 *                Otherwise leaves half page clean with only the dotted line.
 */
function generateFeeReceiptPDF(res, primaryPayment, secondPayment = null) {
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 0, bottom: 0, left: 0, right: 0 }
  });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename=receipt_${primaryPayment.receipt_no}.pdf`);
  doc.pipe(res);

  const voucherWidth = 276;
  const voucherHeight = 394;
  const topY = 14;

  // --- TOP HALF (First Student) ---
  // Left: Student Copy
  drawReceiptVoucher(doc, primaryPayment, 14, topY, voucherWidth, voucherHeight, 'Student copy');

  // Middle vertical cut line (between Student Copy and College Copy)
  doc.save();
  doc.moveTo(297, topY).lineTo(297, topY + voucherHeight).dash(3, { space: 3 }).strokeColor('#888888').stroke();
  doc.restore();

  // Right: College Copy
  drawReceiptVoucher(doc, primaryPayment, 304, topY, voucherWidth, voucherHeight, 'College copy');

  // --- HORIZONTAL HALF-PAGE CUTTING LINE (DOTTED LINE ONLY) ---
  const midY = 418;
  doc.save();
  doc.moveTo(10, midY).lineTo(585, midY).dash(4, { space: 4 }).strokeColor('#666666').stroke();
  doc.restore();

  // --- BOTTOM HALF (Second Student ONLY if provided) ---
  const bottomY = 430;
  if (secondPayment) {
    // Left: Student Copy
    drawReceiptVoucher(doc, secondPayment, 14, bottomY, voucherWidth, voucherHeight, 'Student copy');
    
    // Middle vertical cut line
    doc.save();
    doc.moveTo(297, bottomY).lineTo(297, bottomY + voucherHeight).dash(3, { space: 3 }).strokeColor('#888888').stroke();
    doc.restore();

    // Right: College Copy
    drawReceiptVoucher(doc, secondPayment, 304, bottomY, voucherWidth, voucherHeight, 'College copy');
  }
  // Bottom half has no text - only the dotted line above

  doc.end();
}

module.exports = {
  generateFeeReceiptPDF,
  drawReceiptVoucher
};
