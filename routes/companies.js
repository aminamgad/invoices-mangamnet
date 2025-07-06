import express from 'express';
import Company from '../models/Company.js';
import { requireModuleAccess, requirePermission } from '../middleware/auth.js';

const router = express.Router();

// List companies
router.get('/', requireModuleAccess('companies'), async (req, res) => {
  try {
    let query = {};
    
    // If user can only view own, filter by creator
    if (!req.userPermissionLevel.canViewAll && req.userPermissionLevel.canViewOwn) {
      query.createdBy = req.session.user.id;
    }
    
    const companies = await Company.find(query).populate('createdBy', 'username').sort({ createdAt: -1 });
    res.render('companies/index', { 
      companies,
      userPermissions: req.userPermissionLevel
    });
  } catch (error) {
    req.flash('error', 'حدث خطأ أثناء تحميل الشركات');
    res.render('companies/index', { 
      companies: [],
      userPermissions: req.userPermissionLevel || {}
    });
  }
});

// New company form
router.get('/new', requirePermission('companies', 'create'), (req, res) => {
  res.render('companies/new');
});

// Create company
router.post('/', requirePermission('companies', 'create'), async (req, res) => {
  try {
    const { name, commissionRate } = req.body;
    
    const company = new Company({
      name,
      commissionRate: parseFloat(commissionRate) || 0,
      createdBy: req.session.user.id
    });
    
    await company.save();
    req.flash('success', 'تم إضافة الشركة بنجاح');
    res.redirect('/companies');
  } catch (error) {
    req.flash('error', 'حدث خطأ أثناء إضافة الشركة');
    res.redirect('/companies/new');
  }
});

// Edit company form
router.get('/:id/edit', requirePermission('companies', 'update'), async (req, res) => {
  try {
    let query = { _id: req.params.id };
    
    // If user can only view own, ensure they own this company
    if (!req.userPermissionLevel?.canViewAll && req.userPermissionLevel?.canViewOwn) {
      query.createdBy = req.session.user.id;
    }
    
    const company = await Company.findOne(query);
    if (!company) {
      req.flash('error', 'الشركة غير موجودة أو ليس لديك صلاحية للوصول إليها');
      return res.redirect('/companies');
    }
    res.render('companies/edit', { company });
  } catch (error) {
    req.flash('error', 'حدث خطأ أثناء تحميل بيانات الشركة');
    res.redirect('/companies');
  }
});

// Update company
router.put('/:id', requirePermission('companies', 'update'), async (req, res) => {
  try {
    const { name, commissionRate } = req.body;
    
    let query = { _id: req.params.id };
    
    // If user can only view own, ensure they own this company
    if (!req.userPermissionLevel?.canViewAll && req.userPermissionLevel?.canViewOwn) {
      query.createdBy = req.session.user.id;
    }
    
    const result = await Company.updateOne(query, {
      name,
      commissionRate: parseFloat(commissionRate) || 0
    });
    
    if (result.matchedCount === 0) {
      req.flash('error', 'الشركة غير موجودة أو ليس لديك صلاحية لتعديلها');
      return res.redirect('/companies');
    }
    
    req.flash('success', 'تم تحديث بيانات الشركة بنجاح');
    res.redirect('/companies');
  } catch (error) {
    req.flash('error', 'حدث خطأ أثناء تحديث بيانات الشركة');
    res.redirect('/companies');
  }
});

// Delete company
router.delete('/:id', requirePermission('companies', 'delete'), async (req, res) => {
  try {
    let query = { _id: req.params.id };
    
    // If user can only view own, ensure they own this company
    if (!req.userPermissionLevel?.canViewAll && req.userPermissionLevel?.canViewOwn) {
      query.createdBy = req.session.user.id;
    }
    
    const result = await Company.deleteOne(query);
    
    if (result.deletedCount === 0) {
      req.flash('error', 'الشركة غير موجودة أو ليس لديك صلاحية لحذفها');
      return res.redirect('/companies');
    }
    
    req.flash('success', 'تم حذف الشركة بنجاح');
    res.redirect('/companies');
  } catch (error) {
    req.flash('error', 'حدث خطأ أثناء حذف الشركة');
    res.redirect('/companies');
  }
});

export default router;