const Database = require('better-sqlite3');
const path = require('path');

/**
 * SQLite database adapter for PISOWifi
 * Simple, reliable database for Orange Pi deployment
 */

let db;
let isInitialized = false;

const DB_PATH = path.join(__dirname, '../../pisowifi.db');

async function initializeDatabase() {
  if (isInitialized) return;

  console.log('📁 Connecting to SQLite database...');

  try {
    db = new Database(DB_PATH);

    console.log('✅ SQLite connection successful');

    // Enable foreign keys
    db.exec('PRAGMA foreign_keys = ON');

    // Ensure basic tables exist
    await ensureBasicTables();

    isInitialized = true;
    console.log('✅ Database initialized successfully');

  } catch (error) {
    console.error('❌ Database initialization failed:', error.message);
    throw error;
  }
}

async function ensureBasicTables() {
  console.log('📝 Ensuring basic tables exist...');

  const basicTables = [
    `CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username VARCHAR(50) UNIQUE NOT NULL,
      email VARCHAR(100) UNIQUE,
      password VARCHAR(255) NOT NULL,
      role VARCHAR(20) DEFAULT 'admin',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,

    `CREATE TABLE IF NOT EXISTS clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mac_address VARCHAR(17) UNIQUE NOT NULL,
      ip_address VARCHAR(45),
      session_token VARCHAR(64),
      device_name VARCHAR(100),
      device_type VARCHAR(20),
      os VARCHAR(50),
      browser VARCHAR(50),
      user_agent TEXT,
      platform VARCHAR(50),
      language VARCHAR(10),
      screen_resolution VARCHAR(20),
      timezone VARCHAR(50),
      status VARCHAR(20) DEFAULT 'DISCONNECTED',
      time_remaining INTEGER DEFAULT 0,
      paused_until DATETIME,
      total_amount_paid DECIMAL(10,2) DEFAULT 0.00,
      session_start DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
      upload_limit INTEGER DEFAULT 0,
      download_limit INTEGER DEFAULT 0
    )`,

    `CREATE TABLE IF NOT EXISTS rates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name VARCHAR(100) NOT NULL,
      price DECIMAL(10,2) NOT NULL,
      duration INTEGER NOT NULL,
      coins_required INTEGER DEFAULT 1,
      is_active BOOLEAN DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,

    `CREATE TABLE IF NOT EXISTS portal_settings (
      id INTEGER PRIMARY KEY DEFAULT 1,
      coin_timeout INTEGER DEFAULT 60,
      portal_title VARCHAR(200) DEFAULT 'PISOWifi Portal',
      portal_subtitle VARCHAR(200) DEFAULT 'Insert coins for internet access',
      banner_image_url TEXT,
      coin_insert_audio_url TEXT,
      coin_success_audio_url TEXT,
      coin_background_audio_url TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,

    `CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
      mac_address VARCHAR(17) NOT NULL,
      ip_address VARCHAR(45),
      session_token VARCHAR(64),
      duration INTEGER DEFAULT 0,
      status VARCHAR(20) DEFAULT 'ACTIVE',
      started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      ended_at DATETIME
    )`,

    `CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
      session_id INTEGER REFERENCES sessions(id) ON DELETE SET NULL,
      amount DECIMAL(10,2) NOT NULL DEFAULT 0.00,
      coins_used INTEGER DEFAULT 0,
      payment_method VARCHAR(20) DEFAULT 'COIN',
      status VARCHAR(20) DEFAULT 'COMPLETED',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,

    `CREATE TABLE IF NOT EXISTS system_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      level VARCHAR(10) NOT NULL,
      message TEXT NOT NULL,
      category VARCHAR(50),
      metadata TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,

    `CREATE TABLE IF NOT EXISTS coin_slots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slot_number INTEGER UNIQUE NOT NULL,
      status VARCHAR(20) DEFAULT 'available',
      claimed_by_client_id INTEGER,
      claimed_by_ip VARCHAR(45),
      claimed_by_mac VARCHAR(17),
      claimed_by_session_token VARCHAR(64),
      claimed_at DATETIME,
      expires_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,

    `CREATE TABLE IF NOT EXISTS coin_queues (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slot_id INTEGER REFERENCES coin_slots(id) ON DELETE SET NULL,
      client_id INTEGER,
      client_ip VARCHAR(45),
      client_mac VARCHAR(17),
      session_token VARCHAR(64),
      coin_value DECIMAL(10,2) DEFAULT 0.00,
      coin_count INTEGER DEFAULT 1,
      total_value DECIMAL(10,2) DEFAULT 0.00,
      status VARCHAR(20) DEFAULT 'queued',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,

    `CREATE TABLE IF NOT EXISTS network_settings (
      id INTEGER PRIMARY KEY DEFAULT 1,
      gateway_ip VARCHAR(45) DEFAULT '10.0.0.1',
      dhcp_start VARCHAR(45) DEFAULT '10.0.0.10',
      dhcp_end VARCHAR(45) DEFAULT '10.0.0.100',
      lease_time VARCHAR(10) DEFAULT '12h',
      interface VARCHAR(50) DEFAULT 'enx00e04c68276e',
      dns_server VARCHAR(45) DEFAULT '8.8.8.8',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,

    `CREATE TABLE IF NOT EXISTS gpio_settings (
      id INTEGER PRIMARY KEY DEFAULT 1,
      coin_pin INTEGER DEFAULT 3,
      coin_pin_mode VARCHAR(10) DEFAULT 'BCM',
      led_pin INTEGER DEFAULT 5,
      led_pin_mode VARCHAR(10) DEFAULT 'BCM',
      debounce_time INTEGER DEFAULT 200,
      pulse_width INTEGER DEFAULT 50,
      coin_value DECIMAL(10,2) DEFAULT 5.00,
      pulses_per_coin INTEGER DEFAULT 1,
      pulse_duration INTEGER DEFAULT 100,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,

    `CREATE TABLE IF NOT EXISTS system_settings (
      id INTEGER PRIMARY KEY DEFAULT 1,
      auto_restart BOOLEAN DEFAULT 1,
      restart_time VARCHAR(10) DEFAULT '03:00',
      max_clients INTEGER DEFAULT 100,
      session_timeout INTEGER DEFAULT 7200,
      log_level VARCHAR(10) DEFAULT 'info',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,

    `CREATE TABLE IF NOT EXISTS network_config (
      id INTEGER PRIMARY KEY DEFAULT 1,
      dhcp_enabled BOOLEAN DEFAULT 1,
      dhcp_range_start VARCHAR(15) DEFAULT '10.0.0.10',
      dhcp_range_end VARCHAR(15) DEFAULT '10.0.0.200',
      subnet_mask VARCHAR(15) DEFAULT '255.255.255.0',
      gateway VARCHAR(15) DEFAULT '10.0.0.1',
      dns_primary VARCHAR(15) DEFAULT '8.8.8.8',
      dns_secondary VARCHAR(15) DEFAULT '8.8.4.4',
      lease_time INTEGER DEFAULT 3600,
      wifi_interface VARCHAR(20) DEFAULT 'wlan0',
      ethernet_interface VARCHAR(20) DEFAULT 'eth0',
      wan_mode VARCHAR(10) DEFAULT 'dhcp',
      wan_interface VARCHAR(20) DEFAULT 'eth0',
      pppoe_username VARCHAR(64),
      pppoe_password VARCHAR(128),
      pppoe_mtu INTEGER DEFAULT 1492,
      bandwidth_enabled BOOLEAN DEFAULT 0,
      bandwidth_download_limit INTEGER DEFAULT 10,
      bandwidth_upload_limit INTEGER DEFAULT 5,
      per_client_bandwidth_enabled BOOLEAN DEFAULT 0,
      per_client_download_limit INTEGER DEFAULT 2048,
      per_client_upload_limit INTEGER DEFAULT 1024,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,

    `CREATE TABLE IF NOT EXISTS coin_attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_ip VARCHAR(45) NOT NULL,
      client_mac VARCHAR(17),
      session_token VARCHAR(64),
      attempt_type VARCHAR(20) DEFAULT 'insert',
      blocked_until DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,

    `CREATE TABLE IF NOT EXISTS ttl_settings (
      id INTEGER PRIMARY KEY DEFAULT 1,
      enabled BOOLEAN DEFAULT 0,
      sensitivity TEXT DEFAULT 'medium',
      auto_block BOOLEAN DEFAULT 0,
      alert_threshold INTEGER DEFAULT 3,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(id)
    )`,

    `CREATE TABLE IF NOT EXISTS ttl_baselines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_mac TEXT UNIQUE NOT NULL,
      baseline_ttl INTEGER NOT NULL,
      established_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_verified DATETIME,
      confidence REAL DEFAULT 0.8,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,

    `CREATE TABLE IF NOT EXISTS ttl_anomalies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_mac TEXT NOT NULL,
      anomaly_type TEXT NOT NULL,
      details TEXT,
      severity TEXT DEFAULT 'medium',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (client_mac) REFERENCES clients(mac_address)
    )`,

    `CREATE TABLE IF NOT EXISTS ttl_violations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_mac TEXT NOT NULL,
      violation_count INTEGER DEFAULT 1,
      severity TEXT DEFAULT 'high',
      status TEXT DEFAULT 'pending',
      first_detected DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_detected DATETIME,
      resolved BOOLEAN DEFAULT 0,
      resolved_at DATETIME,
      admin_notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (client_mac) REFERENCES clients(mac_address)
    )`,

    `CREATE TABLE IF NOT EXISTS ttl_detection_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_mac TEXT NOT NULL,
      packet_ttl INTEGER NOT NULL,
      baseline_ttl INTEGER,
      ttl_diff INTEGER,
      is_anomaly BOOLEAN DEFAULT 0,
      anomaly_type TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (client_mac) REFERENCES clients(mac_address)
    )`,

    `CREATE TABLE IF NOT EXISTS system_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      level VARCHAR(10) DEFAULT 'info',
      message TEXT NOT NULL,
      category VARCHAR(50) DEFAULT 'system',
      metadata TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,

    `CREATE TABLE IF NOT EXISTS coin_sensor_adjustments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pulse_count INTEGER NOT NULL UNIQUE,
      actual_value DECIMAL(10,2) NOT NULL,
      note TEXT,
      is_active BOOLEAN DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,

    `CREATE INDEX IF NOT EXISTS idx_coin_attempts_ip ON coin_attempts(client_ip, created_at)`,
    `CREATE INDEX IF NOT EXISTS idx_coin_attempts_mac ON coin_attempts(client_mac, created_at)`,
    `CREATE INDEX IF NOT EXISTS idx_coin_attempts_blocked ON coin_attempts(blocked_until)`,
    `CREATE INDEX IF NOT EXISTS idx_ttl_anomalies_mac ON ttl_anomalies(client_mac)`,
    `CREATE INDEX IF NOT EXISTS idx_ttl_anomalies_type ON ttl_anomalies(anomaly_type)`,
    `CREATE INDEX IF NOT EXISTS idx_ttl_violations_mac ON ttl_violations(client_mac)`,
    `CREATE INDEX IF NOT EXISTS idx_ttl_violations_status ON ttl_violations(status)`,
    `CREATE INDEX IF NOT EXISTS idx_ttl_detection_logs_mac ON ttl_detection_logs(client_mac)`,
    `CREATE INDEX IF NOT EXISTS idx_ttl_baselines_mac ON ttl_baselines(client_mac)`,
    `CREATE INDEX IF NOT EXISTS idx_system_logs_level ON system_logs(level, created_at)`,
    `CREATE INDEX IF NOT EXISTS idx_system_logs_category ON system_logs(category, created_at)`
  ];

  for (const table of basicTables) {
    try {
      db.exec(table);
    } catch (error) {
      console.warn(`Table creation warning: ${error.message}`);
    }
  }

  // Insert default data only if tables are empty
  try {
    // Only insert default rate if no rates exist
    const rateCount = db.prepare('SELECT COUNT(*) as count FROM rates').get();
    if (rateCount.count === 0) {
      const insertRate = db.prepare(`INSERT INTO rates (name, price, duration, coins_required, is_active) VALUES (?, ?, ?, ?, ?)`);
      insertRate.run('15 Minutes', 5.00, 900, 1, 1);
      console.log('✅ Default rate created');
    }

    const insertSettings = db.prepare(`INSERT OR IGNORE INTO portal_settings (id, coin_timeout, portal_title, portal_subtitle) VALUES (?, ?, ?, ?)`);
    insertSettings.run(1, 300, 'PISOWifi Portal', 'Insert coins for internet access');

    const insertSlot = db.prepare(`INSERT OR IGNORE INTO coin_slots (slot_number, status) VALUES (?, ?)`);
    insertSlot.run(1, 'available');

    // Insert default network settings
    const insertNetworkSettings = db.prepare(`INSERT OR IGNORE INTO network_settings (id, gateway_ip, dhcp_start, dhcp_end, lease_time, interface, dns_server) VALUES (?, ?, ?, ?, ?, ?, ?)`);
    insertNetworkSettings.run(1, '10.0.0.1', '10.0.0.10', '10.0.0.100', '12h', 'enx00e04c68276e', '8.8.8.8');

    // Insert default GPIO settings
    const insertGpioSettings = db.prepare(`INSERT OR IGNORE INTO gpio_settings (id, coin_pin, led_pin, coin_value) VALUES (?, ?, ?, ?)`);
    insertGpioSettings.run(1, 3, 5, 5.00);

    // Insert default system settings  
    const insertSystemSettings = db.prepare(`INSERT OR IGNORE INTO system_settings (id, auto_restart, max_clients, session_timeout) VALUES (?, ?, ?, ?)`);
    insertSystemSettings.run(1, 1, 100, 7200);

    // Insert default calibration rules if none exist
    const adjustmentCount = db.prepare('SELECT COUNT(*) as count FROM coin_sensor_adjustments').get();
    if (adjustmentCount.count === 0) {
      const insertAdjustment = db.prepare(`INSERT INTO coin_sensor_adjustments (pulse_count, actual_value, note) VALUES (?, ?, ?)`);
      const defaults = [
        [2, 1.00, 'Bounce Fix (1 Peso extra pulse)'],
        [4, 5.00, 'Repair 5 Peso (Missing 1 pulse)'],
        [6, 5.00, 'Bounce Fix (5 Peso extra pulse)'],
        [7, 10.00, 'Repair 10 Peso (Missing 3 pulses)'],
        [8, 10.00, 'Repair 10 Peso (Missing 2 pulses)'],
        [9, 10.00, 'Repair 10 Peso (Missing 1 pulse)'],
        [11, 10.00, 'Bounce Fix (10 Peso extra pulse)'],
        [19, 20.00, 'Repair 20 Peso (Missing 1 pulse)'],
        [21, 20.00, 'Bounce Fix (20 Peso extra pulse)']
      ];
      for (const [pulse, value, note] of defaults) {
        insertAdjustment.run(pulse, value, note);
      }
      console.log('✅ Default coin sensor calibration rules created');
    }

    console.log('✅ Default data ensured');
  } catch (error) {
    console.warn('Default data warning:', error.message);
  }

  // Ensure portal_settings has media columns
  ensurePortalSettingsColumns();

  // Ensure coin_slots has session token column
  ensureCoinSlotsColumns();

  // Ensure network_config has WAN columns
  ensureNetworkConfigColumns();

  // Ensure clients has paused_until column
  ensureClientsColumns();
}

// Adds missing columns to portal_settings for banner image and audio cues
function ensurePortalSettingsColumns() {
  try {
    const columns = db.prepare('PRAGMA table_info(portal_settings)').all();
    const names = new Set(columns.map(c => c.name));

    if (!names.has('banner_image_url')) {
      db.exec('ALTER TABLE portal_settings ADD COLUMN banner_image_url TEXT');
      console.log('✅ Added banner_image_url column');
    }
    if (!names.has('coin_insert_audio_url')) {
      db.exec('ALTER TABLE portal_settings ADD COLUMN coin_insert_audio_url TEXT');
      console.log('✅ Added coin_insert_audio_url column');
    }
    if (!names.has('coin_success_audio_url')) {
      db.exec('ALTER TABLE portal_settings ADD COLUMN coin_success_audio_url TEXT');
      console.log('✅ Added coin_success_audio_url column');
    }
    if (!names.has('coin_background_audio_url')) {
      db.exec('ALTER TABLE portal_settings ADD COLUMN coin_background_audio_url TEXT');
      console.log('✅ Added coin_background_audio_url column');
    }
    if (!names.has('auto_pause_on_disconnect')) {
      db.exec('ALTER TABLE portal_settings ADD COLUMN auto_pause_on_disconnect BOOLEAN DEFAULT 0');
      console.log('✅ Added auto_pause_on_disconnect column');
    }
    if (!names.has('coin_abuse_protection')) {
      db.exec('ALTER TABLE portal_settings ADD COLUMN coin_abuse_protection BOOLEAN DEFAULT 1');
      console.log('✅ Added coin_abuse_protection column');
    }
    if (!names.has('coin_attempt_limit')) {
      db.exec('ALTER TABLE portal_settings ADD COLUMN coin_attempt_limit INTEGER DEFAULT 10');
      console.log('✅ Added coin_attempt_limit column');
    }
    if (!names.has('coin_attempt_window')) {
      db.exec('ALTER TABLE portal_settings ADD COLUMN coin_attempt_window INTEGER DEFAULT 60');
      console.log('✅ Added coin_attempt_window column (seconds)');
    }
    if (!names.has('coin_block_duration')) {
      db.exec('ALTER TABLE portal_settings ADD COLUMN coin_block_duration INTEGER DEFAULT 300');
      console.log('✅ Added coin_block_duration column (seconds)');
    }
    if (!names.has('auto_resume_on_pause')) {
      db.exec('ALTER TABLE portal_settings ADD COLUMN auto_resume_on_pause BOOLEAN DEFAULT 0');
      console.log('✅ Added auto_resume_on_pause column');
    }
    if (!names.has('pause_resume_minutes')) {
      db.exec('ALTER TABLE portal_settings ADD COLUMN pause_resume_minutes INTEGER DEFAULT 0');
      console.log('✅ Added pause_resume_minutes column');
    }
  } catch (error) {
    console.warn('Portal settings migration warning:', error.message);
  }
}

// Adds missing columns to coin_slots for session token
function ensureCoinSlotsColumns() {
  try {
    const columns = db.prepare('PRAGMA table_info(coin_slots)').all();
    const names = new Set(columns.map(c => c.name));

    if (!names.has('claimed_by_session_token')) {
      db.exec('ALTER TABLE coin_slots ADD COLUMN claimed_by_session_token TEXT');
      console.log('✅ Added claimed_by_session_token column');
    }
  } catch (error) {
    console.warn('Coin slots migration warning:', error.message);
  }
}

// Adds missing columns to network_config for WAN/PPPoE
function ensureNetworkConfigColumns() {
  try {
    const columns = db.prepare('PRAGMA table_info(network_config)').all();
    const names = new Set(columns.map(c => c.name));

    if (!names.has('wan_mode')) {
      db.exec("ALTER TABLE network_config ADD COLUMN wan_mode TEXT DEFAULT 'dhcp'");
      console.log('✅ Added wan_mode column');
    }
    if (!names.has('wan_interface')) {
      db.exec("ALTER TABLE network_config ADD COLUMN wan_interface TEXT DEFAULT 'eth0'");
      console.log('✅ Added wan_interface column');
    }
    if (!names.has('pppoe_username')) {
      db.exec('ALTER TABLE network_config ADD COLUMN pppoe_username TEXT');
      console.log('✅ Added pppoe_username column');
    }
    if (!names.has('pppoe_password')) {
      db.exec('ALTER TABLE network_config ADD COLUMN pppoe_password TEXT');
      console.log('✅ Added pppoe_password column');
    }
    if (!names.has('pppoe_mtu')) {
      db.exec('ALTER TABLE network_config ADD COLUMN pppoe_mtu INTEGER DEFAULT 1492');
      console.log('✅ Added pppoe_mtu column');
    }
    if (!names.has('per_client_bandwidth_enabled')) {
      db.exec('ALTER TABLE network_config ADD COLUMN per_client_bandwidth_enabled BOOLEAN DEFAULT 0');
      console.log('✅ Added per_client_bandwidth_enabled column');
    }
    if (!names.has('per_client_download_limit')) {
      db.exec('ALTER TABLE network_config ADD COLUMN per_client_download_limit INTEGER DEFAULT 2048');
      console.log('✅ Added per_client_download_limit column');
    }
    if (!names.has('per_client_upload_limit')) {
      db.exec('ALTER TABLE network_config ADD COLUMN per_client_upload_limit INTEGER DEFAULT 1024');
      console.log('✅ Added per_client_upload_limit column');
    }
  } catch (error) {
    console.warn('Network config migration warning:', error.message);
  }
}

// Adds missing columns to clients
function ensureClientsColumns() {
  try {
    const columns = db.prepare('PRAGMA table_info(clients)').all();
    const names = new Set(columns.map(c => c.name));

    if (!names.has('paused_until')) {
      db.exec('ALTER TABLE clients ADD COLUMN paused_until DATETIME');
      console.log('✅ Added paused_until column');
    }
  } catch (error) {
    console.warn('Clients migration warning:', error.message);
  }
}

function runQuery(sql, params = []) {
  try {
    // Convert PostgreSQL-style $1, $2, $3... to SQLite-style ?
    let sqliteQuery = sql;
    if (params.length > 0) {
      for (let i = params.length; i >= 1; i--) {
        sqliteQuery = sqliteQuery.replace(new RegExp('\\$' + i, 'g'), '?');
      }
    }

    const result = db.prepare(sqliteQuery).run(...params);
    return { lastID: result.lastInsertRowid, changes: result.changes };
  } catch (error) {
    throw error;
  }
}

async function query(text, params = []) {
  if (!isInitialized) {
    await initializeDatabase();
  }

  try {
    // Handle PostgreSQL transaction commands - SQLite with better-sqlite3 auto-commits
    const upperText = text.trim().toUpperCase();
    if (upperText === 'BEGIN' || upperText === 'COMMIT' || upperText === 'ROLLBACK') {
      // No-op for transaction commands - better-sqlite3 is synchronous and auto-commits
      return { rows: [], rowCount: 0 };
    }

    // Convert PostgreSQL-style $1, $2, $3... to SQLite-style ?
    let sqliteQuery = text;
    let sqliteParams = [];
    
    // Remove PostgreSQL type casts like ::INTEGER, ::DECIMAL(10,2), ::TEXT, etc.
    // Match :: followed by word characters and optional parenthesized precision
    sqliteQuery = sqliteQuery.replace(/::[A-Za-z_][A-Za-z0-9_]*(\s*\(\s*\d+\s*(,\s*\d+\s*)?\))?/gi, '');
    
    if (params.length > 0) {
      // Track all placeholder occurrences and build params in order
      const placeholders = [];
      const placeholderRegex = /\$(\d+)/g;
      let match;
      
      // Find all placeholder occurrences in order of appearance
      while ((match = placeholderRegex.exec(text)) !== null) {
        placeholders.push(parseInt(match[1]));
      }
      
      // Build params array for SQLite: for each placeholder, get the corresponding param
      for (const placeholderIndex of placeholders) {
        sqliteParams.push(params[placeholderIndex - 1]);
      }
      
      // Replace all $1, $2, etc. with ? in order of appearance
      // IMPORTANT: Use sqliteQuery (which has casts removed) not text
      sqliteQuery = sqliteQuery.replace(/\$\d+/g, () => '?');
    }

    // Handle SELECT queries
    if (sqliteQuery.trim().toUpperCase().startsWith('SELECT')) {
      const stmt = db.prepare(sqliteQuery);
      const rows = stmt.all(...(sqliteParams.length > 0 ? sqliteParams : params));
      return { rows: rows || [], rowCount: rows ? rows.length : 0 };
    } else {
      // Handle INSERT, UPDATE, DELETE queries
      // Check if query has RETURNING clause (PostgreSQL compatibility)
      const hasReturning = sqliteQuery.toUpperCase().includes('RETURNING');
      
      if (hasReturning) {
        // SQLite 3.35+ supports RETURNING, but better-sqlite3 handles it differently
        // We need to use .all() for queries with RETURNING to get the rows
        try {
          const stmt = db.prepare(sqliteQuery);
          const rows = stmt.all(...(sqliteParams.length > 0 ? sqliteParams : params));
          return { rows: rows || [], rowCount: rows ? rows.length : 0 };
        } catch (returningError) {
          // If RETURNING is not supported, fall back to running without it
          // Remove RETURNING clause and run as regular update
          const queryWithoutReturning = sqliteQuery.replace(/\s+RETURNING\s+.*/i, '');
          const result = runQuery(queryWithoutReturning, sqliteParams.length > 0 ? sqliteParams : params);
          return { rows: [], rowCount: result.changes };
        }
      } else {
        const result = runQuery(sqliteQuery, sqliteParams.length > 0 ? sqliteParams : params);
        return { rows: [], rowCount: result.changes };
      }
    }
  } catch (error) {
    console.error('Query error:', error.message);
    console.error('Query:', text);
    console.error('Params:', params);
    throw error;
  }
}

async function close() {
  if (db) {
    try {
      db.close();
      isInitialized = false;
    } catch (error) {
      console.error('Error closing database:', error.message);
    }
  }
}

module.exports = {
  query,
  close,
  initializeDatabase
};