/**
 * Seed script to populate demo companies in the database
 * Run with: node seed-companies.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Company = require('./models/Company');
const User = require('./models/User');

const seedCompanies = async () => {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/genovad', {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });

    console.log('Connected to MongoDB');

    // Check if companies already exist
    const existingCount = await Company.countDocuments();
    if (existingCount > 0) {
      console.log(`⚠️  Database already has ${existingCount} companies. Skipping seed.`);
      await mongoose.disconnect();
      return;
    }

    // Get a user to be the owner (or create a demo user)
    let demoUser = await User.findOne({ email: 'demo@genovad.com' });
    
    if (!demoUser) {
      // Create demo user
      const bcrypt = require('bcryptjs');
      const hashedPassword = await bcrypt.hash('demo123', 10);
      demoUser = new User({
        firstName: 'Demo',
        lastName: 'Admin',
        email: 'demo@genovad.com',
        password: hashedPassword,
        emailVerified: true,
        role: 'owner',
        location: 'Austin, TX'
      });
      await demoUser.save();
      console.log('Created demo user');
    }

    const sampleCompanies = [
      {
        name: 'BuildRight Contractors',
        legalName: 'BuildRight Contractors LLC',
        type: 'general_contractor',
        size: '51-200',
        yearFounded: 2015,
        description: 'Full-service general contractor specializing in commercial and residential construction projects. Licensed, insured, and committed to quality workmanship and customer satisfaction.',
        specialties: ['Commercial Construction', 'Residential Building', 'Project Management', 'Site Safety'],
        verified: true,
        rating: 4.8,
        reviewCount: 24,
        projectsCompleted: 45,
        address: {
          street: '456 Builder Lane',
          city: 'Austin',
          state: 'TX',
          zipCode: '78701',
          country: 'USA'
        },
        phone: '(512) 555-0100',
        email: 'info@buildright.com',
        website: 'https://buildright.com'
      },
      {
        name: 'ElectricPro Solutions',
        legalName: 'ElectricPro Solutions Inc',
        type: 'subcontractor',
        size: '11-50',
        yearFounded: 2018,
        description: 'Licensed electrical contractor providing residential and commercial electrical services. Expert in modern systems and green energy solutions.',
        specialties: ['Electrical Installation', 'Smart Home Systems', 'Solar Integration', 'Commercial Wiring'],
        verified: true,
        rating: 4.7,
        reviewCount: 18,
        projectsCompleted: 32,
        address: {
          street: '789 Spark Avenue',
          city: 'Austin',
          state: 'TX',
          zipCode: '78702',
          country: 'USA'
        },
        phone: '(512) 555-0101',
        email: 'contact@electricpro.com',
        website: 'https://electricpro.com'
      },
      {
        name: 'StoneWorks Supply',
        legalName: 'StoneWorks Supply Co',
        type: 'supplier',
        size: '51-200',
        yearFounded: 2012,
        description: 'Premium supplier of building materials including stone, timber, and specialty products. Serving contractors throughout Central Texas with competitive pricing.',
        specialties: ['Stone Materials', 'Timber Products', 'Hardware Supply', 'Specialty Materials'],
        verified: true,
        rating: 4.5,
        reviewCount: 42,
        projectsCompleted: 150,
        address: {
          street: '321 Material Drive',
          city: 'Austin',
          state: 'TX',
          zipCode: '78723',
          country: 'USA'
        },
        phone: '(512) 555-0102',
        email: 'sales@stoneworks.com',
        website: 'https://stoneworks.com'
      },
      {
        name: 'VisionArchitects',
        legalName: 'Vision Architects PLLC',
        type: 'architect',
        size: '11-50',
        yearFounded: 2010,
        description: 'Award-winning architecture firm focused on sustainable design and innovative solutions for commercial and residential projects. Serving Austin area.',
        specialties: ['Sustainable Design', 'Commercial Architecture', 'Residential Design', 'Project Coordination'],
        verified: true,
        rating: 4.9,
        reviewCount: 12,
        projectsCompleted: 28,
        address: {
          street: '654 Design Court',
          city: 'Austin',
          state: 'TX',
          zipCode: '78704',
          country: 'USA'
        },
        phone: '(512) 555-0103',
        email: 'hello@visionarch.com',
        website: 'https://visionarchitects.com'
      },
      {
        name: 'QuickFrame Framing',
        legalName: 'QuickFrame Framing LLC',
        type: 'subcontractor',
        size: '1-10',
        yearFounded: 2019,
        description: 'Expert framing contractor with 15+ years combined experience. Specializing in residential and light commercial framing with quick turnaround.',
        specialties: ['Wood Framing', 'Metal Framing', 'Structural Framing'],
        verified: false,
        rating: 4.3,
        reviewCount: 8,
        projectsCompleted: 16,
        address: {
          street: '987 Frame Road',
          city: 'Austin',
          state: 'TX',
          zipCode: '78705',
          country: 'USA'
        },
        phone: '(512) 555-0104',
        email: 'crew@quickframe.com'
      },
      {
        name: 'PaintPerfect',
        legalName: 'PaintPerfect Services',
        type: 'subcontractor',
        size: '1-10',
        yearFounded: 2016,
        description: 'Professional painting services for interior and exterior projects. Quality finishes, attention to detail, and reliable service you can trust.',
        specialties: ['Interior Painting', 'Exterior Painting', 'Specialty Finishes', 'Pressure Washing'],
        verified: true,
        rating: 4.6,
        reviewCount: 31,
        projectsCompleted: 89,
        address: {
          street: '147 Color Lane',
          city: 'Austin',
          state: 'TX',
          zipCode: '78706',
          country: 'USA'
        },
        phone: '(512) 555-0105',
        email: 'info@paintperfect.com',
        website: 'https://paintperfect.com'
      },
      {
        name: 'PlumeEngineering',
        legalName: 'Plume Engineering Group',
        type: 'engineer',
        size: '51-200',
        yearFounded: 2008,
        description: 'Structural and civil engineering firm with expertise in commercial and residential projects. State-of-the-art design and analysis capabilities.',
        specialties: ['Structural Engineering', 'Civil Engineering', 'BIM Modeling', 'Building Code Compliance'],
        verified: true,
        rating: 4.7,
        reviewCount: 19,
        projectsCompleted: 67,
        address: {
          street: '258 Engineer Avenue',
          city: 'Austin',
          state: 'TX',
          zipCode: '78707',
          country: 'USA'
        },
        phone: '(512) 555-0106',
        email: 'projects@plumeeng.com',
        website: 'https://plumeengineering.com'
      },
      {
        name: 'ConcreteExperts',
        legalName: 'Concrete Experts LLC',
        type: 'subcontractor',
        size: '11-50',
        yearFounded: 2014,
        description: 'Specialized concrete contractor for flatwork, decorative, and structural concrete. Serving Austin area with precision and quality.',
        specialties: ['Flatwork', 'Decorative Concrete', 'Stamped Concrete', 'Structural Concrete'],
        verified: true,
        rating: 4.4,
        reviewCount: 23,
        projectsCompleted: 52,
        address: {
          street: '369 Concrete Way',
          city: 'Austin',
          state: 'TX',
          zipCode: '78708',
          country: 'USA'
        },
        phone: '(512) 555-0107',
        email: 'contact@concreteexperts.com',
        website: 'https://concreteexperts.com'
      },
      {
        name: 'RoofMasters',
        legalName: 'RoofMasters Inc',
        type: 'subcontractor',
        size: '11-50',
        yearFounded: 2011,
        description: 'Professional roofing contractor specializing in residential and commercial roofing. Warranty-backed workmanship with licensed installers.',
        specialties: ['Asphalt Roofing', 'Metal Roofing', 'Flat Roofing', 'Roof Maintenance'],
        verified: true,
        rating: 4.5,
        reviewCount: 28,
        projectsCompleted: 73,
        address: {
          street: '741 Shingle Street',
          city: 'Austin',
          state: 'TX',
          zipCode: '78709',
          country: 'USA'
        },
        phone: '(512) 555-0108',
        email: 'info@roofmasters.com',
        website: 'https://roofmasters.com'
      },
      {
        name: 'PlumbingPros',
        legalName: 'Plumbing Pros LLC',
        type: 'subcontractor',
        size: '1-10',
        yearFounded: 2017,
        description: 'Licensed plumbing contractor offering residential and commercial plumbing services. Same-day service available for emergencies.',
        specialties: ['Residential Plumbing', 'Commercial Plumbing', 'Emergency Service', 'Water Heaters'],
        verified: true,
        rating: 4.7,
        reviewCount: 35,
        projectsCompleted: 104,
        address: {
          street: '852 Pipe Lane',
          city: 'Austin',
          state: 'TX',
          zipCode: '78710',
          country: 'USA'
        },
        phone: '(512) 555-0109',
        email: 'service@plumbingpros.com',
        website: 'https://plumbingpros.com'
      }
    ];

    // Create companies
    const createdCompanies = [];
    for (const companyData of sampleCompanies) {
      const company = new Company({
        ...companyData,
        owner: demoUser._id,
        members: [demoUser._id]
      });
      await company.save();
      createdCompanies.push(company);
    }

    console.log(`\n✅ Successfully created ${createdCompanies.length} demo companies:\n`);
    createdCompanies.forEach(c => {
      console.log(`  • ${c.name} (${c.type}) - Rating: ${c.rating}★ - ${c.verified ? '✓ Verified' : '○ Pending'}`);
    });

    console.log('\n📋 Demo user credentials:');
    console.log(`  Email: demo@genovad.com`);
    console.log(`  Password: demo123`);

    console.log('\n✨ Database seeded successfully!');
    await mongoose.disconnect();
  } catch (error) {
    console.error('❌ Seed error:', error);
    process.exit(1);
  }
};

// Run seed
seedCompanies();
