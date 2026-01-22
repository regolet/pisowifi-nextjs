const express = require('express');
const router = express.Router();
const db = require('../../db/sqlite-adapter');
const ttlDetector = require('../../services/ttl-detector');
const { authenticateAPI } = require('../../middleware/security');

/**
 * TTL (Time To Live) Anti-Tethering Detection API Routes
 */

// Middleware: Require authentication
router.use(authenticateAPI);

/**
 * GET /api/ttl/settings
 * Get TTL detection settings
 */
router.get('/settings', async (req, res) => {
  try {
    let settings = await ttlDetector.getSettings();
    
    // Create default settings if they don't exist
    if (!settings) {
      await ttlDetector.createDefaultSettings();
      settings = await ttlDetector.getSettings();
    }
    
    if (!settings) {
      return res.status(500).json({ error: 'Failed to create TTL settings' });
    }

    res.json({
      success: true,
      settings: {
        enabled: settings.enabled,
        sensitivity: settings.sensitivity,
        auto_block: settings.auto_block,
        alert_threshold: settings.alert_threshold,
        created_at: settings.created_at,
        updated_at: settings.updated_at
      }
    });
  } catch (error) {
    console.error('Failed to get TTL settings:', error);
    res.status(500).json({ error: 'Failed to get TTL settings' });
  }
});

/**
 * POST /api/ttl/settings
 * Update TTL detection settings
 */
router.post('/settings', async (req, res) => {
  try {
    const { enabled, sensitivity, auto_block, alert_threshold } = req.body;

    // Validate input
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'enabled must be boolean' });
    }

    if (!['low', 'medium', 'high'].includes(sensitivity)) {
      return res.status(400).json({ error: 'sensitivity must be low, medium, or high' });
    }

    if (typeof auto_block !== 'boolean') {
      return res.status(400).json({ error: 'auto_block must be boolean' });
    }

    if (!Number.isInteger(alert_threshold) || alert_threshold < 1 || alert_threshold > 50) {
      return res.status(400).json({ error: 'alert_threshold must be integer between 1 and 50' });
    }

    // Update settings
    const success = await ttlDetector.updateSettings(enabled, sensitivity, auto_block, alert_threshold);

    if (!success) {
      return res.status(500).json({ error: 'Failed to update settings' });
    }

    res.json({
      success: true,
      message: 'TTL settings updated successfully'
    });
  } catch (error) {
    console.error('Failed to update TTL settings:', error);
    res.status(500).json({ error: 'Failed to update TTL settings' });
  }
});

/**
 * GET /api/ttl/violations
 * Get TTL violations
 */
router.get('/violations', async (req, res) => {
  try {
    const { limit = 50 } = req.query;
    const violations = await ttlDetector.getViolations(parseInt(limit));

    res.json({
      success: true,
      count: violations.length,
      violations: violations.map(v => ({
        id: v.id,
        client_mac: v.client_mac,
        violation_count: v.violation_count,
        severity: v.severity,
        status: v.status,
        first_detected: v.first_detected,
        last_detected: v.last_detected,
        resolved: v.resolved,
        admin_notes: v.admin_notes
      }))
    });
  } catch (error) {
    console.error('Failed to get TTL violations:', error);
    res.status(500).json({ error: 'Failed to get TTL violations' });
  }
});

/**
 * GET /api/ttl/anomalies
 * Get TTL anomaly logs
 */
router.get('/anomalies', async (req, res) => {
  try {
    const { client_mac, limit = 100 } = req.query;
    const anomalies = await ttlDetector.getAnomalyLogs(client_mac, parseInt(limit));

    res.json({
      success: true,
      count: anomalies.length,
      anomalies: anomalies.map(a => ({
        id: a.id,
        client_mac: a.client_mac,
        anomaly_type: a.anomaly_type,
        severity: a.severity,
        details: JSON.parse(a.details || '{}'),
        created_at: a.created_at
      }))
    });
  } catch (error) {
    console.error('Failed to get TTL anomalies:', error);
    res.status(500).json({ error: 'Failed to get TTL anomalies' });
  }
});

