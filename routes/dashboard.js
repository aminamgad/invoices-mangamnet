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
      recentInvoices: [],
      bulkPaymentData: {
        clients: [],
        distributors: [],
        companies: []
      }
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

      // Get bulk payment data for admin
      // Distributors with unpaid invoices (ready for distributorToAdmin payment)
      const distributorsWithUnpaid = await Invoice.aggregate([
        {
          $match: {
            'paymentStatus.clientToDistributor.isPaid': true,
            'paymentStatus.distributorToAdmin.isPaid': false
          }
        },
        {
          $group: {
            _id: '$assignedDistributor',
            count: { $sum: 1 },
            totalAmount: { $sum: '$amount' }
          }
        },
        {
          $lookup: {
            from: 'users',
            localField: '_id',
            foreignField: '_id',
            as: 'distributor'
          }
        },
        {
          $unwind: '$distributor'
        },
        {
          $project: {
            distributorId: '$_id',
            distributorName: '$distributor.username',
            unpaidCount: '$count',
            totalAmount: '$totalAmount'
          }
        }
      ]);

      // Companies with unpaid invoices (ready for adminToCompany payment)
      const companiesWithUnpaid = await Invoice.aggregate([
        {
          $match: {
            'paymentStatus.distributorToAdmin.isPaid': true,
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
          $lookup: {
            from: 'companies',
            localField: 'fileData.company',
            foreignField: '_id',
            as: 'company'
          }
        },
        {
          $unwind: '$company'
        },
        {
          $group: {
            _id: '$company._id',
            companyName: { $first: '$company.name' },
            count: { $sum: 1 },
            totalAmount: { $sum: '$amount' }
          }
        },
        {
          $project: {
            companyId: '$_id',
            companyName: '$companyName',
            unpaidCount: '$count',
            totalAmount: '$totalAmount'
          }
        }
      ]);

      stats.bulkPaymentData.distributors = distributorsWithUnpaid;
      stats.bulkPaymentData.companies = companiesWithUnpaid;

    } else {
      // Distributor dashboard
      stats.totalInvoices = await Invoice.countDocuments({ assignedDistributor: user.id });
      stats.recentInvoices = await Invoice.find({ assignedDistributor: user.id })
        .populate('client', 'fullName')
        .populate('file', 'fileName')
        .sort({ createdAt: -1 })
        .limit(5);

      // Get bulk payment data for distributor
      // Clients with unpaid invoices (ready for clientToDistributor payment)
      const clientsWithUnpaid = await Invoice.aggregate([
        {
          $match: {
            assignedDistributor: user.id,
            'paymentStatus.clientToDistributor.isPaid': false
          }
        },
        {
          $group: {
            _id: '$client',
            count: { $sum: 1 },
            totalAmount: { $sum: '$amount' }
          }
        },
        {
          $lookup: {
            from: 'clients',
            localField: '_id',
            foreignField: '_id',
            as: 'client'
          }
        },
        {
          $unwind: '$client'
        },
        {
          $project: {
            clientId: '$_id',
            clientName: '$client.fullName',
            unpaidCount: '$count',
            totalAmount: '$totalAmount'
          }
        }
      ]);

      stats.bulkPaymentData.clients = clientsWithUnpaid;
    }

    res.render('dashboard/index', { stats, user });
  } catch (error) {
    console.error('Dashboard error:', error);
    req.flash('error', 'حدث خطأ أثناء تحميل لوحة التحكم');
    res.render('dashboard/index', { 
      stats: {
        bulkPaymentData: {
          clients: [],
          distributors: [],
          companies: []
        }
      }, 
      user: req.session.user 
    });
  }
});

export default router;