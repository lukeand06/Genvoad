# Company Recommendation System

## Overview

The Genovad marketplace now features an intelligent company recommendation system that displays three categories of companies to users:

1. **Top Picks for You** - Highly-rated, verified, and established companies
2. **Companies You May Know** - Based on location, shared connections, and business type
3. **Recently Active Companies** - Companies with recent activity and projects

## Features

### Recommendation Algorithm

The system scores companies based on multiple factors:

#### Top Picks Scoring (60+ points to qualify)
- **Verified Status**: +40 points (most important)
- **Rating 4.5+**: +30 points
- **Rating 4.0+**: +20 points
- **20+ Projects Completed**: +25 points
- **10+ Projects Completed**: +15 points
- **Complete Profile** (100+ char description): +15 points
- **Website Listed**: +10 points
- **Recent Activity** (last 7 days): +10 points

#### May Know Scoring (30+ points to qualify)
- **Same Location**: +50 points
- **Previous Collaboration**: +60 points
- **Complementary Business Type**: +20 points
- **Shared Specialties/Skills**: +10 points per match

#### Recently Active Scoring (15+ points to qualify)
- **Updated Last Week**: +40 points
- **Updated Last Month**: +25 points
- **Updated Last 3 Months**: +10 points
- **5+ Projects Completed**: +15 points

### Data Included in Recommendations

Each company recommendation includes:
- Company name and logo
- Verification badge (if verified)
- Company type (e.g., General Contractor, Electrician, Supplier)
- Location
- Rating and review count
- Number of projects completed
- Description (for top picks)
- Reason for recommendation
- Last activity status

## API Endpoints

### Get Company Recommendations
```
GET /api/companies/recommendations
```

**Response:**
```json
{
  "topPicks": [...],
  "mayKnow": [...],
  "recentlyActive": [...],
  "totalCompanies": 10
}
```

### Seed Demo Companies (Development)
```
POST /api/companies/seed
```

Creates 10 sample companies with realistic data for testing and demonstration.

## Database Seeding

### Option 1: Automated Seed Script

```bash
node seed-companies.js
```

This creates:
- 10 demo companies with full profiles
- 1 demo user (demo@genovad.com / demo123)
- Varied verification statuses and ratings
- Realistic locations and contact info

### Option 2: API Endpoint

```bash
curl -X POST http://localhost:5000/api/companies/seed \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json"
```

## Demo Companies Included

1. **BuildRight Contractors** (General Contractor) - 4.8★, Verified, 45 projects
2. **ElectricPro Solutions** (Subcontractor) - 4.7★, Verified, 32 projects
3. **StoneWorks Supply** (Supplier) - 4.5★, Verified, 150 projects
4. **VisionArchitects** (Architect) - 4.9★, Verified, 28 projects
5. **QuickFrame Framing** (Subcontractor) - 4.3★, Pending, 16 projects
6. **PaintPerfect** (Subcontractor) - 4.6★, Verified, 89 projects
7. **PlumeEngineering** (Engineer) - 4.7★, Verified, 67 projects
8. **ConcreteExperts** (Subcontractor) - 4.4★, Verified, 52 projects
9. **RoofMasters** (Subcontractor) - 4.5★, Verified, 73 projects
10. **PlumbingPros** (Subcontractor) - 4.7★, Verified, 104 projects

## Frontend Pages

### Network Page (`/network.html`)
Displays three sections of company recommendations:
- Top picks in a card layout with full details
- Companies you may know with reason for recommendation
- Recently active companies with activity timestamps

### Browse Page (`/browse.html`)
Similar layout with:
- Type filtering (General Contractor, Subcontractor, etc.)
- Verified company filter
- Location-based results
- Show more functionality for expanded browsing

## Company Model Fields Used

```javascript
{
  name: String,
  type: String,              // general_contractor, subcontractor, architect, engineer, supplier
  verified: Boolean,
  rating: Number,
  reviewCount: Number,
  projectsCompleted: Number,
  description: String,
  address: {
    street: String,
    city: String,
    state: String,
    zipCode: String,
    country: String
  },
  phone: String,
  email: String,
  website: String,
  specialties: [String],
  owner: ObjectId,           // User who owns the company
  createdAt: Date,
  updatedAt: Date
}
```

## Testing the System

1. **Start the server:**
   ```bash
   npm run dev
   ```

2. **Seed the database:**
   ```bash
   node seed-companies.js
   ```

3. **Login with demo user:**
   - Email: `demo@genovad.com`
   - Password: `demo123`

4. **View recommendations:**
   - Navigate to `/network.html` to see all three recommendation types
   - Navigate to `/browse.html` for browsing with filters

## Recommendation Logic Flow

```
User loads /network.html
    ↓
Frontend calls GET /api/companies/recommendations
    ↓
Server fetches all companies from database
    ↓
For each company:
  - Calculate TOP_PICKS score
  - Calculate MAY_KNOW score  
  - Calculate RECENT_ACTIVITY score
  - Assign primary category with highest score
    ↓
Filter companies by category and score threshold:
  - topPicks: score >= 60
  - mayKnow: score >= 30
  - recentlyActive: score >= 15
    ↓
Sort each category by score (descending)
    ↓
Return top 10 of each category
    ↓
Frontend displays with styling and rich information
```

## Future Enhancements

- [ ] Machine learning-based scoring
- [ ] User preference learning
- [ ] Skill matching algorithm
- [ ] Industry trend analysis
- [ ] Seasonal recommendations
- [ ] A/B testing different algorithms
- [ ] Personalization based on browsing history
- [ ] Similar companies recommendations
- [ ] "You might also like" feature
- [ ] Recommendation feedback (helpful/not helpful)

## Troubleshooting

### "No companies to show"
- Check if database has been seeded: `node seed-companies.js`
- Verify companies exist: Check MongoDB database directly
- Check browser console for API errors

### Recommendations not loading
- Ensure user is authenticated
- Check server logs for `/api/companies/recommendations` errors
- Verify MongoDB connection is active

### Incorrect recommendations
- Review scoring logic in `server.js` lines 3458-3590
- Check user profile data (location, role, skills)
- Verify company data is complete (especially location fields)

## Related Files

- **Server Logic**: `/server.js` (lines 3380-3680)
- **Frontend Network**: `/network.html` (lines 156-377)
- **Frontend Browse**: `/browse.html` (lines 180-1200)
- **Database Seeding**: `/seed-companies.js`
- **Company Model**: `/models/Company.js`
- **User Model**: `/models/User.js`
