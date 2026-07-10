import { NextRequest, NextResponse } from 'next/server'
import {
  getLogicalCards,
  getLogicalCardsCount,
  searchLogicalCards,
  searchLogicalCardsCount,
} from '@/lib/logicalCards'

// GET /api/logical-cards - one row per real-world person (deduplicated across every server that
// holds a copy). See lib/logicalCards.ts. /api/cards stays as the physical per-placement view for
// internal/debug use.
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const query = searchParams.get('search')?.trim() || ''
    const limit = Math.min(parseInt(searchParams.get('limit') || '1000', 10), 5000)
    const page = Math.max(parseInt(searchParams.get('page') || '1', 10), 1)
    const offset = (page - 1) * limit

    const cards = query ? searchLogicalCards(query, limit, offset) : getLogicalCards(limit, offset)
    const total = query ? searchLogicalCardsCount(query) : getLogicalCardsCount()

    return NextResponse.json({
      success: true,
      data: cards,
      count: cards.length,
      total,
      page,
      limit,
    })
  } catch (error) {
    console.error('Error fetching logical cards:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to fetch cards' },
      { status: 500 }
    )
  }
}
