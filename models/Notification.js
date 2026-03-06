const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  type: {
    type: String,
    enum: [
      'company_invite_accepted',
      'company_verified',
      'company_verification_rejected',
      'partnership_request',
      'partnership_accepted',
      'partnership_declined',
      'bid_received',
      'bid_accepted',
      'bid_declined',
      'bid_rejected',
      'bid_revision_requested',
      'bid_revised',
      'new_message',
      'project_update',
      'community_member_referred',
      'community_member_joined',
      'community_member_left',
      'review_received',
      'system'
    ],
    required: true
  },
  read: {
    type: Boolean,
    default: false,
    index: true
  },
  category: {
    type: String,
    enum: ['company', 'partnerships', 'projects', 'bids', 'messages', 'system'],
    required: true
  },
  // Flexible data object for different notification types
  data: {
    // Company notifications
    companyId: mongoose.Schema.Types.ObjectId,
    companyName: String,
    invitedUserName: String,
    invitedUserEmail: String,
    inviteRole: String,

    // Partnership notifications
    userId: mongoose.Schema.Types.ObjectId,
    userName: String,
    userCompany: String,
    userEmail: String,
    
    // Project/Bid notifications
    projectId: mongoose.Schema.Types.ObjectId,
    projectTitle: String,
    bidId: mongoose.Schema.Types.ObjectId,
    
    // Message notifications
    messageId: mongoose.Schema.Types.ObjectId,
    messagePreview: String,
    
    // Revision notifications
    revisionNotes: String,
    
    // General
    title: String,
    message: String,
    actionUrl: String,
    amount: Number,
    bidderName: String,
    bidAmount: Number
  },
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  expiresAt: {
    type: Date,
    default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days
  }
});

// Automatically delete expired notifications
notificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('Notification', notificationSchema);
