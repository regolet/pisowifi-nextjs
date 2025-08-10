const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://pisowifi_user:pisowifi123@localhost:5432/pisowifi'
});

async function createAdmin() {
  try {
    // Check if admin user already exists
    const existingAdmin = await pool.query('SELECT * FROM users WHERE role = $1', ['ADMIN']);

    if (existingAdmin.rows.length > 0) {
      console.log('Admin user already exists:', existingAdmin.rows[0].username);
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
    const hashedPassword = await bcrypt.hash(adminData.password, 10);

    // Create admin user
    const result = await pool.query(
      'INSERT INTO users (username, email, password, role) VALUES ($1, $2, $3, $4) RETURNING *',
      [adminData.username, adminData.email, hashedPassword, adminData.role]
    );

    console.log('✅ Admin user created successfully!');
    console.log('Username:', adminData.username);
    console.log('Password:', adminData.password);
    console.log('Email:', adminData.email);
    console.log('\n🚨 IMPORTANT: Change the default password after first login!');

    // Log the creation
    await pool.query(
      'INSERT INTO system_logs (level, message, category) VALUES ($1, $2, $3)',
      ['INFO', 'Initial admin user created', 'setup']
    );

  } catch (error) {
    console.error('Error creating admin user:', error);
  } finally {
    await pool.end();
  }
}

// Run the function
createAdmin();