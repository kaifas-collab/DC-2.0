import { NextRequest, NextResponse } from 'next/server'
import DBService from '@/lib/dbService'
import { getServerConfig } from '@/config/serverConfig'
import fs from 'fs'
import path from 'path'
import axios from 'axios'

interface DeleteRequest {
  server_url: string
  card_id: string
}

export async function POST(request: NextRequest) {
  const CONFIG = getServerConfig()
  try {
    const body = await request.json()
    const { cards, deleteFromFRS = false } = body as { 
      cards: DeleteRequest[], 
      deleteFromFRS?: boolean 
    }

    if (!cards || !Array.isArray(cards) || cards.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Missing or invalid cards array' },
        { status: 400 }
      )
    }

    const results = {
      successful: [] as DeleteRequest[],
      failed: [] as { card: DeleteRequest, error: string }[],
      frsDeleted: [] as DeleteRequest[],
      frsFailed: [] as { card: DeleteRequest, error: string }[]
    }

    // Get all cards before deletion to find images
    const allCards = DBService.getAllCards()

    for (const cardToDelete of cards) {
      const { server_url, card_id } = cardToDelete

      if (!server_url || !card_id) {
        results.failed.push({
          card: cardToDelete,
          error: 'Missing server_url or card_id'
        })
        continue
      }

      try {
        // If deleteFromFRS is true, delete from FRS server first
        if (deleteFromFRS) {
          try {
            // Find the server configuration
            const serverConfig = CONFIG.servers.find(s => s.baseURL === server_url)
            
            if (!serverConfig) {
              throw new Error('Server configuration not found')
            }

            // Delete from FRS server
            const frsUrl = `${server_url}cards/humans/${card_id}/`
            await axios.delete(frsUrl, {
              headers: {
                'Authorization': `Token ${serverConfig.token}`
              },
              timeout: 10000
            })

            results.frsDeleted.push(cardToDelete)
          } catch (frsError: any) {
            console.error(`Failed to delete from FRS server: ${server_url}${card_id}`, frsError)
            results.frsFailed.push({
              card: cardToDelete,
              error: frsError.message || 'FRS deletion failed'
            })
            // Continue with local deletion even if FRS deletion fails
          }
        }

        // Find the card details for image cleanup
        const cardData = allCards.find(
          c => c.server_url === server_url && c.card_id === card_id
        )

        // Delete from local database
        const deleted = DBService.deleteCard(server_url, card_id)

        if (!deleted) {
          results.failed.push({
            card: cardToDelete,
            error: 'Card not found in database'
          })
          continue
        }

        // Try to delete associated image files
        if (cardData?.photo && cardData.photo.startsWith('/uploads/')) {
          try {
            const imagePath = path.join(process.cwd(), 'public', cardData.photo)
            if (fs.existsSync(imagePath)) {
              fs.unlinkSync(imagePath)
              console.log(`Deleted image file: ${imagePath}`)
            }
          } catch (error) {
            console.error('Error deleting image file:', error)
            // Don't fail the whole operation if image deletion fails
          }
        }

        results.successful.push(cardToDelete)
      } catch (error: any) {
        console.error(`Error deleting card ${card_id}:`, error)
        results.failed.push({
          card: cardToDelete,
          error: error.message || 'Unknown error'
        })
      }
    }

    const allSuccessful = results.failed.length === 0 && 
                          (!deleteFromFRS || results.frsFailed.length === 0)

    return NextResponse.json({
      success: allSuccessful,
      message: `Deleted ${results.successful.length} of ${cards.length} cards`,
      results: {
        total: cards.length,
        localDeleted: results.successful.length,
        localFailed: results.failed.length,
        frsDeleted: results.frsDeleted.length,
        frsFailed: results.frsFailed.length,
        details: {
          successful: results.successful,
          failed: results.failed,
          frsDeleted: results.frsDeleted,
          frsFailed: results.frsFailed
        }
      }
    }, { status: allSuccessful ? 200 : 207 }) // 207 Multi-Status for partial success
  } catch (error) {
    console.error('Error in bulk delete:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to process bulk delete' },
      { status: 500 }
    )
  }
}
