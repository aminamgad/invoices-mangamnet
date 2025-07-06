import express from 'express';
import User from '../models/User.js';
import Role from '../models/Role.js';
import Permission from '../models/Permission.js';
import { requireAdmin } from '../middleware/auth.js';

const router = express.Router();

// List distributors
router.get('/', requireAdmin, async (req, res) => {
  try {
    const distributors = await User.find({ role: 'distributor' })
      .populate({
        path: 'roles',
        populate: {
          path: 'permissions'
        }
      })
      .sort({ createdAt: -1 });
    res.render('distributors/index', { distributors });
  } catch (error) {
    req.flash('error', 'حدث خطأ أثناء تحميل الموزعين');
    res.render('distributors/index', { distributors: [] });
  }
});

// New distributor form
router.get('/new', requireAdmin, async (req, res) => {
  try {
    // Get all permissions grouped by module
    const permissions = await Permission.find().sort({ module: 1, action: 1 });
    const groupedPermissions = {};
    
    permissions.forEach(permission => {
      if (!groupedPermissions[permission.module]) {
        groupedPermissions[permission.module] = [];
      }
      groupedPermissions[permission.module].push(permission);
    });

    // Get default permissions for basic distributor role
    const basicRole = await Role.findOne({ name: 'basic_distributor' }).populate('permissions');
    const defaultPermissions = basicRole ? basicRole.permissions.map(p => p._id.toString()) : [];

    res.render('distributors/new', { 
      groupedPermissions,
      defaultPermissions
    });
  } catch (error) {
    console.error('Error loading distributor form:', error);
    req.flash('error', 'حدث خطأ أثناء تحميل النموذج');
    res.redirect('/distributors');
  }
});

// Create distributor
router.post('/', requireAdmin, async (req, res) => {
  try {
    const { username, password, commissionRate, permissions } = req.body;
    
    // Validate required fields
    if (!username || !password) {
      req.flash('error', 'اسم المستخدم وكلمة المرور مطلوبان');
      return res.redirect('/distributors/new');
    }

    // Check if username already exists
    const existingUser = await User.findOne({ username });
    if (existingUser) {
      req.flash('error', 'اسم المستخدم موجود بالفعل');
      return res.redirect('/distributors/new');
    }

    // Create custom role for this distributor
    const roleName = `distributor_${username}_${Date.now()}`;
    const role = new Role({
      name: roleName,
      displayName: `دور ${username}`,
      description: `دور مخصص للموزع ${username}`,
      permissions: Array.isArray(permissions) ? permissions : (permissions ? [permissions] : []),
      createdBy: req.session.user.id
    });

    await role.save();

    // Create distributor with legacy permissions for backward compatibility
    const selectedPermissions = await Permission.find({
      _id: { $in: role.permissions }
    });

    const legacyPermissions = {
      canCreateCompanies: selectedPermissions.some(p => p.module === 'companies' && p.action === 'create'),
      canCreateInvoices: selectedPermissions.some(p => p.module === 'invoices' && p.action === 'create'),
      canManageClients: selectedPermissions.some(p => p.module === 'clients' && ['create', 'update', 'delete'].includes(p.action)),
      canViewReports: selectedPermissions.some(p => p.module === 'reports' && ['view_own', 'view_all'].includes(p.action))
    };

    const distributor = new User({
      username,
      password,
      role: 'distributor',
      roles: [role._id],
      commissionRate: parseFloat(commissionRate) || 0,
      permissions: legacyPermissions
    });
    
    await distributor.save();
    req.flash('success', 'تم إضافة الموزع بنجاح');
    res.redirect('/distributors');
  } catch (error) {
    console.error('Error creating distributor:', error);
    req.flash('error', 'حدث خطأ أثناء إضافة الموزع');
    res.redirect('/distributors/new');
  }
});

// Edit distributor form
router.get('/:id/edit', requireAdmin, async (req, res) => {
  try {
    const distributor = await User.findById(req.params.id).populate({
      path: 'roles',
      populate: {
        path: 'permissions'
      }
    });
    
    if (!distributor) {
      req.flash('error', 'الموزع غير موجود');
      return res.redirect('/distributors');
    }

    // Get all permissions grouped by module
    const permissions = await Permission.find().sort({ module: 1, action: 1 });
    const groupedPermissions = {};
    
    permissions.forEach(permission => {
      if (!groupedPermissions[permission.module]) {
        groupedPermissions[permission.module] = [];
      }
      groupedPermissions[permission.module].push(permission);
    });

    // Get user's current permissions
    const userPermissions = [];
    distributor.roles.forEach(role => {
      role.permissions.forEach(permission => {
        userPermissions.push(permission._id.toString());
      });
    });

    res.render('distributors/edit', { 
      distributor, 
      groupedPermissions,
      userPermissions
    });
  } catch (error) {
    console.error('Error loading distributor edit form:', error);
    req.flash('error', 'حدث خطأ أثناء تحميل بيانات الموزع');
    res.redirect('/distributors');
  }
});

// Update distributor
router.put('/:id', requireAdmin, async (req, res) => {
  try {
    const { username, commissionRate, permissions, isActive } = req.body;
    
    const distributor = await User.findById(req.params.id).populate('roles');
    if (!distributor) {
      req.flash('error', 'الموزع غير موجود');
      return res.redirect('/distributors');
    }

    // Update distributor's custom role permissions
    if (distributor.roles.length > 0) {
      const customRole = distributor.roles.find(role => !role.isSystemRole);
      if (customRole) {
        customRole.permissions = Array.isArray(permissions) ? permissions : (permissions ? [permissions] : []);
        await customRole.save();

        // Update legacy permissions for backward compatibility
        const selectedPermissions = await Permission.find({
          _id: { $in: customRole.permissions }
        });

        const legacyPermissions = {
          canCreateCompanies: selectedPermissions.some(p => p.module === 'companies' && p.action === 'create'),
          canCreateInvoices: selectedPermissions.some(p => p.module === 'invoices' && p.action === 'create'),
          canManageClients: selectedPermissions.some(p => p.module === 'clients' && ['create', 'update', 'delete'].includes(p.action)),
          canViewReports: selectedPermissions.some(p => p.module === 'reports' && ['view_own', 'view_all'].includes(p.action))
        };

        distributor.permissions = legacyPermissions;
      }
    }

    // Update distributor basic info
    distributor.username = username;
    distributor.commissionRate = parseFloat(commissionRate) || 0;
    distributor.isActive = isActive === 'on';

    await distributor.save();
    
    req.flash('success', 'تم تحديث بيانات الموزع بنجاح');
    res.redirect('/distributors');
  } catch (error) {
    console.error('Error updating distributor:', error);
    req.flash('error', 'حدث خطأ أثناء تحديث بيانات الموزع');
    res.redirect('/distributors');
  }
});

export default router;