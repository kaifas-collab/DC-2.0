// Planner / Enqueuer (RFC Phase 2, Phase 4, Phase 9 optimistic concurrency).
//
// Scope boundary (continued from detector.ts): classify() decides what a card IS and writes
// global_cards plus the origin's own placement. This module decides WHO ELSE needs it - for a
// given global card, every enabled server except the origin should have a card_placements row
// whose desired_version has caught up to global_cards.sync_version. Two entry points:
//   - planFromClassification(outcome): the fast, reactive path - called right after classify()
//     for the two outcomes that actually change desired state (new_origin, known_origin_updated).
//   - reconcileAllPlacements(): a full sweep over every active global card, safe to run anytime.
//     Catches drift the reactive path can't see - a server enabled after a card already
//     propagated, or a fan-out interrupted by a crash before every target got its placement row.
//
// Topology: full-mirror-to-all-enabled-servers (every enabled server except the origin is a
// target), matching the RFC's own Phase 4 pseudocode ("enqueue placements for every OTHER target
// server") and the original goal statement ("synchronize that card to every other FRS server").
import db from './schema'
import { listServers } from './registry'
import type { ClassificationOutcome } from './detector'
import type { CardPlacementRow, GlobalCardRow } from './types'

function buildIdempotencyKey(globalCardUuid: string, version: number, serverUuid: string): string {
  return `${globalCardUuid}:${version}:${serverUuid}`
}

const getGlobalCardStmt = db.prepare(`SELECT * FROM global_cards WHERE global_card_uuid = ?`)

const getPlacementsForCardStmt = db.prepare(`SELECT * FROM card_placements WHERE global_card_uuid = ?`)

// Idempotent via the UNIQUE(global_card_uuid, server_uuid) constraint (Layer 3 of the recursion
// firewall, Module 1) - DO NOTHING means calling this twice for the same card/server is a no-op.
const insertPendingPlacementStmt = db.prepare(`
  INSERT INTO card_placements
    (global_card_uuid, server_uuid, local_card_id, is_origin, desired_version, synced_version,
     sync_status, next_attempt_at, idempotency_key)
  VALUES (?, ?, NULL, 0, ?, 0, 'pending', CURRENT_TIMESTAMP, ?)
  ON CONFLICT(global_card_uuid, server_uuid) DO NOTHING
`)

// Bumps desired_version unconditionally so a worker mid-flight knows there's more to do once it
// finishes, but only flips status/retry/error bookkeeping back to a fresh 'pending' attempt when
// the placement is NOT currently in_progress (never clobber an active lease's own transition).
// A version bump also revives a dead_letter placement - the input genuinely changed, which is a
// legitimate reason for a fresh attempt, not a reason to stay parked.
const restalePlacementStmt = db.prepare(`
  UPDATE card_placements
  SET desired_version = ?,
      idempotency_key = CASE WHEN sync_status = 'in_progress' THEN idempotency_key ELSE ? END,
      sync_status = CASE WHEN sync_status = 'in_progress' THEN sync_status ELSE 'pending' END,
      retry_count = CASE WHEN sync_status = 'in_progress' THEN retry_count ELSE 0 END,
      next_attempt_at = CASE WHEN sync_status = 'in_progress' THEN next_attempt_at ELSE CURRENT_TIMESTAMP END,
      last_error = CASE WHEN sync_status = 'in_progress' THEN last_error ELSE NULL END,
      updated_at = CURRENT_TIMESTAMP
  WHERE id = ? AND desired_version < ? AND is_origin = 0
`)

export interface PlanResult {
  globalCardUuid: string
  createdPlacements: number
  restaledPlacements: number
}

function planForGlobalCardImpl(globalCardUuid: string): PlanResult {
  const globalCard = getGlobalCardStmt.get(globalCardUuid) as GlobalCardRow | undefined
  if (!globalCard) {
    throw new Error(`planForCard: no global_cards row for ${globalCardUuid}`)
  }

  const targetServers = listServers().filter((s) => s.enabled && s.server_uuid !== globalCard.origin_server_uuid)
  const existingPlacements = getPlacementsForCardStmt.all(globalCardUuid) as CardPlacementRow[]
  const existingByServer = new Map(existingPlacements.map((p) => [p.server_uuid, p]))

  let created = 0
  let restaled = 0

  for (const server of targetServers) {
    const existing = existingByServer.get(server.server_uuid)

    if (!existing) {
      // Never create a fresh placement for a card that's already deleted (Module 6) - a server
      // that never had this card doesn't need a delete job, only servers with an existing copy do.
      if (globalCard.status === 'deleted') {
        continue
      }
      const key = buildIdempotencyKey(globalCardUuid, globalCard.sync_version, server.server_uuid)
      const result = insertPendingPlacementStmt.run(globalCardUuid, server.server_uuid, globalCard.sync_version, key)
      if (result.changes > 0) {
        created++
      }
      continue
    }

    // A placement that already finished processing the delete is done - no further version bumps
    // are expected once a global card is deleted (see deletion.ts), but stay defensive anyway.
    if (existing.sync_status === 'deleted') {
      continue
    }

    if (existing.desired_version < globalCard.sync_version) {
      const key = buildIdempotencyKey(globalCardUuid, globalCard.sync_version, server.server_uuid)
      const result = restalePlacementStmt.run(globalCard.sync_version, key, existing.id, globalCard.sync_version)
      if (result.changes > 0) {
        restaled++
      }
    }
  }

  return { globalCardUuid, createdPlacements: created, restaledPlacements: restaled }
}

const planForGlobalCardTx = db.transaction(planForGlobalCardImpl)

export function planForCard(globalCardUuid: string): PlanResult {
  return planForGlobalCardTx(globalCardUuid)
}

// Reactive hook: only new_origin and known_origin_updated ever change desired state that other
// servers need to catch up to.
export function planFromClassification(outcome: ClassificationOutcome): PlanResult | null {
  if (outcome.kind === 'new_origin' || outcome.kind === 'known_origin_updated') {
    return planForCard(outcome.globalCardUuid)
  }
  return null
}

// Full reconciliation sweep over every active global card. Idempotent and safe to run anytime -
// catches a server added after a card already propagated, or a fan-out interrupted mid-way.
export function reconcileAllPlacements(): PlanResult[] {
  const activeCards = db.prepare(`SELECT global_card_uuid FROM global_cards WHERE status = 'active'`).all() as Array<{
    global_card_uuid: string
  }>

  return activeCards.map((row) => planForCard(row.global_card_uuid))
}
