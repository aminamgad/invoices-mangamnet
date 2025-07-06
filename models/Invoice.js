import mongoose from 'mongoose';

const invoiceSchema = new mongoose.Schema({
  invoiceCode: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  client: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Client',
    required: true
  },
  file: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'File',
    required: true
  },
  assignedDistributor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  invoiceDate: {
    type: Date,
    required: true
  },
  amount: {
    type: Number,
    required: true,
    default: 0
  },
  clientCommissionRate: {
    type: Number,
    required: true
  },
  distributorCommissionRate: {
    type: Number,
    required: true
  },
  companyCommissionRate: {
    type: Number,
    default: 0
  },
  // Multi-step payment tracking
  paymentStatus: {
    clientToDistributor: {
      isPaid: {
        type: Boolean,
        default: false
      },
      paidAt: {
        type: Date,
        default: null
      },
      markedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null
      }
    },
    distributorToAdmin: {
      isPaid: {
        type: Boolean,
        default: false
      },
      paidAt: {
        type: Date,
        default: null
      },
      markedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null
      }
    },
    adminToCompany: {
      isPaid: {
        type: Boolean,
        default: false
      },
      paidAt: {
        type: Date,
        default: null
      },
      markedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null
      }
    }
  },
  // Legacy status for backward compatibility
  status: {
    type: String,
    enum: ['pending', 'completed', 'cancelled'],
    default: 'pending'
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }
}, {
  timestamps: true
});

// Virtual to get overall payment completion status
invoiceSchema.virtual('overallPaymentStatus').get(function() {
  const { clientToDistributor, distributorToAdmin, adminToCompany } = this.paymentStatus;
  
  if (adminToCompany.isPaid) {
    return 'fully_completed';
  } else if (distributorToAdmin.isPaid) {
    return 'admin_pending';
  } else if (clientToDistributor.isPaid) {
    return 'distributor_pending';
  } else {
    return 'client_pending';
  }
});

// Method to get payment progress percentage
invoiceSchema.methods.getPaymentProgress = function() {
  const { clientToDistributor, distributorToAdmin, adminToCompany } = this.paymentStatus;
  let completed = 0;
  
  if (clientToDistributor.isPaid) completed++;
  if (distributorToAdmin.isPaid) completed++;
  if (adminToCompany.isPaid) completed++;
  
  return Math.round((completed / 3) * 100);
};

// Method to check if user can mark a specific payment step
invoiceSchema.methods.canUserMarkPayment = function(userId, userRole, step) {
  // Admin can mark all steps
  if (userRole === 'admin') {
    return true;
  }
  
  // Distributor can only mark clientToDistributor step
  if (userRole === 'distributor' && step === 'clientToDistributor') {
    // Only the assigned distributor can mark this step
    return this.assignedDistributor.toString() === userId.toString();
  }
  
  return false;
};

// Method to mark a payment step as paid
invoiceSchema.methods.markPaymentStep = function(step, userId) {
  if (!this.paymentStatus[step]) {
    throw new Error('Invalid payment step');
  }
  
  this.paymentStatus[step].isPaid = true;
  this.paymentStatus[step].paidAt = new Date();
  this.paymentStatus[step].markedBy = userId;
  
  // Update legacy status for backward compatibility
  if (this.paymentStatus.adminToCompany.isPaid) {
    this.status = 'completed';
  }
};

// Method to unmark a payment step (admin only)
invoiceSchema.methods.unmarkPaymentStep = function(step) {
  if (!this.paymentStatus[step]) {
    throw new Error('Invalid payment step');
  }
  
  this.paymentStatus[step].isPaid = false;
  this.paymentStatus[step].paidAt = null;
  this.paymentStatus[step].markedBy = null;
  
  // Update legacy status
  this.status = 'pending';
};

export default mongoose.model('Invoice', invoiceSchema);