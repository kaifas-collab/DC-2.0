import { NextRequest, NextResponse } from 'next/server'
import axios from 'axios'
import { getServerConfig } from '@/config/serverConfig'
import DBService from '@/lib/dbService'
import type { UnifiedCardData } from '@/lib/types'
import fs from 'fs'
import path from 'path'
import { exec } from 'child_process'
import { promisify } from 'util'
import { getServerByName } from '@/lib/sync/registry'
import { classify } from '@/lib/sync/detector'
import { advanceCursor, markFullScan } from '@/lib/sync/cursors'
import { planFromClassification } from '@/lib/sync/planner'
import { detectOriginDeletes, detectReplicaDeletes } from '@/lib/sync/deletion'

const execAsync = promisify(exec)

// Helper function to sanitize filename
function sanitizeFilename(name: string): string {
  return name
    .replace(/[^a-z0-9_-]/gi, '_') // Replace invalid chars with underscore
    .replace(/_+/g, '_') // Replace multiple underscores with single
    .toLowerCase()
}

// Helper function to download and save image using curl (async, non-blocking)
async function downloadImage(url: string, cardName: string, cardId: string): Promise<string | null> {
  try {
    if (!url || url.startsWith('/placeholder')) {
      return null
    }

    // Get file extension from URL or default to jpg
    const ext = path.extname(url).split('?')[0] || '.jpg'
    const sanitizedName = sanitizeFilename(cardName)
    const filename = `${sanitizedName}-${cardId}${ext}`
    const uploadDir = path.join(process.cwd(), 'public', 'uploads')
    const filePath = path.join(uploadDir, filename)

    // Skip download if file already exists and has content
    if (fs.existsSync(filePath) && fs.statSync(filePath).size > 0) {
      return `/uploads/${filename}`
    }

    // Ensure directory exists
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true })
    }

    // Download image using curl (async, non-blocking)
    // -o: output file
    // --connect-timeout: connection timeout in seconds
    // --max-time: maximum time for the entire operation
    // -s: silent mode (no progress bar)
    // -f: fail silently on HTTP errors
    await execAsync(`curl -o "${filePath}" "${url}" --connect-timeout 5 --max-time 15 -s -f`)

    // Verify file was downloaded and has content
    if (!fs.existsSync(filePath) || fs.statSync(filePath).size === 0) {
      throw new Error('Downloaded file is empty or does not exist')
    }

    // Return public URL
    return `/uploads/${filename}`
  } catch (error) {
    console.error(`Failed to download image for ${cardName}:`, error instanceof Error ? error.message : 'Unknown')
    return null
  }
}

