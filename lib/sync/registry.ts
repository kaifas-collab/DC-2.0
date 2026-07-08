// Server Registry (RFC Phase 2 / Appendix B Module 1).
//
// Responsibilities:
//  - Assign every configured FRS server a stable, immortal server_uuid (persisted back into
//    config.json so identity survives a DB rebuild), per the RFC's identity evaluation: IP is
//    mutable and must never be the primary key.
//  - Seed/upsert the `servers` and `canonical_watchlists` control tables from config.json.
//
// This module intentionally does NOT store FRS tokens in the sync control DB. token_ref points
// back at the server_uuid; the actual secret continues to live only in config.json, resolved via
// getServerConfig() at call time - consistent with today's token handling and deferring a real
// secrets-store migration to the Phase 11 hardening pass.
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import db from './schema'
import { normalizeWatchlistName } from './normalize'
import type { AppConfig, ServerConfig } from '../types'
import type { ServerRow, CanonicalWatchlistRow } from './types'

const CONFIG_PATH = path.join(process.cwd(), 'config', 'config.json')

function readConfigRaw(): AppConfig {
  const raw = fs.readFileSync(CONFIG_PATH, 'utf-8')
  return JSON.parse(raw) as AppConfig
}

// Atomic write (write-then-rename) so a crash mid-write can never leave config.json truncated
// or corrupted - this file holds live server tokens.
function writeConfigRaw(config: AppConfig): void {
  const tmpPath = `${CONFIG_PATH}.${process.pid}.tmp`
  fs.writeFileSync(tmpPath, `${JSON.stringify(config, null, 2)}\n`, 'utf-8')
  fs.renameSync(tmpPath, CONFIG_PATH)
}

function parseIpFromBaseUrl(baseURL: string): string | null {
  const match = baseURL.match(/\/\/([^:/]+)/)
  return match ? match[1] : null
}

// Fills in server_uuid for any server missing one and persists the result. Never overwrites an
// existing server_uuid - identity, once assigned, is immortal.
export function ensureServerUuids(): AppConfig {
  const config = readConfigRaw()
  let changed = false

  for (const server of config.servers) {
    if (!server.server_uuid) {
      server.server_uuid = crypto.randomUUID()
      changed = true
    }
  }

  if (changed) {
    writeConfigRaw(config)
  }

  return config
}

const upsertServerStmt = db.prepare(`
  INSERT INTO servers (server_uuid, name, base_url, ip, token_ref, location, enabled, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
  ON CONFLICT(server_uuid) DO UPDATE SET
    name = excluded.name,
    base_url = excluded.base_url,
    ip = excluded.ip,
    token_ref = excluded.token_ref,
    location = excluded.location,
    enabled = 1,
    updated_at = CURRENT_TIMESTAMP
`)

export function syncServersFromConfig(config: AppConfig): void {
  const servers = config.servers as Required<ServerConfig>[]
  const transaction = db.transaction((rows: Required<ServerConfig>[]) => {
    for (const server of rows) {
      upsertServerStmt.run(
        server.server_uuid,
        server.name,
        server.baseURL,
        parseIpFromBaseUrl(server.baseURL),
        server.server_uuid,
        server.location
      )
    }
  })

  transaction(servers)
}

const disableServerStmt = db.prepare(`
  UPDATE servers SET enabled = 0, updated_at = CURRENT_TIMESTAMP WHERE server_uuid = ?
`)

// Disables (never deletes - server identity stays immortal per the RFC) any previously-registered
// server no longer present in config.json, so a removed server stops being targeted by the
// planner/worker/validator instead of silently lingering as an enabled ghost forever. Matched by
// name, the one stable key config.json guarantees before a server_uuid is assigned.
export function disableServersNotInConfig(config: AppConfig): number {
  const configNames = new Set(config.servers.map((s) => s.name))
  const staleServers = listServers().filter((s) => s.enabled && !configNames.has(s.name))

  for (const server of staleServers) {
    disableServerStmt.run(server.server_uuid)
  }

  return staleServers.length
}

const upsertCanonicalWatchlistStmt = db.prepare(`
  INSERT INTO canonical_watchlists (canonical_name, display_name, required)
  VALUES (?, ?, 1)
  ON CONFLICT(canonical_name) DO UPDATE SET display_name = excluded.display_name
`)

export function syncCanonicalWatchlistsFromConfig(config: AppConfig): void {
  const expected = config.expectedWatchlists || []
  const transaction = db.transaction((names: string[]) => {
    for (const rawName of names) {
      upsertCanonicalWatchlistStmt.run(normalizeWatchlistName(rawName), rawName)
    }
  })

  transaction(expected)
}

export interface RegistryBootstrapResult {
  servers: ServerRow[]
  canonicalWatchlists: CanonicalWatchlistRow[]
}

// Full Module 1 entry point: assign missing server UUIDs, then upsert the registry tables from
// config.json. Safe to call repeatedly - every step is an idempotent upsert on a stable key.
export function bootstrapRegistry(): RegistryBootstrapResult {
  const config = ensureServerUuids()
  syncServersFromConfig(config)

  const disabledCount = disableServersNotInConfig(config)
  if (disabledCount > 0) {
    console.log(`🧹 Registry: disabled ${disabledCount} server(s) no longer present in config.json`)
  }

  syncCanonicalWatchlistsFromConfig(config)

  return {
    servers: listServers(),
    canonicalWatchlists: listCanonicalWatchlists(),
  }
}

export function listServers(): ServerRow[] {
  return db.prepare('SELECT * FROM servers ORDER BY name').all() as ServerRow[]
}

export function listCanonicalWatchlists(): CanonicalWatchlistRow[] {
  return db.prepare('SELECT * FROM canonical_watchlists ORDER BY canonical_name').all() as CanonicalWatchlistRow[]
}

export function getServerByUuid(serverUuid: string): ServerRow | undefined {
  return db.prepare('SELECT * FROM servers WHERE server_uuid = ?').get(serverUuid) as ServerRow | undefined
}

export function getServerByName(name: string): ServerRow | undefined {
  return db.prepare('SELECT * FROM servers WHERE name = ?').get(name) as ServerRow | undefined
}
