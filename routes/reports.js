import express from 'express';
import Invoice from '../models/Invoice.js';
import Client from '../models/Client.js';
import File from '../models/File.js';
import User from '../models/User.js';
import Company from '../models/Company.js';
import { requireModuleAccess } from '../middleware/auth.js';

const router = express.Router();

// Helper function to get month start and end dates
function getMonthDateRange(monthString) {
  let year, month;
  
  if (monthString) {
    // Parse YYYY-MM format
    const [yearStr, monthStr] = monthString.split('-');
    year = parseInt(yearStr);
    month = parseInt(monthStr) - 1; // JavaScript months are 0-indexed
  } else {
    // Default to current month
    const now = new Date();
    year = now.getFullYear();
    month = now.getMonth();
  }
  
  const startDate = new Date(year, month, 1);
  const endDate = new Date(year, month + 1, 0, 23, 59, 59, 999); // Last day of month
  
  return { startDate, endDate, monthString: `${year}-${String(month + 1).padStart(2, '0')}` };
}

// Reports dashboard
router.get('/', requireModuleAccess('reports'), async (req, res) => {
  try {
    const {
      month, // New month parameter
      client,
      distributor,
      company,
      status,
      paymentStatus,
      minAmount,
      maxAmount,
      sortBy = 'invoiceDate',
      sortOrder = 'desc',
      page = 1,
      limit = 20
    } = req.query;

    // Get month date range
    const { startDate, endDate, monthString } = getMonthDateRange(month);

    // Build query
    let query = {};
    
    // Role-based filtering
    if (!req.userPermissionLevel.canViewAll && req.userPermissionLevel.canViewOwn) {
      query.assignedDistributor = req.session.user.id;
    }

    // Month filter (always applied)
    query.invoiceDate = {
      $gte: startDate,
      $lte: endDate
    };

    // Other filters
    if (client) query.client = client;
    if (distributor) query.assignedDistributor = distributor;
    if (status) query.status = status;

    // Payment status filter
    if (paymentStatus) {
      switch (paymentStatus) {
        case 'client_pending':
          query['paymentStatus.clientToDistributor.isPaid'] = false;
          break;
        case 'distributor_pending':
          query['paymentStatus.clientToDistributor.isPaid'] = true;
          query['paymentStatus.distributorToAdmin.isPaid'] = false;
          break;
        case 'admin_pending':
          query['paymentStatus.distributorToAdmin.isPaid'] = true;
          query['paymentStatus.adminToCompany.isPaid'] = false;
          break;
        case 'fully_completed':
          query['paymentStatus.adminToCompany.isPaid'] = true;
          break;
      }
    }

    // Amount range filter
    if (minAmount || maxAmount) {
      if (!query.amount) query.amount = {};
      if (minAmount) query.amount.$gte = parseFloat(minAmount);
      if (maxAmount) query.amount.$lte = parseFloat(maxAmount);
    }

    // Company filter (through file)
    let fileQuery = {};
    if (company) {
      fileQuery.company = company;
    }

    // Get total count for pagination
    const totalInvoices = await Invoice.countDocuments(query);
    const totalPages = Math.ceil(totalInvoices / limit);
    const currentPage = parseInt(page);

    // Get invoices with pagination
    let invoicesQuery = Invoice.find(query)
      .populate('client', 'fullName')
      .populate('file', 'fileName company')
      .populate('assignedDistributor', 'username')
      .populate('createdBy', 'username')
      .populate('paymentStatus.clientToDistributor.markedBy', 'username')
      .populate('paymentStatus.distributorToAdmin.markedBy', 'username')
      .populate('paymentStatus.adminToCompany.markedBy', 'username')
      .sort({ [sortBy]: sortOrder === 'desc' ? -1 : 1 })
      .skip((currentPage - 1) * limit)
      .limit(parseInt(limit));

    // Apply company filter if specified
    if (company) {
      invoicesQuery = invoicesQuery.populate({
        path: 'file',
        populate: {
          path: 'company',
          model: 'Company'
        },
        match: { company: company }
      });
    } else {
      invoicesQuery = invoicesQuery.populate({
        path: 'file',
        populate: {
          path: 'company',
          model: 'Company'
        }
      });
    }

    const invoices = await invoicesQuery;

    // Filter out invoices where company filter didn't match
    const filteredInvoices = company ? 
      invoices.filter(invoice => invoice.file && invoice.file.company && invoice.file.company._id.toString() === company) : 
      invoices;

    // Calculate profit statistics for the selected month
    const profitStats = await calculateProfitStats(query, company);

    // Get filter options
    const [clients, distributors, companies] = await Promise.all([
      Client.find().sort({ fullName: 1 }),
      User.find({ role: 'distributor' }).sort({ username: 1 }),
      Company.find().sort({ name: 1 })
    ]);

    // Generate month options for the dropdown
    const monthOptions = generateMonthOptions();

    res.render('reports/index', {
      invoices: filteredInvoices,
      profitStats,
      clients,
      distributors,
      companies,
      filters: {
        month: monthString,
        client,
        distributor,
        company,
        status,
        paymentStatus,
        minAmount,
        maxAmount,
        sortBy,
        sortOrder
      },
      pagination: {
        currentPage,
        totalPages,
        totalInvoices: filteredInvoices.length,
        limit: parseInt(limit)
      },
      userPermissions: req.userPermissionLevel,
      monthOptions,
      selectedMonth: monthString,
      monthName: getMonthName(monthString)
    });
  } catch (error) {
    console.error('Reports error:', error);
    req.flash('error', 'حدث خطأ أثناء تحميل التقارير');
    
    const { monthString } = getMonthDateRange();
    const monthOptions = generateMonthOptions();
    
    res.render('reports/index', {
      invoices: [],
      profitStats: {},
      clients: [],
      distributors: [],
      companies: [],
      filters: { month: monthString },
      pagination: {},
      userPermissions: req.userPermissionLevel || {},
      monthOptions,
      selectedMonth: monthString,
      monthName: getMonthName(monthString)
    });
  }
});

// Export reports data
router.get('/export', requireModuleAccess('reports'), async (req, res) => {
  try {
    const {
      month,
      client,
      distributor,
      company,
      status,
      paymentStatus,
      format = 'json'
    } = req.query;

    // Get month date range
    const { startDate, endDate } = getMonthDateRange(month);

    // Build query (same as above)
    let query = {};
    
    if (!req.userPermissionLevel.canViewAll && req.userPermissionLevel.canViewOwn) {
      query.assignedDistributor = req.session.user.id;
    }

    // Month filter (always applied)
    query.invoiceDate = {
      $gte: startDate,
      $lte: endDate
    };

    if (client) query.client = client;
    if (distributor) query.assignedDistributor = distributor;
    if (status) query.status = status;

    // Payment status filter
    if (paymentStatus) {
      switch (paymentStatus) {
        case 'client_pending':
          query['paymentStatus.clientToDistributor.isPaid'] = false;
          break;
        case 'distributor_pending':
          query['paymentStatus.clientToDistributor.isPaid'] = true;
          query['paymentStatus.distributorToAdmin.isPaid'] = false;
          break;
        case 'admin_pending':
          query['paymentStatus.distributorToAdmin.isPaid'] = true;
          query['paymentStatus.adminToCompany.isPaid'] = false;
          break;
        case 'fully_completed':
          query['paymentStatus.adminToCompany.isPaid'] = true;
          break;
      }
    }

    const invoices = await Invoice.find(query)
      .populate('client', 'fullName')
      .populate('file', 'fileName company')
      .populate('assignedDistributor', 'username')
      .populate('paymentStatus.clientToDistributor.markedBy', 'username')
      .populate('paymentStatus.distributorToAdmin.markedBy', 'username')
      .populate('paymentStatus.adminToCompany.markedBy', 'username')
      .populate({
        path: 'file',
        populate: {
          path: 'company',
          model: 'Company'
        }
      })
      .sort({ invoiceDate: -1 });

    // Filter by company if specified
    const filteredInvoices = company ? 
      invoices.filter(invoice => invoice.file && invoice.file.company && invoice.file.company._id.toString() === company) : 
      invoices;

    // Calculate detailed profit data
    const exportData = filteredInvoices.map(invoice => {
      const clientCommission = (invoice.amount * invoice.clientCommissionRate) / 100;
      const distributorCommission = (invoice.amount * invoice.distributorCommissionRate) / 100;
      const companyCommission = (invoice.amount * invoice.companyCommissionRate) / 100;
      const netProfit = invoice.amount - clientCommission - distributorCommission - companyCommission;

      // Determine payment status
      let paymentStatus = 'client_pending';
      if (invoice.paymentStatus.adminToCompany.isPaid) {
        paymentStatus = 'fully_completed';
      } else if (invoice.paymentStatus.distributorToAdmin.isPaid) {
        paymentStatus = 'admin_pending';
      } else if (invoice.paymentStatus.clientToDistributor.isPaid) {
        paymentStatus = 'distributor_pending';
      }

      return {
        invoiceCode: invoice.invoiceCode,
        clientName: invoice.client?.fullName || 'غير محدد',
        fileName: invoice.file?.fileName || 'غير محدد',
        companyName: invoice.file?.company?.name || 'غير محدد',
        distributorName: invoice.assignedDistributor?.username || 'غير محدد',
        amount: invoice.amount,
        clientCommissionRate: invoice.clientCommissionRate,
        clientCommission: clientCommission.toFixed(2),
        distributorCommissionRate: invoice.distributorCommissionRate,
        distributorCommission: distributorCommission.toFixed(2),
        companyCommissionRate: invoice.companyCommissionRate,
        companyCommission: companyCommission.toFixed(2),
        netProfit: netProfit.toFixed(2),
        status: invoice.status,
        paymentStatus: paymentStatus,
        clientToDistributorPaid: invoice.paymentStatus.clientToDistributor.isPaid,
        clientToDistributorPaidAt: invoice.paymentStatus.clientToDistributor.paidAt,
        distributorToAdminPaid: invoice.paymentStatus.distributorToAdmin.isPaid,
        distributorToAdminPaidAt: invoice.paymentStatus.distributorToAdmin.paidAt,
        adminToCompanyPaid: invoice.paymentStatus.adminToCompany.isPaid,
        adminToCompanyPaidAt: invoice.paymentStatus.adminToCompany.paidAt,
        invoiceDate: invoice.invoiceDate.toISOString().split('T')[0],
        createdAt: invoice.createdAt.toISOString()
      };
    });

    if (format === 'csv') {
      // Generate CSV
      const csv = generateCSV(exportData);
      const { monthString } = getMonthDateRange(month);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename=invoices-report-${monthString}.csv`);
      res.send('\uFEFF' + csv); // Add BOM for Arabic support
    } else {
      // Return JSON
      res.json({
        data: exportData,
        summary: await calculateProfitStats(query, company),
        month: getMonthDateRange(month).monthString
      });
    }
  } catch (error) {
    console.error('Export error:', error);
    res.status(500).json({ error: 'حدث خطأ أثناء تصدير البيانات' });
  }
});

// Helper function to calculate profit statistics
async function calculateProfitStats(query, companyFilter) {
  try {
    let invoices = await Invoice.find(query)
      .populate({
        path: 'file',
        populate: {
          path: 'company',
          model: 'Company'
        }
      });

    // Filter by company if specified
    if (companyFilter) {
      invoices = invoices.filter(invoice => 
        invoice.file && 
        invoice.file.company && 
        invoice.file.company._id.toString() === companyFilter
      );
    }

    const stats = {
      totalInvoices: invoices.length,
      totalAmount: 0,
      totalClientCommission: 0,
      totalDistributorCommission: 0,
      totalCompanyCommission: 0,
      totalNetProfit: 0,
      averageAmount: 0,
      averageNetProfit: 0,
      statusBreakdown: {
        pending: 0,
        completed: 0,
        cancelled: 0
      },
      paymentStatusBreakdown: {
        client_pending: 0,
        distributor_pending: 0,
        admin_pending: 0,
        fully_completed: 0
      },
      monthlyBreakdown: {}
    };

    invoices.forEach(invoice => {
      const clientCommission = (invoice.amount * invoice.clientCommissionRate) / 100;
      const distributorCommission = (invoice.amount * invoice.distributorCommissionRate) / 100;
      const companyCommission = (invoice.amount * invoice.companyCommissionRate) / 100;
      const netProfit = invoice.amount - clientCommission - distributorCommission - companyCommission;

      stats.totalAmount += invoice.amount;
      stats.totalClientCommission += clientCommission;
      stats.totalDistributorCommission += distributorCommission;
      stats.totalCompanyCommission += companyCommission;
      stats.totalNetProfit += netProfit;

      // Status breakdown
      stats.statusBreakdown[invoice.status]++;

      // Payment status breakdown
      let paymentStatus = 'client_pending';
      if (invoice.paymentStatus.adminToCompany.isPaid) {
        paymentStatus = 'fully_completed';
      } else if (invoice.paymentStatus.distributorToAdmin.isPaid) {
        paymentStatus = 'admin_pending';
      } else if (invoice.paymentStatus.clientToDistributor.isPaid) {
        paymentStatus = 'distributor_pending';
      }
      stats.paymentStatusBreakdown[paymentStatus]++;

      // Monthly breakdown
      const monthKey = invoice.invoiceDate.toISOString().substring(0, 7); // YYYY-MM
      if (!stats.monthlyBreakdown[monthKey]) {
        stats.monthlyBreakdown[monthKey] = {
          count: 0,
          amount: 0,
          netProfit: 0
        };
      }
      stats.monthlyBreakdown[monthKey].count++;
      stats.monthlyBreakdown[monthKey].amount += invoice.amount;
      stats.monthlyBreakdown[monthKey].netProfit += netProfit;
    });

    if (stats.totalInvoices > 0) {
      stats.averageAmount = stats.totalAmount / stats.totalInvoices;
      stats.averageNetProfit = stats.totalNetProfit / stats.totalInvoices;
    }

    // Round values
    stats.totalAmount = Math.round(stats.totalAmount * 100) / 100;
    stats.totalClientCommission = Math.round(stats.totalClientCommission * 100) / 100;
    stats.totalDistributorCommission = Math.round(stats.totalDistributorCommission * 100) / 100;
    stats.totalCompanyCommission = Math.round(stats.totalCompanyCommission * 100) / 100;
    stats.totalNetProfit = Math.round(stats.totalNetProfit * 100) / 100;
    stats.averageAmount = Math.round(stats.averageAmount * 100) / 100;
    stats.averageNetProfit = Math.round(stats.averageNetProfit * 100) / 100;

    return stats;
  } catch (error) {
    console.error('Profit stats calculation error:', error);
    return {};
  }
}

// Helper function to generate month options
function generateMonthOptions() {
  const options = [];
  const currentDate = new Date();
  
  // Generate last 12 months + current month + next 3 months
  for (let i = -12; i <= 3; i++) {
    const date = new Date(currentDate.getFullYear(), currentDate.getMonth() + i, 1);
    const monthString = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    const monthName = getMonthName(monthString);
    
    options.push({
      value: monthString,
      label: monthName,
      isCurrent: i === 0
    });
  }
  
  return options;
}

// Helper function to get month name in Arabic
function getMonthName(monthString) {
  const [year, month] = monthString.split('-');
  const monthNames = [
    'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
    'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'
  ];
  
  return `${monthNames[parseInt(month) - 1]} ${year}`;
}

// Helper function to generate CSV
function generateCSV(data) {
  if (data.length === 0) return '';

  const headers = [
    'رقم الفاتورة',
    'اسم العميل',
    'اسم الملف',
    'اسم الشركة',
    'اسم الموزع',
    'المبلغ',
    'نسبة عمولة العميل',
    'عمولة العميل',
    'نسبة عمولة الموزع',
    'عمولة الموزع',
    'نسبة عمولة الشركة',
    'عمولة الشركة',
    'صافي الربح',
    'الحالة',
    'حالة الدفع',
    'عميل→موزع مدفوع',
    'تاريخ دفع عميل→موزع',
    'موزع→إدارة مدفوع',
    'تاريخ دفع موزع→إدارة',
    'إدارة→شركة مدفوع',
    'تاريخ دفع إدارة→شركة',
    'تاريخ الفاتورة',
    'تاريخ الإنشاء'
  ];

  const csvContent = [
    headers.join(','),
    ...data.map(row => [
      `"${row.invoiceCode}"`,
      `"${row.clientName}"`,
      `"${row.fileName}"`,
      `"${row.companyName}"`,
      `"${row.distributorName}"`,
      row.amount,
      row.clientCommissionRate,
      row.clientCommission,
      row.distributorCommissionRate,
      row.distributorCommission,
      row.companyCommissionRate,
      row.companyCommission,
      row.netProfit,
      `"${row.status}"`,
      `"${row.paymentStatus}"`,
      row.clientToDistributorPaid,
      `"${row.clientToDistributorPaidAt || ''}"`,
      row.distributorToAdminPaid,
      `"${row.distributorToAdminPaidAt || ''}"`,
      row.adminToCompanyPaid,
      `"${row.adminToCompanyPaidAt || ''}"`,
      `"${row.invoiceDate}"`,
      `"${row.createdAt}"`
    ].join(','))
  ].join('\n');

  return csvContent;
}

export default router;