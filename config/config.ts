import configData from './config.json'
import type { AppConfig, ServerConfig, UnifiedCardData } from '@/lib/types'

export const CONFIG: AppConfig = configData as AppConfig

// Legacy support - convert baseURL back to IP for existing components
export const LEGACY_CONFIG = {
  LOCAL_SERVERS: CONFIG.servers.map(server => ({
    name: server.name,
    ip: server.baseURL.match(/\/\/([^:]+)/)?.[1] || server.baseURL,
    token: server.token,
    location: server.location,
  })),
}

// Type aliases for backward compatibility
export interface Server {
  name: string
  ip: string
  token: string
  location: string
}

export interface CardData {
  cardId: string
  personName: string
  watchlistName: string
  thumbnail: string
  timestamp?: string
}

// Export types for use throughout the app
export type { AppConfig, ServerConfig, UnifiedCardData } from '@/lib/types'
