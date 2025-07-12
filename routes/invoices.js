import express from 'express';
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
    }
    
    const invoices = await Invoice.find(query)
      .populate('client', 'fullName')
      .populate('file', 'fileName')
      .populate('assignedDistributor', 'username')
      .populate('createdBy', 'username')
      .populate('paymentStatus.clientToDistributor.markedBy', 'username')
      .populate('paymentStatus.distributorToAdmin.markedBy', 'username')
      .populate('paymentStatus.adminToCompany.markedBy', 'username')
      .sort({ createdAt: -1 });
      
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
    // Get clients sorted by most used (invoice count)
    const clients = await Client.aggregate([
      {
        $lookup: {
          from: 'invoices',
          localField: '_id',
          foreignField: 'client',
          as: 'invoices'
        }
      },
      {
        $addFields: {
          invoiceCount: { $size: '$invoices' }
        }
      },
      {
        $sort: { invoiceCount: -1, fullName: 1 }
      }
    ]);
    
    // Get files sorted by most used (invoice count)
    const files = await File.aggregate([
      {
        $lookup: {
          from: 'invoices',
          localField: '_id',
          foreignField: 'file',
          as: 'invoices'
        }
      },
      {
        $addFields: {
          invoiceCount: { $size: '$invoices' }
        }
      },
      {
        $lookup: {
          from: 'companies',
          localField: 'company',
          foreignField: '_id',
          as: 'company'
        }
      },
      {
        $unwind: {
          path: '$company',
          preserveNullAndEmptyArrays: true
        }
      },
      {
        $sort: { invoiceCount: -1, fileName: 1 }
      }
    ]);
    
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
  try {
    const { distributorId } = req.params;
    
    // Only admin can use this endpoint
    if (req.session.user.role !== 'admin') {
      req.flash('error', 'ليس لديك صلاحية لتنفيذ هذا الإجراء');
      return res.redirect('/dashboard');
    }
    
    // Find all unpaid invoices for this distributor
    const invoices = await Invoice.find({
      assignedDistributor: distributorId,
      'paymentStatus.clientToDistributor.isPaid': true,
      'paymentStatus.distributorToAdmin.isPaid': false
    }).populate('assignedDistributor', 'username');
    
    if (invoices.length === 0) {
      req.flash('error', 'لا توجد فواتير جاهزة للدفع لهذا الموزع');
      return res.redirect('/dashboard');
    }
    
    // Mark all as paid
    let updatedCount = 0;
    for (const invoice of invoices) {
      invoice.markPaymentStep('distributorToAdmin', req.session.user.id);
      await invoice.save();
      updatedCount++;
    }
    
    const distributorName = invoices[0].assignedDistributor?.username || 'الموزع';
    req.flash('success', `تم تحديث ${updatedCount} فاتورة للموزع "${distributorName}" كمدفوعة`);
    res.redirect('/dashboard');
  } catch (error) {
    console.error('Bulk payment error:', error);
    req.flash('error', 'حدث خطأ أثناء تحديث حالة الدفع');
    res.redirect('/dashboard');
  }
});

// Bulk payment for company (admin only)
router.post('/bulk-pay/company/:companyId', requireModuleAccess('invoices'), async (req, res) => {
  try {
    const { companyId } = req.params;
    
    // Only admin can use this endpoint
    if (req.session.user.role !== 'admin') {
      req.flash('error', 'ليس لديك صلاحية لتنفيذ هذا الإجراء');
      return res.redirect('/dashboard');
    }
    
    // Find all unpaid invoices for this company
    const invoices = await Invoice.find({
      'paymentStatus.distributorToAdmin.isPaid': true,
      'paymentStatus.adminToCompany.isPaid': false
    }).populate({
      path: 'file',
      populate: {
        path: 'company',
        model: 'Company'
      }
    });
    
    // Filter by company
    const companyInvoices = invoices.filter(invoice => 
      invoice.file && 
      invoice.file.company && 
      invoice.file.company._id.toString() === companyId
    );
    
    if (companyInvoices.length === 0) {
      req.flash('error', 'لا توجد فواتير جاهزة للدفع لهذه الشركة');
      return res.redirect('/dashboard');
    }
    
    // Mark all as paid
    let updatedCount = 0;
    for (const invoice of companyInvoices) {
      invoice.markPaymentStep('adminToCompany', req.session.user.id);
      await invoice.save();
      updatedCount++;
    }
    
    const companyName = companyInvoices[0].file?.company?.name || 'الشركة';
    req.flash('success', `تم تحديث ${updatedCount} فاتورة للشركة "${companyName}" كمدفوعة`);
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

export default router;