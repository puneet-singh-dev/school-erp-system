const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');
const moment = require('moment');
const { isSubjectApplicableToStudent } = require('./csvMarksHelper');

/**
 * Generates official A4 Student Progress Report Card
 * Supports both:
 * 1. Consolidated Annual Report Card (1st Term + 2nd Term + 3rd Term/Annual + Pre-Board)
 * 2. Single Term Examination Report Card
 */
function generateReportCardPDF(res, student, currentExam, subjects, currentResults, classRanks = {}, allExams = [], allResults = []) {
  // Filter subjects based on student's UP Board optional subject
  const applicableSubjects = (subjects || []).filter(sub => isSubjectApplicableToStudent(sub.name, student.optional_subject));
  const doc = new PDFDocument({ size: 'A4', margin: 30 });
  const filename = `report_card_${student.admission_no}_${currentExam ? currentExam.name.replace(/\s+/g, '_') : 'annual'}.pdf`;

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
  doc.pipe(res);

  const schoolName = process.env.SCHOOL_NAME || 'Shri Amrit Lal Smarak School And College';
  const schoolAddress = process.env.SCHOOL_ADDRESS || 'Vijay Nagar, Karma Bazar, Prayagraj (U.P)';
  const schoolPhone = '9129914501';

  // Check if this is an Annual / Consolidated Exam report card
  const examNameLower = (currentExam?.name || '').toLowerCase();
  const isAnnualOrConsolidated = examNameLower.includes('annual') ||
                                 examNameLower.includes('3rd') ||
                                 examNameLower.includes('third') ||
                                 examNameLower.includes('final') ||
                                 allExams.length >= 2;

  // 1. Outer Border
  doc.lineWidth(1.2).strokeColor('#1a365d');
  doc.rect(25, 20, 545, 802).stroke();
  doc.lineWidth(0.5).strokeColor('#cbd5e0');
  doc.rect(28, 23, 539, 796).stroke();

  // 2. Header Banner with School Logo
  doc.rect(30, 25, 535, 76).fillAndStroke('#1a365d', '#1a365d');
  
  const logoPath = path.join(__dirname, '../public/img/logo.png');
  if (fs.existsSync(logoPath)) {
    try {
      doc.image(logoPath, 38, 30, { width: 64, height: 64 });
    } catch (e) {}
  }

  const headW = 440;
  const headX = 110;
  doc.fillColor('white').font('Helvetica-Bold').fontSize(14)
     .text(schoolName.toUpperCase(), headX, 33, { width: headW, align: 'center' });
  
  doc.font('Helvetica').fontSize(8.2).fillColor('#e2e8f0')
     .text(`${schoolAddress}   |   Mobile: ${schoolPhone}`, headX, 51, { width: headW, align: 'center' });
  
  const titleText = isAnnualOrConsolidated 
    ? 'ANNUAL CONSOLIDATED PROGRESS REPORT CARD' 
    : `${(currentExam?.name || 'TERMINAL EXAMINATION').toUpperCase()} - PROGRESS REPORT CARD`;
  
  doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#f6e05e')
     .text(`${titleText}  (SESSION: ${student.academic_year || '2026-27'})`, headX, 66, { width: headW, align: 'center' });

  // 3. Student Academic Profile & Position Banner
  const profileY = 108;
  const profileH = 68;
  doc.rect(30, profileY, 535, profileH).fillAndStroke('#f8fafc', '#cbd5e1');

  // Student details left & right columns
  const studentRankInfo = classRanks[student.id] || null;
  const rankDisplay = studentRankInfo ? studentRankInfo.rankText : '-';

  doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(8);
  
  // Left column
  doc.text('Student Name:', 40, profileY + 8).font('Helvetica').text(student.student_name, 115, profileY + 8);
  doc.font('Helvetica-Bold').text("Father's Name:", 40, profileY + 22).font('Helvetica').text(student.father_name || student.guardian_name || '-', 115, profileY + 22);
  doc.font('Helvetica-Bold').text("Mother's Name:", 40, profileY + 36).font('Helvetica').text(student.mother_name || '-', 115, profileY + 36);
  doc.font('Helvetica-Bold').text('Date of Birth:', 40, profileY + 50).font('Helvetica').text(student.date_of_birth ? moment(student.date_of_birth).format('DD/MM/YYYY') : '-', 115, profileY + 50);

  // Right column
  doc.font('Helvetica-Bold').text('Class & Sec:', 300, profileY + 8).font('Helvetica').text(`${student.class_name} - ${student.section || 'A'}`, 370, profileY + 8);
  doc.font('Helvetica-Bold').text('Admission No:', 300, profileY + 22).font('Helvetica').text(student.admission_no, 370, profileY + 22);
  doc.font('Helvetica-Bold').text('Roll Number:', 300, profileY + 36).font('Helvetica').text(String(student.roll_number || '-'), 370, profileY + 36);

  // Position Badge on Profile
  doc.font('Helvetica-Bold').text('Class Position:', 300, profileY + 50);
  if (studentRankInfo && studentRankInfo.isTopThree) {
    const badgeColor = studentRankInfo.rank === 1 ? '#b45309' : (studentRankInfo.rank === 2 ? '#475569' : '#92400e');
    const badgeBg = studentRankInfo.rank === 1 ? '#fef3c7' : (studentRankInfo.rank === 2 ? '#f1f5f9' : '#ffedd5');
    doc.rect(370, profileY + 48, 120, 14).fillAndStroke(badgeBg, badgeColor);
    doc.fillColor(badgeColor).font('Helvetica-Bold').fontSize(8)
       .text(studentRankInfo.badgeText, 370, profileY + 50.5, { width: 120, align: 'center' });
  } else {
    doc.font('Helvetica-Bold').fillColor('#1e293b').text(rankDisplay, 370, profileY + 50);
  }

  // 4. Marks Table
  let tableY = profileY + profileH + 10;
  
  // Categorize exams for consolidated view
  let term1Exam = allExams.find(e => /1st|first/i.test(e.name));
  let term2Exam = allExams.find(e => /2nd|second|half|mid/i.test(e.name));
  let term3Exam = allExams.find(e => /3rd|third|annual|final/i.test(e.name));
  let preBoardExam = allExams.find(e => /pre.*board/i.test(e.name));

  // If consolidated view with 2 or more exams:
  if (isAnnualOrConsolidated && allExams.length >= 2) {
    const termsToDisplay = [];
    if (term1Exam) termsToDisplay.push({ key: 'term1', label: '1st Term', exam: term1Exam });
    if (term2Exam) termsToDisplay.push({ key: 'term2', label: '2nd Term', exam: term2Exam });
    if (term3Exam) termsToDisplay.push({ key: 'term3', label: '3rd/Annual', exam: term3Exam });
    if (preBoardExam) termsToDisplay.push({ key: 'preboard', label: 'Pre-Board', exam: preBoardExam });
    
    // Fallback if named differently
    if (termsToDisplay.length === 0) {
      allExams.slice(0, 3).forEach((e, i) => termsToDisplay.push({ key: `e${i}`, label: e.name.slice(0, 10), exam: e }));
    }

    const colSubW = 145;
    const termColW = Math.floor(190 / termsToDisplay.length);
    const colTotalW = 75;
    const colPctW = 45;
    const colGrdW = 40;
    const colResW = 40;
    const tableHeaderH = 22;
    const rowH = 17;

    // Table Header
    doc.rect(30, tableY, 535, tableHeaderH).fillAndStroke('#1e3a8a', '#0f172a');
    doc.fillColor('white').font('Helvetica-Bold').fontSize(7.5);

    let curX = 30;
    doc.text('Subject Name', curX + 6, tableY + 7, { width: colSubW - 6, align: 'left' }); curX += colSubW;

    termsToDisplay.forEach(t => {
      doc.text(t.label, curX, tableY + 7, { width: termColW, align: 'center' });
      curX += termColW;
    });

    doc.text('Grand Total', curX, tableY + 7, { width: colTotalW, align: 'center' }); curX += colTotalW;
    doc.text('%', curX, tableY + 7, { width: colPctW, align: 'center' }); curX += colPctW;
    doc.text('Grade', curX, tableY + 7, { width: colGrdW, align: 'center' }); curX += colGrdW;
    doc.text('Result', curX, tableY + 7, { width: colResW, align: 'center' });

    tableY += tableHeaderH;

    // Map all results by exam_id and subject_id
    const marksByExamSub = {};
    allResults.forEach(r => {
      marksByExamSub[`${r.exam_id}_${r.subject_id}`] = r;
    });

    let overallGrandTotalObt = 0;
    let overallGrandTotalMax = 0;
    let anySubjectFailed = false;
    const termTotals = {};
    termsToDisplay.forEach(t => { termTotals[t.key] = { obt: 0, max: 0 }; });

    // Subject Rows
    applicableSubjects.forEach((sub, sIdx) => {
      const isEven = sIdx % 2 === 0;
      doc.rect(30, tableY, 535, rowH).fillAndStroke(isEven ? '#f8fafc' : '#ffffff', '#cbd5e1');

      let subGrandObt = 0;
      let subGrandMax = 0;

      curX = 30;
      doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(7.5);
      doc.text(sub.name, curX + 6, tableY + 5, { width: colSubW - 8, align: 'left' });
      curX += colSubW;

      doc.font('Helvetica').fontSize(7.2);
      termsToDisplay.forEach(t => {
        const resObj = marksByExamSub[`${t.exam.id}_${sub.id}`];
        if (resObj && resObj.marks_obtained !== null) {
          const marks = parseFloat(resObj.marks_obtained);
          const max = parseFloat(resObj.max_marks || sub.max_marks || 100);
          subGrandObt += marks;
          subGrandMax += max;
          termTotals[t.key].obt += marks;
          termTotals[t.key].max += max;
          
          const isSubPass = (marks / max) >= 0.33;
          doc.fillColor(isSubPass ? '#0f172a' : '#b91c1c').text(marks.toFixed(1), curX, tableY + 5, { width: termColW, align: 'center' });
        } else {
          doc.fillColor('#94a3b8').text('-', curX, tableY + 5, { width: termColW, align: 'center' });
        }
        curX += termColW;
      });

      overallGrandTotalObt += subGrandObt;
      overallGrandTotalMax += subGrandMax;

      const subPct = subGrandMax > 0 ? (subGrandObt / subGrandMax) * 100 : 0;
      const subPass = subGrandMax > 0 ? (subPct >= 33) : true;
      if (!subPass && subGrandMax > 0) anySubjectFailed = true;

      const subGrade = subPct >= 90 ? 'A+' : subPct >= 80 ? 'A' : subPct >= 70 ? 'B' : subPct >= 60 ? 'C' : subPct >= 50 ? 'D' : subPct >= 33 ? 'E' : 'F';

      doc.fillColor('#0f172a').font('Helvetica-Bold').text(`${subGrandObt.toFixed(1)} / ${subGrandMax}`, curX, tableY + 5, { width: colTotalW, align: 'center' });
      curX += colTotalW;

      doc.font('Helvetica').text(`${subPct.toFixed(1)}%`, curX, tableY + 5, { width: colPctW, align: 'center' });
      curX += colPctW;

      doc.font('Helvetica-Bold').text(subGrade, curX, tableY + 5, { width: colGrdW, align: 'center' });
      curX += colGrdW;

      doc.fillColor(subPass ? '#15803d' : '#b91c1c').text(subPass ? 'PASS' : 'FAIL', curX, tableY + 5, { width: colResW, align: 'center' });

      tableY += rowH;
    });

    // Grand Summary Row
    doc.rect(30, tableY, 535, rowH + 2).fillAndStroke('#1e3a8a', '#0f172a');
    doc.fillColor('white').font('Helvetica-Bold').fontSize(8);

    curX = 30;
    doc.text('TOTAL / PERCENTAGE', curX + 6, tableY + 6, { width: colSubW - 6 });
    curX += colSubW;

    termsToDisplay.forEach(t => {
      const tObt = termTotals[t.key].obt;
      const tMax = termTotals[t.key].max;
      const tPct = tMax > 0 ? ((tObt / tMax) * 100).toFixed(0) : '0';
      doc.text(`${tObt.toFixed(0)} (${tPct}%)`, curX, tableY + 6, { width: termColW, align: 'center' });
      curX += termColW;
    });

    const grandPct = overallGrandTotalMax > 0 ? (overallGrandTotalObt / overallGrandTotalMax * 100) : 0;
    const isOverallPass = !anySubjectFailed && grandPct >= 33;
    const finalGrade = grandPct >= 90 ? 'A+' : grandPct >= 80 ? 'A' : grandPct >= 70 ? 'B' : grandPct >= 60 ? 'C' : grandPct >= 50 ? 'D' : grandPct >= 33 ? 'E' : 'F';

    doc.text(`${overallGrandTotalObt.toFixed(1)}/${overallGrandTotalMax}`, curX, tableY + 6, { width: colTotalW, align: 'center' });
    curX += colTotalW;
    doc.text(`${grandPct.toFixed(1)}%`, curX, tableY + 6, { width: colPctW, align: 'center' });
    curX += colPctW;
    doc.text(finalGrade, curX, tableY + 6, { width: colGrdW, align: 'center' });
    curX += colGrdW;
    doc.text(isOverallPass ? 'PASS' : 'FAIL', curX, tableY + 6, { width: colResW, align: 'center' });

    tableY += rowH + 12;

    // Academic Assessment Result Summary Box
    doc.rect(30, tableY, 535, 54).fillAndStroke('#f1f5f9', '#94a3b8');
    doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(9);
    doc.text('FINAL PERFORMANCE ASSESSMENT & POSITION', 40, tableY + 8);
    
    doc.font('Helvetica').fontSize(8.5);
    doc.text(`Grand Total Marks: ${overallGrandTotalObt.toFixed(1)} out of ${overallGrandTotalMax}`, 40, tableY + 24);
    doc.text(`Aggregate Percentage: ${grandPct.toFixed(2)}%   |   Final Grade: ${finalGrade}`, 40, tableY + 38);

    doc.font('Helvetica-Bold').fontSize(9.5);
    doc.text('Class Position:', 340, tableY + 24);
    doc.fillColor(studentRankInfo?.isTopThree ? '#b45309' : '#0f172a')
       .text(studentRankInfo ? studentRankInfo.rankText : '-', 420, tableY + 24);

    doc.fillColor('#0f172a').text('Final Result:', 340, tableY + 38);
    doc.fillColor(isOverallPass ? '#15803d' : '#b91c1c')
       .text(isOverallPass ? 'PASSED & PROMOTED' : 'FAILED', 420, tableY + 38);

    tableY += 68;

  } else {
    // Single Examination Report Card
    const colSubW = 195;
    const colMaxW = 85;
    const colObtW = 95;
    const colGrdW = 80;
    const colResW = 80;
    const tableHeaderH = 22;
    const rowH = 18;

    doc.rect(30, tableY, 535, tableHeaderH).fillAndStroke('#1e3a8a', '#0f172a');
    doc.fillColor('white').font('Helvetica-Bold').fontSize(8);

    let curX = 30;
    doc.text('Subject Name', curX + 8, tableY + 7, { width: colSubW - 8, align: 'left' }); curX += colSubW;
    doc.text('Maximum Marks', curX, tableY + 7, { width: colMaxW, align: 'center' }); curX += colMaxW;
    doc.text('Marks Obtained', curX, tableY + 7, { width: colObtW, align: 'center' }); curX += colObtW;
    doc.text('Grade', curX, tableY + 7, { width: colGrdW, align: 'center' }); curX += colGrdW;
    doc.text('Status (Min 33%)', curX, tableY + 7, { width: colResW, align: 'center' });

    tableY += tableHeaderH;

    const resultsBySubject = {};
    (currentResults || []).forEach(r => { resultsBySubject[r.subject_id] = r; });

    let totalObt = 0;
    let totalMax = 0;
    let anySubjectFailed = false;

    applicableSubjects.forEach((sub, sIdx) => {
      const isEven = sIdx % 2 === 0;
      doc.rect(30, tableY, 535, rowH).fillAndStroke(isEven ? '#f8fafc' : '#ffffff', '#cbd5e1');

      const r = resultsBySubject[sub.id];
      const max = parseFloat(sub.max_marks || 100);
      const obt = r ? parseFloat(r.marks_obtained || 0) : 0;
      const isEntered = !!r;
      const pct = max > 0 ? (obt / max) * 100 : 0;
      const isSubPass = pct >= 33;
      if (!isSubPass) anySubjectFailed = true;

      totalObt += obt;
      totalMax += max;

      const grade = pct >= 90 ? 'A+' : pct >= 80 ? 'A' : pct >= 70 ? 'B' : pct >= 60 ? 'C' : pct >= 50 ? 'D' : pct >= 33 ? 'E' : 'F';

      curX = 30;
      doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(8);
      doc.text(sub.name, curX + 8, tableY + 5, { width: colSubW - 8, align: 'left' });
      curX += colSubW;

      doc.font('Helvetica').fontSize(8);
      doc.text(String(max), curX, tableY + 5, { width: colMaxW, align: 'center' });
      curX += colMaxW;

      doc.fillColor(isSubPass ? '#0f172a' : '#b91c1c').font('Helvetica-Bold')
         .text(isEntered ? obt.toFixed(1) : '-', curX, tableY + 5, { width: colObtW, align: 'center' });
      curX += colObtW;

      doc.fillColor('#0f172a').font('Helvetica').text(isEntered ? grade : '-', curX, tableY + 5, { width: colGrdW, align: 'center' });
      curX += colGrdW;

      doc.fillColor(isSubPass ? '#15803d' : '#b91c1c').font('Helvetica-Bold')
         .text(isEntered ? (isSubPass ? 'PASS' : 'FAIL') : '-', curX, tableY + 5, { width: colResW, align: 'center' });

      tableY += rowH;
    });

    // Total Row
    doc.rect(30, tableY, 535, rowH + 2).fillAndStroke('#1e3a8a', '#0f172a');
    doc.fillColor('white').font('Helvetica-Bold').fontSize(8.5);

    const overallPct = totalMax > 0 ? (totalObt / totalMax) * 100 : 0;
    const isOverallPass = !anySubjectFailed && overallPct >= 33;
    const finalGrade = overallPct >= 90 ? 'A+' : overallPct >= 80 ? 'A' : overallPct >= 70 ? 'B' : overallPct >= 60 ? 'C' : overallPct >= 50 ? 'D' : overallPct >= 33 ? 'E' : 'F';

    curX = 30;
    doc.text('TOTAL MARKS', curX + 8, tableY + 6, { width: colSubW - 8, align: 'left' }); curX += colSubW;
    doc.text(String(totalMax), curX, tableY + 6, { width: colMaxW, align: 'center' }); curX += colMaxW;
    doc.text(totalObt.toFixed(1), curX, tableY + 6, { width: colObtW, align: 'center' }); curX += colObtW;
    doc.text(finalGrade, curX, tableY + 6, { width: colGrdW, align: 'center' }); curX += colGrdW;
    doc.text(isOverallPass ? 'PASS' : 'FAIL', curX, tableY + 6, { width: colResW, align: 'center' });

    tableY += rowH + 14;

    // Single Exam Assessment Box
    doc.rect(30, tableY, 535, 52).fillAndStroke('#f1f5f9', '#94a3b8');
    doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(9);
    doc.text('EXAMINATION ASSESSMENT & POSITION', 40, tableY + 8);
    
    doc.font('Helvetica').fontSize(8.5);
    doc.text(`Total Marks: ${totalObt.toFixed(1)} / ${totalMax}   |   Percentage: ${overallPct.toFixed(2)}%`, 40, tableY + 24);
    doc.text(`Overall Grade: ${finalGrade}   |   Minimum Passing Marks Required: 33%`, 40, tableY + 37);

    doc.font('Helvetica-Bold').fontSize(9.5);
    doc.text('Class Position:', 340, tableY + 24);
    doc.fillColor(studentRankInfo?.isTopThree ? '#b45309' : '#0f172a')
       .text(studentRankInfo ? studentRankInfo.rankText : '-', 420, tableY + 24);

    doc.fillColor('#0f172a').text('Result:', 340, tableY + 37);
    doc.fillColor(isOverallPass ? '#15803d' : '#b91c1c')
       .text(isOverallPass ? 'PASSED' : 'FAILED', 420, tableY + 37);

    tableY += 66;
  }

  // 5. Grading Scale & Pass Criteria Notice
  doc.rect(30, tableY, 535, 36).fillAndStroke('#f8fafc', '#cbd5e1');
  doc.fillColor('#334155').font('Helvetica-Bold').fontSize(7.2)
     .text('GRADING SCALE & PASS CRITERIA (MINIMUM 33% MARKS REQUIRED TO PASS):', 40, tableY + 6);
  doc.font('Helvetica').fontSize(6.8)
     .text('A+ (90-100% Outstanding)  |  A (80-89% Excellent)  |  B (70-79% Very Good)  |  C (60-69% Good)  |  D (50-59% Average)  |  E (33-49% Pass)  |  F (<33% Needs Improvement / Fail)', 40, tableY + 18, { width: 515 });

  // 6. Signatures Footer
  const sigY = 750;
  doc.lineWidth(0.8).strokeColor('#475569');

  // Teacher
  doc.moveTo(50, sigY).lineTo(170, sigY).stroke();
  doc.fillColor('#0f172a').font('Helvetica').fontSize(8).text("Class Teacher's Signature", 50, sigY + 4, { width: 120, align: 'center' });

  // Exam Incharge
  doc.moveTo(235, sigY).lineTo(355, sigY).stroke();
  doc.text("Exam Incharge Signature", 235, sigY + 4, { width: 120, align: 'center' });

  // Principal
  doc.moveTo(420, sigY).lineTo(540, sigY).stroke();
  doc.font('Helvetica-Bold').text("Principal's Signature", 420, sigY + 4, { width: 120, align: 'center' });

  // System generated disclaimer
  doc.font('Helvetica-Oblique').fontSize(7).fillColor('#64748b')
     .text(`This is a verified computer generated report card issued by Shri Amrit Lal Smarak School And College. Date: ${moment().format('DD/MM/YYYY')}`, 30, 786, { width: 535, align: 'center' });

  doc.end();
}

module.exports = { generateReportCardPDF };
