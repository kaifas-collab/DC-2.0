export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getServerConfig, saveServerConfig } from '@/config/serverConfig'
import logger from '@/lib/logger'

export async function GET() {
  const config = getServerConfig()
  return NextResponse.json(config)
}

// PATCH /api/config - update the sync interval. Operators think in hours; we persist seconds.
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json()
    const hours = Number(body.hours)

    if (!Number.isFinite(hours) || hours <= 0) {
      return NextResponse.json(
        { success: false, error: 'hours must be a positive number' },
        { status: 400 }
      )
    }

    const refreshIntervalSeconds = Math.round(hours * 3600)
    const config = getServerConfig()
    config.refreshIntervalSeconds = refreshIntervalSeconds
    saveServerConfig(config)

    logger.info('config.update', `Sync interval set to ${hours} hour(s) (${refreshIntervalSeconds}s)`, {
      hours,
      refreshIntervalSeconds,
    })

    return NextResponse.json({ success: true, refreshIntervalSeconds, hours })
  } catch (error) {
    logger.error('config.update', 'Failed to update sync interval', { error: error instanceof Error ? error.message : String(error) })
    return NextResponse.json({ success: false, error: 'Failed to update sync interval' }, { status: 500 })
  }
}
