const mongoose = require('mongoose');

const CompanySchema = new mongoose.Schema({
  // Basic Info
  name: { type: String, required: true, trim: true },
  legalName: { type: String, default: '' },
  registrationNumber: { type: String, default: '' }, // EIN, company registration #
  registrarId: { type: String, default: '' }, // Professional license/registrar ID
  
  // Contact & Location
  address: {
    street: String,
    city: String,
    state: String,
    zipCode: String,
    country: { type: String, default: 'USA' }
  },
  phone: { type: String, default: '' },
  email: { type: String, default: '' },
  website: { type: String, default: '' },
  
  // Verification Status
  verified: { type: Boolean, default: false },
  verificationStatus: { 
    type: String, 
    enum: ['pending', 'submitted', 'in_review', 'verified', 'rejected', 'expired'],
    default: 'pending'
  },
  verificationMethod: {
    type: String,
    enum: ['manual', 'automated', 'document', 'business_api', 'registrar_check'],
    default: 'manual'
  },
  verificationDate: { type: Date },
  verificationExpiry: { type: Date }, // Some licenses expire
  verificationNotes: { type: String, default: '' },
  
  // Documents for verification
  verificationDocuments: [{
    type: { type: String, enum: ['business_license', 'ein_letter', 'insurance', 'bond', 'registrar_license', 'other'] },
    url: String,
    uploadedAt: { type: Date, default: Date.now },
    verified: { type: Boolean, default: false }
  }],
  
  // Company Details
  type: { 
    type: String, 
    enum: ['general_contractor', 'subcontractor', 'architect', 'engineer', 'supplier', 'other'],
    default: 'general_contractor'
  },
  size: {
    type: String,
    enum: ['1-10', '11-50', '51-200', '201-500', '500+'],
    default: '1-10'
  },
  yearFounded: { type: Number },
  description: { type: String, default: '', maxlength: 1000 },
  specialties: [{ type: String }],
  
  // Team Management
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, // Primary admin
  admins: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }], // Can manage team
  members: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }], // All team members
  
  // Invitations
  pendingInvitations: [{
    email: { type: String, required: true },
    role: { type: String, enum: ['admin', 'member'], default: 'member' },
    token: { type: String, required: true },
    invitedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    invitedAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true },
    status: { type: String, enum: ['pending', 'accepted', 'expired', 'cancelled'], default: 'pending' }
  }],
  
  // External Verification Data (from APIs)
  externalVerification: {
    dunBradstreet: {
      verified: { type: Boolean, default: false },
      duns: String,
      verifiedAt: Date
    },
    stateRegistry: {
      verified: { type: Boolean, default: false },
      status: String,
      verifiedAt: Date
    },
    clearbit: {
      verified: { type: Boolean, default: false },
      data: mongoose.Schema.Types.Mixed,
      verifiedAt: Date
    }
  },
  
  // Stats
  projectsCompleted: { type: Number, default: 0 },
  rating: { type: Number, default: 0, min: 0, max: 5 },
  reviewCount: { type: Number, default: 0 },
  
  // Settings
  settings: {
    allowMemberInvites: { type: Boolean, default: false }, // Can non-admins invite?
    requireAdminApproval: { type: Boolean, default: true }, // Admin must approve new members?
    publicProfile: { type: Boolean, default: true }
  },
  
  // Metadata
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Update timestamp on save
CompanySchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Index for search
CompanySchema.index({ name: 'text', legalName: 'text', description: 'text' });
CompanySchema.index({ registrationNumber: 1 });
CompanySchema.index({ registrarId: 1 });
CompanySchema.index({ verified: 1 });

module.exports = mongoose.model('Company', CompanySchema);
