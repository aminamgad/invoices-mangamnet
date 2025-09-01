import express from 'express';
import mongoose from 'mongoose';
import Invoice from '../models/Invoice.js';
import Client from '../models/Client.js';
import File from '../models/File.js';
import User from '../models/User.js';
import Company from '../models/Company.js';
import CommissionTier from '../models/CommissionTier.js';
import ExcelJS from 'exceljs';
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
      // For distributors, exclude invoices created by admin (admin invoices are private)
      query.createdBy = { $ne: null }; // Only show invoices that have a creator
      // Exclude invoices created by admin users
      const adminUsers = await User.find({ role: 'admin' }).select('_id');
      const adminIds = adminUsers.map(user => user._id);
      query.createdBy = { $nin: adminIds };
    }
    
    // For admin, show all invoices but prioritize their own created invoices
    let invoices;
    if (req.session.user.role === 'admin') {
      // Get all invoices for admin
      invoices = await Invoice.find({})
        .populate('client', 'fullName')
        .populate('file', 'fileName')
        .populate('assignedDistributor', 'username')
        .populate('createdBy', 'username')
        .populate('approvedBy', 'username')
        .populate('paymentStatus.clientToDistributor.markedBy', 'username')
        .populate('paymentStatus.distributorToAdmin.markedBy', 'username')
        .populate('paymentStatus.adminToCompany.markedBy', 'username')
        .sort({ createdAt: -1 });
    } else {
      // For distributors, use the filtered query
      invoices = await Invoice.find(query)
        .populate('client', 'fullName')
        .populate('file', 'fileName')
        .populate('assignedDistributor', 'username')
        .populate('createdBy', 'username')
        .populate('approvedBy', 'username')
        .populate('paymentStatus.clientToDistributor.markedBy', 'username')
        .populate('paymentStatus.distributorToAdmin.markedBy', 'username')
        .populate('paymentStatus.adminToCompany.markedBy', 'username')
        .sort({ createdAt: -1 });
    }
      
    res.render('invoices/index', { 
      invoices,
      userPermissions: req.userPermissionLevel || {},
      currentUser: req.session.user || {}
    });
  } catch (error) {
    console.error('Invoices list error:', error);
    req.flash('error', 'حدث خطأ أثناء تحميل الفواتير');
    res.render('invoices/index', { 
      invoices: [],
      userPermissions: req.userPermissionLevel || {},
      currentUser: req.session.user || {}
    });
  }
});

// New invoice form
router.get('/new', requirePermission('invoices', 'create'), async (req, res) => {
  try {
    let distributorsQuery = { role: 'distributor', isActive: true };
    
    // Check if user has permission to view all distributors
    const { default: User } = await import('../models/User.js');
    const currentUser = await User.findById(req.session.user.id);
    const hasViewAllPermission = await currentUser.hasPermission('distributors', 'view_all') || 
                                req.session.user.role === 'admin';
    
    // If user doesn't have view_all permission, show only themselves or distributors they created
    if (!hasViewAllPermission) {
      distributorsQuery.$or = [
        { _id: req.session.user.id }, // Themselves
        { createdBy: req.session.user.id } // Distributors they created
      ];
    }
    
    const distributors = await User.find(distributorsQuery).sort({ username: 1 });
    
    res.render('invoices/new', { distributors });
  } catch (error) {
    req.flash('error', 'حدث خطأ أثناء تحميل البيانات');
    res.redirect('/invoices');
  }
});

// API endpoint to calculate commission rates
router.post('/calculate-commission', requirePermission('invoices', 'create'), async (req, res) => {
  try {
    const { clientId, distributorId, fileId, amount, customClientRate, customDistributorRate } = req.body;
    
    if (!amount || amount <= 0) {
      return res.json({ error: 'المبلغ غير صحيح' });
    }
    
    // Use custom rates if provided, otherwise calculate from tiers
    let clientRate, distributorRate;
    let isCustomClientRate = false, isCustomDistributorRate = false;
    
    if (customClientRate && customClientRate > 0) {
      clientRate = parseFloat(customClientRate);
      isCustomClientRate = true;
    } else {
      clientRate = await calculateCommissionRate('client', clientId, amount);
    }
    
    if (customDistributorRate && customDistributorRate > 0) {
      distributorRate = parseFloat(customDistributorRate);
      isCustomDistributorRate = true;
    } else {
      distributorRate = await calculateCommissionRate('distributor', distributorId, amount);
    }
    
    const file = await File.findById(fileId).populate('company');
    
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
      companyCommission: (amount * companyRate / 100).toFixed(2),
      isCustomClientRate,
      isCustomDistributorRate
    });
  } catch (error) {
    console.error('Commission calculation error:', error);
    res.json({ error: 'حدث خطأ أثناء حساب العمولة' });
  }
});

