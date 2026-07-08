/**
 * Watchlist Cache Service
 * 
 * Provides per-server watchlist caching with:
 * - TTL-based expiration
 * - Background refresh
 * - Server health tracking
 * - Automatic retry for offline servers
 */

import axios from 'axios'
import { CONFIG } from '@/config/config'

export interface Watchlist {
  id: number
  name: string
  serverName?: string  // Track which server this watchlist belongs to
}

interface CachedWatchlistData {
  watchlists: Watchlist[]
  timestamp: number
  loading: boolean
  error: string | null
  serverStatus: 'online' | 'offline' | 'checking'
}

interface WatchlistCache {
  [serverName: string]: CachedWatchlistData
}

// Cache configuration (can be overridden via environment variables)
const CACHE_TTL_MS = parseInt(process.env.NEXT_PUBLIC_WATCHLIST_CACHE_TTL || '300000') // 5 minutes default
const PING_INTERVAL_MS = parseInt(process.env.NEXT_PUBLIC_PING_INTERVAL || '5000') // 5 seconds for offline servers
const PING_TIMEOUT_MS = parseInt(process.env.NEXT_PUBLIC_PING_TIMEOUT || '3000') // 3 seconds timeout for ping

class WatchlistCacheService {
  private cache: WatchlistCache = {}
  private subscribers: Set<() => void> = new Set()
  private retryTimers: Map<string, NodeJS.Timeout> = new Map()

  /**
   * Subscribe to cache updates
   */
  subscribe(callback: () => void): () => void {
    this.subscribers.add(callback)
    return () => this.subscribers.delete(callback)
  }

  /**
   * Notify all subscribers of cache changes
   */
  private notify() {
    this.subscribers.forEach(callback => callback())
  }

  /**
   * Initialize cache entry for a server
   */
  private initCache(serverName: string) {
    if (!this.cache[serverName]) {
      this.cache[serverName] = {
        watchlists: [],
        timestamp: 0,
        loading: false,
        error: null,
        serverStatus: 'checking'
      }
    }
  }

  /**
   * Check if cached data is still valid
   */
  private isCacheValid(serverName: string): boolean {
    const cached = this.cache[serverName]
    if (!cached || cached.watchlists.length === 0) return false
    
    const age = Date.now() - cached.timestamp
    return age < CACHE_TTL_MS
  }

  /**
   * Ping server to check if it's online
   */
  async pingServer(serverName: string): Promise<boolean> {
    const server = CONFIG.servers.find(s => s.name === serverName)
    if (!server) return false

    this.initCache(serverName)
    this.cache[serverName].serverStatus = 'checking'
    this.notify()

    try {
      // Use health-check API which uses system ping
      const response = await axios.get(`/api/health-check?server=${serverName}`, {
        timeout: PING_TIMEOUT_MS
      })
      
      const isOnline = response.data?.online === true
      this.cache[serverName].serverStatus = isOnline ? 'online' : 'offline'
      this.notify()
      return isOnline
    } catch (error) {
      this.cache[serverName].serverStatus = 'offline'
      this.notify()
      return false
    }
  }

