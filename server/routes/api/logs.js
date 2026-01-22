const express = require('express');
const router = express.Router();
const db = require('../../db/sqlite-adapter');
const { authenticateAPI } = require('../../middleware/security');

const authenticateToken = authenticateAPI;

router.get('/', authenticateToken, async (req, res) => {
  try {
    const level = req.query.level ? String(req.query.level) : null;
    const category = req.query.category ? String(req.query.category) : null;
    const search = req.query.search ? String(req.query.search) : null;
    const limit = Math.min(parseInt(req.query.limit, 10) || 200, 1000);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    const conditions = [];
    const params = [];

    if (level) {
      params.push(level);
      conditions.push(`level = $${params.length}`);
    }
    if (category) {
      params.push(category);
      conditions.push(`category = $${params.length}`);
    }
    if (search) {
      params.push(`%${search}%`);
      conditions.push(`message LIKE $${params.length}`);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    params.push(limit);
    const limitIdx = params.length;
    params.push(offset);
    const offsetIdx = params.length;

    const query = `
      SELECT id, level, message, category, metadata, created_at
      FROM system_logs
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${limitIdx} OFFSET $${offsetIdx}
    `;

    const result = await db.query(query, params);
    res.json({ logs: result.rows || [] });
  } catch (error) {
    console.error('Get logs error:', error);
    res.status(500).json({ error: 'Failed to get logs' });
  }
});

router.delete('/clear', authenticateToken, async (req, res) => {
  try {
    await db.query('DELETE FROM system_logs');
    res.json({ success: true });
  } catch (error) {
    console.error('Clear logs error:', error);
    res.status(500).json({ error: 'Failed to clear logs' });
  }
});

module.exports = router;
