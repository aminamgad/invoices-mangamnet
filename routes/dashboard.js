import express from 'express';
import mongoose from 'mongoose';
import Invoice from '../models/Invoice.js';
import Client from '../models/Client.js';
import Company from '../models/Company.js';
import File from '../models/File.js';
import User from '../models/User.js';

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const user = req.session.user;
    
    if (!user) {
      return res.redirect('/auth/login');
    }
    
    // Mobile test route
    if (req.query.test === 'mobile') {
      return res.render('dashboard/mobile-test', {
        title: 'اختبار الجوال',
        user: user
      });
    }
    
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
      // Count only invoices created by admin
      stats.totalInvoices = await Invoice.countDocuments({ createdBy: user.id });
      stats.totalClients = await Client.countDocuments();
      stats.totalCompanies = await Company.countDocuments();
      stats.totalFiles = await File.countDocuments();
      stats.totalDistributors = await User.countDocuments({ role: 'distributor' });
      
      // Show only recent invoices created by admin
      stats.recentInvoices = await Invoice.find({ createdBy: user.id })
        .populate('client', 'fullName')
        .populate('file', 'fileName')
        .populate('assignedDistributor', 'username')
        .sort({ createdAt: -1 })
        .limit(5);

      // Get bulk payment data for admin
      // Distributors with unpaid invoices (ready for distributorToAdmin payment)
      // Show only unpaid admin-created invoices
      const distributorsWithUnpaid = await Invoice.aggregate([
        {
          $match: {
            createdBy: new mongoose.Types.ObjectId(user.id), // Only invoices created by admin
            'paymentStatus.distributorToAdmin.isPaid': false, // Only unpaid invoices
            // Ensure it's not created by distributors
            $expr: {
              $eq: [
                { $type: "$createdBy" },
                "objectId"
              ]
            }
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
      // Show only unpaid admin-created invoices
      const companiesWithUnpaid = await Invoice.aggregate([
        {
          $match: {
            createdBy: new mongoose.Types.ObjectId(user.id), // Only invoices created by admin
            'paymentStatus.adminToCompany.isPaid': false, // Only unpaid invoices
            // Ensure it's not created by distributors
            $expr: {
              $eq: [
                { $type: "$createdBy" },
                "objectId"
              ]
            }
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

      // Get all admin-created invoices for management
      const allAdminInvoices = await Invoice.find({ createdBy: user.id })
        .populate('client', 'fullName')
        .populate('file', 'fileName')
        .populate('assignedDistributor', 'username')
        .sort({ createdAt: -1 })
        .limit(10);

      stats.allAdminInvoices = allAdminInvoices || [];

    } else {
      // Distributor dashboard - exclude invoices created by admin
      const adminUsers = await User.find({ role: 'admin' }).select('_id');
      const adminIds = adminUsers.map(user => user._id);
      
      stats.totalInvoices = await Invoice.countDocuments({ 
        assignedDistributor: user.id,
        createdBy: { $nin: adminIds } // Exclude admin-created invoices
      });
      
      stats.recentInvoices = await Invoice.find({ 
        assignedDistributor: user.id,
        createdBy: { $nin: adminIds } // Exclude admin-created invoices
      })
        .populate('client', 'fullName')
        .populate('file', 'fileName')
        .sort({ createdAt: -1 })
        .limit(5);

      // Get bulk payment data for distributor
      // Clients with unpaid invoices (ready for clientToDistributor payment)
      const clientsWithUnpaid = await Invoice.aggregate([
        {
          $match: {
            assignedDistributor: new mongoose.Types.ObjectId(user.id),
            'paymentStatus.clientToDistributor.isPaid': false,
            createdBy: { $nin: adminIds } // Exclude admin-created invoices
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
        totalInvoices: 0,
        totalClients: 0,
        totalCompanies: 0,
        totalFiles: 0,
        totalDistributors: 0,
        recentInvoices: [],
        allAdminInvoices: [],
        bulkPaymentData: {
          clients: [],
          distributors: [],
          companies: []
        }
      }, 
      user: req.session.user || {}
    });
  }
});

export default router;