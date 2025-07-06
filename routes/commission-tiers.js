import express from 'express';
import CommissionTier from '../models/CommissionTier.js';
import Company from '../models/Company.js';
import Client from '../models/Client.js';
import User from '../models/User.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

const router = express.Router();

// List commission tiers
router.get('/', requireAuth, async (req, res) => {
  try {
    const { entityType, entityId } = req.query;
    
    let query = {};
    if (entityType) query.entityType = entityType;
    if (entityId) query.entityId = entityId;
    
    const tiers = await CommissionTier.find(query)
      .populate('entityId')
      .populate('createdBy', 'username')
      .sort({ entityType: 1, minAmount: 1 });
    
    // Get entities for the form
    const companies = await Company.find().sort({ name: 1 });
    const clients = await Client.find().sort({ fullName: 1 });
    const distributors = await User.find({ role: 'distributor' }).sort({ username: 1 });
    
    res.render('commission-tiers/index', { 
      tiers, 
      companies, 
      clients, 
      distributors,
      selectedEntityType: entityType,
      selectedEntityId: entityId
    });
  } catch (error) {
    req.flash('error', 'حدث خطأ أثناء تحميل مستويات العمولة');
    res.render('commission-tiers/index', { 
      tiers: [], 
      companies: [], 
      clients: [], 
      distributors: [],
      selectedEntityType: null,
      selectedEntityId: null
    });
  }
});

// New commission tier form
router.get('/new', requireAuth, async (req, res) => {
  try {
    const companies = await Company.find().sort({ name: 1 });
    const clients = await Client.find().sort({ fullName: 1 });
    const distributors = await User.find({ role: 'distributor' }).sort({ username: 1 });
    
    res.render('commission-tiers/new', { companies, clients, distributors });
  } catch (error) {
    req.flash('error', 'حدث خطأ أثناء تحميل البيانات');
    res.redirect('/commission-tiers');
  }
});

// Create commission tier
router.post('/', requireAuth, async (req, res) => {
  try {
    const { entityType, entityId, minAmount, maxAmount, commissionRate } = req.body;
    
    // Validate amount range
    if (parseFloat(minAmount) >= parseFloat(maxAmount)) {
      req.flash('error', 'الحد الأدنى يجب أن يكون أقل من الحد الأقصى');
      return res.redirect('/commission-tiers/new');
    }
    
    // Check for overlapping ranges
    const overlapping = await CommissionTier.findOne({
      entityType,
      entityId,
      isActive: true,
      $or: [
        {
          minAmount: { $lte: parseFloat(maxAmount) },
          maxAmount: { $gte: parseFloat(minAmount) }
        }
      ]
    });
    
    if (overlapping) {
      req.flash('error', 'يوجد تداخل في النطاقات مع مستوى عمولة موجود');
      return res.redirect('/commission-tiers/new');
    }
    
    // Determine entity model
    let entityModel;
    switch (entityType) {
      case 'company':
        entityModel = 'Company';
        break;
      case 'client':
        entityModel = 'Client';
        break;
      case 'distributor':
        entityModel = 'User';
        break;
      default:
        req.flash('error', 'نوع الكيان غير صحيح');
        return res.redirect('/commission-tiers/new');
    }
    
    const tier = new CommissionTier({
      entityType,
      entityId,
      entityModel,
      minAmount: parseFloat(minAmount),
      maxAmount: parseFloat(maxAmount),
      commissionRate: parseFloat(commissionRate),
      createdBy: req.session.user.id
    });
    
    await tier.save();
    req.flash('success', 'تم إضافة مستوى العمولة بنجاح');
    res.redirect('/commission-tiers');
  } catch (error) {
    req.flash('error', 'حدث خطأ أثناء إضافة مستوى العمولة');
    res.redirect('/commission-tiers/new');
  }
});

// Edit commission tier form
router.get('/:id/edit', requireAuth, async (req, res) => {
  try {
    const tier = await CommissionTier.findById(req.params.id).populate('entityId');
    if (!tier) {
      req.flash('error', 'مستوى العمولة غير موجود');
      return res.redirect('/commission-tiers');
    }
    
    const companies = await Company.find().sort({ name: 1 });
    const clients = await Client.find().sort({ fullName: 1 });
    const distributors = await User.find({ role: 'distributor' }).sort({ username: 1 });
    
    res.render('commission-tiers/edit', { tier, companies, clients, distributors });
  } catch (error) {
    req.flash('error', 'حدث خطأ أثناء تحميل بيانات مستوى العمولة');
    res.redirect('/commission-tiers');
  }
});

// Update commission tier
router.put('/:id', requireAuth, async (req, res) => {
  try {
    const { minAmount, maxAmount, commissionRate, isActive } = req.body;
    
    // Validate amount range
    if (parseFloat(minAmount) >= parseFloat(maxAmount)) {
      req.flash('error', 'الحد الأدنى يجب أن يكون أقل من الحد الأقصى');
      return res.redirect(`/commission-tiers/${req.params.id}/edit`);
    }
    
    const tier = await CommissionTier.findById(req.params.id);
    if (!tier) {
      req.flash('error', 'مستوى العمولة غير موجود');
      return res.redirect('/commission-tiers');
    }
    
    // Check for overlapping ranges (excluding current tier)
    const overlapping = await CommissionTier.findOne({
      _id: { $ne: req.params.id },
      entityType: tier.entityType,
      entityId: tier.entityId,
      isActive: true,
      $or: [
        {
          minAmount: { $lte: parseFloat(maxAmount) },
          maxAmount: { $gte: parseFloat(minAmount) }
        }
      ]
    });
    
    if (overlapping) {
      req.flash('error', 'يوجد تداخل في النطاقات مع مستوى عمولة موجود');
      return res.redirect(`/commission-tiers/${req.params.id}/edit`);
    }
    
    await CommissionTier.findByIdAndUpdate(req.params.id, {
      minAmount: parseFloat(minAmount),
      maxAmount: parseFloat(maxAmount),
      commissionRate: parseFloat(commissionRate),
      isActive: isActive === 'on'
    });
    
    req.flash('success', 'تم تحديث مستوى العمولة بنجاح');
    res.redirect('/commission-tiers');
  } catch (error) {
    req.flash('error', 'حدث خطأ أثناء تحديث مستوى العمولة');
    res.redirect('/commission-tiers');
  }
});

// Delete commission tier
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    await CommissionTier.findByIdAndDelete(req.params.id);
    req.flash('success', 'تم حذف مستوى العمولة بنجاح');
    res.redirect('/commission-tiers');
  } catch (error) {
    req.flash('error', 'حدث خطأ أثناء حذف مستوى العمولة');
    res.redirect('/commission-tiers');
  }
});

export default router;