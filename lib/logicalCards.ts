// Logical-card read path (item 5): the dashboard's "all cards" view should show one row per
// real-world person, not one row per (server, local_card_id) physical copy. global_cards (see
// lib/sync/schema.ts) is already exactly that - one row per person, keyed by global_card_uuid -
// so this reads from it directly rather than the physical `cards` mirror lib/dbService.ts serves.
import db from './sync/schema'
import type { LogicalCardData } from './types'

function mapRow(row: {
  global_card_uuid: string
  name: string | null
  comment: string | null
  metadata_json: string | null
  image_ref: string | null
  updated_at: string
}): LogicalCardData {
  let watchlist = ''
  try {
    const parsed = JSON.parse(row.metadata_json || '{}')
    if (Array.isArray(parsed.watchlists)) {
      watchlist = parsed.watchlists.join(', ')
    }
  } catch {
    // Malformed metadata_json - fall back to no watchlist rather than failing the whole list.
  }

  return {
    globalCardUuid: row.global_card_uuid,
    name: row.name || 'Unknown',
    comment: row.comment || '',
    watchlist,
    photo: row.image_ref,
    updatedAt: row.updated_at,
  }
}

const SELECT_COLUMNS = `global_card_uuid, name, comment, metadata_json, image_ref, updated_at`

const getLogicalCardsStmt = db.prepare(`
  SELECT ${SELECT_COLUMNS} FROM global_cards
  WHERE status = 'active'
  ORDER BY updated_at DESC
  LIMIT ? OFFSET ?
`)

const getLogicalCardsCountStmt = db.prepare(`
  SELECT COUNT(*) as count FROM global_cards WHERE status = 'active'
`)

// name LIKE '%q%' - a full scan at scale, same known limitation as the old FTS-backed search
// (which only covered the physical `cards` mirror). Documented as a scale follow-up; the index
// added alongside global_cards at least serves exact/prefix matches for free.
const searchLogicalCardsStmt = db.prepare(`
  SELECT ${SELECT_COLUMNS} FROM global_cards
  WHERE status = 'active' AND name LIKE ?
  ORDER BY updated_at DESC
  LIMIT ? OFFSET ?
`)

const searchLogicalCardsCountStmt = db.prepare(`
  SELECT COUNT(*) as count FROM global_cards WHERE status = 'active' AND name LIKE ?
`)

export function getLogicalCards(limit = 1000, offset = 0): LogicalCardData[] {
  const rows = getLogicalCardsStmt.all(limit, offset) as Parameters<typeof mapRow>[0][]
  return rows.map(mapRow)
}

export function getLogicalCardsCount(): number {
  const result = getLogicalCardsCountStmt.get() as { count: number }
  return result.count
}

export function searchLogicalCards(query: string, limit = 1000, offset = 0): LogicalCardData[] {
  const rows = searchLogicalCardsStmt.all(`%${query}%`, limit, offset) as Parameters<typeof mapRow>[0][]
  return rows.map(mapRow)
}

export function searchLogicalCardsCount(query: string): number {
  const result = searchLogicalCardsCountStmt.get(`%${query}%`) as { count: number }
  return result.count
}