// Create invoice
router.post('/', requirePermission('invoices', 'create'), async (req, res) => {
  try {
    const { 
      invoiceCode, 
      client, 
      file, 
      assignedDistributor, 
      invoiceDate, 
      total,
      taxPercentage,
      taxAmount,
      managementTaxPercentage,
      managementTaxAmount,
      corporateTaxPercentage,
      corporateTaxAmount,
      profitPercentage,
      profitAmount,
      finalAmount,
      discountAmount,
      customClientCommissionRate,
      customDistributorCommissionRate
    } = req.body;
    
    // Check for duplicate invoice code
    const existingInvoice = await Invoice.findOne({ invoiceCode: invoiceCode.trim() });
    if (existingInvoice) {
      req.flash('error', 'Invoice code already exists.');
      return res.redirect('/invoices/new');
    }
    
    const invoiceTotal = parseFloat(total) || 0;
    const taxPercentageValue = parseFloat(taxPercentage) || 0;
    const taxAmountValue = parseFloat(taxAmount) || 0;
    const managementTaxPercentageValue = parseFloat(managementTaxPercentage) || 0;
    const managementTaxAmountValue = parseFloat(managementTaxAmount) || 0;
    const corporateTaxPercentageValue = parseFloat(corporateTaxPercentage) || 0;
    const corporateTaxAmountValue = parseFloat(corporateTaxAmount) || 0;
    const profitPercentageValue = parseFloat(profitPercentage) || 0;
    const profitAmountValue = parseFloat(profitAmount) || 0;
    const finalAmountValue = parseFloat(finalAmount) || 0;
    const discountAmountValue = parseFloat(discountAmount) || 0;
    
    console.log('Form data received:', { 
      customClientCommissionRate, 
      customDistributorCommissionRate, 
      total: invoiceTotal,
      taxPercentage: taxPercentageValue,
      taxAmount: taxAmountValue,
      managementTaxPercentage: managementTaxPercentageValue,
      managementTaxAmount: managementTaxAmountValue,
      corporateTaxPercentage: corporateTaxPercentageValue,
      corporateTaxAmount: corporateTaxAmountValue,
      profitPercentage: profitPercentageValue,
      profitAmount: profitAmountValue,
      finalAmount: finalAmountValue,
      discountAmount: discountAmountValue 
    });
    
    // Calculate commission rates based on total
    let clientCommissionRate, distributorCommissionRate;
    let customClientCommissionRateValue = null, customDistributorCommissionRateValue = null;
    
    if (customClientCommissionRate && customClientCommissionRate > 0) {
      clientCommissionRate = parseFloat(customClientCommissionRate);
      customClientCommissionRateValue = clientCommissionRate;
      console.log('Using custom client rate:', clientCommissionRate);
    } else {
      clientCommissionRate = await calculateCommissionRate('client', client, invoiceTotal);
      console.log('Using default client rate:', clientCommissionRate);
    }
    
    if (customDistributorCommissionRate && customDistributorCommissionRate > 0) {
      distributorCommissionRate = parseFloat(customDistributorCommissionRate);
      customDistributorCommissionRateValue = distributorCommissionRate;
      console.log('Using custom distributor rate:', distributorCommissionRate);
    } else {
      distributorCommissionRate = await calculateCommissionRate('distributor', assignedDistributor, invoiceTotal);
      console.log('Using default distributor rate:', distributorCommissionRate);
    }
    
    const fileData = await File.findById(file).populate('company');
    
    let companyCommissionRate = 0;
    if (fileData && fileData.company) {
      companyCommissionRate = await calculateCommissionRate('company', fileData.company._id, invoiceTotal);
    }
    
    console.log('Saving invoice with custom rates:', {
      customClientCommissionRate: customClientCommissionRateValue,
      customDistributorCommissionRate: customDistributorCommissionRateValue
    });
    
    const invoice = new Invoice({
      invoiceCode: invoiceCode.trim(),
      client,
      file,
      assignedDistributor,
      invoiceDate: new Date(invoiceDate),
      total: invoiceTotal,
      taxPercentage: taxPercentageValue,
      taxAmount: taxAmountValue,
      managementTaxPercentage: managementTaxPercentageValue,
      managementTaxAmount: managementTaxAmountValue,
      corporateTaxPercentage: corporateTaxPercentageValue,
      corporateTaxAmount: corporateTaxAmountValue,
      profitPercentage: profitPercentageValue,
      profitAmount: profitAmountValue,
      finalAmount: finalAmountValue,
      discountAmount: discountAmountValue,
      clientCommissionRate,
      distributorCommissionRate,
      companyCommissionRate,
      customClientCommissionRate: customClientCommissionRateValue,
      customDistributorCommissionRate: customDistributorCommissionRateValue,
      createdBy: req.session.user.id
    });
    
    await invoice.save();
    console.log('Invoice saved successfully with ID:', invoice._id);
    req.flash('success', 'تم إنشاء الفاتورة بنجاح');
    res.redirect('/invoices');
  } catch (error) {
    console.error('Invoice creation error:', error);
    if (error.code === 11000 && error.keyPattern?.invoiceCode) {
      req.flash('error', 'Invoice code already exists.');
    } else {
      req.flash('error', 'حدث خطأ أثناء إنشاء الفاتورة');
    }
    res.redirect('/invoices/new');
  }
});

// Mark payment step as paid
router.post('/:id/payment/:step', requireModuleAccess('invoices'), async (req, res) => {
  try {
    const { id, step } = req.params;
    const validSteps = ['clientToDistributor', 'distributorToAdmin', 'adminToCompany'];
    
    if (!validSteps.includes(step)) {
      req.flash('error', 'خطوة الدفع غير صحيحة');
      return res.redirect('/invoices');
    }
    
    let query = { _id: id };
    
    // If user can only view own, ensure they are assigned to this invoice
    if (!req.userPermissionLevel?.canViewAll && req.userPermissionLevel?.canViewOwn) {
      query.assignedDistributor = req.session.user.id;
    }
    
    const invoice = await Invoice.findOne(query);
    
    if (!invoice) {
      req.flash('error', 'الفاتورة غير موجودة أو ليس لديك صلاحية للوصول إليها');
      return res.redirect('/invoices');
    }
    
    // Check if user can mark this payment step
    if (!invoice.canUserMarkPayment(req.session.user.id, req.session.user.role, step)) {
      req.flash('error', 'ليس لديك صلاحية لتحديث هذه الخطوة');
      return res.redirect('/invoices');
    }
    
    // Check if step is already paid
    if (invoice.paymentStatus[step].isPaid) {
      req.flash('error', 'هذه الخطوة مدفوعة بالفعل');
      return res.redirect('/invoices');
    }
    
    // Mark the payment step as paid
    invoice.markPaymentStep(step, req.session.user.id);
    await invoice.save();
    
    const stepNames = {
      clientToDistributor: 'العميل → الموزع',
      distributorToAdmin: 'الموزع → الإدارة',
      adminToCompany: 'الإدارة → الشركة'
    };
    
    req.flash('success', `تم تحديث حالة الدفع: ${stepNames[step]}`);
    
    // Redirect back to dashboard if coming from dashboard
    if (req.headers.referer && req.headers.referer.includes('/dashboard')) {
      return res.redirect('/dashboard');
    }
    
    res.redirect('/invoices');
  } catch (error) {
    req.flash('error', 'حدث خطأ أثناء تحديث حالة الدفع');
    res.redirect('/invoices');
  }
});

