const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const jwksClient = require('jwks-rsa');
require('dotenv').config();

const User = require('./models/User');
const Project = require('./models/Project');
const Message = require('./models/Message');
const Review = require('./models/Review');
const { sendVerificationEmail } = require('./utils/email');

const app = express();

// Configure file uploads
const uploadDir = path.join(__dirname, 'uploads');

// Create uploads directory if it doesn't exist
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

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
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB
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

// Social sign-in configuration
const socialProviders = {
  google: {
    jwksUri: 'https://www.googleapis.com/oauth2/v3/certs',
    issuer: ['https://accounts.google.com', 'accounts.google.com'],
    audience: process.env.GOOGLE_CLIENT_ID,
    name: 'google'
  },
  microsoft: {
    jwksUri: 'https://login.microsoftonline.com/common/discovery/v2.0/keys',
    issuer: ['https://login.microsoftonline.com/common/v2.0', 'https://login.microsoftonline.com/{tenantid}/v2.0'],
    audience: process.env.MICROSOFT_CLIENT_ID,
    name: 'microsoft'
  },
  apple: {
    jwksUri: 'https://appleid.apple.com/auth/keys',
    issuer: ['https://appleid.apple.com'],
    audience: process.env.APPLE_CLIENT_ID,
    name: 'apple'
  }
};

const jwksClients = Object.fromEntries(
  Object.entries(socialProviders).map(([key, config]) => [
    key,
    jwksClient({ jwksUri: config.jwksUri, cache: true, rateLimit: true })
  ])
);

const providerEnabled = (provider) => {
  const cfg = socialProviders[provider];
  return Boolean(cfg && cfg.audience);
};

const verifySocialToken = async (provider, idToken) => {
  const cfg = socialProviders[provider];
  if (!cfg) {
    throw new Error('Unsupported provider');
  }
  if (!cfg.audience) {
    throw new Error(`${provider} not configured`);
  }

  const client = jwksClients[provider];

  const getKey = (header, callback) => {
    client
      .getSigningKey(header.kid)
      .then((key) => callback(null, key.getPublicKey()))
      .catch((err) => callback(err));
  };

  return new Promise((resolve, reject) => {
    jwt.verify(
      idToken,
      getKey,
      {
        audience: cfg.audience,
        issuer: cfg.issuer
      },
      (err, decoded) => {
        if (err) return reject(err);
        return resolve(decoded);
      }
    );
  });
};

const extractNames = (payload = {}) => {
  const firstName = payload.given_name || (payload.name ? payload.name.split(' ')[0] : '');
  const lastName = payload.family_name || (payload.name ? payload.name.split(' ').slice(1).join(' ') : '');
  return {
    firstName: firstName || 'New',
    lastName: lastName || 'User'
  };
};

const generatePlaceholderPassword = async () => {
  const randomString = Math.random().toString(36).slice(2) + Date.now().toString(36);
  return bcrypt.hash(randomString, 10);
};

// ============ AUTH ROUTES ============

