// Delete propagation (RFC Phase 7 "Deletes").
//
// Both directions are driven by the full-scan diff the existing download loop already performs
// every cycle (see cursors.ts's note: the FRS query still pulls everything every run, so a "full
// scan" is just what's already happening) - no new polling mechanism needed, only new comparisons
// against what was already downloaded.
//
//   1. Origin delete: a card that used to be this server's own origin card is no longer present.
//      Mark the global card 'deleted' and hand off to the EXISTING planner (planForCard) to
//      re-stale every replica placement - no new enqueue logic needed there beyond the "don't
//      create a fresh placement for an already-deleted card" guard added to planner.ts. This is
//      deliberate reuse: the planner already knows how to fan a version bump out to every
//      placement: cast a delete as "one more version to converge on" and it works unmodified.
//   2. Replica delete: a card that was a known, synced replica on this server is no longer
//      present, but the origin still considers it active - someone deleted it directly on this
//      server. Policy-driven (config.sync.replicaDeletePolicy): 'recreate' (default) resets the
//      placement to a fresh pending create so the desired state is re-enforced; 'tombstone'
//      accepts the removal.
import db from './schema'
import { getServerConfig } from '@/config/serverConfig'
import { planForCard } from './planner'
import type { ServerRow, GlobalCardRow, CardPlacementRow } from './types'

const markGlobalCardDeletedStmt = db.prepare(`
  UPDATE global_cards
  SET status = 'deleted', sync_version = sync_version + 1, updated_at = CURRENT_TIMESTAMP
  WHERE global_card_uuid = ? AND status = 'active'
`)

const markOriginPlacementDeletedStmt = db.prepare(`
  UPDATE card_placements
  SET sync_status = 'deleted', updated_at = CURRENT_TIMESTAMP
  WHERE global_card_uuid = ? AND is_origin = 1
`)

const insertAuditLogStmt = db.prepare(`
  INSERT INTO sync_audit_log (event_type, global_card_uuid, server_uuid, detail_json)
  VALUES (?, ?, ?, ?)
`)

function detectOriginDeletesImpl(server: ServerRow, currentOriginCardIds: Set<string>): number {
  const originCards = db
    .prepare(`SELECT * FROM global_cards WHERE origin_server_uuid = ? AND status = 'active'`)
    .all(server.server_uuid) as GlobalCardRow[]

  let deletedCount = 0

  for (const card of originCards) {
    if (currentOriginCardIds.has(card.origin_card_id)) {
      continue
    }

    const result = markGlobalCardDeletedStmt.run(card.global_card_uuid)
    if (result.changes === 0) {
      continue
    }

    markOriginPlacementDeletedStmt.run(card.global_card_uuid)
    insertAuditLogStmt.run(
      'delete_detected',
      card.global_card_uuid,
      server.server_uuid,
      JSON.stringify({ message: `Origin card ${card.origin_card_id} on ${server.name} no longer exists` })
    )
    planForCard(card.global_card_uuid)
    deletedCount++
  }

  return deletedCount
}

const detectOriginDeletesTx = db.transaction(detectOriginDeletesImpl)

// Detects origin cards that vanished from this server's current full download, marks the
// corresponding global card deleted, and fans that out to every replica placement.
export function detectOriginDeletes(server: ServerRow, currentOriginCardIds: Set<string>): number {
  return detectOriginDeletesTx(server, currentOriginCardIds)
}

export type ReplicaDeletePolicy = 'recreate' | 'tombstone'

const resetPlacementForRecreateStmt = db.prepare(`
  UPDATE card_placements
  SET local_card_id = NULL, applied_image_hash = NULL, sync_status = 'pending', retry_count = 0,
      last_error = NULL, next_attempt_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
  WHERE id = ?
`)

const tombstonePlacementStmt = db.prepare(`
  UPDATE card_placements SET sync_status = 'deleted', updated_at = CURRENT_TIMESTAMP WHERE id = ?
`)

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
      // Expected - the origin already considers this card deleted too; this replica just
      // reported the removal before the delete-propagation job reached it.
      tombstonePlacementStmt.run(placement.id)
      continue
    }

    if (policy === 'tombstone') {
      tombstonePlacementStmt.run(placement.id)
    } else {
      resetPlacementForRecreateStmt.run(placement.id)
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
// the origin still considers the card active.
export function detectReplicaDeletes(server: ServerRow, currentLocalCardIds: Set<string>): number {
  return detectReplicaDeletesTx(server, currentLocalCardIds)
}
