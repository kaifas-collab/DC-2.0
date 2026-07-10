import { NextRequest, NextResponse } from 'next/server'
import { getServerConfig } from '@/config/serverConfig'
import { checkServerHealth } from '@/lib/health'
import type { ServerConfig } from '@/lib/types'

// Resolves a server from config by name, or by the IP embedded in its baseURL (back-compat with the
// old ping endpoint that took { ip }).
function resolveServer(CONFIG: ReturnType<typeof getServerConfig>, opts: { serverName?: string | null; ip?: string | null }): ServerConfig | undefined {
  if (opts.serverName) {
    return CONFIG.servers.find((s) => s.name === opts.serverName)
  }
  if (opts.ip) {
    return CONFIG.servers.find((s) => {
      const m = s.baseURL.match(/\/\/([^:/]+)/)
      return m && m[1] === opts.ip
    })
  }
  return undefined
}

// GET /api/health-check?server=ServerName - real FRS-API health check for one server.
export async function GET(request: NextRequest) {
  const CONFIG = getServerConfig()
  try {
    const serverName = new URL(request.url).searchParams.get('server')
    if (!serverName) {
      return NextResponse.json({ success: false, error: 'Server name is required' }, { status: 400 })
    }

    const server = resolveServer(CONFIG, { serverName })
    if (!server) {
      return NextResponse.json({ success: false, error: 'Server not found' }, { status: 404 })
    }

    const online = await checkServerHealth(server)
    const ip = server.baseURL.match(/\/\/([^:/]+)/)?.[1] ?? null
    return NextResponse.json({ success: true, online, serverName, ip })
  } catch (error) {
    console.error('Health check error:', error)
    return NextResponse.json({ success: false, error: 'Health check failed' }, { status: 500 })
  }
}

// POST /api/health-check - real FRS-API health check. Accepts { serverName } (preferred) or { ip }.
export async function POST(request: NextRequest) {
  const CONFIG = getServerConfig()
  try {
    const body = await request.json()
    const server = resolveServer(CONFIG, { serverName: body.serverName, ip: body.ip })
    if (!server) {
      return NextResponse.json({ success: false, error: 'Server not found' }, { status: 404 })
    }

    const online = await checkServerHealth(server)
    const ip = server.baseURL.match(/\/\/([^:/]+)/)?.[1] ?? null
    return NextResponse.json({ success: true, online, serverName: server.name, ip })
  } catch (error) {
    console.error('Health check error:', error)
    return NextResponse.json({ success: false, error: 'Health check failed' }, { status: 500 })
  }
}
