import { useState, useEffect } from 'react'
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
}

export function useServerConfig(): ServerConfigResult {
  const [config, setConfig] = useState<AppConfig>(CONFIG)

  useEffect(() => {
    fetch('/api/config')
      .then(r => r.json())
      .then((live: AppConfig) => setConfig(live))
      .catch(() => {})
  }, [])

  const legacyServers: LegacyServer[] = config.servers.map(server => ({
    name: server.name,
    ip: server.baseURL.match(/\/\/([^:/]+)/)?.[1] || server.baseURL,
    token: server.token,
    location: server.location,
  }))

  return { config, legacyServers }
}
