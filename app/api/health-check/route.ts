import { NextRequest, NextResponse } from 'next/server'
import { exec } from 'child_process'
import { promisify } from 'util'
import { getServerConfig } from '@/config/serverConfig'

const execAsync = promisify(exec)

// GET /api/health-check?server=ServerName - Check health of a specific server
export async function GET(request: NextRequest) {
  const CONFIG = getServerConfig()
  try {
    const { searchParams } = new URL(request.url)
    const serverName = searchParams.get('server')

    if (!serverName) {
      return NextResponse.json({ 
        success: false, 
        error: 'Server name is required' 
      }, { status: 400 })
    }

    const server = CONFIG.servers.find(s => s.name === serverName)
    if (!server) {
      return NextResponse.json({ 
        success: false, 
        error: 'Server not found' 
      }, { status: 404 })
    }

    // Extract IP from baseURL
    const ipMatch = server.baseURL.match(/\/\/([^:/]+)/)
    const ip = ipMatch ? ipMatch[1] : null

    if (!ip) {
      return NextResponse.json({ 
        success: false, 
        error: 'Invalid server URL' 
      }, { status: 400 })
    }

    try {
      await execAsync(`ping -c 1 -W 3 -n ${ip}`)
      return NextResponse.json({
        success: true,
        online: true,
        serverName,
        ip
      })
    } catch {
      return NextResponse.json({
        success: true,
        online: false,
        serverName,
        ip
      })
    }
  } catch (error) {
    console.error('Health check error:', error)
    return NextResponse.json(
      { success: false, error: 'Health check failed' },
      { status: 500 }
    )
  }
}

// POST /api/health-check - Legacy endpoint for IP-based health check
export async function POST(request: NextRequest) {
  const CONFIG = getServerConfig()
  try {
    const { ip } = await request.json()
    
    if (!ip) {
      return NextResponse.json({ 
        success: false, 
        error: 'IP address is required' 
      }, { status: 400 })
    }

    // Pure ping command - works on local network without internet
    // -c 1: send 1 packet
    // -W 3: wait 3 seconds for response
    // -n: numeric output only (no DNS resolution needed - no internet dependency)
    try {
      const { stdout, stderr } = await execAsync(`ping -c 1 -W 3 -n ${ip}`)
      
      console.log(`✅ Ping successful for ${ip}`)
      
      // If ping succeeds, server is online
      return NextResponse.json({
        success: true,
        online: true,
        ip
      })
    } catch (pingError) {
      console.log(`❌ Ping failed for ${ip}`)
      
      // If ping fails, server is offline
      return NextResponse.json({
        success: true,
        online: false,
        ip
      })
    }
  } catch (error) {
    console.error('Health check error:', error)
    return NextResponse.json(
      { success: false, error: 'Health check failed' },
      { status: 500 }
    )
  }
}
