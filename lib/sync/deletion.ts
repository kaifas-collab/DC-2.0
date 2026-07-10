// Local-deletion detection: the DC is the sole delete authority (RFC Phase 7, revised).
//
// Both directions are driven by the full-scan diff the existing download loop already performs
// every cycle (see cursors.ts's note: the FRS query still pulls everything every run, so a "full
// scan" is just what's already happening) - no new polling mechanism needed, only new comparisons
// against what was already downloaded.
//
// Policy: a card that disappears directly on ANY server (origin or replica) is treated as an
// UNINTENDED local deletion and restored - never as an intentional delete. The only intentional
// delete is the DC's own cluster-delete (app/api/cards/cluster-delete/route.ts), which marks the
// global card 'deleted' up front; both detectors below skip any global card already in that state,
// so a delete already in flight is never "restored" out from under itself.
//
//   1. Origin delete: the card that used to be present under this server's own origin placement is
//      no longer in this server's current download. Reset that placement to a fresh pending create
//      (same global_card_uuid, same sync hash) so the worker recreates it here with a new local id.
//   2. Replica delete: a known, synced replica placement on this server is no longer present, but
//      the global card is still active. Policy-driven (config.sync.replicaDeletePolicy):
//      'recreate' (default) resets the placement to a fresh pending create; 'tombstone' accepts the
//      removal (kept for operators who want the old opt-out behavior).
//
// Both detectors key strictly on the PLACEMENT's own local_card_id - never on
// global_cards.origin_card_id - because the placement's local_card_id is the value the worker keeps
// current after a recreate. Comparing against the (necessarily stale, unless separately updated)
// origin_card_id would make the very next cycle see the OLD id as "missing" again, restoring the
// same card forever.
import db from './schema'
import { getServerConfig } from '@/config/serverConfig'
import logger from '../logger'
import type { ServerRow, GlobalCardRow, CardPlacementRow } from './types'

const insertAuditLogStmt = db.prepare(`
  INSERT INTO sync_audit_log (event_type, global_card_uuid, server_uuid, detail_json)
  VALUES (?, ?, ?, ?)
`)

const resetPlacementForRecreateStmt = db.prepare(`
  UPDATE card_placements
  SET local_card_id = NULL, applied_image_hash = NULL, sync_status = 'pending', retry_count = 0,
      last_error = NULL, next_attempt_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
  WHERE id = ?
`)

const tombstonePlacementStmt = db.prepare(`
  UPDATE card_placements SET sync_status = 'deleted', updated_at = CURRENT_TIMESTAMP WHERE id = ?
`)

// Restores an origin card whose placement's local_card_id has gone missing from this server's
// current download. Only considers ACTIVE global cards - one already status='deleted' (an
// in-flight DC cluster-delete) is deliberately left alone here; its placements are driven by
// processDelete in worker.ts instead.
function detectOriginDeletesImpl(server: ServerRow, currentLocalCardIds: Set<string>): number {
  const originPlacements = db
    .prepare(
      `SELECT cp.* FROM card_placements cp
       INNER JOIN global_cards gc ON gc.global_card_uuid = cp.global_card_uuid
       WHERE cp.server_uuid = ? AND cp.is_origin = 1 AND cp.sync_status = 'synced'
         AND cp.local_card_id IS NOT NULL AND gc.status = 'active'`
    )
    .all(server.server_uuid) as CardPlacementRow[]

  let restoredCount = 0

  for (const placement of originPlacements) {
    if (!placement.local_card_id || currentLocalCardIds.has(placement.local_card_id)) {
      continue
    }

    resetPlacementForRecreateStmt.run(placement.id)

    insertAuditLogStmt.run(
      'delete_detected',
      placement.global_card_uuid,
      server.server_uuid,
      JSON.stringify({
        message: `Origin card ${placement.local_card_id} on ${server.name} was removed directly - restoring (DC is the sole delete authority)`,
      })
    )
    logger.info('sync.delete', `Restoring origin card removed directly on ${server.name} - will recreate with a new local id`, {
      globalCardUuid: placement.global_card_uuid,
      localCardId: placement.local_card_id,
      serverName: server.name,
    })
    restoredCount++
  }

  return restoredCount
}

const detectOriginDeletesTx = db.transaction(detectOriginDeletesImpl)

// Detects origin placements that vanished from this server's current full download and restores
// them (see module header - the DC is the sole delete authority).
export function detectOriginDeletes(server: ServerRow, currentLocalCardIds: Set<string>): number {
  return detectOriginDeletesTx(server, currentLocalCardIds)
}

export type ReplicaDeletePolicy = 'recreate' | 'tombstone'

function detectReplicaDeletesImpl(server: ServerRow, currentLocalCardIds: Set<string>): number {
  const config = getServerConfig()
  const policy: ReplicaDeletePolicy = config.sync?.replicaDeletePolicy || 'recreate'

  const syncedReplicas = db
    .prepare(
      `SELECT * FROM card_placements
       WHERE server_uuid = ? AND is_origin = 0 AND sync_status = 'synced' AND local_card_id IS NOT NULL`
    )
    .all(server.server_uuid) as CardPlacementRow[]

  let affected = 0

  for (const placement of syncedReplicas) {
    if (!placement.local_card_id || currentLocalCardIds.has(placement.local_card_id)) {
      continue
    }

    const globalCard = db
      .prepare('SELECT * FROM global_cards WHERE global_card_uuid = ?')
      .get(placement.global_card_uuid) as GlobalCardRow | undefined

    if (!globalCard || globalCard.status === 'deleted') {
      // Expected - this is either an unknown placement or a DC-initiated cluster-delete already in
      // flight; either way, this replica's own disappearance is not "unintended," so just tombstone
      // the placement rather than restoring it.
      tombstonePlacementStmt.run(placement.id)
      continue
    }

    if (policy === 'tombstone') {
      tombstonePlacementStmt.run(placement.id)
    } else {
      resetPlacementForRecreateStmt.run(placement.id)
      logger.info('sync.delete', `Restoring replica card removed directly on ${server.name} - will recreate with a new local id`, {
        globalCardUuid: placement.global_card_uuid,
        localCardId: placement.local_card_id,
        serverName: server.name,
      })
    }

    insertAuditLogStmt.run(
      'delete_detected',
      placement.global_card_uuid,
      server.server_uuid,
      JSON.stringify({
        message: `Replica card ${placement.local_card_id} on ${server.name} was removed directly; policy=${policy}`,
      })
    )
    affected++
  }

  return affected
}

const detectReplicaDeletesTx = db.transaction(detectReplicaDeletesImpl)

// Detects replica placements that vanished from this server's current full download even though
// the global card is still active, and restores or tombstones them per policy.
export function detectReplicaDeletes(server: ServerRow, currentLocalCardIds: Set<string>): number {
  return detectReplicaDeletesTx(server, currentLocalCardIds)
}
