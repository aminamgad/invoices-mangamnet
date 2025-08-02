import express from 'express';
import Client from '../models/Client.js';
import Invoice from '../models/Invoice.js';
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
    
    // Get clients with invoice count for sorting
    const clients = await Client.aggregate([
      { $match: query },
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
        $lookup: {
          from: 'users',
          localField: 'createdBy',
          foreignField: '_id',
          as: 'createdBy'
        }
      },
      {
        $unwind: {
          path: '$createdBy',
          preserveNullAndEmptyArrays: true
        }
      },
      {
        $sort: { invoiceCount: -1, createdAt: -1 }
      }
    ]);
    
    res.render('clients/index', { 
      clients,
      userPermissions: req.userPermissionLevel || {}
    });
  } catch (error) {
    console.error('Clients list error:', error);
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
    const { fullName, mobileNumber, whatsappNumber, notes, commissionRate } = req.body;
    
    // Add +20 prefix to WhatsApp number if provided
    const formattedWhatsappNumber = whatsappNumber ? `+20${whatsappNumber.replace(/^\+20/, '')}` : '';
    
    const client = new Client({
      fullName,
      mobileNumber,
      whatsappNumber: formattedWhatsappNumber,
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
    const { fullName, mobileNumber, whatsappNumber, notes, commissionRate } = req.body;
    
    // Add +20 prefix to WhatsApp number if provided
    const formattedWhatsappNumber = whatsappNumber ? `+20${whatsappNumber.replace(/^\+20/, '')}` : '';
    
    let query = { _id: req.params.id };
    
    // If user can only view own, ensure they own this client
    if (!req.userPermissionLevel?.canViewAll && req.userPermissionLevel?.canViewOwn) {
      query.createdBy = req.session.user.id;
    }
    
    const result = await Client.updateOne(query, {
      fullName,
      mobileNumber,
      whatsappNumber: formattedWhatsappNumber,
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

// View client details
router.get('/:id', requireModuleAccess('clients'), async (req, res) => {
  try {
    let query = { _id: req.params.id };
    
    // If user can only view own, ensure they own this client
    if (!req.userPermissionLevel?.canViewAll && req.userPermissionLevel?.canViewOwn) {
      query.createdBy = req.session.user.id;
    }
    
    const client = await Client.findOne(query).populate('createdBy', 'username');
    if (!client) {
      req.flash('error', 'العميل غير موجود أو ليس لديك صلاحية للوصول إليه');
      return res.redirect('/clients');
    }
    
    // Get client's invoices
    const invoices = await Invoice.find({ client: client._id })
      .populate('file', 'fileName')
      .populate('assignedDistributor', 'username')
      .sort({ createdAt: -1 })
      .limit(10);
    
    // Calculate statistics
    const totalInvoices = await Invoice.countDocuments({ client: client._id });
    const totalAmount = await Invoice.aggregate([
      { $match: { client: client._id } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);
    
    const completedInvoices = await Invoice.countDocuments({ 
      client: client._id, 
      'paymentStatus.adminToCompany.isPaid': true 
    });
    
    res.render('clients/details', { 
      client,
      invoices,
      stats: {
        totalInvoices,
        totalAmount: totalAmount[0]?.total || 0,
        completedInvoices,
        pendingInvoices: totalInvoices - completedInvoices
      },
      userPermissions: req.userPermissionLevel
    });
  } catch (error) {
    console.error('Client details error:', error);
    req.flash('error', 'حدث خطأ أثناء تحميل تفاصيل العميل');
    res.redirect('/clients');
  }
});

// API endpoint to search clients (for dropdown)
router.get('/api/search', requireModuleAccess('clients'), async (req, res) => {
  try {
    const { q } = req.query;
    let query = {};
    
    console.log('Client search request:', { q, user: req.session.user.id });
    
    // If user can only view own, filter by creator
    if (!req.userPermissionLevel.canViewAll && req.userPermissionLevel.canViewOwn) {
      query.createdBy = req.session.user.id;
    }
    
    // Search by name or mobile number
    if (q && q.trim()) {
      query.$or = [
        { fullName: { $regex: q, $options: 'i' } },
        { mobileNumber: { $regex: q, $options: 'i' } }
      ];
    }
    
    console.log('Client search query:', query);
    
    const clients = await Client.find(query)
      .select('fullName mobileNumber')
      .sort({ fullName: 1 })
      .limit(20);
    
    console.log('Client search results:', clients);
    
    res.json(clients);
  } catch (error) {
    console.error('Client search error:', error);
    res.status(500).json({ error: 'حدث خطأ أثناء البحث: ' + error.message });
  }
});

// API endpoint to create client via AJAX
router.post('/api/create', requirePermission('clients', 'create'), async (req, res) => {
  try {
    const { fullName, mobileNumber, whatsappNumber, notes, commissionRate } = req.body;
    
    // Check if client already exists
    const existingClient = await Client.findOne({ 
      $or: [
        { fullName: fullName.trim() },
        { mobileNumber: mobileNumber.trim() }
      ]
    });
    
    if (existingClient) {
      return res.status(400).json({ 
        error: 'العميل موجود بالفعل',
        existingClient: {
          _id: existingClient._id,
          fullName: existingClient.fullName,
          mobileNumber: existingClient.mobileNumber
        }
      });
    }
    
    // Add +20 prefix to WhatsApp number if provided
    const formattedWhatsappNumber = whatsappNumber ? `+20${whatsappNumber.replace(/^\+20/, '')}` : '';
    
    const client = new Client({
      fullName: fullName.trim(),
      mobileNumber: mobileNumber.trim(),
      whatsappNumber: formattedWhatsappNumber,
      notes: notes?.trim() || '',
      commissionRate: parseFloat(commissionRate) || 0,
      createdBy: req.session.user.id
    });
    
    await client.save();
    
    res.json({
      success: true,
      client: {
        _id: client._id,
        fullName: client.fullName,
        mobileNumber: client.mobileNumber
      }
    });
  } catch (error) {
    console.error('Client creation error:', error);
    res.status(500).json({ error: 'حدث خطأ أثناء إضافة العميل' });
  }
});

export default router;