// POST /api/sync - Manually trigger sync from all FRS servers  
export async function POST(request: NextRequest) {
  const CONFIG = getServerConfig()
  try {
    console.log('🔄 Manual sync triggered...')
    
    const results = await Promise.allSettled(
      CONFIG.servers.map(async (server) => {
        try {
          DBService.updateSyncStatus(server.baseURL, server.name, 'syncing')

          // Fetch ALL cards with pagination - no hardcoded limit
          const baseURL = request.nextUrl.origin
          let rawCards: any[] = []
          let nextUrl: string | null = `${CONFIG.apiEndpoints.cards}?limit=10000`  // Start with 10000 per page
          let pageCount = 0
          
          console.log(`📥 Fetching all cards from ${server.name}...`)
          
          while (nextUrl) {
            pageCount++
            const cardsResponse: any = await axios.post(`${baseURL}/api/frs`, {
              serverName: server.name,
              endpoint: nextUrl,
            }, { timeout: 30000 })  // Increased timeout for large pages

            const pageResults = cardsResponse.data?.results || []
            rawCards = rawCards.concat(pageResults)
            
            // Check if there's a next page - FRS API uses 'next_page' not 'next'
            nextUrl = cardsResponse.data?.next_page || null
            
            console.log(`📄 Page ${pageCount}: Fetched ${pageResults.length} cards (Total: ${rawCards.length}), Next page: ${nextUrl ? 'YES' : 'NO'}`)
            
            // If next is a full URL, extract just the path and query
            if (nextUrl && nextUrl.startsWith('http')) {
              const url: any = new URL(nextUrl)
              nextUrl = url.pathname + url.search
              console.log(`🔗 Next page path: ${nextUrl}`)
            }
            
            // No artificial page limit - fetch all cards
          }
          
          console.log(`✅ Total cards fetched from ${server.name}: ${rawCards.length}`)
          
          // Fetch ALL watchlists with pagination
          let watchlistsMap: Record<number, string> = {}
          try {
            let allWatchlists: any[] = []
            let watchlistNextUrl: string | null = CONFIG.apiEndpoints.watchlists
            let watchlistPageCount = 0
            
            while (watchlistNextUrl) {
              watchlistPageCount++
              const watchlistsResponse: any = await axios.post(`${baseURL}/api/frs`, {
                serverName: server.name,
                endpoint: watchlistNextUrl,
              }, { timeout: 10000 })
              
              const pageWatchlists = watchlistsResponse.data?.results || []
              allWatchlists = allWatchlists.concat(pageWatchlists)
              
              // FRS API uses 'next_page' not 'next'
              watchlistNextUrl = watchlistsResponse.data?.next_page || null
              
              if (watchlistNextUrl && watchlistNextUrl.startsWith('http')) {
                const url: any = new URL(watchlistNextUrl)
                watchlistNextUrl = url.pathname + url.search
              }
              
              // No artificial limit on watchlist pages either
            }
            
            watchlistsMap = allWatchlists.reduce((acc: Record<number, string>, wl: any) => {
              acc[wl.id] = wl.name
              return acc
            }, {})
            console.log(`📋 Fetched ${allWatchlists.length} watchlists from ${server.name}`)
          } catch (error) {
            console.warn(`⚠️ Failed to fetch watchlists from ${server.name}:`, error instanceof Error ? error.message : 'Unknown')
          }
          
          // Fetch face for each card in batches to avoid overwhelming the server
          const BATCH_SIZE = 20  // Process 20 cards at a time
          const cardsWithPhotos = []
          
          for (let i = 0; i < rawCards.length; i += BATCH_SIZE) {
            const batch = rawCards.slice(i, i + BATCH_SIZE)
            console.log(`📸 Processing images for cards ${i + 1}-${Math.min(i + BATCH_SIZE, rawCards.length)} of ${rawCards.length}`)
            
            const batchResults = await Promise.all(
              batch.map(async (card: any) => {
                try {
                  // Check if card already has face URLs (some APIs include them in card response)
                  if (card.thumbnail || card.photo) {
                    const thumbnailUrl = card.thumbnail || card.photo
                    const fullUrl = card.source_photo || card.photo
                    
                    // Build full URLs
                    const fullThumbnailUrl = thumbnailUrl.startsWith('http') 
                      ? thumbnailUrl 
                      : `${server.baseURL}${thumbnailUrl.startsWith('/') ? thumbnailUrl.slice(1) : thumbnailUrl}`
                    const fullPhotoUrl = fullUrl.startsWith('http') 
                      ? fullUrl 
                      : `${server.baseURL}${fullUrl.startsWith('/') ? fullUrl.slice(1) : fullUrl}`
                    
                    // Download images
                    const downloadedThumb = await downloadImage(fullThumbnailUrl, card.name, card.id)
                    const downloadedFull = await downloadImage(fullPhotoUrl, card.name, `${card.id}-full`)
                    
                    return {
                      ...card,
                      thumbnail: downloadedThumb || fullThumbnailUrl,
                      source_photo: downloadedFull || fullPhotoUrl,
                    }
                  }
                  
                  // Fetch faces for this specific card
                  const facesResponse = await axios.post(`${baseURL}/api/frs`, {
                    serverName: server.name,
                    endpoint: `${CONFIG.apiEndpoints.faces}?card=${card.id}`,
                  }, { timeout: 10000 })
                  
                  const faces = facesResponse.data?.results || []
                  const face = faces.length > 0 ? faces[0] : null
                  
                  // Download and save images locally
                  let localThumbnail = '/placeholder-user.jpg'
                  let localFullframe = '/placeholder.jpg'
                  
                  if (face?.thumbnail) {
                    // Build full URL if needed
                    const thumbnailUrl = face.thumbnail.startsWith('http') 
                      ? face.thumbnail 
                      : `${server.baseURL}${face.thumbnail.startsWith('/') ? face.thumbnail.slice(1) : face.thumbnail}`
                    
                    // Download and save locally
                    const downloaded = await downloadImage(thumbnailUrl, card.name, card.id)
                    localThumbnail = downloaded || thumbnailUrl
                  }
                  
                  if (face?.source_photo) {
                    // Build full URL if needed
                    const sourcePhotoUrl = face.source_photo.startsWith('http')
                      ? face.source_photo
                      : `${server.baseURL}${face.source_photo.startsWith('/') ? face.source_photo.slice(1) : face.source_photo}`
                    
                    // Download and save locally
                    const downloaded = await downloadImage(sourcePhotoUrl, card.name, `${card.id}-full`)
                    localFullframe = downloaded || sourcePhotoUrl
                  }
                  
                  return {
                    ...card,
                    thumbnail: localThumbnail,
                    source_photo: localFullframe,
                  }
                } catch (error) {
                  // Silently use placeholder for cards without faces
                  return {
                    ...card,
                    thumbnail: '/placeholder-user.jpg',
                    source_photo: '/placeholder.jpg',
                  }
                }
              })
            )
            
            cardsWithPhotos.push(...batchResults)
          }
          
          console.log(`✅ Processed ${cardsWithPhotos.length} cards with images`)
          
          const cards: UnifiedCardData[] = cardsWithPhotos.map((card: any) => {
            // Get watchlist names from the watch_lists array
            const watchlistNames = card.watch_lists && Array.isArray(card.watch_lists)
              ? card.watch_lists
                  .map((id: number) => watchlistsMap[id])
                  .filter(Boolean)
                  .join(', ')
              : ''
            
            return {
              card_id: String(card.id),
              server_url: server.baseURL,
              server_name: server.name,
              server_location: server.location,
              name: card.name || 'Unknown',
              thumbnail_url: card.thumbnail,
              fullframe_url: card.source_photo,
              watchlist_name: watchlistNames,
              last_updated: new Date().toISOString(),
              photo: card.thumbnail,
              confidence: card.confidence,
              lists: card.watch_lists,
              active: card.active,
              watches: card.watch_lists,
              created_date: card.created_date,
              acknowledged: card.acknowledged,
              on_lists: card.watch_lists,
              galleries: card.galleries,
            }
          })

          // Save to database (with sync logic to remove deleted cards)
          DBService.syncServerCards(server.baseURL, cards)

          // Sync engine (Module 3): classify each downloaded card through the recursion firewall.
          // Wrapped so a sync-engine issue never regresses the existing dashboard sync above.
          try {
            const serverRow = getServerByName(server.name)
            if (!serverRow) {
              console.warn(
                `⚠️ Sync engine: no registry entry for ${server.name} - run POST /api/sync-engine/registry first`
              )
            } else {
              let maxModifiedSeen: string | null = null
              const currentCardIds = new Set<string>()
              for (const rawCard of cardsWithPhotos) {
                const cardId = String(rawCard.id)
                currentCardIds.add(cardId)
                const modifiedDate = rawCard.modified_date || rawCard.created_date || null
                const outcome = classify(serverRow, {
                  originCardId: cardId,
                  name: rawCard.name || 'Unknown',
                  active: Boolean(rawCard.active),
                  watchlistLocalIds: Array.isArray(rawCard.watch_lists) ? rawCard.watch_lists : [],
                  modifiedDate,
                  photoPath: rawCard.thumbnail || null,
                  stampedGlobalUuid: CONFIG.sync?.stampMetadata ? rawCard.meta?.dc_global_key || null : null,
                })
                planFromClassification(outcome)
                if (modifiedDate && (!maxModifiedSeen || modifiedDate > maxModifiedSeen)) {
                  maxModifiedSeen = modifiedDate
                }
              }
              advanceCursor(serverRow.server_uuid, maxModifiedSeen)
              markFullScan(serverRow.server_uuid)

              // Module 6: full-scan diff for deletes, in both directions.
              const originDeletes = detectOriginDeletes(serverRow, currentCardIds)
              const replicaDeletes = detectReplicaDeletes(serverRow, currentCardIds)
              if (originDeletes > 0 || replicaDeletes > 0) {
                console.log(
                  `🗑️ Sync engine: ${server.name} - ${originDeletes} origin delete(s) detected, ${replicaDeletes} replica delete(s) detected`
                )
              }
            }
          } catch (classifyError) {
            console.error(`❌ Sync engine classification failed for ${server.name}:`, classifyError)
          }

          DBService.updateSyncStatus(
            server.baseURL, 
            server.name, 
            'success', 
            undefined, 
            cards.length
          )

          console.log(`✅ Synced ${cards.length} cards from ${server.name}`)
          return { server: server.name, count: cards.length }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error'
          console.error(`❌ Error syncing ${server.name}:`, errorMessage)
          
          DBService.updateSyncStatus(
            server.baseURL, 
            server.name, 
            'error', 
            errorMessage
          )

          throw error
        }
      })
    )

    const successful = results.filter(r => r.status === 'fulfilled').length
    const failed = results.filter(r => r.status === 'rejected').length
    const totalCards = DBService.getTotalCardCount()

    return NextResponse.json({
      success: true,
      message: 'Sync completed',
      stats: {
        successful,
        failed,
        totalCards,
      },
      results,
    })
  } catch (error) {
    console.error('Error during sync:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to sync' },
      { status: 500 }
    )
  }
}

// GET /api/sync - Get sync status
export async function GET() {
  try {
    const syncStatuses = DBService.getAllSyncStatus()
    const stats = DBService.getStats()

    return NextResponse.json({
      success: true,
      data: {
        syncStatuses,
        stats,
      },
    })
  } catch (error) {
    console.error('Error fetching sync status:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to fetch sync status' },
      { status: 500 }
    )
  }
}
