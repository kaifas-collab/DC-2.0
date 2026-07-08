// Sync Worker (RFC Phase 4 Loop 2, Phase 8 failure recovery, Phase 9 concurrency).
//
// Claims pending/failed placements whose backoff has elapsed, resolves the card's own required
// watchlists on the destination (F5 - never create, never substitute, skip only this server),
// then uploads via the same create-card + upload-photo steps app/api/cards/add/route.ts already
// uses against FRS - called directly here rather than looped back through that HTTP route, for
// the same reason as Module 2 (this may run from a worker process with no request object).
//
// Claim query mirrors the RFC's Postgres design (Phase 9) minus FOR UPDATE SKIP LOCKED, which has
// no SQLite equivalent - unneeded here anyway since better-sqlite3 is a single synchronous
// connection, so no two JS callbacks can interleave on it. The lease/expiry columns still matter
// on SQLite: they're what let a crashed worker's in_progress rows become reclaimable again.
import axios from 'axios'
import fs from 'fs'
import path from 'path'
import FormData from 'form-data'
import db from './schema'
import { getServerByUuid } from './registry'
import { resolveWatchlists, getServerConfigEntry } from './watchlist'
import type { AppConfig, ServerConfig } from '../types'
import type { CardPlacementRow, GlobalCardRow, ServerRow, SyncAuditEventType } from './types'

const MAX_ATTEMPTS = 8
const LEASE_MS = 60_000
const BACKOFF_CAP_MS = 5 * 60_000

function computeBackoffMs(retryCount: number): number {
  const base = Math.min(1000 * 2 ** Math.max(retryCount - 1, 0), BACKOFF_CAP_MS)
  const jitter = Math.random() * base * 0.2
  return base + jitter
}

const insertAuditLogStmt = db.prepare(`
  INSERT INTO sync_audit_log
    (event_type, global_card_uuid, server_uuid, local_card_id, sync_version, worker_id, detail_json)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`)

function logAudit(
  eventType: SyncAuditEventType,
  placement: CardPlacementRow,
  workerId: string,
  detail: string | null
): void {
  insertAuditLogStmt.run(
    eventType,
    placement.global_card_uuid,
    placement.server_uuid,
    placement.local_card_id,
    placement.desired_version,
    workerId,
    detail ? JSON.stringify({ message: detail }) : null
  )
}

// --- Reap expired leases, then atomically claim a batch ---------------------------------------

const reapExpiredLeasesStmt = db.prepare(`
  UPDATE card_placements
  SET sync_status = 'pending', lease_owner = NULL, lease_expires_at = NULL, updated_at = CURRENT_TIMESTAMP
  WHERE sync_status = 'in_progress' AND lease_expires_at IS NOT NULL AND lease_expires_at < CURRENT_TIMESTAMP
`)

function claimBatchImpl(workerId: string, limit: number): CardPlacementRow[] {
  reapExpiredLeasesStmt.run()

  const leaseExpiresAt = new Date(Date.now() + LEASE_MS).toISOString()

  const rows = db
    .prepare(
      `
      UPDATE card_placements
      SET sync_status = 'in_progress', lease_owner = ?, lease_expires_at = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id IN (
        SELECT cp.id FROM card_placements cp
        INNER JOIN servers s ON s.server_uuid = cp.server_uuid
        WHERE cp.sync_status IN ('pending', 'failed')
          AND cp.next_attempt_at <= CURRENT_TIMESTAMP
          AND s.enabled = 1
        ORDER BY cp.next_attempt_at
        LIMIT ?
      )
      RETURNING *
      `
    )
    .all(workerId, leaseExpiresAt, limit) as CardPlacementRow[]

  return rows
}

const claimBatchTx = db.transaction(claimBatchImpl)

function claimBatch(workerId: string, limit: number): CardPlacementRow[] {
  return claimBatchTx(workerId, limit)
}

// --- Terminal state writers ---------------------------------------------------------------------