  /**
   * Fetch watchlists from server (reuses existing /api/frs endpoint)
   */
  async fetchWatchlists(serverName: string, forceRefresh = false): Promise<Watchlist[]> {
    this.initCache(serverName)

    // Return cached data if valid and not forcing refresh
    if (!forceRefresh && this.isCacheValid(serverName)) {
      return this.cache[serverName].watchlists
    }

    // Check if already loading
    if (this.cache[serverName].loading) {
      return new Promise((resolve) => {
        const unsub = this.subscribe(() => {
          if (!this.cache[serverName].loading) {
            unsub()
            resolve(this.cache[serverName].watchlists)
          }
        })
      })
    }

    this.cache[serverName].loading = true
    this.cache[serverName].error = null
    this.notify()

    try {
      // First ping the server to check if it's online (fast check)
      const pingResponse = await axios.get(`/api/health-check?server=${serverName}`, {
        timeout: 3500 // 3.5 seconds to match ping timeout
      })

      if (!pingResponse.data?.online) {
        throw new Error('Server is offline')
      }

      // Server is online, now fetch watchlists
      const response = await axios.post('/api/frs', {
        serverName,
        endpoint: CONFIG.apiEndpoints.watchlists
      }, {
        timeout: 4000 // 4 seconds for the actual API call
      })

      if (response.data?.results) {
        const watchlists = response.data.results.map((wl: any) => ({
          id: wl.id,
          name: wl.name,
          serverName: serverName  // Add server name to each watchlist
        }))

        this.cache[serverName] = {
          watchlists,
          timestamp: Date.now(),
          loading: false,
          error: null,
          serverStatus: 'online'
        }

        // Clear any retry timer
        this.clearRetryTimer(serverName)

        this.notify()
        return watchlists
      } else {
        throw new Error('Invalid response format')
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to fetch watchlists'
      
      this.cache[serverName].loading = false
      this.cache[serverName].error = errorMessage
      
      if (errorMessage.includes('offline') || errorMessage.includes('timeout') || errorMessage.includes('Network')) {
        this.cache[serverName].serverStatus = 'offline'
        // Schedule retry
        this.scheduleRetry(serverName)
      }

      this.notify()
      throw error
    }
  }

  /**
   * Schedule automatic retry for offline server
   */
  private scheduleRetry(serverName: string) {
    // Don't auto-retry in browser to prevent infinite loops
    // Manual refresh button can be used instead
    if (typeof window !== 'undefined') {
      console.log(`⏸️ Auto-retry disabled in browser for ${serverName}. Use manual refresh.`)
      return
    }

    // Clear existing timer
    this.clearRetryTimer(serverName)

    // Set new timer for server-side only
    const timer = setInterval(async () => {
      console.log(`🔄 Retrying watchlist fetch for offline server: ${serverName}`)
      try {
        await this.fetchWatchlists(serverName, true)
      } catch (error) {
        // Continue retrying on error
      }
    }, PING_INTERVAL_MS)

    this.retryTimers.set(serverName, timer)
  }

  /**
   * Clear retry timer for a server
   */
  private clearRetryTimer(serverName: string) {
    const timer = this.retryTimers.get(serverName)
    if (timer) {
      clearInterval(timer)
      this.retryTimers.delete(serverName)
    }
  }

  /**
   * Get cached watchlists for a server (non-blocking)
   */
  getCached(serverName: string): CachedWatchlistData | null {
    return this.cache[serverName] || null
  }

  /**
   * Get watchlists for a specific server
   */
  async getWatchlists(serverName: string, forceRefresh = false): Promise<Watchlist[]> {
    return this.fetchWatchlists(serverName, forceRefresh)
  }

  /**
   * Get combined watchlists from all servers
   * Returns cached data immediately and triggers background refresh
   */
  async getAllWatchlists(backgroundRefresh = true): Promise<{
    watchlists: Array<Watchlist & { serverName: string }>
    serverStatuses: { [serverName: string]: CachedWatchlistData }
  }> {
    const allWatchlists: Array<Watchlist & { serverName: string }> = []
    const serverStatuses: { [serverName: string]: CachedWatchlistData } = {}

    // Collect cached data first
    for (const server of CONFIG.servers) {
      this.initCache(server.name)
      const cached = this.cache[server.name]
      serverStatuses[server.name] = cached

      if (cached.watchlists.length > 0) {
        // Add cached watchlists with server info
        cached.watchlists.forEach(wl => {
          allWatchlists.push({
            ...wl,
            serverName: server.name
          })
        })
      }

      // Trigger background refresh if needed
      if (backgroundRefresh && !this.isCacheValid(server.name) && !cached.loading) {
        this.fetchWatchlists(server.name).catch(() => {
          // Silently fail for background refresh
        })
      }
    }

    return { watchlists: allWatchlists, serverStatuses }
  }

  /**
   * Prefetch watchlists for all servers
   */
  async prefetchAll(): Promise<void> {
    const promises = CONFIG.servers.map(server => 
      this.fetchWatchlists(server.name).catch(() => {
        // Silently fail, data will be retried automatically
      })
    )
    await Promise.allSettled(promises)
  }

  /**
   * Clear cache for a specific server
   */
  clearCache(serverName: string) {
    if (this.cache[serverName]) {
      this.cache[serverName] = {
        watchlists: [],
        timestamp: 0,
        loading: false,
        error: null,
        serverStatus: 'checking'
      }
      this.clearRetryTimer(serverName)
      this.notify()
    }
  }

  /**
   * Clear all caches
   */
  clearAllCaches() {
    Object.keys(this.cache).forEach(serverName => {
      this.clearCache(serverName)
    })
  }

  /**
   * Stop all background processes
   */
  cleanup() {
    this.retryTimers.forEach(timer => clearInterval(timer))
    this.retryTimers.clear()
    this.subscribers.clear()
  }
}

// Export singleton instance
export const watchlistCache = new WatchlistCacheService()
