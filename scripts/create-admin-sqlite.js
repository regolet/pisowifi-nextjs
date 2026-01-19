const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');

const DB_PATH = path.join(__dirname, '../pisowifi.db');

async function createAdmin() {
  try {
    const db = new Database(DB_PATH);
    
    console.log('📁 Connected to SQLite database...');

    // Check if admin user already exists
    const existingAdmin = db.prepare('SELECT * FROM users WHERE role = ?').get('ADMIN');

    if (existingAdmin) {
      console.log('ℹ️  Admin user already exists:', existingAdmin.username);
      db.close();
      return;
    }

    // Default admin credentials
    const adminData = {
      username: 'admin',
      email: 'admin@pisowifi.local',
      password: 'admin123',
      role: 'ADMIN'
    };

    // Hash the password
    const hashedPassword = bcrypt.hashSync(adminData.password, 10);

    // Create admin user
    const result = db.prepare(`
      INSERT INTO users (username, email, password, role)
      VALUES (?, ?, ?, ?)
    `).run(adminData.username, adminData.email, hashedPassword, adminData.role);

    console.log('✅ Admin user created successfully!');
    console.log('Username:', adminData.username);
    console.log('Password:', adminData.password);
    console.log('Email:', adminData.email);
    console.log('\n🚨 IMPORTANT: Change the default password after first login!');

    db.close();
  } catch (error) {
    console.error('❌ Error creating admin user:', error.message);
    process.exit(1);
  }
}

createAdmin();
