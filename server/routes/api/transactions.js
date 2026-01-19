const express = require('express');
const router = express.Router();
const db = require('../../db/sqlite-adapter');
const { authenticateAdmin } = require('../../middleware/security');

// Get transactions with pagination and filters
router.get('/', authenticateAdmin, async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 20, 
      startDate, 
      endDate, 
      status, 
      method 
    } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(limit);
    let whereConditions = [];
    let params = [];
    let paramIndex = 1;

    if (startDate) {
      whereConditions.push(`date(t.created_at) >= date($${paramIndex})`);
      params.push(startDate);
      paramIndex++;
    }

    if (endDate) {
      whereConditions.push(`date(t.created_at) <= date($${paramIndex})`);
      params.push(endDate);
      paramIndex++;
    }

    if (status) {
      whereConditions.push(`t.status = $${paramIndex}`);
      params.push(status);
      paramIndex++;
    }

    if (method) {
      whereConditions.push(`t.payment_method = $${paramIndex}`);
      params.push(method);
      paramIndex++;
    }

    const whereClause = whereConditions.length > 0 
      ? 'WHERE ' + whereConditions.join(' AND ') 
      : '';

    // Get total count
    const countResult = await db.query(
      `SELECT COUNT(*) as count FROM transactions t ${whereClause}`,
      params
    );
    const total = countResult.rows[0].count;

    // Get transactions with client info
    const transactionsResult = await db.query(
      `SELECT t.*, c.mac_address, c.ip_address, c.device_name
       FROM transactions t
       LEFT JOIN clients c ON t.client_id = c.id
       ${whereClause}
       ORDER BY t.created_at DESC
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...params, parseInt(limit), offset]
    );

    res.json({
      transactions: transactionsResult.rows,
      total: total,
      page: parseInt(page),
      limit: parseInt(limit),
      totalPages: Math.ceil(total / parseInt(limit))
    });
  } catch (error) {
    console.error('Error fetching transactions:', error);
    res.status(500).json({ error: 'Failed to fetch transactions' });
  }
});

// Get transaction statistics
router.get('/stats', authenticateAdmin, async (req, res) => {
  try {
    // Today's sales
    const todayResult = await db.query(
      `SELECT COALESCE(SUM(amount), 0) as total_sales, COALESCE(SUM(coins_used), 0) as total_coins
       FROM transactions 
       WHERE date(created_at) = date('now') AND status = 'COMPLETED'`
    );

    // All-time revenue
    const allTimeResult = await db.query(
      `SELECT COALESCE(SUM(amount), 0) as total_revenue
       FROM transactions 
       WHERE status = 'COMPLETED'`
    );

    // Total transactions count
    const countResult = await db.query(
      `SELECT COUNT(*) as count FROM transactions`
    );

    res.json({
      todaySales: parseFloat(todayResult.rows[0].total_sales) || 0,
      todayCoins: parseInt(todayResult.rows[0].total_coins) || 0,
      allTimeRevenue: parseFloat(allTimeResult.rows[0].total_revenue) || 0,
      totalTransactions: parseInt(countResult.rows[0].count) || 0
    });
  } catch (error) {
    console.error('Error fetching transaction stats:', error);
    res.status(500).json({ error: 'Failed to fetch transaction statistics' });
  }
});

// Export transactions as CSV
router.get('/export', authenticateAdmin, async (req, res) => {
  try {
    const { startDate, endDate, status, method } = req.query;


    let whereConditions = [];
    let params = [];
    let paramIndex = 1;

    if (startDate) {
      whereConditions.push(`date(t.created_at) >= date($${paramIndex})`);
      params.push(startDate);
      paramIndex++;
    }

    if (endDate) {
      whereConditions.push(`date(t.created_at) <= date($${paramIndex})`);
      params.push(endDate);
      paramIndex++;
    }

    if (status) {
      whereConditions.push(`t.status = $${paramIndex}`);
      params.push(status);
      paramIndex++;
    }

    if (method) {
      whereConditions.push(`t.payment_method = $${paramIndex}`);
      params.push(method);
      paramIndex++;
    }

    const whereClause = whereConditions.length > 0 
      ? 'WHERE ' + whereConditions.join(' AND ') 
      : '';

    const result = await db.query(
      `SELECT t.id, t.created_at, c.mac_address, c.ip_address, t.amount, t.coins_used, t.payment_method, t.status
       FROM transactions t
       LEFT JOIN clients c ON t.client_id = c.id
       ${whereClause}
       ORDER BY t.created_at DESC`,
      params
    );

    // Generate CSV
    const headers = ['ID', 'Date & Time', 'MAC Address', 'IP Address', 'Amount', 'Coins', 'Payment Method', 'Status'];
    const rows = result.rows.map(tx => [
      tx.id,
      tx.created_at,
      tx.mac_address || '',
      tx.ip_address || '',
      tx.amount,
      tx.coins_used,
      tx.payment_method,
      tx.status
    ]);

    const csv = [headers.join(','), ...rows.map(row => row.join(','))].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="transactions_${startDate || 'all'}_${endDate || 'all'}.csv"`);
    res.send(csv);
  } catch (error) {
    console.error('Error exporting transactions:', error);
    res.status(500).json({ error: 'Failed to export transactions' });
  }
});

// Get daily report data (aggregated by date)
router.get('/daily-report', authenticateAdmin, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    let whereConditions = [`status = 'COMPLETED'`];
    let params = [];
    let paramIndex = 1;

    if (startDate) {
      whereConditions.push(`date(created_at) >= date($${paramIndex})`);
      params.push(startDate);
      paramIndex++;
    }

    if (endDate) {
      whereConditions.push(`date(created_at) <= date($${paramIndex})`);
      params.push(endDate);
      paramIndex++;
    }

    const whereClause = 'WHERE ' + whereConditions.join(' AND ');

    // Get daily aggregated data
    const dailyResult = await db.query(
      `SELECT 
        date(created_at) as date,
        COUNT(*) as sessions,
        COALESCE(SUM(amount), 0) as revenue,
        COALESCE(SUM(coins_used), 0) as coins,
        COALESCE(AVG(amount), 0) as avg_per_session
       FROM transactions 
       ${whereClause}
       GROUP BY date(created_at)
       ORDER BY date(created_at) ASC`,
      params
    );

    // Get summary stats
    const summaryResult = await db.query(
      `SELECT 
        COALESCE(SUM(amount), 0) as total_revenue,
        COUNT(*) as total_sessions,
        COALESCE(AVG(amount), 0) as avg_session_value
       FROM transactions 
       ${whereClause}`,
      params
    );

    const summary = summaryResult.rows[0];
    const dailyData = dailyResult.rows;
    const dailyAverage = dailyData.length > 0 
      ? parseFloat(summary.total_revenue) / dailyData.length 
      : 0;

    res.json({
      data: dailyData.map(row => ({
        date: row.date,
        sessions: parseInt(row.sessions) || 0,
        revenue: parseFloat(row.revenue) || 0,
        coins: parseInt(row.coins) || 0,
        avgPerSession: parseFloat(row.avg_per_session) || 0
      })),
      summary: {
        totalRevenue: parseFloat(summary.total_revenue) || 0,
        totalSessions: parseInt(summary.total_sessions) || 0,
        avgSessionValue: parseFloat(summary.avg_session_value) || 0,
        dailyAverage: dailyAverage
      }
    });
  } catch (error) {
    console.error('Error fetching daily report:', error);
    res.status(500).json({ error: 'Failed to fetch daily report' });
  }
});

module.exports = router;
