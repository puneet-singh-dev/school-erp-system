const db = require('../config/db');

const DEFAULT_SETTINGS = {
  school_name: 'Shri Amrit Lal Smarak School And College',
  school_tagline: 'Vijay Nagar, Karma Bazar, Prayagraj (U.P)',
  school_affiliation: 'Affiliated to State Board / CBSE',
  school_address: 'Vijay Nagar, Karma Bazar, Prayagraj (U.P)',
  school_phone: '9129914501',
  school_alt_phone: '',
  school_email: 'info@school.erp',
  school_website: 'https://school.erp',
  principal_name: 'Principal',
  academic_year: '2026-27',
  passing_percentage: '33',
  default_max_marks: '100',
  currency_symbol: 'Rs.',
  fee_due_day: '10',
  default_monthly_fee: '500',
  receipt_title: 'FEE RECEIPT / PAYMENT VOUCHER',
  receipt_footer_note: 'Fees once deposited will not be refunded. Please preserve this receipt for future reference.',
  report_card_title: 'STUDENT PROGRESS REPORT CARD',
  sig_teacher_label: "Class Teacher's Signature",
  sig_incharge_label: "Exam Incharge Signature",
  sig_principal_label: "Principal's Signature"
};

let cachedSettings = { ...DEFAULT_SETTINGS };
let lastCacheTime = 0;
const CACHE_TTL = 30000; // 30 seconds

/**
 * Initializes settings table if it doesn't exist and seeds defaults
 */
async function initSettings() {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS settings (
        key_name VARCHAR(100) PRIMARY KEY,
        key_value TEXT,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);

    const [rows] = await db.query('SELECT key_name, key_value FROM settings');
    if (!rows.length) {
      // Seed default values
      const initial = {
        ...DEFAULT_SETTINGS,
        school_name: (process.env.SCHOOL_NAME && process.env.SCHOOL_NAME !== 'School ERP')
          ? process.env.SCHOOL_NAME
          : DEFAULT_SETTINGS.school_name,
        school_address: process.env.SCHOOL_ADDRESS || DEFAULT_SETTINGS.school_address,
        school_phone: process.env.SCHOOL_PHONE || DEFAULT_SETTINGS.school_phone
      };

      for (const [k, v] of Object.entries(initial)) {
        await db.query('INSERT IGNORE INTO settings (key_name, key_value) VALUES (?, ?)', [k, String(v)]);
      }
    }

    await getSettings(true);
  } catch (err) {
    console.warn('initSettings warning:', err.message);
  }
}

/**
 * Returns all current settings
 */
async function getSettings(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && lastCacheTime > 0 && (now - lastCacheTime < CACHE_TTL)) {
    return cachedSettings;
  }

  try {
    const [rows] = await db.query('SELECT key_name, key_value FROM settings');
    const merged = { ...DEFAULT_SETTINGS };
    if (rows && rows.length) {
      rows.forEach(r => {
        merged[r.key_name] = r.key_value;
      });
    }
    cachedSettings = merged;
    lastCacheTime = now;
    return merged;
  } catch (err) {
    return cachedSettings || DEFAULT_SETTINGS;
  }
}

/**
 * Returns cached settings synchronously (for PDF generators)
 */
function getSettingsSync() {
  return cachedSettings || DEFAULT_SETTINGS;
}

/**
 * Updates multiple settings keys
 */
async function updateSettings(newSettings) {
  for (const [key, val] of Object.entries(newSettings)) {
    if (val !== undefined && val !== null) {
      await db.query(
        `INSERT INTO settings (key_name, key_value) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE key_value = ?`,
        [key, String(val).trim(), String(val).trim()]
      );
    }
  }
  return await getSettings(true);
}

module.exports = {
  initSettings,
  getSettings,
  getSettingsSync,
  updateSettings,
  DEFAULT_SETTINGS
};
