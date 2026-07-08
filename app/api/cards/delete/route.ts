import { NextRequest, NextResponse } from 'next/server'
import DBService from '@/lib/dbService'
import fs from 'fs'
import path from 'path'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { server_url, card_id } = body

    if (!server_url || !card_id) {
      return NextResponse.json(
        { success: false, error: 'Missing server_url or card_id' },
        { status: 400 }
      )
    }

    // Get the card details before deleting to find image files
    const allCards = DBService.getAllCards()
    const cardToDelete = allCards.find(
      c => c.server_url === server_url && c.card_id === card_id
    )

    // Delete the card from database
    const deleted = DBService.deleteCard(server_url, card_id)

    if (!deleted) {
      return NextResponse.json(
        { success: false, error: 'Card not found' },
        { status: 404 }
      )
    }

    // Try to delete associated image files (if they exist locally)
    if (cardToDelete?.photo && cardToDelete.photo.startsWith('/uploads/')) {
      try {
        const imagePath = path.join(process.cwd(), 'public', cardToDelete.photo)
        if (fs.existsSync(imagePath)) {
          fs.unlinkSync(imagePath)
          console.log(`Deleted image file: ${imagePath}`)
        }
      } catch (error) {
        console.error('Error deleting image file:', error)
        // Don't fail the whole operation if image deletion fails
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Card deleted successfully',
      deletedCard: {
        server_url,
        card_id
      }
    })
  } catch (error) {
    console.error('Error deleting card:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to delete card' },
      { status: 500 }
    )
  }
}
