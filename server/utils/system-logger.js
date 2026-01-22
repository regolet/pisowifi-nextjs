const db = require('../db/sqlite-adapter');

async function logSystemEvent(level, message, category = 'system', metadata = null) {
  try {
    const safeLevel = (level || 'info').toString().slice(0, 10);
    const safeCategory = (category || 'system').toString().slice(0, 50);
    const safeMessage = (message || '').toString().slice(0, 1000);
    const meta = metadata ? JSON.stringify(metadata).slice(0, 4000) : null;

    await db.query(
      'INSERT INTO system_logs (level, message, category, metadata) VALUES ($1, $2, $3, $4)',
      [safeLevel, safeMessage, safeCategory, meta]
    );
  } catch (error) {
    // Avoid crashing on logging failures
  }
}

module.exports = { logSystemEvent };
