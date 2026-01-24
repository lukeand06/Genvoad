const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
require('dotenv').config();

const User = require('./models/User');
const Project = require('./models/Project');
const Message = require('./models/Message');
const Review = require('./models/Review');
const { sendVerificationEmail } = require('./utils/email');

const app = express();

// Configure file uploads
const uploadDir = path.join(__dirname, 'uploads');
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowedTypes = /pdf|doc|docx|xls|xlsx|jpg|jpeg|png|zip/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('File type not allowed'));
    }
  }
});

// Middleware
// Allow multiple origins for development
const allowedOrigins = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:5000',
  'http://127.0.0.1:5000',
  'http://localhost:8000',
  process.env.FRONTEND_URL
].filter(Boolean);

app.use(cors({ 
  origin: function(origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) !== -1 || process.env.NODE_ENV === 'development') {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true 
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files
// In production, serve HTML files from root
if (process.env.NODE_ENV === 'production') {
  app.use(express.static('.', {
    index: false, // Don't auto-serve index.html for API routes
    setHeaders: (res, path) => {
      if (path.endsWith('.html')) {
        res.setHeader('Cache-Control', 'no-cache');
      }
    }
  }));
} else {
  app.use(express.static('.'));
}
app.use('/public', express.static('public'));
app.use('/uploads', express.static(uploadDir));

// Connect to MongoDB
if (process.env.MONGODB_URI) {
  mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log('✓ Connected to MongoDB'))
    .catch(err => {
      console.error('MongoDB connection error:', err.message);
      console.warn('⚠ Running without database - some features will not work');
    });
} else {
  console.warn('⚠ MONGODB_URI not set - database features disabled');
}

// Auth Middleware
const authMiddleware = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'No token provided' });
    
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = await User.findById(decoded.userId).select('-password');
    if (!req.user) return res.status(401).json({ error: 'User not found' });
    
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

// ============ AUTH ROUTES ============

// Signup
app.post('/api/auth/signup', async (req, res) => {
  try {
    const { firstName, lastName, email, password, company, role } = req.body;
    
    // Validation
    if (!firstName || !lastName || !email || !password || !company || !role) {
      return res.status(400).json({ error: 'All fields required' });
    }
    const normalizedRole = ['owner', 'vendor'].includes(role) ? role : null;
    if (!normalizedRole) {
      return res.status(400).json({ error: 'Invalid role' });
    }
    
    // Check existing
    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      if (!existing.emailVerified) {
        // Refresh verification so users don't get stuck
        const refreshedCode = Math.random().toString().slice(2, 8).padStart(6, '0');
        existing.verificationCode = refreshedCode;
        existing.verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);
        existing.firstName = firstName || existing.firstName;
        existing.lastName = lastName || existing.lastName;
        existing.company = company || existing.company;
        existing.role = normalizedRole || existing.role;
        existing.password = await bcrypt.hash(password, 10);
        await existing.save();
        try {
          await sendVerificationEmail(email, existing.firstName, refreshedCode);
        } catch (emailError) {
          console.error('Email send error:', emailError);
        }
        return res.json({
          success: true,
          message: 'Account exists but was not verified. We sent a new verification code.',
          userId: existing._id,
          resent: true
        });
      }
      return res.status(400).json({ error: 'Email already registered' });
    }
    
    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Generate verification code
    const verificationCode = Math.random().toString().slice(2, 8).padStart(6, '0');
    const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
    
    // Create user
    const user = new User({
      firstName,
      lastName,
      email: email.toLowerCase(),
      password: hashedPassword,
      company,
      role: normalizedRole,
      verificationCode,
      verificationExpires,
      emailVerified: false
    });
    
    await user.save();
    
    // Send verification email
    let emailResult = { success: false };
    try {
      emailResult = await sendVerificationEmail(email, firstName, verificationCode);
    } catch (emailError) {
      console.error('Email send error:', emailError.message || emailError);
      // Don't fail signup if email fails
    }
    
    res.json({ 
      success: true, 
      message: 'Account created! Check your email for verification code.',
      userId: user._id,
      emailSent: emailResult.success === true,
      // Only surface the code if email was not sent (sandbox/dev aid)
      code: emailResult.success ? undefined : emailResult.code
    });
  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({ error: 'Signup failed' });
  }
});

