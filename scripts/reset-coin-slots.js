#!/usr/bin/env node
const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '..', 'pisowifi.db');
console.log('Opening database:', dbPath);

const db = new Database(dbPath);

// Reset all coin slots to available
const result = db.prepare(`
  UPDATE coin_slots 
  SET status = 'available', 
      claimed_by_client_id = NULL, 
      claimed_by_ip = NULL, 
      claimed_by_mac = NULL, 
      claimed_at = NULL, 
      expires_at = NULL
`).run();

console.log(`Reset ${result.changes} coin slots to available`);

// Show current state
const slots = db.prepare('SELECT * FROM coin_slots').all();
console.log('\nCurrent coin slots:');
slots.forEach(slot => {
  console.log(`  Slot ${slot.slot_number}: ${slot.status} (ID: ${slot.id})`);
});

db.close();
console.log('\nDone!');
