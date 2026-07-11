// Change Detector / classify() - the recursion firewall (RFC Phase 4 Loop 1, Phase 6).
//
// Scope boundary (matches the RFC's own module split): classify() decides what a single
// downloaded card IS - a brand new origin card, an unchanged known card, a changed origin card,
// a known replica, or a recovered orphan - and writes global_cards plus *this server's own*
// card_placements row. It never creates placement rows for OTHER servers; deciding who else
// needs the card is the Planner/Enqueuer's job (Module 4), which reads global_cards and reconciles
// against every target server's placements. This keeps "detect what changed" and "decide who
// needs it" as separate, independently testable concerns.
//
// The five-layer defense from Phase 6/6A, as implemented here:
//   Layer 1 (primary) - reverse lookup on UNIQUE(server_uuid, local_card_id): a known
//     local_card_id is never re-classified as new. This alone handles the steady-state loop
//     described in the RFC (server B assigns a new local id to a DC-created replica; the next
//     download of B recognizes it and stops).
//   Layer 2 (optional, config-flagged) - meta.dc_global_key stamp: adopts a crash-orphaned
//     replica (uploaded but the placement write was lost) in O(1). Off by default (Phase 6A);
//     when off, that narrow crash window falls through to Layer 3/4 instead.
//   Layer 3 - UNIQUE(global_card_uuid, server_uuid) on card_placements: makes a duplicate
//     placement impossible to create even if classify() were ever called twice for the same card.
//   Layer 4 (fingerprint-assisted recovery) - NOT implemented in this module. Per Phase 6A it is
//     a conservative, operator-reviewed reconciliation/bootstrap mechanism, not something the
//     per-card incremental classifier should do inline. Its absence here is a known, documented
//     limitation: with stampMetadata=false, a crash between "upload succeeded" and "placement
//     recorded" will be classified as a new origin card on the next detect pass, producing one
//     duplicate, until Module 0 (Bootstrap) or a future reconciliation pass lands.
import crypto from 'crypto'
import db from './schema'
import { listServerWatchlists } from './watchlist'
import { computeMetadataHash, computeImageHash } from './hash'
import logger from '../logger'
import type { ServerRow, CardPlacementRow, GlobalCardRow } from './types'

export interface DownloadedCard {
  originCardId: string
  name: string
  active: boolean
  watchlistLocalIds: Array<number | string>
  modifiedDate: string | null
  photoPath: string | null
  // Small face thumbnail, separate from photoPath (the full-quality source photo used to actually
  // mirror the card onto other FRS servers). Display-only - never uploaded anywhere.
  thumbnailPath: string | null
  // A change here (as much as name/watchlists) marks a known origin card as updated - see the
  // metadataHash computation below - so an edit made only to a card's comment on FRS still gets
  // detected and mirrored to the other servers, not just name/watchlist edits.
  comment: string
  // meta.dc_global_key from the raw FRS payload - callers must pass null unless
  // config.sync.stampMetadata is enabled (see Phase 6A: metadata stamping is opt-in).
  stampedGlobalUuid: string | null
}

export type ClassificationOutcome =
  | { kind: 'known_origin_unchanged'; globalCardUuid: string }
  | { kind: 'known_origin_updated'; globalCardUuid: string; newVersion: number }
  | { kind: 'known_replica_confirmed'; globalCardUuid: string }
  | { kind: 'adopted_orphan'; globalCardUuid: string }
  | { kind: 'new_origin'; globalCardUuid: string }

const findPlacementByLocalIdStmt = db.prepare(`
  SELECT * FROM card_placements WHERE server_uuid = ? AND local_card_id = ?
`)

// Layer 3.5 (mirror-return adoption): find a mirror placement on THIS server that we created (via
// the planner) to fan a card out here, that the worker has already fulfilled on FRS but whose
// local_card_id has NOT yet been recorded (still NULL) - the exact state during the race between
// "FRS assigned the new id" and "worker persisted that id". Matched on metadata_hash only, never
// image_hash: FRS re-encodes the re-downloaded photo so its bytes (and hash) legitimately differ
// from the origin's, but name+active+watchlists+comment survive the round-trip unchanged.
const findUnboundMirrorPlacementStmt = db.prepare(`
  SELECT cp.* FROM card_placements cp
  INNER JOIN global_cards gc ON gc.global_card_uuid = cp.global_card_uuid
  WHERE cp.server_uuid = ?
    AND cp.is_origin = 0
    AND cp.local_card_id IS NULL
    AND gc.status = 'active'
    AND gc.metadata_hash = ?
  ORDER BY cp.id
  LIMIT 1
`)