/**
 * POST /api/ttl/violations/:id/resolve
 * Resolve a TTL violation
 */
router.post('/violations/:id/resolve', async (req, res) => {
  try {
    const { id } = req.params;
    const { notes } = req.body;

    // Validate ID is numeric
    if (!Number.isInteger(parseInt(id))) {
      return res.status(400).json({ error: 'Invalid violation ID' });
    }

    // Update violation
    if (notes) {
      await db.query(
        'UPDATE ttl_violations SET resolved = true, status = $1, admin_notes = $2, resolved_at = CURRENT_TIMESTAMP WHERE id = $3',
        ['resolved', notes, id]
      );
    } else {
      await db.query(
        'UPDATE ttl_violations SET resolved = true, status = $1, resolved_at = CURRENT_TIMESTAMP WHERE id = $2',
        ['resolved', id]
      );
    }

    res.json({
      success: true,
      message: 'TTL violation resolved'
    });
  } catch (error) {
    console.error('Failed to resolve violation:', error);
    res.status(500).json({ error: 'Failed to resolve violation' });
  }
});

/**
 * POST /api/ttl/clients/:mac/clear-anomalies
 * Clear anomalies for a specific client
 */
router.post('/clients/:mac/clear-anomalies', async (req, res) => {
  try {
    const { mac } = req.params;

    // Validate MAC format
    if (!/^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/.test(mac)) {
      return res.status(400).json({ error: 'Invalid MAC address format' });
    }

    const success = await ttlDetector.clearAnomalies(mac);

    if (!success) {
      return res.status(500).json({ error: 'Failed to clear anomalies' });
    }

    res.json({
      success: true,
      message: `Anomalies cleared for client ${mac}`
    });
  } catch (error) {
    console.error('Failed to clear anomalies:', error);
    res.status(500).json({ error: 'Failed to clear anomalies' });
  }
});

/**
 * POST /api/ttl/clients/:mac/reset-baseline
 * Reset TTL baseline for a client
 */
router.post('/clients/:mac/reset-baseline', async (req, res) => {
  try {
    const { mac } = req.params;

    // Validate MAC format
    if (!/^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/.test(mac)) {
      return res.status(400).json({ error: 'Invalid MAC address format' });
    }

    ttlDetector.resetBaseline(mac);

    res.json({
      success: true,
      message: `TTL baseline reset for client ${mac}`
    });
  } catch (error) {
    console.error('Failed to reset baseline:', error);
    res.status(500).json({ error: 'Failed to reset baseline' });
  }
});

/**
 * GET /api/ttl/clients/:mac/stats
 * Get TTL statistics for a specific client
 */
router.get('/clients/:mac/stats', async (req, res) => {
  try {
    const { mac } = req.params;

    // Validate MAC format
    if (!/^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/.test(mac)) {
      return res.status(400).json({ error: 'Invalid MAC address format' });
    }

    // Get baseline
    const baselineResult = await db.query(
      'SELECT * FROM ttl_baselines WHERE client_mac = $1',
      [mac]
    );

    // Get recent anomalies
    const anomaliesResult = await db.query(
      'SELECT * FROM ttl_anomalies WHERE client_mac = $1 ORDER BY created_at DESC LIMIT 10',
      [mac]
    );

    // Get violations
    const violationsResult = await db.query(
      'SELECT * FROM ttl_violations WHERE client_mac = $1 ORDER BY created_at DESC LIMIT 5',
      [mac]
    );

    res.json({
      success: true,
      client_mac: mac,
      baseline: baselineResult.rows[0] || null,
      recent_anomalies: anomaliesResult.rows,
      violations: violationsResult.rows,
      statistics: {
        total_anomalies: anomaliesResult.rows.length,
        total_violations: violationsResult.rows.length,
        active_violations: violationsResult.rows.filter(v => !v.resolved).length
      }
    });
  } catch (error) {
    console.error('Failed to get client stats:', error);
    res.status(500).json({ error: 'Failed to get client statistics' });
  }
});

module.exports = router;
