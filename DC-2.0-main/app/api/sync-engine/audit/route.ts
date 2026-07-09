import { NextRequest, NextResponse } from 'next/server'
import db from '@/lib/sync/schema'
import { getServerByName } from '@/lib/sync/registry'
import type { SyncAuditLogRow } from '@/lib/sync/types'

// GET /api/sync-engine/audit - recent audit log entries, most recent first.
// Optional filters: ?server=<name> ?eventType=<event_type> ?globalCardUuid=<uuid> ?limit=<n>
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const serverName = searchParams.get('server')
    const eventType = searchParams.get('eventType')
    const globalCardUuid = searchParams.get('globalCardUuid')
    const limit = Math.min(parseInt(searchParams.get('limit') || '100', 10), 500)

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
      conditions.push('sal.server_uuid = ?')
      params.push(server.server_uuid)
    }

    if (eventType) {
      conditions.push('sal.event_type = ?')
      params.push(eventType)
    }

    if (globalCardUuid) {
      conditions.push('sal.global_card_uuid = ?')
      params.push(globalCardUuid)
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    const rows = db
      .prepare(
        `SELECT sal.*, s.name as server_name FROM sync_audit_log sal
         LEFT JOIN servers s ON s.server_uuid = sal.server_uuid
         ${where} ORDER BY sal.event_time DESC LIMIT ?`
      )
      .all(...params, limit) as Array<SyncAuditLogRow & { server_name: string | null }>

    return NextResponse.json({ success: true, data: rows, count: rows.length })
  } catch (error) {
    console.error('Error fetching sync audit log:', error)
    return NextResponse.json({ success: false, error: 'Failed to fetch sync audit log' }, { status: 500 })
  }
}
