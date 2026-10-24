const db = require('../config/db');
const moment = require('moment');

/**
 * Escapes values for safe SQL dump statements
 */
function escapeSqlValue(val) {
  if (val === null || val === undefined) return 'NULL';
  if (typeof val === 'number') return String(val);
  if (typeof val === 'boolean') return val ? '1' : '0';
  if (val instanceof Date) return `'${moment(val).format('YYYY-MM-DD HH:mm:ss')}'`;
  if (Buffer.isBuffer(val)) return `X'${val.toString('hex')}'`;
  
  // String escaping
  const escaped = String(val)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\0/g, '\\0')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\x1a/g, '\\Z');
  return `'${escaped}'`;
}

/**
 * Generates and streams a full MySQL database backup (.sql file)
 */
async function generateSqlBackup(res) {
  const schoolName = process.env.SCHOOL_NAME || 'Shri Amrit Lal Smarak School And College';
  const timestamp = moment().format('YYYY-MM-DD HH:mm:ss');
  const fileDate = moment().format('YYYY-MM-DD_HH-mm');
  const filename = `school_erp_backup_${fileDate}.sql`;

  res.setHeader('Content-Type', 'application/sql');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

  // Write SQL Header
  res.write(`-- ========================================================\n`);
  res.write(`-- SCHOOL ERP DATABASE BACKUP\n`);
  res.write(`-- School: ${schoolName}\n`);
  res.write(`-- Backup Generated At: ${timestamp}\n`);
  res.write(`-- ========================================================\n\n`);
  res.write(`SET FOREIGN_KEY_CHECKS = 0;\n`);
  res.write(`SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";\n`);
  res.write(`SET time_zone = "+05:30";\n\n`);

  // Fetch all base tables
  const [tables] = await db.query(`SHOW FULL TABLES WHERE Table_type = 'BASE TABLE'`);
  
  for (const tRow of tables) {
    const tableName = Object.values(tRow)[0];
    
    res.write(`-- --------------------------------------------------------\n`);
    res.write(`-- Table structure for table \`${tableName}\`\n`);
    res.write(`-- --------------------------------------------------------\n`);
    res.write(`DROP TABLE IF EXISTS \`${tableName}\`;\n`);

    const [[createRow]] = await db.query(`SHOW CREATE TABLE \`${tableName}\``);
    const createTableSql = createRow['Create Table'] || createRow['Create Table'];
    res.write(`${createTableSql};\n\n`);

    // Fetch and dump table data
    const [rows] = await db.query(`SELECT * FROM \`${tableName}\``);
    if (rows && rows.length > 0) {
      res.write(`-- Dumping data for table \`${tableName}\` (${rows.length} rows)\n`);
      
      const chunkSize = 100;
      for (let i = 0; i < rows.length; i += chunkSize) {
        const chunk = rows.slice(i, i + chunkSize);
        const columns = Object.keys(chunk[0]).map(col => `\`${col}\``).join(', ');
        
        const valuesList = chunk.map(row => {
          const vals = Object.values(row).map(val => escapeSqlValue(val)).join(', ');
          return `(${vals})`;
        }).join(',\n');

        res.write(`INSERT INTO \`${tableName}\` (${columns}) VALUES\n${valuesList};\n`);
      }
      res.write(`\n`);
    }
  }

  res.write(`SET FOREIGN_KEY_CHECKS = 1;\n`);
  res.write(`-- Backup Completed Successfully: ${moment().format('YYYY-MM-DD HH:mm:ss')}\n`);
  res.end();
}

module.exports = { generateSqlBackup };
