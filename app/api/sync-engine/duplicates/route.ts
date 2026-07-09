import { NextRequest, NextResponse } from 'next/server'
import db from '@/lib/sync/schema'
import type { GlobalCardRow } from '@/lib/sync/types'

// GET /api/sync-engine/duplicates - cross-origin duplicate detection (the safe half of dedup).
//
// Surfaces groups of ACTIVE global cards that share the same metadata_hash (name + active +
// canonical watchlists + comment) but are SEPARATE origin cards - i.e. very likely the same person
// created independently on more than one server, which the sync engine cannot auto-merge without
// risking a false merge of two different same-named people (a security-critical miss in a
// blacklist system). This endpoint is deliberately read-only: it reports candidates for an operator
// to confirm and resolve (delete the redundant origin via the existing delete-with-propagation
// flow), never auto-dropping anyone.
//
// This is the tool for the 200-server onboarding case: when servers with independently-created
// overlapping cards join the cluster, run this to find the overlaps instead of discovering them as
// visible duplicates on every mirror.
//
// Optional: ?limit=<n> caps the number of groups returned (default 100, max 1000).

interface DuplicateMember {
  globalCardUuid: string
  name: string | null
  originServerName: string | null
  originCardId: string
  createdAt: string
  placementCount: number
}

interface DuplicateGroup {
  metadataHash: string
  count: number
  distinctOriginServers: number
  members: DuplicateMember[]
}

export async function GET(request: NextRequest) {
  try {
    const limit = Math.min(Math.max(parseInt(request.nextUrl.searchParams.get('limit') || '100', 10), 1), 1000)

    // metadata_hash values shared by more than one active global card - each is a candidate group.
    const dupHashes = db
      .prepare(
        `SELECT metadata_hash, COUNT(*) as cnt
         FROM global_cards
         WHERE status = 'active' AND metadata_hash IS NOT NULL
         GROUP BY metadata_hash
         HAVING cnt > 1
         ORDER BY cnt DESC
         LIMIT ?`
      )
      .all(limit) as Array<{ metadata_hash: string; cnt: number }>

    const memberStmt = db.prepare(
      `SELECT gc.global_card_uuid, gc.name, gc.origin_card_id, gc.created_at,
              s.name AS origin_server_name,
              (SELECT COUNT(*) FROM card_placements cp WHERE cp.global_card_uuid = gc.global_card_uuid) AS placement_count
       FROM global_cards gc
       LEFT JOIN servers s ON s.server_uuid = gc.origin_server_uuid
       WHERE gc.status = 'active' AND gc.metadata_hash = ?
       ORDER BY gc.created_at`
    )

    const groups: DuplicateGroup[] = dupHashes.map(({ metadata_hash }) => {
      const rows = memberStmt.all(metadata_hash) as Array<
        Pick<GlobalCardRow, 'global_card_uuid' | 'name' | 'origin_card_id' | 'created_at'> & {
          origin_server_name: string | null
          placement_count: number
        }
      >

      const members: DuplicateMember[] = rows.map((r) => ({
        globalCardUuid: r.global_card_uuid,
        name: r.name,
        originServerName: r.origin_server_name,
        originCardId: r.origin_card_id,
        createdAt: r.created_at,
        placementCount: r.placement_count,
      }))

      const distinctOriginServers = new Set(members.map((m) => m.originServerName)).size

      return {
        metadataHash: metadata_hash,
        count: members.length,
        distinctOriginServers,
        members,
      }
    })

    // A shared hash across DIFFERENT origin servers is the strong "same person on multiple servers"
    // signal; a shared hash within one origin is rarer but still a genuine duplicate worth review.
    const crossOriginGroups = groups.filter((g) => g.distinctOriginServers > 1).length

    return NextResponse.json({
      success: true,
      data: {
        groups,
        summary: {
          duplicateGroups: groups.length,
          crossOriginGroups,
          duplicateCards: groups.reduce((sum, g) => sum + g.count, 0),
        },
      },
    })
  } catch (error) {
    console.error('Error detecting duplicates:', error)
    return NextResponse.json({ success: false, error: 'Failed to detect duplicates' }, { status: 500 })
  }
}
