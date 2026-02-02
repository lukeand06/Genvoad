const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const jwksClient = require('jwks-rsa');
require('dotenv').config();

const User = require('./models/User');
const Project = require('./models/Project');
const Message = require('./models/Message');
const Review = require('./models/Review');
const Notification = require('./models/Notification');
const Company = require('./models/Company');
const Post = require('./models/Post');
const { sendVerificationEmail, sendEmail } = require('./utils/email');

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

// Avatar uploads: use memory storage + resize & persist in DB via data URL
const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB for avatars
});

// Trust proxy - important for HTTPS when behind reverse proxy (Heroku, Vercel, AWS, Cloudflare, etc)
// This ensures req.protocol and req.headers['x-forwarded-proto'] are correctly interpreted
app.set('trust proxy', 1);

// Handle HTTPS and non-www to www redirects FIRST (before CORS)
app.use((req, res, next) => {
  const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'https';
  let host = req.headers.host;
  const canonicalHost = 'www.genovad.com';
  
  // Force HTTPS in production
  if (process.env.NODE_ENV === 'production' && protocol !== 'https') {
    return res.redirect(301, `https://${host}${req.originalUrl}`);
  }
  
  // Redirect non-www to www (canonical)
  if (process.env.NODE_ENV === 'production' && host && !host.startsWith('www.')) {
    return res.redirect(301, `https://${canonicalHost}${req.originalUrl}`);
  }
  
  next();
});

// Middleware
// Allow multiple origins for development
const allowedOrigins = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:5000',
  'http://127.0.0.1:5000',
  'http://localhost:8000',
  'https://www.genovad.com',
  'https://genovad.com',
  'http://www.genovad.com',
  'http://genovad.com',
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
  // Serve static files with NO CACHE for HTML to ensure updates are immediate
  app.use(express.static('.', {
    setHeaders: (res, path) => {
      if (path.endsWith('.html')) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
      }
    }
  }));
}
// Serve public files with short cache for JS to allow quick updates
app.use('/public', express.static('public', {
  setHeaders: (res, path) => {
    if (path.endsWith('.js')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate'); // No cache for JS
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }
}));
app.use('/uploads', express.static(uploadDir));

// Serve sitemap.xml with correct content type
app.get('/sitemap.xml', (req, res) => {
  res.setHeader('Content-Type', 'application/xml');
  res.sendFile(require('path').join(__dirname, 'sitemap.xml'));
});

// Serve robots.txt with correct content type
app.get('/robots.txt', (req, res) => {
  res.setHeader('Content-Type', 'text/plain');
  res.sendFile(require('path').join(__dirname, 'robots.txt'));
});

// Connect to MongoDB
if (process.env.MONGODB_URI) {
  mongoose.connect(process.env.MONGODB_URI)
    .then(async () => {
      console.log('✓ Connected to MongoDB');
      
      // Fix indexes: drop old unique email index if it exists
      try {
        const userCollection = mongoose.connection.collection('users');
        const indexes = await userCollection.getIndexes();
        
        // Drop old email unique index if it exists
        if (indexes['email_1']) {
          console.log('Dropping old email index...');
          await userCollection.dropIndex('email_1');
        }
        
        // Ensure new compound index exists
        await userCollection.createIndex(
          { email: 1, role: 1 },
          { unique: true, sparse: true }
        );
        console.log('✓ Database indexes configured correctly');
      } catch (indexError) {
        console.warn('⚠ Index configuration warning:', indexError.message);
      }
    })
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
    
    // Check existing - same email can be used for different roles
    const existing = await User.findOne({ 
      email: email.toLowerCase(),
      role: normalizedRole 
    });
    if (existing && existing.emailVerified) {
      return res.status(400).json({ error: `This email is already registered as a ${normalizedRole}. Please use a different email or login to your existing account.` });
    }
    
    // If unverified account exists, delete it to allow fresh signup
    if (existing && !existing.emailVerified) {
      await User.deleteOne({ _id: existing._id });
    }
    
    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Generate verification code
    const verificationCode = Math.random().toString().slice(2, 8).padStart(6, '0');
    const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
    
    // Create user with single role
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
    
    // Handle duplicate key errors
    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern)[0];
      const value = error.keyValue[field];
      if (field === 'email') {
        return res.status(400).json({ error: `This email is already registered. Please use a different email or login to your existing account.` });
      }
      return res.status(400).json({ error: `This ${field} is already in use.` });
    }
    
    // Handle validation errors
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map(e => e.message);
      return res.status(400).json({ error: messages[0] || 'Validation failed' });
    }
    
    res.status(500).json({ error: 'Signup failed. Please try again.' });
  }
});

