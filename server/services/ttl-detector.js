const { exec, spawn } = require('child_process');
const { promisify } = require('util');
const db = require('../db/sqlite-adapter');
const { logSystemEvent } = require('../utils/system-logger');

const execAsync = promisify(exec);

/**
 * TTL (Time To Live) Anti-Tethering Detection Service
 * Monitors IP packets to detect if a client is sharing/tethering internet
 * 
 * How it works:
 * - Each OS has default TTL: Linux/macOS=64, Windows=128
 * - Direct connection = consistent TTL for all packets from a MAC
 * - Tethering = TTL varies or decreases (packets relayed through another device)
 */

class TTLDetector {
  constructor() {
    this.enabled = false;
    this.sensitivity = 'medium'; // low, medium, high
    this.baselineTTL = new Map(); // MAC -> baseline TTL
    this.anomalies = new Map(); // MAC -> array of anomaly events
    this.autoBlock = false;
    this.alertThreshold = 3;
    this.monitorProcess = null;
    this.ipMacCache = new Map(); // IP -> MAC
    this.cacheLastRefresh = 0;
    this.cacheRefreshMs = 30000; // 30s
    this.monitorRestartDelayMs = 5000;
    this._restartTimer = null;
    this._lastTcpdumpWarnAt = 0;
    this._lastTcpdumpExitAt = 0;
  }

  /**
   * Initialize TTL detector with settings from database
   */
  async initialize() {
    try {
      const result = await db.query('SELECT * FROM ttl_settings WHERE id = 1');
      
      if (result.rows.length > 0) {
        const settings = result.rows[0];
        this.enabled = settings.enabled;
        this.sensitivity = settings.sensitivity || 'medium';
        this.autoBlock = settings.auto_block || false;
        this.alertThreshold = settings.alert_threshold || 3;
        console.log('✅ TTL Detector initialized');
        console.log(`   Enabled: ${this.enabled}`);
        console.log(`   Sensitivity: ${this.sensitivity}`);
        console.log(`   Auto-block: ${this.autoBlock}`);
        console.log(`   Alert threshold: ${this.alertThreshold}`);
      } else {
        // Create default settings
        await this.createDefaultSettings();
      }
    } catch (error) {
      console.warn('Failed to initialize TTL detector:', error.message);
    }
  }

  /**
   * Create default TTL settings
   */
  async createDefaultSettings() {
    try {
      await db.query(`
        INSERT INTO ttl_settings (enabled, sensitivity, auto_block, alert_threshold)
        VALUES (0, 'medium', 0, 3)
      `);
      console.log('✅ Default TTL settings created');
    } catch (error) {
      console.warn('Failed to create TTL settings:', error.message);
    }
  }

  /**
   * Establish baseline TTL for a new client
   */
  establishBaseline(clientMAC, ttl) {
    if (!this.enabled) return;
    
    this.baselineTTL.set(clientMAC, {
      ttl: ttl,
      timestamp: Date.now(),
      packets: 1
    });
    
    console.log(`[TTL] Baseline established for ${clientMAC}: TTL=${ttl}`);

    // Persist baseline to database
    this.saveBaselineToDB(clientMAC, ttl).catch(error => {
      console.warn('Failed to save TTL baseline:', error.message);
    });
  }