// Only flips to 'synced' if the version just applied still matches the current desired_version -
// if the planner bumped it again while this upload was in flight, the placement stays 'pending'
// so a worker picks up the newer version instead of falsely reporting itself caught up.
const markSyncedStmt = db.prepare(`
  UPDATE card_placements
  SET synced_version = ?,
      local_card_id = ?,
      applied_image_hash = ?,
      retry_count = 0,
      last_error = NULL,
      lease_owner = NULL,
      lease_expires_at = NULL,
      sync_status = CASE WHEN ? >= desired_version THEN 'synced' ELSE 'pending' END,
      next_attempt_at = CASE WHEN ? >= desired_version THEN next_attempt_at ELSE CURRENT_TIMESTAMP END,
      updated_at = CURRENT_TIMESTAMP
  WHERE id = ?
`)

// Terminal for a delete propagation job (Module 6) - synced_version always catches up since
// there's no further "version" content to converge on once a card is deleted.
const markPlacementDeletedStmt = db.prepare(`
  UPDATE card_placements
  SET sync_status = 'deleted', synced_version = desired_version, retry_count = 0, last_error = NULL,
      lease_owner = NULL, lease_expires_at = NULL, updated_at = CURRENT_TIMESTAMP
  WHERE id = ?
`)

// Held here (not retried on a timer) until the config-validation sweep (Module 2) confirms the
// destination has the watchlist and re-enqueues it - hammering a known-misconfigured server helps
// no one (RFC Phase 5 retry policy).
const markSkippedConfigInvalidStmt = db.prepare(`
  UPDATE card_placements
  SET sync_status = 'skipped_config_invalid', last_error = ?, lease_owner = NULL, lease_expires_at = NULL,
      updated_at = CURRENT_TIMESTAMP
  WHERE id = ?
`)

const markFailedStmt = db.prepare(`
  UPDATE card_placements
  SET sync_status = 'failed', retry_count = ?, next_attempt_at = ?, last_error = ?,
      lease_owner = NULL, lease_expires_at = NULL, updated_at = CURRENT_TIMESTAMP
  WHERE id = ?
`)

const markDeadLetterStmt = db.prepare(`
  UPDATE card_placements
  SET sync_status = 'dead_letter', retry_count = ?, last_error = ?, lease_owner = NULL, lease_expires_at = NULL,
      updated_at = CURRENT_TIMESTAMP
  WHERE id = ?
`)

// Persisted immediately after a successful create - closes the crash window before the
// (best-effort) photo upload, so a retry after a photo failure updates the existing card instead
// of creating a second one (RFC Phase 6A "intent-first" write ordering).
const persistLocalCardIdStmt = db.prepare(`
  UPDATE card_placements SET local_card_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
`)

// --- FRS calls - same endpoints/headers/payload shape as app/api/cards/add and delete-from-frs --

