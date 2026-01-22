#!/usr/bin/env node

/**
 * TTL Detection Migration Runner
 * Executes database migrations to set up TTL anti-tethering detection schema
 */

const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

// Get database path from environment or use default
const dbPath = process.env.DATABASE_PATH || path.join(__dirname, '../pisowifi.db');

console.log('🔧 TTL Detection Migration Runner');
console.log(`📄 Database: ${dbPath}`);
console.log('');

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('❌ Failed to open database:', err.message);
    process.exit(1);
  }

  console.log('✅ Database connected');
  
  // Read migration SQL file
  const sqlFile = path.join(__dirname, 'ttl-detection-migration.sql');
  
  if (!fs.existsSync(sqlFile)) {
    console.error('❌ Migration file not found:', sqlFile);
    db.close();
    process.exit(1);
  }

  const migrationSQL = fs.readFileSync(sqlFile, 'utf8');

  // Execute migration
  console.log('\n📋 Executing migration...\n');
  
  db.exec(migrationSQL, (err) => {
    if (err) {
      console.error('❌ Migration failed:', err.message);
      db.close();
      process.exit(1);
    }

    console.log('✅ Migration completed successfully');
    console.log('');
    console.log('📊 Created/Updated tables:');
    console.log('   • ttl_settings');
    console.log('   • ttl_baselines');
    console.log('   • ttl_anomalies');
    console.log('   • ttl_violations');
    console.log('   • ttl_detection_logs');
    console.log('');
    console.log('🔍 Tables are now ready for TTL detection');
    
    db.close((err) => {
      if (err) {
        console.error('Error closing database:', err.message);
        process.exit(1);
      }
      process.exit(0);
    });
  });
});

db.on('error', (err) => {
  console.error('❌ Database error:', err.message);
  process.exit(1);
});