  /**
   * Check packet TTL for anomalies
   * Returns: { isAnomaly: boolean, anomalyType: string }
   */
  async checkPacket(clientMAC, ttl) {
    if (!this.enabled) return { isAnomaly: false };

    const baseline = this.baselineTTL.get(clientMAC);
    
    if (!baseline) {
      // Try to load baseline from DB
      try {
        const result = await db.query(
          'SELECT baseline_ttl FROM ttl_baselines WHERE client_mac = $1',
          [clientMAC]
        );
        if (result.rows.length > 0) {
          this.baselineTTL.set(clientMAC, {
            ttl: result.rows[0].baseline_ttl,
            timestamp: Date.now(),
            packets: 1
          });
        } else {
          this.establishBaseline(clientMAC, ttl);
          return { isAnomaly: false };
        }
      } catch (error) {
        console.warn('Failed to load TTL baseline:', error.message);
        this.establishBaseline(clientMAC, ttl);
        return { isAnomaly: false };
      }
    }

    // Calculate TTL difference
    const ttlDiff = Math.abs(baseline.ttl - ttl);
    const threshold = this.getThreshold();

    let isAnomaly = false;
    let anomalyType = null;

    // Check for anomalies based on sensitivity
    if (ttlDiff > threshold) {
      isAnomaly = true;
      anomalyType = 'ttl_variance';
      
      // Log anomaly
      this.recordAnomaly(clientMAC, {
        type: 'ttl_variance',
        baseline_ttl: baseline.ttl,
        observed_ttl: ttl,
        difference: ttlDiff,
        timestamp: Date.now()
      });
    }

    // Check for decreasing TTL (indicates routing through another device)
    if (ttl < baseline.ttl - 1) {
      isAnomaly = true;
      anomalyType = 'ttl_decrement';
      
      this.recordAnomaly(clientMAC, {
        type: 'ttl_decrement',
        baseline_ttl: baseline.ttl,
        observed_ttl: ttl,
        hops: baseline.ttl - ttl,
        timestamp: Date.now()
      });
    }

    // Check for multiple consistent TTL values (indicates multiple devices)
    if (baseline.packets < 10) {
      baseline.packets++;
      if (ttl !== baseline.ttl) {
        baseline.variations = (baseline.variations || 0) + 1;
        
        if (baseline.variations >= 3) {
          isAnomaly = true;
          anomalyType = 'multiple_devices';
          
          this.recordAnomaly(clientMAC, {
            type: 'multiple_devices',
            detected_ttls: Array.from(new Set([baseline.ttl, ttl])),
            timestamp: Date.now()
          });
        }
      }
    }

    return { isAnomaly, anomalyType };
  }

  /**
   * Get TTL threshold based on sensitivity setting
   */
  getThreshold() {
    switch (this.sensitivity) {
      case 'high':
        return 0; // No variance allowed
      case 'medium':
        return 1; // Allow 1 TTL difference
      case 'low':
        return 2; // Allow 2 TTL differences
      default:
        return 1;
    }
  }

  /**
   * Record anomaly event
   */
  recordAnomaly(clientMAC, anomalyData) {
    if (!this.anomalies.has(clientMAC)) {
      this.anomalies.set(clientMAC, []);
    }

    const anomalies = this.anomalies.get(clientMAC);
    anomalies.push(anomalyData);

    // Keep only last 100 anomalies per client
    if (anomalies.length > 100) {
      anomalies.shift();
    }

    // Log to database
    this.saveAnomalyToDB(clientMAC, anomalyData);

    // Check if auto-block threshold exceeded
    if (this.autoBlock && anomalies.length >= this.alertThreshold) {
      this.flagClientForBlocking(clientMAC);
    }
  }

  /**
   * Persist baseline TTL to database
   */
  async saveBaselineToDB(clientMAC, ttl) {
    await db.query(`
      INSERT INTO ttl_baselines (client_mac, baseline_ttl, established_at, last_verified, confidence)
      VALUES ($1, $2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 0.8)
      ON CONFLICT(client_mac) DO UPDATE SET
        baseline_ttl = EXCLUDED.baseline_ttl,
        last_verified = CURRENT_TIMESTAMP,
        confidence = 0.8
    `, [clientMAC, ttl]);
  }

  /**
   * Save anomaly to database
   */
  async saveAnomalyToDB(clientMAC, anomalyData) {
    try {
      await db.query(`
        INSERT INTO ttl_anomalies (client_mac, anomaly_type, details, created_at)
        VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
      `, [clientMAC, anomalyData.type, JSON.stringify(anomalyData)]);
    } catch (error) {
      console.warn('Failed to save TTL anomaly:', error.message);
    }
  }

  /**
   * Flag client for potential blocking
   */
  async flagClientForBlocking(clientMAC) {
    try {
      // Check if already flagged
      const existing = await db.query(
        'SELECT * FROM ttl_violations WHERE client_mac = $1 AND resolved = false',
        [clientMAC]
      );

      if (existing.rows.length === 0) {
        await db.query(`
          INSERT INTO ttl_violations (client_mac, violation_count, severity, status)
          VALUES ($1, 1, 'high', 'pending')
        `, [clientMAC]);

        console.warn(`⚠️  TTL Violation: ${clientMAC} - Potential tethering detected`);
      } else {
        await db.query(
          'UPDATE ttl_violations SET violation_count = violation_count + 1 WHERE client_mac = $1',
          [clientMAC]
        );
      }

      // Apply TTL filter to drop tethered packets but keep client connected
      await this.applyTtlFilter(clientMAC);
    } catch (error) {
      console.warn('Failed to flag client:', error.message);
    }
  }

