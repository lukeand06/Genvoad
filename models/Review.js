const mongoose = require('mongoose');

const ReviewSchema = new mongoose.Schema({
  reviewer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  reviewee: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  project: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
  rating: { type: Number, required: true, min: 1, max: 5 },
  comment: { type: String, default: '', maxlength: 1000 },
  createdAt: { type: Date, default: Date.now }
});

ReviewSchema.index({ reviewee: 1, createdAt: -1 });
ReviewSchema.index({ reviewer: 1, reviewee: 1, project: 1 }, { unique: true });

module.exports = mongoose.model('Review', ReviewSchema);
