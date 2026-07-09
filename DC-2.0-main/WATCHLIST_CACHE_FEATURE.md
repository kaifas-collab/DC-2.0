# Watchlist Caching System

## Overview

The Watchlist Caching System provides intelligent, per-server watchlist caching with automatic background refresh, offline server detection, and retry mechanisms. This feature ensures a responsive UI while maintaining up-to-date data from all FRS servers.

## Features

### ✅ Per-Server Caching
- **Individual Cache**: Each server has its own watchlist cache
- **TTL-Based Expiration**: Configurable time-to-live (default: 5 minutes)
- **Instant Access**: Cached data loads immediately without API calls
- **Background Refresh**: Automatic refresh when cache expires

### ✅ Server Health Monitoring
- **Real-time Status**: Shows online/offline/checking status for each server
- **Visual Indicators**: 
  - 🟢 Green wifi icon = Server online
  - 🔴 Red wifi-off icon = Server offline
  - 🔄 Spinner = Checking/Loading
- **Automatic Retry**: Offline servers are retried every 5 seconds
- **Non-blocking UI**: Server checks don't freeze the interface

### ✅ Smart Watchlist Loading
- **"All Servers" Mode**: Combines watchlists from all available servers
- **Single Server Mode**: View watchlists from a specific server
- **Automatic Deduplication**: Removes duplicate watchlists when viewing all servers
- **Progressive Loading**: Shows cached data first, updates in background

### ✅ Offline Server Handling
- **Graceful Degradation**: UI remains functional when servers are offline
- **Background Polling**: Continuously checks offline servers
- **Auto-Recovery**: Automatically loads watchlists when server comes back online
- **User Notification**: Clear status messages for offline servers

## Architecture

### Components

#### 1. **WatchlistCacheService** (`lib/watchlistCache.ts`)
The core caching service that manages all watchlist data.

**Key Methods:**
- `getWatchlists(serverName, forceRefresh)` - Get watchlists for a specific server
- `getAllWatchlists(backgroundRefresh)` - Get combined watchlists from all servers
- `prefetchAll()` - Preload watchlists from all servers
- `subscribe(callback)` - Subscribe to cache updates
- `clearCache(serverName)` - Clear cache for a specific server

**Features:**
- Per-server cache storage
- TTL-based expiration
- Background refresh
- Server health tracking
- Automatic retry for offline servers
- Observable pattern for UI updates

#### 2. **AddCardDialog** (`components/_comps/AddCardDialog.tsx`)
Enhanced UI component with server selection and status indicators.

**New UI Elements:**
- Server selection buttons (All Servers / Individual Servers)
- Server status indicators (online/offline/loading)
- Watchlist count badges
- Manual refresh button
- Offline server notifications

#### 3. **Health Check API** (`app/api/health-check/route.ts`)
Extended health check endpoint supporting per-server checks.

**Endpoints:**
- `GET /api/health-check?server=ServerName` - Check specific server
- `POST /api/health-check` - Legacy IP-based check

#### 4. **FRS Proxy API** (`app/api/frs/route.ts`)
Reuses existing FRS proxy for all watchlist fetches.

## Configuration

### Environment Variables

```bash
# Cache time-to-live in milliseconds (default: 300000 = 5 minutes)
NEXT_PUBLIC_WATCHLIST_CACHE_TTL=300000

# Ping interval for offline servers in milliseconds (default: 5000 = 5 seconds)
NEXT_PUBLIC_PING_INTERVAL=5000

# Ping timeout in milliseconds (default: 3000 = 3 seconds)
NEXT_PUBLIC_PING_TIMEOUT=3000
```

### Server Configuration

Servers are configured in `config/config.json`:

```json
{
  "servers": [
    {
      "name": "FRS-Server-Basti",
      "baseURL": "http://100.79.200.21/",
      "token": "...",
      "location": "Basti"
    }
  ],
  "apiEndpoints": {
    "watchlists": "/watch-lists/"
  }
}
```

## Usage

### In Components

```typescript
import { watchlistCache } from '@/lib/watchlistCache'

// Get watchlists for a specific server
const watchlists = await watchlistCache.getWatchlists('FRS-Server-Basti')

// Get all watchlists from all servers
const { watchlists, serverStatuses } = await watchlistCache.getAllWatchlists()

// Subscribe to cache updates
const unsubscribe = watchlistCache.subscribe(() => {
  // Handle cache update
  updateUI()
})

// Clean up
unsubscribe()
```

### User Flow

1. **Open Add Card Dialog**
   - All servers' watchlists are fetched in parallel
   - Cached data shows immediately if available
   - Loading indicators show for servers being fetched

2. **Select Server**
   - Click "All Servers" to see combined watchlists
   - Click specific server to see only its watchlists
   - Status icons show server health

