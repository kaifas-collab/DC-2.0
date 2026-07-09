import db from './db'
import type { UnifiedCardData } from './types'

export class DBService {
  private static readonly upsertStmt = db.prepare(`
    INSERT INTO cards (
      card_id, server_url, server_name, server_location, name, comment, photo,
      confidence, lists, active, watches, created_date, acknowledged,
      on_lists, galleries, watchlist_name, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(server_url, card_id)
    DO UPDATE SET
      name = excluded.name,
      comment = excluded.comment,
      photo = excluded.photo,
      confidence = excluded.confidence,
      lists = excluded.lists,
      active = excluded.active,
      watches = excluded.watches,
      acknowledged = excluded.acknowledged,
      on_lists = excluded.on_lists,
      galleries = excluded.galleries,
      watchlist_name = excluded.watchlist_name,
      updated_at = CURRENT_TIMESTAMP
  `)

  // Save or update a single card
  static saveCard(card: UnifiedCardData): void {
    DBService.upsertStmt.run(
      card.card_id,
      card.server_url,
      card.server_name,
      card.server_location,
      card.name,
      card.comment || null,
      card.photo || null,
      card.confidence || null,
      card.lists ? JSON.stringify(card.lists) : null,
      card.active ? 1 : 0,
      card.watches ? JSON.stringify(card.watches) : null,
      card.created_date || null,
      card.acknowledged ? 1 : 0,
      card.on_lists ? JSON.stringify(card.on_lists) : null,
      card.galleries ? JSON.stringify(card.galleries) : null,
      card.watchlist_name || null
    )
  }

  // Save multiple cards (batch operation)
  static saveCards(cards: UnifiedCardData[]): void {
    const transaction = db.transaction((cardsToSave: UnifiedCardData[]) => {
      for (const card of cardsToSave) {
        this.saveCard(card)
      }
    })

    transaction(cards)
  }

  // Sync cards for a specific server (replaces all cards for that server)
  static syncServerCards(serverUrl: string, cards: UnifiedCardData[]): void {
    const transaction = db.transaction(() => {
      // Get current card IDs from FRS
      const currentCardIds = new Set(cards.map(c => c.card_id))
      
      // Delete cards that no longer exist on the FRS server
      const existingCards = db.prepare(
        'SELECT card_id FROM cards WHERE server_url = ?'
      ).all(serverUrl) as Array<{ card_id: string }>
      
      const cardsToDelete = existingCards.filter(c => !currentCardIds.has(c.card_id))
      
      if (cardsToDelete.length > 0) {
        const CHUNK = 500 // stay under SQLite 999-variable limit
        for (let i = 0; i < cardsToDelete.length; i += CHUNK) {
          const chunk = cardsToDelete.slice(i, i + CHUNK)
          const placeholders = chunk.map(() => '?').join(',')
          db.prepare(`DELETE FROM cards WHERE server_url = ? AND card_id IN (${placeholders})`)
            .run(serverUrl, ...chunk.map(c => c.card_id))
        }
        console.log(`🗑️  Removed ${cardsToDelete.length} deleted cards from ${serverUrl}`)
      }
      
      // Now save/update all current cards
      for (const card of cards) {
        this.saveCard(card)
      }
    })

    transaction()
  }

  // Get all cards — paginated (required at 100k+ rows)
  static getAllCards(limit = 1000, offset = 0): UnifiedCardData[] {
    const stmt = db.prepare(`
      SELECT * FROM cards
      ORDER BY updated_at DESC
      LIMIT ? OFFSET ?
    `)

    const rows = stmt.all(limit, offset) as any[]
    return rows.map(this.mapRowToCard)
  }

  // Get cards by server URL
  static getCardsByServer(serverUrl: string): UnifiedCardData[] {
    const stmt = db.prepare(`
      SELECT * FROM cards 
      WHERE server_url = ?
      ORDER BY updated_at DESC
    `)
    
    const rows = stmt.all(serverUrl) as any[]
    return rows.map(this.mapRowToCard)
  }

  // Get cards by server name
  static getCardsByServerName(serverName: string): UnifiedCardData[] {
    const stmt = db.prepare(`
      SELECT * FROM cards 
      WHERE server_name = ?
      ORDER BY updated_at DESC
    `)
    
    const rows = stmt.all(serverName) as any[]
    return rows.map(this.mapRowToCard)
  }