// Resend verification code
app.post('/api/auth/resend', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.emailVerified) return res.status(400).json({ error: 'Email already verified' });

    const verificationCode = Math.random().toString().slice(2, 8).padStart(6, '0');
    user.verificationCode = verificationCode;
    user.verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await user.save();

    try {
      await sendVerificationEmail(email, user.firstName, verificationCode);
    } catch (emailError) {
      console.error('Email send error:', emailError);
    }

    res.json({ success: true, message: 'Verification code resent' });
  } catch (error) {
    console.error('Resend verification error:', error);
    res.status(500).json({ error: 'Failed to resend verification' });
  }
});

// Verify Email
app.post('/api/auth/verify', async (req, res) => {
  try {
    const { email, code } = req.body;
    
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) return res.status(404).json({ error: 'User not found' });
    
    if (user.emailVerified) {
      return res.status(400).json({ error: 'Email already verified' });
    }
    
    if (user.verificationCode !== code) {
      return res.status(400).json({ error: 'Invalid verification code' });
    }
    
    if (new Date() > user.verificationExpires) {
      return res.status(400).json({ error: 'Verification code expired' });
    }
    
    user.emailVerified = true;
    user.verificationCode = undefined;
    user.verificationExpires = undefined;
    await user.save();
    
    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' });
    
    res.json({
      success: true,
      token,
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        avatar: user.avatar,
        company: user.company,
        role: user.role
      }
    });
  } catch (error) {
    console.error('Verify error:', error);
    res.status(500).json({ error: 'Verification failed' });
  }
});