// Bulk payment for client (distributor only)
router.post('/bulk-pay/client/:clientId', requireModuleAccess('invoices'), async (req, res) => {
  try {
    const { clientId } = req.params;
    
    // Only distributors can use this endpoint
    if (req.session.user.role !== 'distributor') {
      req.flash('error', 'ليس لديك صلاحية لتنفيذ هذا الإجراء');
      return res.redirect('/dashboard');
    }
    
    // Find all unpaid invoices for this client assigned to current distributor
    const invoices = await Invoice.find({
      client: clientId,
      assignedDistributor: req.session.user.id,
      'paymentStatus.clientToDistributor.isPaid': false
    }).populate('client', 'fullName');
    
    if (invoices.length === 0) {
      req.flash('error', 'لا توجد فواتير غير مدفوعة لهذا العميل');
      return res.redirect('/dashboard');
    }
    
    // Mark all as paid
    let updatedCount = 0;
    for (const invoice of invoices) {
      invoice.markPaymentStep('clientToDistributor', req.session.user.id);
      await invoice.save();
      updatedCount++;
    }
    
    const clientName = invoices[0].client?.fullName || 'العميل';
    req.flash('success', `تم تحديث ${updatedCount} فاتورة للعميل "${clientName}" كمدفوعة`);
    res.redirect('/dashboard');
  } catch (error) {
    console.error('Bulk payment error:', error);
    req.flash('error', 'حدث خطأ أثناء تحديث حالة الدفع');
    res.redirect('/dashboard');
  }
});

// Bulk payment for distributor (admin only)
router.post('/bulk-pay/distributor/:distributorId', requireModuleAccess('invoices'), async (req, res) => {
  console.log('=== BULK PAYMENT DISTRIBUTOR ROUTE CALLED ===');
  console.log('Request method:', req.method);
  console.log('Request URL:', req.url);
  console.log('Request headers:', req.headers);
  console.log('Request body:', req.body);
  console.log('Session user:', req.session.user);
  try {
    const { distributorId } = req.params;
    
    console.log('Bulk payment for distributor called:', {
      distributorId,
      userId: req.session.user.id,
      userRole: req.session.user.role
    });
    
    // Only admin can use this endpoint
    if (req.session.user.role !== 'admin') {
      req.flash('error', 'ليس لديك صلاحية لتنفيذ هذا الإجراء');
      return res.redirect('/dashboard');
    }
    
    // Find all unpaid invoices for this distributor that admin created manually
    const invoices = await Invoice.find({
      assignedDistributor: distributorId,
      createdBy: req.session.user.id, // Only invoices created by admin
      'paymentStatus.distributorToAdmin.isPaid': false // Only unpaid invoices
    }).populate('assignedDistributor', 'username');
    
    console.log('Found invoices for bulk payment:', {
      totalInvoices: invoices.length,
      distributorId,
      adminId: req.session.user.id
    });
    
    // Additional check to ensure these are admin-created invoices
    const adminInvoices = invoices.filter(invoice => 
      invoice.createdBy && 
      invoice.createdBy.toString() === req.session.user.id
    );
    
    console.log('Filtered admin invoices:', adminInvoices.length);
    
    if (adminInvoices.length === 0) {
      req.flash('error', 'لا توجد فواتير غير مدفوعة لهذا الموزع');
      return res.redirect('/dashboard');
    }
    
    // Mark all as paid (distributor to admin)
    let updatedCount = 0;
    for (const invoice of adminInvoices) {
      console.log('Processing invoice:', invoice._id);
      // Only mark distributorToAdmin as paid (admin is paying the distributor)
      // Don't mark clientToDistributor as paid since that's a separate step
      invoice.markPaymentStep('distributorToAdmin', req.session.user.id);
      await invoice.save();
      updatedCount++;
    }
    
    const distributorName = invoices[0].assignedDistributor?.username || 'الموزع';
    console.log('Bulk payment completed:', {
      updatedCount,
      distributorName
    });
    
    req.flash('success', `تم تحديث جميع الفواتير (${updatedCount} فاتورة) للموزع "${distributorName}" كمدفوعة`);
    res.redirect('/dashboard');
  } catch (error) {
    console.error('Bulk payment error:', error);
    req.flash('error', 'حدث خطأ أثناء تحديث حالة الدفع');
    res.redirect('/dashboard');
  }
});

