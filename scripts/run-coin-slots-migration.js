#!/usr/bin/env node

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// SECURITY: Require DATABASE_URL environment variable - no fallback credentials
if (!process.env.DATABASE_URL) {
  console.error('ERROR: DATABASE_URL environment variable is required but not set.');
  console.error('Please set DATABASE_URL before running this script:');
  console.error('  export DATABASE_URL="postgresql://user:password@host:port/dbname"');
  process.exit(1);
}

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function runMigration() {
  console.log('🚀 Starting Coin Slots & Queues Migration...\n');
  
  try {
    // Read the SQL file
    const sqlPath = path.join(__dirname, 'coin-slots-migration.sql');
    const sqlContent = fs.readFileSync(sqlPath, 'utf8');
    
    console.log('📝 Running complete migration as a single transaction...\n');
    
    // Begin transaction
    await pool.query('BEGIN');
    
    try {
      // Execute the entire SQL file as one query
      // PostgreSQL can handle multiple statements in one query
      await pool.query(sqlContent);
      
      // Commit transaction
      await pool.query('COMMIT');
      console.log('✅ Migration executed successfully!\n');
      
    } catch (error) {
      // Rollback on error
      await pool.query('ROLLBACK');
      
      // If the full migration failed, try individual CREATE TABLE statements
      console.log('⚠️  Full migration failed, trying individual table creation...\n');
      
      // Create tables individually
      const createTables = [
        {
          name: 'coin_slots',
          sql: `CREATE TABLE IF NOT EXISTS coin_slots (
            id SERIAL PRIMARY KEY,
            slot_number INTEGER UNIQUE NOT NULL,
            status VARCHAR(20) DEFAULT 'available' CHECK (status IN ('available', 'claimed', 'active')),
            claimed_by_client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
            claimed_by_ip VARCHAR(45),
            claimed_by_mac VARCHAR(17),
            claimed_at TIMESTAMP,
            expires_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )`
        },
        {
          name: 'coin_queues',
          sql: `CREATE TABLE IF NOT EXISTS coin_queues (
            id SERIAL PRIMARY KEY,
            slot_id INTEGER REFERENCES coin_slots(id) ON DELETE CASCADE,
            client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
            client_ip VARCHAR(45),
            client_mac VARCHAR(17),
            coin_value DECIMAL(10,2) NOT NULL,
            coin_count INTEGER DEFAULT 1,
            total_value DECIMAL(10,2) NOT NULL,
            status VARCHAR(20) DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'redeemed', 'expired')),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )`
        }
      ];
      
      for (const table of createTables) {
        try {
          console.log(`Creating table: ${table.name}...`);
          await pool.query(table.sql);
          console.log(`  ✅ Table ${table.name} created\n`);
        } catch (err) {
          if (err.message.includes('already exists')) {
            console.log(`  ⚠️  Table ${table.name} already exists\n`);
          } else {
            console.log(`  ❌ Error creating ${table.name}: ${err.message}\n`);
          }
        }
      }
      
      // Insert default coin slot for Orange Pi standalone
      console.log('Inserting default coin slot...');
      try {
        await pool.query(`
          INSERT INTO coin_slots (slot_number, status) VALUES 
          (1, 'available')
          ON CONFLICT (slot_number) DO NOTHING
        `);
        console.log('  ✅ Default slot inserted (Orange Pi standalone)\n');
      } catch (err) {
        console.log(`  ⚠️  Default slot may already exist: ${err.message}\n`);
      }
      
      // Create indexes
      const indexes = [
        'CREATE INDEX IF NOT EXISTS idx_coin_slots_status ON coin_slots(status)',
        'CREATE INDEX IF NOT EXISTS idx_coin_slots_claimed_by ON coin_slots(claimed_by_client_id, claimed_by_ip)',
        'CREATE INDEX IF NOT EXISTS idx_coin_queues_client ON coin_queues(client_id, client_ip, client_mac)',
        'CREATE INDEX IF NOT EXISTS idx_coin_queues_slot_status ON coin_queues(slot_id, status)'
      ];
      
      console.log('Creating indexes...');
      for (const index of indexes) {
        try {
          await pool.query(index);
          console.log('  ✅ Index created');
        } catch (err) {
          console.log(`  ⚠️  Index error: ${err.message}`);
        }
      }
      console.log('');
      
      // Create update trigger function
      console.log('Creating trigger function...');
      try {
        await pool.query(`
          CREATE OR REPLACE FUNCTION update_updated_at_column()
          RETURNS TRIGGER AS $$
          BEGIN
              NEW.updated_at = CURRENT_TIMESTAMP;
              RETURN NEW;
          END;
          $$ language 'plpgsql'
        `);
        console.log('  ✅ Trigger function created\n');
      } catch (err) {
        console.log(`  ⚠️  Trigger function error: ${err.message}\n`);
      }
      
      // Create triggers
      console.log('Creating triggers...');
      const triggers = [
        `CREATE TRIGGER update_coin_slots_updated_at 
         BEFORE UPDATE ON coin_slots 
         FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()`,
        `CREATE TRIGGER update_coin_queues_updated_at 
         BEFORE UPDATE ON coin_queues 
         FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()`
      ];
      
      for (const trigger of triggers) {
        try {
          await pool.query(trigger);
          console.log('  ✅ Trigger created');
        } catch (err) {
          if (err.message.includes('already exists')) {
            console.log('  ⚠️  Trigger already exists');
          } else {
            console.log(`  ⚠️  Trigger error: ${err.message}`);
          }
        }
      }
      console.log('');
      
      // Create helper functions
      console.log('Creating helper functions...');
      
      // Release expired slots function
      try {
        await pool.query(`
          CREATE OR REPLACE FUNCTION release_expired_coin_slots()
          RETURNS INTEGER AS $$
          DECLARE
              released_count INTEGER;
          BEGIN
              UPDATE coin_slots 
              SET status = 'available',
                  claimed_by_client_id = NULL,
                  claimed_by_ip = NULL,
                  claimed_by_mac = NULL,
                  claimed_at = NULL,
                  expires_at = NULL
              WHERE status = 'claimed' 
              AND expires_at < CURRENT_TIMESTAMP;
              
              GET DIAGNOSTICS released_count = ROW_COUNT;
              RETURN released_count;
          END;
          $$ LANGUAGE plpgsql
        `);
        console.log('  ✅ release_expired_coin_slots() function created');
      } catch (err) {
        console.log(`  ⚠️  Function error: ${err.message}`);
      }
      
      // Get client queued total function
      try {
        await pool.query(`
          CREATE OR REPLACE FUNCTION get_client_queued_total(client_ip_param VARCHAR(45), client_mac_param VARCHAR(17))
          RETURNS TABLE(
              total_coins INTEGER,
              total_value DECIMAL(10,2),
              queue_count INTEGER
          ) AS $$
          BEGIN
              RETURN QUERY
              SELECT 
                  COALESCE(SUM(cq.coin_count), 0)::INTEGER as total_coins,
                  COALESCE(SUM(cq.total_value), 0.00)::DECIMAL(10,2) as total_value,
                  COUNT(cq.id)::INTEGER as queue_count
              FROM coin_queues cq
              WHERE cq.status = 'queued'
              AND (cq.client_ip = client_ip_param OR cq.client_mac = client_mac_param);
          END;
          $$ LANGUAGE plpgsql
        `);
        console.log('  ✅ get_client_queued_total() function created\n');
      } catch (err) {
        console.log(`  ⚠️  Function error: ${err.message}\n`);
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
    console.error('  - Check if clients table exists (required for foreign keys)');
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run the migration
runMigration().catch(console.error);