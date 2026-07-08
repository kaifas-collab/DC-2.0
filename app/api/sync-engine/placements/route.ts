import { NextRequest, NextResponse } from 'next/server'
import db from '@/lib/sync/schema'
import { getServerByName } from '@/lib/sync/registry'
import type { CardPlacementRow } from '@/lib/sync/types'

// GET /api/sync-engine/placements - observability into the work queue.
// Optional filters: ?server=<name> ?status=<sync_status>[,<sync_status>...] ?globalCardUuid=<uuid>
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const serverName = searchParams.get('server')
    const status = searchParams.get('status')
    const globalCardUuid = searchParams.get('globalCardUuid')

    const conditions: string[] = []
    const params: Array<string> = []

    if (serverName) {
      const server = getServerByName(serverName)
      if (!server) {
        return NextResponse.json(
          { success: false, error: `Server '${serverName}' not found in registry` },
          { status: 404 }
        )
      }
      conditions.push('cp.server_uuid = ?')
      params.push(server.server_uuid)
    }

    if (status) {
      const statuses = status.split(',').map((s) => s.trim()).filter(Boolean)
      conditions.push(`cp.sync_status IN (${statuses.map(() => '?').join(',')})`)
      params.push(...statuses)
    }

    if (globalCardUuid) {
      conditions.push('cp.global_card_uuid = ?')
      params.push(globalCardUuid)
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    const rows = db
      .prepare(
        `SELECT cp.*, s.name as server_name FROM card_placements cp
         LEFT JOIN servers s ON s.server_uuid = cp.server_uuid
         ${where} ORDER BY cp.updated_at DESC LIMIT 500`
      )
      .all(...params) as Array<CardPlacementRow & { server_name: string | null }>

    return NextResponse.json({ success: true, data: rows, count: rows.length })
  } catch (error) {
    console.error('Error fetching placements:', error)
    return NextResponse.json({ success: false, error: 'Failed to fetch placements' }, { status: 500 })
  }
}
