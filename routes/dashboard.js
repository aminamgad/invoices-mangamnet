import express from 'express';
import Invoice from '../models/Invoice.js';
import Client from '../models/Client.js';
import Company from '../models/Company.js';
import File from '../models/File.js';
import User from '../models/User.js';

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const user = req.session.user;
    
    // Get dashboard statistics
    const stats = {
      totalInvoices: 0,
      totalClients: 0,
      totalCompanies: 0,
      totalFiles: 0,
      totalDistributors: 0,
      recentInvoices: []
    };

    if (user.role === 'admin') {
      stats.totalInvoices = await Invoice.countDocuments();
      stats.totalClients = await Client.countDocuments();
      stats.totalCompanies = await Company.countDocuments();
      stats.totalFiles = await File.countDocuments();
      stats.totalDistributors = await User.countDocuments({ role: 'distributor' });
      
      stats.recentInvoices = await Invoice.find()
        .populate('client', 'fullName')
        .populate('file', 'fileName')
        .populate('assignedDistributor', 'username')
        .sort({ createdAt: -1 })
        .limit(5);
    } else {
      // Distributor dashboard
      stats.totalInvoices = await Invoice.countDocuments({ assignedDistributor: user.id });
      stats.recentInvoices = await Invoice.find({ assignedDistributor: user.id })
        .populate('client', 'fullName')
        .populate('file', 'fileName')
        .sort({ createdAt: -1 })
        .limit(5);
    }

    res.render('dashboard/index', { stats, user });
  } catch (error) {
    req.flash('error', 'حدث خطأ أثناء تحميل لوحة التحكم');
    res.render('dashboard/index', { stats: {}, user: req.session.user });
  }
});

export default router;