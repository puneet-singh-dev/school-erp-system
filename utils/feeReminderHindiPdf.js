const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');
const moment = require('moment');

/**
 * Draws a single Hindi Fee Reminder Notice slip (takes ~262pt height)
 */
function drawSingleHindiReminderSlip(doc, student, pendingFees, y, height) {
  const x = 20;
  const w = 555;
  const logoPath = path.join(__dirname, '../public/img/logo.png');

  // Outer border
  doc.lineWidth(0.8).strokeColor('#000000');
  doc.rect(x, y, w, height).stroke();

  // Header Box
  const headH = 46;
  doc.rect(x, y, w, headH).fillAndStroke('#f8fafc', '#cbd5e0');

  // Logo on Left
  if (fs.existsSync(logoPath)) {
    try {
      doc.image(logoPath, x + 8, y + 4, { width: 38, height: 38 });
    } catch (e) {}
  }

  // School Header in Hindi
  doc.fillColor('#1e3a8a').font('Hindi').fontSize(11)
     .text('श्री अमृत लाल स्मारक स्कूल एवं कॉलेज', x + 50, y + 4, { width: w - 100, align: 'center' });
  
  doc.fillColor('#475569').fontSize(7.5)
     .text('विजय नगर, कर्मा बाज़ार, प्रयागराज (उ.प्र.)  |  मो. - 9129914501', x + 50, y + 18, { width: w - 100, align: 'center' });

  doc.fillColor('#b91c1c').fontSize(8.5)
     .text('शुल्क अनुस्मारक पत्र / फीस रिमाइंडर  (सत्र: 2026-27)', x + 50, y + 30, { width: w - 100, align: 'center' });

  // Notice Metadata Bar (Notice No & Date)
  const metaY = y + headH + 2;
  doc.fillColor('#000000').font('Hindi').fontSize(7.5);
  doc.text(`सूचना सं.: FR26/${String(student.admission_no).replace(/[^0-9]/g, '') || student.student_id}`, x + 8, metaY);
  doc.text(`दिनांक: ${moment().format('DD/MM/YYYY')}`, x + w - 110, metaY, { width: 100, align: 'right' });

  // Salutation: "प्रिय अभिभावक," (Without guardian name as requested)
  const salutationY = metaY + 12;
  doc.font('Hindi').fontSize(8.5).fillColor('#1e293b')
     .text('प्रिय अभिभावक,', x + 8, salutationY);

  // Student Details & Main Notice Message in Hindi
  const bodyY = salutationY + 13;
  const studentInfoLine = `सादर अवगत कराना है कि आपके पाल्य/पाल्या ${student.name}, कक्षा - ${student.class_name} (${student.section}), प्रवेश क्रमांक - ${student.admission_no}, रोल नं. - ${student.roll_number || '-'} का विद्यालय शुल्क निम्नानुसार बकाया है:`;
  
  doc.font('Hindi').fontSize(7.8).fillColor('#334155')
     .text(studentInfoLine, x + 8, bodyY, { width: w - 16, lineGap: 1.5 });

  // Mini Pending Fees Table
  const tableY = bodyY + 24;
  const col1W = 240;
  const col2W = 95;
  const col3W = 95;
  const col4W = 105;
  const rowH = 13.5;

  // Table Header
  doc.rect(x + 8, tableY, w - 16, rowH).fillAndStroke('#e2e8f0', '#000000');
  doc.fillColor('#000000').font('Hindi').fontSize(7);
  doc.text('शुल्क मद (Fee Particulars)', x + 12, tableY + 2.5, { width: col1W - 8 });
  doc.text('कुल शुल्क (Total)', x + 8 + col1W, tableY + 2.5, { width: col2W, align: 'right' });
  doc.text('जमा शुल्क (Paid)', x + 8 + col1W + col2W, tableY + 2.5, { width: col3W, align: 'right' });
  doc.text('बकाया राशि (Balance Due)', x + 8 + col1W + col2W + col3W - 5, tableY + 2.5, { width: col4W, align: 'right' });

  // Table Data Row
  const row1Y = tableY + rowH;
  doc.rect(x + 8, row1Y, w - 16, rowH + 2).stroke('#000000');
  doc.font('Hindi').fontSize(7.5);

  const feeTypesText = pendingFees && pendingFees.length > 0 ? pendingFees.map(f => f.fee_type).join(', ') : 'समस्त बकाया विद्यालय शुल्क';
  const totalAmount = parseFloat(student.total_fees || 0);
  const paidAmount = parseFloat(student.paid || 0);
  const balanceAmount = parseFloat(student.balance || (totalAmount - paidAmount));

  doc.text(feeTypesText.slice(0, 48), x + 12, row1Y + 3, { width: col1W - 8 });
  doc.text(`₹ ${totalAmount.toFixed(2)}`, x + 8 + col1W, row1Y + 3, { width: col2W, align: 'right' });
  doc.text(`₹ ${paidAmount.toFixed(2)}`, x + 8 + col1W + col2W, row1Y + 3, { width: col3W, align: 'right' });
  
  doc.fillColor('#b91c1c').text(`₹ ${balanceAmount.toFixed(2)}`, x + 8 + col1W + col2W + col3W - 5, row1Y + 3, { width: col4W, align: 'right' })
     .fillColor('#000000');

  // Appeal & Instructions in Hindi
  const requestY = row1Y + rowH + 6;
  const closingText = 'अतः आपसे सादर अनुरोध है कि कृपया आगामी ३ कार्य दिवसों में विद्यालय कार्यालय में उपस्थित होकर उक्त बकाया शुल्क जमा करने का कष्ट करें, जिससे छात्र/छात्रा के पठन-पाठन एवं परीक्षा में किसी प्रकार का व्यवधान न हो।';
  doc.font('Hindi').fontSize(7.5).fillColor('#334155')
     .text(closingText, x + 8, requestY, { width: w - 16, lineGap: 1.5 });

  // Footer Row: Note on Left & Principal Signature on Right
  const footY = y + height - 34;
  doc.font('Hindi').fontSize(6.5).fillColor('#64748b')
     .text('नोट: यदि आप उक्त शुल्क पूर्व में जमा कर चुके हैं, तो कृपया रसीद दिखाकर इसे संशोधित करा लें।', x + 8, footY + 8, { width: 330 });

  const sigX = x + w - 170;
  doc.fillColor('#1e293b').font('Hindi').fontSize(7.5)
     .text('प्रधानाचार्य / प्रबन्धक', sigX, footY + 4, { width: 160, align: 'right' });
  doc.fontSize(6.8).fillColor('#475569')
     .text('श्री अमृत लाल स्मारक स्कूल एवं कॉलेज', sigX, footY + 16, { width: 160, align: 'right' });
  doc.fontSize(6.5)
     .text('हेल्पलाइन: 9129914501', sigX, footY + 26, { width: 160, align: 'right' });
}