// Login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user || user.deletedAt) return res.status(401).json({ error: 'Invalid credentials' });
    
    if (!user.emailVerified) {
      return res.status(403).json({ error: 'Please verify your email first' });
    }
    
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) return res.status(401).json({ error: 'Invalid credentials' });
    
    user.lastActive = new Date();
    await user.save();
    
    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' });
    
    res.json({
      success: true,
      token,
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        avatar: user.avatar,
        bio: user.bio,
        location: user.location,
        company: user.company,
        title: user.title,
        role: user.role
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Get current user
app.get('/api/auth/me', authMiddleware, (req, res) => {
  res.json({ user: req.user });
});

// ============ USER ROUTES ============

// Get user profile
app.get('/api/users/:id', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('-password -verificationCode');
    if (!user || user.deletedAt) return res.status(404).json({ error: 'User not found' });
    res.json({ user });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

// ============ REVIEW ROUTES ============

// Create a review (Yelp-like)
app.post('/api/reviews', authMiddleware, async (req, res) => {
  try {
    const { reviewee, projectId, rating, comment } = req.body;
    if (!reviewee || !projectId || typeof rating === 'undefined') {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const project = await Project.findById(projectId);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    // Only owner or accepted contractor can review after completion
    const isOwnerReviewer = project.owner.toString() === req.user._id.toString();
    const isContractorReviewer = project.acceptedContractor && project.acceptedContractor.toString() === req.user._id.toString();
    if (!isOwnerReviewer && !isContractorReviewer) {
      return res.status(403).json({ error: 'Not authorized to review this project' });
    }
    if (project.status !== 'completed') {
      return res.status(400).json({ error: 'Reviews allowed only after project completion' });
    }

    const expectedReviewee = isOwnerReviewer ? project.acceptedContractor?.toString() : project.owner.toString();
    if (!expectedReviewee || expectedReviewee !== reviewee) {
      return res.status(400).json({ error: 'Invalid reviewee for this project' });
    }

    const existing = await Review.findOne({ reviewer: req.user._id, reviewee, project: projectId });
    if (existing) return res.status(400).json({ error: 'You already reviewed this project' });

    const clampedRating = Math.max(1, Math.min(5, Number(rating)));
    const review = new Review({
      reviewer: req.user._id,
      reviewee,
      project: projectId,
      rating: clampedRating,
      comment: comment || ''
    });
    await review.save();

    // Update aggregate on reviewee
    const user = await User.findById(reviewee);
    if (user) {
      const newCount = (user.reviewCount || 0) + 1;
      const newRating = (((user.rating || 0) * (user.reviewCount || 0)) + clampedRating) / newCount;
      user.reviewCount = newCount;
      user.rating = Number(newRating.toFixed(2));
      await user.save();
    }

    res.json({ success: true, review });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create review' });
  }
});

// List reviews for a user
app.get('/api/users/:id/reviews', authMiddleware, async (req, res) => {
  try {
    const reviews = await Review.find({ reviewee: req.params.id })
      .populate('reviewer', 'firstName lastName avatar company')
      .populate('project', 'title')
      .sort('-createdAt')
      .limit(50);
    res.json({ reviews });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch reviews' });
  }
});

// Update profile
app.put('/api/users/profile', authMiddleware, async (req, res) => {
  try {
    const allowed = [
      'firstName','lastName','bio','title','company','location','phone','yearsExperience',
      'skills','services','city','state','registrarId','links','preferences'
    ];
    const updates = {};
    allowed.forEach(key => {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    });

    const user = await User.findByIdAndUpdate(
      req.user._id,
      { $set: updates },
      { new: true }
    ).select('-password');
    
    res.json({ success: true, user });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// Delete (soft-delete) profile
app.delete('/api/users/profile', authMiddleware, async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.user._id, { $set: { deletedAt: new Date() } });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete profile' });
  }
});

// Search users
app.get('/api/users', authMiddleware, async (req, res) => {
  try {
    const { search, skills, services, city, registeredOnly } = req.query;
    const query = { emailVerified: true, deletedAt: { $exists: false } };
    
    if (search) {
      query.$or = [
        { firstName: { $regex: search, $options: 'i' } },
        { lastName: { $regex: search, $options: 'i' } },
        { company: { $regex: search, $options: 'i' } },
        { location: { $regex: search, $options: 'i' } },
        { city: { $regex: search, $options: 'i' } },
        { state: { $regex: search, $options: 'i' } }
      ];
    }
    
    if (skills) query.skills = { $in: skills.split(',') };
    if (services) query.services = { $in: services.split(',') };
    if (city) query.$or = (query.$or || []).concat({ location: { $regex: city, $options: 'i' } }, { city: { $regex: city, $options: 'i' } });
    if (registeredOnly === 'true') query.registrarId = { $ne: '' };
    
    const users = await User.find(query)
      .select('-password -verificationCode')
      .limit(50);
    
    res.json({ users });
  } catch (error) {
    res.status(500).json({ error: 'Search failed' });
  }
});

// ============ PARTNER ROUTES ============

// List partners
app.get('/api/partners', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).populate('partners', 'firstName lastName avatar company title location city state registrarId');
    res.json({ partners: user.partners || [] });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch partners' });
  }
});

// Add partner (mutual)
app.post('/api/partners/:partnerId', authMiddleware, async (req, res) => {
  try {
    const partnerId = req.params.partnerId;
    if (partnerId === req.user._id.toString()) return res.status(400).json({ error: 'Cannot partner with yourself' });
    const partner = await User.findById(partnerId);
    if (!partner) return res.status(404).json({ error: 'User not found' });
    
    // Add to current user
    await User.findByIdAndUpdate(req.user._id, { $addToSet: { partners: partnerId } });
    // Add to partner as mutual
    await User.findByIdAndUpdate(partnerId, { $addToSet: { partners: req.user._id } });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to add partner' });
  }
});

// Remove partner (mutual removal)
app.delete('/api/partners/:partnerId', authMiddleware, async (req, res) => {
  try {
    const partnerId = req.params.partnerId;
    await User.findByIdAndUpdate(req.user._id, { $pull: { partners: partnerId } });
    await User.findByIdAndUpdate(partnerId, { $pull: { partners: req.user._id } });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to remove partner' });
  }
});

// ============ PROJECT ROUTES ============

// Create project
app.post('/api/projects', authMiddleware, upload.array('attachments', 10), async (req, res) => {
  try {
    const projectData = {
      ...req.body,
      owner: req.user._id
    };

    // Parse arrays from form data
    if (typeof req.body.requirements === 'string') {
      projectData.requirements = req.body.requirements.split(',').map(r => r.trim()).filter(r => r);
    }
    if (typeof req.body.skills === 'string') {
      projectData.skills = req.body.skills.split(',').map(s => s.trim()).filter(s => s);
    }

    // Handle file uploads
    if (req.files && req.files.length > 0) {
      projectData.attachments = req.files.map(file => ({
        filename: file.originalname,
        url: `/uploads/${file.filename}`,
        uploadedAt: new Date()
      }));
    }

    const project = new Project(projectData);
    await project.save();
    
    res.json({ success: true, project });
  } catch (error) {
    console.error('Error creating project:', error);
    res.status(500).json({ error: 'Failed to create project' });
  }
});

// Get projects
app.get('/api/projects', authMiddleware, async (req, res) => {
  try {
    const { status, category, owner, contractor } = req.query;
    const query = {};
    
    if (status) query.status = status;
    if (category) query.category = category;
    if (owner) query.owner = owner;
    if (contractor) query.acceptedContractor = contractor;
    
    const projects = await Project.find(query)
      .populate('owner', 'firstName lastName avatar company')
      .populate('bids.user', 'firstName lastName avatar company')
      .sort('-createdAt')
      .limit(50);
    
    res.json({ projects });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch projects' });
  }
});

// Get single project
app.get('/api/projects/:id', authMiddleware, async (req, res) => {
  try {
    const project = await Project.findById(req.params.id)
      .populate('owner', 'firstName lastName avatar company location')
      .populate('bids.user', 'firstName lastName avatar company rating');
    
    if (!project) return res.status(404).json({ error: 'Project not found' });
    res.json({ project });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch project' });
  }
});

// Submit bid
app.post('/api/projects/:id/bids', authMiddleware, async (req, res) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    
    // Check if already bid
    const existingBid = project.bids.find(b => b.user.toString() === req.user._id.toString());
    if (existingBid) return res.status(400).json({ error: 'Already submitted bid' });
    
    project.bids.push({
      user: req.user._id,
      amount: req.body.amount,
      proposal: req.body.proposal,
      timeline: req.body.timeline
    });
    
    await project.save();
    res.json({ success: true, message: 'Bid submitted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to submit bid' });
  }
});

