"use client"

import { useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import type { UnifiedCardData } from "@/lib/types"
import { X, Trash2 } from "lucide-react"
import FullFrameModal from "./FullFrameModal"

interface CardDetailsDrawerProps {
  card: UnifiedCardData
  onClose: () => void
  onDelete?: () => void
}

export default function CardDetailsDrawer({ card, onClose, onDelete }: CardDetailsDrawerProps) {
  const [showFullImage, setShowFullImage] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleteMode, setDeleteMode] = useState<'local' | 'both'>('local')
  const [isDeleting, setIsDeleting] = useState(false)

  const handleDelete = async (mode: 'local' | 'both') => {
    setIsDeleting(true)
    
    // Close drawer immediately for better UX
    onClose()
    
    try {
      const endpoint = mode === 'both' ? '/api/cards/delete-from-frs' : '/api/cards/delete'
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          server_url: card.server_url,
          card_id: card.card_id
        })
      })

      const data = await response.json()

      if (!data.success) {
        throw new Error(data.error || 'Failed to delete card')
      }

      // Call the parent's onDelete callback to refresh the list
      if (onDelete) {
        onDelete()
      }
      
      // Show success message after operations complete
      setTimeout(() => {
        if (mode === 'both' && data.operations) {
          if (data.operations.frsDeleted) {
            alert('✅ Card deleted from both FRS server and local database!')
          } else {
            alert(`⚠️ Card deleted locally, but FRS deletion failed:\n${data.operations.frsError}\n\nThe card will re-sync on next refresh.`)
          }
        } else {
          alert('✅ Card deleted successfully!')
        }
      }, 100)
      
    } catch (error) {
      console.error('Failed to delete card:', error)
      alert(`Failed to delete card: ${error instanceof Error ? error.message : 'Unknown error'}`)
    } finally {
      setIsDeleting(false)
      setShowDeleteConfirm(false)
    }
  }

  return (
    <AnimatePresence>
      {card && (
        <>
          {/* Backdrop */}
          <motion.div
            key="drawer-backdrop"
            className="fixed inset-0 bg-black/40 z-40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />

          {/* Drawer */}
          <motion.div
            key="drawer-content"
            className="fixed right-0 top-0 h-screen w-full max-w-md bg-card border-l border-border shadow-lg z-50 flex flex-col"
            initial={{ x: 400, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 400, opacity: 0 }}
            transition={{ type: "spring", damping: 30, stiffness: 300 }}
          >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-border">
          <h2 className="text-lg font-semibold text-foreground">Card Details</h2>
          <button onClick={onClose} className="p-1 hover:bg-muted rounded-lg transition-colors">
            <X className="w-5 h-5 text-foreground" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Image */}
          <motion.div
            className="w-full rounded-lg overflow-hidden cursor-pointer group"
            whileHover={{ scale: 1.02 }}
            onClick={() => setShowFullImage(true)}
          >
            <div className="relative aspect-square bg-muted overflow-hidden rounded-lg">
              <img
                src={card.thumbnail_url || card.photo || "/placeholder.svg"}
                alt={card.name}
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
              />
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors duration-300 flex items-center justify-center">
                <span className="text-white text-sm font-medium opacity-0 group-hover:opacity-100 transition-opacity">
                  View Full Size
                </span>
              </div>
            </div>
          </motion.div>

          {/* Details */}
          <div className="space-y-4">
            <div className="bg-muted/50 rounded-lg p-4">
              <p className="text-xs text-muted-foreground mb-2">CARD ID</p>
              <p className="font-mono text-sm font-semibold text-foreground">{card.card_id}</p>
            </div>

            <div className="bg-muted/50 rounded-lg p-4">
              <p className="text-xs text-muted-foreground mb-2">PERSON NAME</p>
              <p className="text-sm font-semibold text-foreground">{card.name}</p>
            </div>

            <div className="bg-muted/50 rounded-lg p-4">
              <p className="text-xs text-muted-foreground mb-2">SERVER</p>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-primary" />
                <p className="text-sm font-semibold text-foreground">{card.server_name}</p>
              </div>
              <p className="text-xs text-muted-foreground mt-1">{card.server_location}</p>
            </div>

            {card.watchlist_name && (
              <div className="bg-muted/50 rounded-lg p-4">
                <p className="text-xs text-muted-foreground mb-2">WATCHLIST</p>
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-primary" />
                  <p className="text-sm font-semibold text-foreground">{card.watchlist_name}</p>
                </div>
              </div>
            )}

            {card.last_updated && (
              <div className="bg-muted/50 rounded-lg p-4">
                <p className="text-xs text-muted-foreground mb-2">LAST UPDATED</p>
                <p className="text-sm text-foreground">{new Date(card.last_updated).toLocaleString()}</p>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-border bg-card/50 backdrop-blur-sm space-y-3">
          {showDeleteConfirm ? (
            <>
              <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-3 mb-3">
                <p className="text-sm text-destructive font-medium">Choose deletion option:</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {deleteMode === 'local' 
                    ? 'Delete only from local database. Card will re-sync from FRS server.'
                    : 'Delete from both FRS server and local database. This is permanent!'}
                </p>
              </div>

              {/* Delete Mode Toggle */}
              <div className="grid grid-cols-2 gap-2 mb-3">
                <button
                  onClick={() => setDeleteMode('local')}
                  disabled={isDeleting}
                  className={`py-2 px-3 text-xs font-medium rounded-lg transition-all ${
                    deleteMode === 'local'
                      ? 'bg-orange-500/20 text-orange-600 border-2 border-orange-500'
                      : 'bg-muted text-muted-foreground border-2 border-transparent hover:border-muted-foreground/20'
                  }`}
                >
                  <div className="flex flex-col items-center gap-1">
                    <span>Local Only</span>
                    <span className="text-[10px] opacity-70">Will re-sync</span>
                  </div>
                </button>
                <button
                  onClick={() => setDeleteMode('both')}
                  disabled={isDeleting}
                  className={`py-2 px-3 text-xs font-medium rounded-lg transition-all ${
                    deleteMode === 'both'
                      ? 'bg-destructive/20 text-destructive border-2 border-destructive'
                      : 'bg-muted text-muted-foreground border-2 border-transparent hover:border-muted-foreground/20'
                  }`}
                >
                  <div className="flex flex-col items-center gap-1">
                    <span>FRS + Local</span>
                    <span className="text-[10px] opacity-70">Permanent</span>
                  </div>
                </button>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  disabled={isDeleting}
                  className="flex-1 py-2 px-4 text-sm font-medium text-foreground bg-muted rounded-lg hover:bg-muted/80 transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleDelete(deleteMode)}
                  disabled={isDeleting}
                  className="flex-1 py-2 px-4 text-sm font-medium text-white bg-destructive rounded-lg hover:bg-destructive/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {isDeleting ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                      Deleting...
                    </>
                  ) : (
                    <>
                      <Trash2 className="w-4 h-4" />
                      Delete {deleteMode === 'both' ? 'Permanently' : 'Locally'}
                    </>
                  )}
                </button>
              </div>
            </>
          ) : (
            <>
              <button
                onClick={() => {
                  setDeleteMode('local')
                  setShowDeleteConfirm(true)
                }}
                className="w-full py-2 px-4 text-sm font-medium text-destructive bg-destructive/10 rounded-lg hover:bg-destructive/20 transition-colors flex items-center justify-center gap-2"
              >
                <Trash2 className="w-4 h-4" />
                Delete Card
              </button>
              <button
                onClick={onClose}
                className="w-full py-2 px-4 text-sm font-medium text-primary bg-primary/10 rounded-lg hover:bg-primary/20 transition-colors"
              >
                Close
              </button>
            </>
          )}
        </div>
      </motion.div>

      {/* Fullscreen Modal */}
      {showFullImage && (
        <FullFrameModal
          imageUrl={card.fullframe_url || card.photo || "/placeholder.svg"}
          personName={card.name}
          onClose={() => setShowFullImage(false)}
        />
      )}
        </>
      )}
    </AnimatePresence>
  )
}
