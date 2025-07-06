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

export default mongoose.model('Invoice', invoiceSchema);