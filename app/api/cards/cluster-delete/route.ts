import { NextRequest, NextResponse } from 'next/server'
import db from '@/lib/sync/schema'
import { findOfflineServers } from '@/lib/health'
import { initiateClusterDelete, getClusterDeleteStatus } from '@/lib/sync/clusterDelete'
import logger from '@/lib/logger'
import type { CardPlacementRow } from '@/lib/sync/types'

// Resolves a globalCardUuid from a legacy {server_url, card_id} pair (back-compat with callers that
// still identify a card by its physical copy, e.g. before the UI fully moves to logical cards).
function resolveGlobalCardUuid(serverUrl: string, cardId: string): string | null {
  const server = db.prepare('SELECT server_uuid FROM servers WHERE base_url = ?').get(serverUrl) as
    | { server_uuid: string }
    | undefined
  if (!server) {
    return null
  }

  const placement = db
    .prepare('SELECT * FROM card_placements WHERE server_uuid = ? AND local_card_id = ?')
    .get(server.server_uuid, cardId) as CardPlacementRow | undefined

  return placement?.global_card_uuid ?? null
}

// POST /api/cards/cluster-delete - delete a card from EVERY connected FRS server.
//
// This is the only intentional delete path in the system (see lib/sync/deletion.ts and
// lib/sync/pause.ts). It is blocked entirely if any configured server is currently unreachable, and
// it runs asynchronously through the existing sync engine (placement queue + worker), which also
// automatically pauses the rest of the engine (downloads/reconcile/restore) until every server
// confirms the deletion.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    let globalCardUuid: string | null = body.globalCardUuid ?? null

    if (!globalCardUuid && body.server_url && body.card_id) {
      globalCardUuid = resolveGlobalCardUuid(body.server_url, String(body.card_id))
    }

    if (!globalCardUuid) {
      return NextResponse.json({ success: false, error: 'globalCardUuid (or server_url + card_id) is required' }, { status: 400 })
    }

    const offlineServers = await findOfflineServers()
    if (offlineServers.length > 0) {
      logger.warn('sync.delete', `Cluster delete rejected - ${offlineServers.length} server(s) offline`, {
        globalCardUuid,
        offlineServers,
      })
      return NextResponse.json(
        {
          success: false,
          error: `Cannot delete while ${offlineServers.length} server(s) are offline: ${offlineServers.join(', ')}`,
          offlineServers,
        },
        { status: 409 }
      )
    }

    const result = initiateClusterDelete(globalCardUuid)
    if (!result.ok) {
      return NextResponse.json({ success: false, error: result.reason }, { status: 409 })
    }

    return NextResponse.json({ success: true, globalCardUuid, status: 'deleting' })
  } catch (error) {
    logger.error('sync.delete', 'Cluster delete request failed', { error: error instanceof Error ? error.message : String(error) })
    return NextResponse.json({ success: false, error: 'Failed to start cluster delete' }, { status: 500 })
  }
}

// GET /api/cards/cluster-delete?globalCardUuid=... - poll delete progress ("deleting" -> done).
export async function GET(request: NextRequest) {
  try {
    const globalCardUuid = request.nextUrl.searchParams.get('globalCardUuid')
    if (!globalCardUuid) {
      return NextResponse.json({ success: false, error: 'globalCardUuid is required' }, { status: 400 })
    }

    const status = getClusterDeleteStatus(globalCardUuid)
    if (!status) {
      // No longer present at all -> the delete finished and the mapping was already cleaned up.
      return NextResponse.json({ success: true, data: { globalCardUuid, done: true, placements: [] } })
    }

    return NextResponse.json({ success: true, data: status })
  } catch (error) {
    logger.error('sync.delete', 'Cluster delete status check failed', { error: error instanceof Error ? error.message : String(error) })
    return NextResponse.json({ success: false, error: 'Failed to get cluster delete status' }, { status: 500 })
  }
}