  static searchCardsCount(query: string): number {
    const stmt = db.prepare(`
      SELECT COUNT(*) as count FROM cards c
      JOIN cards_fts f ON c.id = f.rowid
      WHERE cards_fts MATCH ?
    `)
    const result = stmt.get(`"${query.replace(/"/g, '""')}"*`) as any
    return result.count
  }

  static getCardCountByServerName(serverName: string): number {
    const stmt = db.prepare(`SELECT COUNT(*) as count FROM cards WHERE server_name = ?`)
    const result = stmt.get(serverName) as any
    return result.count
  }

  // Search cards by name — uses FTS5 (required at 100k+ rows; LIKE '%q%' is full table scan)
  static searchCards(query: string, limit = 1000, offset = 0): UnifiedCardData[] {
    const stmt = db.prepare(`
      SELECT c.* FROM cards c
      JOIN cards_fts f ON c.id = f.rowid
      WHERE cards_fts MATCH ?
      ORDER BY c.updated_at DESC
      LIMIT ? OFFSET ?
    `)

    const rows = stmt.all(`"${query.replace(/"/g, '""')}"*`, limit, offset) as any[]
    return rows.map(this.mapRowToCard)
  }

  // Delete a specific card by server_url and card_id
  static deleteCard(serverUrl: string, cardId: string): boolean {
    const stmt = db.prepare(`DELETE FROM cards WHERE server_url = ? AND card_id = ?`)
    const result = stmt.run(serverUrl, cardId)
    return result.changes > 0
  }

  // Delete cards by server URL
  static deleteCardsByServer(serverUrl: string): void {
    const stmt = db.prepare(`DELETE FROM cards WHERE server_url = ?`)
    stmt.run(serverUrl)
  }

  // Delete all cards
  static deleteAllCards(): void {
    db.exec(`DELETE FROM cards`)
  }

  // Get card count by server
  static getCardCountByServer(serverUrl: string): number {
    const stmt = db.prepare(`SELECT COUNT(*) as count FROM cards WHERE server_url = ?`)
    const result = stmt.get(serverUrl) as any
    return result.count
  }

  // Get total card count
  static getTotalCardCount(): number {
    const stmt = db.prepare(`SELECT COUNT(*) as count FROM cards`)
    const result = stmt.get() as any
    return result.count
  }

  // Update sync status for a server
  static updateSyncStatus(
    serverUrl: string, 
    serverName: string, 
    status: 'syncing' | 'success' | 'error' | 'idle',
    error?: string,
    cardCount?: number
  ): void {
    const stmt = db.prepare(`
      INSERT INTO sync_status (server_url, server_name, last_sync, status, error, card_count)
      VALUES (?, ?, CURRENT_TIMESTAMP, ?, ?, ?)
      ON CONFLICT(server_url) 
      DO UPDATE SET
        last_sync = CURRENT_TIMESTAMP,
        status = excluded.status,
        error = excluded.error,
        card_count = excluded.card_count
    `)

    stmt.run(serverUrl, serverName, status, error || null, cardCount || 0)
  }

  // Get sync status for all servers
  static getAllSyncStatus() {
    const stmt = db.prepare(`SELECT * FROM sync_status ORDER BY last_sync DESC`)
    return stmt.all()
  }

  // Helper: Map database row to UnifiedCardData
  private static mapRowToCard(row: any): UnifiedCardData {
    return {
      card_id: row.card_id,
      server_url: row.server_url,
      server_name: row.server_name,
      server_location: row.server_location,
      name: row.name,
      comment: row.comment || '',
      thumbnail_url: row.photo || '',
      fullframe_url: row.photo || '',
      watchlist_name: row.watchlist_name || '',
      last_updated: row.updated_at || row.synced_at,
      photo: row.photo,
      confidence: row.confidence,
      lists: row.lists ? JSON.parse(row.lists) : undefined,
      active: row.active === 1,
      watches: row.watches ? JSON.parse(row.watches) : undefined,
      created_date: row.created_date,
      acknowledged: row.acknowledged === 1,
      on_lists: row.on_lists ? JSON.parse(row.on_lists) : undefined,
      galleries: row.galleries ? JSON.parse(row.galleries) : undefined,
    }
  }

  // Get database stats
  static getStats() {
    const totalCards = this.getTotalCardCount()
    const serverStats = db.prepare(`
      SELECT server_name, server_url, COUNT(*) as count 
      FROM cards 
      GROUP BY server_url 
      ORDER BY count DESC
    `).all()

    return {
      totalCards,
      serverStats,
      lastSync: db.prepare(`SELECT MAX(synced_at) as last FROM cards`).get() as any,
    }
  }
}

export default DBService
