const PDFDocument = require('pdfkit');
const moment = require('moment');

/**
 * Generates a clean, compact Student Information List PDF
 * Header contains ONLY:
 * 1. School Name (e.g., Shri Amrit Lal Smarak School And College)
 * 2. Class (e.g., Class 9 - A)
 * 3. Class Teacher (e.g., Shiksha Singh)
 * 
 * Columns are customizable based on admin selection.
 */
function generateStudentListPDF(res, students, classInfo, selectedFields = []) {
  // Available field configurations
  const fieldDefs = {
    roll_number: { label: 'Roll No', width: 45, align: 'center', getVal: s => s.roll_number ? String(s.roll_number) : '-' },
    admission_no: { label: 'Adm No', width: 65, align: 'center', getVal: s => s.admission_no || '-' },
    name: { label: 'Student Name', width: 110, align: 'left', getVal: s => s.name || '-' },
    father_name: { label: "Father's Name", width: 105, align: 'left', getVal: s => s.father_name || s.guardian_name || '-' },
    mother_name: { label: "Mother's Name", width: 95, align: 'left', getVal: s => s.mother_name || '-' },
    date_of_birth: { 
      label: 'Date of Birth', 
      width: 70, 
      align: 'center', 
      getVal: s => s.date_of_birth ? moment(s.date_of_birth).format('DD/MM/YYYY') : '-' 
    },
    aadhaar_no: { label: 'Aadhaar No', width: 85, align: 'center', getVal: s => s.aadhaar_no ? String(s.aadhaar_no).replace(/(\d{4})(\d{4})(\d{4})/, '$1 $2 $3') : '-' },
    phone: { label: 'Mobile No', width: 75, align: 'center', getVal: s => s.phone || s.guardian_phone || '-' },
    gender: { label: 'Gender', width: 50, align: 'center', getVal: s => s.gender || '-' },
    category: { label: 'Category', width: 55, align: 'center', getVal: s => s.category || '-' },
    address: { label: 'Address', width: 120, align: 'left', getVal: s => s.address ? s.address.substring(0, 35) : '-' },
    transport: { 
      label: 'Van / Route', 
      width: 80, 
      align: 'center', 
      getVal: s => s.uses_transport ? (s.transport_route ? s.transport_route.substring(0, 16) : 'Van') : 'No Van' 
    },
    previous_balance: { 
      label: 'Prev Due', 
      width: 60, 
      align: 'right', 
      getVal: s => (s.previous_balance && parseFloat(s.previous_balance) > 0) ? `₹${parseFloat(s.previous_balance).toFixed(0)}` : '0' 
    }
  };

  // If no fields specified or empty, use clean default columns
  let activeFieldKeys = selectedFields.filter(k => fieldDefs[k]);
  if (!activeFieldKeys || activeFieldKeys.length === 0) {
    activeFieldKeys = ['roll_number', 'name', 'father_name', 'date_of_birth', 'aadhaar_no', 'phone'];
  }

  // Determine if landscape orientation is better for readability
  // Calculate total needed width
  let totalContentWidth = 30; // for serial number "#"
  activeFieldKeys.forEach(k => {
    totalContentWidth += fieldDefs[k].width;
  });

  const isLandscape = totalContentWidth > 520 || activeFieldKeys.length >= 6;
  const pageWidth = isLandscape ? 841.89 : 595.28;
  const pageHeight = isLandscape ? 595.28 : 841.89;
  const margin = 28;
  const usableWidth = pageWidth - (margin * 2);

  // Proportionally scale column widths to fit usable width perfectly
  const scale = usableWidth / totalContentWidth;
  const srColWidth = Math.round(30 * scale);
  const columns = [
    { key: 'sr', label: 'Sr', width: srColWidth, align: 'center', getVal: (s, idx) => String(idx + 1) }
  ];

  let allocatedWidth = srColWidth;
  activeFieldKeys.forEach((k, idx) => {
    const isLast = (idx === activeFieldKeys.length - 1);
    let colW = Math.round(fieldDefs[k].width * scale);
    if (isLast) {
      colW = usableWidth - allocatedWidth; // Absorb any rounding remainder
    } else {
      allocatedWidth += colW;
    }
    columns.push({
      key: k,
      label: fieldDefs[k].label,
      width: colW,
      align: fieldDefs[k].align,
      getVal: fieldDefs[k].getVal
    });
  });

  const doc = new PDFDocument({
    size: 'A4',
    layout: isLandscape ? 'landscape' : 'portrait',
    margin: margin,
    bufferPages: true
  });

  if (typeof res.setHeader === 'function') {
    res.setHeader('Content-Type', 'application/pdf');
    const safeClassName = classInfo ? `${classInfo.name}_${classInfo.section}`.replace(/\s+/g, '_') : 'All_Students';
    res.setHeader('Content-Disposition', `inline; filename=Student_List_${safeClassName}.pdf`);
  }
  doc.pipe(res);

  const schoolName = process.env.SCHOOL_NAME || 'SHRI AMRIT LAL SMARAK SCHOOL AND COLLEGE';
  const classNameText = classInfo ? `${classInfo.name} - ${classInfo.section} (${classInfo.academic_year || '2026-27'})` : 'All Classes';
  const teacherNameText = (classInfo && classInfo.class_teacher_name) ? classInfo.class_teacher_name : 'Not Assigned';

  // Helper function to draw header on each page
  function drawHeader(isFirstPage = false) {
    const startY = margin;
    
    // 1. School Name (Clean, Bold, Centered)
    doc.fillColor('#0f172a')
       .font('Helvetica-Bold')
       .fontSize(15)
       .text(schoolName.toUpperCase(), margin, startY, {
         width: usableWidth,
         align: 'center'
       });

    // 2. Class & Class Teacher Info Line (ONLY Class & Class Teacher as requested)
    const subHeaderY = startY + 20;
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#1e40af');
    doc.text(`Class: `, margin, subHeaderY, { continued: true })
       .font('Helvetica').fillColor('#0f172a').text(classNameText, { continued: false });

    // Class Teacher aligned to the right on the same line
    const teacherStr = `Class Teacher: ${teacherNameText}`;
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#1e40af')
       .text(teacherStr, margin, subHeaderY, {
         width: usableWidth,
         align: 'right'
       });

    // 3. Clean divider line
    const dividerY = subHeaderY + 16;
    doc.lineWidth(1)
       .strokeColor('#cbd5e1')
       .moveTo(margin, dividerY)
       .lineTo(margin + usableWidth, dividerY)
       .stroke();

    return dividerY + 6;
  }

  // Draw Table Header
  function drawTableHeader(y) {
    const rowHeight = 20;
    doc.rect(margin, y, usableWidth, rowHeight).fill('#1e3a8a');

    let currentX = margin;
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(8.5);
    
    columns.forEach(col => {
      doc.text(col.label, currentX + 3, y + 5.5, {
        width: col.width - 6,
        align: col.align
      });
      currentX += col.width;
    });

    return y + rowHeight;
  }

  let currentY = drawHeader(true);
  currentY = drawTableHeader(currentY);

  const rowHeight = 19;
  const bottomMargin = pageHeight - margin - 20;

  // Render Rows
  students.forEach((student, index) => {
    // Check if new page is needed
    if (currentY + rowHeight > bottomMargin) {
      doc.addPage();
      currentY = drawHeader(false);
      currentY = drawTableHeader(currentY);
    }

    // Alternating zebra row shading
    if (index % 2 === 1) {
      doc.rect(margin, currentY, usableWidth, rowHeight).fill('#f8fafc');
    }

    // Grid row border
    doc.lineWidth(0.4)
       .strokeColor('#e2e8f0')
       .rect(margin, currentY, usableWidth, rowHeight)
       .stroke();

    // Row cell text
    let currentX = margin;
    doc.fillColor('#1e293b').font('Helvetica').fontSize(8);

    columns.forEach(col => {
      const val = col.getVal(student, index);
      doc.text(String(val), currentX + 3, currentY + 5, {
        width: col.width - 6,
        align: col.align,
        ellipsis: true
      });
      currentX += col.width;
    });

    currentY += rowHeight;
  });

  // Footer on all pages (Summary & Page Number)
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const footerY = pageHeight - margin - 10;
    
    doc.lineWidth(0.5).strokeColor('#e2e8f0')
       .moveTo(margin, footerY - 4)
       .lineTo(margin + usableWidth, footerY - 4)
       .stroke();

    doc.font('Helvetica').fontSize(7.5).fillColor('#64748b');
    doc.text(`Total Students: ${students.length}`, margin, footerY);
    doc.text(`Print Date: ${moment().format('DD/MM/YYYY hh:mm A')}`, margin, footerY, {
      width: usableWidth,
      align: 'center'
    });
    doc.text(`Page ${i + 1} of ${range.count}`, margin, footerY, {
      width: usableWidth,
      align: 'right'
    });
  }

  doc.end();
}

module.exports = { generateStudentListPDF };
