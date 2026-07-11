"use client"

import { useState, useEffect } from "react"
import { motion } from "framer-motion"
import Image from "next/image"
import Link from "next/link"
import { frsDataManager } from "@/lib/api"
import { useServerConfig } from "@/hooks/useServerConfig"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import SearchBar from "./SearchBar"
import ThemeToggle from "./ThemeToggle"
import Pagination from "./Pagination"
import {
  RefreshCw,
  Clock,
  Server,
  AlertCircle,
  CheckCircle,
  Grid3x3,
  Calendar,
  CheckSquare,
  Trash2,
  Check
} from "lucide-react"
import type { LogicalCardData, SyncStatus } from "@/lib/types"
import CardDetailsDrawer from "./CardDetailsDrawer"

export default function DashboardPage() {
  console.log("🏠 DashboardPage: Component function executing")
  const { config, legacyServers, refetch: refetchConfig } = useServerConfig()

  const [searchQuery, setSearchQuery] = useState("")
  const [allCards, setAllCards] = useState<LogicalCardData[]>([])
  const [selectedCard, setSelectedCard] = useState<LogicalCardData | null>(null)
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({
    lastSync: null,
    nextSync: null,
    isRefreshing: false,
    totalCards: 0,
    successfulServers: 0,
    failedServers: [],
    refreshInterval: 12,
  })
  const [isLoading, setIsLoading] = useState(true)
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedCards, setSelectedCards] = useState<Set<string>>(new Set())
  const [isDeleting, setIsDeleting] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [totalItems, setTotalItems] = useState(0)
  const [syncVersion, setSyncVersion] = useState(0)
  const [intervalHours, setIntervalHours] = useState("")
  const [savingInterval, setSavingInterval] = useState(false)
  const itemsPerPage = 10

  // Seed the interval input from the live config once it loads (config is in seconds; operators
  // pick hours). Kept in a string so the field can be edited freely.
  useEffect(() => {
    setIntervalHours(String(config.refreshIntervalSeconds / 3600))
  }, [config.refreshIntervalSeconds])

  // Fetch page from server — debounced for search, immediate for page/sync changes
  useEffect(() => {
    const controller = new AbortController()
    const delay = searchQuery ? 300 : 0

    const timer = setTimeout(async () => {
      setIsLoading(true)
      try {
        const params = new URLSearchParams({
          page: String(currentPage),
          limit: String(itemsPerPage),
        })
        if (searchQuery.trim()) params.set('search', searchQuery.trim())

        const res = await fetch(`/api/logical-cards?${params}`, { signal: controller.signal })
        const json = await res.json()

        if (json.success && !controller.signal.aborted) {
          setAllCards(json.data)
          setTotalItems(json.total ?? json.count)
        }
      } catch (err: any) {
        if (err.name !== 'AbortError') console.error('❌ Failed to fetch cards:', err)
      } finally {
        if (!controller.signal.aborted) setIsLoading(false)
      }
    }, delay)

    return () => { clearTimeout(timer); controller.abort() }
  }, [currentPage, searchQuery, syncVersion])

  // Subscribe to sync status — bump syncVersion to trigger re-fetch after a REAL sync completes
  // (manual Force Refresh click, or the auto-refresh timer per refreshIntervalSeconds). This never
  // initiates a sync itself, only reacts to one.
  useEffect(() => {
    const unsubscribe = frsDataManager.onSyncStatusChange((status) => {
      setSyncStatus(status)
      if (!status.isRefreshing && status.totalCards > 0) {
        setTotalItems(status.totalCards)
        setCurrentPage(1)
        setSyncVersion((v: number) => v + 1)
      }
    })
    return () => { if (typeof unsubscribe === 'function') unsubscribe() }
  }, [])

  const handleManualRefresh = async () => {
    try {
      await frsDataManager.manualRefresh()
      // sync subscription handles setCurrentPage(1) + setSyncVersion → re-fetch
    } catch (error) {
      console.error("❌ Manual refresh failed:", error)
    }
  }

  // Persist a new sync interval (operators enter hours; config stores seconds), then apply it to the
  // live auto-refresh timer so it takes effect without a page reload.
  const handleSaveInterval = async () => {
    const hours = Number(intervalHours)
    if (!Number.isFinite(hours) || hours <= 0) {
      alert("Enter a positive number of hours.")
      return
    }

    setSavingInterval(true)
    try {
      const res = await fetch("/api/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hours }),
      })
      const data = await res.json()
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to save interval")
      }
      frsDataManager.updateRefreshInterval(data.refreshIntervalSeconds)
      refetchConfig()
    } catch (error) {
      console.error("❌ Failed to save sync interval:", error)
      alert(`Failed to save interval: ${error instanceof Error ? error.message : "Unknown error"}`)
    } finally {
      setSavingInterval(false)
    }
  }

  const toggleSelectionMode = () => {
    setSelectionMode(!selectionMode)
    setSelectedCards(new Set())
  }

  const handleCardSelect = (cardKey: string, selected: boolean) => {
    const newSelected = new Set(selectedCards)
    if (selected) {
      newSelected.add(cardKey)
    } else {
      newSelected.delete(cardKey)
    }
    setSelectedCards(newSelected)
  }

  const selectAll = () => {
    const allCardKeys = new Set(allCards.map((c: LogicalCardData) => c.globalCardUuid))
    setSelectedCards(allCardKeys)
  }

  const deselectAll = () => {
    setSelectedCards(new Set())
  }

  // The DC is the sole delete authority: each selected card is deleted from every connected FRS
  // server via the cluster-delete endpoint (async, blocked if any server is offline). There's no
  // more "central only" option, since a central-only delete would just get auto-restored.
  const handleBulkDelete = async () => {
    if (selectedCards.size === 0) return

    const confirmed = confirm(
      `Delete ${selectedCards.size} record(s) from EVERY connected server?\n\nThis cannot be undone, and will be blocked if any server is currently offline.`
    )

    if (!confirmed) return

    setIsDeleting(true)
    try {
      const globalCardUuids = Array.from(selectedCards)

      const results = await Promise.allSettled(
        globalCardUuids.map(globalCardUuid =>
          fetch('/api/cards/cluster-delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ globalCardUuid })
          }).then(res => res.json())
        )
      )

      const started = results.filter(r => r.status === 'fulfilled' && (r.value as any).success).length
      const failed = results.length - started

      setSelectedCards(new Set())
      setSelectionMode(false)

      setTimeout(() => {
        alert(
          `Delete started for ${started} record(s).` +
          (failed > 0 ? `\n${failed} could not be started (see console) - often because a server is offline.` : '') +
          `\n\nRecords will disappear once every server confirms.`
        )
      }, 100)

      setTimeout(() => handleManualRefresh(), 1000)
    } catch (error) {
      console.error('Bulk delete error:', error)
      alert(`Failed to delete records: ${error instanceof Error ? error.message : 'Unknown error'}`)
    } finally {
      setIsDeleting(false)
    }
  }

  const handleDeleteCard = async () => {
    // Store the card key before clearing state
    const deletedGlobalCardUuid = selectedCard?.globalCardUuid ?? null

    // Clear the selected card immediately to close drawer
    setSelectedCard(null)

    // Optimistic update - remove the deleted card from UI
    if (deletedGlobalCardUuid) {
      setAllCards(prevCards => prevCards.filter(c => c.globalCardUuid !== deletedGlobalCardUuid))
    }

    // Reload in background to ensure sync
    setTimeout(() => handleManualRefresh(), 1000)
  }

  const totalPages = Math.ceil(totalItems / itemsPerPage)

  // Format time display
  const formatTime = (date: Date | null) => {
    if (!date) return "Never"
    return new Intl.DateTimeFormat("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      month: "short",
      day: "numeric",
    }).format(date)
  }

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: { staggerChildren: 0.05, delayChildren: 0.1 },
    },
  }

  const itemVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.3 } },
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <motion.header
        className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur-sm"
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        <div className="px-6 py-4 flex items-center justify-between max-w-7xl mx-auto">
          <div className="flex items-center gap-4">
            <div>
              <h1 className="text-2xl font-bold text-foreground">Central FR Face DB</h1>
              <p className="text-xs text-muted-foreground">Facial Recognition Dashboard</p>
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            {/* Refresh Button */}
            <Button
              onClick={handleManualRefresh}
              disabled={syncStatus.isRefreshing}
              variant="outline"
              size="sm"
              className="gap-2"
            >
              <RefreshCw className={`w-4 h-4 ${syncStatus.isRefreshing ? "animate-spin" : ""}`} />
              Force Refresh
            </Button>
            <Button
              onClick={toggleSelectionMode}
              variant={selectionMode ? "default" : "outline"}
              size="sm"
              className="gap-2"
            >
              <CheckSquare className="w-4 h-4" />
              {selectionMode ? 'Cancel' : 'Delete Records'}
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
                  Select All ({allCards.length})
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
                    onClick={handleBulkDelete}
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
                        Delete Everywhere ({selectedCards.size})
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
      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Sync Status Section */}
        <motion.div 
          className="mb-8"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5 }}
        >
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            {/* Server Status */}
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-green-100 dark:bg-green-900 rounded-lg">
                    <Server className="w-5 h-5 text-green-600 dark:text-green-400" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-foreground">
                      {syncStatus.successfulServers}/{legacyServers.length}
                    </p>
                    <p className="text-xs text-muted-foreground">Servers Online</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Last Sync */}
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-purple-100 dark:bg-purple-900 rounded-lg">
                    <Clock className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      {formatTime(syncStatus.lastSync)}
                    </p>
                    <p className="text-xs text-muted-foreground">Last Sync</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Next Sync */}
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-orange-100 dark:bg-orange-900 rounded-lg">
                    <Calendar className="w-5 h-5 text-orange-600 dark:text-orange-400" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      {formatTime(syncStatus.nextSync)}
                    </p>
                    <p className="text-xs text-muted-foreground">Next Sync</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Failed Servers Alert */}
          {syncStatus.failedServers.length > 0 && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              className="mb-4"
            >
              <div className="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400" />
                <div>
                  <p className="text-sm font-medium text-red-800 dark:text-red-200">
                    Failed to sync from {syncStatus.failedServers.length} server(s)
                  </p>
                  <p className="text-xs text-red-600 dark:text-red-400">
                    {syncStatus.failedServers.join(", ")}
                  </p>
                </div>
              </div>
            </motion.div>
          )}
        </motion.div>

        {/* Title and Search */}
        <motion.div 
          className="mb-8"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.1 }}
        >
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-3xl font-bold text-foreground mb-2">Records</h2>
              <p className="text-muted-foreground">
                Unified view of all facial recognition records across {legacyServers.length} servers
              </p>
            </div>
            
            <div className="text-right">
              <div className="flex items-center justify-end gap-2">
                <span className="text-sm text-muted-foreground">Sync every</span>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={intervalHours}
                  onChange={(e) => setIntervalHours(e.target.value)}
                  disabled={savingInterval}
                  className="w-16 rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground text-right focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-50"
                />
                <span className="text-sm text-muted-foreground">hours</span>
                <Button onClick={handleSaveInterval} disabled={savingInterval} variant="outline" size="sm">
                  {savingInterval ? "Saving..." : "Save"}
                </Button>
              </div>
              {syncStatus.isRefreshing && (
                <div className="mt-1 flex items-center justify-end gap-2 text-blue-600 dark:text-blue-400">
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span className="text-sm">Syncing...</span>
                </div>
              )}
            </div>
          </div>

          <SearchBar
            placeholder="Search records by name..."
            value={searchQuery}
            onChange={setSearchQuery}
          />
        </motion.div>

        {/* Records Grid */}
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <RefreshCw className="w-8 h-8 animate-spin text-muted-foreground" />
            <span className="ml-3 text-muted-foreground">Loading records...</span>
          </div>
        ) : (
          <>
            <motion.div
              key={`cards-grid-${allCards.length}-${searchQuery}-${currentPage}`}
              className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3"
              variants={containerVariants}
              initial="hidden"
              animate="visible"
            >
              {allCards.map((card) => {
              const cardKey = card.globalCardUuid
              const isSelected = selectedCards.has(cardKey)

              return (
                <motion.div key={cardKey} variants={itemVariants}>
                  <Card
                    className={`h-full cursor-pointer transition-all duration-300 bg-card hover:bg-card/80 group overflow-hidden ${
                      isSelected
                        ? 'ring-2 ring-primary border-primary shadow-lg'
                        : 'hover:shadow-lg hover:border-primary/50'
                    }`}
                    onClick={(e) => {
                      if (selectionMode) {
                        e.stopPropagation()
                        handleCardSelect(cardKey, !isSelected)
                      } else {
                        setSelectedCard(card)
                      }
                    }}
                  >
                    {/* Thumbnail - the dominant element */}
                    <div className="relative aspect-square bg-muted overflow-hidden">
                      <Image
                        src={card.photo || '/placeholder-user.jpg'}
                        alt={card.name}
                        fill
                        className="object-cover group-hover:scale-105 transition-transform duration-300"
                        onError={(e) => {
                          const target = e.target as HTMLImageElement
                          target.src = '/placeholder-user.jpg'
                        }}
                      />
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors duration-300" />
                      {selectionMode && (
                        <div
                          className={`absolute top-2 right-2 w-6 h-6 rounded-md border-2 flex items-center justify-center transition-all ${
                            isSelected
                              ? 'bg-primary border-primary'
                              : 'bg-background/80 border-muted-foreground/30 group-hover:border-primary/50'
                          }`}
                          onClick={(e) => {
                            e.stopPropagation()
                            handleCardSelect(cardKey, !isSelected)
                          }}
                        >
                          {isSelected && <Check className="w-4 h-4 text-primary-foreground" />}
                        </div>
                      )}
                    </div>

                    {/* Compact caption */}
                    <CardContent className="p-2 space-y-1">
                      <h3 className="font-semibold text-sm text-foreground line-clamp-1">{card.name}</h3>
                      {card.watchlist && (
                        <Badge variant="outline" className="text-xs">
                          {card.watchlist}
                        </Badge>
                      )}
                      {card.comment && (
                        <p className="text-xs text-muted-foreground line-clamp-1">{card.comment}</p>
                      )}
                    </CardContent>
                  </Card>
                </motion.div>
              )
            })}
            </motion.div>

            {/* Pagination */}
            {totalItems > 0 && (
              <Pagination
                currentPage={currentPage}
                totalPages={totalPages}
                onPageChange={setCurrentPage}
                itemsPerPage={itemsPerPage}
                totalItems={totalItems}
              />
            )}
          </>
        )}

        {/* No Results */}
        {!isLoading && allCards.length === 0 && (
          <motion.div
            className="text-center py-16"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3 }}
          >
            <Grid3x3 className="w-12 h-12 text-muted-foreground mx-auto mb-4 opacity-50" />
            <p className="text-muted-foreground mb-2">
              {allCards.length === 0 ? "No records found" : "No records match your search"}
            </p>
            {searchQuery && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSearchQuery("")}
                className="mt-4"
              >
                Clear Search
              </Button>
            )}
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
