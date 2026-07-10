// DC cluster delete (item 2): deleting a card from the DC removes it from every connected FRS
// server. Deliberately separate from deletion.ts, which handles the OPPOSITE case (a card vanishing
// unintentionally on one server, which gets restored) - this module is the one true "intentional
// delete" path, and everything else in the engine is written to defer to it (see deletion.ts and
// pause.ts module headers).
import db from './schema'
import DBService from '../dbService'
import logger from '../logger'
import { isSyncPaused } from './pause'
import type { GlobalCardRow, CardPlacementRow } from './types'

const getGlobalCardStmt = db.prepare(`SELECT * FROM global_cards WHERE global_card_uuid = ?`)

const markGlobalCardDeletedStmt = db.prepare(`
  UPDATE global_cards
  SET status = 'deleted', sync_version = sync_version + 1, updated_at = CURRENT_TIMESTAMP
  WHERE global_card_uuid = ? AND status = 'active'
`)

// Resets EVERY existing placement - origin included - to a fresh delete job. This differs from
// planner.ts's restalePlacementStmt (which deliberately excludes is_origin=1, because THAT path is
// for mirroring content changes to replicas, not deletes): a cluster delete must remove the card
// from every server that has it, including the origin, since the operator is deleting it everywhere
// at once - the origin's own copy hasn't vanished on its own, so nothing else would ever queue a
// delete job for it.
const resetAllPlacementsForDeleteStmt = db.prepare(`
  UPDATE card_placements
  SET desired_version = ?,
      sync_status = CASE WHEN sync_status = 'in_progress' THEN sync_status ELSE 'pending' END,
      retry_count = CASE WHEN sync_status = 'in_progress' THEN retry_count ELSE 0 END,
      next_attempt_at = CASE WHEN sync_status = 'in_progress' THEN next_attempt_at ELSE CURRENT_TIMESTAMP END,
      last_error = CASE WHEN sync_status = 'in_progress' THEN last_error ELSE NULL END,
      updated_at = CURRENT_TIMESTAMP
  WHERE global_card_uuid = ? AND sync_status != 'deleted'
`)

export interface ClusterDeleteResult {
  ok: boolean
  reason?: string
}

function initiateClusterDeleteImpl(globalCardUuid: string): ClusterDeleteResult {
  const globalCard = getGlobalCardStmt.get(globalCardUuid) as GlobalCardRow | undefined
  if (!globalCard) {
    return { ok: false, reason: 'Card not found' }
  }
  if (globalCard.status === 'deleted') {
    return { ok: false, reason: 'Delete already in progress for this card' }
  }

  const result = markGlobalCardDeletedStmt.run(globalCardUuid)
  if (result.changes === 0) {
    return { ok: false, reason: 'Card was already deleted (race)' }
  }

  resetAllPlacementsForDeleteStmt.run(globalCard.sync_version + 1, globalCardUuid)

  logger.info('sync.delete', `Cluster delete started for "${globalCard.name}"`, {
    globalCardUuid,
    syncHash: globalCard.metadata_hash,
  })
  logger.info('sync.pause', `Sync paused - cluster delete in progress for "${globalCard.name}"`, {
    globalCardUuid,
  })

  return { ok: true }
}

const initiateClusterDeleteTx = db.transaction(initiateClusterDeleteImpl)

// Marks the card deleted and queues a delete job on every server that has a placement for it
// (including the origin). Returns immediately - propagation happens asynchronously via the worker.
export function initiateClusterDelete(globalCardUuid: string): ClusterDeleteResult {
  return initiateClusterDeleteTx(globalCardUuid)
}

const getPlacementsForCardStmt = db.prepare(`SELECT * FROM card_placements WHERE global_card_uuid = ?`)
const deletePlacementsStmt = db.prepare(`DELETE FROM card_placements WHERE global_card_uuid = ?`)
const deleteGlobalCardStmt = db.prepare(`DELETE FROM global_cards WHERE global_card_uuid = ?`)
const getServerBaseUrlStmt = db.prepare(`SELECT base_url FROM servers WHERE server_uuid = ?`)

// Called by the worker right after a placement finishes deleting. If EVERY placement for this
// global card is now 'deleted' (fully successful - a dead_letter placement deliberately does NOT
// count, so the mapping is kept and the card stays visible for an operator to retry/inspect), wipes
// the mapping from the DC's own DB: the card_placements rows, the global_cards row, and the
// corresponding rows in the read-mirror `cards` table so the dashboard stops showing it.
function maybeFinalizeClusterDeleteImpl(globalCardUuid: string): void {
  const globalCard = getGlobalCardStmt.get(globalCardUuid) as GlobalCardRow | undefined
  if (!globalCard || globalCard.status !== 'deleted') {
    return
  }

  const placements = getPlacementsForCardStmt.all(globalCardUuid) as CardPlacementRow[]
  const allDeleted = placements.length > 0 && placements.every((p) => p.sync_status === 'deleted')
  if (!allDeleted) {
    return
  }

  for (const placement of placements) {
    if (!placement.local_card_id) continue
    const serverRow = getServerBaseUrlStmt.get(placement.server_uuid) as { base_url: string } | undefined
    if (serverRow) {
      DBService.deleteCard(serverRow.base_url, placement.local_card_id)
    }
  }

  deletePlacementsStmt.run(globalCardUuid)
  deleteGlobalCardStmt.run(globalCardUuid)

  logger.info('sync.delete', `Cluster delete completed for "${globalCard.name}" - mapping removed from all ${placements.length} server(s)`, {
    globalCardUuid,
    syncHash: globalCard.metadata_hash,
    placementCount: placements.length,
  })

  // This card's own placements are all terminal now, but another cluster-delete could still be
  // mid-flight for a different card - only announce "resumed" once isSyncPaused() actually clears.
  if (!isSyncPaused()) {
    logger.info('sync.pause', 'Sync resumed - no cluster deletes remain in progress')
  }
}

const maybeFinalizeClusterDeleteTx = db.transaction(maybeFinalizeClusterDeleteImpl)

export function maybeFinalizeClusterDelete(globalCardUuid: string): void {
  maybeFinalizeClusterDeleteTx(globalCardUuid)
}

export interface ClusterDeleteStatus {
  globalCardUuid: string
  name: string | null
  done: boolean
  placements: Array<{ serverUuid: string; syncStatus: string; localCardId: string | null; lastError: string | null }>
}

// Status for the UI to poll while a delete is propagating. Returns null once the mapping has been
// fully cleaned up (the delete is complete and the card no longer exists in the DC's DB at all).
export function getClusterDeleteStatus(globalCardUuid: string): ClusterDeleteStatus | null {
  const globalCard = getGlobalCardStmt.get(globalCardUuid) as GlobalCardRow | undefined
  if (!globalCard) {
    return null
  }

  const placements = getPlacementsForCardStmt.all(globalCardUuid) as CardPlacementRow[]
  const done = globalCard.status === 'deleted' && placements.every((p) => p.sync_status === 'deleted' || p.sync_status === 'dead_letter')

  return {
    globalCardUuid,
    name: globalCard.name,
    done,
    placements: placements.map((p) => ({
      serverUuid: p.server_uuid,
      syncStatus: p.sync_status,
      localCardId: p.local_card_id,
      lastError: p.last_error,
    })),
  }
}
