// Sync pause (data-derived, restart-safe): while a DC cluster-delete is in flight, the rest of the
// sync engine must not download/reconcile/restore, or it could recreate a card that's intentionally
// being removed. Rather than an in-memory flag (which would reset on a restart mid-delete and could
// unpause too early), pause state is derived directly from the DB: paused whenever any global card
// is marked 'deleted' but still has placements that haven't finished deleting. Once every placement
// of every deleted card reaches a terminal state ('deleted' or 'dead_letter'), this naturally
// returns false again - no explicit "resume" call needed.
import db from './schema'

const pausedQueryStmt = db.prepare(`
  SELECT 1 FROM global_cards gc
  WHERE gc.status = 'deleted'
    AND EXISTS (
      SELECT 1 FROM card_placements cp
      WHERE cp.global_card_uuid = gc.global_card_uuid
        AND cp.sync_status NOT IN ('deleted', 'dead_letter')
    )
  LIMIT 1
`)

export function isSyncPaused(): boolean {
  return pausedQueryStmt.get() !== undefined
}

// Global card UUIDs currently mid cluster-delete (used by the worker to skip create/restore jobs
// for those specific cards without having to pause everything else).
const pausedCardsStmt = db.prepare(`
  SELECT DISTINCT gc.global_card_uuid FROM global_cards gc
  WHERE gc.status = 'deleted'
    AND EXISTS (
      SELECT 1 FROM card_placements cp
      WHERE cp.global_card_uuid = gc.global_card_uuid
        AND cp.sync_status NOT IN ('deleted', 'dead_letter')
    )
`)

export function getPausedGlobalCardUuids(): Set<string> {
  const rows = pausedCardsStmt.all() as Array<{ global_card_uuid: string }>
  return new Set(rows.map((r) => r.global_card_uuid))
}
