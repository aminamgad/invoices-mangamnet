import mongoose from 'mongoose';

const fileSchema = new mongoose.Schema({
  fileName: {
    type: String,
    required: true,
    trim: true
  },
  company: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: true
  },
  status: {
    type: String,
    enum: ['active', 'archived', 'under_review', 'completed'],
    default: 'active'
  },
  pdfPath: {
    type: String,
    required: true
  },
  notes: {
    type: String,
    trim: true
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }
}, {
  timestamps: true
});

export default mongoose.model('File', fileSchema);