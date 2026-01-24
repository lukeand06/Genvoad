const mongoose = require('mongoose');

const MessageSchema = new mongoose.Schema({
  sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  recipient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  content: { type: String, required: true },
  read: { type: Boolean, default: false },
  
  // Attachments
  attachments: [{
    filename: String,
    url: String,
    mimeType: String,
    size: Number,
    uploadedAt: { type: Date, default: Date.now }
  }],
  
  // Reactions (like Slack/Teams)
  reactions: [{
    emoji: { type: String, required: true }, // 👍, ❤️, 😂, 😮, 😢, 🎉
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    createdAt: { type: Date, default: Date.now }
  }],
  
  // Open Governance: Message Classification
  type: {
    type: String,
    enum: ['standard', 'proposal', 'counter_proposal', 'agreement', 'change_request', 'milestone_update', 'dispute'],
    default: 'standard'
  },
  
  // Open Governance: Context Linking
  project: { type: mongoose.Schema.Types.ObjectId, ref: 'Project' },
  milestone: { type: mongoose.Schema.Types.ObjectId },
  changeOrder: { type: mongoose.Schema.Types.ObjectId },
  
  // Structured negotiation data
  structuredData: {
    proposedBudget: Number,
    proposedTimeline: String,
    scopeChanges: [String],
    terms: [String]
  },
  
  createdAt: { type: Date, default: Date.now }
});

MessageSchema.index({ sender: 1, recipient: 1, createdAt: -1 });
MessageSchema.index({ recipient: 1, read: 1 });

module.exports = mongoose.model('Message', MessageSchema);
