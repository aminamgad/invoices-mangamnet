import mongoose from 'mongoose';
import Permission from '../models/Permission.js';
import Role from '../models/Role.js';
import dotenv from 'dotenv';

dotenv.config();

const permissions = [
  // Companies
  { name: 'companies.view_own', displayName: 'عرض الشركات الخاصة', module: 'companies', action: 'view_own', description: 'عرض الشركات التي أنشأها المستخدم' },
  { name: 'companies.view_all', displayName: 'عرض جميع الشركات', module: 'companies', action: 'view_all', description: 'عرض جميع الشركات في النظام' },
  { name: 'companies.create', displayName: 'إنشاء شركة', module: 'companies', action: 'create', description: 'إضافة شركات جديدة' },
  { name: 'companies.update', displayName: 'تعديل شركة', module: 'companies', action: 'update', description: 'تحديث بيانات الشركات' },
  { name: 'companies.delete', displayName: 'حذف شركة', module: 'companies', action: 'delete', description: 'حذف الشركات' },

  // Clients
  { name: 'clients.view_own', displayName: 'عرض العملاء الخاصين', module: 'clients', action: 'view_own', description: 'عرض العملاء التي أنشأها المستخدم' },
  { name: 'clients.view_all', displayName: 'عرض جميع العملاء', module: 'clients', action: 'view_all', description: 'عرض جميع العملاء في النظام' },
  { name: 'clients.create', displayName: 'إنشاء عميل', module: 'clients', action: 'create', description: 'إضافة عملاء جدد' },
  { name: 'clients.update', displayName: 'تعديل عميل', module: 'clients', action: 'update', description: 'تحديث بيانات العملاء' },
  { name: 'clients.delete', displayName: 'حذف عميل', module: 'clients', action: 'delete', description: 'حذف العملاء' },

  // Files
  { name: 'files.view_own', displayName: 'عرض الملفات الخاصة', module: 'files', action: 'view_own', description: 'عرض الملفات التي أنشأها المستخدم' },
  { name: 'files.view_all', displayName: 'عرض جميع الملفات', module: 'files', action: 'view_all', description: 'عرض جميع الملفات في النظام' },
  { name: 'files.create', displayName: 'إنشاء ملف', module: 'files', action: 'create', description: 'إضافة ملفات جديدة' },
  { name: 'files.update', displayName: 'تعديل ملف', module: 'files', action: 'update', description: 'تحديث بيانات الملفات' },
  { name: 'files.delete', displayName: 'حذف ملف', module: 'files', action: 'delete', description: 'حذف الملفات' },

  // Invoices
  { name: 'invoices.view_own', displayName: 'عرض الفواتير الخاصة', module: 'invoices', action: 'view_own', description: 'عرض الفواتير المكلف بها المستخدم' },
  { name: 'invoices.view_all', displayName: 'عرض جميع الفواتير', module: 'invoices', action: 'view_all', description: 'عرض جميع الفواتير في النظام' },
  { name: 'invoices.create', displayName: 'إنشاء فاتورة', module: 'invoices', action: 'create', description: 'إضافة فواتير جديدة' },
  { name: 'invoices.update', displayName: 'تعديل فاتورة', module: 'invoices', action: 'update', description: 'تحديث بيانات الفواتير' },
  { name: 'invoices.delete', displayName: 'حذف فاتورة', module: 'invoices', action: 'delete', description: 'حذف الفواتير' },

  // Distributors
  { name: 'distributors.view_own', displayName: 'عرض الملف الشخصي', module: 'distributors', action: 'view_own', description: 'عرض الملف الشخصي للموزع' },
  { name: 'distributors.view_all', displayName: 'عرض جميع الموزعين', module: 'distributors', action: 'view_all', description: 'عرض جميع الموزعين في النظام' },
  { name: 'distributors.create', displayName: 'إنشاء موزع', module: 'distributors', action: 'create', description: 'إضافة موزعين جدد' },
  { name: 'distributors.update', displayName: 'تعديل موزع', module: 'distributors', action: 'update', description: 'تحديث بيانات الموزعين' },
  { name: 'distributors.delete', displayName: 'حذف موزع', module: 'distributors', action: 'delete', description: 'حذف الموزعين' },

  // Reports
  { name: 'reports.view_own', displayName: 'عرض التقارير الخاصة', module: 'reports', action: 'view_own', description: 'عرض تقارير المستخدم فقط' },
  { name: 'reports.view_all', displayName: 'عرض جميع التقارير', module: 'reports', action: 'view_all', description: 'عرض جميع التقارير في النظام' },

  // Commission Tiers
  { name: 'commission-tiers.view_own', displayName: 'عرض مستويات العمولة الخاصة', module: 'commission-tiers', action: 'view_own', description: 'عرض مستويات العمولة التي أنشأها المستخدم' },
  { name: 'commission-tiers.view_all', displayName: 'عرض جميع مستويات العمولة', module: 'commission-tiers', action: 'view_all', description: 'عرض جميع مستويات العمولة' },
  { name: 'commission-tiers.create', displayName: 'إنشاء مستوى عمولة', module: 'commission-tiers', action: 'create', description: 'إضافة مستويات عمولة جديدة' },
  { name: 'commission-tiers.update', displayName: 'تعديل مستوى عمولة', module: 'commission-tiers', action: 'update', description: 'تحديث مستويات العمولة' },
  { name: 'commission-tiers.delete', displayName: 'حذف مستوى عمولة', module: 'commission-tiers', action: 'delete', description: 'حذف مستويات العمولة' }
];

const systemRoles = [
  {
    name: 'admin',
    displayName: 'مدير النظام',
    description: 'صلاحيات كاملة على النظام',
    isSystemRole: true,
    permissions: [] // Will be populated with all permissions
  },
  {
    name: 'basic_distributor',
    displayName: 'موزع أساسي',
    description: 'صلاحيات أساسية للموزع',
    isSystemRole: true,
    permissions: [
      'companies.view_own', 'companies.view_all',
      'clients.view_own', 'clients.view_all', 'clients.create', 'clients.update', 'clients.delete',
      'files.view_own', 'files.view_all', 'files.create', 'files.update', 'files.delete',
      'invoices.view_own', 'invoices.view_all', 'invoices.create', 'invoices.update', 'invoices.delete',
      'distributors.view_own',
      'reports.view_own'
    ]
  }
];

async function seedPermissions() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/arabic-invoice-system');
    console.log('MongoDB connected');

    // Clear existing permissions and roles
    await Permission.deleteMany({});
    await Role.deleteMany({});
    console.log('Cleared existing permissions and roles');

    // Create permissions
    const createdPermissions = await Permission.insertMany(permissions);
    console.log(`Created ${createdPermissions.length} permissions`);

    // Create permission lookup map
    const permissionMap = {};
    createdPermissions.forEach(permission => {
      permissionMap[permission.name] = permission._id;
    });

    // Create system roles
    for (const roleData of systemRoles) {
      const role = new Role({
        name: roleData.name,
        displayName: roleData.displayName,
        description: roleData.description,
        isSystemRole: roleData.isSystemRole,
        permissions: roleData.name === 'admin' 
          ? createdPermissions.map(p => p._id) // Admin gets all permissions
          : roleData.permissions.map(permName => permissionMap[permName]).filter(Boolean)
      });

      await role.save();
      console.log(`Created role: ${role.displayName}`);
    }

    console.log('Permissions and roles seeded successfully');
    process.exit(0);
  } catch (error) {
    console.error('Error seeding permissions:', error);
    process.exit(1);
  }
}

seedPermissions();