  /**
   * Apply iptables rule to drop packets with TTL mismatch (anti-tethering)
   * Keeps client1 connected while preventing shared traffic from client2.
   */
  async applyTtlFilter(clientMAC) {
    try {
      const baseline = this.baselineTTL.get(clientMAC);
      if (!baseline || !baseline.ttl) {
        console.warn('[TTL] No baseline available for TTL filter:', clientMAC);
        return;
      }

      const ttl = parseInt(baseline.ttl, 10);
      if (Number.isNaN(ttl) || ttl < 1 || ttl > 255) {
        console.warn('[TTL] Invalid baseline TTL for filter:', baseline.ttl);
        return;
      }

      const ttlModuleOk = await this.ensureTtlModule();
      if (!ttlModuleOk) {
        console.warn('[TTL] ttl match module not available; cannot apply TTL filter');
        return;
      }

      const rule = `-t mangle -A PREROUTING -m mac --mac-source ${clientMAC} -m ttl ! --ttl-eq ${ttl} -j DROP`;
      const check = `-t mangle -C PREROUTING -m mac --mac-source ${clientMAC} -m ttl ! --ttl-eq ${ttl} -j DROP`;

      try {
        await execAsync(`sudo iptables ${check}`);
        // Rule already exists
        return;
      } catch (_) {
        // Rule does not exist; add it
      }

      await execAsync(`sudo iptables ${rule}`);
      console.warn(`[TTL] Applied TTL filter for ${clientMAC} (baseline TTL=${ttl})`);
    } catch (error) {
      console.warn('[TTL] Failed to apply TTL filter:', error.message);
    }
  }

  /**
   * Remove TTL filter rule (if present)
   */
  async removeTtlFilter(clientMAC) {
    try {
      const baseline = this.baselineTTL.get(clientMAC);
      const ttl = baseline?.ttl ? parseInt(baseline.ttl, 10) : null;
      if (!ttl || Number.isNaN(ttl)) {
        return;
      }

      const rule = `-t mangle -D PREROUTING -m mac --mac-source ${clientMAC} -m ttl ! --ttl-eq ${ttl} -j DROP`;
      await execAsync(`sudo iptables ${rule}`);
      console.log(`[TTL] Removed TTL filter for ${clientMAC}`);
    } catch (error) {
      // Ignore if rule doesn't exist
    }
  }

  /**
   * Monitor network traffic using tcpdump (requires root)
   * Captures IP packets and analyzes TTL values
   */
  async startTrafficMonitoring(networkInterface = 'wlan0') {
    if (!this.enabled) return;

    if (this.monitorProcess) {
      console.warn('[TTL] Traffic monitoring already running');
      return;
    }

    try {
      // Ensure ttl match is available before monitoring
      const ttlModuleOk = await this.ensureTtlModule();
      if (!ttlModuleOk) {
        console.warn('[TTL] ttl match module not available; monitoring will still run but filtering may fail');
      }

      console.log(`[TTL] Starting traffic monitoring on ${networkInterface}...`);

      // Prime ARP/neighbor cache
      await this.refreshIpMacCache(networkInterface);

      // Spawn tcpdump in line-buffered mode
      this.monitorProcess = spawn('sudo', ['tcpdump', '-l', '-n', '-i', networkInterface, '-v', 'ip'], {
        stdio: ['ignore', 'pipe', 'pipe']
      });

      this.monitorProcess.stdout.on('data', async (data) => {
        const lines = data.toString().split('\n').filter(Boolean);
        for (const line of lines) {
          const parsed = this.parseTcpdumpLine(line);
          if (!parsed) continue;

          const { srcIp, ttl } = parsed;

          // Refresh cache periodically
          if (Date.now() - this.cacheLastRefresh > this.cacheRefreshMs) {
            await this.refreshIpMacCache(networkInterface);
          }

          const mac = this.ipMacCache.get(srcIp);
          if (!mac) continue;

          await this.checkPacket(mac, ttl);
        }
      });

      this.monitorProcess.stderr.on('data', (data) => {
        const msg = data.toString().trim();
        if (msg) {
          console.warn('[TTL] tcpdump warning:', msg);
          const now = Date.now();
          if (now - this._lastTcpdumpWarnAt > 5 * 60 * 1000) {
            this._lastTcpdumpWarnAt = now;
            logSystemEvent('warn', `tcpdump warning: ${msg}`, 'ttl');
          }
        }
      });

      this.monitorProcess.on('close', (code) => {
        console.warn(`[TTL] tcpdump exited with code ${code}`);
        const now = Date.now();
        if (now - this._lastTcpdumpExitAt > 5 * 60 * 1000) {
          this._lastTcpdumpExitAt = now;
          logSystemEvent('error', `tcpdump exited with code ${code}`, 'ttl');
        }
        this.monitorProcess = null;
        if (this.enabled) {
          this.scheduleMonitorRestart(networkInterface);
        }
      });
    } catch (error) {
      console.warn('Failed to start traffic monitoring:', error.message);
      if (this.enabled) {
        this.scheduleMonitorRestart(networkInterface);
      }
    }
  }

