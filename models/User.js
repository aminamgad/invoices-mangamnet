import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  password: {
    type: String,
    required: true
  },
  role: {
    type: String,
    enum: ['admin', 'distributor'],
    default: 'distributor'
  },
  roles: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Role'
  }],
  commissionRate: {
    type: Number,
    default: 0
  },
  // Keep legacy permissions for backward compatibility
  permissions: {
    canCreateCompanies: { type: Boolean, default: false },
    canCreateInvoices: { type: Boolean, default: false },
    canManageClients: { type: Boolean, default: false },
    canViewReports: { type: Boolean, default: false }
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

userSchema.methods.comparePassword = async function(candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

// Method to check if user has a specific permission
userSchema.methods.hasPermission = async function(module, action) {
  if (this.role === 'admin') return true;
  
  await this.populate('roles');
  
  for (const role of this.roles) {
    await role.populate('permissions');
    const hasPermission = role.permissions.some(permission => 
      permission.module === module && permission.action === action
    );
    if (hasPermission) return true;
  }
  
  return false;
};

// Method to get all user permissions
userSchema.methods.getAllPermissions = async function() {
  if (this.role === 'admin') {
    // Admin has all permissions
    const Permission = mongoose.model('Permission');
    return await Permission.find();
  }
  
  await this.populate({
    path: 'roles',
    populate: {
      path: 'permissions'
    }
  });
  
  const permissions = new Set();
  this.roles.forEach(role => {
    role.permissions.forEach(permission => {
      permissions.add(permission._id.toString());
    });
  });
  
  return Array.from(permissions);
};

export default mongoose.model('User', userSchema);