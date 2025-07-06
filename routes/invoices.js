import express from 'express';
import Invoice from '../models/Invoice.js';
import Client from '../models/Client.js';
import File from '../models/File.js';
import User from '../models/User.js';
import Company from '../models/Company.js';
import CommissionTier from '../models/CommissionTier.js';
import { requireModuleAccess, requirePermission } from '../middleware/auth.js';

const router = express.Router();

// Helper function to calculate commission rate
async function calculateCommissionRate(entityType, entityId, amount) {
  // First try to find a commission tier for the specific amount
  const tierRate = await CommissionTier.findCommissionRate(entityType, entityId, amount);
  
  if (tierRate !== null) {
    return tierRate;
  }
  
  // If no tier found, use default rate from the entity
  let entity;
  switch (entityType) {
    case 'client':
      entity = await Client.findById(entityId);
      break;
    case 'distributor':
      entity = await User.findById(entityId);
      break;
    case 'company':
      entity = await Company.findById(entityId);
      break;
  }
  
  return entity ? entity.commissionRate : 0;
}

// List invoices
router.get('/', requireModuleAccess('invoices'), async (req, res) => {
  try {
    let query = {};
    
    // If user can only view own, filter by assigned distributor
    if (!req.userPermissionLevel.canViewAll && req.userPermissionLevel.canViewOwn) {
      query.assignedDistributor = req.session.user.id;
    }
    
    const invoices = await Invoice.find(query)
      .populate('client', 'fullName')
      .populate('file', 'fileName')
      .populate('assignedDistributor', 'username')
      .populate('createdBy', 'username')
      .sort({ createdAt: -1 });
      
    res.render('invoices/index', { 
      invoices,
      userPermissions: req.userPermissionLevel
    });
  } catch (error) {
    req.flash('error', 'حدث خطأ أثناء تحميل الفواتير');
    res.render('invoices/index', { 
      invoices: [],
      userPermissions: req.userPermissionLevel || {}
    });
  }
});

// New invoice form
router.get('/new', requirePermission('invoices', 'create'), async (req, res) => {
  try {
    const clients = await Client.find().sort({ fullName: 1 });
    const files = await File.find().populate('company', 'name').sort({ fileName: 1 });
    const distributors = await User.find({ role: 'distributor', isActive: true }).sort({ username: 1 });
    
    res.render('invoices/new', { clients, files, distributors });
  } catch (error) {
    req.flash('error', 'حدث خطأ أثناء تحميل البيانات');
    res.redirect('/invoices');
  }
});

// API endpoint to calculate commission rates
router.post('/calculate-commission', requirePermission('invoices', 'create'), async (req, res) => {
  try {
    const { clientId, distributorId, fileId, amount } = req.body;
    
    if (!amount || amount <= 0) {
      return res.json({ error: 'المبلغ غير صحيح' });
    }
    
    const [clientRate, distributorRate, file] = await Promise.all([
      calculateCommissionRate('client', clientId, amount),
      calculateCommissionRate('distributor', distributorId, amount),
      File.findById(fileId).populate('company')
    ]);
    
    let companyRate = 0;
    if (file && file.company) {
      companyRate = await calculateCommissionRate('company', file.company._id, amount);
    }
    
    res.json({
      clientRate,
      distributorRate,
      companyRate,
      clientCommission: (amount * clientRate / 100).toFixed(2),
      distributorCommission: (amount * distributorRate / 100).toFixed(2),
      companyCommission: (amount * companyRate / 100).toFixed(2)
    });
  } catch (error) {
    res.json({ error: 'حدث خطأ أثناء حساب العمولة' });
  }
});

// Create invoice
router.post('/', requirePermission('invoices', 'create'), async (req, res) => {
  try {
    const { invoiceCode, client, file, assignedDistributor, invoiceDate, amount } = req.body;
    
    const invoiceAmount = parseFloat(amount) || 0;
    
    // Calculate commission rates based on amount
    const [clientCommissionRate, distributorCommissionRate, fileData] = await Promise.all([
      calculateCommissionRate('client', client, invoiceAmount),
      calculateCommissionRate('distributor', assignedDistributor, invoiceAmount),
      File.findById(file).populate('company')
    ]);
    
    let companyCommissionRate = 0;
    if (fileData && fileData.company) {
      companyCommissionRate = await calculateCommissionRate('company', fileData.company._id, invoiceAmount);
    }
    
    const invoice = new Invoice({
      invoiceCode,
      client,
      file,
      assignedDistributor,
      invoiceDate: new Date(invoiceDate),
      amount: invoiceAmount,
      clientCommissionRate,
      distributorCommissionRate,
      companyCommissionRate,
      createdBy: req.session.user.id
    });
    
    await invoice.save();
    req.flash('success', 'تم إنشاء الفاتورة بنجاح');
    res.redirect('/invoices');
  } catch (error) {
    req.flash('error', 'حدث خطأ أثناء إنشاء الفاتورة');
    res.redirect('/invoices/new');
  }
});

