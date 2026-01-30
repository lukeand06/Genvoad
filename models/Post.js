const mongoose = require('mongoose');

const PostSchema = new mongoose.Schema({
  // Author Info
  author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  authorName: { type: String, required: true },
  authorAvatar: { type: String, default: '' },
  authorRole: { type: String, enum: ['owner', 'vendor'], required: true },
  authorCompany: { type: String, default: '' },
  
  // Post Content
  title: { type: String, default: '', maxlength: 200 },
  content: { type: String, required: true, maxlength: 5000 },
  type: { 
    type: String, 
    enum: ['post', 'article', 'news', 'project_update', 'achievement', 'job_posting'], 
    default: 'post' 
  },
  
  // Media
  images: [{ type: String }], // URLs to uploaded images
  documentUrl: { type: String, default: '' }, // For articles/PDFs
  
  // Engagement
  likes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  likeCount: { type: Number, default: 0 },
  comments: [{
    author: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    authorName: { type: String },
    authorAvatar: { type: String, default: '' },
    content: { type: String, maxlength: 500 },
    createdAt: { type: Date, default: Date.now }
  }],
  commentCount: { type: Number, default: 0 },
  shares: { type: Number, default: 0 },
  
  // Visibility & Reach
  visibility: { type: String, enum: ['public', 'partners', 'private'], default: 'public' },
  tags: [{ type: String }], // #hashtags for content discovery
  mentionedUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  
  // Metadata
  location: { type: String, default: '' },
  industry: { type: String, default: '' },
  relatedProjects: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Project' }],
  
  // For tracking algorithm performance
  views: { type: Number, default: 0 },
  impressions: { type: Number, default: 0 },
  engagementScore: { type: Number, default: 0 }, // Calculated based on likes, comments, shares
  
  // Monetization
  isSponsored: { type: Boolean, default: false },
  sponsorshipCost: { type: Number, default: 0 },
  sponsorshipEndDate: { type: Date, default: null },
  
  createdAt: { type: Date, default: Date.now, index: true },
  updatedAt: { type: Date, default: Date.now }
});

// Index for efficient queries
PostSchema.index({ createdAt: -1 });
PostSchema.index({ author: 1, createdAt: -1 });
PostSchema.index({ type: 1, createdAt: -1 });
PostSchema.index({ isSponsored: 1, createdAt: -1 });
PostSchema.index({ authorRole: 1, createdAt: -1 });

// Update engagement score on post changes
PostSchema.pre('save', function(next) {
  const likes = this.likes ? this.likes.length : 0;
  const comments = this.comments ? this.comments.length : 0;
  const shares = this.shares || 0;
  
  // Simple engagement scoring: likes(1) + comments(3) + shares(5)
  this.engagementScore = likes + (comments * 3) + (shares * 5);
  this.likeCount = likes;
  this.commentCount = comments;
  
  next();
});

module.exports = mongoose.model('Post', PostSchema);
