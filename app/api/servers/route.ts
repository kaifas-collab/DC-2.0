import { NextRequest, NextResponse } from 'next/server'
import axios from 'axios'
import { getServerConfig, saveServerConfig } from '@/config/serverConfig'
import { checkServerHealth } from '@/lib/health'
import { bootstrapRegistry } from '@/lib/sync/registry'
import logger from '@/lib/logger'
import type { ServerConfig } from '@/lib/types'

export const dynamic = 'force-dynamic'

// Normalizes a base URL to always end with exactly one trailing slash. The sync code appends the API
// endpoints directly (e.g. `${baseURL}${apiEndpoints.cards}` -> `http://host/cards/humans/`), so a
// missing slash silently produces a broken URL.
function normalizeBaseUrl(raw: string): string | null {
  let value = raw.trim()
  if (!value) return null
  if (!/^https?:\/\//i.test(value)) {
    value = `http://${value}`
  }
  try {
    // Validates the URL and drops any accidental path/query the operator pasted in.
    const parsed = new URL(value)
    return `${parsed.protocol}//${parsed.host}/`
  } catch {
    return null
  }
}

// Fire-and-forget: kick off one full sync so the just-added server is populated immediately instead
// of waiting for the configured interval. Not awaited - the add response returns right away. Safe
// here because the app is a long-lived Node server (not serverless), so this promise runs to
// completion. Reuses the same self-POST pattern as the scheduler's downloadTick.
function triggerBackgroundSync(origin: string, serverName: string): void {
  axios
    .post(`${origin}/api/sync`, {}, { timeout: 300_000 })
    .then(() => logger.info('servers.add', `Background sync after adding "${serverName}" completed`, { serverName }))
    .catch((error) => {
      // A 409 here just means a cluster-delete is in flight and sync is paused - not a real failure.
      const status = axios.isAxiosError(error) ? error.response?.status : undefined
      if (status === 409) {
        logger.info('servers.add', `Background sync after adding "${serverName}" skipped (sync paused)`, { serverName })
      } else {
        logger.warn('servers.add', `Background sync after adding "${serverName}" failed`, {
          serverName,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    })
}

// POST /api/servers - add an FRS server to config.json (and register it in the sync engine) from the
// dashboard, instead of hand-editing the backend config file.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    const token = typeof body.token === 'string' ? body.token.trim() : ''
    const location = typeof body.location === 'string' ? body.location.trim() : ''
    const rawBaseURL = typeof body.baseURL === 'string' ? body.baseURL : ''

    if (!name || !token || !location || !rawBaseURL.trim()) {
      return NextResponse.json(
        { success: false, error: 'name, baseURL, token and location are all required' },
        { status: 400 }
      )
    }

    const baseURL = normalizeBaseUrl(rawBaseURL)
    if (!baseURL) {
      return NextResponse.json({ success: false, error: 'baseURL is not a valid URL' }, { status: 400 })
    }

    const config = getServerConfig()

    if (config.servers.some((s) => s.name === name)) {
      return NextResponse.json(
        { success: false, error: `A server named "${name}" already exists` },
        { status: 409 }
      )
    }

    const server: ServerConfig = { name, baseURL, token, location }

    // Precondition: the server must actually answer an authenticated FRS request before we persist
    // it - a mistyped URL/token can't be written to config.
    const online = await checkServerHealth(server)
    if (!online) {
      return NextResponse.json(
        { success: false, error: 'Server not reachable with the given URL and token. Nothing was saved.' },
        { status: 400 }
      )
    }

    config.servers.push(server)
    saveServerConfig(config)

    // Assigns server_uuid and upserts it into the sync-engine servers table (idempotent).
    bootstrapRegistry()

    logger.info('servers.add', `Added server "${name}" (${baseURL})`, { serverName: name, baseURL, location })

    // Populate it right away without blocking this response.
    triggerBackgroundSync(request.nextUrl.origin, name)

    return NextResponse.json({ success: true, server })
  } catch (error) {
    logger.error('servers.add', 'Failed to add server', { error: error instanceof Error ? error.message : String(error) })
    return NextResponse.json({ success: false, error: 'Failed to add server' }, { status: 500 })
  }
}