async function createCardOnFRS(
  entry: ServerConfig,
  config: AppConfig,
  name: string,
  watchlistIds: number[]
): Promise<string> {
  const url: string = `${entry.baseURL}${config.apiEndpoints.cards}`
  const response = await axios.post<{ id: number | string }>(
    url,
    {
      active: true,
      name,
      comment: '',
      watch_lists: watchlistIds,
    },
    {
      headers: {
        Accept: 'application/json',
        Authorization: `Token ${entry.token}`,
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    }
  )
  return String(response.data.id)
}

async function updateCardOnFRS(
  entry: ServerConfig,
  config: AppConfig,
  localCardId: string,
  name: string,
  watchlistIds: number[]
): Promise<void> {
  const url: string = `${entry.baseURL}${config.apiEndpoints.cards}${localCardId}/`
  await axios.patch(
    url,
    { name, watch_lists: watchlistIds },
    {
      headers: {
        Accept: 'application/json',
        Authorization: `Token ${entry.token}`,
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    }
  )
}

// Best-effort - a photo upload failure never fails the whole placement (matches the existing
// app/api/cards/add behavior of not failing card creation over a photo problem).
async function uploadPhotoToFRS(
  entry: ServerConfig,
  config: AppConfig,
  localCardId: string,
  imageRef: string | null
): Promise<boolean> {
  if (!imageRef || !imageRef.startsWith('/uploads/')) {
    return false
  }

  const filePath: string = path.join(process.cwd(), 'public', imageRef)
  if (!fs.existsSync(filePath)) {
    return false
  }

  const buffer: Buffer = fs.readFileSync(filePath)
  const uploadUrl: string = `${entry.baseURL}${config.apiEndpoints.faces}`
  const form = new FormData()
  form.append('source_photo', buffer, { filename: path.basename(filePath), contentType: 'image/jpeg' })
  form.append('card', localCardId)

  await axios.post(uploadUrl, form, {
    headers: {
      Accept: 'application/json',
      Authorization: `Token ${entry.token}`,
      ...form.getHeaders(),
    },
    timeout: 30000,
  })

  return true
}

// Same endpoint/auth as app/api/cards/delete-from-frs/route.ts. A 404 is treated as success -
// deleting an already-deleted card is the desired end state (N1 idempotency), not a failure.
async function deleteCardOnFRS(entry: ServerConfig, config: AppConfig, localCardId: string): Promise<void> {
  const url: string = `${entry.baseURL}${config.apiEndpoints.cards}${localCardId}/`
  try {
    await axios.delete(url, {
      headers: { Authorization: `Token ${entry.token}` },
      timeout: 10000,
    })
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 404) {
      return
    }
    throw error
  }
}

// --- Per-placement processing --------------------------------------------------------------------

type ProcessOutcome = 'synced' | 'deleted' | 'skippedConfigInvalid' | 'failed' | 'deadLettered'

function parseRequiredWatchlistNames(globalCard: GlobalCardRow): string[] {
  try {
    const parsed = JSON.parse(globalCard.metadata_json || '{}')
    return Array.isArray(parsed.watchlists) ? parsed.watchlists : []
  } catch {
    return []
  }
}

// Module 6: the card was deleted at its origin (or removed directly on this replica while the
// origin still wanted it - see deletion.ts). No watchlist resolution needed to delete something.
async function processDelete(
  globalCard: GlobalCardRow,
  placement: CardPlacementRow,
  server: ServerRow,
  workerId: string
): Promise<ProcessOutcome> {
  if (!placement.local_card_id) {
    // Never had a copy here - nothing to delete remotely.
    markPlacementDeletedStmt.run(placement.id)
    return 'deleted'
  }

  try {
    const { entry, config } = getServerConfigEntry(server)
    await deleteCardOnFRS(entry, config, placement.local_card_id)
    markPlacementDeletedStmt.run(placement.id)
    logAudit('delete_success', placement, workerId, null)
    return 'deleted'
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown delete error'
    const nextRetryCount = placement.retry_count + 1

    if (nextRetryCount >= MAX_ATTEMPTS) {
      markDeadLetterStmt.run(nextRetryCount, message, placement.id)
      logAudit('dead_letter', placement, workerId, message)
      console.error(
        `❌ Placement ${placement.id} delete moved to dead_letter after ${nextRetryCount} attempts: ${message}`
      )
      return 'deadLettered'
    }

    const nextAttemptAt = new Date(Date.now() + computeBackoffMs(nextRetryCount)).toISOString()
    markFailedStmt.run(nextRetryCount, nextAttemptAt, message, placement.id)
    logAudit('delete_failed', placement, workerId, message)
    console.warn(`⚠️ Placement ${placement.id} delete failed (attempt ${nextRetryCount}): ${message}`)
    return 'failed'
  }
}

async function processPlacement(placement: CardPlacementRow, workerId: string): Promise<ProcessOutcome> {
  const globalCard = db
    .prepare('SELECT * FROM global_cards WHERE global_card_uuid = ?')
    .get(placement.global_card_uuid) as GlobalCardRow | undefined
  const server = getServerByUuid(placement.server_uuid)

  if (!globalCard || !server) {
    const message = 'Missing global_cards or servers row for this placement'
    const nextRetryCount = placement.retry_count + 1
    markFailedStmt.run(
      nextRetryCount,
      new Date(Date.now() + computeBackoffMs(nextRetryCount)).toISOString(),
      message,
      placement.id
    )
    console.error(`❌ Placement ${placement.id}: ${message}`)
    return 'failed'
  }

  if (globalCard.status === 'deleted') {
    return processDelete(globalCard, placement, server, workerId)
  }

  const requiredNames = parseRequiredWatchlistNames(globalCard)
  const resolution = resolveWatchlists(server.server_uuid, requiredNames)

  if (resolution.missing.length > 0) {
    const message = `Server ${server.name} (${server.ip || server.base_url}) does not contain watchlist(s): ${resolution.missing.join(
      ', '
    )}. The server configuration is incomplete. Card synchronization skipped for this server.`
    markSkippedConfigInvalidStmt.run(message, placement.id)
    logAudit('watchlist_missing', placement, workerId, message)
    console.warn(`⚠️ ${message}`)
    return 'skippedConfigInvalid'
  }

  logAudit('upload_attempt', placement, workerId, null)

  try {
    const { entry, config } = getServerConfigEntry(server)
    const watchlistIds = Object.values(resolution.resolved).map(Number)
    let localCardId = placement.local_card_id
    let appliedImageHash = placement.applied_image_hash

    if (!localCardId) {
      localCardId = await createCardOnFRS(entry, config, globalCard.name || 'Unknown', watchlistIds)
      persistLocalCardIdStmt.run(localCardId, placement.id)
    } else {
      await updateCardOnFRS(entry, config, localCardId, globalCard.name || 'Unknown', watchlistIds)
    }

    // Only re-upload the photo when it actually changed - re-uploading on every metadata-only
    // update would create a new face object on FRS every time with no way to clean up the old one.
    if (globalCard.image_hash && globalCard.image_hash !== appliedImageHash) {
      try {
        const uploaded = await uploadPhotoToFRS(entry, config, localCardId, globalCard.image_ref)
        if (uploaded) {
          appliedImageHash = globalCard.image_hash
        }
      } catch (photoError) {
        console.warn(
          `⚠️ Photo upload failed for placement ${placement.id} (card ${localCardId} on ${server.name}), continuing:`,
          photoError instanceof Error ? photoError.message : photoError
        )
      }
    }

    markSyncedStmt.run(
      placement.desired_version,
      localCardId,
      appliedImageHash,
      placement.desired_version,
      placement.desired_version,
      placement.id
    )
    logAudit('upload_success', placement, workerId, null)
    return 'synced'
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown upload error'
    const nextRetryCount = placement.retry_count + 1

    if (nextRetryCount >= MAX_ATTEMPTS) {
      markDeadLetterStmt.run(nextRetryCount, message, placement.id)
      logAudit('dead_letter', placement, workerId, message)
      console.error(`❌ Placement ${placement.id} moved to dead_letter after ${nextRetryCount} attempts: ${message}`)
      return 'deadLettered'
    }

    const nextAttemptAt = new Date(Date.now() + computeBackoffMs(nextRetryCount)).toISOString()
    markFailedStmt.run(nextRetryCount, nextAttemptAt, message, placement.id)
    logAudit('upload_failed', placement, workerId, message)
    console.warn(`⚠️ Placement ${placement.id} failed (attempt ${nextRetryCount}): ${message}`)
    return 'failed'
  }
}

// --- Batch entry point ------------------------------------------------------------------------

export interface WorkerRunSummary {
  claimed: number
  synced: number
  deleted: number
  skippedConfigInvalid: number
  failed: number
  deadLettered: number
}

export async function runWorkerBatch(workerId: string, batchSize = 20): Promise<WorkerRunSummary> {
  const batch = claimBatch(workerId, batchSize)
  const summary: WorkerRunSummary = {
    claimed: batch.length,
    synced: 0,
    deleted: 0,
    skippedConfigInvalid: 0,
    failed: 0,
    deadLettered: 0,
  }

  for (const placement of batch) {
    const outcome = await processPlacement(placement, workerId)
    summary[outcome] += 1
  }

  return summary
}