const getGlobalCardStmt = db.prepare(`SELECT * FROM global_cards WHERE global_card_uuid = ?`)

const insertGlobalCardStmt = db.prepare(`
  INSERT INTO global_cards
    (global_card_uuid, origin_server_uuid, origin_card_id, name, comment, metadata_json, image_ref,
     thumbnail_ref, image_hash, metadata_hash, sync_version, origin_modified_at, status)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 'active')
`)

// Optimistic concurrency (RFC Phase 9): only applies the update if sync_version still matches
// what this classify() call read. A changes=0 result means another writer already advanced it;
// the caller treats that as "nothing to do this pass" rather than double-bumping the version.
const updateGlobalCardStmt = db.prepare(`
  UPDATE global_cards
  SET name = ?, comment = ?, metadata_json = ?, image_ref = ?, thumbnail_ref = ?, image_hash = ?,
      metadata_hash = ?, sync_version = sync_version + 1, origin_modified_at = ?,
      updated_at = CURRENT_TIMESTAMP
  WHERE global_card_uuid = ? AND sync_version = ?
`)

const insertPlacementStmt = db.prepare(`
  INSERT INTO card_placements
    (global_card_uuid, server_uuid, local_card_id, is_origin, desired_version, synced_version,
     sync_status, idempotency_key)
  VALUES (?, ?, ?, ?, ?, ?, 'synced', ?)
`)

const touchPlacementLocalIdStmt = db.prepare(`
  UPDATE card_placements SET local_card_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
`)

function buildIdempotencyKey(globalCardUuid: string, version: number, serverUuid: string): string {
  return `${globalCardUuid}:${version}:${serverUuid}`
}

function canonicalWatchlistNamesFor(serverUuid: string, localIds: Array<number | string>): string[] {
  const rows = listServerWatchlists(serverUuid)
  const byLocalId = new Map(rows.map((r) => [r.local_watchlist_id, r.canonical_name]))
  const names: string[] = []
  for (const id of localIds) {
    const name = byLocalId.get(String(id))
    if (name) {
      names.push(name)
    }
  }
  return names
}

