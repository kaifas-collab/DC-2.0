import { useState, useEffect, useCallback } from 'react'
import { CONFIG } from '@/config/config'
import type { AppConfig } from '@/lib/types'

interface LegacyServer {
  name: string
  ip: string
  token: string
  location: string
}

interface ServerConfigResult {
  config: AppConfig
  legacyServers: LegacyServer[]
  refetch: () => void
}

export function useServerConfig(): ServerConfigResult {
  const [config, setConfig] = useState<AppConfig>(CONFIG)

  // Pulls the live config from disk (via /api/config). Exposed as refetch() so callers can refresh
  // after mutating config - e.g. after adding a server - without a full page reload.
  const refetch = useCallback(() => {
    fetch('/api/config')
      .then(r => r.json())
      .then((live: AppConfig) => setConfig(live))
      .catch(() => {})
  }, [])

  useEffect(() => {
    refetch()
  }, [refetch])

  const legacyServers: LegacyServer[] = config.servers.map(server => ({
    name: server.name,
    ip: server.baseURL.match(/\/\/([^:/]+)/)?.[1] || server.baseURL,
    token: server.token,
    location: server.location,
  }))

  return { config, legacyServers, refetch }
}
