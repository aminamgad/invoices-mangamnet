import express from 'express';
import mongoose from 'mongoose';
import Invoice from '../models/Invoice.js';
import Client from '../models/Client.js';
import Company from '../models/Company.js';
import File from '../models/File.js';
import User from '../models/User.js';
import { requireAuth } from '../middleware/auth.js';

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
    
    // Get date filter parameter
    const filter = req.query.filter || 'current_month';
    
    // Calculate date range based on filter
    let startDate, endDate;
    const now = new Date();
    
    // Helper function to create date at start of day in local timezone
    const createStartOfDay = (year, month, day) => {
      const date = new Date(year, month, day);
      return date;
    };
    
    // Helper function to create date at end of day in local timezone
    const createEndOfDay = (year, month, day) => {
      const date = new Date(year, month, day, 23, 59, 59, 999);
      return date;
    };
    
    switch (filter) {
      case 'previous_month':
        // Previous month: from 1st of previous month to last day of previous month
        startDate = createStartOfDay(now.getFullYear(), now.getMonth() - 1, 1);
        endDate = createEndOfDay(now.getFullYear(), now.getMonth(), 0);
        break;
      case 'last_4_months':
        // Last 4 months: from 4 months ago to end of current month
        startDate = createStartOfDay(now.getFullYear(), now.getMonth() - 4, 1);
        endDate = createEndOfDay(now.getFullYear(), now.getMonth() + 1, 0);
        break;
      case 'current_month':
      default:
        // Current month: from 1st of current month to last day of current month
        startDate = createStartOfDay(now.getFullYear(), now.getMonth(), 1);
        endDate = createEndOfDay(now.getFullYear(), now.getMonth() + 1, 0);
        break;
    }
    
    // Always apply date filtering
    const applyDateFilter = true;
    
    // Add debugging to see the date range
    console.log('Date Filter Debug:', {
      filter,
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      startDateLocal: startDate.toLocaleDateString('ar-EG'),
      endDateLocal: endDate.toLocaleDateString('ar-EG'),
      startDateUTC: startDate.toUTCString(),
      endDateUTC: endDate.toUTCString()
    });
    
    // Get admin IDs for filtering (needed for both admin and distributor views)
    const adminUsers = await User.find({ role: 'admin' }).select('_id');
    const adminIds = adminUsers.map(user => user._id);
    
    // Get dashboard statistics
    const stats = {
      totalInvoices: 0,
      totalClients: 0,
      totalCompanies: 0,
      totalFiles: 0,
      totalDistributors: 0,
      totalInvoicesAmount: 0,
      totalTax: 0,
      managementProfitTax: 0,
      recentInvoices: [],
      bulkPaymentData: {
        clients: [],
        distributors: [],
        companies: []
      }
    };

    if (user.role === 'admin') {
      // Debug: Check total invoices without date filter
      const totalInvoicesNoFilter = await Invoice.countDocuments({ createdBy: user.id });
      console.log('Total invoices (no filter):', totalInvoicesNoFilter);
      
      // Count only invoices created by admin within the date range
      const invoiceQuery = { createdBy: user.id };
      if (applyDateFilter) {
        invoiceQuery.createdAt = { $gte: startDate, $lte: endDate };
      }
      stats.totalInvoices = await Invoice.countDocuments(invoiceQuery);
      
      console.log('Total invoices (with filter):', stats.totalInvoices);
      
          // Calculate total invoices amount
    const invoicesForAmount = await Invoice.find(invoiceQuery).select('total');
    stats.totalInvoicesAmount = invoicesForAmount.reduce((sum, invoice) => sum + (invoice.total || 0), 0);
      
      // Calculate total tax (assuming 14% VAT)
      stats.totalTax = stats.totalInvoicesAmount * 0.14;
      
      // Calculate management and profit tax (assuming 2.5% for management)
      stats.managementProfitTax = stats.totalInvoicesAmount * 0.025;
      
      // Debug: Check some sample invoices to see their dates
      const sampleInvoices = await Invoice.find({ createdBy: user.id }).limit(3).select('createdAt');
      console.log('Sample invoice dates:', sampleInvoices.map(inv => inv.createdAt));
      
      // Debug: Check invoices from last 30 days
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const recentInvoices = await Invoice.countDocuments({ 
        createdBy: user.id,
        createdAt: { $gte: thirtyDaysAgo }
      });
      console.log('Invoices from last 30 days:', recentInvoices);
      
      // Debug: Test the exact date range query
      const testQuery = {
        createdBy: user.id,
        createdAt: { $gte: startDate, $lte: endDate }
      };
      console.log('Test query:', JSON.stringify(testQuery, null, 2));
      
      // Test with date strings as well
      const testQueryWithStrings = {
        createdBy: user.id,
        createdAt: { 
          $gte: startDate.toISOString(), 
          $lte: endDate.toISOString() 
        }
      };
      console.log('Test query with strings:', JSON.stringify(testQueryWithStrings, null, 2));
      const testCountWithStrings = await Invoice.countDocuments(testQueryWithStrings);
      console.log('Count with date strings:', testCountWithStrings);
      
      // Test with a simple date range (last 7 days)
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      const simpleQuery = {
        createdBy: user.id,
        createdAt: { $gte: sevenDaysAgo }
      };
      const simpleCount = await Invoice.countDocuments(simpleQuery);
      console.log('Invoices from last 7 days (simple query):', simpleCount);
      
      // Get a few sample invoices to see their actual dates
      const sampleInvoicesWithDates = await Invoice.find({ createdBy: user.id })
        .limit(5)
        .select('createdAt')
        .sort({ createdAt: -1 });
      
      console.log('Sample invoices with dates:');
      sampleInvoicesWithDates.forEach((inv, index) => {
        console.log(`Invoice ${index + 1}:`, {
          createdAt: inv.createdAt,
          createdAtISO: inv.createdAt.toISOString(),
          createdAtLocal: inv.createdAt.toLocaleDateString('ar-EG'),
          isInRange: inv.createdAt >= startDate && inv.createdAt <= endDate
        });
      });
      
      // Test with a broader date range to see if we can find any invoices
      const broadStartDate = new Date(now.getFullYear(), 0, 1); // Start of year
      const broadEndDate = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999); // End of year
      const broadQuery = {
        createdBy: user.id,
        createdAt: { $gte: broadStartDate, $lte: broadEndDate }
      };
      const broadCount = await Invoice.countDocuments(broadQuery);
      console.log('Invoices from this year (broad range):', broadCount);
      console.log('Broad query:', JSON.stringify(broadQuery, null, 2));
      
      // Check the actual date range of all invoices
      const dateRangeResult = await Invoice.aggregate([
        { $match: { createdBy: new mongoose.Types.ObjectId(user.id) } },
        {
          $group: {
            _id: null,
            earliestDate: { $min: '$createdAt' },
            latestDate: { $max: '$createdAt' },
            totalCount: { $sum: 1 }
          }
        }
      ]);
      
      if (dateRangeResult.length > 0) {
        console.log('Invoice date range:', {
          earliestDate: dateRangeResult[0].earliestDate,
          latestDate: dateRangeResult[0].latestDate,
          totalCount: dateRangeResult[0].totalCount
        });
      }
      const clientQuery = {};
      const companyQuery = {};
      const fileQuery = {};
      const distributorQuery = { role: 'distributor' };
      
      if (applyDateFilter) {
        clientQuery.createdAt = { $gte: startDate, $lte: endDate };
        companyQuery.createdAt = { $gte: startDate, $lte: endDate };
        fileQuery.createdAt = { $gte: startDate, $lte: endDate };
        distributorQuery.createdAt = { $gte: startDate, $lte: endDate };
      }
      
      stats.totalClients = await Client.countDocuments(clientQuery);
      stats.totalCompanies = await Company.countDocuments(companyQuery);
      stats.totalFiles = await File.countDocuments(fileQuery);
      stats.totalDistributors = await User.countDocuments(distributorQuery);
      
      // Show only recent invoices created by admin within the date range
      const recentInvoicesQuery = { createdBy: user.id };
      if (applyDateFilter) {
        recentInvoicesQuery.createdAt = { $gte: startDate, $lte: endDate };
      }
      stats.recentInvoices = await Invoice.find(recentInvoicesQuery)
        .populate('client', 'fullName')
        .populate('file', 'fileName')
        .populate('assignedDistributor', 'username')
        .sort({ createdAt: -1 })
        .limit(5);

      // Get bulk payment data for admin
      // Distributors with unpaid invoices (ready for distributorToAdmin payment)
      // Show only unpaid admin-created invoices within the date range
      const distributorMatch = {
        createdBy: new mongoose.Types.ObjectId(user.id), // Only invoices created by admin
        'paymentStatus.distributorToAdmin.isPaid': false, // Only unpaid invoices
        // Ensure it's not created by distributors
        $expr: {
          $eq: [
            { $type: "$createdBy" },
            "objectId"
          ]
        }
      };
      
      if (applyDateFilter) {
        distributorMatch.createdAt = { $gte: startDate, $lte: endDate };
      }
      
      const distributorsWithUnpaid = await Invoice.aggregate([
        {
          $match: distributorMatch
        },
        {
          $group: {
            _id: '$assignedDistributor',
            count: { $sum: 1 },
            totalAmount: { $sum: '$total' }
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
            distributorWhatsapp: '$distributor.whatsappNumber',
            unpaidCount: '$count',
            totalAmount: '$totalAmount'
          }
        }
      ]);

      // Companies with unpaid invoices (ready for adminToCompany payment)
      // Show only unpaid admin-created invoices within the date range
      const companyMatch = {
        createdBy: new mongoose.Types.ObjectId(user.id), // Only invoices created by admin
        'paymentStatus.adminToCompany.isPaid': false, // Only unpaid invoices
        // Ensure it's not created by distributors
        $expr: {
          $eq: [
            { $type: "$createdBy" },
            "objectId"
          ]
        }
      };
      
      if (applyDateFilter) {
        companyMatch.createdAt = { $gte: startDate, $lte: endDate };
      }
      
      const companiesWithUnpaid = await Invoice.aggregate([
        {
          $match: companyMatch
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
            totalAmount: { $sum: '$total' }
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

      console.log('Bulk payment data for admin:', {
        distributors: distributorsWithUnpaid.length,
        companies: companiesWithUnpaid.length,
        distributorsData: distributorsWithUnpaid,
        companiesData: companiesWithUnpaid
      });
      
      stats.bulkPaymentData.distributors = distributorsWithUnpaid;
      stats.bulkPaymentData.companies = companiesWithUnpaid;

      // Get all admin-created invoices for management within the date range
      const allAdminInvoicesQuery = { createdBy: user.id };
      if (applyDateFilter) {
        allAdminInvoicesQuery.createdAt = { $gte: startDate, $lte: endDate };
      }
      const allAdminInvoices = await Invoice.find(allAdminInvoicesQuery)
        .populate('client', 'fullName')
        .populate('file', 'fileName')
        .populate('assignedDistributor', 'username')
        .sort({ createdAt: -1 })
        .limit(10);

      stats.allAdminInvoices = allAdminInvoices || [];

    } else {
      // Distributor dashboard - exclude invoices created by admin
      const distributorInvoiceQuery = { 
        assignedDistributor: user.id,
        createdBy: { $nin: adminIds } // Exclude admin-created invoices
      };
      
      if (applyDateFilter) {
        distributorInvoiceQuery.createdAt = { $gte: startDate, $lte: endDate };
      }
      
      stats.totalInvoices = await Invoice.countDocuments(distributorInvoiceQuery);
      
      // Calculate total invoices amount for distributor
      const distributorInvoicesForAmount = await Invoice.find(distributorInvoiceQuery).select('total');
      stats.totalInvoicesAmount = distributorInvoicesForAmount.reduce((sum, invoice) => sum + (invoice.total || 0), 0);
      
      // Calculate total tax (assuming 14% VAT)
      stats.totalTax = stats.totalInvoicesAmount * 0.14;
      
      // Calculate management and profit tax (assuming 2.5% for management)
      stats.managementProfitTax = stats.totalInvoicesAmount * 0.025;
      
      stats.recentInvoices = await Invoice.find(distributorInvoiceQuery)
        .populate('client', 'fullName')
        .populate('file', 'fileName')
        .sort({ createdAt: -1 })
        .limit(5);

      // Get bulk payment data for distributor
      // Clients with unpaid invoices (ready for clientToDistributor payment)
      const clientMatch = {
        assignedDistributor: new mongoose.Types.ObjectId(user.id),
        'paymentStatus.clientToDistributor.isPaid': false,
        createdBy: { $nin: adminIds } // Exclude admin-created invoices
      };
      
      if (applyDateFilter) {
        clientMatch.createdAt = { $gte: startDate, $lte: endDate };
      }
      
      const clientsWithUnpaid = await Invoice.aggregate([
        {
          $match: clientMatch
        },
        {
          $group: {
            _id: '$client',
            count: { $sum: 1 },
            totalAmount: { $sum: '$total' }
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

    // Get last 30 unpaid invoices for all users
    const unpaidInvoicesQuery = {
      $or: [
        { 'paymentStatus.clientToDistributor.isPaid': false },
        { 'paymentStatus.distributorToAdmin.isPaid': false },
        { 'paymentStatus.adminToCompany.isPaid': false }
      ]
    };

    if (applyDateFilter) {
      unpaidInvoicesQuery.createdAt = { $gte: startDate, $lte: endDate };
    }

    // Add role-based filtering
    if (user.role === 'distributor') {
      unpaidInvoicesQuery.assignedDistributor = new mongoose.Types.ObjectId(user.id);
      unpaidInvoicesQuery.createdBy = { $nin: adminIds };
    } else if (user.role === 'admin') {
      // Admin can see all unpaid invoices
    }

    const unpaidInvoices = await Invoice.find(unpaidInvoicesQuery)
      .populate('client', 'fullName')
      .populate('assignedDistributor', 'username')
      .sort({ createdAt: -1 })
      .limit(30);

    // Format unpaid invoices for display
    stats.unpaidInvoices = (unpaidInvoices || []).map(invoice => {
      const isClientToDistributorUnpaid = !invoice.paymentStatus.clientToDistributor.isPaid;
      const isDistributorToAdminUnpaid = !invoice.paymentStatus.distributorToAdmin.isPaid;
      const isAdminToCompanyUnpaid = !invoice.paymentStatus.adminToCompany.isPaid;

      let status = 'مدفوعة';
      let statusClass = 'badge bg-success';

      if (isAdminToCompanyUnpaid) {
        status = 'انتظار';
        statusClass = 'badge bg-warning';
      } else if (isDistributorToAdminUnpaid) {
        status = 'انتظار';
        statusClass = 'badge bg-warning';
      } else if (isClientToDistributorUnpaid) {
        status = 'انتظار';
        statusClass = 'badge bg-warning';
      }

      return {
        _id: invoice._id,
        code: invoice.code,
        clientName: invoice.client?.fullName || 'غير محدد',
        distributorName: invoice.assignedDistributor?.username || 'غير محدد',
        companyName: 'غير محدد', // Company field not available in Invoice schema
        totalAmount: invoice.total,
        taxAmount: invoice.total * 0.14,
        companyAmount: invoice.total * 0.86,
        profitAmount: invoice.total * 0.025,
        status: status,
        statusClass: statusClass,
        createdAt: invoice.createdAt
      };
    });

    res.render('dashboard/index', { stats, currentUser: user, filter });
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
        totalInvoicesAmount: 0,
        totalTax: 0,
        managementProfitTax: 0,
        recentInvoices: [],
        allAdminInvoices: [],
        unpaidInvoices: [],
        bulkPaymentData: {
          clients: [],
          distributors: [],
          companies: []
        }
      }, 
      currentUser: req.session.user || {},
      filter: req.query.filter || 'current_month'
    });
  }
});



export default router;