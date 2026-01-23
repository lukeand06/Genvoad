#!/bin/bash

# Quick Setup Script for Genovad
echo "🚀 Setting up Genovad..."

# Check if .env exists, if not copy from example
if [ ! -f .env ]; then
    echo "📝 Creating .env file from .env.example..."
    cp .env.example .env
    echo "⚠️  Please edit .env file with your configuration!"
fi

# Install dependencies
echo "📦 Installing dependencies..."
npm install

# Check if MongoDB is running
echo "🔍 Checking MongoDB connection..."
if command -v mongod &> /dev/null; then
    echo "✓ MongoDB is installed"
else
    echo "⚠️  MongoDB not found. Please install MongoDB or use MongoDB Atlas"
fi

echo ""
echo "✅ Setup complete!"
echo ""
echo "Next steps:"
echo "1. Edit .env file with your MongoDB URI and JWT secret"
echo "2. Start MongoDB if using local installation"
echo "3. Run 'npm run dev' to start the development server"
echo "4. Open http://localhost:5000 in your browser"
echo ""
