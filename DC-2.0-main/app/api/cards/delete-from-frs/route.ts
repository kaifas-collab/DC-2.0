import { NextRequest, NextResponse } from 'next/server'
import DBService from '@/lib/dbService'
import { getServerConfig } from '@/config/serverConfig'
import axios from 'axios'
import fs from 'fs'
import path from 'path'

export async function POST(request: NextRequest) {
  const CONFIG = getServerConfig()
  try {
    const body = await request.json()
    const { server_url, card_id } = body

    if (!server_url || !card_id) {
      return NextResponse.json(
        { success: false, error: 'Missing server_url or card_id' },
        { status: 400 }
      )
    }

    // Find the server configuration
    const server = CONFIG.servers.find(s => s.baseURL === server_url)
    
    if (!server) {
      return NextResponse.json(
        { success: false, error: 'Server configuration not found' },
        { status: 404 }
      )
    }

    // Get the card details before deleting
    const allCards = DBService.getAllCards()
    const cardToDelete = allCards.find(
      c => c.server_url === server_url && c.card_id === card_id
    )

    if (!cardToDelete) {
      return NextResponse.json(
        { success: false, error: 'Card not found in local database' },
        { status: 404 }
      )
    }

    // Step 1: Delete from FRS server
    let frsDeleteSuccess = false
    let frsDeleteError = null

    try {
      const frsDeleteUrl = `${server_url}cards/humans/${card_id}/`
      console.log(`Attempting to delete card from FRS: ${frsDeleteUrl}`)

      const response = await axios.delete(frsDeleteUrl, {
        headers: {
          'Authorization': `Token ${server.token}`
        },
        timeout: 10000 // 10 second timeout
      })

      console.log(`FRS delete response status: ${response.status}`)
      frsDeleteSuccess = true
    } catch (error) {
      console.error('Error deleting from FRS server:', error)
      
      if (axios.isAxiosError(error)) {
        if (error.response) {
          frsDeleteError = `FRS server returned ${error.response.status}: ${error.response.statusText}`
        } else if (error.code === 'ECONNABORTED') {
          frsDeleteError = 'FRS server request timeout'
        } else {
          frsDeleteError = `FRS server connection error: ${error.message}`
        }
      } else {
        frsDeleteError = 'Unknown error deleting from FRS server'
      }

      // Don't fail the whole operation - continue to delete locally
      console.warn(`FRS deletion failed but continuing with local deletion: ${frsDeleteError}`)
    }

    // Step 2: Delete from local database
    const localDeleteSuccess = DBService.deleteCard(server_url, card_id)

    if (!localDeleteSuccess) {
      return NextResponse.json(
        { 
          success: false, 
          error: 'Failed to delete from local database',
          frsDeleted: frsDeleteSuccess,
          frsError: frsDeleteError
        },
        { status: 500 }
      )
    }

    // Step 3: Delete local image files
    let imageDeletedCount = 0
    if (cardToDelete.photo && cardToDelete.photo.startsWith('/uploads/')) {
      try {
        const imagePath = path.join(process.cwd(), 'public', cardToDelete.photo)
        if (fs.existsSync(imagePath)) {
          fs.unlinkSync(imagePath)
          imageDeletedCount++
          console.log(`Deleted image file: ${imagePath}`)
        }
      } catch (error) {
        console.error('Error deleting image file:', error)
        // Don't fail the whole operation
      }
    }

    // Return success with detailed information
    return NextResponse.json({
      success: true,
      message: frsDeleteSuccess 
        ? 'Card deleted from both FRS server and local database'
        : 'Card deleted from local database only (FRS deletion failed)',
      deletedCard: {
        server_url,
        card_id,
        name: cardToDelete.name
      },
      operations: {
        frsDeleted: frsDeleteSuccess,
        frsError: frsDeleteError,
        localDeleted: localDeleteSuccess,
        imagesDeleted: imageDeletedCount
      }
    })
  } catch (error) {
    console.error('Error in delete-from-frs endpoint:', error)
    return NextResponse.json(
      { 
        success: false, 
        error: 'Failed to delete card',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}
