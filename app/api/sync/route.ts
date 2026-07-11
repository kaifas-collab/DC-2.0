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
import { isSyncPaused } from '@/lib/sync/pause'
import logger from '@/lib/logger'

const execAsync = promisify(exec)

// Helper function to sanitize filename
function sanitizeFilename(name: string): string {
  return name
    .replace(/[^a-z0-9_-]/gi, '_') // Replace invalid chars with underscore
    .replace(/_+/g, '_') // Replace multiple underscores with single
    .toLowerCase()
}

// FRS needs a few seconds after a photo upload to run face-detection and populate the face
// object's `thumbnail` field. When a card is freshly created on an FRS server and the DC's download
// runs shortly after, it can race that processing: the face record exists but has no thumbnail yet,
// so it would otherwise get cached as a permanent placeholder (nothing re-triggers a re-check since
// the file "already downloaded" logic only guards against re-downloading, not against never having
// tried). Only worth the retry cost for genuinely recent cards - an old card with no thumbnail
// almost certainly just never had a photo uploaded.
const RECENT_CARD_WINDOW_MS = 2 * 60 * 1000
const THUMBNAIL_RETRY_DELAY_MS = 2000

async function fetchFaceForCard(
  baseURL: string,
  serverName: string,
  facesEndpoint: string,
  cardId: string | number,
  cardCreatedDate: string | null | undefined
): Promise<any | null> {
  const isRecent = Boolean(cardCreatedDate) && Date.now() - new Date(cardCreatedDate as string).getTime() < RECENT_CARD_WINDOW_MS
  const maxAttempts = isRecent ? 3 : 1

  let lastFace: any | null = null
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const facesResponse = await axios.post(`${baseURL}/api/frs`, {
      serverName,
      endpoint: `${facesEndpoint}?card=${cardId}`,
    }, { timeout: 10000 })

    const faces = facesResponse.data?.results || []
    lastFace = faces.length > 0 ? faces[0] : null

    if (lastFace?.thumbnail) {
      return lastFace
    }

    if (attempt < maxAttempts) {
      logger.info('sync.download', `Card ${cardId} on ${serverName} has no thumbnail yet (attempt ${attempt}/${maxAttempts}), FRS may still be processing the photo - retrying shortly`, {
        server: serverName,
        cardId,
      })
      await new Promise((resolve) => setTimeout(resolve, THUMBNAIL_RETRY_DELAY_MS))
    }
  }

  return lastFace
}

// Picks the image the sync engine will re-upload to mirror servers to recreate the face.
// Two rules, both learned from mirrored cards arriving with no photo:
//   1. Prefer the full source_photo over the cropped thumbnail - FRS needs a real photo to detect
//      a face in; a tiny thumbnail is often rejected on the destination.
//   2. Only ever return a locally-downloaded /uploads/ path. A remote URL or a placeholder means
//      "no usable image yet" and must be null - otherwise image_hash gets computed from the
//      placeholder string and looks like a real image that the worker then never actually uploads
//      (it can only upload files under /uploads/), permanently masking the card as "has image".
function pickSyncablePhoto(card: any): string | null {
  for (const candidate of [card.source_photo, card.thumbnail]) {
    if (typeof candidate === 'string' && candidate.startsWith('/uploads/')) {
      return candidate
    }
  }
  return null
}

// Display-only counterpart to pickSyncablePhoto: the DC dashboard's card grid/drawer should load
// the small cropped thumbnail, not the full source photo pickSyncablePhoto prefers for FRS uploads
// (a dense grid loading full-resolution images is wasteful bandwidth/render cost). Never used for
// anything pushed to FRS - see thumbnail_ref's column comment in schema.ts.
function pickSyncableThumbnail(card: any): string | null {
  return typeof card.thumbnail === 'string' && card.thumbnail.startsWith('/uploads/') ? card.thumbnail : null
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
    // A DC cluster-delete is in flight - refuse to download/reconcile until every placement of the
    // deleted card(s) has finished, so this sync pass can't restore something being intentionally
    // removed. Force Refresh returns this same 409 to the UI (see components/_comps/DashboardPage.tsx).
    if (isSyncPaused()) {
      logger.warn('sync.pause', 'Sync request refused - a cluster delete is in progress')
      return NextResponse.json(
        { success: false, paused: true, error: 'Sync is paused while a delete is in progress' },
        { status: 409 }
      )
    }

    console.log('🔄 Manual sync triggered...')

    const results = await Promise.allSettled(
      CONFIG.servers.map(async (server) => {
        const syncStartedAt = Date.now()
        try {
          DBService.updateSyncStatus(server.baseURL, server.name, 'syncing')

          // Fetch ALL cards with pagination - no hardcoded limit
          const baseURL = request.nextUrl.origin
          let rawCards: any[] = []
          let nextUrl: string | null = `${CONFIG.apiEndpoints.cards}?limit=10000`  // Start with 10000 per page
          let pageCount = 0
          let reportedCount: number | null = null

          logger.info('sync.download', `Fetching all cards from ${server.name}...`, { server: server.name })

          while (nextUrl) {
            pageCount++
            const cardsResponse: any = await axios.post(`${baseURL}/api/frs`, {
              serverName: server.name,
              endpoint: nextUrl,
            }, { timeout: 30000 })  // Increased timeout for large pages

            const pageResults = cardsResponse.data?.results || []
            rawCards = rawCards.concat(pageResults)
            if (typeof cardsResponse.data?.count === 'number') {
              reportedCount = cardsResponse.data.count
            }

            // Check if there's a next page - FRS API uses 'next_page' not 'next'
            nextUrl = cardsResponse.data?.next_page || null

            logger.info('sync.download', `Page ${pageCount} for ${server.name}: fetched ${pageResults.length} cards (running total ${rawCards.length}${reportedCount !== null ? ` of ${reportedCount} reported by server` : ''}), next page: ${nextUrl ? 'yes' : 'no'}`, {
              server: server.name,
              page: pageCount,
              pageSize: pageResults.length,
              runningTotal: rawCards.length,
              serverReportedCount: reportedCount,
            })

            // If next is a full URL, extract just the path and query
            if (nextUrl && nextUrl.startsWith('http')) {
              const url: any = new URL(nextUrl)
              nextUrl = url.pathname + url.search
            }

            // No artificial page limit - fetch all cards
          }

          if (reportedCount !== null && reportedCount !== rawCards.length) {
            logger.warn('sync.download', `Gap detected for ${server.name}: server reports ${reportedCount} total card(s) but only ${rawCards.length} were fetched via pagination`, {
              server: server.name,
              serverReportedCount: reportedCount,
              fetchedCount: rawCards.length,
              gap: reportedCount - rawCards.length,
            })
          }

          logger.info('sync.download', `Total cards fetched from ${server.name}: ${rawCards.length} across ${pageCount} page(s)`, { server: server.name, totalFetched: rawCards.length, pages: pageCount })
          
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
                  
                  // Fetch face for this specific card, with a short retry if it was just
                  // created and FRS hasn't finished generating the thumbnail yet.
                  const face = await fetchFaceForCard(baseURL, server.name, CONFIG.apiEndpoints.faces, card.id, card.created_date)

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
          
          const placeholderCount = cardsWithPhotos.filter(
            (c: any) => c.thumbnail === '/placeholder-user.jpg' || c.source_photo === '/placeholder.jpg'
          ).length
          logger.info('sync.download', `Processed ${cardsWithPhotos.length} cards with images for ${server.name} (${placeholderCount} using placeholder - no face/thumbnail available yet)`, {
            server: server.name,
            processed: cardsWithPhotos.length,
            placeholderCount,
          })
          
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
              comment: card.comment || '',
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
              logger.warn('sync.engine', `No registry entry for ${server.name} - run POST /api/sync-engine/registry first`, { server: server.name })
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
                  photoPath: pickSyncablePhoto(rawCard),
                  thumbnailPath: pickSyncableThumbnail(rawCard),
                  comment: rawCard.comment || '',
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
                logger.info('sync.engine', `${server.name}: ${originDeletes} origin delete(s) detected, ${replicaDeletes} replica delete(s) detected`, {
                  server: server.name,
                  originDeletes,
                  replicaDeletes,
                })
              }
            }
          } catch (classifyError) {
            logger.error('sync.engine', `Sync engine classification failed for ${server.name}`, {
              server: server.name,
              error: classifyError instanceof Error ? classifyError.message : String(classifyError),
            })
          }

          DBService.updateSyncStatus(
            server.baseURL,
            server.name,
            'success',
            undefined,
            cards.length
          )

          logger.info('sync.download', `Synced ${cards.length} cards from ${server.name} in ${Date.now() - syncStartedAt}ms`, {
            server: server.name,
            count: cards.length,
            durationMs: Date.now() - syncStartedAt,
          })
          return { server: server.name, count: cards.length }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error'
          logger.error('sync.download', `Error syncing ${server.name}: ${errorMessage}`, {
            server: server.name,
            error: errorMessage,
            durationMs: Date.now() - syncStartedAt,
          })

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

    logger.info('sync.download', `Sync run complete: ${successful} server(s) succeeded, ${failed} failed, ${totalCards} total card(s) in DB`, {
      successful,
      failed,
      totalCards,
      perServer: results.map((r, i) => ({
        server: CONFIG.servers[i]?.name,
        status: r.status,
        count: r.status === 'fulfilled' ? (r.value as any)?.count : undefined,
        error: r.status === 'rejected' ? (r.reason instanceof Error ? r.reason.message : String(r.reason)) : undefined,
      })),
    })

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
