#!/bin/bash

echo "========================================"
echo "DC Dashboard - Quick Setup Script"
echo "Ubuntu 18.04 Compatible"
echo "========================================"
echo ""

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "[ERROR] Node.js is not installed!"
    echo ""
    echo "Installing Node.js 16 LTS (compatible with Ubuntu 18.04)..."
    curl -fsSL https://deb.nodesource.com/setup_16.x | sudo -E bash -
    sudo apt-get install -y nodejs build-essential
    
    if [ $? -ne 0 ]; then
        echo "[ERROR] Failed to install Node.js"
        exit 1
    fi
fi

echo "[1/5] Node.js $(node --version) is installed ✓"
echo ""

# Check Node.js version
NODE_VERSION=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 16 ]; then
    echo "[ERROR] Node.js version is too old (need >= 16.14.0)"
    echo "Please upgrade Node.js"
    exit 1
fi

echo "[2/5] Installing dependencies..."
npm install
if [ $? -ne 0 ]; then
    echo "[ERROR] Failed to install dependencies"
    exit 1
fi
echo "Dependencies installed ✓"
echo ""

echo "[3/5] Rebuilding native modules for Ubuntu 18.04..."
npm rebuild better-sqlite3
if [ $? -ne 0 ]; then
    echo "[WARNING] Failed to rebuild better-sqlite3, but continuing..."
fi
echo "Native modules rebuilt ✓"
echo ""

echo "[4/5] Creating data directory..."
mkdir -p data
mkdir -p public/uploads
echo "Directories created ✓"
echo ""

echo "[5/5] Setup complete!"
echo ""
echo "========================================"
echo "IMPORTANT: Configure your FRS servers"
echo "========================================"
echo ""
echo "1. Edit config/config.json"
echo "2. Update server URLs and API tokens"
echo "3. Run: npm run dev"
echo "4. Open: http://localhost:3000"
echo ""
echo "========================================"
echo ""

read -p "Would you like to start the application now? (y/n) " START_NOW
if [[ $START_NOW =~ ^[Yy]$ ]]; then
    echo ""
    echo "Starting DC Dashboard..."
    echo "Press Ctrl+C to stop the server"
    echo ""
    npm run dev
fi
