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

  // Meeting & Attachments
  zoomLink: { type: String, default: '' },
  meetingDate: { type: Date },
  attachments: [{
    filename: String,
    url: String,
    uploadedAt: { type: Date, default: Date.now }
  }],
  
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
  acceptedContractor: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  
  // Open Governance: Negotiation Tracking
  negotiationPhase: {
    type: String,
    enum: ['initial', 'scope_discussion', 'timeline_alignment', 'budget_agreement', 'finalized', 'not_started'],
    default: 'not_started'
  },
  
  // Open Governance: Milestones with Sign-offs
  milestones: [{
    title: { type: String, required: true },
    description: String,
    dueDate: Date,
    amount: Number,
    status: { 
      type: String, 
      enum: ['pending', 'in_progress', 'completed', 'approved', 'disputed'],
      default: 'pending'
    },
    completedAt: Date,
    completedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    approvedAt: Date,
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    notes: String,
    deliverables: [String]
  }],
  
  // Open Governance: Change Orders
  changeOrders: [{
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true },
    description: { type: String, required: true },
    budgetImpact: { type: Number, default: 0 },
    timelineImpact: String,
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'negotiating'],
      default: 'pending'
    },
    responses: [{
      user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      response: String,
      decision: { type: String, enum: ['approve', 'reject', 'counter'] },
      createdAt: { type: Date, default: Date.now }
    }],
    resolvedAt: Date,
    createdAt: { type: Date, default: Date.now }
  }],
  
  // Open Governance: Activity Log for Transparency
  activityLog: [{
    actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    action: { type: String, required: true },
    details: String,
    timestamp: { type: Date, default: Date.now }
  }],
  
  // Timestamps
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

ProjectSchema.index({ owner: 1, status: 1 });
ProjectSchema.index({ category: 1, status: 1 });
ProjectSchema.index({ 'skills': 1 });

module.exports = mongoose.model('Project', ProjectSchema);