// Bulk payment for company (admin only)
router.post('/bulk-pay/company/:companyId', requireModuleAccess('invoices'), async (req, res) => {
  console.log('=== BULK PAYMENT COMPANY ROUTE CALLED ===');
  console.log('Request method:', req.method);
  console.log('Request URL:', req.url);
  console.log('Request headers:', req.headers);
  console.log('Request body:', req.body);
  console.log('Session user:', req.session.user);
  try {
    const { companyId } = req.params;
    
    console.log('Bulk payment for company called:', {
      companyId,
      userId: req.session.user.id,
      userRole: req.session.user.role
    });
    
    // Only admin can use this endpoint
    if (req.session.user.role !== 'admin') {
      req.flash('error', 'ليس لديك صلاحية لتنفيذ هذا الإجراء');
      return res.redirect('/dashboard');
    }
    
    // Find all unpaid invoices for this company that admin created manually
    const invoices = await Invoice.find({
      createdBy: req.session.user.id, // Only invoices created by admin
      'paymentStatus.adminToCompany.isPaid': false // Only unpaid invoices
    }).populate({
      path: 'file',
      populate: {
        path: 'company',
        model: 'Company'
      }
    });
    
    console.log('Found invoices for company bulk payment:', {
      totalInvoices: invoices.length,
      companyId,
      adminId: req.session.user.id
    });
    
    // Additional check to ensure these are admin-created invoices
    const adminInvoices = invoices.filter(invoice => 
      invoice.createdBy && 
      invoice.createdBy.toString() === req.session.user.id
    );
    
    // Filter by company
    const companyInvoices = adminInvoices.filter(invoice => 
      invoice.file && 
      invoice.file.company && 
      invoice.file.company._id.toString() === companyId
    );
    
    console.log('Filtered company invoices:', {
      adminInvoices: adminInvoices.length,
      companyInvoices: companyInvoices.length
    });
    
    if (companyInvoices.length === 0) {
      req.flash('error', 'لا توجد فواتير غير مدفوعة لهذه الشركة');
      return res.redirect('/dashboard');
    }
    
    // Mark all as paid (admin to company)
    let updatedCount = 0;
    for (const invoice of companyInvoices) {
      console.log('Processing company invoice:', invoice._id);
      // Mark as admin to company paid
      invoice.markPaymentStep('adminToCompany', req.session.user.id);
      await invoice.save();
      updatedCount++;
    }
    
    const companyName = companyInvoices[0].file?.company?.name || 'الشركة';
    console.log('Company bulk payment completed:', {
      updatedCount,
      companyName
    });
    
    req.flash('success', `تم تحديث جميع الفواتير (${updatedCount} فاتورة) للشركة "${companyName}" كمدفوعة`);
    res.redirect('/dashboard');
  } catch (error) {
    console.error('Bulk payment error:', error);
    req.flash('error', 'حدث خطأ أثناء تحديث حالة الدفع');
    res.redirect('/dashboard');
  }
});

// Unmark payment step (admin only)
router.delete('/:id/payment/:step', requirePermission('invoices', 'update'), async (req, res) => {
  try {
    const { id, step } = req.params;
    const validSteps = ['clientToDistributor', 'distributorToAdmin', 'adminToCompany'];
    
    if (!validSteps.includes(step)) {
      req.flash('error', 'خطوة الدفع غير صحيحة');
      return res.redirect('/invoices');
    }
    
    // Only admin can unmark payment steps
    if (req.session.user.role !== 'admin') {
      req.flash('error', 'ليس لديك صلاحية لإلغاء حالة الدفع');
      return res.redirect('/invoices');
    }
    
    const invoice = await Invoice.findById(id);
    
    if (!invoice) {
      req.flash('error', 'الفاتورة غير موجودة');
      return res.redirect('/invoices');
    }
    
    // Unmark the payment step
    invoice.unmarkPaymentStep(step);
    await invoice.save();
    
    const stepNames = {
      clientToDistributor: 'العميل → الموزع',
      distributorToAdmin: 'الموزع → الإدارة',
      adminToCompany: 'الإدارة → الشركة'
    };
    
    req.flash('success', `تم إلغاء حالة الدفع: ${stepNames[step]}`);
    res.redirect('/invoices');
  } catch (error) {
    req.flash('error', 'حدث خطأ أثناء إلغاء حالة الدفع');
    res.redirect('/invoices');
  }
});

