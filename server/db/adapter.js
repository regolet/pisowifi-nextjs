const fs = require('fs');
const path = require('path');

/**
 * Database adapter that switches between SQLite (development/testing) 
 * and PostgreSQL (production on OrangePi) based on environment
 */

let dbAdapter;

// Check if we should use PostgreSQL
async function shouldUsePostgreSQL() {
  const databaseUrl = process.env.DATABASE_URL;
  
  // If DATABASE_URL starts with postgresql://, try to use PostgreSQL
  if (databaseUrl && databaseUrl.startsWith('postgresql://')) {
    try {
      const { Pool } = require('pg');
      const testPool = new Pool({ connectionString: databaseUrl });
      await testPool.query('SELECT 1');
      await testPool.end();
      return true;
    } catch (error) {
      console.warn('PostgreSQL connection failed, falling back to SQLite:', error.message);
      return false;
    }
  }
  
  return false;
}

// Initialize the appropriate database adapter
async function initializeDatabase() {
  try {
    if (await shouldUsePostgreSQL()) {
      console.log('🐘 Initializing PostgreSQL adapter for production...');
      const { Pool } = require('pg');
      
      const pool = new Pool({
        connectionString: process.env.DATABASE_URL || 'postgresql://pisowifi_user:admin123@localhost:5432/pisowifi'
      });
      
      // Test connection and run migrations
      await pool.query('SELECT NOW()');
      console.log('✅ PostgreSQL connection successful');
      
      // Run the base tables migration
      console.log('📝 Running PostgreSQL migrations...');
      try {
        const fs = require('fs');
        const migrationPath = path.join(__dirname, '../../scripts/create-base-tables.sql');
        if (fs.existsSync(migrationPath)) {
          const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
          await pool.query(migrationSQL);
          console.log('✅ PostgreSQL migrations completed');
        }
      } catch (migrationError) {
        console.warn('⚠️  Migration warning (tables may already exist):', migrationError.message);
      }
      
      dbAdapter = {
        type: 'postgresql',
        query: async (text, params) => {
          try {
            const result = await pool.query(text, params);
            return result;
          } catch (error) {
            // Handle common PostgreSQL function errors gracefully
            if (error.message.includes('release_expired_coin_slots') || 
                error.message.includes('function') && error.message.includes('does not exist')) {
              console.warn('PostgreSQL function not available, skipping:', error.message);
              return { rows: [], rowCount: 0 };
            }
            throw error;
          }
        },
        close: () => pool.end()
      };
      
    } else {
      console.log('🗄️  Initializing SQLite adapter for development/testing...');
      const sqlite3 = require('sqlite3').verbose();
      const dbPath = path.join(__dirname, '../../data/pisowifi.db');
      
      // Ensure data directory exists
      const dataDir = path.dirname(dbPath);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
      
      const db = new sqlite3.Database(dbPath);
      
      // Initialize SQLite tables
      await initializeSQLiteTables(db);
      console.log('✅ SQLite database initialized');
      
      dbAdapter = {
        type: 'sqlite',
        query: async (text, params = []) => {
          return new Promise((resolve, reject) => {
            // Convert PostgreSQL-style queries to SQLite
            const sqliteQuery = convertToSQLite(text);
            
            if (sqliteQuery.includes('INSERT') && sqliteQuery.includes('RETURNING')) {
              // Handle INSERT ... RETURNING
              const insertQuery = sqliteQuery.replace(/RETURNING.*$/, '');
              
              db.run(insertQuery, params, function(err) {
                if (err) return reject(err);
                
                // Return the inserted ID
                resolve({
                  rows: [{ id: this.lastID }],
                  rowCount: this.changes
                });
              });
            } else if (sqliteQuery.includes('SELECT')) {
              db.all(sqliteQuery, params, (err, rows) => {
                if (err) return reject(err);
                resolve({ rows, rowCount: rows.length });
              });
            } else {
              db.run(sqliteQuery, params, function(err) {
                if (err) return reject(err);
                resolve({ rows: [], rowCount: this.changes });
              });
            }
          });
        },
        close: () => {
          return new Promise((resolve) => {
            db.close(resolve);
          });
        }
      };
    }
    
    return dbAdapter;
  } catch (error) {
    console.error('❌ Database initialization failed:', error.message);
    throw error;
  }
}

// Convert PostgreSQL queries to SQLite compatible ones
function convertToSQLite(query) {
  return query
    // Convert CURRENT_TIMESTAMP to datetime('now')
    .replace(/CURRENT_TIMESTAMP/g, "datetime('now')")
    // Convert SERIAL to INTEGER PRIMARY KEY AUTOINCREMENT
    .replace(/SERIAL PRIMARY KEY/g, 'INTEGER PRIMARY KEY AUTOINCREMENT')
    // Convert ON CONFLICT to INSERT OR REPLACE (basic conversion)
    .replace(/ON CONFLICT \([^)]+\) DO UPDATE SET/g, 'INSERT OR REPLACE INTO')
    // Convert BIGINT to INTEGER
    .replace(/BIGINT/g, 'INTEGER')
    // Convert DECIMAL to REAL
    .replace(/DECIMAL\(\d+,\d+\)/g, 'REAL')
    // Convert BOOLEAN to INTEGER
    .replace(/BOOLEAN/g, 'INTEGER')
    // Convert VARCHAR to TEXT
    .replace(/VARCHAR\(\d+\)/g, 'TEXT')
    // Convert JSONB to TEXT
    .replace(/JSONB/g, 'TEXT');
}

