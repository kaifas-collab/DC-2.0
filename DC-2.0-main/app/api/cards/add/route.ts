import { NextRequest, NextResponse } from 'next/server'
import { getServerConfig } from '@/config/serverConfig'
import FormData from 'form-data'
import axios from 'axios'

// POST /api/cards/add - Add a new card to one or more servers
export async function POST(request: NextRequest) {
  const CONFIG = getServerConfig()
  try {
    const formData = await request.formData()
    const name = formData.get('name') as string
    const watchlistsByServerStr = formData.get('watchlistsByServer') as string  // Per-server watchlists
    const servers = formData.get('servers') as string // JSON array string
    const photo = formData.get('photo') as File

    if (!name || !servers) {
      return NextResponse.json(
        { success: false, error: 'Name and servers are required' },
        { status: 400 }
      )
    }

    const watchlistsByServer: Record<string, number[]> = watchlistsByServerStr ? JSON.parse(watchlistsByServerStr) : {}
    const serverNames = JSON.parse(servers) as string[]

    if (serverNames.length === 0) {
      return NextResponse.json(
        { success: false, error: 'At least one server must be selected' },
        { status: 400 }
      )
    }

    // Process each server
    const results = await Promise.allSettled(
      serverNames.map(async (serverName) => {
        // Find server config
        const server = CONFIG.servers.find(s => s.name === serverName)
        if (!server) {
          throw new Error(`Server ${serverName} not found in configuration`)
        }

        try {
          // Get watchlist IDs for this specific server
          const serverWatchlistIds = watchlistsByServer[serverName] || []
          
          console.log(`📋 ${serverName}: Will use watchlists:`, serverWatchlistIds)

          // Step 1: Create the card with this server's watchlists
          const createCardUrl = `${server.baseURL}${CONFIG.apiEndpoints.cards}`
          const cardData = {
            active: true,
            name: name,
            comment: '',
            watch_lists: serverWatchlistIds,  // Use this server's watchlists directly
          }

          console.log(`📤 Creating card on ${serverName}:`, createCardUrl)
          
          const cardResponse = await axios.post(createCardUrl, cardData, {
            headers: {
              'Accept': 'application/json',
              'Authorization': `Token ${server.token}`,
              'Content-Type': 'application/json',
            },
            timeout: 15000,
          })

          const cardId = cardResponse.data.id
          console.log(`✅ Card created on ${serverName} with ID: ${cardId}`)

          // Step 2: Upload photo if provided
          let photoUploaded = false
          if (photo && photo.size > 0) {
            try {
              const uploadUrl = `${server.baseURL}${CONFIG.apiEndpoints.faces}`
              
              // Convert File to Buffer
              const arrayBuffer = await photo.arrayBuffer()
              const buffer = Buffer.from(arrayBuffer)
              
              // Create form data for image upload
              const imageFormData = new FormData()
              imageFormData.append('source_photo', buffer, {
                filename: photo.name,
                contentType: photo.type,
              })
              imageFormData.append('card', cardId.toString())

              console.log(`📸 Uploading photo to ${serverName} for card ${cardId}`)

              await axios.post(uploadUrl, imageFormData, {
                headers: {
                  'Accept': 'application/json',
                  'Authorization': `Token ${server.token}`,
                  ...imageFormData.getHeaders(),
                },
                timeout: 30000,
              })

              photoUploaded = true
              console.log(`✅ Photo uploaded to ${serverName} for card ${cardId}`)
            } catch (uploadError) {
              console.error(`⚠️ Photo upload failed for ${serverName}:`, uploadError)
              // Don't fail the entire operation if photo upload fails
            }
          }

          return {
            server: serverName,
            cardId: cardId,
            photoUploaded: photoUploaded,
            watchlistsAdded: serverWatchlistIds,
            success: true,
          }
        } catch (error) {
          console.error(`❌ Error adding card to ${serverName}:`, error)
          
          // Provide more specific error message
          if (axios.isAxiosError(error)) {
            if (error.response?.status === 403) {
              throw new Error(`Forbidden - selected watchlist(s) may not exist on this server`)
            } else if (error.response?.status === 400) {
              throw new Error(`Bad request - ${error.response?.data?.detail || 'invalid data'}`)
            } else {
              throw new Error(error.message || 'Failed to add card')
            }
          }
          throw error
        }
      })
    )

    // Analyze results
    const successful = results.filter(r => r.status === 'fulfilled')
    const failed = results.filter(r => r.status === 'rejected')

    const successDetails = successful.map((r: any) => r.value)
    const failDetails = failed.map((r: any) => ({
      server: r.reason?.message || 'Unknown',
      error: r.reason?.message || 'Failed to add card',
    }))

    // Determine response status
    if (successful.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'Failed to add card to any server',
          details: failDetails,
        },
        { status: 500 }
      )
    }

    if (failed.length > 0) {
      // Partial success
      return NextResponse.json(
        {
          success: true,
          message: `Card added to ${successful.length} of ${results.length} servers`,
          results: {
            successful: successDetails,
            failed: failDetails,
            total: results.length,
            successCount: successful.length,
            failCount: failed.length,
          },
        },
        { status: 207 } // Multi-Status
      )
    }

    // Complete success
    return NextResponse.json({
      success: true,
      message: `Card "${name}" added successfully to ${successful.length} server(s)`,
      results: {
        successful: successDetails,
        failed: [],
        total: results.length,
        successCount: successful.length,
        failCount: 0,
      },
    })
  } catch (error) {
    console.error('Error in add card API:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
