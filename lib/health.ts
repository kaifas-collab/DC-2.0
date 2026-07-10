import { getServerConfig } from '@/config/serverConfig'
import type { ServerConfig } from '@/lib/types'

// Real FRS health check (replaces ICMP ping). A server is "healthy" only when its FRS API actually
// answers an authenticated request - ping only proves the OS is up, not that the FRS service is
// serving. Reuses the same auth/endpoint pattern as app/api/frs/route.ts.
//
// We treat any HTTP response (even 401/403/4xx) as "FRS is up" - the service answered, which is what
// connectivity means here. Only a network error / timeout / abort counts as down.
export async function checkServerHealth(server: ServerConfig, timeoutMs = 5000): Promise<boolean> {
  const CONFIG = getServerConfig()
  const url = `${server.baseURL}${CONFIG.apiEndpoints.cards}?limit=1`

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Token ${server.token}`,
      },
      signal: controller.signal,
    })
    // Any response below 500 (200 OK, or even 401/403 auth errors) means the FRS service itself
    // answered -> online. A 5xx (502/503/504) means the FRS backend is down behind a proxy -> offline.
    return response.status < 500
  } catch {
    // Network error, DNS failure, connection refused, or timeout/abort -> offline.
    return false
  } finally {
    clearTimeout(timeoutId)
  }
}

// Checks every enabled server in config. Returns the names of any that are offline (empty = all up).
// Used as the precondition gate for a cluster delete (item 2): a delete is blocked unless every
// server is reachable.
export async function findOfflineServers(): Promise<string[]> {
  const CONFIG = getServerConfig()
  const results = await Promise.all(
    CONFIG.servers.map(async (server) => ({
      name: server.name,
      online: await checkServerHealth(server),
    }))
  )
  return results.filter((r) => !r.online).map((r) => r.name)
}
