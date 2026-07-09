// Config validation sweep (RFC Phase 5, requirement F6).
//
// Triggers (per the RFC): DC start, a server being added, and a scheduled interval. This module
// implements the validation logic itself and exposes it as an explicitly-callable sweep; wiring
// it to "DC start" / "server added" is done by callers (see app/api/sync-engine/registry/route.ts
// for the "server added" trigger). Periodic scheduling is intentionally deferred to the Scheduler
// component (RFC Phase 2/10), which will also own download ticks and DLQ sweeps - building an
// ad-hoc timer here would duplicate that concern.
import db from './schema'
import { listServers } from './registry'
import { fetchRemoteWatchlists, upsertServerWatchlists } from './watchlist'
import { normalizeWatchlistName } from './normalize'
import type { ServerRow, ConfigStatus, ConfigValidationResultRow } from './types'

function getRequiredCanonicalWatchlists(): string[] {
  const rows = db
    .prepare('SELECT canonical_name FROM canonical_watchlists WHERE required = 1')
    .all() as { canonical_name: string }[]
  return rows.map((r) => r.canonical_name)
}

const insertValidationResultStmt = db.prepare(`
  INSERT INTO config_validation_results
    (server_uuid, status, missing_watchlists_json, extra_watchlists_json, message)
  VALUES (?, ?, ?, ?, ?)
`)

const updateServerStatusStmt = db.prepare(`
  UPDATE servers
  SET config_status = ?, last_validated_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
  WHERE server_uuid = ?
`)

// Once a server's config is confirmed valid again, anything held back for missing a watchlist
// gets another chance (RFC Phase 5 retry policy - hold, don't hammer, until config is fixed).
// No-op until Module 4/5 populate card_placements.
const reenqueueSkippedStmt = db.prepare(`
  UPDATE card_placements
  SET sync_status = 'pending', next_attempt_at = CURRENT_TIMESTAMP, last_error = NULL, updated_at = CURRENT_TIMESTAMP
  WHERE server_uuid = ? AND sync_status = 'skipped_config_invalid'
`)

export interface ValidationOutcome {
  server: ServerRow
  status: ConfigStatus
  missing: string[]
  extra: string[]
  message: string
}

export async function validateServerConfig(server: ServerRow): Promise<ValidationOutcome> {
  const required = getRequiredCanonicalWatchlists()

  let remote
  try {
    remote = await fetchRemoteWatchlists(server)
  } catch (error) {
    const message = `Server ${server.name} (${server.ip || server.base_url}) is unreachable: ${
      error instanceof Error ? error.message : 'unknown error'
    }`
    console.warn(`⚠️ ${message}`)
    insertValidationResultStmt.run(server.server_uuid, 'unreachable', JSON.stringify(required), null, message)
    updateServerStatusStmt.run('unreachable', server.server_uuid)
    return { server, status: 'unreachable', missing: required, extra: [], message }
  }

  upsertServerWatchlists(server.server_uuid, remote)

  const requiredSet = new Set(required)
  const presentSet = new Set(remote.map((wl) => normalizeWatchlistName(wl.rawName)))

  const missing = required.filter((name) => !presentSet.has(name))
  const extra = [...presentSet].filter((name) => !requiredSet.has(name))

  let status: ConfigStatus
  let message: string

  if (missing.length > 0) {
    status = 'config_invalid'
    message = `Server ${server.name} (${server.ip || server.base_url}) does not contain watchlist(s): ${missing.join(
      ', '
    )}. The server configuration is incomplete. Card synchronization will be skipped for this server.`
    console.warn(`⚠️ ${message}`)
  } else {
    status = 'valid'
    message = `Server ${server.name} configuration valid (${required.length} required watchlist(s) present).`
  }

  insertValidationResultStmt.run(server.server_uuid, status, JSON.stringify(missing), JSON.stringify(extra), message)
  updateServerStatusStmt.run(status, server.server_uuid)

  if (status === 'valid') {
    reenqueueSkippedStmt.run(server.server_uuid)
  }

  return { server, status, missing, extra, message }
}

// Validates every enabled server in parallel - one slow/offline/misconfigured server must never
// block the others (RFC non-functional requirement N3).
export async function validateAllServers(): Promise<ValidationOutcome[]> {
  const servers = listServers().filter((s) => s.enabled)

  const settled = await Promise.allSettled(servers.map((server) => validateServerConfig(server)))

  return settled.map((result, i) => {
    if (result.status === 'fulfilled') {
      return result.value
    }
    // validateServerConfig already catches network errors internally and resolves as
    // 'unreachable', so a rejection here means something unexpected (e.g. a DB error).
    const server = servers[i]
    const message = `Unexpected error validating ${server.name}: ${
      result.reason instanceof Error ? result.reason.message : 'unknown error'
    }`
    console.error(`❌ ${message}`)
    return { server, status: 'unreachable' as ConfigStatus, missing: [], extra: [], message }
  })
}

export function getLatestValidationResults(): ConfigValidationResultRow[] {
  return db
    .prepare(
      `
      SELECT v.* FROM config_validation_results v
      INNER JOIN (
        SELECT server_uuid, MAX(id) as max_id FROM config_validation_results GROUP BY server_uuid
      ) latest ON v.server_uuid = latest.server_uuid AND v.id = latest.max_id
      ORDER BY v.server_uuid
      `
    )
    .all() as ConfigValidationResultRow[]
}
