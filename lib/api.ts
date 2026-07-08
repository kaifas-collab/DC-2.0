import axios, { type AxiosInstance, AxiosError } from 'axios'
import { CONFIG } from '@/config/config'
import type {
  ServerConfig,
  UnifiedCardData,
  SyncStatus,
  ServerStatus,
} from '@/lib/types'

// Check if we're on the server side
const isServer = typeof window === 'undefined'

class FRSDataManager {
  private syncStatus: SyncStatus = {
    lastSync: null,
    nextSync: null,
    isRefreshing: false,
    totalCards: 0,
    successfulServers: 0,
    failedServers: [],
    refreshInterval: CONFIG.refreshIntervalSeconds,
  }
  private refreshInterval: NodeJS.Timeout | null = null
  private listeners: Set<(status: SyncStatus) => void> = new Set()

  constructor() {
    console.log('🏗️ FRSDataManager constructor called')
    if (!isServer) {
      // Only run in browser, not during SSR
      if (typeof window !== 'undefined') {
        this.initAutoRefresh()
        // NOTE: Removed automatic initial sync to improve page load speed
        // Users can manually trigger sync with "Force Refresh" button
        // this.refreshAllData()
      }
    }
  }

  // Event subscription for sync status updates
  onSyncStatusChange(callback: (status: SyncStatus) => void) {
    this.listeners.add(callback)
    return () => this.listeners.delete(callback)
  }

  private notifyListeners() {
    this.listeners.forEach(callback => callback({ ...this.syncStatus }))
  }

  // Initialize auto-refresh timer
  private initAutoRefresh() {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval)
    }
    
    const intervalMs = CONFIG.refreshIntervalSeconds * 1000
    this.refreshInterval = setInterval(() => {
      this.refreshAllData()
    }, intervalMs)

    // Set next sync time
    this.syncStatus.nextSync = new Date(Date.now() + intervalMs)
    this.notifyListeners()
  }

  // Refresh all data from all servers
  async refreshAllData(): Promise<UnifiedCardData[]> {
    if (this.syncStatus.isRefreshing) {
      console.log('⏳ Sync already in progress, skipping...')
      return this.getAllCards()
    }

    this.syncStatus.isRefreshing = true
    this.syncStatus.failedServers = []
    this.syncStatus.successfulServers = 0
    this.notifyListeners()

    try {
      // Call the server-side sync API
      const response = await axios.post('/api/sync')
      
      if (response.data.success) {
        this.syncStatus.successfulServers = response.data.stats.successful
        this.syncStatus.totalCards = response.data.stats.totalCards
        this.syncStatus.lastSync = new Date()
        this.syncStatus.nextSync = new Date(
          Date.now() + CONFIG.refreshIntervalSeconds * 1000
        )
      }
    } catch (error) {
      console.error('❌ Error during sync:', error)
    } finally {
      this.syncStatus.isRefreshing = false
      this.notifyListeners()
    }

    // Return the updated cards after sync
    return this.getAllCards()
  }

  // Get all cards from database
  async getAllCards(): Promise<UnifiedCardData[]> {
    try {
      const response = await axios.get('/api/cards')
      
      if (response.data.success) {
        this.syncStatus.totalCards = response.data.count
        return response.data.data
      }
      return []
    } catch (error) {
      console.error('❌ Error getting all cards:', error)
      return []
    }
  }

  // Get cards for a specific server from database
  async getCardsByServer(serverName: string): Promise<UnifiedCardData[]> {
    try {
      const response = await axios.get('/api/cards', {
        params: { server: serverName }
      })
      
      if (response.data.success) {
        return response.data.data
      }
      return []
    } catch (error) {
      console.error(`❌ Error getting cards for ${serverName}:`, error)
      return []
    }
  }

  // Search cards in database
  async searchCards(query: string): Promise<UnifiedCardData[]> {
    try {
      if (!query || query.trim() === '') {
        return this.getAllCards()
      }
      
      const response = await axios.get('/api/cards', {
        params: { search: query }
      })
      
      if (response.data.success) {
        return response.data.data
      }
      return []
    } catch (error) {
      console.error('❌ Error searching cards:', error)
      return []
    }
  }

  // Get server status from database
  async getServerStatus(): Promise<ServerStatus[]> {
    try {
      const response = await axios.get('/api/sync')
      
      if (response.data.success) {
        const syncStatuses = response.data.data.syncStatuses
        
        return CONFIG.servers.map(server => {
          const dbStatus = syncStatuses.find((s: any) => s.server_url === server.baseURL)
          
          return {
            name: server.name,
            isOnline: dbStatus?.status === 'success',
            lastChecked: dbStatus?.last_sync ? new Date(dbStatus.last_sync) : new Date(),
            cardsCount: dbStatus?.card_count || 0,
            error: dbStatus?.error || undefined,
          }
        })
      }
      return []
    } catch (error) {
      console.error('❌ Error getting server status:', error)
      return []
    }
  }

  // Get current sync status
  getSyncStatus(): SyncStatus {
    return { ...this.syncStatus }
  }

  // Manual refresh trigger
  async manualRefresh(): Promise<UnifiedCardData[]> {
    console.log('🔄 Manual refresh triggered')
    return await this.refreshAllData()
  }

  // Get database stats
  async getStats() {
    try {
      const response = await axios.get('/api/sync')
      if (response.data.success) {
        return response.data.data.stats
      }
      return null
    } catch (error) {
      console.error('❌ Error getting stats:', error)
      return null
    }
  }

  // Cleanup
  destroy() {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval)
    }
    this.listeners.clear()
  }
}

// Singleton instance
export const dataManager = new FRSDataManager()
export const frsDataManager = dataManager // Backward compatibility
export default dataManager
