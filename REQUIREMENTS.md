# Central DB Dashboard - System Requirements

## Overview
This document outlines the system requirements and dependencies needed to run the Central DB Dashboard application on Ubuntu 18.04 LTS.

## System Requirements

### Operating System
- **Ubuntu 18.04 LTS** (Bionic Beaver)
- **glibc version**: 2.27 (pre-installed)
- **Architecture**: x64

### Hardware Requirements
- **RAM**: Minimum 2GB, Recommended 4GB+
- **Storage**: Minimum 500MB free space
- **CPU**: Any modern x64 processor
- **Network**: Active internet connection for FRS server communication

## Software Dependencies

### 1. Node.js Runtime
- **Version**: 16.20.2 (Maximum supported on Ubuntu 18.04)
- **npm Version**: 8.19.4
- **Installation Source**: NodeSource repository
- **Why this version**: Ubuntu 18.04 has glibc 2.27 which limits Node.js to version 16.x maximum

#### Installation Command:
```bash
curl -fsSL https://deb.nodesource.com/setup_16.x | sudo -E bash -
sudo apt-get install -y nodejs
```

### 2. System Packages
Required system packages that must be installed:

```bash
sudo apt-get update
sudo apt-get install -y \
  curl \
  git \
  build-essential \
  python \
  make \
  g++
```

**Purpose**:
- `curl`: Download files and make HTTP requests
- `git`: Version control (optional for development)
- `build-essential`, `python`, `make`, `g++`: Required for building native Node.js modules (better-sqlite3)

### 3. Project Dependencies
All Node.js packages are managed via npm and defined in `package.json`

#### Core Framework Dependencies:
- **Next.js**: 13.5.6 (React framework)
- **React**: 18.2.0
- **React DOM**: 18.2.0

#### Database:
- **better-sqlite3**: 9.6.0 (SQLite database with native bindings; v9 line is Node 16 compatible)

#### UI Libraries:
- **Tailwind CSS**: 3.3.6 (Styling)
- **Radix UI**: Multiple components for accessible UI
- **Framer Motion**: 11.3.31 (Animations)
- **Lucide React**: 0.445.0 (Icons)

#### HTTP Client:
- **Axios**: 1.6.2 (API requests to FRS servers)

#### Complete dependency list available in `package.json`

## FRS Server Requirements

### Network Configuration
The application connects to external FRS (Facial Recognition System) servers. Ensure:

1. **Network Access**: Server can reach FRS server IP addresses
2. **Firewall Rules**: Allow outbound HTTP/HTTPS connections
3. **FRS Server Endpoints**: Configure in `config/config.json`

### FRS Server Configuration File
Location: `config/config.json`

```json
{
  "servers": [
    {
      "name": "FRS-Server-1",
      "baseURL": "http://YOUR_FRS_IP_1/",
      "location": "Location 1"
    },
    {
      "name": "FRS-Server-2",
      "baseURL": "http://YOUR_FRS_IP_2/",
      "location": "Location 2"
    }
  ],
  "apiEndpoints": {
    "cards": "cards/humans/",
    "watchlists": "watch-lists/",
    "faces": "objects/faces/"
  }
}
```

## Directory Structure Requirements

### Required Directories
The application will auto-create these, but ensure write permissions:

```
/home/ffu/Documents/Central_DB_Dashboard/
├── data/                    # SQLite database storage
│   └── frs.db              # Main database file (auto-created)
├── public/
│   └── uploads/            # Downloaded face images (auto-created)
├── .next/                  # Next.js build cache (auto-created)
└── node_modules/           # npm packages (auto-created)
```

### Permissions
Ensure the application user has write permissions:
```bash
sudo chown -R $USER:$USER /home/ffu/Documents/Central_DB_Dashboard
chmod -R 755 /home/ffu/Documents/Central_DB_Dashboard
```

## Port Requirements

### Application Port
- **Port 3000**: Default Next.js development server port
- **Alternative**: Can be changed via environment variable `PORT`

### Check Port Availability:
```bash
sudo lsof -i :3000
# Or
sudo netstat -tulpn | grep :3000
```

### Kill Process on Port (if needed):
```bash
sudo fuser -k 3000/tcp
```

## Installation Steps

### Quick Start Installation
Run the automated setup script:
```bash
cd /home/ffu/Documents/Central_DB_Dashboard
chmod +x setup.sh
./setup.sh
```

### Manual Installation
If you prefer manual setup:

1. **Install Node.js 16**:
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_16.x | sudo -E bash -
   sudo apt-get install -y nodejs
   ```

2. **Verify Installation**:
   ```bash
   node --version  # Should show v16.20.2
   npm --version   # Should show 8.19.4
   ```

3. **Install Dependencies**:
   ```bash
   npm install
   ```

4. **Rebuild Native Modules**:
   ```bash
   npm rebuild better-sqlite3
   ```

5. **Configure FRS Servers**:
   Edit `config/config.json` with your FRS server details

6. **Start Application**:
   ```bash
   npm run dev
   ```

7. **Access Dashboard**:
   Open browser to `http://localhost:3000`

## Environment Variables (Optional)

Create a `.env.local` file for custom configuration:

```env
# Server Configuration
PORT=3000
NODE_ENV=development

# Database Configuration
DB_PATH=./data/frs.db

# API Configuration
API_TIMEOUT=15000

# Image Upload Configuration
UPLOAD_DIR=./public/uploads
MAX_IMAGE_SIZE=10485760
```

## Runtime Memory Requirements

### Typical Memory Usage:
- **Development Mode**: ~200-400 MB
- **Production Mode**: ~150-250 MB
- **Database Size**: Varies (approximately 1KB per card record)
- **Image Storage**: Varies (approximately 50-100KB per face image)

### Estimate Storage for 10,000 Cards:
- **Database**: ~10 MB
- **Images**: ~500 MB - 1 GB
- **Total**: ~1.5 GB

## Troubleshooting Common Issues

### Issue: Node.js Version Mismatch
**Solution**: Ensure Node.js 16.x is installed (Ubuntu 18.04 limitation)

### Issue: better-sqlite3 Build Failure
**Solution**: 
```bash
sudo apt-get install -y build-essential python
npm rebuild better-sqlite3
```

### Issue: Permission Denied Errors
**Solution**:
```bash
sudo chown -R $USER:$USER .
mkdir -p public/uploads data
chmod 755 public/uploads data
```

### Issue: Port 3000 Already in Use
**Solution**:
```bash
sudo fuser -k 3000/tcp
# Or change port
PORT=3001 npm run dev
```

### Issue: Cannot Connect to FRS Server
**Solution**:
- Verify FRS server IP and port in `config/config.json`
- Test connectivity: `curl http://FRS_SERVER_IP/cards/humans/`
- Check firewall rules

### Issue: CSS Not Loading
**Solution**:
```bash
rm -rf .next
npm run dev
```

## Security Considerations

### Network Security
- Use HTTPS for FRS server connections in production
- Configure firewall to allow only necessary ports
- Use VPN for remote FRS server access if needed

### File System Security
- Ensure proper file permissions (755 for directories, 644 for files)
- Regularly backup the `data/frs.db` database
- Implement access controls for the application

### Application Security
- Keep dependencies updated (npm audit)
- Use environment variables for sensitive configuration
- Implement authentication if deploying publicly

## Maintenance

### Regular Tasks
1. **Database Backup**:
   ```bash
   cp data/frs.db data/frs.db.backup.$(date +%Y%m%d)
   ```

2. **Clear Old Images**:
   ```bash
   find public/uploads -type f -mtime +30 -delete
   ```

3. **Update Dependencies**:
   ```bash
   npm outdated
   npm update
   ```

4. **Check Logs**:
   ```bash
   npm run dev 2>&1 | tee logs/app.log
   ```

## Performance Optimization

### For Large Datasets (10,000+ cards):
1. Enable SQLite WAL mode (already configured)
2. Adjust pagination size in code if needed
3. Consider image compression for storage
4. Implement caching strategies

### Production Deployment:
```bash
npm run build
npm run start
```

## Support and Documentation

### Additional Documentation Files:
- `README.md` - Project overview and quick start
- `INSTALLATION_18.04.md` - Detailed Ubuntu 18.04 setup guide
- `UBUNTU_18.04_COMPATIBILITY.md` - Compatibility notes and limitations
- `INSTALLATION.md` - Step-by-step installation guide
- `NAVIGATION.md` - Application usage guide

### Check System Compatibility:
```bash
./check-system.sh
```

## Version Information

- **Application Version**: 0.1.0
- **Last Updated**: November 2025
- **Node.js**: 16.20.2
- **Next.js**: 13.5.6
- **Target OS**: Ubuntu 18.04 LTS

---

**Note**: This application is specifically configured for Ubuntu 18.04 LTS. For other operating systems or Ubuntu versions, dependency versions may need adjustment.
