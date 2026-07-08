import { NextRequest, NextResponse } from 'next/server'
import { validateAllServers, validateServerConfig, getLatestValidationResults } from '@/lib/sync/configValidator'
import { getServerByName } from '@/lib/sync/registry'

// GET /api/sync-engine/config-validation - latest validation result per server
export async function GET() {
  try {
    return NextResponse.json({
      success: true,
      data: getLatestValidationResults(),
    })
  } catch (error) {
    console.error('Error fetching config validation results:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to fetch config validation results' },
      { status: 500 }
    )
  }
}

// POST /api/sync-engine/config-validation - run the validation sweep.
// Body: {} (or omitted) to validate every enabled server, or { serverName } for just one.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const { serverName } = body as { serverName?: string }

    if (serverName) {
      const server = getServerByName(serverName)
      if (!server) {
        return NextResponse.json(
          { success: false, error: `Server '${serverName}' not found in registry` },
          { status: 404 }
        )
      }
      if (!server.enabled) {
        return NextResponse.json(
          { success: false, error: `Server '${serverName}' is disabled` },
          { status: 400 }
        )
      }

      const outcome = await validateServerConfig(server)
      return NextResponse.json({ success: true, data: [outcome] })
    }

    const outcomes = await validateAllServers()
    return NextResponse.json({ success: true, data: outcomes })
  } catch (error) {
    console.error('Error running config validation:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to run config validation' },
      { status: 500 }
    )
  }
}
