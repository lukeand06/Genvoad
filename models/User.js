const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  // Basic Info
  firstName: { type: String, required: true, trim: true },
  lastName: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true },
  role: { type: String, enum: ['owner', 'vendor'], default: 'owner' },
  authProvider: { type: String, enum: ['password', 'google', 'microsoft', 'apple'], default: 'password' },
  providerId: { type: String, default: '' },
  
  // Profile
  avatar: { type: String, default: '' },
  bio: { type: String, default: '', maxlength: 500 },
  phone: { type: String, default: '' },
  location: { type: String, default: '' },
  
  // Professional Info
  company: { type: String, default: '' },
  title: { type: String, default: '' },
  registrarId: { type: String, default: '' },
  city: { type: String, default: '' },
  state: { type: String, default: '' },
  links: {
    website: { type: String, default: '' },
    linkedin: { type: String, default: '' },
    github: { type: String, default: '' }
  },
  skills: [{ type: String }],
  services: [{ type: String }],
  yearsExperience: { type: Number, default: 0 },

  // Preferences
  preferences: {
    profileVisibility: { type: String, enum: ['public', 'private'], default: 'public' },
    allowMessagesFrom: { type: String, enum: ['all', 'partners'], default: 'all' },
    emailNotifications: {
      projectUpdates: { type: Boolean, default: true },
      partnerRequests: { type: Boolean, default: true },
      messages: { type: Boolean, default: true }
    },
    smsOptIn: { type: Boolean, default: false },
    timezone: { type: String, default: 'America/Los_Angeles' },
    language: { type: String, default: 'en' },
    theme: { type: String, enum: ['light', 'dark', 'system'], default: 'system' }
  },

  // Social
  partners: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  
  // Portfolio
  portfolio: [{
    title: String,
    description: String,
    image: String,
    date: Date
  }],
  
  // Verification
  emailVerified: { type: Boolean, default: false },
  verificationCode: { type: String },
  verificationExpires: { type: Date },
  
  // Stats
  rating: { type: Number, default: 0, min: 0, max: 5 },
  reviewCount: { type: Number, default: 0 },
  projectsCompleted: { type: Number, default: 0 },

  // Lifecycle
  deletedAt: { type: Date },
  
  // Timestamps
  createdAt: { type: Date, default: Date.now },
  lastActive: { type: Date, default: Date.now }
});

// Indexes - remove duplicate from schema definition above
UserSchema.index({ skills: 1 });
UserSchema.index({ services: 1 });

module.exports = mongoose.model('User', UserSchema);