3. **Offline Servers**
   - Offline servers show red wifi-off icon
   - Background retry happens every 5 seconds
   - When server comes online, watchlists load automatically

4. **Manual Refresh**
   - Click refresh button to force reload
   - Useful when watchlists are updated on FRS server

## Performance Optimizations

### 1. **Cache-First Strategy**
- Always read from cache first
- API calls only when cache is expired or empty
- Reduces latency from seconds to milliseconds

### 2. **Parallel Fetching**
- All servers fetched simultaneously
- No blocking waiting for slow servers
- UI updates as data becomes available

### 3. **Background Operations**
- Cache refresh happens in background
- Server health checks are non-blocking
- Retry mechanism doesn't interfere with UI

### 4. **Deduplication**
- Prevents redundant API calls
- Removes duplicate watchlists in "All Servers" mode
- Efficient memory usage

## Error Handling

### Network Errors
- Automatically marked as offline
- Retry scheduled with exponential backoff
- User notified with clear error messages

### Timeout Errors
- 10-second timeout for watchlist fetches
- 3-second timeout for health checks
- Graceful fallback to cached data

### Server Not Found
- Validation against config.json
- Clear error messages
- No app crash

## Monitoring & Debugging

### Console Logs
```javascript
🔄 Retrying watchlist fetch for offline server: FRS-Server-Basti
📥 FRS Proxy received: { serverName: 'FRS-Server-Basti', endpoint: '/watch-lists/' }
✅ FRS API Success: 15 items
```

### Browser DevTools
- Check watchlist cache state in Components tab
- Monitor network requests in Network tab
- View server statuses in React DevTools

## Migration Guide

### From Old Implementation
The new system is **backward compatible**. No changes needed to existing code.

**Old Code (still works):**
```typescript
const response = await axios.post('/api/frs', {
  serverName: 'FRS-Server-Basti',
  endpoint: CONFIG.apiEndpoints.watchlists
})
```

**New Code (recommended):**
```typescript
const watchlists = await watchlistCache.getWatchlists('FRS-Server-Basti')
```

## Testing

### Manual Testing

1. **Test Cache Hit**
   ```
   1. Open Add Card dialog
   2. Wait for watchlists to load
   3. Close and reopen dialog
   4. Should load instantly from cache
   ```

2. **Test Cache Expiration**
   ```
   1. Set NEXT_PUBLIC_WATCHLIST_CACHE_TTL=5000 (5 seconds)
   2. Open dialog, load watchlists
   3. Wait 6 seconds
   4. Reopen dialog
   5. Should fetch fresh data
   ```

3. **Test Offline Server**
   ```
   1. Disconnect one server from network
   2. Open Add Card dialog
   3. Should show red wifi-off icon
   4. Reconnect server
   5. Within 5 seconds, should show green wifi icon
   6. Watchlists should load automatically
   ```

4. **Test All Servers Mode**
   ```
   1. Open Add Card dialog
   2. Click "All Servers" button
   3. Should see combined watchlists
   4. Watchlist count should show on each server button
   ```

### Automated Testing (Future)
```typescript
describe('WatchlistCache', () => {
  it('should cache watchlists per server', async () => {
    const watchlists = await watchlistCache.getWatchlists('FRS-Server-Basti')
    expect(watchlists).toHaveLength(15)
    
    // Second call should use cache
    const cached = await watchlistCache.getWatchlists('FRS-Server-Basti')
    expect(cached).toBe(watchlists)
  })
})
```

## Troubleshooting

### Watchlists Not Loading
1. Check server connectivity: `ping <server-ip>`
2. Check FRS API is running: `curl http://<server-ip>/watch-lists/`
3. Check auth token in config.json
4. Check browser console for errors

### Cache Not Expiring
1. Verify NEXT_PUBLIC_WATCHLIST_CACHE_TTL is set correctly
2. Clear browser cache and reload
3. Check server time is synchronized

### Offline Server Not Retrying
1. Check NEXT_PUBLIC_PING_INTERVAL is set
2. Check browser console for retry logs
3. Verify health check API is working: `/api/health-check?server=FRS-Server-Basti`

## Future Enhancements

- [ ] Persistent cache (localStorage/IndexedDB)
- [ ] Exponential backoff for retries
- [ ] Cache size limits and LRU eviction
- [ ] Metrics and analytics
- [ ] WebSocket for real-time updates
- [ ] Service worker for offline support

## Related Files

- `lib/watchlistCache.ts` - Core caching service
- `components/_comps/AddCardDialog.tsx` - UI component
- `app/api/health-check/route.ts` - Health check endpoint
- `app/api/frs/route.ts` - FRS proxy endpoint
- `config/config.json` - Server configuration

## Support

For issues or questions:
1. Check console logs for detailed error messages
2. Verify server configuration in config.json
3. Test individual endpoints with curl/Postman
4. Review this documentation for troubleshooting steps
