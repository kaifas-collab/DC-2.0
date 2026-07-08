import { NextRequest, NextResponse } from 'next/server'
import DBService from '@/lib/dbService'

// GET /api/cards - Get all cards or search
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const query = searchParams.get('search')
    const serverName = searchParams.get('server')
    const limit = Math.min(parseInt(searchParams.get('limit') || '1000', 10), 5000)
    const page = Math.max(parseInt(searchParams.get('page') || '1', 10), 1)
    const offset = (page - 1) * limit

    let cards
    let total: number

    if (query) {
      cards = DBService.searchCards(query, limit, offset)
      total = DBService.searchCardsCount(query)
    } else if (serverName) {
      cards = DBService.getCardsByServerName(serverName)
      total = DBService.getCardCountByServerName(serverName)
    } else {
      cards = DBService.getAllCards(limit, offset)
      total = DBService.getTotalCardCount()
    }

    return NextResponse.json({
      success: true,
      data: cards,
      count: cards.length,
      total,
      page,
      limit,
    })
  } catch (error) {
    console.error('Error fetching cards:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to fetch cards' },
      { status: 500 }
    )
  }
}
