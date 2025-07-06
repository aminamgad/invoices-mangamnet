import mongoose from 'mongoose';

const permissionSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  displayName: {
    type: String,
    required: true,
    trim: true
  },
  module: {
    type: String,
    required: true,
    enum: ['companies', 'clients', 'files', 'invoices', 'distributors', 'reports', 'commission-tiers', 'roles', 'permissions', 'system']
  },
  action: {
    type: String,
    required: true,
    enum: ['view_own', 'view_all', 'create', 'update', 'delete']
  },
  description: {
    type: String,
    trim: true
  },
  isSystemPermission: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

// Compound index to ensure unique module-action combinations
permissionSchema.index({ module: 1, action: 1 }, { unique: true });

export default mongoose.model('Permission', permissionSchema);