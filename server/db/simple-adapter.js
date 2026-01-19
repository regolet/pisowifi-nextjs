const { Pool } = require('pg');

/**
 * Simplified database adapter that uses PostgreSQL directly
 * with better error handling for OrangePi
 */

let pool;
let isInitialized = false;

async function initializeDatabase() {
  if (isInitialized) return;
  
  // SECURITY: Require DATABASE_URL environment variable - no fallback credentials
  if (!process.env.DATABASE_URL) {
    console.error('❌ ERROR: DATABASE_URL environment variable is required but not set.');
    console.error('Please set DATABASE_URL before starting the server:');
    console.error('  export DATABASE_URL="postgresql://user:password@host:port/dbname"');
    throw new Error('DATABASE_URL is required in production');
  }
  
  console.log('🐘 Connecting to PostgreSQL database...');
  
  try {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL
    });
    
    // Test connection
    await pool.query('SELECT NOW()');
    console.log('✅ PostgreSQL connection successful');
    
    // Ensure basic tables exist
    await ensureBasicTables();
    
    isInitialized = true;
    console.log('✅ Database initialized successfully');
    
  } catch (error) {
    console.error('❌ Database initialization failed:', error.message);
    console.error('Full error:', error);
    throw error;
  }
}

async function ensureBasicTables() {
  console.log('📝 Ensuring basic tables exist...');
  
  const basicTables = [
    `CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username VARCHAR(50) UNIQUE NOT NULL,
      email VARCHAR(100) UNIQUE,
      password VARCHAR(255) NOT NULL,
      role VARCHAR(20) DEFAULT 'admin',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    
    `CREATE TABLE IF NOT EXISTS clients (
      id SERIAL PRIMARY KEY,
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
      session_start TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      upload_limit INTEGER DEFAULT 0,
      download_limit INTEGER DEFAULT 0
    )`,
    
    `CREATE TABLE IF NOT EXISTS rates (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      price DECIMAL(10,2) NOT NULL,
      duration INTEGER NOT NULL,
      coins_required INTEGER DEFAULT 1,
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    
    `CREATE TABLE IF NOT EXISTS portal_settings (
      id INTEGER PRIMARY KEY DEFAULT 1,
      coin_timeout INTEGER DEFAULT 60,
      portal_title VARCHAR(200) DEFAULT 'PISOWifi Portal',
      portal_subtitle VARCHAR(200) DEFAULT 'Insert coins for internet access',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    
    `CREATE TABLE IF NOT EXISTS sessions (
      id SERIAL PRIMARY KEY,
      client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
      mac_address VARCHAR(17) NOT NULL,
      ip_address VARCHAR(45),
      duration INTEGER DEFAULT 0,
      status VARCHAR(20) DEFAULT 'ACTIVE',
      started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      ended_at TIMESTAMP
    )`,
    
    `CREATE TABLE IF NOT EXISTS transactions (
      id SERIAL PRIMARY KEY,
      client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
      session_id INTEGER REFERENCES sessions(id) ON DELETE SET NULL,
      amount DECIMAL(10,2) NOT NULL DEFAULT 0.00,
      coins_used INTEGER DEFAULT 0,
      payment_method VARCHAR(20) DEFAULT 'COIN',
      status VARCHAR(20) DEFAULT 'COMPLETED',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    
    `CREATE TABLE IF NOT EXISTS system_logs (
      id SERIAL PRIMARY KEY,
      level VARCHAR(10) NOT NULL,
      message TEXT NOT NULL,
      category VARCHAR(50),
      metadata JSONB,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,

    `CREATE TABLE IF NOT EXISTS coin_slots (
      id SERIAL PRIMARY KEY,
      slot_number INTEGER UNIQUE NOT NULL,
      status VARCHAR(20) DEFAULT 'available',
      claimed_by_client_id INTEGER,
      claimed_by_ip VARCHAR(45),
      claimed_by_mac VARCHAR(17),
      claimed_at TIMESTAMP,
      expires_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,

    `CREATE TABLE IF NOT EXISTS coin_queues (
      id SERIAL PRIMARY KEY,
      slot_id INTEGER REFERENCES coin_slots(id) ON DELETE SET NULL,
      client_id INTEGER,
      client_ip VARCHAR(45),
      client_mac VARCHAR(17),
      coin_value DECIMAL(10,2) DEFAULT 0.00,
      coin_count INTEGER DEFAULT 1,
      total_value DECIMAL(10,2) DEFAULT 0.00,
      status VARCHAR(20) DEFAULT 'queued',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`
  ];

  for (const table of basicTables) {
    try {
      await pool.query(table);
    } catch (error) {
      console.warn(`Table creation warning: ${error.message}`);
    }
  }

  // Insert default data only if tables are empty
  try {
    // Only insert default rate if no rates exist
    const rateResult = await pool.query('SELECT COUNT(*) as count FROM rates');
    const rateCount = parseInt(rateResult.rows[0]?.count || 0);
    
    if (rateCount === 0) {
      await pool.query(`
        INSERT INTO rates (name, price, duration, coins_required, is_active) 
        VALUES ('15 Minutes', 5.00, 900, 1, true)
      `);
      console.log('✅ Default rate created');
    }
    
    await pool.query(`
      INSERT INTO portal_settings (id, coin_timeout, portal_title, portal_subtitle) 
      VALUES (1, 300, 'PISOWifi Portal', 'Insert coins for internet access')
      ON CONFLICT (id) DO NOTHING
    `);
    
    await pool.query(`
      INSERT INTO coin_slots (slot_number, status) 
      VALUES (1, 'available')
      ON CONFLICT (slot_number) DO NOTHING
    `);
    
    console.log('✅ Default data ensured');
  } catch (error) {
    console.warn('Default data warning:', error.message);
  }
}

async function query(text, params = []) {
  if (!isInitialized) {
    await initializeDatabase();
  }
  
  try {
    // Handle function calls that might not exist
    if (text.includes('release_expired_coin_slots')) {
      console.warn('Skipping PostgreSQL function call: release_expired_coin_slots');
      return { rows: [], rowCount: 0 };
    }
    
    const result = await pool.query(text, params);
    return result;
  } catch (error) {
    console.error('Query error:', error.message);
    console.error('Query:', text);
    console.error('Params:', params);
    throw error;
  }
}

async function close() {
  if (pool) {
    await pool.end();
    isInitialized = false;
  }
}

module.exports = {
  query,
  close,
  initializeDatabase
};