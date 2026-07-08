# DC Dashboard Installation Guide

## Quick Installation Steps

### Prerequisites
- **Bun** (JavaScript runtime) - Install from https://bun.sh
- **Git** (optional, for cloning)

### Option 1: Install from GitHub (Recommended)

```bash
# Clone the repository
git clone https://github.com/kaifas-collab/Central_DB_Dashboard.git
cd Central_DB_Dashboard

# Install dependencies
bun install

# Configure your FRS servers (edit config/config.json)
# Update the server URLs and credentials

# Run the application
bun run dev
```

The application will be available at: http://localhost:3000

### Option 2: Install from Package (Offline)

1. **Extract the package** to your desired location
2. **Install Bun** if not already installed:
   ```bash
   # Windows (PowerShell)
   powershell -c "irm bun.sh/install.ps1 | iex"
   
   # Linux/Mac
   curl -fsSL https://bun.sh/install | bash
   ```

3. **Navigate to the project directory**:
   ```bash
   cd Central_DB_Dashboard
   ```

4. **Install dependencies**:
   ```bash
   bun install
   ```

5. **Configure FRS servers** (edit `config/config.json`):
   ```json
   {
     "servers": [
       {
         "id": "server-1",
         "name": "FRS-Server-1",
         "baseURL": "http://YOUR_FRS_IP:PORT",
         "apiToken": "YOUR_API_TOKEN"
       }
     ]
   }
   ```

6. **Start the application**:
   ```bash
   # Development mode
   bun run dev
   
   # Production mode
   bun run build
   bun run start
   ```

### Configuration

#### FRS Server Settings
Edit `config/config.json` to add your FRS servers:
- `baseURL`: Your FRS server address (e.g., http://172.203.130.108)
- `apiToken`: Your FRS API authentication token

#### Environment Variables (Optional)
Create a `.env.local` file for custom settings:
```
# Custom port (default: 3000)
PORT=3000

# Database location (default: ./data/cards.db)
DATABASE_PATH=./data/cards.db
```

### Production Deployment

#### Using PM2 (Process Manager)
```bash
# Install PM2
npm install -g pm2

# Start the application
bun run build
pm2 start "bun run start" --name "dc-dashboard"

# Save PM2 configuration
pm2 save
pm2 startup
```

#### Using Docker (Optional)
```bash
# Build Docker image
docker build -t dc-dashboard .

# Run container
docker run -p 3000:3000 -v ./data:/app/data dc-dashboard
```

### Troubleshooting

**Port already in use:**
```bash
# Change port in package.json or use:
PORT=3001 bun run dev
```

**Database issues:**
```bash
# Delete database and resync
rm -rf data/
# Restart app and click "Force Refresh"
```

**Image download issues:**
- Check FRS server connectivity
- Verify API token is correct
- Ensure sufficient disk space in `public/uploads/`

### Features

✅ **Central FR Face Database**: Unified view of all records  
✅ **Multi-Server Support**: Connect to multiple FRS servers  
✅ **Search Functionality**: Search across all servers  
✅ **Pagination**: 10 items per page for better performance  
✅ **Bulk Image Downloads**: Automatic image fetching (20 at a time)  
✅ **Watchlist Integration**: Full watchlist name display  
✅ **Delete Operations**: Delete from central DB or both DB and FRS  
✅ **Dark/Light Theme**: Toggle UI theme  

### Default Access

- **URL**: http://localhost:3000
- **Dashboard**: Main page shows all FRS servers
- **Individual Server**: Click server card to view records
- **Record Details**: Click any record to see full details

### Security Notes

- Keep your FRS API tokens secure
- Use `.env.local` for sensitive configuration
- The database is stored locally in `data/` directory
- Images are cached in `public/uploads/` directory
- Add these to `.gitignore` (already configured)

### Support

For issues or questions, check the documentation files:
- `BULK_DELETE_FEATURE.md`
- `DELETE_CARD_FEATURE.md`
- `SQLITE_IMPLEMENTATION.md`
- `NAVIGATION.md`