  scheduleMonitorRestart(networkInterface) {
    if (this._restartTimer) return;
    this._restartTimer = setTimeout(async () => {
      this._restartTimer = null;
      if (!this.enabled) return;
      await this.startTrafficMonitoring(networkInterface);
    }, this.monitorRestartDelayMs);
  }

  /**
   * Stop traffic monitoring
   */
  stopTrafficMonitoring() {
    if (this.monitorProcess) {
      this.monitorProcess.kill('SIGTERM');
      this.monitorProcess = null;
      console.log('[TTL] Traffic monitoring stopped');
    }
    if (this._restartTimer) {
      clearTimeout(this._restartTimer);
      this._restartTimer = null;
    }
  }

  /**
   * Parse tcpdump output line
   */
  parseTcpdumpLine(line) {
    // Example: "IP 10.0.0.10.12345 > 8.8.8.8.53: ... ttl 64"
    const ipMatch = line.match(/IP\s+(\d+\.\d+\.\d+\.\d+)\./);
    const ttlMatch = line.match(/ttl\s+(\d+)/i);
    if (!ipMatch || !ttlMatch) return null;

    return {
      srcIp: ipMatch[1],
      ttl: parseInt(ttlMatch[1], 10)
    };
  }

  /**
   * Refresh IP -> MAC cache using ip neighbor
   */
  async refreshIpMacCache(networkInterface) {
    try {
      const { stdout } = await execAsync(`ip neigh show dev ${networkInterface} 2>/dev/null || echo ""`);
      const lines = stdout.split('\n').filter(Boolean);
      const newCache = new Map();

      for (const line of lines) {
        // Format: 10.0.0.10 lladdr aa:bb:cc:dd:ee:ff REACHABLE
        const match = line.match(/(\d+\.\d+\.\d+\.\d+)\s+lladdr\s+([0-9a-f:]{17})/i);
        if (match) {
          newCache.set(match[1], match[2].toUpperCase());
        }
      }

      this.ipMacCache = newCache;
      this.cacheLastRefresh = Date.now();
      if (newCache.size === 0) {
        await this.refreshIpMacCacheFromArp();
      }
    } catch (error) {
      console.warn('[TTL] Failed to refresh IP/MAC cache:', error.message);
      await this.refreshIpMacCacheFromArp();
    }
  }

  async refreshIpMacCacheFromArp() {
    try {
      const { stdout } = await execAsync('arp -n 2>/dev/null || echo ""');
      const lines = stdout.split('\n').filter(Boolean);
      const newCache = new Map(this.ipMacCache);

      for (const line of lines) {
        // Example: 10.0.0.10 ether aa:bb:cc:dd:ee:ff C wlan0
        const match = line.match(/(\d+\.\d+\.\d+\.\d+)\s+.*?\s+([0-9a-f:]{17})/i);
        if (match) {
          newCache.set(match[1], match[2].toUpperCase());
        }
      }

      this.ipMacCache = newCache;
      this.cacheLastRefresh = Date.now();
    } catch (error) {
      console.warn('[TTL] Failed to refresh ARP cache:', error.message);
    }
  }

  async ensureTtlModule() {
    try {
      const { stdout } = await execAsync("cat /proc/modules | grep -E '^xt_TTL ' || echo ''");
      if (stdout && stdout.trim().length > 0) {
        return true;
      }
      await execAsync('sudo modprobe xt_TTL');
      return true;
    } catch (error) {
      console.warn('[TTL] ttl module check/load failed:', error.message);
      return false;
    }
  }

