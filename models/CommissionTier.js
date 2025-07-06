import mongoose from 'mongoose';

const commissionTierSchema = new mongoose.Schema({
  entityType: {
    type: String,
    enum: ['company', 'client', 'distributor'],
    required: true
  },
  entityId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    refPath: 'entityModel'
  },
  entityModel: {
    type: String,
    required: true,
    enum: ['Company', 'Client', 'User']
  },
  minAmount: {
    type: Number,
    required: true,
    min: 0
  },
  maxAmount: {
    type: Number,
    required: true,
    min: 0
  },
  commissionRate: {
    type: Number,
    required: true,
    min: 0,
    max: 100
  },
  isActive: {
    type: Boolean,
    default: true
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }
}, {
  timestamps: true
});

// Ensure no overlapping ranges for the same entity
commissionTierSchema.index({ entityType: 1, entityId: 1, minAmount: 1, maxAmount: 1 }, { unique: true });

// Method to find applicable commission rate for an amount
commissionTierSchema.statics.findCommissionRate = async function(entityType, entityId, amount) {
  const tier = await this.findOne({
    entityType,
    entityId,
    minAmount: { $lte: amount },
    maxAmount: { $gte: amount },
    isActive: true
  });
  
  return tier ? tier.commissionRate : null;
};

export default mongoose.model('CommissionTier', commissionTierSchema);