// Show invoice details
router.get('/:id', requireModuleAccess('invoices'), async (req, res) => {
  try {
    let query = { _id: req.params.id };
    
    // If user can only view own, ensure they are assigned to this invoice
    if (!req.userPermissionLevel?.canViewAll && req.userPermissionLevel?.canViewOwn) {
      query.assignedDistributor = req.session.user.id;
      // For distributors, exclude invoices created by admin (admin invoices are private)
      const adminUsers = await User.find({ role: 'admin' }).select('_id');
      const adminIds = adminUsers.map(user => user._id);
      query.createdBy = { $nin: adminIds };
    }
    
    const invoice = await Invoice.findOne(query)
      .populate('client', 'fullName mobileNumber')
      .populate('file', 'fileName')
      .populate('assignedDistributor', 'username')
      .populate('createdBy', 'username')
      .populate('approvedBy', 'username')
      .populate('paymentStatus.clientToDistributor.markedBy', 'username')
      .populate('paymentStatus.distributorToAdmin.markedBy', 'username')
      .populate('paymentStatus.adminToCompany.markedBy', 'username');
    
    if (!invoice) {
      req.flash('error', 'الفاتورة غير موجودة أو ليس لديك صلاحية للوصول إليها');
      return res.redirect('/invoices');
    }
    
    // Calculate commission amounts
    const clientCommission = (invoice.amount * invoice.clientCommissionRate / 100);
    const distributorCommission = (invoice.amount * invoice.distributorCommissionRate / 100);
    const companyCommission = (invoice.amount * invoice.companyCommissionRate / 100);
    const netProfit = invoice.amount - clientCommission - distributorCommission - companyCommission;
    
    res.render('invoices/details', { 
      invoice, 
      clientCommission, 
      distributorCommission, 
      companyCommission, 
      netProfit,
      userPermissions: req.userPermissionLevel || {},
      currentUser: req.session.user || {}
    });
  } catch (error) {
    console.error('Invoice details error:', error);
    req.flash('error', 'حدث خطأ أثناء تحميل تفاصيل الفاتورة');
    res.redirect('/invoices');
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
    
    const invoice = await Invoice.findOne(query)
      .populate('approvedBy', 'username');
    const clients = await Client.find().sort({ fullName: 1 });
    const files = await File.find().populate('company', 'name').sort({ fileName: 1 });
    
    // Apply distributor filtering based on permissions
    let distributorsQuery = { role: 'distributor', isActive: true };
    
    // Check if user has permission to view all distributors
    const { default: User } = await import('../models/User.js');
    const currentUser = await User.findById(req.session.user.id);
    const hasViewAllPermission = await currentUser.hasPermission('distributors', 'view_all') || 
                                req.session.user.role === 'admin';
    
    // If user doesn't have view_all permission, show only themselves or distributors they created
    if (!hasViewAllPermission) {
      distributorsQuery.$or = [
        { _id: req.session.user.id }, // Themselves
        { createdBy: req.session.user.id } // Distributors they created
      ];
    }
    
    const distributors = await User.find(distributorsQuery).sort({ username: 1 });
    
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
    const { 
      invoiceCode, 
      client, 
      file, 
      assignedDistributor, 
      invoiceDate, 
      amount, 
      discountAmount,
      customClientCommissionRate,
      customDistributorCommissionRate,
      status 
    } = req.body;
    
    let query = { _id: req.params.id };
    
    // If user can only view own, ensure they are assigned to this invoice
    if (!req.userPermissionLevel?.canViewAll && req.userPermissionLevel?.canViewOwn) {
      query.assignedDistributor = req.session.user.id;
      // For distributors, exclude invoices created by admin (admin invoices are private)
      const adminUsers = await User.find({ role: 'admin' }).select('_id');
      const adminIds = adminUsers.map(user => user._id);
      query.createdBy = { $nin: adminIds };
    }
    
    // Get the current invoice to check approval status
    const currentInvoice = await Invoice.findOne(query);
    if (!currentInvoice) {
      req.flash('error', 'الفاتورة غير موجودة أو ليس لديك صلاحية لتعديلها');
      return res.redirect('/invoices');
    }
    
    // Check if invoice is approved - restrict editing of sensitive fields
    if (currentInvoice.isApproved) {
      // Only allow editing non-sensitive fields when approved
      const updateData = {
        invoiceCode,
        client,
        file,
        assignedDistributor,
        invoiceDate: new Date(invoiceDate),
        status
      };
      
      const result = await Invoice.updateOne(query, updateData);
      
      if (result.matchedCount === 0) {
        req.flash('error', 'الفاتورة غير موجودة أو ليس لديك صلاحية لتعديلها');
        return res.redirect('/invoices');
      }
      
      req.flash('success', 'تم تحديث الفاتورة بنجاح (الحقول المالية محمية بعد الموافقة)');
      return res.redirect('/invoices');
    }
    
    // If not approved, allow full editing
    const invoiceAmount = parseFloat(amount) || 0;
    const discountAmountValue = parseFloat(discountAmount) || 0;
    
    // Calculate commission rates based on amount
    let clientCommissionRate, distributorCommissionRate;
    let customClientCommissionRateValue = null, customDistributorCommissionRateValue = null;
    
    if (customClientCommissionRate && customClientCommissionRate > 0) {
      clientCommissionRate = parseFloat(customClientCommissionRate);
      customClientCommissionRateValue = clientCommissionRate;
    } else {
      clientCommissionRate = await calculateCommissionRate('client', client, invoiceAmount);
    }
    
    if (customDistributorCommissionRate && customDistributorCommissionRate > 0) {
      distributorCommissionRate = parseFloat(customDistributorCommissionRate);
      customDistributorCommissionRateValue = distributorCommissionRate;
    } else {
      distributorCommissionRate = await calculateCommissionRate('distributor', assignedDistributor, invoiceAmount);
    }
    
    const fileData = await File.findById(file).populate('company');
    
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
      discountAmount: discountAmountValue,
      clientCommissionRate,
      distributorCommissionRate,
      companyCommissionRate,
      customClientCommissionRate: customClientCommissionRateValue,
      customDistributorCommissionRate: customDistributorCommissionRateValue,
      status
    });
    
    if (result.matchedCount === 0) {
      req.flash('error', 'الفاتورة غير موجودة أو ليس لديك صلاحية لتعديلها');
      return res.redirect('/invoices');
    }
    
    req.flash('success', 'تم تحديث الفاتورة بنجاح');
    res.redirect('/invoices');
  } catch (error) {
    console.error('Invoice update error:', error);
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
      // For distributors, exclude invoices created by admin (admin invoices are private)
      const adminUsers = await User.find({ role: 'admin' }).select('_id');
      const adminIds = adminUsers.map(user => user._id);
      query.createdBy = { $nin: adminIds };
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

// Export invoices to Excel
router.post('/export-excel', requireModuleAccess('invoices'), async (req, res) => {
  try {
    const { invoices } = req.body;
    
    if (!invoices || !Array.isArray(invoices) || invoices.length === 0) {
      return res.status(400).json({ error: 'لا توجد بيانات للتصدير' });
    }
    
    // Create a new workbook and worksheet
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('الفواتير');
    
    // Set RTL direction for Arabic text
    worksheet.views = [{ rightToLeft: true }];
    
    // Define columns
    worksheet.columns = [
      { header: 'رقم الفاتورة', key: 'invoiceCode', width: 15 },
      { header: 'اسم العميل', key: 'clientName', width: 20 },
      { header: 'اسم الملف', key: 'fileName', width: 25 },
      { header: 'اسم الموزع', key: 'distributorName', width: 15 },
      { header: 'مبلغ الفاتورة (جنيه)', key: 'amount', width: 18 },
      { header: 'عمولة العميل (جنيه)', key: 'clientCommission', width: 18 },
      { header: 'عمولة الموزع (جنيه)', key: 'distributorCommission', width: 18 },
      { header: 'عمولة الشركة (جنيه)', key: 'companyCommission', width: 18 },
      { header: 'صافي الربح (جنيه)', key: 'netProfit', width: 18 },
      { header: 'حالة الدفع', key: 'paymentStatus', width: 15 },
      { header: 'نسبة التقدم', key: 'progressPercent', width: 12 },
      { header: 'تاريخ الفاتورة', key: 'invoiceDate', width: 15 }
    ];
    
    // Style the header row
    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFF' } };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: '4472C4' }
    };
    headerRow.alignment = { horizontal: 'center', vertical: 'middle' };
    headerRow.height = 25;
    
    // Add data rows
    invoices.forEach((invoice, index) => {
      const netProfit = invoice.amount - invoice.clientCommission - invoice.distributorCommission - invoice.companyCommission;
      
      const row = worksheet.addRow({
        invoiceCode: invoice.invoiceCode,
        clientName: invoice.clientName,
        fileName: invoice.fileName,
        distributorName: invoice.distributorName,
        amount: invoice.amount,
        clientCommission: invoice.clientCommission,
        distributorCommission: invoice.distributorCommission,
        companyCommission: invoice.companyCommission,
        netProfit: netProfit,
        paymentStatus: invoice.paymentStatus,
        progressPercent: invoice.progressPercent,
        invoiceDate: invoice.invoiceDate
      });
      
      // Style data rows
      row.alignment = { horizontal: 'center', vertical: 'middle' };
      
      // Alternate row colors
      if (index % 2 === 0) {
        row.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'F2F2F2' }
        };
      }
      
      // Format currency cells
      [5, 6, 7, 8, 9].forEach(colIndex => {
        const cell = row.getCell(colIndex);
        cell.numFmt = '#,##0.00';
      });
      
      // Color code net profit
      const netProfitCell = row.getCell(9);
      if (netProfit >= 0) {
        netProfitCell.font = { color: { argb: '008000' } }; // Green for positive
      } else {
        netProfitCell.font = { color: { argb: 'FF0000' } }; // Red for negative
      }
    });
    
    // Add borders to all cells
    worksheet.eachRow((row, rowNumber) => {
      row.eachCell((cell) => {
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        };
      });
    });
    
    // Add summary row
    const summaryRowIndex = worksheet.rowCount + 2;
    const summaryRow = worksheet.getRow(summaryRowIndex);
    
    const totalAmount = invoices.reduce((sum, inv) => sum + inv.amount, 0);
    const totalClientCommission = invoices.reduce((sum, inv) => sum + inv.clientCommission, 0);
    const totalDistributorCommission = invoices.reduce((sum, inv) => sum + inv.distributorCommission, 0);
    const totalCompanyCommission = invoices.reduce((sum, inv) => sum + inv.companyCommission, 0);
    const totalNetProfit = totalAmount - totalClientCommission - totalDistributorCommission - totalCompanyCommission;
    
    summaryRow.values = [
      '', '', '', 'الإجمالي:', 
      totalAmount, 
      totalClientCommission, 
      totalDistributorCommission, 
      totalCompanyCommission, 
      totalNetProfit, 
      '', '', ''
    ];
    
    summaryRow.font = { bold: true };
    summaryRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFFF00' }
    };
    
    // Format summary currency cells
    [5, 6, 7, 8, 9].forEach(colIndex => {
      const cell = summaryRow.getCell(colIndex);
      cell.numFmt = '#,##0.00';
    });
    
    // Set response headers
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=invoices-${new Date().toISOString().split('T')[0]}.xlsx`);
    
    // Write to response
    await workbook.xlsx.write(res);
    res.end();
    
  } catch (error) {
    console.error('Excel export error:', error);
    res.status(500).json({ error: 'حدث خطأ أثناء تصدير البيانات' });
  }
});

// Approve invoice (admin only)
router.post('/:id/approve', requirePermission('invoices', 'update'), async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) {
      req.flash('error', 'الفاتورة غير موجودة');
      return res.redirect('/invoices');
    }
    
    if (invoice.isApproved) {
      req.flash('warning', 'الفاتورة موافق عليها بالفعل');
      return res.redirect('/invoices');
    }
    
    invoice.isApproved = true;
    invoice.approvedBy = req.session.user.id;
    invoice.approvedAt = new Date();
    
    await invoice.save();
    
    req.flash('success', 'تم الموافقة على الفاتورة بنجاح');
    res.redirect('/invoices');
  } catch (error) {
    console.error('Invoice approval error:', error);
    req.flash('error', 'حدث خطأ أثناء الموافقة على الفاتورة');
    res.redirect('/invoices');
  }
});

// Unapprove invoice (admin only)
router.post('/:id/unapprove', requirePermission('invoices', 'update'), async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) {
      req.flash('error', 'الفاتورة غير موجودة');
      return res.redirect('/invoices');
    }
    
    if (!invoice.isApproved) {
      req.flash('warning', 'الفاتورة غير موافق عليها');
      return res.redirect('/invoices');
    }
    
    invoice.isApproved = false;
    invoice.approvedBy = null;
    invoice.approvedAt = null;
    
    await invoice.save();
    
    req.flash('success', 'تم إلغاء الموافقة على الفاتورة بنجاح');
    res.redirect('/invoices');
  } catch (error) {
    console.error('Invoice unapproval error:', error);
    req.flash('error', 'حدث خطأ أثناء إلغاء الموافقة على الفاتورة');
    res.redirect('/invoices');
  }
});

// Mass Payment Form
router.get('/mass-payment', requireModuleAccess('invoices'), async (req, res) => {
  try {
    const user = req.session.user;
    let clients = [];
    let distributors = [];
    let companies = [];

    if (user.role === 'admin') {
      // Admin can see all entities
      clients = await Client.find({ isActive: true }).sort({ fullName: 1 });
      distributors = await User.find({ role: 'distributor', isActive: true }).sort({ username: 1 });
      companies = await Company.find({ isActive: true }).sort({ name: 1 });
    } else if (user.role === 'distributor') {
      // Distributors can only see their assigned clients
      const invoices = await Invoice.find({ 
        assignedDistributor: user.id,
        'paymentStatus.clientToDistributor.isPaid': false
      }).populate('client');
      
      const clientIds = [...new Set(invoices.map(inv => inv.client._id.toString()))];
      clients = await Client.find({ 
        _id: { $in: clientIds },
        isActive: true 
      }).sort({ fullName: 1 });
    }

    res.render('invoices/mass-payment', {
      clients,
      distributors,
      companies,
      currentUser: user
    });
  } catch (error) {
    console.error('Mass payment form error:', error);
    req.flash('error', 'حدث خطأ أثناء تحميل نموذج الدفع الجماعي');
    res.redirect('/dashboard');
  }
});

// API endpoint to get unpaid data for entities
router.get('/api/invoices/unpaid-data/:entityType', requireModuleAccess('invoices'), async (req, res) => {
  try {
    const { entityType } = req.params;
    const user = req.session.user;
    
    let data = [];
    
    switch (entityType) {
      case 'client':
        if (user.role === 'distributor') {
          const clientData = await Invoice.aggregate([
            {
              $match: {
                assignedDistributor: new mongoose.Types.ObjectId(user.id),
                'paymentStatus.clientToDistributor.isPaid': false
              }
            },
            {
              $group: {
                _id: '$client',
                invoiceCount: { $sum: 1 },
                totalAmount: { $sum: '$amount' }
              }
            }
          ]);
          
          data = clientData.map(item => ({
            entityId: item._id.toString(),
            invoiceCount: item.invoiceCount,
            totalAmount: item.totalAmount
          }));
        }
        break;
        
      case 'distributor':
        if (user.role === 'admin') {
          const distributorData = await Invoice.aggregate([
            {
              $match: {
                createdBy: new mongoose.Types.ObjectId(user.id),
                'paymentStatus.distributorToAdmin.isPaid': false
              }
            },
            {
              $group: {
                _id: '$assignedDistributor',
                invoiceCount: { $sum: 1 },
                totalAmount: { $sum: '$amount' }
              }
            }
          ]);
          
          data = distributorData.map(item => ({
            entityId: item._id.toString(),
            invoiceCount: item.invoiceCount,
            totalAmount: item.totalAmount
          }));
        }
        break;
        
      case 'company':
        if (user.role === 'admin') {
          const companyData = await Invoice.aggregate([
            {
              $match: {
                createdBy: new mongoose.Types.ObjectId(user.id),
                'paymentStatus.adminToCompany.isPaid': false
              }
            },
            {
              $lookup: {
                from: 'files',
                localField: 'file',
                foreignField: '_id',
                as: 'fileData'
              }
            },
            {
              $unwind: '$fileData'
            },
            {
              $group: {
                _id: '$fileData.company',
                invoiceCount: { $sum: 1 },
                totalAmount: { $sum: '$amount' }
              }
            }
          ]);
          
          data = companyData.map(item => ({
            entityId: item._id.toString(),
            invoiceCount: item.invoiceCount,
            totalAmount: item.totalAmount
          }));
        }
        break;
    }
    
    res.json({ success: true, data });
  } catch (error) {
    console.error('API error:', error);
    res.status(500).json({ success: false, error: 'حدث خطأ في الخادم' });
  }
});

// Process Mass Payment
router.post('/mass-payment', requireModuleAccess('invoices'), async (req, res) => {
  try {
    const { entityType, entityIds, paymentMethod, notes } = req.body;
    const user = req.session.user;
    
    if (!entityType || !entityIds || entityIds.length === 0) {
      req.flash('error', 'يرجى تحديد نوع الكيان والكيانات المطلوبة');
      return res.redirect('/invoices/mass-payment');
    }

    let processedCount = 0;
    let totalAmount = 0;
    const errors = [];

    for (const entityId of entityIds) {
      try {
        let invoices = [];
        
        switch (entityType) {
          case 'client':
            if (user.role === 'distributor') {
              invoices = await Invoice.find({
                client: entityId,
                assignedDistributor: user.id,
                'paymentStatus.clientToDistributor.isPaid': false
              });
            }
            break;
            
          case 'distributor':
            if (user.role === 'admin') {
              invoices = await Invoice.find({
                assignedDistributor: entityId,
                createdBy: user.id,
                'paymentStatus.distributorToAdmin.isPaid': false
              });
            }
            break;
            
          case 'company':
            if (user.role === 'admin') {
              const companyInvoices = await Invoice.find({
                createdBy: user.id,
                'paymentStatus.adminToCompany.isPaid': false
              }).populate({
                path: 'file',
                populate: { path: 'company' }
              });
              
              invoices = companyInvoices.filter(invoice => 
                invoice.file && 
                invoice.file.company && 
                invoice.file.company._id.toString() === entityId
              );
            }
            break;
        }

        if (invoices.length > 0) {
          for (const invoice of invoices) {
            switch (entityType) {
              case 'client':
                invoice.markPaymentStep('clientToDistributor', user.id);
                break;
              case 'distributor':
                invoice.markPaymentStep('clientToDistributor', user.id);
                invoice.markPaymentStep('distributorToAdmin', user.id);
                break;
              case 'company':
                invoice.markPaymentStep('adminToCompany', user.id);
                break;
            }
            
            // Add payment notes if provided
            if (notes) {
              invoice.paymentNotes = notes;
            }
            
            await invoice.save();
            totalAmount += invoice.amount;
          }
          processedCount += invoices.length;
        }
      } catch (error) {
        errors.push(`خطأ في معالجة الكيان ${entityId}: ${error.message}`);
      }
    }

    if (processedCount > 0) {
      req.flash('success', `تم معالجة ${processedCount} فاتورة بنجاح. إجمالي المبلغ: ${totalAmount.toLocaleString('ar-SA')} جنيه`);
    }
    
    if (errors.length > 0) {
      req.flash('warning', `تم معالجة ${processedCount} فاتورة مع ${errors.length} أخطاء`);
    }

    res.redirect('/invoices/mass-payment');
  } catch (error) {
    console.error('Mass payment processing error:', error);
    req.flash('error', 'حدث خطأ أثناء معالجة الدفع الجماعي');
    res.redirect('/invoices/mass-payment');
  }
});

// API endpoint for customer debts data
router.get('/api/invoices/customer-debts', requireModuleAccess('invoices'), async (req, res) => {
  try {
    // Get all unpaid invoices grouped by customer
    const customerDebts = await Invoice.aggregate([
      {
        $match: {
          'paymentStatus.clientToDistributor.status': { $ne: 'paid' }
        }
      },
      {
        $lookup: {
          from: 'clients',
          localField: 'client',
          foreignField: '_id',
          as: 'clientInfo'
        }
      },
      {
        $lookup: {
          from: 'users',
          localField: 'assignedDistributor',
          foreignField: '_id',
          as: 'distributorInfo'
        }
      },
      {
        $unwind: '$clientInfo'
      },
      {
        $unwind: '$distributorInfo'
      },
      {
        $group: {
          _id: '$client',
          customerId: { $first: '$client' },
          customerName: { $first: '$clientInfo.fullName' },
          phoneNumber: { $first: '$clientInfo.mobileNumber' },
          distributorId: { $first: '$assignedDistributor' },
          distributorName: { $first: '$distributorInfo.username' },
          distributorWhatsapp: { $first: '$distributorInfo.whatsappNumber' },
          invoiceCount: { $sum: 1 },
          totalAmount: { $sum: '$totalAmount' },
          totalTax: { $sum: '$taxAmount' },
          totalProfit: { $sum: '$profitAmount' },
          totalDue: { $sum: '$totalAmount' }
        }
      },
      {
        $sort: { totalDue: -1 }
      }
    ]);

    // Format the data for the frontend
    const formattedData = customerDebts.map(customer => ({
      customerId: customer.customerId,
      customerName: customer.customerName,
      phoneNumber: customer.phoneNumber,
      distributorId: customer.distributorId,
      distributorName: customer.distributorName,
      distributorWhatsapp: customer.distributorWhatsapp,
      invoiceCount: customer.invoiceCount,
      totalAmount: customer.totalAmount,
      totalTax: customer.totalTax,
      totalProfit: customer.totalProfit,
      totalDue: customer.totalDue
    }));

    res.json({
      success: true,
      data: formattedData
    });
  } catch (error) {
    console.error('Error fetching customer debts:', error);
    res.status(500).json({
      success: false,
      message: 'حدث خطأ أثناء تحميل بيانات مديونية العملاء'
    });
  }
});

// API endpoint for processing payment
router.post('/api/invoices/process-payment', requireModuleAccess('invoices'), async (req, res) => {
  try {
    const { customerId, paymentMethod, paymentDate, paymentNotes } = req.body;

    if (!customerId || !paymentMethod || !paymentDate) {
      return res.status(400).json({
        success: false,
        message: 'جميع الحقول مطلوبة'
      });
    }

    // Find all unpaid invoices for this customer
    const unpaidInvoices = await Invoice.find({
      client: customerId,
      'paymentStatus.clientToDistributor.status': { $ne: 'paid' }
    });

    if (unpaidInvoices.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'لا توجد فواتير غير مدفوعة لهذا العميل'
      });
    }

    // Update all invoices as paid
    const updatePromises = unpaidInvoices.map(invoice => {
      return Invoice.findByIdAndUpdate(invoice._id, {
        'paymentStatus.clientToDistributor.status': 'paid',
        'paymentStatus.clientToDistributor.paidAt': new Date(paymentDate),
        'paymentStatus.clientToDistributor.paymentMethod': paymentMethod,
        'paymentStatus.clientToDistributor.notes': paymentNotes,
        'paymentStatus.clientToDistributor.markedBy': req.session.user.id
      });
    });

    await Promise.all(updatePromises);

    res.json({
      success: true,
      message: 'تم معالجة الدفع بنجاح',
      processedInvoices: unpaidInvoices.length
    });
  } catch (error) {
    console.error('Error processing payment:', error);
    res.status(500).json({
      success: false,
      message: 'حدث خطأ أثناء معالجة الدفع'
    });
  }
});

// Bulk mark invoices as paid
router.post('/bulk-mark-paid', requireModuleAccess('invoices'), async (req, res) => {
  try {
    const { invoiceIds } = req.body;
    
    if (!invoiceIds || !Array.isArray(invoiceIds) || invoiceIds.length === 0) {
      req.flash('error', 'لم يتم تحديد أي فواتير للدفع');
      return res.redirect('/dashboard');
    }

    console.log('Bulk mark paid - Invoice IDs:', invoiceIds);
    console.log('User:', req.session.user);

    let updatedCount = 0;
    const userRole = req.session.user.role;

    for (const invoiceId of invoiceIds) {
      try {
        const invoice = await Invoice.findById(invoiceId);
        
        if (!invoice) {
          console.log(`Invoice not found: ${invoiceId}`);
          continue;
        }

        // Determine which payment step to mark based on user role
        let paymentStep = '';
        if (userRole === 'distributor') {
          // Distributor can mark clientToDistributor as paid
          if (!invoice.paymentStatus.clientToDistributor.isPaid) {
            paymentStep = 'clientToDistributor';
          }
        } else if (userRole === 'admin') {
          // Admin can mark distributorToAdmin or adminToCompany as paid
          if (!invoice.paymentStatus.adminToCompany.isPaid) {
            paymentStep = 'adminToCompany';
          } else if (!invoice.paymentStatus.distributorToAdmin.isPaid) {
            paymentStep = 'distributorToAdmin';
          }
        }

        if (paymentStep) {
          invoice.markPaymentStep(paymentStep, req.session.user.id);
          await invoice.save();
          updatedCount++;
          console.log(`Marked invoice ${invoiceId} as paid for step: ${paymentStep}`);
        }
      } catch (error) {
        console.error(`Error processing invoice ${invoiceId}:`, error);
      }
    }

    if (updatedCount > 0) {
      req.flash('success', `تم تحديث ${updatedCount} فاتورة كمدفوعة بنجاح`);
    } else {
      req.flash('warning', 'لم يتم تحديث أي فواتير');
    }

    res.redirect('/dashboard');
  } catch (error) {
    console.error('Bulk mark paid error:', error);
    req.flash('error', 'حدث خطأ أثناء تحديث حالة الدفع');
    res.redirect('/dashboard');
  }
});

export default router;