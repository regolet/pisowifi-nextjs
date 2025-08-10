#!/usr/bin/env node

// PISOWifi Database Setup Script
// Creates all necessary tables and initial data

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://pisowifi_user:admin123@localhost:5432/pisowifi'
});

async function setupDatabase() {
  console.log('=== PISOWifi Database Setup ===');
  console.log('');

  try {
    // Test connection
    console.log('Testing database connection...');
    await pool.query('SELECT NOW()');
    console.log('✓ Database connected successfully');
    console.log('');

    // Create network_config table
    console.log('Creating network_config table...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS network_config (
        id INTEGER PRIMARY KEY DEFAULT 1,
        dhcp_enabled BOOLEAN DEFAULT true,
        dhcp_range_start VARCHAR(15) DEFAULT '192.168.100.10',
        dhcp_range_end VARCHAR(15) DEFAULT '192.168.100.200',
        subnet_mask VARCHAR(15) DEFAULT '255.255.255.0',
        gateway VARCHAR(15) DEFAULT '192.168.100.1',
        dns_primary VARCHAR(15) DEFAULT '8.8.8.8',
        dns_secondary VARCHAR(15) DEFAULT '8.8.4.4',
        lease_time INTEGER DEFAULT 3600,
        wifi_interface VARCHAR(20) DEFAULT 'wlan0',
        ethernet_interface VARCHAR(20) DEFAULT 'eth0',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✓ network_config table created');

    // Insert default configuration
    const result = await pool.query('SELECT COUNT(*) FROM network_config');
    if (parseInt(result.rows[0].count) === 0) {
      await pool.query(`
        INSERT INTO network_config (id) VALUES (1)
      `);
      console.log('✓ Default network configuration inserted');
    } else {
      console.log('✓ Network configuration already exists');
    }

    // Create rates table
    console.log('Creating rates table...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS rates (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        duration INTEGER NOT NULL,
        coins_required INTEGER NOT NULL,
        price DECIMAL(10,2) NOT NULL,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✓ rates table created');

    // Insert default rates if none exist
    const ratesResult = await pool.query('SELECT COUNT(*) FROM rates');
    if (parseInt(ratesResult.rows[0].count) === 0) {
      await pool.query(`
        INSERT INTO rates (name, duration, coins_required, price, is_active) VALUES
        ('15 Minutes', 900, 1, 5.00, true),
        ('30 Minutes', 1800, 2, 10.00, true),
        ('1 Hour', 3600, 4, 20.00, true),
        ('2 Hours', 7200, 8, 40.00, false)
      `);
      console.log('✓ Default rates inserted');
    } else {
      console.log('✓ Rates already exist');
    }

    // Create clients table
    console.log('Creating clients table...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS clients (
        id SERIAL PRIMARY KEY,
        mac_address VARCHAR(17) UNIQUE NOT NULL,
        ip_address VARCHAR(15),
        hostname VARCHAR(255),
        status VARCHAR(20) DEFAULT 'DISCONNECTED',
        time_remaining INTEGER DEFAULT 0,
        total_time_purchased INTEGER DEFAULT 0,
        total_amount_paid DECIMAL(10,2) DEFAULT 0,
        session_start TIMESTAMP,
        last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        upload_limit INTEGER,
        download_limit INTEGER
      )
    `);
    console.log('✓ clients table created');

    // Create sessions table
    console.log('Creating sessions table...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        id SERIAL PRIMARY KEY,
        client_id INTEGER REFERENCES clients(id),
        mac_address VARCHAR(17) NOT NULL,
        ip_address VARCHAR(15),
        duration INTEGER NOT NULL,
        amount_paid DECIMAL(10,2) NOT NULL,
        coins_used INTEGER NOT NULL,
        status VARCHAR(20) DEFAULT 'ACTIVE',
        started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        ended_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✓ sessions table created');

    // Create transactions table
    console.log('Creating transactions table...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS transactions (
        id SERIAL PRIMARY KEY,
        session_id INTEGER REFERENCES sessions(id),
        mac_address VARCHAR(17) NOT NULL,
        amount DECIMAL(10,2) NOT NULL,
        coins_inserted INTEGER NOT NULL,
        rate_id INTEGER REFERENCES rates(id),
        transaction_type VARCHAR(20) DEFAULT 'PURCHASE',
        status VARCHAR(20) DEFAULT 'COMPLETED',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✓ transactions table created');

    // Create system_logs table
    console.log('Creating system_logs table...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS system_logs (
        id SERIAL PRIMARY KEY,
        level VARCHAR(10) NOT NULL,
        message TEXT NOT NULL,
        category VARCHAR(50),
        metadata JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✓ system_logs table created');

    // Create admin_users table
    console.log('Creating admin_users table...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS admin_users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        email VARCHAR(100) UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        role VARCHAR(20) DEFAULT 'admin',
        is_active BOOLEAN DEFAULT true,
        last_login TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✓ admin_users table created');

    // Create default admin user if none exists
    const adminResult = await pool.query('SELECT COUNT(*) FROM admin_users');
    if (parseInt(adminResult.rows[0].count) === 0) {
      const bcrypt = require('bcryptjs');
      const hashedPassword = await bcrypt.hash('admin123', 10);
      
      await pool.query(`
        INSERT INTO admin_users (username, email, password_hash, role) 
        VALUES ('admin', 'admin@pisowifi.local', $1, 'admin')
      `, [hashedPassword]);
      console.log('✓ Default admin user created (username: admin, password: admin123)');
    } else {
      console.log('✓ Admin users already exist');
    }

    // Create portal_settings table
    console.log('Creating portal_settings table...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS portal_settings (
        id INTEGER PRIMARY KEY DEFAULT 1,
        coin_timeout INTEGER DEFAULT 60,
        coin_value DECIMAL(10,2) DEFAULT 5.00,
        time_per_peso INTEGER DEFAULT 6,
        portal_title VARCHAR(100) DEFAULT 'PISOWifi Portal',
        portal_subtitle VARCHAR(200) DEFAULT 'Insert coins for internet access',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✓ portal_settings table created');

    // Insert default portal settings if none exist
    const portalResult = await pool.query('SELECT COUNT(*) FROM portal_settings');
    if (parseInt(portalResult.rows[0].count) === 0) {
      await pool.query(`
        INSERT INTO portal_settings (id) VALUES (1)
      `);
      console.log('✓ Default portal settings inserted');
    } else {
      console.log('✓ Portal settings already exist');
    }

    console.log('');
    console.log('=== Database Setup Complete ===');
    console.log('');
    console.log('Tables created:');
    console.log('  - network_config (DHCP/DNS settings)');
    console.log('  - rates (coin rate packages)');
    console.log('  - clients (connected devices)');
    console.log('  - sessions (user sessions)');
    console.log('  - transactions (payment records)');
    console.log('  - system_logs (system events)');
    console.log('  - admin_users (admin accounts)');
    console.log('  - portal_settings (portal configuration)');
    console.log('');
    console.log('Default data inserted:');
    console.log('  - Network config: 192.168.100.1 gateway');
    console.log('  - Sample coin rates');
    console.log('  - Admin user: admin / admin123');
    console.log('');
    console.log('You can now run: sudo node update-network-config.js');

  } catch (error) {
    console.error('Database setup failed:', error.message);
    
    if (error.message.includes('does not exist')) {
      console.log('');
      console.log('Database connection failed. Please ensure:');
      console.log('1. PostgreSQL is installed and running');
      console.log('2. Database "pisowifi" exists');
      console.log('3. User "pisowifi_user" exists with password "admin123"');
      console.log('');
      console.log('To create the database and user:');
      console.log('  sudo -u postgres psql');
      console.log('  CREATE DATABASE pisowifi;');
      console.log('  CREATE USER pisowifi_user WITH PASSWORD \'admin123\';');
      console.log('  GRANT ALL PRIVILEGES ON DATABASE pisowifi TO pisowifi_user;');
      console.log('  \\q');
    }
    
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run if called directly
if (require.main === module) {
  setupDatabase();
}

module.exports = { setupDatabase };