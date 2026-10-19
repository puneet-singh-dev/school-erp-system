const { generateStudentListPDF } = require('./studentListPdf');

/**
 * Backward-compatible wrapper for generateClassStudentListPDF
 * Uses the short, clean header (School Name, Class, Class Teacher ONLY)
 */
function generateClassStudentListPDF(res, selectedClass, students, customFields) {
  const fields = customFields || ['roll_number', 'admission_no', 'name', 'father_name', 'mother_name', 'phone', 'transport', 'date_of_birth', 'aadhaar_no'];
  return generateStudentListPDF(res, students, selectedClass, fields);
}

module.exports = { generateClassStudentListPDF };
