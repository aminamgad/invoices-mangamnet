import express from 'express';
import Client from '../models/Client.js';
import { requireModuleAccess, requirePermission } from '../middleware/auth.js';

const router = express.Router();

// List clients
router.get('/', requireModuleAccess('clients'), async (req, res) => {
  try {
    let query = {};
    
    // If user can only view own, filter by creator
    if (!req.userPermissionLevel.canViewAll && req.userPermissionLevel.canViewOwn) {
      query.createdBy = req.session.user.id;
    }
    
    const clients = await Client.find(query).populate('createdBy', 'username').sort({ createdAt: -1 });
    res.render('clients/index', { 
      clients,
      userPermissions: req.userPermissionLevel
    });
  } catch (error) {
    req.flash('error', 'حدث خطأ أثناء تحميل العملاء');
    res.render('clients/index', { 
      clients: [],
      userPermissions: req.userPermissionLevel || {}
    });
  }
});

// New client form
router.get('/new', requirePermission('clients', 'create'), (req, res) => {
  res.render('clients/new');
});

// Create client
router.post('/', requirePermission('clients', 'create'), async (req, res) => {
  try {
    const { fullName, mobileNumber, notes, commissionRate } = req.body;
    
    const client = new Client({
      fullName,
      mobileNumber,
      notes,
      commissionRate: parseFloat(commissionRate) || 0,
      createdBy: req.session.user.id
    });
    
    await client.save();
    req.flash('success', 'تم إضافة العميل بنجاح');
    res.redirect('/clients');
  } catch (error) {
    req.flash('error', 'حدث خطأ أثناء إضافة العميل');
    res.redirect('/clients/new');
  }
});

// Edit client form
router.get('/:id/edit', requirePermission('clients', 'update'), async (req, res) => {
  try {
    let query = { _id: req.params.id };
    
    // If user can only view own, ensure they own this client
    if (!req.userPermissionLevel?.canViewAll && req.userPermissionLevel?.canViewOwn) {
      query.createdBy = req.session.user.id;
    }
    
    const client = await Client.findOne(query);
    if (!client) {
      req.flash('error', 'العميل غير موجود أو ليس لديك صلاحية للوصول إليه');
      return res.redirect('/clients');
    }
    res.render('clients/edit', { client });
  } catch (error) {
    req.flash('error', 'حدث خطأ أثناء تحميل بيانات العميل');
    res.redirect('/clients');
  }
});

// Update client
router.put('/:id', requirePermission('clients', 'update'), async (req, res) => {
  try {
    const { fullName, mobileNumber, notes, commissionRate } = req.body;
    
    let query = { _id: req.params.id };
    
    // If user can only view own, ensure they own this client
    if (!req.userPermissionLevel?.canViewAll && req.userPermissionLevel?.canViewOwn) {
      query.createdBy = req.session.user.id;
    }
    
    const result = await Client.updateOne(query, {
      fullName,
      mobileNumber,
      notes,
      commissionRate: parseFloat(commissionRate) || 0
    });
    
    if (result.matchedCount === 0) {
      req.flash('error', 'العميل غير موجود أو ليس لديك صلاحية لتعديله');
      return res.redirect('/clients');
    }
    
    req.flash('success', 'تم تحديث بيانات العميل بنجاح');
    res.redirect('/clients');
  } catch (error) {
    req.flash('error', 'حدث خطأ أثناء تحديث بيانات العميل');
    res.redirect('/clients');
  }
});

// Delete client
router.delete('/:id', requirePermission('clients', 'delete'), async (req, res) => {
  try {
    let query = { _id: req.params.id };
    
    // If user can only view own, ensure they own this client
    if (!req.userPermissionLevel?.canViewAll && req.userPermissionLevel?.canViewOwn) {
      query.createdBy = req.session.user.id;
    }
    
    const result = await Client.deleteOne(query);
    
    if (result.deletedCount === 0) {
      req.flash('error', 'العميل غير موجود أو ليس لديك صلاحية لحذفه');
      return res.redirect('/clients');
    }
    
    req.flash('success', 'تم حذف العميل بنجاح');
    res.redirect('/clients');
  } catch (error) {
    req.flash('error', 'حدث خطأ أثناء حذف العميل');
    res.redirect('/clients');
  }
});

export default router;