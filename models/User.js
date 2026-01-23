const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  // Basic Info
  firstName: { type: String, required: true, trim: true },
  lastName: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true },
  role: { type: String, enum: ['owner', 'vendor'], default: 'owner' },
  
  // Profile
  avatar: { type: String, default: '' },
  bio: { type: String, default: '', maxlength: 500 },
  phone: { type: String, default: '' },
  location: { type: String, default: '' },
  
  // Professional Info
  company: { type: String, default: '' },
  title: { type: String, default: '' },
  skills: [{ type: String }],
  services: [{ type: String }],
  yearsExperience: { type: Number, default: 0 },
  
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
  
  // Timestamps
  createdAt: { type: Date, default: Date.now },
  lastActive: { type: Date, default: Date.now }
});

// Indexes - remove duplicate from schema definition above
UserSchema.index({ skills: 1 });
UserSchema.index({ services: 1 });

module.exports = mongoose.model('User', UserSchema);
