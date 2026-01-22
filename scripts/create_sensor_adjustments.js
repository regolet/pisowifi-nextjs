
const db = require('../server/db/sqlite-adapter');

async function runMigration() {
  console.log('Running Coin Sensor Adjustments Migration...');
  
  try {
    // Create the adjustments table
    await db.query(`
      CREATE TABLE IF NOT EXISTS coin_sensor_adjustments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pulse_count INTEGER NOT NULL UNIQUE,
        actual_value DECIMAL(10,2) NOT NULL,
        note TEXT,
        is_active BOOLEAN DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Insert default "Smart Fixes" if table is empty
    const check = await db.query('SELECT COUNT(*) as count FROM coin_sensor_adjustments');
    if (check.rows[0].count === 0) {
      console.log('Inserting default calibration rules...');
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
        await db.query(`
          INSERT INTO coin_sensor_adjustments (pulse_count, actual_value, note)
          VALUES ($1, $2, $3)
        `, [pulse, value, note]);
      }
    }
    
    console.log('✅ Migration completed successfully');
  } catch (err) {
    console.error('❌ Migration failed:', err);
  }
}

runMigration();
