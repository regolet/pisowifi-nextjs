#!/usr/bin/env node

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://pisowifi_user:admin123@localhost:5432/pisowifi'
});

async function runBaseMigration() {
  console.log('🚀 Starting Base Tables Migration...\n');
  
  try {
    // Read the SQL file
    const sqlPath = path.join(__dirname, 'create-base-tables.sql');
    const sqlContent = fs.readFileSync(sqlPath, 'utf8');
    
    console.log('📝 Creating base database tables...\n');
    
    // Execute the SQL
    await pool.query(sqlContent);
    
    console.log('✅ Base tables migration completed successfully!\n');
    
    // Verify tables were created
    console.log('🔍 Verifying tables...\n');
    
    const tableCheck = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name IN (
        'users', 'clients', 'sessions', 'transactions', 
        'rates', 'portal_settings', 'system_logs'
      )
      ORDER BY table_name
    `);
    
    console.log('📊 Tables found:');
    tableCheck.rows.forEach(row => {
      console.log(`  ✅ ${row.table_name}`);
    });
    
    console.log('\n✨ Database is ready for PISOWifi operations!');
    console.log('\n📌 Next steps:');
    console.log('  1. Restart the server: npm start');
    console.log('  2. Run coin slots migration if needed: node scripts/run-coin-slots-migration.js');
    console.log('  3. Access admin panel: http://localhost:3000/admin/bypass');
    console.log('  4. Test portal: http://localhost:3000/portal');
    
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    console.error('\n💡 Troubleshooting:');
    console.error('  - Check database connection: postgresql://pisowifi_user:admin123@localhost:5432/pisowifi');
    console.error('  - Ensure PostgreSQL is running: sudo systemctl status postgresql');
    console.error('  - Verify database exists: psql -U pisowifi_user -d pisowifi -c "\\dt"');
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run the migration
runBaseMigration().catch(console.error);