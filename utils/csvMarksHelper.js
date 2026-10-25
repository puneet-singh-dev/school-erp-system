/**
 * Helper utility for CSV Marks Template Generation & CSV Marks Bulk Upload
 * Specifically tailored for UP Board and standard Indian schools.
 */

function isSubjectApplicableToStudent(subjectName, optionalSubject) {
  if (!optionalSubject || !subjectName) return true;
  const sub = subjectName.toLowerCase();
  const opt = optionalSubject.toLowerCase();

  // UP Board Class 9 & 10 optional pair: Drawing vs Sanskrit
  if (/drawing|art|chitrakala/i.test(sub) && /sanskrit/i.test(opt)) return false;
  if (/sanskrit/i.test(sub) && /drawing|art|chitrakala/i.test(opt)) return false;

  // UP Board Class 11 & 12 optional pair: Math vs Biology
  if (/bio|biology/i.test(sub) && /math/i.test(opt)) return false;
  if (/math/i.test(sub) && !/applied/i.test(sub) && /bio/i.test(opt)) return false;

  return true;
}

/**
 * Generates an Excel-compatible CSV template with UTF-8 BOM
 */
function generateMarksCSVTemplate(exam, students, subjects, resultsMap = {}) {
  // UTF-8 BOM so Excel opens Hindi and symbols without garbling
  let csv = '\uFEFF';

  // Header row
  const headers = ['Roll No', 'Admission No', 'Student Name', 'Optional Subject'];
  subjects.forEach(sub => {
    headers.push(`"${sub.name.replace(/"/g, '""')} (Max: ${sub.max_marks})"`);
  });
  csv += headers.join(',') + '\r\n';

  // Data rows
  students.forEach(s => {
    const row = [
      s.roll_number || '',
      `"${(s.admission_no || '').replace(/"/g, '""')}"`,
      `"${(s.name || '').replace(/"/g, '""')}"`,
      `"${(s.optional_subject || 'None').replace(/"/g, '""')}"`
    ];

    subjects.forEach(sub => {
      const isApplicable = isSubjectApplicableToStudent(sub.name, s.optional_subject);
      if (!isApplicable) {
        row.push('"N/A"');
      } else {
        const res = resultsMap[`${s.id}_${sub.id}`];
        if (res && res.marks_obtained !== null && res.marks_obtained !== undefined) {
          row.push(res.marks_obtained);
        } else {
          row.push('');
        }
      }
    });

    csv += row.join(',') + '\r\n';
  });

  return csv;
}

/**
 * Parses uploaded CSV content and extracts marks mapping
 */
function parseMarksCSV(csvContent, students, subjects) {
  // Strip BOM if present
  let cleanContent = csvContent.replace(/^\uFEFF/, '');
  const lines = cleanContent.split(/\r?\n/).filter(line => line.trim().length > 0);

  if (lines.length < 2) {
    throw new Error('CSV file is empty or missing data rows.');
  }

  // Parse CSV line safely supporting quoted commas
  function parseCSVLine(text) {
    const result = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch === '"') {
        if (inQuotes && text[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === ',' && !inQuotes) {
        result.push(cur.trim());
        cur = '';
      } else {
        cur += ch;
      }
    }
    result.push(cur.trim());
    return result;
  }

  const rawHeaders = parseCSVLine(lines[0]);
  
  // Find column indices
  let admIndex = -1;
  let rollIndex = -1;
  const subjectColMap = []; // { colIdx, subject }

  rawHeaders.forEach((h, idx) => {
    const cleanHeader = h.toLowerCase().replace(/['"]/g, '').trim();
    if (cleanHeader.includes('admission') || cleanHeader.includes('adm')) {
      admIndex = idx;
    } else if (cleanHeader.includes('roll')) {
      rollIndex = idx;
    } else {
      // Try to match subject by name
      subjects.forEach(sub => {
        const subNameLower = sub.name.toLowerCase();
        if (cleanHeader.startsWith(subNameLower) || cleanHeader.includes(subNameLower)) {
          subjectColMap.push({ colIdx: idx, subject: sub });
        }
      });
    }
  });

  if (admIndex === -1 && rollIndex === -1) {
    throw new Error('CSV must contain "Admission No" or "Roll No" column.');
  }

  const studentByAdm = {};
  const studentByRoll = {};
  students.forEach(s => {
    if (s.admission_no) studentByAdm[s.admission_no.trim().toLowerCase()] = s;
    if (s.roll_number) studentByRoll[String(s.roll_number).trim()] = s;
  });

  const parsedMarks = [];

  for (let i = 1; i < lines.length; i++) {
    const row = parseCSVLine(lines[i]);
    if (!row.length) continue;

    const adm = admIndex >= 0 && row[admIndex] ? row[admIndex].trim().toLowerCase() : null;
    const roll = rollIndex >= 0 && row[rollIndex] ? String(row[rollIndex]).trim() : null;

    const matchedStudent = (adm && studentByAdm[adm]) || (roll && studentByRoll[roll]);
    if (!matchedStudent) continue;

    subjectColMap.forEach(({ colIdx, subject }) => {
      const valStr = row[colIdx];
      if (valStr !== undefined && valStr !== null && valStr.trim() !== '') {
        const cleanVal = valStr.trim().toUpperCase();
        if (cleanVal === 'N/A' || cleanVal === '-') return;

        let num = parseFloat(cleanVal);
        if (cleanVal === 'AB' || cleanVal === 'ABSENT') num = 0;

        if (!isNaN(num) && num >= 0) {
          const max = parseFloat(subject.max_marks) || 100;
          parsedMarks.push({
            student_id: matchedStudent.id,
            subject_id: subject.id,
            marks_obtained: Math.min(num, max),
            max_marks: max
          });
        }
      }
    });
  }

  return parsedMarks;
}

module.exports = {
  isSubjectApplicableToStudent,
  generateMarksCSVTemplate,
  parseMarksCSV
};
