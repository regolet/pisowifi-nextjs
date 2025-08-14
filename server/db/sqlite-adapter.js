const sqlite3 = require('sqlite3').verbose();
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
    db = new sqlite3.Database(DB_PATH, (err) => {
      if (err) {
        console.error('❌ SQLite connection failed:', err.message);
        throw err;
      }
    });
    
    console.log('✅ SQLite connection successful');
    
    // Enable foreign keys
    await runQuery('PRAGMA foreign_keys = ON');
    
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
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    
    `CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
      mac_address VARCHAR(17) NOT NULL,
      ip_address VARCHAR(45),
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
      coin_value DECIMAL(10,2) DEFAULT 0.00,
      coin_count INTEGER DEFAULT 1,
      total_value DECIMAL(10,2) DEFAULT 0.00,
      status VARCHAR(20) DEFAULT 'queued',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`
  ];

  for (const table of basicTables) {
    try {
      await runQuery(table);
    } catch (error) {
      console.warn(`Table creation warning: ${error.message}`);
    }
  }

  // Insert default data
  try {
    await runQuery(`
      INSERT OR IGNORE INTO rates (name, price, duration, coins_required, is_active) 
      VALUES ('15 Minutes', 5.00, 900, 1, 1)
    `);
    
    await runQuery(`
      INSERT OR IGNORE INTO portal_settings (id, coin_timeout, portal_title, portal_subtitle) 
      VALUES (1, 300, 'PISOWifi Portal', 'Insert coins for internet access')
    `);
    
    await runQuery(`
      INSERT OR IGNORE INTO coin_slots (slot_number, status) 
      VALUES (1, 'available')
    `);
    
    console.log('✅ Default data ensured');
  } catch (error) {
    console.warn('Default data warning:', error.message);
  }
}

function runQuery(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) {
        reject(err);
      } else {
        resolve({ lastID: this.lastID, changes: this.changes });
      }
    });
  });
}

async function query(text, params = []) {
  if (!isInitialized) {
    await initializeDatabase();
  }
  
  try {
    // Handle SELECT queries
    if (text.trim().toUpperCase().startsWith('SELECT')) {
      return new Promise((resolve, reject) => {
        db.all(text, params, (err, rows) => {
          if (err) {
            console.error('Query error:', err.message);
            console.error('Query:', text);
            console.error('Params:', params);
            reject(err);
          } else {
            resolve({ rows: rows || [], rowCount: rows ? rows.length : 0 });
          }
        });
      });
    } else {
      // Handle INSERT, UPDATE, DELETE queries
      const result = await runQuery(text, params);
      return { rows: [], rowCount: result.changes };
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
    return new Promise((resolve) => {
      db.close((err) => {
        if (err) {
          console.error('Error closing database:', err.message);
        }
        isInitialized = false;
        resolve();
      });
    });
  }
}

module.exports = {
  query,
  close,
  initializeDatabase
};