// Accept bid
app.post('/api/projects/:projectId/bids/:bidId/accept', authMiddleware, async (req, res) => {
  try {
    const project = await Project.findById(req.params.projectId);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    
    if (project.owner.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    
    const bid = project.bids.id(req.params.bidId);
    if (!bid) return res.status(404).json({ error: 'Bid not found' });
    
    // Update bid statuses
    project.bids.forEach(b => {
      b.status = b._id.toString() === req.params.bidId ? 'accepted' : 'rejected';
    });
    
    project.acceptedBid = bid._id;
    project.acceptedContractor = bid.user;
    project.status = 'in_progress';
    project.negotiationPhase = 'finalized';
    
    // Open Governance: Log activity
    project.activityLog.push({
      actor: req.user._id,
      action: 'bid_accepted',
      details: `Accepted bid from contractor for ${formatCurrency(bid.amount)}`,
      timestamp: new Date()
    });
    
    await project.save();
    
    res.json({ success: true, message: 'Bid accepted' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to accept bid' });
  }
});

// Edit bid (amount, timeline, proposal) by bidder when pending
app.patch('/api/projects/:projectId/bids/:bidId', authMiddleware, async (req, res) => {
  try {
    const project = await Project.findById(req.params.projectId);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const bid = project.bids.id(req.params.bidId);
    if (!bid) return res.status(404).json({ error: 'Bid not found' });

    if (bid.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Not authorized to edit this bid' });
    }

    if (bid.status !== 'pending') {
      return res.status(400).json({ error: 'Only pending bids can be edited' });
    }

    const { amount, timeline, proposal } = req.body;
    if (typeof amount !== 'undefined') bid.amount = amount;
    if (typeof timeline !== 'undefined') bid.timeline = timeline;
    if (typeof proposal !== 'undefined') bid.proposal = proposal;

    project.updatedAt = new Date();
    await project.save();
    res.json({ success: true, message: 'Bid updated', bid });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update bid' });
  }
});

// Withdraw bid by bidder when pending (remove from array)
app.delete('/api/projects/:projectId/bids/:bidId', authMiddleware, async (req, res) => {
  try {
    const project = await Project.findById(req.params.projectId);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const bid = project.bids.id(req.params.bidId);
    if (!bid) return res.status(404).json({ error: 'Bid not found' });

    if (bid.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Not authorized to withdraw this bid' });
    }

    if (bid.status !== 'pending') {
      return res.status(400).json({ error: 'Only pending bids can be withdrawn' });
    }

    bid.remove();
    project.updatedAt = new Date();
    await project.save();
    res.json({ success: true, message: 'Bid withdrawn' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to withdraw bid' });
  }
});

// ============ MESSAGE ROUTES ============

// Send message
app.post('/api/messages', authMiddleware, async (req, res) => {
  try {
    const message = new Message({
      sender: req.user._id,
      recipient: req.body.recipient,
      content: req.body.content,
      type: req.body.type || 'standard',
      project: req.body.project,
      structuredData: req.body.structuredData
    });
    await message.save();
    
    // Log governance activity if message is linked to a project
    if (req.body.project && ['proposal', 'counter_proposal', 'agreement'].includes(message.type)) {
      const project = await Project.findById(req.body.project);
      if (project) {
        project.activityLog.push({
          actor: req.user._id,
          action: `message_${message.type}`,
          details: `Sent ${message.type.replace('_', ' ')} message`,
          timestamp: new Date()
        });
        await project.save();
      }
    }
    
    res.json({ success: true, message });
  } catch (error) {
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// Get conversations
app.get('/api/messages/conversations', authMiddleware, async (req, res) => {
  try {
    const messages = await Message.find({
      $or: [{ sender: req.user._id }, { recipient: req.user._id }]
    })
    .populate('sender', 'firstName lastName avatar')
    .populate('recipient', 'firstName lastName avatar')
    .sort('-createdAt');
    
    // Group by conversation
    const conversations = {};
    messages.forEach(msg => {
      const otherUserId = msg.sender._id.toString() === req.user._id.toString() 
        ? msg.recipient._id.toString() 
        : msg.sender._id.toString();
      
      if (!conversations[otherUserId]) {
        conversations[otherUserId] = {
          user: msg.sender._id.toString() === req.user._id.toString() ? msg.recipient : msg.sender,
          lastMessage: msg,
          unread: 0
        };
      }
      
      if (!msg.read && msg.recipient._id.toString() === req.user._id.toString()) {
        conversations[otherUserId].unread++;
      }
    });
    
    res.json({ conversations: Object.values(conversations) });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch conversations' });
  }
});

// Get messages with user
app.get('/api/messages/:userId', authMiddleware, async (req, res) => {
  try {
    const messages = await Message.find({
      $or: [
        { sender: req.user._id, recipient: req.params.userId },
        { sender: req.params.userId, recipient: req.user._id }
      ]
    })
    .populate('sender', 'firstName lastName avatar')
    .populate('recipient', 'firstName lastName avatar')
    .sort('createdAt');
    
    // Mark as read
    await Message.updateMany(
      { sender: req.params.userId, recipient: req.user._id, read: false },
      { $set: { read: true } }
    );
    
    res.json({ messages });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// ============ OPEN GOVERNANCE ROUTES ============

// Update negotiation phase
app.put('/api/projects/:id/negotiation-phase', authMiddleware, async (req, res) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    
    const isOwner = project.owner.toString() === req.user._id.toString();
    const isContractor = project.acceptedContractor?.toString() === req.user._id.toString();
    
    if (!isOwner && !isContractor) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    
    project.negotiationPhase = req.body.phase;
    project.activityLog.push({
      actor: req.user._id,
      action: 'negotiation_phase_update',
      details: `Updated negotiation phase to: ${req.body.phase}`,
      timestamp: new Date()
    });
    
    await project.save();
    res.json({ success: true, project });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update negotiation phase' });
  }
});

// Add milestone
app.post('/api/projects/:id/milestones', authMiddleware, async (req, res) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    
    const isOwner = project.owner.toString() === req.user._id.toString();
    const isContractor = project.acceptedContractor?.toString() === req.user._id.toString();
    
    if (!isOwner && !isContractor) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    
    project.milestones.push(req.body);
    project.activityLog.push({
      actor: req.user._id,
      action: 'milestone_added',
      details: `Added milestone: ${req.body.title}`,
      timestamp: new Date()
    });
    
    await project.save();
    res.json({ success: true, project });
  } catch (error) {
    res.status(500).json({ error: 'Failed to add milestone' });
  }
});

// Complete milestone (contractor marks complete)
app.post('/api/projects/:projectId/milestones/:milestoneId/complete', authMiddleware, async (req, res) => {
  try {
    const project = await Project.findById(req.params.projectId);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    
    const isContractor = project.acceptedContractor?.toString() === req.user._id.toString();
    if (!isContractor) {
      return res.status(403).json({ error: 'Only the contractor can mark milestones complete' });
    }
    
    const milestone = project.milestones.id(req.params.milestoneId);
    if (!milestone) return res.status(404).json({ error: 'Milestone not found' });
    
    milestone.status = 'completed';
    milestone.completedAt = new Date();
    milestone.completedBy = req.user._id;
    milestone.notes = req.body.notes;
    milestone.deliverables = req.body.deliverables || [];
    
    project.activityLog.push({
      actor: req.user._id,
      action: 'milestone_completed',
      details: `Marked milestone "${milestone.title}" as completed`,
      timestamp: new Date()
    });
    
    await project.save();
    res.json({ success: true, project });
  } catch (error) {
    res.status(500).json({ error: 'Failed to complete milestone' });
  }
});

// Approve milestone (owner approves)
app.post('/api/projects/:projectId/milestones/:milestoneId/approve', authMiddleware, async (req, res) => {
  try {
    const project = await Project.findById(req.params.projectId);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    
    const isOwner = project.owner.toString() === req.user._id.toString();
    if (!isOwner) {
      return res.status(403).json({ error: 'Only the project owner can approve milestones' });
    }
    
    const milestone = project.milestones.id(req.params.milestoneId);
    if (!milestone) return res.status(404).json({ error: 'Milestone not found' });
    
    if (milestone.status !== 'completed') {
      return res.status(400).json({ error: 'Milestone must be completed before approval' });
    }
    
    milestone.status = 'approved';
    milestone.approvedAt = new Date();
    milestone.approvedBy = req.user._id;
    
    project.activityLog.push({
      actor: req.user._id,
      action: 'milestone_approved',
      details: `Approved milestone "${milestone.title}"`,
      timestamp: new Date()
    });
    
    await project.save();
    res.json({ success: true, project });
  } catch (error) {
    res.status(500).json({ error: 'Failed to approve milestone' });
  }
});

// Submit change order
app.post('/api/projects/:id/change-orders', authMiddleware, async (req, res) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    
    const isOwner = project.owner.toString() === req.user._id.toString();
    const isContractor = project.acceptedContractor?.toString() === req.user._id.toString();
    
    if (!isOwner && !isContractor) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    
    const changeOrder = {
      requestedBy: req.user._id,
      title: req.body.title,
      description: req.body.description,
      budgetImpact: req.body.budgetImpact || 0,
      timelineImpact: req.body.timelineImpact,
      status: 'pending',
      responses: [],
      createdAt: new Date()
    };
    
    project.changeOrders.push(changeOrder);
    project.activityLog.push({
      actor: req.user._id,
      action: 'change_order_requested',
      details: `Requested change order: ${req.body.title}`,
      timestamp: new Date()
    });
    
    await project.save();
    res.json({ success: true, project });
  } catch (error) {
    res.status(500).json({ error: 'Failed to submit change order' });
  }
});

// Respond to change order
app.post('/api/projects/:projectId/change-orders/:changeOrderId/respond', authMiddleware, async (req, res) => {
  try {
    const project = await Project.findById(req.params.projectId);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    
    const isOwner = project.owner.toString() === req.user._id.toString();
    const isContractor = project.acceptedContractor?.toString() === req.user._id.toString();
    
    if (!isOwner && !isContractor) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    
    const changeOrder = project.changeOrders.id(req.params.changeOrderId);
    if (!changeOrder) return res.status(404).json({ error: 'Change order not found' });
    
    if (changeOrder.requestedBy.toString() === req.user._id.toString()) {
      return res.status(400).json({ error: 'Cannot respond to your own change order' });
    }
    
    changeOrder.responses.push({
      user: req.user._id,
      response: req.body.response,
      decision: req.body.decision,
      createdAt: new Date()
    });
    
    if (req.body.decision === 'approve') {
      changeOrder.status = 'approved';
      changeOrder.resolvedAt = new Date();
    } else if (req.body.decision === 'reject') {
      changeOrder.status = 'rejected';
      changeOrder.resolvedAt = new Date();
    } else if (req.body.decision === 'counter') {
      changeOrder.status = 'negotiating';
    }
    
    project.activityLog.push({
      actor: req.user._id,
      action: `change_order_${req.body.decision}`,
      details: `${req.body.decision === 'approve' ? 'Approved' : req.body.decision === 'reject' ? 'Rejected' : 'Countered'} change order: ${changeOrder.title}`,
      timestamp: new Date()
    });
    
    await project.save();
    res.json({ success: true, project });
  } catch (error) {
    res.status(500).json({ error: 'Failed to respond to change order' });
  }
});

// Get project activity log
app.get('/api/projects/:id/activity', authMiddleware, async (req, res) => {
  try {
    const project = await Project.findById(req.params.id)
      .populate('activityLog.actor', 'firstName lastName avatar company')
      .select('activityLog owner acceptedContractor');
    
    if (!project) return res.status(404).json({ error: 'Project not found' });
    
    // Only owner and contractor can see activity log
    const isOwner = project.owner.toString() === req.user._id.toString();
    const isContractor = project.acceptedContractor?.toString() === req.user._id.toString();
    
    if (!isOwner && !isContractor) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    
    res.json({ activityLog: project.activityLog });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch activity log' });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
  });
});

// Email test (development aid)
app.post('/api/auth/email-test', async (req, res) => {
  try {
    const { to } = req.body;
    if (!to) return res.status(400).json({ error: 'Provide `to` email in body' });

    const code = Math.random().toString().slice(2, 8).padStart(6, '0');
    const result = await sendVerificationEmail(to, 'Tester', code);
    res.json({ success: true, sent: result.success, code: result.code });
  } catch (error) {
    console.error('Email test error:', error.message || error);
    res.status(500).json({ error: 'Email test failed' });
  }
});

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 Genovad API running on port ${PORT}`);
  console.log(`📧 Email: ${process.env.RESEND_API_KEY ? 'Resend Configured' : (process.env.SMTP_HOST ? 'SMTP Configured' : 'Console logging mode')}`);
  console.log(`🗄️  MongoDB: ${process.env.MONGODB_URI ? 'Configured' : 'Not configured'}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}\n`);
});