// Public config for client-side social buttons
app.get('/api/auth/config', (req, res) => {
  res.json({
    providers: {
      google: providerEnabled('google'),
      microsoft: providerEnabled('microsoft'),
      apple: providerEnabled('apple')
    },
    clientIds: {
      google: process.env.GOOGLE_CLIENT_ID || '',
      microsoft: process.env.MICROSOFT_CLIENT_ID || '',
      apple: process.env.APPLE_CLIENT_ID || ''
    }
  });
});

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
      authProvider: 'password',
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
        role: user.role,
        authProvider: user.authProvider
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
        role: user.role,
        authProvider: user.authProvider
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Social login
app.post('/api/auth/social', async (req, res) => {
  try {
    const { provider, idToken, role } = req.body;

    if (!provider || !idToken || !role) {
      return res.status(400).json({ error: 'Provider, token, and role are required' });
    }

    if (!['owner', 'vendor'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role selection' });
    }

    if (!providerEnabled(provider)) {
      return res.status(400).json({ error: `${provider} sign-in is not configured` });
    }

    let decoded;
    try {
      decoded = await verifySocialToken(provider, idToken);
    } catch (err) {
      console.error('Social token verify error:', err.message || err);
      return res.status(401).json({ error: 'Unable to verify social login' });
    }

    const email = decoded?.email?.toLowerCase();
    if (!email) {
      return res.status(400).json({ error: 'Provider did not return an email' });
    }

    const { firstName, lastName } = extractNames(decoded);
    let user = await User.findOne({ email });

    if (user && user.deletedAt) {
      return res.status(403).json({ error: 'Account is disabled' });
    }

    if (user && user.role !== role) {
      return res.status(403).json({ error: `This email is registered as a ${user.role}. Switch to that sign-in.` });
    }

    if (user) {
      user.firstName = user.firstName || firstName;
      user.lastName = user.lastName || lastName;
      user.authProvider = provider;
      user.providerId = decoded.sub || user.providerId;
      user.emailVerified = true;
      user.lastActive = new Date();
      await user.save();
    } else {
      const placeholderPassword = await generatePlaceholderPassword();
      user = new User({
        firstName,
        lastName,
        email,
        password: placeholderPassword,
        role,
        authProvider: provider,
        providerId: decoded.sub || '',
        company: decoded.hd ? `${decoded.hd} workspace` : 'Self-registered',
        emailVerified: true
      });
      await user.save();
    }

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
        role: user.role,
        authProvider: user.authProvider
      }
    });
  } catch (error) {
    console.error('Social login error:', error);
    res.status(500).json({ error: 'Social login failed' });
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

      // Ensure reviewee is a company profile (Indeed-like behavior)
      const revieweeUser = await User.findById(reviewee);
      if (!revieweeUser) return res.status(404).json({ error: 'Reviewee not found' });
      if (!revieweeUser.company) {
        return res.status(400).json({ error: 'Reviews are only allowed on company profiles' });
      }

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

// Edit a review (reviewer can always edit)
app.patch('/api/reviews/:id', authMiddleware, async (req, res) => {
  try {
    const review = await Review.findById(req.params.id);
    if (!review) return res.status(404).json({ error: 'Review not found' });
    if (review.reviewer.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Not authorized to edit this review' });
    }

    const user = await User.findById(review.reviewee);
    if (!user) return res.status(404).json({ error: 'Reviewee not found' });

    const oldRating = review.rating;
    const { rating, comment } = req.body;
    const hasRating = typeof rating !== 'undefined';
    const newRating = hasRating ? Math.max(1, Math.min(5, Number(rating))) : oldRating;

    // Update review fields
    if (hasRating) review.rating = newRating;
    if (typeof comment !== 'undefined') review.comment = comment;
    await review.save();

    // Adjust aggregates if rating changed
    if (hasRating && user.reviewCount > 0) {
      const count = user.reviewCount;
      const adjusted = ((user.rating || 0) * count - oldRating + newRating) / count;
      user.rating = Number(adjusted.toFixed(2));
      await user.save();
    }

    res.json({ success: true, review });
  } catch (error) {
    res.status(500).json({ error: 'Failed to edit review' });
  }
});

// Delete a review (reviewer can always delete)
app.delete('/api/reviews/:id', authMiddleware, async (req, res) => {
  try {
    const review = await Review.findById(req.params.id);
    if (!review) return res.status(404).json({ error: 'Review not found' });
    if (review.reviewer.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Not authorized to delete this review' });
    }

    const user = await User.findById(review.reviewee);
    if (!user) return res.status(404).json({ error: 'Reviewee not found' });

    const oldCount = user.reviewCount || 0;
    const oldRating = user.rating || 0;
    const newCount = Math.max(0, oldCount - 1);
    let newAvg = 0;
    if (newCount > 0) {
      newAvg = ((oldRating * oldCount) - review.rating) / newCount;
    }
    user.reviewCount = newCount;
    user.rating = Number(newAvg.toFixed(2));
    await user.save();

    await review.deleteOne();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete review' });
  }
});

// Update profile
app.put('/api/users/profile', authMiddleware, async (req, res) => {
  try {
    const allowed = [
      'firstName','lastName','bio','title','company','location','phone','yearsExperience',
      'skills','services','city','state','registrarId','links','preferences','role','profileBackground'
    ];
    const updates = {};
    if (req.body.role && !['owner', 'vendor'].includes(req.body.role)) {
      return res.status(400).json({ error: 'Invalid role selection' });
    }
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

// Update project (status, etc.) - owner only
app.patch('/api/projects/:id', authMiddleware, async (req, res) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    
    // Verify ownership
    if (project.owner.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Only project owner can update this project' });
    }
    
    // Update allowed fields
    const { status, title, description, budget, location } = req.body;
    if (status) project.status = status;
    if (title) project.title = title;
    if (description) project.description = description;
    if (budget) project.budget = budget;
    if (location) project.location = location;
    
    await project.save();
    res.json({ success: true, message: 'Project updated successfully', project });
  } catch (error) {
    console.error('Update project error:', error);
    res.status(500).json({ error: 'Failed to update project' });
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

// Reject bid - owner only
app.post('/api/projects/:projectId/bids/:bidId/reject', authMiddleware, async (req, res) => {
  try {
    const project = await Project.findById(req.params.projectId);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    if (project.owner.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Only project owner can reject bids' });
    }

    const bid = project.bids.id(req.params.bidId);
    if (!bid) return res.status(404).json({ error: 'Bid not found' });

    if (bid.status !== 'pending') {
      return res.status(400).json({ error: 'Can only reject pending bids' });
    }

    bid.status = 'rejected';
    bid.rejectionReason = req.body.reason || 'Not selected';
    project.updatedAt = new Date();
    await project.save();

    res.json({ success: true, message: 'Bid rejected' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to reject bid' });
  }
});

// Request bid modifications - owner asks vendor to revise
app.post('/api/projects/:projectId/bids/:bidId/request-revision', authMiddleware, async (req, res) => {
  try {
    const project = await Project.findById(req.params.projectId);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    if (project.owner.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Only project owner can request revisions' });
    }

    const bid = project.bids.id(req.params.bidId);
    if (!bid) return res.status(404).json({ error: 'Bid not found' });

    if (bid.status !== 'pending') {
      return res.status(400).json({ error: 'Can only request revisions on pending bids' });
    }

    bid.status = 'revision_requested';
    bid.revisionNotes = req.body.notes;
    project.updatedAt = new Date();
    await project.save();

    // Send message to vendor
    const message = new Message({
      sender: req.user._id,
      recipient: bid.user,
      content: `I'd like you to revise your bid for "${project.title}". ${req.body.notes}`,
      type: 'bid_revision_request',
      project: project._id
    });
    await message.save();

    res.json({ success: true, message: 'Revision requested, vendor notified' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to request revision' });
  }
});

// Submit counter-offer - owner makes counter-proposal
app.post('/api/projects/:projectId/bids/:bidId/counter-offer', authMiddleware, async (req, res) => {
  try {
    const project = await Project.findById(req.params.projectId);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    if (project.owner.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Only project owner can make counter-offers' });
    }

    const bid = project.bids.id(req.params.bidId);
    if (!bid) return res.status(404).json({ error: 'Bid not found' });

    if (!bid.counterOffers) bid.counterOffers = [];
    
    bid.counterOffers.push({
      offeredBy: req.user._id,
      amount: req.body.amount,
      timeline: req.body.timeline,
      notes: req.body.notes
    });

    bid.status = 'pending'; // Keep open for vendor response
    project.updatedAt = new Date();
    await project.save();

    // Send message to vendor
    const message = new Message({
      sender: req.user._id,
      recipient: bid.user,
      content: `I have a counter-offer for your bid on "${project.title}": ${formatCurrency(req.body.amount)} for ${req.body.timeline}. ${req.body.notes || ''}`,
      type: 'counter_offer',
      project: project._id,
      structuredData: {
        amount: req.body.amount,
        timeline: req.body.timeline
      }
    });
    await message.save();

    res.json({ success: true, message: 'Counter-offer sent' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to send counter-offer' });
  }
});

// Vendor accepts counter-offer
app.post('/api/projects/:projectId/bids/:bidId/accept-counter', authMiddleware, async (req, res) => {
  try {
    const project = await Project.findById(req.params.projectId);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const bid = project.bids.id(req.params.bidId);
    if (!bid) return res.status(404).json({ error: 'Bid not found' });

    if (bid.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Only bid owner can accept counter-offers' });
    }

    const counterIndex = Number(req.body.counterIndex);
    if (isNaN(counterIndex) || !bid.counterOffers || !bid.counterOffers[counterIndex]) {
      return res.status(400).json({ error: 'Invalid counter-offer' });
    }

    // Update bid with counter-offer terms
    const counter = bid.counterOffers[counterIndex];
    bid.amount = counter.amount;
    bid.timeline = counter.timeline;
    
    // Reject all other bids
    project.bids.forEach(b => {
      if (b._id.toString() !== req.params.bidId) {
        b.status = 'rejected';
      }
    });

    bid.status = 'accepted';
    project.acceptedBid = bid._id;
    project.acceptedContractor = bid.user;
    project.status = 'in_progress';

    await project.save();
    res.json({ success: true, message: 'Counter-offer accepted' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to accept counter-offer' });
  }
});

// ============ MESSAGE ROUTES ============

// Send message
// Send message (with optional attachments)
app.post('/api/messages', authMiddleware, upload.array('attachments', 5), async (req, res) => {
  try {
    const attachments = req.files ? req.files.map(file => ({
      filename: file.originalname,
      url: `/uploads/${file.filename}`,
      mimeType: file.mimetype,
      size: file.size
    })) : [];

    const message = new Message({
      sender: req.user._id,
      recipient: req.body.recipient,
      content: req.body.content,
      type: req.body.type || 'standard',
      project: req.body.project,
      structuredData: req.body.structuredData,
      attachments
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
    console.error('Send message error:', error);
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
    .populate('reactions.user', 'firstName lastName avatar')
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

// Add/toggle reaction to message
app.post('/api/messages/:messageId/react', authMiddleware, async (req, res) => {
  try {
    const { emoji } = req.body;
    if (!emoji) return res.status(400).json({ error: 'Emoji required' });

    const message = await Message.findById(req.params.messageId);
    if (!message) return res.status(404).json({ error: 'Message not found' });

    // Check if user already reacted with this emoji
    const existingReaction = message.reactions.find(
      r => r.user.toString() === req.user._id.toString() && r.emoji === emoji
    );

    if (existingReaction) {
      // Remove the reaction (toggle off)
      message.reactions = message.reactions.filter(
        r => !(r.user.toString() === req.user._id.toString() && r.emoji === emoji)
      );
    } else {
      // Add the reaction
      message.reactions.push({
        emoji,
        user: req.user._id
      });
    }

    await message.save();
    await message.populate('reactions.user', 'firstName lastName avatar');
    
    res.json({ success: true, message });
  } catch (error) {
    console.error('React error:', error);
    res.status(500).json({ error: 'Failed to add reaction' });
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

// Get feed with intelligent ranking algorithm (LinkedIn/Instagram/TikTok-style)
app.get('/api/feed', authMiddleware, async (req, res) => {
  try {
    const currentUser = await User.findById(req.user._id).select('partners skills location city state services');
    
    if (!currentUser) {
      return res.status(401).json({ error: 'User not found' });
    }

    // Fetch projects from all users except current user
    const allProjects = await Project.find({
      owner: { $ne: req.user._id },
      status: 'open',
      deletedAt: { $exists: false }
    })
      .populate('owner', 'firstName lastName avatar company location city state bio skills rating reviewCount projectsCompleted')
      .populate('bids.user', 'firstName lastName avatar')
      .sort({ createdAt: -1 })
      .limit(100); // Get more projects for better ranking

    // Calculate relevance score for each project (algorithm similar to LinkedIn/Indeed/Instagram)
    const scoredProjects = allProjects.map(project => {
      let score = 0;
      const owner = project.owner;
      const daysSincePost = (Date.now() - new Date(project.createdAt)) / (1000 * 60 * 60 * 24);

      // 1. RECENCY SCORE (TikTok/Instagram style - favor recent content)
      // Decay function: newer posts get higher scores
      if (daysSincePost < 1) score += 50; // Less than 1 day: high priority
      else if (daysSincePost < 3) score += 35; // 1-3 days
      else if (daysSincePost < 7) score += 20; // 3-7 days
      else if (daysSincePost < 14) score += 10; // 1-2 weeks
      else score += 5; // Older posts get minimal recency boost

      // 2. CONNECTION STRENGTH (LinkedIn style)
      // Prioritize content from partners (connections)
      if (currentUser.partners && currentUser.partners.some(p => p.toString() === owner._id.toString())) {
        score += 40; // Strong boost for partner content
      }

      // 3. SKILLS MATCH (Indeed/LinkedIn style - job/project relevance)
      const userSkills = currentUser.skills || [];
      const projectSkills = project.skills || [];
      const matchingSkills = projectSkills.filter(skill => 
        userSkills.some(userSkill => userSkill.toLowerCase() === skill.toLowerCase())
      );
      score += matchingSkills.length * 15; // +15 per matching skill

      // 4. LOCATION RELEVANCE (Indeed/LinkedIn style)
      if (owner.location && currentUser.location) {
        if (owner.location.toLowerCase() === currentUser.location.toLowerCase()) {
          score += 25; // Same location exact match
        }
      }
      // City/State matching
      if (owner.city && currentUser.city && owner.city.toLowerCase() === currentUser.city.toLowerCase()) {
        score += 20;
      }
      if (owner.state && currentUser.state && owner.state.toLowerCase() === currentUser.state.toLowerCase()) {
        score += 10;
      }

      // 5. ENGAGEMENT POTENTIAL (Instagram/TikTok style)
      const bidCount = project.bids?.length || 0;
      if (bidCount === 0) score += 15; // Boost new posts with no bids yet (opportunity)
      else if (bidCount < 3) score += 10; // Some activity but not saturated
      else if (bidCount < 5) score += 5; // Moderate activity
      // Posts with too many bids get no boost (likely already filled)

      // 6. BUDGET ATTRACTIVENESS
      // Projects with higher budgets get slight boost (quality signal)
      if (project.budget > 50000) score += 15;
      else if (project.budget > 20000) score += 10;
      else if (project.budget > 5000) score += 5;

      // 7. OWNER REPUTATION (LinkedIn style - verified/quality users)
      if (owner.rating && owner.rating >= 4.5) score += 20; // Highly rated
      else if (owner.rating && owner.rating >= 4.0) score += 15;
      else if (owner.rating && owner.rating >= 3.5) score += 10;

      if (owner.reviewCount && owner.reviewCount > 10) score += 10; // Established user
      if (owner.projectsCompleted && owner.projectsCompleted > 5) score += 10; // Active user

      // 8. CONTENT QUALITY SIGNALS (Instagram/TikTok style)
      // Posts with more details are higher quality
      if (project.description && project.description.length > 200) score += 10;
      if (project.requirements && project.requirements.length > 0) score += 10;
      if (project.images && project.images.length > 0) score += 5;
      if (project.zoomLink) score += 5; // Willing to meet = serious project

      // 9. DIVERSITY FACTOR (Prevent feed from being dominated by one user)
      // This will be applied after initial scoring
      
      return {
        project,
        score,
        daysSincePost
      };
    });

    // Sort by score (highest first)
    scoredProjects.sort((a, b) => b.score - a.score);

    // 10. APPLY DIVERSITY FILTER (Instagram/TikTok style)
    // Don't show more than 2 consecutive posts from same user
    const diversifiedFeed = [];
    const recentOwners = [];
    const maxConsecutive = 2;

    for (const item of scoredProjects) {
      const ownerId = item.project.owner._id.toString();
      
      // Check if this owner appears in last N posts
      const recentCount = recentOwners.filter(id => id === ownerId).length;
      
      if (recentCount < maxConsecutive) {
        diversifiedFeed.push(item.project);
        recentOwners.push(ownerId);
        
        // Keep only last 5 owners in memory for diversity check
        if (recentOwners.length > 5) {
          recentOwners.shift();
        }
      }
      
      // Limit feed to 20 items
      if (diversifiedFeed.length >= 20) break;
    }

    // Add debug info in development
    const feedWithScores = diversifiedFeed.map((project, index) => {
      const scoreInfo = scoredProjects.find(sp => sp.project._id.toString() === project._id.toString());
      return {
        ...project.toObject(),
        _feedScore: process.env.NODE_ENV === 'development' ? scoreInfo?.score : undefined,
        _feedRank: index + 1
      };
    });

    res.json({ 
      feed: feedWithScores,
      total: diversifiedFeed.length,
      algorithm: 'v1.0-intelligent-ranking'
    });
  } catch (error) {
    console.error('Feed error:', error);
    res.status(500).json({ error: 'Failed to fetch feed', message: error.message });
  }
});

// Get recommended users with intelligent matching (LinkedIn/Indeed style)
app.get('/api/recommendations', authMiddleware, async (req, res) => {
  try {
    const currentUser = await User.findById(req.user._id).select('skills location city state partners services');
    
    if (!currentUser) {
      return res.status(401).json({ error: 'User not found' });
    }

    const partnerIds = (currentUser.partners || []).map(p => p.toString());

    // Find potential matches
    const allUsers = await User.find({
      _id: { $ne: req.user._id, $nin: partnerIds },
      deletedAt: { $exists: false }
    })
      .select('firstName lastName avatar company location city state bio skills services rating reviewCount projectsCompleted yearsExperience')
      .limit(50);

    // Score each user for recommendation relevance
    const scoredUsers = allUsers.map(user => {
      let score = 0;

      // 1. SKILLS MATCH (Primary factor - LinkedIn/Indeed style)
      const userSkills = currentUser.skills || [];
      const theirSkills = user.skills || [];
      const matchingSkills = theirSkills.filter(skill => 
        userSkills.some(userSkill => userSkill.toLowerCase().includes(skill.toLowerCase()) || 
                                     skill.toLowerCase().includes(userSkill.toLowerCase()))
      );
      score += matchingSkills.length * 20; // High weight for skill matches

      // 2. LOCATION PROXIMITY
      if (user.location && currentUser.location) {
        if (user.location.toLowerCase() === currentUser.location.toLowerCase()) {
          score += 30; // Same location
        }
      }
      if (user.city && currentUser.city && user.city.toLowerCase() === currentUser.city.toLowerCase()) {
        score += 25; // Same city
      }
      if (user.state && currentUser.state && user.state.toLowerCase() === currentUser.state.toLowerCase()) {
        score += 15; // Same state
      }

      // 3. SERVICES MATCH (What they offer vs what you might need)
      const userServices = currentUser.services || [];
      const theirServices = user.services || [];
      const matchingServices = theirServices.filter(service => 
        userServices.some(userService => userService.toLowerCase() === service.toLowerCase())
      );
      score += matchingServices.length * 15;

      // 4. REPUTATION & QUALITY
      if (user.rating && user.rating >= 4.5) score += 25;
      else if (user.rating && user.rating >= 4.0) score += 20;
      else if (user.rating && user.rating >= 3.5) score += 15;

      if (user.reviewCount && user.reviewCount > 20) score += 15; // Well-reviewed
      else if (user.reviewCount && user.reviewCount > 10) score += 10;
      else if (user.reviewCount && user.reviewCount > 5) score += 5;

      if (user.projectsCompleted && user.projectsCompleted > 20) score += 15; // Very experienced
      else if (user.projectsCompleted && user.projectsCompleted > 10) score += 10;
      else if (user.projectsCompleted && user.projectsCompleted > 5) score += 5;

      // 5. PROFILE COMPLETENESS (Quality signal)
      if (user.bio && user.bio.length > 100) score += 10;
      if (user.company) score += 10;
      if (user.avatar) score += 5;
      if (user.yearsExperience && user.yearsExperience > 5) score += 10;

      // 6. ACTIVITY LEVEL (Active users are more valuable)
      if (user.projectsCompleted && user.projectsCompleted > 0) {
        score += 10; // Has completed projects
      }

      return { user, score };
    });

    // Sort by score and return top 10
    scoredUsers.sort((a, b) => b.score - a.score);
    const topRecommendations = scoredUsers.slice(0, 10).map(item => item.user);

    res.json({ 
      recommendations: topRecommendations,
      algorithm: 'v1.0-intelligent-matching'
    });
  } catch (error) {
    console.error('Recommendations error:', error);
    res.status(500).json({ error: 'Failed to fetch recommendations', message: error.message });
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
