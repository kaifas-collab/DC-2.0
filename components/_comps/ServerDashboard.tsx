"use client"

import { useState, useMemo, useEffect } from "react"
import { useSearchParams } from "next/navigation"
import Link from "next/link"
import { motion } from "framer-motion"
import { type CardData } from "@/config/config"
import { useServerConfig } from "@/hooks/useServerConfig"
import { frsDataManager } from "@/lib/api"
import type { UnifiedCardData } from "@/lib/types"
import SearchBar from "./SearchBar"
import CardGrid from "./CardGrid"
import CardDetailsDrawer from "./CardDetailsDrawer"
import ThemeToggle from "./ThemeToggle"
import Pagination from "./Pagination"
import { ArrowLeft, Server, CheckSquare, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"

export default function ServerDashboard() {
  const { legacyServers } = useServerConfig()
  const searchParams = useSearchParams()
  const serverIp = searchParams.get("ip")

  const [searchQuery, setSearchQuery] = useState("")
  const [selectedCard, setSelectedCard] = useState<UnifiedCardData | null>(null)
  const [cards, setCards] = useState<CardData[]>([])
  const [rawCards, setRawCards] = useState<UnifiedCardData[]>([])
  const [loading, setLoading] = useState(true)
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedCards, setSelectedCards] = useState<Set<string>>(new Set())
  const [isDeleting, setIsDeleting] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const itemsPerPage = 10

  const server = legacyServers.find((s) => s.ip === serverIp)

  // Fetch cards from the specific server using server-filtered API (no pagination limit)
  const loadServerCards = async () => {
    if (!server) return

    setLoading(true)
    try {
      const serverCards = await frsDataManager.getCardsByServer(server.name)

      setRawCards(serverCards)
      setCards(serverCards.map(card => ({
        cardId: `${card.server_url}-${card.card_id}`,
        personName: card.name,
        watchlistName: card.watchlist_name,
        thumbnail: card.thumbnail_url || card.photo || '',
        timestamp: card.last_updated,
      })))
    } catch (error) {
      console.error('Failed to load server cards:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (serverIp) {
      loadServerCards()
    }
  }, [serverIp])

  const filteredCards = useMemo(() => {
    const query = searchQuery.toLowerCase().trim()
    
    if (!query) return cards
    
    return cards.filter(
      (card) =>
        card.cardId.toLowerCase().includes(query) ||
        card.personName.toLowerCase().includes(query) ||
        card.watchlistName.toLowerCase().includes(query),
    )
  }, [searchQuery, cards])

  // Reset to page 1 when search changes
  useEffect(() => {
    setCurrentPage(1)
  }, [searchQuery])

  // Paginated cards
  const paginatedCards = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage
    const endIndex = startIndex + itemsPerPage
    return filteredCards.slice(startIndex, endIndex)
  }, [filteredCards, currentPage, itemsPerPage])

  const totalPages = Math.ceil(filteredCards.length / itemsPerPage)

  const handleCardClick = (card: CardData) => {
    // Find the raw unified card data
    const rawCard = rawCards.find(c => `${c.server_url}-${c.card_id}` === card.cardId)
    if (rawCard) {
      setSelectedCard(rawCard)
    }
  }

  const handleDeleteCard = async () => {
    // Store the card ID before clearing state
    const deletedCardId = selectedCard ? `${selectedCard.server_url}-${selectedCard.card_id}` : null
    
    // Clear the selected card immediately to close drawer
    setSelectedCard(null)
    
    // Optimistic update - remove the deleted card from UI
    if (deletedCardId) {
      setCards(prevCards => prevCards.filter(c => c.cardId !== deletedCardId))
      setRawCards(prevRawCards => prevRawCards.filter(c => `${c.server_url}-${c.card_id}` !== deletedCardId))
    }
    
    // Optional: reload in background to ensure sync
    setTimeout(() => loadServerCards(), 1000)
  }

  const toggleSelectionMode = () => {
    setSelectionMode(!selectionMode)
    setSelectedCards(new Set())
  }

  const handleCardSelect = (cardId: string, selected: boolean) => {
    const newSelected = new Set(selectedCards)
    if (selected) {
      newSelected.add(cardId)
    } else {
      newSelected.delete(cardId)
    }
    setSelectedCards(newSelected)
  }

  const selectAll = () => {
    const allCardIds = new Set(filteredCards.map(c => c.cardId))
    setSelectedCards(allCardIds)
  }

  const deselectAll = () => {
    setSelectedCards(new Set())
  }

  const handleBulkDelete = async (deleteFromFRS: boolean) => {
    if (selectedCards.size === 0) return

    const confirmed = confirm(
      `Are you sure you want to delete ${selectedCards.size} card(s)?${
        deleteFromFRS 
          ? '\n\nThis will delete from BOTH the FRS server and local database.' 
          : '\n\nThis will delete from local database only.'
      }\n\nThis action cannot be undone!`
    )

    if (!confirmed) return

    setIsDeleting(true)
    try {
      // Build the cards array from selectedCards
      const cardsToDelete = Array.from(selectedCards).map(cardId => {
        const rawCard = rawCards.find(c => `${c.server_url}-${c.card_id}` === cardId)
        return {
          server_url: rawCard?.server_url || '',
          card_id: rawCard?.card_id || ''
        }
      }).filter(c => c.server_url && c.card_id)

      const response = await fetch('/api/cards/bulk-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cards: cardsToDelete,
          deleteFromFRS
        })
      })

      const data = await response.json()

      if (data.success || data.results.localDeleted > 0) {
        // Optimistic update - remove deleted cards from UI immediately
        setCards(prevCards => prevCards.filter(c => !selectedCards.has(c.cardId)))
        setRawCards(prevRawCards => prevRawCards.filter(c => !selectedCards.has(`${c.server_url}-${c.card_id}`)))
        setSelectedCards(new Set())
        setSelectionMode(false)
        
        // Show alert after UI update
        setTimeout(() => {
          alert(
            `Bulk Delete Results:\n\n` +
            `✅ Local: ${data.results.localDeleted} deleted, ${data.results.localFailed} failed\n` +
            (deleteFromFRS ? `✅ FRS: ${data.results.frsDeleted} deleted, ${data.results.frsFailed} failed\n` : '')
          )
        }, 100)
        
        // Reload in background to ensure sync
        setTimeout(() => loadServerCards(), 1000)
      } else {
        throw new Error(data.error || 'Bulk delete failed')
      }
    } catch (error) {
      console.error('Bulk delete error:', error)
      alert(`Failed to delete cards: ${error instanceof Error ? error.message : 'Unknown error'}`)
    } finally {
      setIsDeleting(false)
    }
  }

  if (!server) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-semibold text-foreground mb-2">Server Not Found</h2>
          <p className="text-muted-foreground mb-4">The requested server could not be found</p>
          <Link href="/" className="text-primary hover:underline">
            Back to Dashboard
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <motion.header
        className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur-sm"
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        <div className="px-6 py-4 flex items-center justify-between max-w-7xl mx-auto">
          <div className="flex items-center gap-4">
            <Link href="/" className="p-2 hover:bg-muted rounded-lg transition-colors">
              <ArrowLeft className="w-5 h-5 text-foreground" />
            </Link>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-semibold text-foreground">{server.name}</h1>
              </div>
              <p className="text-xs text-muted-foreground">{server.ip} • {server.location}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              onClick={toggleSelectionMode}
              variant={selectionMode ? "default" : "outline"}
              size="sm"
              className="gap-2"
            >
              <CheckSquare className="w-4 h-4" />
              {selectionMode ? 'Cancel' : 'Select'}
            </Button>
            <ThemeToggle />
          </div>
        </div>

        {/* Selection Toolbar */}
        {selectionMode && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="border-t border-border bg-muted/50"
          >
            <div className="px-6 py-3 flex items-center justify-between max-w-7xl mx-auto">
              <div className="flex items-center gap-3">
                <Badge variant="secondary" className="text-sm">
                  {selectedCards.size} selected
                </Badge>
                <Button
                  onClick={selectAll}
                  variant="ghost"
                  size="sm"
                  className="h-8 text-xs"
                >
                  Select All ({filteredCards.length})
                </Button>
                {selectedCards.size > 0 && (
                  <Button
                    onClick={deselectAll}
                    variant="ghost"
                    size="sm"
                    className="h-8 text-xs"
                  >
                    Deselect All
                  </Button>
                )}
              </div>
              
              {selectedCards.size > 0 && (
                <div className="flex items-center gap-2">
                  <Button
                    onClick={() => handleBulkDelete(false)}
                    disabled={isDeleting}
                    variant="outline"
                    size="sm"
                    className="gap-2 text-orange-600 hover:text-orange-700 hover:bg-orange-50 dark:hover:bg-orange-950"
                  >
                    <Trash2 className="w-4 h-4" />
                    Delete Local ({selectedCards.size})
                  </Button>
                  <Button
                    onClick={() => handleBulkDelete(true)}
                    disabled={isDeleting}
                    variant="destructive"
                    size="sm"
                    className="gap-2"
                  >
                    {isDeleting ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                        Deleting...
                      </>
                    ) : (
                      <>
                        <Trash2 className="w-4 h-4" />
                        Delete from FRS ({selectedCards.size})
                      </>
                    )}
                  </Button>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </motion.header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-6 py-10">
        {/* Title Section */}
        <motion.div className="mb-10" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5 }}>
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-3xl font-bold text-foreground mb-2">Record Database</h2>
              <p className="text-muted-foreground">View and manage facial recognition record data</p>
            </div>
            <div className="text-right">
              <div className="text-3xl font-bold text-primary">{cards.length}</div>
              <p className="text-sm text-muted-foreground">Total Records</p>
            </div>
          </div>
        </motion.div>

        {/* Search Bar */}
        <motion.div
          className="mb-8"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.1 }}
        >
          <SearchBar
            placeholder="Search cards by ID, name, or watchlist..."
            value={searchQuery}
            onChange={setSearchQuery}
          />
        </motion.div>

        {/* Card Grid */}
        <motion.div 
          key={`grid-${paginatedCards.length}-${searchQuery}-${currentPage}`}
          initial={{ opacity: 0 }} 
          animate={{ opacity: 1 }} 
          transition={{ duration: 0.5, delay: 0.2 }}
        >
          <CardGrid 
            cards={paginatedCards} 
            onCardClick={handleCardClick} 
            loading={loading}
            selectionMode={selectionMode}
            selectedCards={selectedCards}
            onCardSelect={handleCardSelect}
          />
        </motion.div>

        {/* Pagination */}
        {filteredCards.length > 0 && (
          <Pagination
            currentPage={currentPage}
            totalPages={totalPages}
            onPageChange={setCurrentPage}
            itemsPerPage={itemsPerPage}
            totalItems={filteredCards.length}
          />
        )}

        {filteredCards.length === 0 && !loading && (
          <motion.div
            className="text-center py-16"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3 }}
          >
            <Server className="w-12 h-12 text-muted-foreground mx-auto mb-4 opacity-50" />
            <p className="text-muted-foreground">No cards found matching your search</p>
          </motion.div>
        )}
      </main>

      {/* Card Details Drawer */}
      {selectedCard && (
        <CardDetailsDrawer 
          card={selectedCard} 
          onClose={() => setSelectedCard(null)} 
          onDelete={handleDeleteCard}
        />
      )}
    </div>
  )
}
