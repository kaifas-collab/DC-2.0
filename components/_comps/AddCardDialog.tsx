"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import { X, Plus, Upload, CheckCircle, AlertCircle, Loader2, Server as ServerIcon, RefreshCw, Wifi, WifiOff } from "lucide-react"
import { Input } from "@/components/ui/input"
import { useServerConfig } from "@/hooks/useServerConfig"
import { watchlistCache, type Watchlist } from "@/lib/watchlistCache"
import axios from "axios"

interface AddCardDialogProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
}

export default function AddCardDialog({ isOpen, onClose, onSuccess }: AddCardDialogProps) {
  const { config } = useServerConfig()
  const [name, setName] = useState("")
  const [photo, setPhoto] = useState<File | null>(null)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const [selectedWatchlists, setSelectedWatchlists] = useState<string[]>([])  // Changed to string array for "serverName:id" format
  const [selectedServers, setSelectedServers] = useState<string[]>([])
  const [watchlists, setWatchlists] = useState<Watchlist[]>([])
  const [watchlistsLoading, setWatchlistsLoading] = useState(false)
  const [watchlistsError, setWatchlistsError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitStatus, setSubmitStatus] = useState<{
    type: 'success' | 'error' | 'partial' | null
    message: string
    details?: any
  }>({ type: null, message: '' })
  const [watchlistDropdownOpen, setWatchlistDropdownOpen] = useState(false)
  const [watchlistSearchQuery, setWatchlistSearchQuery] = useState("")
  
  // New state for server selection
  const [selectedServerForWatchlist, setSelectedServerForWatchlist] = useState<string>("all")

  // Get server statuses from cache (memoized to prevent infinite loops)
  const serverStatuses = useMemo(() => {
    const statuses: Record<string, any> = {}
    config.servers.forEach(server => {
      const cached = watchlistCache.getCached(server.name)
      if (cached) {
        statuses[server.name] = cached
      }
    })
    return statuses
  }, [watchlists, watchlistsLoading]) // Only recalculate when watchlists change

  // Load watchlists when dialog opens or server selection changes
  useEffect(() => {
    if (!isOpen) return

    const loadData = async () => {
      setWatchlistsLoading(true)
      setWatchlistsError(null)
      
      try {
        if (selectedServerForWatchlist === "all") {
          // Get combined watchlists from all servers - DON'T deduplicate
          const { watchlists: allWatchlists } = await watchlistCache.getAllWatchlists(true)
          
          // Keep ALL watchlists with server context (no deduplication)
          setWatchlists(allWatchlists)
          
          // Check statuses
          const allErrors = Object.values(serverStatuses).length > 0 && 
                           Object.values(serverStatuses).every((s: any) => s.error !== null)
          
          setWatchlistsError(allErrors ? 'All servers are offline or unavailable' : null)
        } else {
          // Get watchlists for specific server
          const watchlists = await watchlistCache.getWatchlists(selectedServerForWatchlist)
          setWatchlists(watchlists)
        }
      } catch (error) {
        setWatchlistsError(error instanceof Error ? error.message : 'Failed to load watchlists')
        setWatchlists([])
      } finally {
        setWatchlistsLoading(false)
      }
    }

    loadData()
  }, [isOpen, selectedServerForWatchlist])

  // Handle photo file selection
  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setPhoto(file)
      // Create preview
      const reader = new FileReader()
      reader.onloadend = () => {
        setPhotoPreview(reader.result as string)
      }
      reader.readAsDataURL(file)
    }
  }

  // Toggle watchlist selection - now uses "serverName:id" format
  const toggleWatchlist = (watchlist: Watchlist) => {
    const key = `${watchlist.serverName}:${watchlist.id}`
    setSelectedWatchlists(prev => {
      if (prev.includes(key)) {
        return prev.filter(k => k !== key)
      } else {
        return [...prev, key]
      }
    })
  }

  // Toggle server selection
  const toggleServer = (serverName: string) => {
    setSelectedServers(prev => {
      if (prev.includes(serverName)) {
        return prev.filter(name => name !== serverName)
      } else {
        return [...prev, serverName]
      }
    })
  }

  // Select all servers
  const selectAllServers = () => {
    if (selectedServers.length === config.servers.length) {
      setSelectedServers([])
    } else {
      setSelectedServers(config.servers.map(s => s.name))
    }
  }

  // Simplify error messages for better readability
  const simplifyErrorMessage = (error: string): string => {
    const lowerError = error.toLowerCase()
    
    if (lowerError.includes('timeout') || lowerError.includes('exceeded')) {
      return 'Unable to connect to server (timeout)'
    }
    if (lowerError.includes('network') || lowerError.includes('econnrefused') || lowerError.includes('connection')) {
      return 'Unable to connect to server'
    }
    if (lowerError.includes('forbidden') && lowerError.includes('watchlist')) {
      return 'Selected watchlist(s) do not exist on this server'
    }
    if (lowerError.includes('403') || lowerError.includes('forbidden')) {
      return 'Access denied - check token/permissions'
    }
    if (lowerError.includes('watchlist') && lowerError.includes('not found')) {
      return 'Watchlist not found'
    }
    if (lowerError.includes('404')) {
      return 'Server endpoint not found'
    }
    if (lowerError.includes('500') || lowerError.includes('internal')) {
      return 'Server internal error'
    }
    if (lowerError.includes('unauthorized') || lowerError.includes('401')) {
      return 'Authentication failed'
    }
    
    // Return simplified version or original if too long
    return error.length > 50 ? error.substring(0, 47) + '...' : error
  }

  // Handle form submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!name.trim()) {
      setSubmitStatus({
        type: 'error',
        message: 'Please enter a name'
      })
      return
    }

    if (selectedServers.length === 0) {
      setSubmitStatus({
        type: 'error',
        message: 'Please select at least one server'
      })
      return
    }

    setIsSubmitting(true)
    setSubmitStatus({ type: null, message: '' })

    try {
      // Parse selected watchlists and group by server
      const watchlistsByServer: Record<string, number[]> = {}
      selectedWatchlists.forEach(key => {
        const [serverName, idStr] = key.split(':')
        const id = parseInt(idStr)
        if (!watchlistsByServer[serverName]) {
          watchlistsByServer[serverName] = []
        }
        watchlistsByServer[serverName].push(id)
      })

      const formData = new FormData()
      formData.append('name', name)
      formData.append('watchlistsByServer', JSON.stringify(watchlistsByServer))  // Send per-server watchlists
      formData.append('servers', JSON.stringify(selectedServers))
      if (photo) {
        formData.append('photo', photo)
      }

      const response = await axios.post('/api/cards/add', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
        timeout: 60000, // 60 seconds for multiple servers
      })

      if (response.data.success) {
        const results = response.data.results
        const successCount = results.successCount || 0
        const failCount = results.failCount || 0
        const totalCount = successCount + failCount
        
        // Build detailed message
        let message = ''
        if (failCount === 0) {
          // All successful
          if (selectedServers.length === config.servers.length) {
            message = `✓ Card successfully added to all ${successCount} servers`
          } else if (successCount === 1) {
            const serverName = results.successful?.[0]?.server || selectedServers[0]
            message = `✓ Card successfully added to ${serverName}`
          } else {
            const serverNames = results.successful?.map((s: any) => s.server).join(', ') || selectedServers.join(', ')
            message = `✓ Card successfully added to ${successCount} servers: ${serverNames}`
          }
          
          setSubmitStatus({
            type: 'success',
            message,
            details: results
          })
        } else if (successCount === 0) {
          // All failed
          const failedServers = results.failed?.map((f: any) => f.server).join(', ') || 'all servers'
          message = `✗ Failed to add card to ${failedServers}`
          
          setSubmitStatus({
            type: 'error',
            message,
            details: results
          })
        } else {
          // Partial success
          const successServers = results.successful?.map((s: any) => s.server).join(', ') || ''
          const failedServers = results.failed?.map((f: any) => f.server).join(', ') || ''
          message = `⚠ Partially completed: Added to ${successCount} server(s), failed on ${failCount} server(s)`
          
          setSubmitStatus({
            type: 'partial',
            message,
            details: results
          })
        }
        
        // Don't reset form immediately - let user see the message and decide
        // onSuccess will be called when user manually closes the dialog
      } else {
        setSubmitStatus({
          type: 'error',
          message: response.data.error || 'Failed to add card'
        })
      }
    } catch (error: any) {
      console.error('Error adding card:', error)
      setSubmitStatus({
        type: 'error',
        message: error.response?.data?.error || 'Failed to add card'
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  // Reset form and close
  const handleClose = () => {
    // Call onSuccess if there was a successful submission to refresh the main page
    if (submitStatus.type === 'success' || submitStatus.type === 'partial') {
      onSuccess()
    }
    
    setName("")
    setPhoto(null)
    setPhotoPreview(null)
    setSelectedWatchlists([])
    setSelectedServers([])
    setSubmitStatus({ type: null, message: '' })
    setWatchlistDropdownOpen(false)
    setSelectedServerForWatchlist("all")
    setWatchlistSearchQuery("")
    onClose()
  }

  // Manual refresh watchlists
  const handleRefreshWatchlists = async () => {
    setWatchlistsLoading(true)
    try {
      if (selectedServerForWatchlist === "all") {
        // Refresh all servers
        await watchlistCache.prefetchAll()
        const { watchlists: allWatchlists } = await watchlistCache.getAllWatchlists(false)
        const uniqueWatchlists = Array.from(
          new Map(allWatchlists.map(wl => [wl.id, wl])).values()
        )
        setWatchlists(uniqueWatchlists)
      } else {
        // Refresh specific server
        const watchlists = await watchlistCache.getWatchlists(selectedServerForWatchlist, true)
        setWatchlists(watchlists)
      }
    } catch (error) {
      setWatchlistsError(error instanceof Error ? error.message : 'Failed to refresh')
    } finally {
      setWatchlistsLoading(false)
    }
  }

  return (
    <>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={(e) => {
              // Prevent closing while submitting
              if (!isSubmitting) {
                handleClose()
              }
            }}
          />

          {/* Dialog */}
          <div
            className="relative z-10 w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-background border border-border rounded-lg shadow-xl"
          >
          {/* Header */}
          <div className="sticky top-0 z-10 flex items-center justify-between p-6 border-b border-border bg-background">
            <h2 className="text-2xl font-bold flex items-center gap-2">
              <Plus className="h-6 w-6" />
              Add New Card
            </h2>
            <button
              type="button"
              onClick={handleClose}
              disabled={isSubmitting}
              className="p-2 rounded-md hover:bg-accent transition-colors disabled:opacity-50"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="p-6 space-y-6">
            {/* Name Input */}
            <div className="space-y-2">
              <label htmlFor="name" className="text-base font-semibold block">
                Name *
              </label>
              <Input
                id="name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Enter person's name"
                disabled={isSubmitting}
                required
                className="text-base"
              />
            </div>

            {/* Photo Upload */}
            <div className="space-y-2">
              <label htmlFor="photo" className="text-base font-semibold block">
                Photo (Optional)
              </label>
              <div className="flex items-start gap-4">
                {photoPreview ? (
                  <div className="relative w-32 h-32 rounded-lg overflow-hidden border-2 border-border">
                    <img
                      src={photoPreview}
                      alt="Preview"
                      className="w-full h-full object-cover"
                    />
                    <button
                      type="button"
                      className="absolute top-1 right-1 h-6 w-6 bg-red-500 hover:bg-red-600 text-white rounded-md flex items-center justify-center disabled:opacity-50"
                      onClick={() => {
                        setPhoto(null)
                        setPhotoPreview(null)
                      }}
                      disabled={isSubmitting}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <label
                    htmlFor="photo"
                    className="flex flex-col items-center justify-center w-32 h-32 border-2 border-dashed border-border rounded-lg cursor-pointer hover:border-primary transition-colors"
                  >
                    <Upload className="h-8 w-8 text-muted-foreground mb-2" />
                    <span className="text-sm text-muted-foreground">Upload</span>
                  </label>
                )}
                <Input
                  id="photo"
                  type="file"
                  accept="image/*"
                  onChange={handlePhotoChange}
                  disabled={isSubmitting}
                  className="hidden"
                />
                <div className="flex-1 text-sm text-muted-foreground">
                  Upload a photo of the person. Supported formats: JPG, PNG, JPEG.
                  Maximum size: 10MB.
                </div>
              </div>
            </div>

            {/* Server Selection for Watchlist Viewing */}
            <div className="space-y-2">
              <label className="text-base font-semibold block">
                Watchlist Selection
              </label>
              <div className="text-sm text-muted-foreground mb-3">
                Select a server to view its watchlist. When "All Servers" is selected, choose a watchlist from the dropdown.
                {Object.values(serverStatuses).some((s: any) => s.serverStatus === 'offline') && (
                  <div className="mt-2 text-amber-600 dark:text-amber-400 flex items-center gap-2">
                    <WifiOff className="h-4 w-4" />
                    If a server is offline, its watchlist will be fetched automatically once the server comes back online.
                  </div>
                )}
              </div>
              
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className={`inline-flex items-center gap-2 px-3 py-1.5 text-sm rounded-md border transition-colors ${
                    selectedServerForWatchlist === "all" 
                      ? 'bg-primary text-primary-foreground border-primary' 
                      : 'bg-background border-border hover:bg-accent'
                  } ${isSubmitting ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                  onClick={() => setSelectedServerForWatchlist("all")}
                  disabled={isSubmitting}
                >
                  <ServerIcon className="h-4 w-4" />
                  <span>All Servers</span>
                </button>
                
                {config.servers.map((server) => {
                  const status = serverStatuses[server.name]
                  const isOnline = status?.serverStatus === 'online'
                  const isOffline = status?.serverStatus === 'offline'
                  const isChecking = status?.serverStatus === 'checking'
                  const isLoading = status?.loading
                  
                  return (
                    <button
                      key={server.name}
                      type="button"
                      className={`inline-flex items-center gap-2 px-3 py-1.5 text-sm rounded-md border transition-colors ${
                        selectedServerForWatchlist === server.name 
                          ? 'bg-primary text-primary-foreground border-primary' 
                          : 'bg-background border-border hover:bg-accent'
                      } ${isSubmitting ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                      onClick={() => setSelectedServerForWatchlist(server.name)}
                      disabled={isSubmitting}
                    >
                      {isLoading || isChecking ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : isOnline ? (
                        <Wifi className="h-4 w-4 text-green-500" />
                      ) : isOffline ? (
                        <WifiOff className="h-4 w-4 text-red-500" />
                      ) : (
                        <ServerIcon className="h-4 w-4" />
                      )}
                      <span>{server.name}</span>
                      {status?.watchlists?.length > 0 && (
                        <span className="ml-1 px-1.5 py-0.5 text-xs bg-secondary text-secondary-foreground rounded">
                          {status.watchlists.length}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Watchlists Selection */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-base font-semibold block">
                  Watchlists (Optional)
                </label>
                <button
                  type="button"
                  onClick={handleRefreshWatchlists}
                  disabled={isSubmitting || watchlistsLoading}
                  className="px-3 py-1.5 text-sm rounded-md hover:bg-accent transition-colors disabled:opacity-50 flex items-center gap-2"
                >
                  <RefreshCw className={`h-4 w-4 ${watchlistsLoading ? 'animate-spin' : ''}`} />
                  Refresh
                </button>
              </div>
              <div className="relative">
                <button
                  type="button"
                  className="w-full px-3 py-2 text-left border border-input rounded-md hover:bg-accent transition-colors disabled:opacity-50 flex justify-between items-center"
                  onClick={() => setWatchlistDropdownOpen(!watchlistDropdownOpen)}
                  disabled={isSubmitting || watchlistsLoading}
                >
                  <span>
                    {selectedWatchlists.length === 0
                      ? 'Select watchlists...'
                      : `${selectedWatchlists.length} selected`}
                  </span>
                  <span className="ml-2">▼</span>
                </button>

                {watchlistDropdownOpen && (
                  <div className="absolute z-20 w-full mt-2 bg-background border border-border rounded-lg shadow-lg max-h-80 overflow-hidden flex flex-col">
                    {/* Search Bar */}
                    <div className="p-2 border-b border-border">
                      <Input
                        type="text"
                        placeholder="Search watchlists..."
                        value={watchlistSearchQuery}
                        onChange={(e) => setWatchlistSearchQuery(e.target.value)}
                        className="text-sm"
                        autoFocus
                      />
                    </div>
                    
                    {/* Watchlist Items */}
                    <div className="overflow-y-auto max-h-60">
                      {watchlistsLoading ? (
                        <div className="p-4 text-center text-muted-foreground">
                          <Loader2 className="h-5 w-5 animate-spin inline mr-2" />
                          Loading watchlists...
                        </div>
                      ) : watchlistsError ? (
                        <div className="p-4 text-center text-destructive">
                          {watchlistsError}
                        </div>
                      ) : watchlists.length === 0 ? (
                        <div className="p-4 text-center text-muted-foreground">
                          No watchlists available
                        </div>
                      ) : (() => {
                        const filteredWatchlists = watchlists.filter(wl => 
                          wl.name.toLowerCase().includes(watchlistSearchQuery.toLowerCase())
                        )
                        return filteredWatchlists.length === 0 ? (
                          <div className="p-4 text-center text-muted-foreground">
                            No watchlists match your search
                          </div>
                        ) : (
                          filteredWatchlists.map((wl) => {
                            const key = `${wl.serverName}:${wl.id}`
                            const isSelected = selectedWatchlists.includes(key)
                            return (
                              <div
                                key={key}
                                className="flex items-center gap-2 p-3 hover:bg-accent cursor-pointer"
                                onClick={() => toggleWatchlist(wl)}
                              >
                                <div className="flex items-center justify-center w-4 h-4 border border-border rounded">
                                  {isSelected && (
                                    <svg className="w-3 h-3" viewBox="0 0 12 12" fill="currentColor">
                                      <path d="M10 3L4.5 8.5L2 6" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                                    </svg>
                                  )}
                                </div>
                                <span className="flex-1">{wl.name}</span>
                                {wl.serverName && selectedServerForWatchlist === "all" && (
                                  <span className="text-xs text-muted-foreground">({wl.serverName})</span>
                                )}
                              </div>
                            )
                          })
                        )
                      })()}
                    </div>
                  </div>
                )}
              </div>

              {/* Selected watchlists badges */}
              {selectedWatchlists.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {selectedWatchlists.map((key) => {
                    const [serverName, idStr] = key.split(':')
                    const id = parseInt(idStr)
                    const wl = watchlists.find(w => w.id === id && w.serverName === serverName)
                    return wl ? (
                      <span key={key} className="inline-flex items-center gap-1 px-2 py-1 bg-secondary text-secondary-foreground rounded-md text-sm">
                        {wl.name}
                        {wl.serverName && selectedServerForWatchlist === "all" && (
                          <span className="text-xs opacity-70">({wl.serverName})</span>
                        )}
                        <button
                          type="button"
                          onClick={() => toggleWatchlist(wl)}
                          className="ml-1 hover:text-destructive"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ) : null
                  })}
                </div>
              )}
            </div>

            {/* Server Selection */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-base font-semibold block">
                  Target Servers *
                </label>
                <button
                  type="button"
                  onClick={selectAllServers}
                  disabled={isSubmitting}
                  className="px-3 py-1.5 text-sm border border-input rounded-md hover:bg-accent transition-colors disabled:opacity-50"
                >
                  {selectedServers.length === config.servers.length
                    ? 'Deselect All'
                    : 'Select All'}
                </button>
              </div>

              <div className="space-y-2 border border-border rounded-lg p-4">
                {config.servers.map((server) => (
                  <div
                    key={server.name}
                    className="flex items-center gap-3 p-2 hover:bg-accent rounded cursor-pointer"
                    onClick={() => toggleServer(server.name)}
                  >
                    <div className="flex items-center justify-center w-4 h-4 border border-border rounded">
                      {selectedServers.includes(server.name) && (
                        <svg className="w-3 h-3" viewBox="0 0 12 12" fill="currentColor">
                          <path d="M10 3L4.5 8.5L2 6" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      )}
                    </div>
                    <div className="flex-1">
                      <div className="font-medium">{server.name}</div>
                      <div className="text-sm text-muted-foreground">
                        {server.location}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {selectedServers.length > 0 && (
                <div className="text-sm text-muted-foreground">
                  Card will be added to {selectedServers.length} server(s)
                </div>
              )}
            </div>

            {/* Status Message */}
            {submitStatus.type && (
              <div
                className={`p-4 rounded-lg border ${
                  submitStatus.type === 'success'
                    ? 'bg-green-500/10 border-green-500/50 text-green-700 dark:text-green-400'
                    : submitStatus.type === 'partial'
                    ? 'bg-yellow-500/10 border-yellow-500/50 text-yellow-700 dark:text-yellow-400'
                    : 'bg-red-500/10 border-red-500/50 text-red-700 dark:text-red-400'
                }`}
              >
                <div className="flex items-start gap-2">
                  {submitStatus.type === 'success' ? (
                    <CheckCircle className="h-5 w-5 mt-0.5 flex-shrink-0" />
                  ) : (
                    <AlertCircle className="h-5 w-5 mt-0.5 flex-shrink-0" />
                  )}
                  <div className="flex-1">
                    <div className="font-semibold text-base">{submitStatus.message}</div>
                    {submitStatus.details && (
                      <div className="mt-3 space-y-2">
                        {/* Successful servers */}
                        {submitStatus.details.successful && submitStatus.details.successful.length > 0 && (
                          <div className="space-y-1">
                            {submitStatus.details.successful.map((s: any, i: number) => (
                              <div key={i} className="flex items-start gap-2 text-sm">
                                <CheckCircle className="h-4 w-4 mt-0.5 flex-shrink-0 text-green-600 dark:text-green-400" />
                                <div>
                                  <span className="font-medium">{s.server}</span>
                                  <span className="text-muted-foreground"> - Card ID: {s.cardId}</span>
                                  {s.photoUploaded && <span className="text-muted-foreground"> (Photo uploaded)</span>}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                        
                        {/* Failed servers */}
                        {submitStatus.details.failed && submitStatus.details.failed.length > 0 && (
                          <div className="space-y-1 mt-2">
                            {submitStatus.details.failed.map((f: any, i: number) => (
                              <div key={i} className="flex items-start gap-2 text-sm">
                                <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0 text-red-600 dark:text-red-400" />
                                <div>
                                  <span className="font-medium">{f.server}</span>
                                  <span className="text-muted-foreground"> - {simplifyErrorMessage(f.error)}</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex gap-3 pt-4">
              <button
                type="button"
                className="flex-1 px-4 py-2 border border-input rounded-md hover:bg-accent transition-colors disabled:opacity-50"
                onClick={handleClose}
                disabled={isSubmitting}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center"
                disabled={isSubmitting || !name.trim() || selectedServers.length === 0}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Adding Card...
                  </>
                ) : (
                  <>
                    <Plus className="mr-2 h-4 w-4" />
                    Add Card
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
        </div>
      )}
    </>
  )
}