// Initialize SQLite tables with the same structure as PostgreSQL
async function initializeSQLiteTables(db) {
  const tables = [
    `CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE,
      password TEXT NOT NULL,
      role TEXT DEFAULT 'admin',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )`,
    
    `CREATE TABLE IF NOT EXISTS clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mac_address TEXT UNIQUE NOT NULL,
      ip_address TEXT,
      device_name TEXT,
      device_type TEXT,
      os TEXT,
      browser TEXT,
      user_agent TEXT,
      platform TEXT,
      language TEXT,
      screen_resolution TEXT,
      timezone TEXT,
      status TEXT DEFAULT 'DISCONNECTED',
      time_remaining INTEGER DEFAULT 0,
      total_amount_paid REAL DEFAULT 0.00,
      session_start TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      last_seen TEXT DEFAULT (datetime('now')),
      upload_limit INTEGER DEFAULT 0,
      download_limit INTEGER DEFAULT 0
    )`,
    
    `CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
      mac_address TEXT NOT NULL,
      ip_address TEXT,
      duration INTEGER DEFAULT 0,
      status TEXT DEFAULT 'ACTIVE',
      started_at TEXT DEFAULT (datetime('now')),
      ended_at TEXT
    )`,
    
    `CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
      session_id INTEGER REFERENCES sessions(id) ON DELETE SET NULL,
      amount REAL NOT NULL DEFAULT 0.00,
      coins_used INTEGER DEFAULT 0,
      payment_method TEXT DEFAULT 'COIN',
      status TEXT DEFAULT 'COMPLETED',
      created_at TEXT DEFAULT (datetime('now'))
    )`,
    
    `CREATE TABLE IF NOT EXISTS rates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      price REAL NOT NULL,
      duration INTEGER NOT NULL,
      coins_required INTEGER DEFAULT 1,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )`,
    
    `CREATE TABLE IF NOT EXISTS portal_settings (
      id INTEGER PRIMARY KEY DEFAULT 1,
      coin_timeout INTEGER DEFAULT 60,
      portal_title TEXT DEFAULT 'PISOWifi Portal',
      portal_subtitle TEXT DEFAULT 'Insert coins for internet access',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )`,
    
    `CREATE TABLE IF NOT EXISTS system_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      level TEXT NOT NULL,
      message TEXT NOT NULL,
      category TEXT,
      metadata TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )`,

    // Coin slots table
    `CREATE TABLE IF NOT EXISTS coin_slots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slot_number INTEGER UNIQUE NOT NULL,
      status TEXT DEFAULT 'AVAILABLE',
      client_mac TEXT,
      client_ip TEXT,
      expires_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )`,

    `CREATE TABLE IF NOT EXISTS coin_queues (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slot_number INTEGER,
      client_mac TEXT,
      client_ip TEXT,
      coins INTEGER DEFAULT 0,
      total_value REAL DEFAULT 0.0,
      created_at TEXT DEFAULT (datetime('now'))
    )`
  ];

  for (const table of tables) {
    await new Promise((resolve, reject) => {
      db.run(table, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  // Insert default data
  const defaults = [
    `INSERT OR IGNORE INTO rates (name, price, duration, coins_required, is_active) VALUES
     ('15 Minutes', 5.00, 900, 1, 1)`,
    `INSERT OR IGNORE INTO rates (name, price, duration, coins_required, is_active) VALUES
     ('30 Minutes', 10.00, 1800, 2, 1)`,
    `INSERT OR IGNORE INTO rates (name, price, duration, coins_required, is_active) VALUES
     ('1 Hour', 20.00, 3600, 4, 1)`,
    `INSERT OR IGNORE INTO portal_settings (id, coin_timeout, portal_title, portal_subtitle) VALUES
     (1, 300, 'PISOWifi Portal', 'Insert coins for internet access')`,
    `INSERT OR IGNORE INTO coin_slots (slot_number, status) VALUES (1, 'AVAILABLE')`
  ];

  for (const defaultData of defaults) {
    await new Promise((resolve, reject) => {
      db.run(defaultData, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }
}

// Export the query function and adapter info
module.exports = {
  initializeDatabase,
  query: async (text, params) => {
    if (!dbAdapter) {
      await initializeDatabase();
    }
    return dbAdapter.query(text, params);
  },
  getAdapter: () => dbAdapter,
  close: async () => {
    if (dbAdapter) {
      await dbAdapter.close();
    }
  }
};