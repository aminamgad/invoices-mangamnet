import express from 'express';
import Company from '../models/Company.js';
import File from '../models/File.js';
import Invoice from '../models/Invoice.js';
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
      userPermissions: req.userPermissionLevel || {}
    });
  } catch (error) {
    console.error('Companies list error:', error);
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

// View company details
router.get('/:id', requireModuleAccess('companies'), async (req, res) => {
  try {
    let query = { _id: req.params.id };
    
    // If user can only view own, ensure they own this company
    if (!req.userPermissionLevel?.canViewAll && req.userPermissionLevel?.canViewOwn) {
      query.createdBy = req.session.user.id;
    }
    
    const company = await Company.findOne(query).populate('createdBy', 'username');
    if (!company) {
      req.flash('error', 'الشركة غير موجودة أو ليس لديك صلاحية للوصول إليها');
      return res.redirect('/companies');
    }
    
    // Get company's files
    const files = await File.find({ company: company._id })
      .populate('createdBy', 'username')
      .sort({ createdAt: -1 })
      .limit(10);
    
    // Get company's invoices through files
    const invoices = await Invoice.find()
      .populate({
        path: 'file',
        match: { company: company._id },
        populate: {
          path: 'company',
          model: 'Company'
        }
      })
      .populate('client', 'fullName')
      .populate('assignedDistributor', 'username')
      .sort({ createdAt: -1 })
      .limit(10);
    
    // Filter out invoices where file doesn't match
    const filteredInvoices = invoices.filter(invoice => invoice.file && invoice.file.company);
    
    // Calculate statistics
    const totalFiles = await File.countDocuments({ company: company._id });
    const totalInvoices = await Invoice.countDocuments({
      file: { $in: await File.find({ company: company._id }).distinct('_id') }
    });
    
    const totalAmount = await Invoice.aggregate([
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
        $match: { 'fileData.company': company._id }
      },
      {
        $group: { _id: null, total: { $sum: '$amount' } }
      }
    ]);
    
    res.render('companies/details', { 
      company,
      files,
      invoices: filteredInvoices,
      stats: {
        totalFiles,
        totalInvoices,
        totalAmount: totalAmount[0]?.total || 0
      },
      userPermissions: req.userPermissionLevel
    });
  } catch (error) {
    console.error('Company details error:', error);
    req.flash('error', 'حدث خطأ أثناء تحميل تفاصيل الشركة');
    res.redirect('/companies');
  }
});

// API endpoint to get companies (for dropdown)
router.get('/api/list', requireModuleAccess('companies'), async (req, res) => {
  try {
    let query = {};
    
    // If user can only view own, filter by creator
    if (!req.userPermissionLevel.canViewAll && req.userPermissionLevel.canViewOwn) {
      query.createdBy = req.session.user.id;
    }
    
    const companies = await Company.find(query)
      .select('name')
      .sort({ name: 1 });
    
    res.json(companies);
  } catch (error) {
    console.error('Companies list error:', error);
    res.status(500).json({ error: 'حدث خطأ أثناء تحميل الشركات' });
  }
});

// API endpoint to search companies (for dropdown)
router.get('/api/search', requireModuleAccess('companies'), async (req, res) => {
  try {
    const { q } = req.query;
    let query = {};
    
    console.log('Company search request:', { q, user: req.session.user.id });
    
    // If user can only view own, filter by creator
    if (!req.userPermissionLevel.canViewAll && req.userPermissionLevel.canViewOwn) {
      query.createdBy = req.session.user.id;
    }
    
    // Search by name
    if (q && q.trim()) {
      query.name = { $regex: q, $options: 'i' };
    }
    
    console.log('Company search query:', query);
    
    const companies = await Company.find(query)
      .select('name')
      .sort({ name: 1 })
      .limit(20);
    
    console.log('Company search results:', companies);
    
    res.json(companies);
  } catch (error) {
    console.error('Company search error:', error);
    res.status(500).json({ error: 'حدث خطأ أثناء البحث: ' + error.message });
  }
});

// API endpoint to create company via AJAX
router.post('/api/create', requirePermission('companies', 'create'), async (req, res) => {
  try {
    const { name, notes } = req.body;
    
    // Check if company with same name already exists
    const existingCompany = await Company.findOne({ name: name.trim() });
    if (existingCompany) {
      return res.status(400).json({ 
        error: 'الشركة موجودة بالفعل',
        existingCompany: {
          _id: existingCompany._id,
          name: existingCompany.name
        }
      });
    }
    
    const company = new Company({
      name: name.trim(),
      notes: notes?.trim() || '',
      createdBy: req.session.user.id
    });
    
    await company.save();
    
    res.json({
      success: true,
      company: {
        _id: company._id,
        name: company.name
      }
    });
  } catch (error) {
    console.error('Company creation error:', error);
    res.status(500).json({ error: 'حدث خطأ أثناء إضافة الشركة' });
  }
});

export default router;