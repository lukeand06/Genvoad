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
  
  // Scheduling & Drafts
  scheduledFor: { type: Date, default: null },
  isDraft: { type: Boolean, default: false },
  status: { type: String, enum: ['draft', 'scheduled', 'published'], default: 'published' },
  
  // Analytics & Performance
  viewedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  viewCount: { type: Number, default: 0 },
  clickThrough: { type: Number, default: 0 }, // External links clicked
  shareCount: { type: Number, default: 0 },
  feedbackScore: { type: Number, default: 0 }, // 1-5 user rating
  timeSpentAvg: { type: Number, default: 0 }, // Average time spent viewing in seconds
  
  // Trending & Discovery
  isTrending: { type: Boolean, default: false },
  trendingScore: { type: Number, default: 0 },
  trendingRank: { type: Number, default: null },
  
  createdAt: { type: Date, default: Date.now, index: true },
  updatedAt: { type: Date, default: Date.now },
  publishedAt: { type: Date, default: null }
});

// Index for efficient queries
PostSchema.index({ createdAt: -1 });
PostSchema.index({ author: 1, createdAt: -1 });
PostSchema.index({ type: 1, createdAt: -1 });
PostSchema.index({ isSponsored: 1, createdAt: -1 });
PostSchema.index({ authorRole: 1, createdAt: -1 });
PostSchema.index({ status: 1, scheduledFor: 1 });
PostSchema.index({ isTrending: 1, trendingScore: -1 });
PostSchema.index({ visibility: 1, createdAt: -1 });
PostSchema.index({ tags: 1 });

// Update engagement score on post changes
PostSchema.pre('save', function(next) {
  const likes = this.likes ? this.likes.length : 0;
  const comments = this.comments ? this.comments.length : 0;
  const shares = this.shareCount || 0;
  const views = this.viewCount || 0;
  
  // Advanced engagement scoring: views(0.1) + likes(1) + comments(3) + shares(5) + feedback(2)
  this.engagementScore = (views * 0.1) + likes + (comments * 3) + (shares * 5) + (this.feedbackScore || 0) * 2;
  this.likeCount = likes;
  this.commentCount = comments;
  
  // Update published date if transitioning to published
  if (this.status === 'published' && !this.publishedAt) {
    this.publishedAt = new Date();
  }
  
  // Update trending score based on engagement
  const hoursSinceCreation = (new Date() - this.createdAt) / (1000 * 60 * 60);
  if (hoursSinceCreation > 0) {
    this.trendingScore = this.engagementScore / Math.sqrt(hoursSinceCreation + 1);
  }
  
  next();
});

module.exports = mongoose.model('Post', PostSchema);
