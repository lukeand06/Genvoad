# 🚀 QUICK START GUIDE - Genovad

## What You've Got

A complete, fully-functional construction services marketplace with:
- ✅ User registration & authentication
- ✅ Professional profiles with skills & portfolio
- ✅ Project posting & management
- ✅ Bidding system for contractors
- ✅ Real-time messaging between users
- ✅ Search & discovery for projects and professionals
- ✅ Dashboard with stats and analytics

## 🎯 Getting Started (5 minutes)

### Step 1: Install Dependencies
```bash
npm install
```

### Step 2: Configure Environment
1. Copy `.env.example` to `.env` (if not already done)
2. Edit `.env` and set:
   - `MONGODB_URI` - Your MongoDB connection string
   - `JWT_SECRET` - Any random string (for production, use a secure random string)
   - Mailgun settings (optional for development)

**Quick MongoDB Options:**
- **Local:** `mongodb://localhost:27017/genovad`
- **Cloud (Free):** Sign up at [MongoDB Atlas](https://www.mongodb.com/cloud/atlas) and get your connection string

### Step 3: Start the Server
```bash
# Development mode (auto-reload)
npm run dev

# OR Production mode
npm start
```

### Step 4: Open Your Browser
Navigate to: `http://localhost:5000`

## 📱 User Journey

### For Clients (Project Owners):
1. **Sign Up** → Verify email → **Login**
2. Go to **Dashboard**
3. Click **"Post Project"**
4. Fill in project details (title, description, budget, location)
5. View **bids** from contractors
6. **Accept a bid** and start working
7. **Message** contractors directly

### For Contractors (Service Providers):
1. **Sign Up** → Verify email → **Login**
2. Go to **Edit Profile**
3. Add your skills, services, experience, portfolio
4. Browse **Projects** page
5. **Submit bids** on projects matching your skills
6. **Message** clients to discuss details
7. Track bids on **Dashboard**

## 🔑 Key Pages

| Page | URL | Purpose |
|------|-----|---------|
| Landing | `/index.html` | Public homepage |
| Sign Up | `/signup.html` | User registration |
| Login | `/login.html` | User authentication |
| Dashboard | `/dashboard.html` | Personal overview & stats |
| Projects | `/projects.html` | Browse all projects |
| Project Detail | `/project-detail.html?id=xxx` | View project & submit bid |
| Create Project | `/create-project.html` | Post new project |
| Profile | `/profile.html` or `/profile.html?id=xxx` | View user profile |
| Edit Profile | `/edit-profile.html` | Update your information |
| Messages | `/messages.html` | Chat with users |
| Browse | `/browse.html` | Find professionals |

## 🛠️ Development Tips

### Testing Without Email
If you haven't configured Mailgun:
1. Sign up a user
2. Check the **server console** for the verification code
3. Enter it on the verification screen

### Database Management
View your data with:
- [MongoDB Compass](https://www.mongodb.com/products/compass) (GUI)
- MongoDB shell: `mongosh`

### API Testing
Use tools like:
- [Postman](https://www.postman.com/)
- [Insomnia](https://insomnia.rest/)
- Thunder Client (VS Code extension)

All API endpoints are at: `http://localhost:5000/api/`

## 📊 Database Collections

- **users** - All registered users
- **projects** - All posted projects
- **messages** - All messages between users

## 🎨 Customization

### Branding
- Update logo in navigation (SVG in HTML files)
- Change colors in Tailwind CSS classes
- Modify company name in all files

### Features to Add
- Payment integration (Stripe, PayPal)
- File uploads (images, documents)
- Reviews & ratings system
- Calendar/scheduling
- Real-time notifications (Socket.io)
- Advanced analytics

### Styling
The site uses **Tailwind CSS** via CDN. To customize:
1. Replace CDN with local Tailwind
2. Create `tailwind.config.js`
3. Customize your theme

## 🐛 Troubleshooting

### "Cannot connect to MongoDB"
- Make sure MongoDB is running
- Check your `MONGODB_URI` in `.env`
- For local: Start MongoDB with `mongod`

### "Port 5000 already in use"
- Change `PORT` in `.env` to another number (e.g., 3000)
- Or stop the process using port 5000

### "Module not found"
```bash
rm -rf node_modules
npm install
```

### Email verification not working
- Check Mailgun settings in `.env`
- For development, check console for verification codes
- Or set up a free Mailgun account

## 📈 Next Steps

### For Production:
1. Set up MongoDB Atlas (free tier available)
2. Configure Mailgun for emails
3. Set strong `JWT_SECRET`
4. Use HTTPS
5. Set up proper CORS origins
6. Add rate limiting
7. Deploy to:
   - [Heroku](https://www.heroku.com/)
   - [Render](https://render.com/)
   - [Railway](https://railway.app/)
   - [DigitalOcean](https://www.digitalocean.com/)
   - [AWS](https://aws.amazon.com/)

### Recommended Additions:
- [ ] Password reset functionality
- [ ] Email notifications for bids
- [ ] Push notifications
- [ ] Image upload for projects
- [ ] Document attachments
- [ ] Invoice generation
- [ ] Contract management
- [ ] Calendar integration
- [ ] Mobile app

## 🔐 Security Checklist

- ✅ Passwords hashed with bcrypt
- ✅ JWT authentication
- ✅ Email verification required
- ✅ Protected API routes
- ✅ CORS configured
- ⚠️ TODO: Rate limiting
- ⚠️ TODO: Input sanitization
- ⚠️ TODO: SQL injection prevention (N/A - using MongoDB)

## 📞 Support & Resources

### Documentation
- MongoDB: https://docs.mongodb.com/
- Express.js: https://expressjs.com/
- Tailwind CSS: https://tailwindcss.com/

### Community
- Stack Overflow
- MongoDB Community Forums
- Express.js GitHub Discussions

## 🎉 You're All Set!

Your construction services marketplace is ready to go! 

Start the server with `npm run dev` and open `http://localhost:5000`

Build something amazing! 🏗️
