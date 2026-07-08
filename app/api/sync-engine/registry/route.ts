import { NextResponse } from 'next/server'
import { bootstrapRegistry, listServers, listCanonicalWatchlists } from '@/lib/sync/registry'
import { validateAllServers } from '@/lib/sync/configValidator'

// GET /api/sync-engine/registry - Current registry state (servers + canonical watchlists)
export async function GET() {
  try {
    return NextResponse.json({
      success: true,
      data: {
        servers: listServers(),
        canonicalWatchlists: listCanonicalWatchlists(),
      },
    })
  } catch (error) {
    console.error('Error fetching sync registry:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to fetch sync registry' },
      { status: 500 }
    )
  }
}

// POST /api/sync-engine/registry - Re-sync the registry from config.json
// (assigns server_uuid to any new server, upserts servers + canonical_watchlists), then runs the
// config validation sweep - this covers the "server added" validation trigger from RFC Phase 5.
export async function POST() {
  try {
    const result = bootstrapRegistry()

    let validation
    try {
      validation = await validateAllServers()
    } catch (error) {
      console.error('Error validating servers after registry bootstrap:', error)
      validation = null
    }

    return NextResponse.json({
      success: true,
      message: 'Registry synced from config.json',
      data: { ...result, validation },
    })
  } catch (error) {
    console.error('Error bootstrapping sync registry:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to bootstrap sync registry' },
      { status: 500 }
    )
  }
}
