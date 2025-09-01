import mongoose from 'mongoose';
import User from '../models/User.js';
import Role from '../models/Role.js';
import Permission from '../models/Permission.js';
import dotenv from 'dotenv';

dotenv.config();

mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/arabic-invoice-system')
  .then(async () => {
    console.log('MongoDB connected');

    // Check if admin already exists
    const existingAdmin = await User.findOne({ username: 'taxinvadmin' });
    if (existingAdmin) {
      console.log('Admin user already exists');

      // Update admin to have all permissions
      const allPermissions = await Permission.find();
      const adminRole = await Role.findOne({ name: 'admin' });

      if (adminRole) {
        adminRole.permissions = allPermissions.map(p => p._id);
        await adminRole.save();
        console.log('Admin role updated with all permissions');
      }

      // Update admin user permissions
      existingAdmin.permissions = {
        canCreateCompanies: true,
        canCreateInvoices: true,
        canManageClients: true,
        canViewReports: true,
        canCreateFiles: true
      };
      await existingAdmin.save();
      console.log('Admin user permissions updated');

      process.exit(0);
    }

    // Get all permissions
    const allPermissions = await Permission.find();
    console.log(`Found ${allPermissions.length} permissions`);

    // Create or update admin role with all permissions
    let adminRole = await Role.findOne({ name: 'admin' });
    if (!adminRole) {
      adminRole = new Role({
        name: 'admin',
        displayName: 'مدير النظام',
        description: 'صلاحيات كاملة على النظام',
        permissions: allPermissions.map(p => p._id),
        isSystemRole: true
      });
      await adminRole.save();
      console.log('Admin role created with all permissions');
    } else {
      adminRole.permissions = allPermissions.map(p => p._id);
      await adminRole.save();
      console.log('Admin role updated with all permissions');
    }

    // Create admin user
    const admin = new User({
      username: 'taxinvadmin',
      password: 'a@201313A@',
      role: 'admin',
      roles: [adminRole._id],
      permissions: {
        canCreateCompanies: true,
        canCreateInvoices: true,
        canManageClients: true,
        canViewReports: true,
        canCreateFiles: true
      }
    });

    await admin.save();
    console.log('Admin user created successfully');
    console.log('Username: taxinvadmin');
    console.log('Password: a@201313A@');
    console.log(`Admin has ${allPermissions.length} permissions`);

    process.exit(0);
  })
  .catch(err => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });
