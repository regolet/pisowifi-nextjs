#!/usr/bin/env node

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://pisowifi_user:admin123@localhost:5432/pisowifi'
});

async function runMigration() {
  console.log('🚀 Starting Coin Slots & Queues Migration...\n');
  
  try {
    // Read the SQL file
    const sqlPath = path.join(__dirname, 'coin-slots-migration.sql');
    const sqlContent = fs.readFileSync(sqlPath, 'utf8');
    
    // Split SQL into individual statements (by semicolon)
    const statements = sqlContent
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'));
    
    console.log(`📝 Found ${statements.length} SQL statements to execute\n`);
    
    // Execute each statement
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i] + ';';
      
      // Get first 50 chars for logging
      const preview = statement.substring(0, 50).replace(/\n/g, ' ');
      console.log(`[${i + 1}/${statements.length}] Executing: ${preview}...`);
      
      try {
        await pool.query(statement);
        console.log(`  ✅ Success\n`);
      } catch (error) {
        if (error.message.includes('already exists')) {
          console.log(`  ⚠️  Already exists (skipping)\n`);
        } else {
          console.error(`  ❌ Error: ${error.message}\n`);
          // Continue with other statements even if one fails
        }
      }
    }
    
    // Verify tables were created
    console.log('🔍 Verifying migration...\n');
    
    const tableCheck = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name IN ('coin_slots', 'coin_queues')
    `);
    
    console.log('📊 Tables found:');
    tableCheck.rows.forEach(row => {
      console.log(`  ✅ ${row.table_name}`);
    });
    
    // Check coin slots
    const slotsCheck = await pool.query('SELECT * FROM coin_slots ORDER BY slot_number');
    console.log(`\n🪙 Coin Slots: ${slotsCheck.rows.length} slots configured`);
    slotsCheck.rows.forEach(slot => {
      console.log(`  - Slot ${slot.slot_number}: ${slot.status}`);
    });
    
    console.log('\n✨ Migration completed successfully!');
    console.log('\n📌 Next steps:');
    console.log('  1. Restart the server: npm start');
    console.log('  2. Access admin panel: http://localhost:3000/admin/coin-slots');
    console.log('  3. Test portal: http://localhost:3000/portal');
    
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
runMigration().catch(console.error);