// Resend verification code
app.post('/api/auth/resend', async (req, res) => {
  try {
    const { email, role } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });

    let query = { email: email.toLowerCase() };
    if (role && ['owner', 'vendor'].includes(role)) {
      query.role = role;
    }

    const user = await User.findOne(query);
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
    const { email, code, role } = req.body;
    
    // If role is provided, use it to find the correct user account
    let query = { email: email.toLowerCase() };
    if (role && ['owner', 'vendor'].includes(role)) {
      query.role = role;
    }
    
    const user = await User.findOne(query);
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

// Login (role-aware)
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password, role } = req.body;
    const requestedRole = ['owner', 'vendor'].includes(role) ? role : null;
    if (!requestedRole) {
      return res.status(400).json({ error: 'Role is required (owner or vendor)' });
    }
    
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user || user.deletedAt) return res.status(401).json({ error: 'Invalid credentials' });
    
    if (!user.emailVerified) {
      return res.status(403).json({ error: 'Please verify your email first' });
    }
    
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) return res.status(401).json({ error: 'Invalid credentials' });
    
    // Enforce account type: each account has exactly one role
    if (user.role !== requestedRole) {
      const currentRoleLabel = user.role === 'vendor' ? 'Vendor / Service Provider' : 'Project Owner';
      const requestedRoleLabel = requestedRole === 'vendor' ? 'Vendor / Service Provider' : 'Project Owner';
      return res.status(403).json({ error: `This account is registered as a ${currentRoleLabel}. Please sign up with a ${requestedRoleLabel} account to continue.` });
    }
    
    // Update last active
    user.lastActive = new Date();
    await user.save();
    
    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' });
    
    res.json({
      success: true,
      token,
      user: {
        _id: user._id,
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
        authProvider: user.authProvider,
        companyId: user.companyId,
        companyRole: user.companyRole
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Social login (role-aware)
app.post('/api/auth/social', async (req, res) => {
  try {
    const { provider, idToken, role } = req.body;

    if (!provider || !idToken) {
      return res.status(400).json({ error: 'Provider and token are required' });
    }

    if (!providerEnabled(provider)) {
      return res.status(400).json({ error: `${provider} sign-in is not configured` });
    }

    const requestedRole = ['owner', 'vendor'].includes(role) ? role : null;
    if (!requestedRole) {
      return res.status(400).json({ error: 'Role is required (owner or vendor)' });
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

    if (user) {
      // Existing user - role must match exactly (no role switching)
      if (user.role !== requestedRole) {
        return res.status(403).json({ error: `This account is registered as a ${user.role}. Please use the ${user.role} login or create a separate ${requestedRole} account with a different email.` });
      }

      user.firstName = user.firstName || firstName;
      user.lastName = user.lastName || lastName;
      user.authProvider = provider;
      user.providerId = decoded.sub || user.providerId;
      user.emailVerified = true;
      user.lastActive = new Date();
      await user.save();
    } else {
      // New user - create with single role
      const placeholderPassword = await generatePlaceholderPassword();
      user = new User({
        firstName,
        lastName,
        email,
        password: placeholderPassword,
        role: requestedRole,
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

// Search users by name, company, or email
app.get('/api/users/search', authMiddleware, async (req, res) => {
  try {
    const query = req.query.q || '';
    const roleFilter = req.query.role; // Optional role filter: 'vendor' or 'owner'
    
    if (query.length < 2) {
      return res.json({ users: [] });
    }
    
    // Check if it's an email format
    const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(query);
    
    if (isEmail) {
      // Search for registered user with this email
      const searchQuery = { email: query, verified: true, deletedAt: null };
      if (roleFilter) {
        searchQuery.role = roleFilter;
      }
      const user = await User.findOne(searchQuery).select('-password -verificationCode');
      if (user) {
        return res.json({ users: [{
          _id: user._id,
          firstName: user.firstName,
          lastName: user.lastName,
          name: `${user.firstName} ${user.lastName}`,
          email: user.email,
          company: user.company,
          role: user.role,
          isRegistered: true
        }] });
      } else {
        // Allow inviting by email even if not registered
        return res.json({ users: [{
          _id: null,
          name: query,
          email: query,
          company: null,
          isRegistered: false
        }] });
      }
    }
    
    // Text search by name or company
    const searchRegex = new RegExp(query, 'i');
    const searchQuery = {
      verified: true,
      deletedAt: null,
      $or: [
        { firstName: searchRegex },
        { lastName: searchRegex },
        { company: searchRegex }
      ]
    };
    
    // Add role filter if specified
    if (roleFilter) {
      searchQuery.role = roleFilter;
    }
    
    const users = await User.find(searchQuery)
    .select('-password -verificationCode')
    .limit(10);
    
    const results = users.map(u => ({
      _id: u._id,
      firstName: u.firstName,
      lastName: u.lastName,
      name: `${u.firstName} ${u.lastName}`,
      email: u.email,
      company: u.company,
      role: u.role,
      isRegistered: true
    }));
    
    res.json({ users: results });
  } catch (error) {
    console.error('User search error:', error);
    res.status(500).json({ error: 'Failed to search users' });
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

// Upload profile picture
app.post('/api/users/avatar', authMiddleware, avatarUpload.single('avatar'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Process image: resize to 256x256 and compress
    const processed = await sharp(req.file.buffer)
      .resize(256, 256, { fit: 'cover' })
      .toFormat('jpeg', { quality: 85 })
      .toBuffer();

    const avatarDataUrl = `data:image/jpeg;base64,${processed.toString('base64')}`;

    const user = await User.findByIdAndUpdate(
      req.user._id,
      { $set: { avatar: avatarDataUrl } },
      { new: true }
    ).select('-password');

    res.json({ success: true, avatar: avatarDataUrl, user });
  } catch (error) {
    console.error('Avatar upload error:', error);
    res.status(500).json({ error: 'Failed to upload profile picture' });
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

// Block user
app.post('/api/users/:userId/block', authMiddleware, async (req, res) => {
  try {
    const userId = req.params.userId;
    if (userId === req.user._id.toString()) {
      return res.status(400).json({ error: 'Cannot block yourself' });
    }
    
    await User.findByIdAndUpdate(req.user._id, { 
      $addToSet: { blockedUsers: userId },
      $pull: { partners: userId }
    });
    
    // Remove from their partners too
    await User.findByIdAndUpdate(userId, { $pull: { partners: req.user._id } });
    
    res.json({ success: true, message: 'User blocked' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to block user' });
  }
});

// Unblock user
app.delete('/api/users/:userId/block', authMiddleware, async (req, res) => {
  try {
    const userId = req.params.userId;
    await User.findByIdAndUpdate(req.user._id, { $pull: { blockedUsers: userId } });
    res.json({ success: true, message: 'User unblocked' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to unblock user' });
  }
});

// Get blocked users
app.get('/api/users/blocked', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
      .populate('blockedUsers', 'firstName lastName avatar company')
      .select('blockedUsers');
    res.json({ blockedUsers: user.blockedUsers || [] });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch blocked users' });
  }
});

// ============ PROJECT ROUTES ============

// Download attachment endpoint
app.get('/api/download/:filename', (req, res) => {
  try {
    const filename = req.params.filename;
    const filepath = path.join(uploadDir, filename);
    
    // Security check: ensure the file path doesn't escape the upload directory
    const resolvedPath = path.resolve(filepath);
    const resolvedUploadDir = path.resolve(uploadDir);
    if (!resolvedPath.startsWith(resolvedUploadDir)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    // Check if file exists
    if (!fs.existsSync(filepath)) {
      return res.status(404).json({ error: 'File not found' });
    }
    
    // Get original filename from the file (remove timestamp prefix)
    const originalFilename = filename.includes('-') ? filename.substring(filename.indexOf('-') + 1) : filename;
    
    // Set headers for download
    res.setHeader('Content-Disposition', `attachment; filename="${originalFilename}"`);
    res.setHeader('Content-Type', 'application/octet-stream');
    
    // Send file
    res.sendFile(filepath);
  } catch (error) {
    console.error('Download error:', error);
    res.status(500).json({ error: 'Failed to download file' });
  }
});

// Create project
app.post('/api/projects', authMiddleware, upload.array('attachments', 10), async (req, res) => {
  try {
    // Validate required fields
    const { title, description, category, budget, location } = req.body;
    
    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'Project title is required' });
    }
    if (!description || !description.trim()) {
      return res.status(400).json({ error: 'Project description is required' });
    }
    if (!category) {
      return res.status(400).json({ error: 'Category is required' });
    }
    if (!budget) {
      return res.status(400).json({ error: 'Budget is required' });
    }
    if (!location || !location.trim()) {
      return res.status(400).json({ error: 'Location is required' });
    }

    // Validate budget is a number
    const budgetNum = parseFloat(budget);
    if (isNaN(budgetNum) || budgetNum <= 0) {
      return res.status(400).json({ error: 'Budget must be a positive number' });
    }

    // Check authentication
    if (!req.user || !req.user._id) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const projectData = {
      title: title.trim(),
      description: description.trim(),
      category: category,
      budget: budgetNum,
      projectSize: req.body.projectSize || 'custom',
      budgetPublic: req.body.budgetPublic === true || req.body.budgetPublic === 'true',
      location: location.trim(),
      owner: req.user._id,
      requirements: [],
      skills: []
    };

    // Optional target price
    if (req.body.targetPrice) {
      const targetNum = parseFloat(req.body.targetPrice);
      if (!isNaN(targetNum) && targetNum > 0) {
        projectData.targetPrice = targetNum;
      }
    }

    // Parse arrays from form data
    if (req.body.requirements) {
      if (typeof req.body.requirements === 'string') {
        projectData.requirements = req.body.requirements.split(',').map(r => r.trim()).filter(r => r);
      } else if (Array.isArray(req.body.requirements)) {
        projectData.requirements = req.body.requirements.map(r => String(r).trim()).filter(r => r);
      }
    }

    if (req.body.skills) {
      if (typeof req.body.skills === 'string') {
        projectData.skills = req.body.skills.split(',').map(s => s.trim()).filter(s => s);
      } else if (Array.isArray(req.body.skills)) {
        projectData.skills = req.body.skills.map(s => String(s).trim()).filter(s => s);
      }
    }

    // Add optional fields
    if (req.body.startDate) projectData.startDate = req.body.startDate;
    if (req.body.endDate) projectData.endDate = req.body.endDate;
    if (req.body.zoomLink) projectData.zoomLink = req.body.zoomLink;
    if (req.body.meetingDate) projectData.meetingDate = req.body.meetingDate;

    // Handle file uploads
    if (req.files && req.files.length > 0) {
      projectData.attachments = req.files.map(file => ({
        filename: file.originalname,
        url: `/uploads/${file.filename}`,
        storedFilename: file.filename,
        uploadedAt: new Date()
      }));
    }

    const project = new Project(projectData);
    const savedProject = await project.save();
    
    // Populate owner before returning
    const populatedProject = await Project.findById(savedProject._id)
      .populate('owner', 'firstName lastName avatar company');
    
    res.json({ success: true, project: populatedProject });
  } catch (error) {
    console.error('Error creating project:', error);
    
    // Handle mongoose validation errors
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({ error: messages.join('; ') });
    }
    
    res.status(500).json({ error: 'Failed to create project: ' + error.message });
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
    
    console.log('Fetching projects with query:', query);
    
    const projects = await Project.find(query)
      .populate('owner', 'firstName lastName avatar company')
      .populate('bids.user', 'firstName lastName avatar company')
      .sort('-createdAt')
      .limit(50);
    
    console.log(`Found ${projects.length} projects`);
    
    res.json({ projects });
  } catch (error) {
    console.error('Failed to fetch projects:', error);
    res.status(500).json({ error: 'Failed to fetch projects' });
  }
});

// Get my projects (projects posted by current user)
app.get('/api/my-projects', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const user = await User.findById(userId);
    
    console.log('Fetching my projects for user:', userId, 'role:', user.role);
    
    let projects;
    
    if (user.role === 'vendor') {
      // For vendors, return projects they've bid on
      projects = await Project.find({ 'bids.user': userId })
        .populate('owner', 'firstName lastName avatar company')
        .populate('bids.user', 'firstName lastName avatar company')
        .sort('-createdAt')
        .limit(50);
      
      // Add bid info for each project
      projects = projects.map(project => {
        const projectObj = project.toObject();
        const userBid = projectObj.bids.find(bid => bid.user._id.toString() === userId.toString());
        projectObj.myBid = userBid;
        return projectObj;
      });
      
      console.log(`Found ${projects.length} projects with bids from user ${userId}`);
    } else {
      // For owners, return projects they own
      projects = await Project.find({ owner: userId })
        .populate('owner', 'firstName lastName avatar company')
        .populate('bids.user', 'firstName lastName avatar company')
        .sort('-createdAt')
        .limit(50);
      
      console.log(`Found ${projects.length} projects owned by user ${userId}`);
    }
    
    res.json({ projects });
  } catch (error) {
    console.error('Failed to fetch my projects:', error);
    res.status(500).json({ error: 'Failed to fetch my projects' });
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

// Update project meeting and resources (owner only)
app.post('/api/projects/:id/update-meeting', authMiddleware, upload.array('attachments', 10), async (req, res) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    
    // Verify ownership
    if (project.owner.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Only project owner can update this project' });
    }
    
    // Update meeting details
    if (req.body.meetingDate) project.meetingDate = req.body.meetingDate;
    if (req.body.zoomLink) project.zoomLink = req.body.zoomLink;
    
    // Handle new file uploads
    if (req.files && req.files.length > 0) {
      const newAttachments = req.files.map(file => ({
        filename: file.originalname,
        url: `/uploads/${file.filename}`,
        storedFilename: file.filename,
        uploadedAt: new Date()
      }));
      
      // Append to existing attachments instead of replacing
      project.attachments = [...(project.attachments || []), ...newAttachments];
    }
    
    await project.save();
    res.json({ success: true, message: 'Meeting and resources updated successfully', project });
  } catch (error) {
    console.error('Update meeting error:', error);
    res.status(500).json({ error: 'Failed to update meeting details' });
  }
});

// Site Visit Availability: get current schedules
app.get('/api/projects/:id/site-visit', authMiddleware, async (req, res) => {
  try {
    const project = await Project.findById(req.params.id)
      .populate('owner', 'firstName lastName email')
      .populate({
        path: 'siteVisit.vendorAvailabilities.vendor',
        select: 'firstName lastName email'
      });
    if (!project) return res.status(404).json({ error: 'Project not found' });

    res.json({ success: true, siteVisit: project.siteVisit || {} });
  } catch (error) {
    console.error('Get site visit error:', error);
    res.status(500).json({ error: 'Failed to load site visit availability' });
  }
});

// Site Visit Availability: submit or update availability for owner or vendor
app.post('/api/projects/:id/site-visit', authMiddleware, async (req, res) => {
  try {
    const { slots, contactForMoreInfo } = req.body;
    const project = await Project.findById(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    // Ensure container exists
    if (!project.siteVisit) {
      project.siteVisit = { ownerAvailability: [], ownerContactForMoreInfo: false, vendorAvailabilities: [] };
    }

    const normalizedSlots = Array.isArray(slots)
      ? slots.filter(s => typeof s === 'string' && s.trim()).map(s => s.trim())
      : (typeof slots === 'string' ? slots.split('\n').map(s => s.trim()).filter(Boolean) : []);

    const isOwner = project.owner?.toString() === req.user._id.toString();

    if (isOwner) {
      // Owner updates their availability
      project.siteVisit.ownerAvailability = normalizedSlots;
      project.siteVisit.ownerContactForMoreInfo = Boolean(contactForMoreInfo);
    } else {
      // Vendor updates (create or update their entry)
      const idx = (project.siteVisit.vendorAvailabilities || []).findIndex(v => v.vendor?.toString() === req.user._id.toString());
      const entry = {
        vendor: req.user._id,
        slots: normalizedSlots,
        contactForMoreInfo: Boolean(contactForMoreInfo),
        submittedAt: new Date()
      };
      if (idx >= 0) {
        project.siteVisit.vendorAvailabilities[idx] = entry;
      } else {
        project.siteVisit.vendorAvailabilities.push(entry);
      }
    }

    project.updatedAt = new Date();
    await project.save();

    const populated = await Project.findById(project._id).populate({
      path: 'siteVisit.vendorAvailabilities.vendor',
      select: 'firstName lastName email'
    });

    res.json({ success: true, siteVisit: populated.siteVisit });
  } catch (error) {
    console.error('Update site visit error:', error);
    res.status(500).json({ error: 'Failed to update site visit availability' });
  }
});

// Delete project attachment
app.delete('/api/projects/:id/attachments/:filename', authMiddleware, async (req, res) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    
    // Verify ownership
    if (project.owner.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Only project owner can delete attachments' });
    }
    
    const filename = req.params.filename;
    
    // Remove from attachments array
    const initialLength = project.attachments.length;
    project.attachments = project.attachments.filter(att => att.url !== `/uploads/${filename}`);
    
    if (project.attachments.length === initialLength) {
      return res.status(404).json({ error: 'Attachment not found' });
    }
    
    // Delete file from disk
    const filepath = path.join(uploadDir, filename);
    if (fs.existsSync(filepath)) {
      fs.unlinkSync(filepath);
    }
    
    await project.save();
    res.json({ success: true, message: 'Attachment deleted successfully' });
  } catch (error) {
    console.error('Delete attachment error:', error);
    res.status(500).json({ error: 'Failed to delete attachment' });
  }
});

// Submit bid
app.post('/api/projects/:id/bids', authMiddleware, async (req, res) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    
    // Check if bidding is locked
    if (project.biddingLocked) {
      return res.status(400).json({ error: 'Bidding is currently locked for this project' });
    }
    
    // Check if already bid
    const existingBid = project.bids.find(b => b.user.toString() === req.user._id.toString());
    if (existingBid) return res.status(400).json({ error: 'Already submitted bid' });
    
    const bidData = {
      user: req.user._id,
      proposal: req.body.proposal,
      timeline: req.body.timeline,
      priceRange: req.body.priceRange || 'exact',
      phone: req.body.phone || '',
      siteWalkTime: req.body.siteWalkTime || ''
    };
    
    // Amount is optional if using price range
    if (req.body.amount) {
      bidData.amount = req.body.amount;
    }
    
    project.bids.push(bidData);
    
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
    
    // Send notification to contractor
    await createNotification(
      bid.user,
      'bid_accepted',
      'bids',
      {
        projectId: project._id,
        projectTitle: project.title,
        bidAmount: bid.amount,
        message: `Your bid of ${formatCurrency(bid.amount)} has been accepted!`
      }
    );
    
    // Notify rejected bidders
    for (const b of project.bids) {
      if (b._id.toString() !== req.params.bidId && b.status === 'rejected') {
        await createNotification(
          b.user,
          'bid_rejected',
          'bids',
          {
            projectId: project._id,
            projectTitle: project.title,
            message: 'The project owner has selected another bid.'
          }
        );
      }
    }
    
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
    
    // Check if bidding is locked
    if (project.biddingLocked) {
      return res.status(400).json({ error: 'Bidding is locked - cannot edit bids at this time' });
    }

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

// Lock bidding - prevents new bids and bid edits during decision process
app.post('/api/projects/:id/lock-bidding', authMiddleware, async (req, res) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    
    if (project.owner.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Only project owner can lock bidding' });
    }
    
    if (project.status !== 'open') {
      return res.status(400).json({ error: 'Can only lock bidding on open projects' });
    }
    
    project.biddingLocked = true;
    project.updatedAt = new Date();
    await project.save();
    
    res.json({ success: true, message: 'Bidding locked' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to lock bidding' });
  }
});

// Unlock bidding - allows new bids and bid edits again
app.post('/api/projects/:id/unlock-bidding', authMiddleware, async (req, res) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    
    if (project.owner.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Only project owner can unlock bidding' });
    }
    
    project.biddingLocked = false;
    project.updatedAt = new Date();
    await project.save();
    
    res.json({ success: true, message: 'Bidding unlocked' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to unlock bidding' });
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
    bid.revisionNotes = req.body.notes || 'Please revise your bid';
    project.updatedAt = new Date();
    await project.save();

    // Send message to vendor
    try {
      const message = new Message({
        sender: req.user._id,
        recipient: bid.user,
        content: `I'd like you to revise your bid for "${project.title}". ${req.body.notes || 'Please see project details for more information.'}`,
        type: 'bid_revision_request',
        project: project._id
      });
      await message.save();
    } catch (msgError) {
      console.error('Failed to send revision message:', msgError);
      // Continue even if message fails - the bid status is updated
    }

    res.json({ success: true, message: 'Revision requested, vendor notified' });
  } catch (error) {
    console.error('Request revision error:', error);
    res.status(500).json({ error: 'Failed to request revision: ' + error.message });
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

// Lock bid for decision
app.post('/api/projects/:projectId/lock-for-decision', authMiddleware, async (req, res) => {
  try {
    const project = await Project.findById(req.params.projectId);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    // Check if user is project owner
    if (project.owner.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Only project owner can lock project' });
    }

    const { notes } = req.body;

    // Lock the entire project for decision
    project.biddingLocked = true;
    
    // Log activity
    project.activityLog.push({
      actor: req.user._id,
      action: 'locked_project_for_decision',
      details: `Locked project for final decision${notes ? ': ' + notes : ''}`,
      timestamp: new Date()
    });

    await project.save();

    // Create notification for all bidders
    const allBidders = project.bids.map(b => b.user);

    for (const bidderId of allBidders) {
      await Notification.create({
        user: bidderId,
        type: 'project_locked',
        title: 'Project Locked for Decision',
        message: `The owner of ${project.title} has locked the project for final decision. No new bids can be submitted.`,
        relatedProject: project._id
      });
    }

    res.json({ success: true, message: 'Project locked for decision' });
  } catch (error) {
    console.error('Lock project error:', error);
    res.status(500).json({ error: 'Failed to lock project' });
  }
});

// Unlock project
app.post('/api/projects/:projectId/unlock', authMiddleware, async (req, res) => {
  try {
    const project = await Project.findById(req.params.projectId);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    // Check if user is project owner
    if (project.owner.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Only project owner can unlock project' });
    }

    if (!project.biddingLocked) {
      return res.status(400).json({ error: 'Project is not locked' });
    }

    // Unlock the project
    project.biddingLocked = false;

    // Log activity
    project.activityLog.push({
      actor: req.user._id,
      action: 'unlocked_project',
      details: 'Unlocked project - bidding reopened',
      timestamp: new Date()
    });

    await project.save();

    // Notify all bidders that bidding is open again
    const allBidders = project.bids.map(b => b.user);

    for (const bidderId of allBidders) {
      await Notification.create({
        user: bidderId,
        type: 'project_unlocked',
        title: 'Bidding Reopened',
        message: `The project owner has reopened bidding for ${project.title}. You can now submit or revise your bid.`,
        relatedProject: project._id
      });
    }

    res.json({ success: true, message: 'Project unlocked' });
  } catch (error) {
    console.error('Unlock project error:', error);
    res.status(500).json({ error: 'Failed to unlock project' });
  }
});

// Invite vendor to bid on project
app.post('/api/projects/:projectId/invite-vendor', authMiddleware, async (req, res) => {
  try {
    const project = await Project.findById(req.params.projectId).populate('owner');
    if (!project) return res.status(404).json({ error: 'Project not found' });

    // Check if user is project owner
    if (project.owner._id.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Only project owner can invite vendors' });
    }

    const { vendorId, email, message } = req.body;

    if (!vendorId && !email) {
      return res.status(400).json({ error: 'Vendor ID or email is required' });
    }

    let vendor = null;
    if (vendorId) {
      vendor = await User.findById(vendorId);
      if (!vendor) return res.status(404).json({ error: 'Vendor not found' });
    }

    // Check if already bid
    if (vendor && project.bids.some(b => b.user.toString() === vendor._id.toString())) {
      return res.status(400).json({ error: 'Vendor has already bid on this project' });
    }

    const ownerName = project.owner.company || `${project.owner.firstName} ${project.owner.lastName}`;

    if (vendor) {
      // Send in-app notification
      await Notification.create({
        user: vendor._id,
        type: 'vendor_invite',
        title: 'You\'re Invited to Bid',
        message: `${ownerName} invited you to bid on ${project.title}. Budget: $${project.budget?.toLocaleString() || 'TBD'}`,
        relatedProject: project._id
      });

      res.json({ success: true, message: 'Vendor invited to bid' });
    } else if (email) {
      // Send email invite
      const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%); padding: 30px; text-align: center; border-radius: 8px 8px 0 0;">
            <h1 style="color: white; margin: 0; font-size: 28px;">Genovad</h1>
            <p style="color: #e0e0e0; margin: 10px 0 0 0;">Construction Marketplace</p>
          </div>
          
          <div style="background: white; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
            <h2 style="color: #1a1a1a; margin-top: 0;">You're Invited to Bid!</h2>
            
            <p><strong>${ownerName}</strong> has invited you to bid on a construction project:</p>
            
            <div style="background: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #1a1a1a;">
              <h3 style="color: #1a1a1a; margin-top: 0;">${project.title}</h3>
              <p><strong>Budget:</strong> $${project.budget?.toLocaleString() || 'TBD'}</p>
              <p><strong>Location:</strong> ${project.location}</p>
              <p><strong>Category:</strong> ${project.category}</p>
              ${project.description ? `<p><strong>Details:</strong> ${project.description}</p>` : ''}
            </div>
            
            ${message ? `
              <div style="background: #f0f0f0; padding: 15px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #1a1a1a;">
                <p style="margin: 0;"><strong>Message from ${ownerName}:</strong></p>
                <p style="margin: 10px 0 0 0;">${message}</p>
              </div>
            ` : ''}
            
            <p style="margin-top: 30px;">
              Ready to bid? Join Genovad and start bidding on projects that match your expertise.
            </p>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="${process.env.APP_URL || 'http://localhost:3000'}/signup.html" 
                 style="display: inline-block; background: #1a1a1a; color: white; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px;">
                Join & Bid Now
              </a>
            </div>
            
            <p style="color: #6b7280; font-size: 14px; margin-top: 30px;">
              Already have an account? <a href="${process.env.APP_URL || 'http://localhost:3000'}/vendor-login.html" style="color: #1a1a1a;">Log in</a> to bid immediately.
            </p>
          </div>
          
          <div style="text-align: center; margin-top: 20px; color: #9ca3af; font-size: 12px;">
            <p>Genovad - Connecting construction professionals</p>
          </div>
        </body>
        </html>
      `;

      await sendEmail(
        email,
        `${ownerName} invited you to bid on ${project.title}`,
        htmlContent,
        'noreply@genovad.com'
      );

      res.json({ success: true, message: 'Email invitation sent to vendor' });
    }
  } catch (error) {
    console.error('Invite vendor error:', error);
    res.status(500).json({ error: 'Failed to invite vendor' });
  }
});

// Send email invite to non-Genovad user
app.post('/api/messages/email-invite', authMiddleware, async (req, res) => {
  try {
    const { email, subject, message, projectId } = req.body;
    
    if (!email || !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Valid email is required' });
    }
    
    const sender = await User.findById(req.user._id);
    if (!sender) return res.status(404).json({ error: 'Sender not found' });
    
    const senderName = sender.company || `${sender.firstName} ${sender.lastName}`;
    let projectInfo = '';
    
    if (projectId) {
      const project = await Project.findById(projectId);
      if (project) {
        projectInfo = `<div style=\"margin: 20px 0; padding: 15px; background: #f3f4f6; border-left: 4px solid #1a1a1a; border-radius: 4px;\">
          <strong>Related Project:</strong> ${project.title}<br>
          <strong>Budget:</strong> $${project.budget?.toLocaleString()}<br>
          <strong>Location:</strong> ${project.location}
        </div>`;
      }
    }
    
    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset=\"UTF-8\">
        <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">
      </head>
      <body style=\"font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;\">
        <div style=\"background: linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%); padding: 30px; text-align: center; border-radius: 8px 8px 0 0;\">
          <h1 style=\"color: white; margin: 0; font-size: 28px;\">Genovad</h1>
          <p style=\"color: #e0e0e0; margin: 10px 0 0 0;\">Construction Marketplace</p>
        </div>
        
        <div style=\"background: white; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;\">
          <h2 style=\"color: #1a1a1a; margin-top: 0;\">${subject || 'You have a message on Genovad'}</h2>
          
          <p><strong>${senderName}</strong> sent you a message:</p>
          
          <div style=\"background: #f9fafb; padding: 20px; border-radius: 8px; margin: 20px 0;\">
            ${message || 'You have received a new message.'}
          </div>
          
          ${projectInfo}
          
          <p style=\"margin-top: 30px;\">
            <strong>${senderName}</strong> is inviting you to join Genovad, the professional construction marketplace.
          </p>
          
          <div style=\"text-align: center; margin: 30px 0;\">
            <a href=\"${process.env.APP_URL || 'http://localhost:3000'}/signup.html\" 
               style=\"display: inline-block; background: #1a1a1a; color: white; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px;\">
              Join Genovad & Reply
            </a>
          </div>
          
          <p style=\"color: #6b7280; font-size: 14px; margin-top: 30px;\">
            Already have an account? <a href=\"${process.env.APP_URL || 'http://localhost:3000'}/login.html\" style=\"color: #1a1a1a;\">Log in</a> to view this message.
          </p>
        </div>
        
        <div style=\"text-align: center; margin-top: 20px; color: #9ca3af; font-size: 12px;\">
          <p>Genovad - Connecting construction professionals</p>
        </div>
      </body>
      </html>
    `;
    
    await sendEmail(
      email,
      subject || `${senderName} sent you a message on Genovad`,
      htmlContent,
      'noreply@genovad.com'
    );
    
    res.json({ success: true, message: 'Email invitation sent' });
  } catch (error) {
    console.error('Email invite error:', error);
    res.status(500).json({ error: 'Failed to send email invitation' });
  }
});

// Get conversations
app.get('/api/messages/conversations', authMiddleware, async (req, res) => {
  try {
    const currentUser = await User.findById(req.user._id).select('partners blockedUsers');
    const partnerIds = (currentUser.partners || []).map(p => p.toString());
    const blockedIds = (currentUser.blockedUsers || []).map(b => b.toString());
    
    const messages = await Message.find({
      $or: [{ sender: req.user._id }, { recipient: req.user._id }],
      sender: { $nin: currentUser.blockedUsers },
      recipient: { $nin: currentUser.blockedUsers }
    })
    .populate('sender', 'firstName lastName avatar company')
    .populate('recipient', 'firstName lastName avatar company')
    .sort('-createdAt');
    
    // Group by conversation
    const conversations = {};
    messages.forEach(msg => {
      const otherUserId = msg.sender._id.toString() === req.user._id.toString() 
        ? msg.recipient._id.toString() 
        : msg.sender._id.toString();
      
      // Skip blocked users
      if (blockedIds.includes(otherUserId)) return;
      
      if (!conversations[otherUserId]) {
        const isPartner = partnerIds.includes(otherUserId);
        conversations[otherUserId] = {
          user: msg.sender._id.toString() === req.user._id.toString() ? msg.recipient : msg.sender,
          lastMessage: msg,
          unread: 0,
          type: isPartner ? 'partner' : 'direct'
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

// ============ OWNER COMMENTS ROUTES ============

// Add owner comment to project
app.post('/api/projects/:id/comments', authMiddleware, async (req, res) => {
  try {
    const { text } = req.body;
    if (!text || !text.trim()) {
      return res.status(400).json({ error: 'Comment text is required' });
    }

    const project = await Project.findById(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    
    // Only owner can add comments
    const isOwner = project.owner.toString() === req.user._id.toString();
    if (!isOwner) {
      return res.status(403).json({ error: 'Only the project owner can add comments' });
    }
    
    const comment = {
      author: req.user._id,
      text: text.trim(),
      createdAt: new Date()
    };
    
    project.ownerComments.push(comment);
    
    project.activityLog.push({
      actor: req.user._id,
      action: 'comment_added',
      details: 'Added a comment to the project',
      timestamp: new Date()
    });
    
    await project.save();
    await project.populate('ownerComments.author', 'firstName lastName avatar company');
    
    res.json({ 
      success: true, 
      comment: project.ownerComments[project.ownerComments.length - 1],
      comments: project.ownerComments 
    });
  } catch (error) {
    console.error('Add comment error:', error);
    res.status(500).json({ error: 'Failed to add comment' });
  }
});

// Get project comments
app.get('/api/projects/:id/comments', authMiddleware, async (req, res) => {
  try {
    const project = await Project.findById(req.params.id)
      .populate('ownerComments.author', 'firstName lastName avatar company');
    
    if (!project) return res.status(404).json({ error: 'Project not found' });
    
    res.json({ comments: project.ownerComments || [] });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch comments' });
  }
});

// Edit owner comment
app.put('/api/projects/:projectId/comments/:commentId', authMiddleware, async (req, res) => {
  try {
    const { text } = req.body;
    if (!text || !text.trim()) {
      return res.status(400).json({ error: 'Comment text is required' });
    }

    const project = await Project.findById(req.params.projectId);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    
    const comment = project.ownerComments.id(req.params.commentId);
    if (!comment) return res.status(404).json({ error: 'Comment not found' });
    
    // Only comment author can edit
    if (comment.author.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Not authorized to edit this comment' });
    }
    
    comment.text = text.trim();
    comment.edited = true;
    comment.editedAt = new Date();
    
    await project.save();
    await project.populate('ownerComments.author', 'firstName lastName avatar company');
    
    res.json({ success: true, comment });
  } catch (error) {
    console.error('Edit comment error:', error);
    res.status(500).json({ error: 'Failed to edit comment' });
  }
});

// Delete owner comment
app.delete('/api/projects/:projectId/comments/:commentId', authMiddleware, async (req, res) => {
  try {
    const project = await Project.findById(req.params.projectId);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    
    const comment = project.ownerComments.id(req.params.commentId);
    if (!comment) return res.status(404).json({ error: 'Comment not found' });
    
    // Only comment author can delete
    if (comment.author.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Not authorized to delete this comment' });
    }
    
    comment.remove();
    
    project.activityLog.push({
      actor: req.user._id,
      action: 'comment_deleted',
      details: 'Deleted a comment from the project',
      timestamp: new Date()
    });
    
    await project.save();
    
    res.json({ success: true });
  } catch (error) {
    console.error('Delete comment error:', error);
    res.status(500).json({ error: 'Failed to delete comment' });
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

// Feedback endpoint
app.post('/api/feedback/submit', authMiddleware, async (req, res) => {
  try {
    const { type, subject, message } = req.body;
    const user = req.user;

    if (!type || !subject || !message) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Send email to Genovad support
    const feedbackHTML = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: 'Inter', -apple-system, sans-serif; margin: 0; padding: 0; background: #f5f5f5; }
          .container { max-width: 600px; margin: 40px auto; background: white; border-radius: 8px; overflow: hidden; }
          .header { padding: 40px 40px 30px; text-align: center; background: #1a1a1a; }
          .logo { font-size: 28px; font-weight: 600; color: white; margin: 0; }
          .content { padding: 40px; }
          .field { margin: 0 0 24px; }
          .field-label { font-size: 12px; font-weight: 600; color: #999; text-transform: uppercase; margin: 0 0 8px; }
          .field-value { font-size: 16px; color: #1a1a1a; margin: 0; }
          .message-box { background: #f9f9f9; border-left: 4px solid #60a5fa; padding: 16px; border-radius: 4px; }
          .footer { padding: 24px 40px; background: #f9f9f9; text-align: center; color: #999; font-size: 14px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1 class="logo">Genovad</h1>
          </div>
          <div class="content">
            <h2 style="margin: 0 0 24px; color: #1a1a1a;">New Feedback Submission</h2>
            
            <div class="field">
              <div class="field-label">Type</div>
              <div class="field-value">${type}</div>
            </div>
            
            <div class="field">
              <div class="field-label">Subject</div>
              <div class="field-value">${subject}</div>
            </div>
            
            <div class="field">
              <div class="field-label">From</div>
              <div class="field-value">${user.firstName} ${user.lastName} (${user.email})</div>
            </div>
            
            <div class="field">
              <div class="field-label">Message</div>
              <div class="message-box" style="white-space: pre-wrap; word-wrap: break-word;">${message}</div>
            </div>
          </div>
          <div class="footer">
            <p>&copy; 2026 Genovad. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    try {
      await sendEmail(
        process.env.SUPPORT_EMAIL || 'support@genovad.com',
        `[${type.toUpperCase()}] ${subject} - from ${user.firstName} ${user.lastName}`,
        feedbackHTML
      );
    } catch (emailError) {
      console.error('Feedback email error:', emailError);
      // Don't fail the request if email fails
    }

    res.json({ success: true, message: 'Feedback submitted successfully' });
  } catch (error) {
    console.error('Feedback submission error:', error);
    res.status(500).json({ error: 'Failed to submit feedback', message: error.message });
  }
});

// Notification Endpoints
// Get all notifications for a user
app.get('/api/notifications', authMiddleware, async (req, res) => {
  try {
    const { filter, limit = 50, skip = 0 } = req.query;
    const userId = req.user.id;

    let query = { userId };
    
    // Filter by read status
    if (filter === 'unread') {
      query.read = false;
    } else if (filter === 'read') {
      query.read = true;
    }

    const notifications = await Notification.find(query)
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip(parseInt(skip))
      .lean();

    const unreadCount = await Notification.countDocuments({ userId, read: false });

    res.json({
      notifications,
      unreadCount,
      total: await Notification.countDocuments(query)
    });
  } catch (error) {
    console.error('Notifications fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

// Get notifications by category
app.get('/api/notifications/category/:category', authMiddleware, async (req, res) => {
  try {
    const { category } = req.params;
    const { limit = 50, skip = 0 } = req.query;
    const userId = req.user.id;

    const validCategories = ['partnerships', 'projects', 'messages', 'system'];
    if (!validCategories.includes(category)) {
      return res.status(400).json({ error: 'Invalid category' });
    }

    const notifications = await Notification.find({ userId, category })
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip(parseInt(skip))
      .lean();

    res.json({ notifications });
  } catch (error) {
    console.error('Notifications category fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

// Mark notification as read
app.patch('/api/notifications/:id/read', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const notification = await Notification.findOneAndUpdate(
      { _id: id, userId },
      { read: true },
      { new: true }
    );

    if (!notification) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    res.json(notification);
  } catch (error) {
    console.error('Mark read error:', error);
    res.status(500).json({ error: 'Failed to update notification' });
  }
});

// Mark all notifications as read
app.patch('/api/notifications/read-all', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;

    await Notification.updateMany(
      { userId, read: false },
      { read: true }
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Mark all read error:', error);
    res.status(500).json({ error: 'Failed to update notifications' });
  }
});

// Delete notification
app.delete('/api/notifications/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const notification = await Notification.findOneAndDelete(
      { _id: id, userId }
    );

    if (!notification) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Delete notification error:', error);
    res.status(500).json({ error: 'Failed to delete notification' });
  }
});

// Clear all notifications
app.delete('/api/notifications', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;

    await Notification.deleteMany({ userId });

    res.json({ success: true });
  } catch (error) {
    console.error('Clear notifications error:', error);
    res.status(500).json({ error: 'Failed to clear notifications' });
  }
});

// Internal helper function to create notifications
async function createNotification(userId, type, category, data) {
  try {
    const notification = new Notification({
      userId,
      type,
      category,
      data
    });
    await notification.save();
    
    // Send email/SMS if user has opted in
    try {
      const user = await User.findById(userId);
      if (user && user.preferences) {
        const shouldSendEmail = getShouldSendEmailNotification(user, category);
        const shouldSendSMS = user.preferences.smsOptIn;
        
        if (shouldSendEmail) {
          await sendEmailNotification(user, type, data);
        }
        
        if (shouldSendSMS && user.phone) {
          await sendSMSNotification(user, type, data);
        }
      }
    } catch (notifError) {
      console.error('Error sending notification:', notifError);
      // Don't fail the notification creation if email/SMS fails
    }
    
    return notification;
  } catch (error) {
    console.error('Error creating notification:', error);
  }
}

// Check if user has email notifications enabled for this category
function getShouldSendEmailNotification(user, category) {
  if (!user.preferences || !user.preferences.emailNotifications) {
    return true; // Default to true if not set
  }
  
  const emailPrefs = user.preferences.emailNotifications;
  
  switch(category) {
    case 'messages':
      return emailPrefs.messages !== false;
    case 'projects':
      return emailPrefs.projectUpdates !== false;
    case 'partnerships':
      return emailPrefs.partnerRequests !== false;
    default:
      return true;
  }
}

// Send email notification
async function sendEmailNotification(user, type, data) {
  let subject = '';
  let body = '';
  
  switch(type) {
    case 'bid_received':
      subject = `New Bid on ${data.projectTitle}`;
      body = `
        <h2>New Bid Received!</h2>
        <p>Hi ${user.firstName},</p>
        <p>You've received a new bid on your project <strong>${data.projectTitle}</strong>.</p>
        <p><strong>Bid Amount:</strong> $${data.amount?.toLocaleString() || 'N/A'}</p>
        <p><strong>Bidder:</strong> ${data.bidderName || 'Unknown'}</p>
        <p><a href="${process.env.APP_URL || 'https://genovad.com'}/project-detail.html?id=${data.projectId}" style="display:inline-block;padding:12px 24px;background:#1a1a1a;color:white;text-decoration:none;border-radius:6px;margin-top:16px;">Review Bid</a></p>
      `;
      break;
      
    case 'bid_accepted':
      subject = `Your Bid Was Accepted!`;
      body = `
        <h2>Congratulations!</h2>
        <p>Hi ${user.firstName},</p>
        <p>Your bid for <strong>${data.projectTitle}</strong> has been accepted!</p>
        <p><strong>Amount:</strong> $${data.amount?.toLocaleString() || 'N/A'}</p>
        <p><a href="${process.env.APP_URL || 'https://genovad.com'}/project-detail.html?id=${data.projectId}" style="display:inline-block;padding:12px 24px;background:#1a1a1a;color:white;text-decoration:none;border-radius:6px;margin-top:16px;">View Project</a></p>
      `;
      break;
      
    case 'new_message':
      subject = `New Message from ${data.userName}`;
      body = `
        <h2>New Message</h2>
        <p>Hi ${user.firstName},</p>
        <p><strong>${data.userName}</strong> sent you a message:</p>
        <div style="background:#f5f5f5;padding:16px;border-radius:6px;margin:16px 0;">
          <p style="margin:0;">${data.preview || 'Click to view message'}</p>
        </div>
        <p><a href="${process.env.APP_URL || 'https://genovad.com'}/messages.html?user=${data.userId}" style="display:inline-block;padding:12px 24px;background:#1a1a1a;color:white;text-decoration:none;border-radius:6px;margin-top:16px;">Reply Now</a></p>
      `;
      break;
      
    case 'partnership_request':
      subject = `Partnership Request from ${data.userName}`;
      body = `
        <h2>New Partnership Request</h2>
        <p>Hi ${user.firstName},</p>
        <p><strong>${data.userName}</strong>${data.userCompany ? ` from ${data.userCompany}` : ''} wants to add you as a partner.</p>
        <p><a href="${process.env.APP_URL || 'https://genovad.com'}/notifications.html" style="display:inline-block;padding:12px 24px;background:#1a1a1a;color:white;text-decoration:none;border-radius:6px;margin-top:16px;">View Request</a></p>
      `;
      break;
      
    default:
      subject = 'New Notification from Genovad';
      body = `<p>Hi ${user.firstName},</p><p>You have a new notification on Genovad.</p>`;
  }
  
  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: 'Inter', -apple-system, sans-serif; margin: 0; padding: 0; background: #f5f5f5; }
    .container { max-width: 600px; margin: 40px auto; background: white; border-radius: 8px; overflow: hidden; }
    .header { padding: 24px 40px; text-align: center; background: #1a1a1a; }
    .logo { font-size: 24px; font-weight: 600; color: white; margin: 0; }
    .content { padding: 40px; }
    h2 { color: #1a1a1a; margin: 0 0 16px; }
    p { color: #666; line-height: 1.6; margin: 0 0 16px; }
    .footer { padding: 24px 40px; background: #f9f9f9; text-align: center; color: #999; font-size: 14px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header"><h1 class="logo">Genovad</h1></div>
    <div class="content">${body}</div>
    <div class="footer"><p>&copy; 2026 Genovad. All rights reserved.</p></div>
  </div>
</body>
</html>
  `;
  
  await sendEmail(user.email, subject, htmlContent);
}

// Send SMS notification (placeholder - requires Twilio setup)
async function sendSMSNotification(user, type, data) {
  // TODO: Implement SMS sending with Twilio
  // For now, just log that SMS would be sent
  console.log(`📱 SMS notification would be sent to ${user.phone}: ${type}`);
  
  /* Example Twilio implementation:
  const twilio = require('twilio');
  const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  
  let message = '';
  switch(type) {
    case 'bid_received':
      message = `New bid of $${data.amount} on ${data.projectTitle}`;
      break;
    case 'bid_accepted':
      message = `Your bid was accepted! ${data.projectTitle}`;
      break;
    case 'new_message':
      message = `New message from ${data.userName}`;
      break;
    default:
      message = 'You have a new notification on Genovad';
  }
  
  await client.messages.create({
    body: message,
    from: process.env.TWILIO_PHONE_NUMBER,
    to: user.phone
  });
  */
}

// Make createNotification available to other routes
app.locals.createNotification = createNotification;

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

// ============ COMPANY VERIFICATION & MANAGEMENT ROUTES ============

// Create/claim company
app.post('/api/companies', authMiddleware, upload.array('documents', 5), async (req, res) => {
  try {
    const {
      name,
      legalName,
      registrationNumber,
      registrarId,
      address,
      phone,
      email,
      website,
      type,
      size,
      yearFounded,
      description,
      specialties
    } = req.body;

    // Check if company already exists
    const existing = await Company.findOne({
      $or: [
        { registrationNumber: registrationNumber && registrationNumber.trim() },
        { name: name, 'address.city': address?.city, 'address.state': address?.state }
      ].filter(Boolean)
    });

    if (existing) {
      return res.status(400).json({ error: 'Company already exists. Request to join instead.' });
    }

    // Handle uploaded documents
    const documents = req.files ? req.files.map(file => ({
      type: 'business_license',
      url: `/uploads/${file.filename}`,
      uploadedAt: Date.now()
    })) : [];

    const company = new Company({
      name,
      legalName: legalName || name,
      registrationNumber,
      registrarId,
      address: typeof address === 'string' ? JSON.parse(address) : address,
      phone,
      email,
      website,
      type,
      size,
      yearFounded,
      description,
      specialties: typeof specialties === 'string' ? JSON.parse(specialties) : specialties,
      owner: req.user._id,
      admins: [req.user._id],
      members: [req.user._id],
      verificationDocuments: documents,
      verificationStatus: documents.length > 0 ? 'submitted' : 'pending'
    });

    await company.save();

    // Update user
    await User.findByIdAndUpdate(req.user._id, {
      companyId: company._id,
      companyRole: 'owner',
      company: name
    });

    res.json({ success: true, company });
  } catch (error) {
    console.error('Create company error:', error);
    res.status(500).json({ error: 'Failed to create company' });
  }
});

// Get company details
// Browse all companies endpoint with filtering
// IMPORTANT: This must come BEFORE the /:id route to avoid route shadowing
app.get('/api/companies', authMiddleware, async (req, res) => {
  try {
    const { search, type, location, verified, minRating, limit = 50, skip = 0 } = req.query;
    
    // Build filter
    const filter = {};
    
    // Type filter (general_contractor, subcontractor, architect, supplier, etc.)
    if (type && type !== 'all') {
      filter.type = type;
    }
    
    // Verified filter
    if (verified === 'true') {
      filter.verified = true;
    } else if (verified === 'false') {
      filter.verified = false;
    }
    
    // Location filter
    if (location) {
      filter.$or = [
        { 'address.city': new RegExp(location, 'i') },
        { 'address.state': new RegExp(location, 'i') }
      ];
    }
    
    // Rating filter
    if (minRating) {
      filter.rating = { $gte: parseFloat(minRating) };
    }
    
    // Search filter
    if (search) {
      const searchRegex = new RegExp(search, 'i');
      filter.$or = [
        { name: searchRegex },
        { description: searchRegex },
        { type: searchRegex }
      ];
    }
    
    // Get companies
    const companies = await Company.find(filter)
      .populate('owner', 'firstName lastName')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip(parseInt(skip))
      .lean();
    
    // Get total count for pagination
    const total = await Company.countDocuments(filter);
    
    // Format companies with additional fields
    const formattedCompanies = companies.map(company => ({
      ...company,
      projectCount: company.projectsCompleted || 0,
      rating: company.rating || 0,
      reviewCount: company.reviewCount || 0,
      companyType: company.type,
      location: (company.address && company.address.city && company.address.state) 
        ? `${company.address.city}, ${company.address.state}` 
        : (company.address && (company.address.city || company.address.state) 
          ? (company.address.city || company.address.state) 
          : 'Location not specified')
    }));
    
    res.json({ 
      companies: formattedCompanies,
      total,
      hasMore: (parseInt(skip) + companies.length) < total
    });
  } catch (error) {
    console.error('Browse companies error:', error);
    res.status(500).json({ error: 'Failed to fetch companies' });
  }
});

// Get personalized company recommendations (LinkedIn-style network discovery)
// IMPORTANT: This must come BEFORE the /:id route to avoid route shadowing
app.get('/api/companies/recommendations', authMiddleware, async (req, res) => {
  try {
    const { verified } = req.query;
    const currentUser = await User.findById(req.user._id);
    if (!currentUser) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Build filter based on query parameter
    const filter = {};
    if (verified === 'true') {
      filter.verified = true;
    } else if (verified === 'false') {
      filter.verified = false;
    }
    // If no verified parameter, get all companies
    
    // Get all companies based on filter
    let allCompanies = await Company.find(filter)
      .populate('owner', 'firstName lastName')
      .limit(100);

    console.log(`Found ${allCompanies.length} Company documents in database for recommendations`);

    // If no Company documents exist, try to get users with company names as fallback
    if (!allCompanies || allCompanies.length === 0) {
      console.log('No Company documents found. Checking if users exist with company data...');
      const usersWithCompanies = await User.find({ 
        company: { $exists: true, $ne: '' },
        emailVerified: true
      }).select('firstName lastName company role location').limit(10);
      
      console.log(`Found ${usersWithCompanies.length} users with company names`);
      
      if (usersWithCompanies.length > 0) {
        console.log('TIP: Users have company names but no Company documents created yet. Users should create Company profiles via /company.html');
      }
      
      return res.json({
        topPicks: [],
        mayKnow: [],
        recentlyActive: [],
        totalCompanies: 0,
        message: 'No companies found. Create your company profile to get started!'
      });
    }

    // Get user's project history to understand connections
    let userProjects = [];
    try {
      userProjects = await Project.find({
        $or: [
          { owner: req.user._id },
          { 'bids.user': req.user._id }
        ]
      }).select('owner bids location category').lean();
    } catch (e) {
      console.warn('Error fetching user projects:', e.message);
    }

    // Companies user has worked with
    const workedWithCompanyIds = new Set();
    if (Array.isArray(userProjects)) {
      userProjects.forEach(project => {
        try {
          if (project.owner && project.owner.toString() !== req.user._id.toString()) {
            workedWithCompanyIds.add(project.owner.toString());
          }
          if (project.bids && Array.isArray(project.bids)) {
            project.bids.forEach(bid => {
              if (bid.user && bid.user.toString() !== req.user._id.toString()) {
                workedWithCompanyIds.add(bid.user.toString());
              }
            });
          }
        } catch (e) {
          console.warn('Error processing project:', e.message);
        }
      });
    }

    // Calculate scores for each company
    const scoredCompanies = allCompanies.map(company => {
      try {
        let score = 0;
        let reason = '';
        let category = '';

        // Don't recommend if it's the user's own company
        if (currentUser.company && company.name === currentUser.company) {
          return null;
        }

        // TOP PICKS SCORING
        // Verified companies get priority
        if (company.verified) score += 30;
        
        // High rating
        if (company.rating && company.rating >= 4.5) {
          score += 25;
          reason = 'Highly rated company';
        } else if (company.rating && company.rating >= 4.0) {
          score += 15;
        }

        // Active and established
        if (company.projectsCompleted && company.projectsCompleted > 20) {
          score += 20;
          if (!reason) reason = 'Experienced with many projects';
        } else if (company.projectsCompleted && company.projectsCompleted > 10) {
          score += 10;
        }

        // Complete profile
        if (company.description && company.description.length > 100) score += 10;
        if (company.website) score += 5;
        
        // MAY KNOW SCORING
        // Same location - company.address contains city, state
        const companyLocation = (company.address && company.address.city && company.address.state) 
          ? `${company.address.city}, ${company.address.state}` 
          : (company.address && (company.address.city || company.address.state) ? (company.address.city || company.address.state) : '');
        
        if (currentUser.location && companyLocation && 
            currentUser.location.toLowerCase().includes(companyLocation.toLowerCase().split(',')[0].toLowerCase())) {
          score += 40;
          category = 'mayKnow';
          reason = `Based in ${companyLocation.split(',')[0].trim()}`;
        }

        // Worked with before - check if user is owner of company
        const companyOwnerId = company.owner && company.owner._id ? company.owner._id.toString() : null;
        if (companyOwnerId && workedWithCompanyIds.has(companyOwnerId)) {
          score += 50;
          category = 'mayKnow';
          reason = 'You\'ve worked together before';
        }

        // Similar industry/type
        if (currentUser.role === 'vendor' && company.type === 'general_contractor') {
          score += 15;
          if (!category) {
            category = 'mayKnow';
            reason = 'General contractors in your network';
          }
        }

        // RECENTLY ACTIVE SCORING
        const updatedAt = company.updatedAt ? new Date(company.updatedAt) : new Date(company.createdAt);
        const recentActivity = new Date() - updatedAt;
        const daysInactive = recentActivity / (1000 * 60 * 60 * 24);
        
        if (daysInactive < 7) {
          score += 35;
          if (!category) category = 'recentlyActive';
          if (!reason) reason = 'Active this week';
        } else if (daysInactive < 30) {
          score += 25;
          if (!category) category = 'recentlyActive';
          if (!reason) reason = 'Active this month';
        }

        // Recent projects (calculated from active projects)
        const activeProjectCount = 0; // TODO: Calculate from actual active projects
        if (activeProjectCount > 0) {
          score += 20;
          if (!category) category = 'recentlyActive';
          if (!reason) reason = `${activeProjectCount} active projects`;
        }

        // Ensure score is at least 1 for any company
        if (score === 0) score = 1;

        return {
          ...company.toObject(),
          score,
          reason,
          category,
          projectCount: company.projectsCompleted || 0,
          rating: company.rating || 0,
          reviewCount: company.reviewCount || 0,
          companyType: company.type, // Map type to companyType for frontend
          location: companyLocation || 'Location not specified', // Add formatted location
          activeProjects: 0, // TODO: Calculate from actual active projects
          lastActivity: daysInactive < 1 ? 'Active today' : 
                        daysInactive < 7 ? 'Active this week' :
                        daysInactive < 30 ? 'Active this month' : 
                        'Active recently'
        };
      } catch (e) {
        console.warn('Error scoring company:', e.message, e.stack);
        return null;
      }
    }).filter(c => c !== null);

    // Sort by score
    scoredCompanies.sort((a, b) => b.score - a.score);

    // Categorize recommendations
    const topPicks = scoredCompanies
      .filter(c => c.score >= 40)
      .slice(0, 10);

    const mayKnow = scoredCompanies
      .filter(c => c.category === 'mayKnow' || c.score >= 30)
      .slice(0, 10);

    const recentlyActive = scoredCompanies
      .filter(c => c.category === 'recentlyActive' || (c.updatedAt && new Date() - new Date(c.updatedAt) < 30 * 24 * 60 * 60 * 1000))
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
      .slice(0, 10);

    res.json({
      topPicks,
      mayKnow,
      recentlyActive,
      totalCompanies: allCompanies.length
    });
  } catch (error) {
    console.error('Company recommendations error:', error);
    // Return empty recommendations instead of 500 error
    res.json({
      topPicks: [],
      mayKnow: [],
      recentlyActive: [],
      message: 'Unable to load recommendations at this time'
    });
  }
});

// Get specific company by ID
app.get('/api/companies/:id', authMiddleware, async (req, res) => {
  try {
    const company = await Company.findById(req.params.id)
      .populate('owner', 'firstName lastName email avatar')
      .populate('admins', 'firstName lastName email avatar title')
      .populate('members', 'firstName lastName email avatar title');
    
    if (!company) return res.status(404).json({ error: 'Company not found' });
    
    res.json({ company });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch company' });
  }
});

// Get my company
app.get('/api/companies/my/company', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user.companyId) {
      return res.json({ company: null });
    }

    const company = await Company.findById(user.companyId)
      .populate('owner', 'firstName lastName email avatar')
      .populate('admins', 'firstName lastName email avatar title')
      .populate('members', 'firstName lastName email avatar title');
    
    res.json({ company });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch company' });
  }
});

// Submit company for verification
app.post('/api/companies/:id/submit-verification', authMiddleware, upload.array('documents', 5), async (req, res) => {
  try {
    const company = await Company.findById(req.params.id);
    if (!company) return res.status(404).json({ error: 'Company not found' });

    // Check if user is admin
    if (!company.admins.includes(req.user._id) && company.owner.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    // Add new documents
    if (req.files) {
      const newDocs = req.files.map(file => ({
        type: req.body.docType || 'business_license',
        url: `/uploads/${file.filename}`,
        uploadedAt: Date.now()
      }));
      company.verificationDocuments.push(...newDocs);
    }

    company.verificationStatus = 'submitted';
    await company.save();

    // Notify admins/system about verification request
    // Could send email to admin team here

    res.json({ success: true, message: 'Company submitted for verification', company });
  } catch (error) {
    console.error('Submit verification error:', error);
    res.status(500).json({ error: 'Failed to submit verification' });
  }
});

// Automatic verification check (checks external APIs)
app.post('/api/companies/:id/auto-verify', authMiddleware, async (req, res) => {
  try {
    const company = await Company.findById(req.params.id);
    if (!company) return res.status(404).json({ error: 'Company not found' });

    // Check if user is admin
    if (!company.admins.includes(req.user._id) && company.owner.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    let verificationPassed = false;
    const checks = [];

    // Check 1: Registrar ID verification (if provided)
    if (company.registrarId) {
      // This would integrate with state contractor licensing boards
      // For now, just mark as checked
      checks.push({
        type: 'registrar',
        passed: true,
        message: 'Registrar ID format valid'
      });
      verificationPassed = true;
    }

    // Check 2: EIN/Registration number format
    if (company.registrationNumber) {
      const einPattern = /^\\d{2}-\\d{7}$/;
      const isValidEIN = einPattern.test(company.registrationNumber);
      checks.push({
        type: 'ein',
        passed: isValidEIN,
        message: isValidEIN ? 'EIN format valid' : 'EIN format invalid'
      });
      if (isValidEIN) verificationPassed = true;
    }

    // Check 3: Business address verification (could integrate with Google Places API)
    if (company.address && company.address.street) {
      checks.push({
        type: 'address',
        passed: true,
        message: 'Address provided'
      });
    }

    // Check 4: Website domain matches company name (basic check)
    if (company.website) {
      try {
        const domain = new URL(company.website).hostname.toLowerCase();
        const companyNameSlug = company.name.toLowerCase().replace(/[^a-z0-9]/g, '');
        const domainContainsName = domain.includes(companyNameSlug.substring(0, Math.min(10, companyNameSlug.length)));
        checks.push({
          type: 'website',
          passed: domainContainsName,
          message: domainContainsName ? 'Website domain matches company name' : 'Website domain does not match company name'
        });
      } catch (e) {
        checks.push({
          type: 'website',
          passed: false,
          message: 'Invalid website URL'
        });
      }
    }

    // If passes automatic checks, mark as verified
    if (verificationPassed && checks.filter(c => c.passed).length >= 2) {
      company.verified = true;
      company.verificationStatus = 'verified';
      company.verificationMethod = 'automated';
      company.verificationDate = new Date();
      company.verificationNotes = `Automatic verification passed: ${checks.filter(c => c.passed).map(c => c.type).join(', ')}`;
      await company.save();

      // Update all company members with verification badge
      await User.updateMany(
        { companyId: company._id },
        { $set: { registrarId: company.registrarId || company.registrationNumber } }
      );

      res.json({ 
        success: true, 
        verified: true, 
        message: 'Company automatically verified!',
        checks,
        company 
      });
    } else {
      company.verificationStatus = 'in_review';
      company.verificationNotes = 'Automatic verification inconclusive. Manual review required.';
      await company.save();

      res.json({ 
        success: true, 
        verified: false, 
        message: 'Automatic verification incomplete. Manual review required.',
        checks,
        company 
      });
    }
  } catch (error) {
    console.error('Auto-verify error:', error);
    res.status(500).json({ error: 'Failed to auto-verify company' });
  }
});

// Admin: Get all companies for review
app.get('/api/admin/companies', authMiddleware, async (req, res) => {
  try {
    // TODO: Add admin role check here
    // if (req.user.role !== 'admin') return res.status(403).json({ error: 'Not authorized' });
    
    const companies = await Company.find()
      .populate('owner', 'firstName lastName email')
      .sort({ createdAt: -1 });
    
    res.json({ companies });
  } catch (error) {
    console.error('Get companies error:', error);
    res.status(500).json({ error: 'Failed to fetch companies' });
  }
});

// Admin: Manually approve company (would be restricted to platform admins)
app.post('/api/admin/companies/:id/approve', authMiddleware, async (req, res) => {
  try {
    // TODO: Add admin role check
    // if (req.user.role !== 'platform_admin') return res.status(403).json({ error: 'Not authorized' });

    const { notes } = req.body;
    const company = await Company.findById(req.params.id);
    if (!company) return res.status(404).json({ error: 'Company not found' });

    company.verified = true;
    company.verificationStatus = 'verified';
    company.verificationMethod = 'manual';
    company.verificationDate = new Date();
    company.verificationNotes = notes || 'Manually approved by admin';
    await company.save();

    // Update all company members
    await User.updateMany(
      { companyId: company._id },
      { $set: { registrarId: company.registrarId || company.registrationNumber } }
    );

    // Send notification to company owner
    await createNotification(
      company.owner,
      'company_verified',
      'company',
      {
        companyId: company._id,
        companyName: company.name,
        message: 'Your company has been verified!'
      }
    );

    res.json({ success: true, message: 'Company approved', company });
  } catch (error) {
    console.error('Approve company error:', error);
    res.status(500).json({ error: 'Failed to approve company' });
  }
});

// Admin: Reject company verification
app.post('/api/admin/companies/:id/reject', authMiddleware, async (req, res) => {
  try {
    // TODO: Add admin role check

    const { reason } = req.body;
    const company = await Company.findById(req.params.id);
    if (!company) return res.status(404).json({ error: 'Company not found' });

    company.verificationStatus = 'rejected';
    company.verificationNotes = reason || 'Verification rejected';
    await company.save();

    // Send notification to company owner
    await createNotification(
      company.owner,
      'company_verification_rejected',
      'company',
      {
        companyId: company._id,
        companyName: company.name,
        message: `Company verification rejected: ${reason}`
      }
    );

    res.json({ success: true, message: 'Company verification rejected', company });
  } catch (error) {
    res.status(500).json({ error: 'Failed to reject company' });
  }
});

// Invite team member to company
app.post('/api/companies/:id/invite', authMiddleware, async (req, res) => {
  try {
    const { email, role, message } = req.body;
    
    if (!email || !['admin', 'member'].includes(role)) {
      return res.status(400).json({ error: 'Invalid email or role' });
    }

    const company = await Company.findById(req.params.id);
    if (!company) return res.status(404).json({ error: 'Company not found' });

    // Check if user is admin
    if (!company.admins.includes(req.user._id) && company.owner.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Only company admins can invite members' });
    }

    // Check if already a member
    const existingUser = await User.findOne({ email, companyId: company._id });
    if (existingUser) {
      return res.status(400).json({ error: 'User is already a company member' });
    }

    // Check if already invited
    const existingInvite = company.pendingInvitations.find(
      inv => inv.email === email && inv.status === 'pending'
    );
    if (existingInvite) {
      return res.status(400).json({ error: 'Invitation already sent to this email' });
    }

    // Create invitation token
    const crypto = require('crypto');
    const token = crypto.randomBytes(32).toString('hex');

    // Add invitation
    company.pendingInvitations.push({
      email,
      role,
      token,
      message: message || null,
      invitedBy: req.user._id,
      invitedAt: new Date(),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      status: 'pending'
    });

    await company.save();

    // Send invitation email
    const inviteUrl = `${process.env.APP_URL || 'http://localhost:3000'}/company-invite?token=${token}`;
    const inviter = await User.findById(req.user._id);
    
    await sendEmail(
      email,
      `You're invited to join ${company.name} on Genovad`,
      `
      <!DOCTYPE html>
      <html>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
        <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2>Join ${company.name} on Genovad</h2>
          <p><strong>${inviter.firstName} ${inviter.lastName}</strong> has invited you to join <strong>${company.name}</strong> as a ${role}.</p>
          
          ${company.verified ? '<p style="color: #059669;">✓ This is a verified company</p>' : ''}
          
          ${message ? `<div style="background: #f0f0f0; padding: 15px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #1a1a1a;"><p style="margin: 0;"><strong>Message from ${inviter.firstName}:</strong></p><p style="margin: 10px 0 0 0;">${message}</p></div>` : ''}
          
          <div style="margin: 30px 0;">
            <a href="${inviteUrl}" style="display: inline-block; background: #1a1a1a; color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: 600;">
              Accept Invitation
            </a>
          </div>
          
          <p style="color: #666; font-size: 14px;">This invitation expires in 7 days.</p>
          <p style="color: #666; font-size: 14px;">If you don't have a Genovad account, you'll be able to create one.</p>
        </div>
      </body>
      </html>
      `
    );

    res.json({ success: true, message: 'Invitation sent', invitation: { email, role, token } });
  } catch (error) {
    console.error('Invite member error:', error);
    res.status(500).json({ error: 'Failed to send invitation' });
  }
});

// Get invitation details (public, no auth needed)
app.get('/api/companies/invitations/:token', async (req, res) => {
  try {
    const { token } = req.params;
    
    const company = await Company.findOne({
      'pendingInvitations.token': token,
      'pendingInvitations.status': 'pending'
    }).select('name verified verificationDate');

    if (!company) {
      return res.status(404).json({ error: 'Invalid or expired invitation' });
    }

    const invitation = company.pendingInvitations.find(
      inv => inv.token === token && inv.status === 'pending'
    );

    if (!invitation || invitation.expiresAt < new Date()) {
      return res.status(400).json({ error: 'Invitation has expired' });
    }

    res.json({ 
      company: {
        name: company.name,
        verified: company.verified
      },
      invitation: {
        role: invitation.role,
        email: invitation.email
      }
    });
  } catch (error) {
    console.error('Get invitation error:', error);
    res.status(500).json({ error: 'Failed to fetch invitation' });
  }
});

// Accept company invitation
app.post('/api/companies/invitations/:token/accept', authMiddleware, async (req, res) => {
  try {
    const { token } = req.params;
    
    const company = await Company.findOne({
      'pendingInvitations.token': token,
      'pendingInvitations.status': 'pending'
    });

    if (!company) {
      return res.status(404).json({ error: 'Invalid or expired invitation' });
    }

    const invitation = company.pendingInvitations.find(
      inv => inv.token === token && inv.status === 'pending'
    );

    if (!invitation || invitation.expiresAt < new Date()) {
      return res.status(400).json({ error: 'Invitation has expired' });
    }

    // Check if user email matches invitation
    const user = await User.findById(req.user._id);
    if (user.email !== invitation.email) {
      return res.status(403).json({ error: 'This invitation is for a different email address' });
    }

    // Add user to company
    company.members.push(user._id);
    if (invitation.role === 'admin') {
      company.admins.push(user._id);
    }

    // Mark invitation as accepted
    invitation.status = 'accepted';
    await company.save();

    // Update user
    await User.findByIdAndUpdate(user._id, {
      companyId: company._id,
      companyRole: invitation.role,
      company: company.name
    });

    res.json({ success: true, message: 'Successfully joined company', company });
  } catch (error) {
    console.error('Accept invitation error:', error);
    res.status(500).json({ error: 'Failed to accept invitation' });
  }
});

// Get company members
app.get('/api/companies/:id/members', authMiddleware, async (req, res) => {
  try {
    const company = await Company.findById(req.params.id)
      .populate('members', 'firstName lastName email avatar title companyRole');
    
    if (!company) return res.status(404).json({ error: 'Company not found' });
    
    res.json({ members: company.members });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch members' });
  }
});

// Remove company member
app.delete('/api/companies/:id/members/:userId', authMiddleware, async (req, res) => {
  try {
    const company = await Company.findById(req.params.id);
    if (!company) return res.status(404).json({ error: 'Company not found' });

    // Check if user is admin
    if (!company.admins.includes(req.user._id) && company.owner.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    // Can't remove owner
    if (company.owner.toString() === req.params.userId) {
      return res.status(400).json({ error: 'Cannot remove company owner' });
    }

    // Remove from company
    company.members = company.members.filter(m => m.toString() !== req.params.userId);
    company.admins = company.admins.filter(a => a.toString() !== req.params.userId);
    await company.save();

    // Update user
    await User.findByIdAndUpdate(req.params.userId, {
      $unset: { companyId: 1, companyRole: 1 }
    });

    res.json({ success: true, message: 'Member removed' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to remove member' });
  }
});

// Get pending invitations for a company
app.get('/api/companies/:id/invitations', authMiddleware, async (req, res) => {
  try {
    const company = await Company.findById(req.params.id);
    if (!company) return res.status(404).json({ error: 'Company not found' });

    // Check if user is admin
    if (!company.admins.includes(req.user._id) && company.owner.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const pending = company.pendingInvitations.filter(inv => inv.status === 'pending');
    res.json({ invitations: pending });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch invitations' });
  }
});

// Discovery endpoint: Find people with LinkedIn-style recommendations
// Includes both owners and vendors with filtering
app.get('/api/discovery', authMiddleware, async (req, res) => {
  try {
    const { search, role, location, minRating, minExperience, verified, includeUnverified } = req.query;
    const currentUser = await User.findById(req.user._id).populate('partners');

    // Get list of partner IDs to exclude from discovery
    const partnerIds = (currentUser.partners || []).map(p => p._id ? p._id.toString() : p.toString());

    // Build filter
    const filter = {
      _id: { 
        $ne: req.user._id, // Exclude self
        $nin: partnerIds // Exclude existing partners
      },
      deletedAt: null
    };

    // Only filter by emailVerified if includeUnverified is not true
    if (includeUnverified !== 'true') {
      filter.emailVerified = true;
    }

    // Filter by role if specified
    if (role && ['owner', 'vendor'].includes(role)) {
      filter.role = role;
    }

    // Search filter
    if (search) {
      const searchRegex = new RegExp(search, 'i');
      filter.$or = [
        { firstName: searchRegex },
        { lastName: searchRegex },
        { company: searchRegex },
        { bio: searchRegex },
        { skills: searchRegex },
        { services: searchRegex }
      ];
    }

    // Location filter
    if (location) {
      const locationRegex = new RegExp(location, 'i');
      filter.$or = filter.$or || [];
      filter.$or.push(
        { city: locationRegex },
        { state: locationRegex },
        { location: locationRegex }
      );
    }

    // Rating filter
    if (minRating) {
      filter.rating = { $gte: parseFloat(minRating) };
    }

    // Experience filter
    if (minExperience) {
      filter.yearsExperience = { $gte: parseInt(minExperience) };
    }

    // Verified filter
    if (verified === 'true') {
      filter.registrarId = { $exists: true, $ne: '' };
    }

    // Get all matching users
    const allUsers = await User.find(filter)
      .select('-password -verificationCode -verificationExpires')
      .limit(500);

    // Get user's interaction history for recommendations
    const userProjects = await Project.find({
      $or: [
        { owner: req.user._id },
        { 'bids.user': req.user._id }
      ]
    }).select('owner bids createdAt');

    // Users the current user has interacted with
    const connectedUserIds = new Set();
    userProjects.forEach(project => {
      if (project.owner.toString() !== req.user._id.toString()) {
        connectedUserIds.add(project.owner.toString());
      }
      project.bids.forEach(bid => {
        if (bid.user.toString() !== req.user._id.toString()) {
          connectedUserIds.add(bid.user.toString());
        }
      });
    });

    // Score and categorize users
    const scoredUsers = allUsers.map(user => {
      let score = 0;
      let section = '';
      let reason = '';

      // Skip if user has already interacted
      const hasInteracted = connectedUserIds.has(user._id.toString());

      // TOP PICKS SCORING
      if (user.rating && user.rating >= 4.5) {
        score += 40;
        reason = 'Highly rated professional';
      } else if (user.rating && user.rating >= 4.0) {
        score += 25;
        reason = 'Well-reviewed professional';
      }

      if (user.reviewCount && user.reviewCount >= 10) {
        score += 20;
      } else if (user.reviewCount && user.reviewCount >= 5) {
        score += 10;
      }

      if (user.projectsCompleted && user.projectsCompleted >= 10) {
        score += 15;
      }

      // Verified badge boost
      if (user.registrarId && user.registrarId.trim() !== '') {
        score += 20;
      }

      // Complete profile
      if (user.bio && user.bio.length > 50) score += 10;
      if ((user.skills || []).length > 0) score += 10;
      if (user.yearsExperience >= 5) score += 15;

      // MIGHT KNOW SCORING (based on shared attributes)
      if (currentUser.location && user.location && 
          currentUser.location.toLowerCase().includes(user.location.toLowerCase().split(',')[0])) {
        score += 35;
        section = 'mightKnow';
        reason = `Based in ${user.location.split(',')[0]}`;
      }

      // Same skills
      const userSkills = new Set((user.skills || []).map(s => s.toLowerCase()));
      const currentSkills = new Set((currentUser.skills || []).map(s => s.toLowerCase()));
      const sharedSkills = [...userSkills].filter(s => currentSkills.has(s)).length;
      if (sharedSkills > 0) {
        score += 25 + (sharedSkills * 5);
        if (!section) {
          section = 'mightKnow';
          reason = `Shares ${sharedSkills} skill${sharedSkills > 1 ? 's' : ''} with you`;
        }
      }

      // Complementary role (owner might know vendor and vice versa)
      if (!hasInteracted && currentUser.role !== user.role) {
        score += 10;
      }

      // ACTIVITY-BASED SCORING
      const lastActive = new Date() - new Date(user.lastActive);
      const daysSinceActive = lastActive / (1000 * 60 * 60 * 24);

      if (daysSinceActive < 1) {
        score += 30;
        section = section === 'mightKnow' ? section : 'active';
        reason = 'Active today';
      } else if (daysSinceActive < 7) {
        score += 20;
        if (!section) section = 'active';
        if (!reason) reason = 'Active this week';
      } else if (daysSinceActive < 30) {
        score += 10;
        if (!section) section = 'active';
        if (!reason) reason = 'Active this month';
      }

      // Recently completed projects
      const recentProjects = userProjects.filter(p => {
        const daysSince = (new Date() - new Date(p.createdAt)) / (1000 * 60 * 60 * 24);
        return daysSince < 30;
      }).length;

      if (recentProjects > 0) {
        score += 15 + (recentProjects * 2);
        if (!section) section = 'active';
        if (!reason) reason = `${recentProjects} active project${recentProjects > 1 ? 's' : ''}`;
      }

      // Has worked with someone you know (future: add mutual connections)
      // if (sharedConnections > 0) score += 25;

      return {
        ...user.toObject(),
        score,
        section: section || 'browse',
        reason,
        hasInteracted
      };
    });

    // Sort by score
    scoredUsers.sort((a, b) => b.score - a.score);

    // Categorize into sections
    const topPicks = scoredUsers
      .filter(u => u.score >= 60 && !u.hasInteracted)
      .slice(0, 12);

    const mightKnow = scoredUsers
      .filter(u => u.section === 'mightKnow' && !u.hasInteracted)
      .slice(0, 12);

    const activeToday = scoredUsers
      .filter(u => u.section === 'active' && !u.hasInteracted)
      .slice(0, 12);

    // Browse (all others, filtered)
    const browse = scoredUsers.slice(0, 50);

    res.json({
      topPicks: topPicks.map(u => ({
        _id: u._id,
        firstName: u.firstName,
        lastName: u.lastName,
        email: u.email,
        avatar: u.avatar,
        bio: u.bio,
        company: u.company,
        title: u.title,
        role: u.role,
        location: u.location,
        city: u.city,
        state: u.state,
        skills: u.skills,
        services: u.services,
        rating: u.rating,
        reviewCount: u.reviewCount,
        yearsExperience: u.yearsExperience,
        registrarId: u.registrarId,
        reason: u.reason
      })),
      mightKnow: mightKnow.map(u => ({
        _id: u._id,
        firstName: u.firstName,
        lastName: u.lastName,
        email: u.email,
        avatar: u.avatar,
        bio: u.bio,
        company: u.company,
        title: u.title,
        role: u.role,
        location: u.location,
        city: u.city,
        state: u.state,
        skills: u.skills,
        services: u.services,
        rating: u.rating,
        reviewCount: u.reviewCount,
        yearsExperience: u.yearsExperience,
        registrarId: u.registrarId,
        reason: u.reason
      })),
      activeToday: activeToday.map(u => ({
        _id: u._id,
        firstName: u.firstName,
        lastName: u.lastName,
        email: u.email,
        avatar: u.avatar,
        bio: u.bio,
        company: u.company,
        title: u.title,
        role: u.role,
        location: u.location,
        city: u.city,
        state: u.state,
        skills: u.skills,
        services: u.services,
        rating: u.rating,
        reviewCount: u.reviewCount,
        yearsExperience: u.yearsExperience,
        registrarId: u.registrarId,
        reason: u.reason
      })),
      browse: browse.map(u => ({
        _id: u._id,
        firstName: u.firstName,
        lastName: u.lastName,
        email: u.email,
        avatar: u.avatar,
        bio: u.bio,
        company: u.company,
        title: u.title,
        role: u.role,
        location: u.location,
        city: u.city,
        state: u.state,
        skills: u.skills,
        services: u.services,
        rating: u.rating,
        reviewCount: u.reviewCount,
        yearsExperience: u.yearsExperience,
        registrarId: u.registrarId
      })),
      totalCount: allUsers.length,
      searchApplied: !!search
    });
  } catch (error) {
    console.error('Discovery error:', error);
    res.status(500).json({ error: 'Failed to load discovery' });
  }
});

// Get user network stats
app.get('/api/users/network-stats', authMiddleware, async (req, res) => {
  try {
    // Get projects user has participated in
    const projects = await Project.find({
      $or: [
        { owner: req.user._id },
        { 'bids.user': req.user._id }
      ]
    });

    // Count unique companies/users worked with
    const companiesWorkedWith = new Set();
    projects.forEach(project => {
      if (project.owner.toString() !== req.user._id.toString()) {
        companiesWorkedWith.add(project.owner.toString());
      }
      project.bids.forEach(bid => {
        if (bid.user.toString() !== req.user._id.toString()) {
          companiesWorkedWith.add(bid.user.toString());
        }
      });
    });

    // Active projects
    const activeProjects = projects.filter(p => 
      p.status === 'open' || p.status === 'in_progress'
    ).length;

    res.json({
      companiesWorkedWith: companiesWorkedWith.size,
      activeProjects,
      totalConnections: companiesWorkedWith.size + activeProjects
    });
  } catch (error) {
    console.error('Network stats error:', error);
    res.status(500).json({ error: 'Failed to load network stats' });
  }
});

// ======================== SOCIAL FEED ENDPOINTS ========================

// Create a new post
app.post('/api/posts', authMiddleware, upload.array('images', 5), async (req, res) => {
  try {
    const { content, title, type, visibility, tags, location, industry } = req.body;

    // Validation
    if (!content || content.trim().length === 0) {
      return res.status(400).json({ error: 'Post content is required' });
    }

    if (content.length > 5000) {
      return res.status(400).json({ error: 'Post content exceeds maximum length (5000 characters)' });
    }

    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Process uploaded images
    const images = req.files ? req.files.map(file => `/uploads/${file.filename}`) : [];

    // Create post
    const post = new Post({
      author: req.user._id,
      authorName: `${user.firstName} ${user.lastName}`,
      authorAvatar: user.avatar,
      authorRole: user.role,
      authorCompany: user.company,
      content: content.trim(),
      title: title || '',
      type: type || 'post',
      visibility: visibility || 'public',
      images,
      tags: tags ? tags.split(',').map(t => t.trim().toLowerCase()) : [],
      location: location || '',
      industry: industry || ''
    });

    await post.save();

    // Populate author info before returning
    await post.populate('author', 'firstName lastName avatar');

    res.status(201).json({
      success: true,
      message: 'Post created successfully',
      post
    });
  } catch (error) {
    console.error('Post creation error:', error);
    res.status(500).json({ error: 'Failed to create post' });
  }
});

// Get personalized feed with smart ranking
app.get('/api/feed', authMiddleware, async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const skip = (page - 1) * limit;

    const user = await User.findById(req.user._id).populate('partners');
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const partnerIds = user.partners ? user.partners.map(p => p._id) : [];

    // PHASE 1: Get partner posts (highest priority)
    const partnerPosts = await Post.find({
      author: { $in: partnerIds },
      visibility: { $in: ['public', 'partners'] }
    })
      .populate('author', 'firstName lastName avatar role company')
      .sort({ createdAt: -1 })
      .lean();

    // PHASE 2: If we have enough partner posts, return them
    let feedPosts = [];

    if (partnerPosts.length >= limit) {
      feedPosts = partnerPosts.slice(0, limit);
    } else {
      // Add all partner posts
      feedPosts = [...partnerPosts];

      // PHASE 3: Get sponsored posts (ads)
      const sponsoredPosts = await Post.find({
        isSponsored: true,
        sponsorshipEndDate: { $gt: new Date() },
        visibility: 'public'
      })
        .populate('author', 'firstName lastName avatar role company')
        .sort({ engagementScore: -1 })
        .limit(Math.ceil((limit - feedPosts.length) * 0.2)) // 20% sponsored
        .lean();

      feedPosts = [...feedPosts, ...sponsoredPosts];

      // PHASE 4: Get high-partner-count users' posts (influential users)
      if (feedPosts.length < limit) {
        const remainingSlots = limit - feedPosts.length;

        // Get users with many partners
        const influentialUsers = await User.find({
          _id: { $nin: [req.user._id, ...partnerIds] },
          role: user.role, // Same role as current user
          partners: { $exists: true, $ne: [] }
        })
          .sort({ 'partners': -1 })
          .limit(10)
          .lean();

        const influentialUserIds = influentialUsers.map(u => u._id);

        const influentialPosts = await Post.find({
          author: { $in: influentialUserIds },
          visibility: 'public'
        })
          .populate('author', 'firstName lastName avatar role company')
          .sort({ engagementScore: -1, createdAt: -1 })
          .limit(remainingSlots)
          .lean();

        feedPosts = [...feedPosts, ...influentialPosts];
      }

      // PHASE 5: Get relevant project recommendations (if still need more content)
      if (feedPosts.length < limit && user.role === 'vendor') {
        const remainingSlots = limit - feedPosts.length;

        const relevantProjects = await Project.find({
          status: 'open',
          companyType: { $in: user.services || [] }
        })
          .populate('owner', 'firstName lastName avatar company')
          .sort({ createdAt: -1 })
          .limit(remainingSlots)
          .lean();

        // Convert projects to post-like format for display
        const projectPosts = relevantProjects.map(proj => ({
          _id: proj._id,
          isProject: true,
          title: proj.title,
          content: proj.description,
          author: proj.owner,
          authorName: `${proj.owner.firstName} ${proj.owner.lastName}`,
          authorAvatar: proj.owner.avatar,
          authorRole: 'owner',
          budget: proj.budget,
          location: proj.location,
          createdAt: proj.createdAt,
          type: 'project_update'
        }));

        feedPosts = [...feedPosts, ...projectPosts];
      }

      // PHASE 6: Get general public posts as fallback
      if (feedPosts.length < limit) {
        const remainingSlots = limit - feedPosts.length;
        const usedPostIds = feedPosts.map(p => p._id).filter(id => id);

        const generalPosts = await Post.find({
          _id: { $nin: usedPostIds },
          visibility: 'public',
          isSponsored: false
        })
          .populate('author', 'firstName lastName avatar role company')
          .sort({ engagementScore: -1, createdAt: -1 })
          .limit(remainingSlots)
          .lean();

        feedPosts = [...feedPosts, ...generalPosts];
      }
    }

    // Calculate engagement rate and add metadata
    const enrichedPosts = feedPosts.map(post => ({
      ...post,
      isLiked: post.likes ? post.likes.includes(req.user._id.toString()) : false,
      engagementRate: post.likeCount + (post.commentCount * 2) + (post.shares * 3)
    }));

    res.json({
      success: true,
      posts: enrichedPosts.slice(0, limit),
      hasMore: feedPosts.length > limit,
      page,
      limit
    });
  } catch (error) {
    console.error('Feed error:', error);
    res.status(500).json({ error: 'Failed to load feed' });
  }
});

// ======================== FEED OPTIMIZATION ENDPOINTS ========================

// Get trending posts
app.get('/api/trending-posts', authMiddleware, async (req, res) => {
  try {
    const { limit = 10, timeframe = '24h' } = req.query;

    // Calculate timeframe filter
    let timeframeDate = new Date();
    switch(timeframe) {
      case '24h':
        timeframeDate.setHours(timeframeDate.getHours() - 24);
        break;
      case '7d':
        timeframeDate.setDate(timeframeDate.getDate() - 7);
        break;
      case '30d':
        timeframeDate.setDate(timeframeDate.getDate() - 30);
        break;
      default:
        timeframeDate.setHours(timeframeDate.getHours() - 24);
    }

    const trendingPosts = await Post.find({
      visibility: 'public',
      createdAt: { $gte: timeframeDate },
      status: 'published',
      isSponsored: false
    })
      .populate('author', 'firstName lastName avatar role company')
      .sort({ engagementScore: -1, trendingScore: -1 })
      .limit(parseInt(limit))
      .lean();

    // Calculate trending metadata
    const enrichedPosts = trendingPosts.map(post => ({
      ...post,
      isTrending: true,
      trendScore: post.engagementScore
    }));

    res.json({
      success: true,
      posts: enrichedPosts,
      timeframe,
      count: enrichedPosts.length
    });
  } catch (error) {
    console.error('Trending posts error:', error);
    res.status(500).json({ error: 'Failed to load trending posts' });
  }
});

// Track post view/impression
app.post('/api/posts/:postId/view', authMiddleware, async (req, res) => {
  try {
    const { timeSpent = 0 } = req.body;
    const post = await Post.findById(req.params.postId);

    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }

    const userIdStr = req.user._id.toString();
    
    // Track unique views
    if (!post.viewedBy.some(id => id.toString() === userIdStr)) {
      post.viewedBy.push(req.user._id);
      post.viewCount = post.viewedBy.length;
    }

    // Calculate average time spent
    if (timeSpent > 0) {
      const currentAvg = post.timeSpentAvg || 0;
      const viewCount = post.viewCount || 1;
      post.timeSpentAvg = (currentAvg * (viewCount - 1) + timeSpent) / viewCount;
    }

    await post.save();

    res.json({
      success: true,
      viewCount: post.viewCount,
      engagementScore: post.engagementScore
    });
  } catch (error) {
    console.error('View tracking error:', error);
    res.status(500).json({ error: 'Failed to track view' });
  }
});

// Rate post (1-5 stars)
app.post('/api/posts/:postId/rate', authMiddleware, async (req, res) => {
  try {
    const { rating } = req.body;

    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'Rating must be between 1 and 5' });
    }

    const post = await Post.findById(req.params.postId);
    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }

    // Update feedback score (weighted average)
    const currentRatings = post.feedbackScore || 0;
    const viewCount = Math.max(post.viewCount || 1, 1);
    post.feedbackScore = (currentRatings * (viewCount - 1) + rating) / viewCount;

    await post.save();

    res.json({
      success: true,
      feedbackScore: post.feedbackScore,
      engagementScore: post.engagementScore
    });
  } catch (error) {
    console.error('Rating error:', error);
    res.status(500).json({ error: 'Failed to rate post' });
  }
});

// Save draft post
app.post('/api/posts/draft', authMiddleware, upload.array('images', 5), async (req, res) => {
  try {
    const { content, title, type } = req.body;

    if (!content || content.trim().length === 0) {
      return res.status(400).json({ error: 'Post content is required' });
    }

    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const images = req.files ? req.files.map(file => `/uploads/${file.filename}`) : [];

    const draft = new Post({
      author: req.user._id,
      authorName: `${user.firstName} ${user.lastName}`,
      authorAvatar: user.avatar,
      authorRole: user.role,
      authorCompany: user.company,
      content: content.trim(),
      title: title || '',
      type: type || 'post',
      images,
      isDraft: true,
      status: 'draft',
      visibility: 'private'
    });

    await draft.save();

    res.status(201).json({
      success: true,
      message: 'Draft saved successfully',
      draft
    });
  } catch (error) {
    console.error('Draft save error:', error);
    res.status(500).json({ error: 'Failed to save draft' });
  }
});

// Get user drafts
app.get('/api/drafts', authMiddleware, async (req, res) => {
  try {
    const drafts = await Post.find({
      author: req.user._id,
      isDraft: true,
      status: 'draft'
    })
      .sort({ createdAt: -1 })
      .lean();

    res.json({
      success: true,
      drafts,
      count: drafts.length
    });
  } catch (error) {
    console.error('Get drafts error:', error);
    res.status(500).json({ error: 'Failed to load drafts' });
  }
});

// Schedule a post for later
app.post('/api/posts/:postId/schedule', authMiddleware, async (req, res) => {
  try {
    const { scheduledFor } = req.body;

    if (!scheduledFor) {
      return res.status(400).json({ error: 'Scheduled time is required' });
    }

    const scheduledDate = new Date(scheduledFor);
    if (scheduledDate < new Date()) {
      return res.status(400).json({ error: 'Scheduled time must be in the future' });
    }

    const post = await Post.findById(req.params.postId);
    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }

    if (post.author.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Unauthorized to schedule this post' });
    }

    post.scheduledFor = scheduledDate;
    post.status = 'scheduled';
    post.isDraft = false;

    await post.save();

    res.json({
      success: true,
      message: 'Post scheduled successfully',
      scheduledFor: post.scheduledFor
    });
  } catch (error) {
    console.error('Schedule post error:', error);
    res.status(500).json({ error: 'Failed to schedule post' });
  }
});

// Get scheduled posts
app.get('/api/scheduled-posts', authMiddleware, async (req, res) => {
  try {
    const scheduled = await Post.find({
      author: req.user._id,
      status: 'scheduled',
      scheduledFor: { $gte: new Date() }
    })
      .sort({ scheduledFor: 1 })
      .lean();

    res.json({
      success: true,
      scheduledPosts: scheduled,
      count: scheduled.length
    });
  } catch (error) {
    console.error('Get scheduled posts error:', error);
    res.status(500).json({ error: 'Failed to load scheduled posts' });
  }
});

// Get feed analytics
app.get('/api/feed-analytics', authMiddleware, async (req, res) => {
  try {
    const userPosts = await Post.find({ author: req.user._id });

    const analytics = {
      totalPosts: userPosts.length,
      totalViews: userPosts.reduce((sum, p) => sum + (p.viewCount || 0), 0),
      totalLikes: userPosts.reduce((sum, p) => sum + (p.likeCount || 0), 0),
      totalComments: userPosts.reduce((sum, p) => sum + (p.commentCount || 0), 0),
      totalEngagement: userPosts.reduce((sum, p) => sum + (p.engagementScore || 0), 0),
      avgEngagementPerPost: userPosts.length > 0 ? 
        userPosts.reduce((sum, p) => sum + (p.engagementScore || 0), 0) / userPosts.length : 0,
      avgViewTime: userPosts.length > 0 ?
        userPosts.reduce((sum, p) => sum + (p.timeSpentAvg || 0), 0) / userPosts.length : 0,
      topPost: userPosts.sort((a, b) => (b.engagementScore || 0) - (a.engagementScore || 0))[0] || null,
      trendingPosts: userPosts.filter(p => p.isTrending).length
    };

    res.json({
      success: true,
      analytics
    });
  } catch (error) {
    console.error('Analytics error:', error);
    res.status(500).json({ error: 'Failed to load analytics' });
  }
});

// Filter feed by preferences
app.get('/api/feed/filtered', authMiddleware, async (req, res) => {
  try {
    const { postType, authorRole, minEngagement = 0, page = 1, limit = 20 } = req.query;
    const skip = (page - 1) * limit;

    let query = {
      visibility: 'public',
      status: 'published',
      engagementScore: { $gte: minEngagement }
    };

    if (postType) {
      query.type = postType;
    }

    if (authorRole) {
      query.authorRole = authorRole;
    }

    const filteredPosts = await Post.find(query)
      .populate('author', 'firstName lastName avatar role company')
      .sort({ engagementScore: -1, createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    const total = await Post.countDocuments(query);

    res.json({
      success: true,
      posts: filteredPosts,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit),
        hasMore: skip + parseInt(limit) < total
      }
    });
  } catch (error) {
    console.error('Filtered feed error:', error);
    res.status(500).json({ error: 'Failed to load filtered feed' });
  }
});

// ======================== END FEED OPTIMIZATION ========================

// Like/Unlike a post
app.post('/api/posts/:postId/like', authMiddleware, async (req, res) => {
  try {
    const post = await Post.findById(req.params.postId);
    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }

    const userIdStr = req.user._id.toString();
    const likeIndex = post.likes.findIndex(id => id.toString() === userIdStr);

    if (likeIndex > -1) {
      // Unlike
      post.likes.splice(likeIndex, 1);
    } else {
      // Like
      post.likes.push(req.user._id);
    }

    await post.save();

    res.json({
      success: true,
      liked: likeIndex === -1,
      likeCount: post.likes.length
    });
  } catch (error) {
    console.error('Like error:', error);
    res.status(500).json({ error: 'Failed to process like' });
  }
});

// Add comment to post
app.post('/api/posts/:postId/comments', authMiddleware, async (req, res) => {
  try {
    const { content } = req.body;

    if (!content || content.trim().length === 0) {
      return res.status(400).json({ error: 'Comment content is required' });
    }

    if (content.length > 500) {
      return res.status(400).json({ error: 'Comment exceeds maximum length' });
    }

    const post = await Post.findById(req.params.postId);
    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }

    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const comment = {
      author: req.user._id,
      authorName: `${user.firstName} ${user.lastName}`,
      authorAvatar: user.avatar,
      content: content.trim(),
      createdAt: new Date()
    };

    post.comments.push(comment);
    await post.save();

    res.status(201).json({
      success: true,
      message: 'Comment added successfully',
      comment,
      commentCount: post.comments.length
    });
  } catch (error) {
    console.error('Comment error:', error);
    res.status(500).json({ error: 'Failed to add comment' });
  }
});

// Get post comments
app.get('/api/posts/:postId/comments', async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const skip = (page - 1) * limit;

    const post = await Post.findById(req.params.postId);
    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }

    const totalComments = post.comments.length;
    const paginatedComments = post.comments
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(skip, skip + limit);

    res.json({
      success: true,
      comments: paginatedComments,
      total: totalComments,
      page,
      limit,
      hasMore: skip + limit < totalComments
    });
  } catch (error) {
    console.error('Get comments error:', error);
    res.status(500).json({ error: 'Failed to load comments' });
  }
});

// Delete post
app.delete('/api/posts/:postId', authMiddleware, async (req, res) => {
  try {
    const post = await Post.findById(req.params.postId);
    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }

    // Check authorization
    if (post.author.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Unauthorized to delete this post' });
    }

    // Delete associated images if needed
    if (post.images && post.images.length > 0) {
      post.images.forEach(imgPath => {
        const fullPath = path.join(__dirname, imgPath);
        if (fs.existsSync(fullPath)) {
          fs.unlinkSync(fullPath);
        }
      });
    }

    await Post.deleteOne({ _id: req.params.postId });

    res.json({
      success: true,
      message: 'Post deleted successfully'
    });
  } catch (error) {
    console.error('Delete post error:', error);
    res.status(500).json({ error: 'Failed to delete post' });
  }
});

// Get single post
app.get('/api/posts/:postId', async (req, res) => {
  try {
    const post = await Post.findById(req.params.postId)
      .populate('author', 'firstName lastName avatar role company');

    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }

    res.json({
      success: true,
      post
    });
  } catch (error) {
    console.error('Get post error:', error);
    res.status(500).json({ error: 'Failed to load post' });
  }
});

// ======================== SCHEDULED POST AUTO-PUBLISHING JOB ========================

// Auto-publish scheduled posts when their scheduled time arrives
let loggedSchedulerDbUnavailable = false;
setInterval(async () => {
  try {
    // Skip scheduler if DB is not connected
    if (mongoose.connection.readyState !== 1) {
      if (!loggedSchedulerDbUnavailable) {
        console.warn('⚠ Skipping scheduled post publisher: database not connected');
        loggedSchedulerDbUnavailable = true;
      }
      return;
    }

    loggedSchedulerDbUnavailable = false;
    const now = new Date();
    
    const scheduledPosts = await Post.find({
      status: 'scheduled',
      scheduledFor: { $lte: now }
    });

    for (const post of scheduledPosts) {
      post.status = 'published';
      post.publishedAt = now;
      post.isDraft = false;
      await post.save();
      console.log(`✅ Auto-published scheduled post: ${post._id}`);
    }

    if (scheduledPosts.length > 0) {
      console.log(`📅 Auto-published ${scheduledPosts.length} scheduled posts at ${now.toISOString()}`);
    }
  } catch (error) {
    console.error('Scheduled post publishing job error:', error);
  }
}, 60000); // Run every minute

// ======================== END SOCIAL FEED ENDPOINTS ========================

// ======================== HTML PAGE SERVING ========================
// Serve HTML pages with proper routing
const htmlPages = [
  'index.html', 'dashboard.html', 'projects.html', 'browse.html', 'profile.html',
  'messages.html', 'notifications.html', 'settings.html', 'create-project.html',
  'project-detail.html', 'signup.html', 'login.html', 'owner-signup.html',
  'owner-login.html', 'vendor-signup.html', 'vendor-login.html', 'company.html',
  'company-invite.html', 'all-projects.html', 'admin-companies.html', 'browse.html',
  'network.html', 'feed.html'
];

// Route each HTML page
htmlPages.forEach(page => {
  const pagePath = page.replace('.html', '').replace(/^index$/, '');
  
  // Route /page-name to page-name.html
  app.get(`/${pagePath === '' ? '' : pagePath}`, (req, res, next) => {
    // Skip if it looks like an API route
    if (req.path.startsWith('/api/') || req.path.startsWith('/public/') || req.path.startsWith('/uploads/')) {
      return next();
    }
    
    const filePath = path.join(__dirname, page);
    if (fs.existsSync(filePath)) {
      res.set({
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      });
      return res.sendFile(filePath);
    }
    next();
  });
});

// Catch 404 and serve index.html for SPA routing fallback
app.use((req, res, next) => {
  // Only for GET requests and not API routes
  if (req.method === 'GET' && !req.path.startsWith('/api/')) {
    const filePath = path.join(__dirname, 'index.html');
    if (fs.existsSync(filePath)) {
      return res.sendFile(filePath);
    }
  }
  
  // Return 404 for API routes and other methods
  res.status(404).json({ error: 'Not found' });
});

// ======================== ERROR HANDLER ========================
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'production' 
      ? 'Internal server error' 
      : err.message
  });
});

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 Genovad API running on port ${PORT}`);
  console.log(`📧 Email: ${process.env.RESEND_API_KEY ? 'Resend Configured' : (process.env.SMTP_HOST ? 'SMTP Configured' : 'Console logging mode')}`);
  console.log(`🗄️  MongoDB: ${process.env.MONGODB_URI ? 'Configured' : 'Not configured'}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}\n`);
});
