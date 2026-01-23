const mongoose = require('mongoose');

const ProjectSchema = new mongoose.Schema({
  // Basic Info
  title: { type: String, required: true, trim: true },
  description: { type: String, required: true },
  category: { type: String, required: true },
  
  // Owner
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  
  // Details
  budget: { type: Number, required: true },
  location: { type: String, required: true },
  startDate: { type: Date },
  endDate: { type: Date },
  
  // Requirements
  requirements: [{ type: String }],
  skills: [{ type: String }],
  
  // Attachments
  images: [{ type: String }],
  documents: [{ type: String }],
  
  // Status
  status: { 
    type: String, 
    enum: ['open', 'in_progress', 'completed', 'cancelled'],
    default: 'open'
  },
  
  // Bids
  bids: [{
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    amount: Number,
    proposal: String,
    timeline: String,
    createdAt: { type: Date, default: Date.now },
    status: { type: String, enum: ['pending', 'accepted', 'rejected'], default: 'pending' }
  }],
  
  // Selected bid
  acceptedBid: { type: mongoose.Schema.Types.ObjectId },
  
  // Timestamps
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

ProjectSchema.index({ owner: 1, status: 1 });
ProjectSchema.index({ category: 1, status: 1 });
ProjectSchema.index({ 'skills': 1 });

module.exports = mongoose.model('Project', ProjectSchema);
