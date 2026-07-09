// Per-server watchlist discovery and canonical-name resolution (RFC Phase 5).
//
// Calls FRS servers directly (same auth pattern as app/api/cards/add and
// app/api/cards/delete-from-frs) rather than looping back through the app's own /api/frs proxy -
// this is server-side library code that may later run from a standalone worker with no
// `request` object to derive an origin from.
import axios from 'axios'
import { getServerConfig } from '@/config/serverConfig'
import type { ServerConfig } from '../types'
import db from './schema'
import { normalizeWatchlistName } from './normalize'
import type { ServerRow, ServerWatchlistRow } from './types'

export interface RemoteWatchlist {
  localId: string
  rawName: string
}

// Every server in the `servers` control table must correspond to an entry in config.json
// (matched by server_uuid) - that entry carries the token and base URL needed to call FRS.
// Exported for reuse by the sync worker (Module 5), which needs the same lookup before uploads.
export function getServerConfigEntry(server: ServerRow): { entry: ServerConfig; config: ReturnType<typeof getServerConfig> } {
  const config = getServerConfig()
  const entry = config.servers.find((s) => s.server_uuid === server.server_uuid)
  if (!entry) {
    throw new Error(`No config.json entry found for server_uuid ${server.server_uuid} (name=${server.name})`)
  }
  return { entry, config }
}

// Fetch ALL watchlists from a single FRS server, following next_page pagination.
export async function fetchRemoteWatchlists(server: ServerRow): Promise<RemoteWatchlist[]> {
  const { entry, config } = getServerConfigEntry(server)
  const results: RemoteWatchlist[] = []

  let nextUrl: string | null = config.apiEndpoints.watchlists

  while (nextUrl) {
    const url: string = nextUrl.startsWith('http')
      ? nextUrl
      : `${entry.baseURL}${nextUrl.startsWith('/') ? nextUrl.slice(1) : nextUrl}`

    const response = await axios.get<{ results?: Array<{ id: number | string; name: string }>; next_page?: string | null }>(
      url,
      {
        headers: {
          Accept: 'application/json',
          Authorization: `Token ${entry.token}`,
        },
        timeout: 10000,
      }
    )

    const page = response.data?.results || []
    for (const wl of page) {
      results.push({ localId: String(wl.id), rawName: wl.name })
    }

    nextUrl = response.data?.next_page || null
  }

  return results
}

const upsertServerWatchlistStmt = db.prepare(`
  INSERT INTO server_watchlists (server_uuid, local_watchlist_id, raw_name, canonical_name, last_seen_at)
  VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
  ON CONFLICT(server_uuid, local_watchlist_id) DO UPDATE SET
    raw_name = excluded.raw_name,
    canonical_name = excluded.canonical_name,
    last_seen_at = CURRENT_TIMESTAMP
`)

// Replaces the known watchlist set for a server with what was just observed - a watchlist
// renamed or removed on the FRS side stops being resolvable here too, rather than lingering as a
// stale mapping (mirrors DBService.syncServerCards' staleness-removal pattern).
export function upsertServerWatchlists(serverUuid: string, remote: RemoteWatchlist[]): void {
  const transaction = db.transaction((items: RemoteWatchlist[]) => {
    const currentIds = new Set(items.map((w) => w.localId))

    const existing = db
      .prepare('SELECT local_watchlist_id FROM server_watchlists WHERE server_uuid = ?')
      .all(serverUuid) as { local_watchlist_id: string }[]
    const staleIds = existing.map((r) => r.local_watchlist_id).filter((id) => !currentIds.has(id))

    if (staleIds.length > 0) {
      const placeholders = staleIds.map(() => '?').join(',')
      db.prepare(
        `DELETE FROM server_watchlists WHERE server_uuid = ? AND local_watchlist_id IN (${placeholders})`
      ).run(serverUuid, ...staleIds)
    }

    for (const wl of items) {
      upsertServerWatchlistStmt.run(serverUuid, wl.localId, wl.rawName, normalizeWatchlistName(wl.rawName))
    }
  })

  transaction(remote)
}

export function listServerWatchlists(serverUuid: string): ServerWatchlistRow[] {
  return db
    .prepare('SELECT * FROM server_watchlists WHERE server_uuid = ? ORDER BY canonical_name')
    .all(serverUuid) as ServerWatchlistRow[]
}

export interface WatchlistResolution {
  resolved: Record<string, string> // canonical_name -> local_watchlist_id
  missing: string[] // canonical names not found on this server
}

// Resolve required canonical watchlist names to this server's local ids. Used by the config
// validator (Module 2) and, later, the sync worker (Module 5) before every upload - per F5, a
// missing watchlist is never created or substituted, only reported.
export function resolveWatchlists(serverUuid: string, requiredCanonicalNames: string[]): WatchlistResolution {
  const rows = listServerWatchlists(serverUuid)
  const byCanonical = new Map(rows.map((r) => [r.canonical_name, r.local_watchlist_id]))

  const resolved: Record<string, string> = {}
  const missing: string[] = []

  for (const name of requiredCanonicalNames) {
    const localId = byCanonical.get(name)
    if (localId) {
      resolved[name] = localId
    } else {
      missing.push(name)
    }
  }

  return { resolved, missing }
}
