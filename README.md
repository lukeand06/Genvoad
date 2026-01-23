# Genovad - Construction Services Marketplace

A professional networking and project marketplace platform for the construction industry - like LinkedIn and Indeed, but specifically for construction services.

## Features

### 🔐 User Authentication
- Email/password registration with email verification
- Secure JWT-based authentication
- Password hashing with bcrypt

### 👤 User Profiles
- Complete professional profiles with bio, skills, and services
- Portfolio showcase
- Company information and contact details
- User ratings and reviews
- Years of experience tracking

### 📋 Project Management
- Post construction projects with detailed requirements
- Budget and timeline specification
- Project categorization (Residential, Commercial, Industrial, etc.)
- Status tracking (Open, In Progress, Completed, Cancelled)

### 💼 Bidding System
- Submit bids on open projects
- Include bid amount, proposal, and timeline
- Project owners can accept/reject bids
- Automatic notification system

### 💬 Messaging
- Real-time messaging between users
- Conversation history
- Unread message notifications
- Direct messaging from profiles and projects

### 🔍 Search & Discovery
- Browse all available projects
- Filter projects by category, status, location
- Search for professionals by skills and services
- Advanced search capabilities

### 📊 Dashboard
- Personal dashboard with stats
- Active projects overview
- New bids tracking
- Messages count
- Recent activity feed

## Tech Stack

### Backend
- **Node.js** with Express.js
- **MongoDB** with Mongoose ODM
- **JWT** for authentication
- **bcrypt** for password hashing
- **Mailgun** for email notifications
- **CORS** enabled

### Frontend
- **Vanilla JavaScript** (no framework dependencies)
- **Tailwind CSS** for styling
- **Responsive design** for all devices

## Installation

1. **Clone the repository**
   ```bash
   cd new-genovad
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   - Copy `.env.example` to `.env`
   - Update the values with your configuration:
     - MongoDB connection string
     - JWT secret key
     - Mailgun credentials (optional, for email verification)

4. **Start MongoDB**
   - Make sure MongoDB is running locally, or
   - Use MongoDB Atlas cloud database

5. **Start the server**
   ```bash
   # Development mode with auto-reload
   npm run dev

   # Production mode
   npm start
   ```

6. **Access the application**
   - Open your browser to `http://localhost:5000`

## Project Structure

```
new-genovad/
├── models/              # Database models
│   ├── User.js         # User schema
│   ├── Project.js      # Project schema
│   └── Message.js      # Message schema
├── utils/              # Utility functions
│   └── email.js        # Email sending
├── public/             # Static files
│   └── js/            
│       └── auth.js     # Authentication utilities
├── index.html          # Landing page
├── signup.html         # Registration page
├── login.html          # Login page
├── dashboard.html      # User dashboard
├── projects.html       # Browse projects
├── project-detail.html # Single project view
├── create-project.html # Create new project
├── profile.html        # User profile view
├── edit-profile.html   # Edit profile
├── messages.html       # Messaging interface
├── browse.html         # Browse professionals
├── server.js           # Express server
└── package.json        # Dependencies

```

## API Endpoints

### Authentication
- `POST /api/auth/signup` - Register new user
- `POST /api/auth/verify` - Verify email with code
- `POST /api/auth/login` - Login user
- `GET /api/auth/me` - Get current user

### Users
- `GET /api/users` - Search users (with filters)
- `GET /api/users/:id` - Get user profile
- `PUT /api/users/profile` - Update own profile

### Projects
- `GET /api/projects` - Get all projects (with filters)
- `GET /api/projects/:id` - Get single project
- `POST /api/projects` - Create new project
- `POST /api/projects/:id/bids` - Submit bid
- `POST /api/projects/:projectId/bids/:bidId/accept` - Accept bid

### Messages
- `GET /api/messages/conversations` - Get all conversations
- `GET /api/messages/:userId` - Get messages with specific user
- `POST /api/messages` - Send message

## Key Features Explained

### User Registration & Verification
- Users sign up with basic information
- System sends verification code via email
- Email must be verified before login
- Secure password storage with bcrypt

### Project Workflow
1. Client posts a project with requirements
2. Contractors browse available projects
3. Contractors submit bids with proposals
4. Client reviews bids and accepts one
5. Project status updates to "In Progress"
6. Users communicate via messaging

### Profile System
- Showcase skills and services offered
- Display past projects and portfolio
- Ratings and reviews from clients
- Company information and credentials

### Messaging System
- Direct messaging between any users
- Threaded conversations
- Real-time message updates (polling)
- Unread message notifications

## Environment Variables

Create a `.env` file with:

```env
MONGODB_URI=mongodb://localhost:27017/genovad
JWT_SECRET=your-secret-key-here
MAILGUN_API_KEY=your-mailgun-key
MAILGUN_DOMAIN=your-domain.mailgun.org
MAILGUN_FROM_EMAIL=noreply@yourdomain.com
MAILGUN_FROM_NAME=Genovad
PORT=5000
FRONTEND_URL=http://localhost:5000
```

## Development

### Running in Development Mode
```bash
npm run dev
```
This uses nodemon for auto-reloading on file changes.

### Database Setup
The app will automatically create necessary collections and indexes when you start it. Make sure MongoDB is running first.

### Email Configuration
Email verification is optional for development. If Mailgun is not configured, the app will still work but email notifications won't be sent. Check console logs for verification codes during testing.

## Production Deployment

1. Set up a MongoDB database (MongoDB Atlas recommended)
2. Configure environment variables on your hosting platform
3. Set `NODE_ENV=production`
4. Use a process manager like PM2:
   ```bash
   npm install -g pm2
   pm2 start server.js --name genovad
   ```

## Security Notes

- Passwords are hashed with bcrypt (10 rounds)
- JWT tokens expire after 7 days
- Email verification required before login
- All API routes (except auth) require authentication
- CORS configured for security

## Future Enhancements

- File upload for project images and documents
- Real-time notifications with WebSockets
- Payment integration for project transactions
- Advanced search with geolocation
- Reviews and rating system
- Calendar integration for scheduling
- Mobile app (React Native)

## Contributing

This is a full-featured platform ready for production use or further customization for specific construction industry needs.

## License

MIT License - feel free to use and modify for your needs.

## Support

For issues or questions, please create an issue in the repository.

---

Built with ❤️ for the construction industry
