const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function createAdmin() {
  try {
    // Check if admin user already exists
    const existingAdmin = await prisma.user.findFirst({
      where: {
        role: 'ADMIN'
      }
    });

    if (existingAdmin) {
      console.log('Admin user already exists:', existingAdmin.username);
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
    const admin = await prisma.user.create({
      data: {
        ...adminData,
        password: hashedPassword
      }
    });

    console.log('✅ Admin user created successfully!');
    console.log('Username:', adminData.username);
    console.log('Password:', adminData.password);
    console.log('Email:', adminData.email);
    console.log('\n🚨 IMPORTANT: Change the default password after first login!');

    // Log the creation
    await prisma.systemLog.create({
      data: {
        level: 'INFO',
        message: 'Initial admin user created',
        category: 'setup'
      }
    });

  } catch (error) {
    console.error('Error creating admin user:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the function
createAdmin();