  /**
   * Get TTL monitoring status for dashboard
   */
  getStatus() {
    return {
      enabled: this.enabled,
      active: !!this.monitorProcess,
      cacheSize: this.ipMacCache.size,
      lastCacheRefresh: this.cacheLastRefresh ? new Date(this.cacheLastRefresh).toISOString() : null,
      alertThreshold: this.alertThreshold
    };
  }

  /**
   * Get TTL detection settings
   */
  async getSettings() {
    try {
      const result = await db.query('SELECT * FROM ttl_settings WHERE id = 1');
      return result.rows[0] || null;
    } catch (error) {
      console.warn('Failed to get TTL settings:', error.message);
      return null;
    }
  }

  /**
   * Update TTL detection settings
   */
  async updateSettings(enabled, sensitivity, autoBlock, alertThreshold) {
    try {
      // Convert booleans to integers for SQLite
      const enabledInt = enabled ? 1 : 0;
      const autoBlockInt = autoBlock ? 1 : 0;
      
      await db.query(`
        INSERT INTO ttl_settings (id, enabled, sensitivity, auto_block, alert_threshold, updated_at)
        VALUES (1, $1, $2, $3, $4, CURRENT_TIMESTAMP)
        ON CONFLICT(id) DO UPDATE SET
          enabled = EXCLUDED.enabled,
          sensitivity = EXCLUDED.sensitivity,
          auto_block = EXCLUDED.auto_block,
          alert_threshold = EXCLUDED.alert_threshold,
          updated_at = CURRENT_TIMESTAMP
      `, [enabledInt, sensitivity, autoBlockInt, alertThreshold]);

      this.enabled = enabled;
      this.sensitivity = sensitivity;
      this.autoBlock = autoBlock;
      this.alertThreshold = alertThreshold;

      console.log('✅ TTL settings updated');
      return true;
    } catch (error) {
      console.warn('Failed to update TTL settings:', error.message);
      return false;
    }
  }

  /**
   * Get TTL violations/anomalies
   */
  async getViolations(limit = 50) {
    try {
      const result = await db.query(`
        SELECT * FROM ttl_violations 
        ORDER BY created_at DESC 
        LIMIT $1
      `, [limit]);

      return result.rows;
    } catch (error) {
      console.warn('Failed to get TTL violations:', error.message);
      return [];
    }
  }

  /**
   * Get TTL anomaly logs
   */
  async getAnomalyLogs(clientMAC = null, limit = 100) {
    try {
      let query;
      let params;

      if (clientMAC) {
        query = 'SELECT * FROM ttl_anomalies WHERE client_mac = $1 ORDER BY created_at DESC LIMIT $2';
        params = [clientMAC, limit];
      } else {
        query = 'SELECT * FROM ttl_anomalies ORDER BY created_at DESC LIMIT $1';
        params = [limit];
      }

      const result = await db.query(query, params);
      return result.rows;
    } catch (error) {
      console.warn('Failed to get anomaly logs:', error.message);
      return [];
    }
  }

  /**
   * Reset baseline for a client (e.g., when they reconnect)
   */
  resetBaseline(clientMAC) {
    this.baselineTTL.delete(clientMAC);
    console.log(`[TTL] Baseline reset for ${clientMAC}`);

    // Remove persisted baseline
    db.query('DELETE FROM ttl_baselines WHERE client_mac = $1', [clientMAC])
      .catch(error => {
        console.warn('Failed to delete TTL baseline:', error.message);
      });

    // Remove TTL filter rule for this client
    this.removeTtlFilter(clientMAC).catch(() => {});
  }

  /**
   * Clear all anomalies for a client
   */
  async clearAnomalies(clientMAC) {
    try {
      await db.query(
        'DELETE FROM ttl_anomalies WHERE client_mac = $1',
        [clientMAC]
      );

      this.anomalies.delete(clientMAC);
      console.log(`[TTL] Anomalies cleared for ${clientMAC}`);
      return true;
    } catch (error) {
      console.warn('Failed to clear anomalies:', error.message);
      return false;
    }
  }

  /**
   * Resolve a TTL violation
   */
  async resolveViolation(violationId) {
    try {
      await db.query(
        'UPDATE ttl_violations SET resolved = true, status = $1 WHERE id = $2',
        ['resolved', violationId]
      );

      return true;
    } catch (error) {
      console.warn('Failed to resolve violation:', error.message);
      return false;
    }
  }
}

// Export singleton instance
module.exports = new TTLDetector();