/**
 * Generates class-wise fee reminder notices:
 * Formatted with 3 student notices per A4 page, separated by dotted cutting lines.
 */
function generateClassFeeRemindersHindiPDF(res, selectedClass, studentsList, classFeeStructure = []) {
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 0, bottom: 0, left: 0, right: 0 }
  });

  const fontPath = path.join(__dirname, '../public/fonts/NotoSansDevanagari.ttf');
  doc.registerFont('Hindi', fontPath);

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename=fees_reminders_${selectedClass.name}_${selectedClass.section}.pdf`);
  doc.pipe(res);

  const slipHeight = 264;
  const startY1 = 12;
  const startY2 = 288;
  const startY3 = 564;

  const positions = [startY1, startY2, startY3];

  studentsList.forEach((student, index) => {
    const slotOnPage = index % 3;

    if (index > 0 && slotOnPage === 0) {
      doc.addPage({ size: 'A4', margins: { top: 0, bottom: 0, left: 0, right: 0 } });
    }

    const curY = positions[slotOnPage];
    drawSingleHindiReminderSlip(doc, student, classFeeStructure, curY, slipHeight);

    // Draw horizontal dashed cut line after slot 0 and slot 1
    if (slotOnPage === 0) {
      const cutY1 = 280;
      doc.save();
      doc.moveTo(10, cutY1).lineTo(585, cutY1).dash(4, { space: 4 }).strokeColor('#666666').stroke();
      doc.font('Helvetica-Bold').fontSize(6.5).fillColor('#666666');
      doc.text('✂ - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - CUT ALONG LINE - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - ✂', 10, cutY1 - 3, { width: 575, align: 'center' });
      doc.restore();
    } else if (slotOnPage === 1) {
      const cutY2 = 556;
      doc.save();
      doc.moveTo(10, cutY2).lineTo(585, cutY2).dash(4, { space: 4 }).strokeColor('#666666').stroke();
      doc.font('Helvetica-Bold').fontSize(6.5).fillColor('#666666');
      doc.text('✂ - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - CUT ALONG LINE - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - ✂', 10, cutY2 - 3, { width: 575, align: 'center' });
      doc.restore();
    }
  });

  doc.end();
}

module.exports = { generateClassFeeRemindersHindiPDF };
