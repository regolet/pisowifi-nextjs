#!/usr/bin/env node
/**
 * Migration script to add session_token support for random MAC address handling
 * Run with: node scripts/run-session-token-migration.js
 */

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '../pisowifi.db');

async function runMigration() {
  console.log('🔄 Running session token migration...\n');

  try {
    const db = new Database(DB_PATH);
    
    // Check if session_token column already exists in clients
    const clientsColumns = db.prepare("PRAGMA table_info(clients)").all();
    const hasSessionToken = clientsColumns.some(col => col.name === 'session_token');
    
    if (!hasSessionToken) {
      console.log('📝 Adding session_token to clients table...');
      db.exec('ALTER TABLE clients ADD COLUMN session_token VARCHAR(64)');
      console.log('✅ Added session_token to clients');
    } else {
      console.log('ℹ️  clients.session_token already exists');
    }

    // Check if session_token column exists in coin_queues
    const queueColumns = db.prepare("PRAGMA table_info(coin_queues)").all();
    const queueHasToken = queueColumns.some(col => col.name === 'session_token');
    
    if (!queueHasToken) {
      console.log('📝 Adding session_token to coin_queues table...');
      db.exec('ALTER TABLE coin_queues ADD COLUMN session_token VARCHAR(64)');
      console.log('✅ Added session_token to coin_queues');
    } else {
      console.log('ℹ️  coin_queues.session_token already exists');
    }

    // Check if session_token column exists in sessions
    const sessionsColumns = db.prepare("PRAGMA table_info(sessions)").all();
    const sessionsHasToken = sessionsColumns.some(col => col.name === 'session_token');
    
    if (!sessionsHasToken) {
      console.log('📝 Adding session_token to sessions table...');
      db.exec('ALTER TABLE sessions ADD COLUMN session_token VARCHAR(64)');
      console.log('✅ Added session_token to sessions');
    } else {
      console.log('ℹ️  sessions.session_token already exists');
    }

    // Create indexes
    console.log('\n📝 Creating indexes...');
    
    try {
      db.exec('CREATE INDEX IF NOT EXISTS idx_clients_session_token ON clients(session_token)');
      console.log('✅ Created idx_clients_session_token');
    } catch (e) {
      console.log('ℹ️  idx_clients_session_token already exists');
    }

    try {
      db.exec('CREATE INDEX IF NOT EXISTS idx_clients_ip_address ON clients(ip_address)');
      console.log('✅ Created idx_clients_ip_address');
    } catch (e) {
      console.log('ℹ️  idx_clients_ip_address already exists');
    }

    try {
      db.exec('CREATE INDEX IF NOT EXISTS idx_coin_queues_session_token ON coin_queues(session_token)');
      console.log('✅ Created idx_coin_queues_session_token');
    } catch (e) {
      console.log('ℹ️  idx_coin_queues_session_token already exists');
    }

    try {
      db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_session_token ON sessions(session_token)');
      console.log('✅ Created idx_sessions_session_token');
    } catch (e) {
      console.log('ℹ️  idx_sessions_session_token already exists');
    }

    db.close();
    
    console.log('\n✅ Migration completed successfully!');
    console.log('Session token support is now enabled for random MAC address handling.');
    
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
  }
}

runMigration();
