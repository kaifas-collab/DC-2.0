import { NextRequest, NextResponse } from 'next/server'
import { getServerConfig } from '@/config/serverConfig'

export async function POST(request: NextRequest) {
  const CONFIG = getServerConfig()
  try {
    const body = await request.json()
    console.log('📥 FRS Proxy received:', body)
    
    const { serverName, endpoint } = body
    
    if (!serverName || !endpoint) {
      console.error('❌ Missing required fields:', { serverName, endpoint })
      return NextResponse.json({ error: 'serverName and endpoint are required' }, { status: 400 })
    }
    
    // Find the server configuration
    const server = CONFIG.servers.find(s => s.name === serverName)
    if (!server) {
      console.error('❌ Server not found:', serverName, 'Available:', CONFIG.servers.map(s => s.name))
      return NextResponse.json({ error: 'Server not found' }, { status: 404 })
    }

    // Construct the full URL
    const url = `${server.baseURL}${endpoint.startsWith('/') ? endpoint.slice(1) : endpoint}`
    
    console.log(`🔗 Proxying request to: ${url}`)
    
    // Make the request to the FRS server with timeout (increased for high latency connections)
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 30000) // 30 second timeout for FRS API calls
    
    let response
    try {
      response = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'Authorization': `Token ${server.token}`,
        },
        signal: controller.signal
      })
    } catch (fetchError: any) {
      clearTimeout(timeoutId)
      if (fetchError.name === 'AbortError') {
        console.error(`⏱️ Request timeout for ${serverName} (30s)`)
        return NextResponse.json(
          { error: 'Request timeout - server may be offline' },
          { status: 504 }
        )
      }
      throw fetchError
    }
    
    clearTimeout(timeoutId)

    if (!response.ok) {
      console.error(`❌ FRS API Error: ${response.status} ${response.statusText}`)
      return NextResponse.json(
        { error: `FRS API Error: ${response.status} ${response.statusText}` },
        { status: response.status }
      )
    }

    const data = await response.json()
    console.log(`✅ FRS API Success: ${data.results?.length || 0} items`)
    
    return NextResponse.json(data)
    
  } catch (error) {
    console.error('❌ Proxy error:', error)
    if (error instanceof Error) {
      console.error('❌ Error details:', error.message, error.stack)
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal proxy error' },
      { status: 500 }
    )
  }
}
