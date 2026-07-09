# Navigation Structure

## 📍 Application Routes

### 🏠 Homepage (`/`)
- **Component**: `DashboardHome.tsx`  
- **Purpose**: Server list and management overview
- **Features**:
  - OptiExacta branding with theme-aware logo
  - Grid of all configured FRS servers
  - Server status indicators (online/offline)
  - Search functionality for servers
  - "View All Cards" button → navigates to `/dashboard`
  - Individual server cards → click to navigate to `/server?ip={server_ip}`

### 🖥️ Individual Server View (`/server?ip={server_ip}`)
- **Component**: `ServerDashboard.tsx`
- **Purpose**: View cards from a specific server
- **Features**:
  - OptiExacta logo in header
  - Back button to homepage
  - Server-specific card grid
  - Search/filter cards by name, ID, watchlist
  - Card details drawer on click
  - Real-time data from FRS APIs

### 📊 Unified Dashboard (`/dashboard`) 
- **Component**: `DashboardPage.tsx`
- **Purpose**: View all cards from all servers combined
- **Features**:
  - OptiExacta branding
  - Sync status dashboard (last sync, next sync, server health)
  - Manual refresh button
  - Unified card grid from all servers
  - Advanced search across all servers
  - Auto-refresh every N hours

## 🔄 Data Flow

1. **Homepage** → Shows server list from `config.json`
2. **Click Server** → Navigate to `/server?ip=X` → Shows cards from that specific server
3. **Click "View All Cards"** → Navigate to `/dashboard` → Shows unified view of all cards
4. **Back Navigation** → All pages have proper back buttons/breadcrumbs

## 🎯 User Journey

```
Homepage (Server List)
├── Click "View All Cards" → Unified Dashboard
│   ├── Manual refresh button
│   ├── Search all cards
│   └── Sync status monitoring
└── Click Individual Server → Server Dashboard  
    ├── Server-specific cards
    ├── Server info in header
    └── Back to homepage button
```

## 🔧 Technical Implementation

- **Homepage**: Uses `LEGACY_CONFIG.LOCAL_SERVERS` for backward compatibility
- **Server Pages**: Filter unified data by `server_name` 
- **Unified View**: Uses `frsDataManager` for multi-server data aggregation
- **Navigation**: Next.js App Router with proper URLs and query parameters
- **Branding**: Consistent OptiExacta logo across all pages with theme switching