function classifyImpl(server: ServerRow, card: DownloadedCard): ClassificationOutcome {
  const canonicalNames = canonicalWatchlistNamesFor(server.server_uuid, card.watchlistLocalIds)
  const metadataHash = computeMetadataHash({
    name: card.name,
    active: card.active,
    canonicalWatchlistNames: canonicalNames,
    comment: card.comment,
  })
  const imageHash = computeImageHash(card.photoPath)

  // Layer 1: is this (server, local_card_id) already a known placement?
  const placement = findPlacementByLocalIdStmt.get(server.server_uuid, card.originCardId) as
    | CardPlacementRow
    | undefined

  if (placement) {
    if (placement.is_origin) {
      const globalCard = getGlobalCardStmt.get(placement.global_card_uuid) as GlobalCardRow

      if (globalCard.metadata_hash === metadataHash && globalCard.image_hash === imageHash) {
        return { kind: 'known_origin_unchanged', globalCardUuid: globalCard.global_card_uuid }
      }

      const result = updateGlobalCardStmt.run(
        card.name,
        card.comment,
        JSON.stringify({ watchlists: canonicalNames }),
        card.photoPath,
        card.thumbnailPath,
        imageHash,
        metadataHash,
        card.modifiedDate,
        globalCard.global_card_uuid,
        globalCard.sync_version
      )

      if (result.changes === 0) {
        return { kind: 'known_origin_unchanged', globalCardUuid: globalCard.global_card_uuid }
      }

      logger.info(
        'sync.detector',
        `Card "${card.name}" updated on origin ${server.name} (local id ${card.originCardId}) - will re-propagate to all replicas`,
        {
          server: server.name,
          localCardId: card.originCardId,
          globalCardUuid: globalCard.global_card_uuid,
          newVersion: globalCard.sync_version + 1,
        }
      )

      return {
        kind: 'known_origin_updated',
        globalCardUuid: globalCard.global_card_uuid,
        newVersion: globalCard.sync_version + 1,
      }
    }

    // Known replica: this is exactly the steady-state loop-prevention case from the RFC (server B
    // re-assigns local ids on its own schedule; we already know this one). Never re-propagate.
    if (placement.local_card_id !== card.originCardId) {
      const previousLocalCardId = placement.local_card_id
      touchPlacementLocalIdStmt.run(card.originCardId, placement.id)
      logger.info(
        'sync.mapping',
        `Rebound local_card_id for placement ${placement.id} on ${server.name}: ${previousLocalCardId ?? 'null'} -> ${card.originCardId}`,
        {
          server: server.name,
          placementId: placement.id,
          globalCardUuid: placement.global_card_uuid,
          previousLocalCardId,
          newLocalCardId: card.originCardId,
        }
      )
    }
    return { kind: 'known_replica_confirmed', globalCardUuid: placement.global_card_uuid }
  }

  // Layer 2 (optional): adopt a crash-orphaned replica via its stamped global key.
  if (card.stampedGlobalUuid) {
    const globalCard = getGlobalCardStmt.get(card.stampedGlobalUuid) as GlobalCardRow | undefined
    if (globalCard) {
      insertPlacementStmt.run(
        globalCard.global_card_uuid,
        server.server_uuid,
        card.originCardId,
        0,
        globalCard.sync_version,
        globalCard.sync_version,
        buildIdempotencyKey(globalCard.global_card_uuid, globalCard.sync_version, server.server_uuid)
      )
      return { kind: 'adopted_orphan', globalCardUuid: globalCard.global_card_uuid }
    }
  }

  // Layer 3.5 (mirror-return adoption): this is the copy WE pushed to this server coming back
  // before Layer 1 could see its recorded local_card_id. Bind it into its waiting placement rather
  // than misclassifying it as a new origin (which the planner would then fan back to the ORIGINAL
  // origin server - the A->B->A duplicate). See findUnboundMirrorPlacementStmt above.
  const returningMirror = findUnboundMirrorPlacementStmt.get(server.server_uuid, metadataHash) as
    | CardPlacementRow
    | undefined
  if (returningMirror) {
    touchPlacementLocalIdStmt.run(card.originCardId, returningMirror.id)
    logger.info(
      'sync.detector',
      `Adopted returning mirror card ${card.originCardId} on ${server.name} into placement ${returningMirror.id} (metadata match) - prevented a duplicate back to the origin`,
      {
        server: server.name,
        localCardId: card.originCardId,
        placementId: returningMirror.id,
        globalCardUuid: returningMirror.global_card_uuid,
      }
    )
    return { kind: 'known_replica_confirmed', globalCardUuid: returningMirror.global_card_uuid }
  }

  // Genuinely new origin card - no known placement, no matching stamp, no returning mirror.
  const globalCardUuid = crypto.randomUUID()
  insertGlobalCardStmt.run(
    globalCardUuid,
    server.server_uuid,
    card.originCardId,
    card.name,
    card.comment,
    JSON.stringify({ watchlists: canonicalNames }),
    card.photoPath,
    card.thumbnailPath,
    imageHash,
    metadataHash,
    card.modifiedDate
  )
  insertPlacementStmt.run(
    globalCardUuid,
    server.server_uuid,
    card.originCardId,
    1,
    1,
    1,
    buildIdempotencyKey(globalCardUuid, 1, server.server_uuid)
  )

  logger.info(
    'sync.detector',
    `New origin card ${card.originCardId} "${card.name}" on ${server.name} - will mirror to all other servers`,
    {
      server: server.name,
      localCardId: card.originCardId,
      globalCardUuid,
    }
  )

  return { kind: 'new_origin', globalCardUuid }
}

// Wrapped in a transaction for atomicity/crash-safety (RFC N2): a failure partway through never
// leaves a global_cards row without its origin placement, or vice versa.
const classifyTx = db.transaction(classifyImpl)

export function classify(server: ServerRow, card: DownloadedCard): ClassificationOutcome {
  return classifyTx(server, card)
}