// Edit invoice form
router.get('/:id/edit', requirePermission('invoices', 'update'), async (req, res) => {
  try {
    let query = { _id: req.params.id };
    
    // If user can only view own, ensure they are assigned to this invoice
    if (!req.userPermissionLevel?.canViewAll && req.userPermissionLevel?.canViewOwn) {
      query.assignedDistributor = req.session.user.id;
    }
    
    const invoice = await Invoice.findOne(query);
    const clients = await Client.find().sort({ fullName: 1 });
    const files = await File.find().populate('company', 'name').sort({ fileName: 1 });
    const distributors = await User.find({ role: 'distributor', isActive: true }).sort({ username: 1 });
    
    if (!invoice) {
      req.flash('error', 'الفاتورة غير موجودة أو ليس لديك صلاحية للوصول إليها');
      return res.redirect('/invoices');
    }
    
    res.render('invoices/edit', { invoice, clients, files, distributors });
  } catch (error) {
    req.flash('error', 'حدث خطأ أثناء تحميل بيانات الفاتورة');
    res.redirect('/invoices');
  }
});

// Update invoice
router.put('/:id', requirePermission('invoices', 'update'), async (req, res) => {
  try {
    const { invoiceCode, client, file, assignedDistributor, invoiceDate, amount, status } = req.body;
    
    let query = { _id: req.params.id };
    
    // If user can only view own, ensure they are assigned to this invoice
    if (!req.userPermissionLevel?.canViewAll && req.userPermissionLevel?.canViewOwn) {
      query.assignedDistributor = req.session.user.id;
    }
    
    const invoiceAmount = parseFloat(amount) || 0;
    
    // Recalculate commission rates based on new amount
    const [clientCommissionRate, distributorCommissionRate, fileData] = await Promise.all([
      calculateCommissionRate('client', client, invoiceAmount),
      calculateCommissionRate('distributor', assignedDistributor, invoiceAmount),
      File.findById(file).populate('company')
    ]);
    
    let companyCommissionRate = 0;
    if (fileData && fileData.company) {
      companyCommissionRate = await calculateCommissionRate('company', fileData.company._id, invoiceAmount);
    }
    
    const result = await Invoice.updateOne(query, {
      invoiceCode,
      client,
      file,
      assignedDistributor,
      invoiceDate: new Date(invoiceDate),
      amount: invoiceAmount,
      clientCommissionRate,
      distributorCommissionRate,
      companyCommissionRate,
      status
    });
    
    if (result.matchedCount === 0) {
      req.flash('error', 'الفاتورة غير موجودة أو ليس لديك صلاحية لتعديلها');
      return res.redirect('/invoices');
    }
    
    req.flash('success', 'تم تحديث الفاتورة بنجاح');
    res.redirect('/invoices');
  } catch (error) {
    req.flash('error', 'حدث خطأ أثناء تحديث الفاتورة');
    res.redirect('/invoices');
  }
});

// Delete invoice
router.delete('/:id', requirePermission('invoices', 'delete'), async (req, res) => {
  try {
    let query = { _id: req.params.id };
    
    // If user can only view own, ensure they are assigned to this invoice
    if (!req.userPermissionLevel?.canViewAll && req.userPermissionLevel?.canViewOwn) {
      query.assignedDistributor = req.session.user.id;
    }
    
    const result = await Invoice.deleteOne(query);
    
    if (result.deletedCount === 0) {
      req.flash('error', 'الفاتورة غير موجودة أو ليس لديك صلاحية لحذفها');
      return res.redirect('/invoices');
    }
    
    req.flash('success', 'تم حذف الفاتورة بنجاح');
    res.redirect('/invoices');
  } catch (error) {
    req.flash('error', 'حدث خطأ أثناء حذف الفاتورة');
    res.redirect('/invoices');
  }
});

export default router;