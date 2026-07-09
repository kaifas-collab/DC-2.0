import { NextResponse } from 'next/server'
import { reconcileAllPlacements } from '@/lib/sync/planner'

// POST /api/sync-engine/placements/reconcile - full planner sweep over every active global card.
// Catches drift the reactive per-card path (wired into /api/sync) can't see on its own: a server
// enabled after a card already propagated, or a fan-out interrupted mid-way by a crash.
export async function POST() {
  try {
    const results = reconcileAllPlacements()

    const summary = {
      cardsProcessed: results.length,
      placementsCreated: results.reduce((sum, r) => sum + r.createdPlacements, 0),
      placementsRestaled: results.reduce((sum, r) => sum + r.restaledPlacements, 0),
    }

    return NextResponse.json({ success: true, message: 'Reconciliation complete', data: summary })
  } catch (error) {
    console.error('Error reconciling placements:', error)
    return NextResponse.json({ success: false, error: 'Failed to reconcile placements' }, { status: 500 })
  }
}
