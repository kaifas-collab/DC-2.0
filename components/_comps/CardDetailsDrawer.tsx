"use client"

import { useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import type { LogicalCardData } from "@/lib/types"
import { X, Trash2 } from "lucide-react"
import FullFrameModal from "./FullFrameModal"

interface CardDetailsDrawerProps {
  card: LogicalCardData
  onClose: () => void
  onDelete?: () => void
}

export default function CardDetailsDrawer({ card, onClose, onDelete }: CardDetailsDrawerProps) {
  const [showFullImage, setShowFullImage] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)

  // The DC is the sole delete authority: one action removes the card from every connected FRS
  // server (and the DC's own mapping) - there's no more "local only" option, since a local-only
  // delete would just get auto-restored by the sync engine on the next cycle anyway.
  const handleDelete = async () => {
    setIsDeleting(true)

    try {
      const response = await fetch('/api/cards/cluster-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ globalCardUuid: card.globalCardUuid })
      })

      const data = await response.json()

      if (!data.success) {
        if (response.status === 409 && data.offlineServers) {
          throw new Error(`Cannot delete - ${data.offlineServers.length} server(s) offline: ${data.offlineServers.join(', ')}`)
        }
        throw new Error(data.error || 'Failed to delete card')
      }

      onClose()
      if (onDelete) {
        onDelete()
      }

      setTimeout(() => {
        alert('✅ Delete started - propagating to all servers. It will disappear from the list once every server confirms.')
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
                src={card.photo || "/placeholder.svg"}
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
              <p className="text-xs text-muted-foreground mb-2">PERSON NAME</p>
              <p className="text-sm font-semibold text-foreground">{card.name}</p>
            </div>

            {card.comment && (
              <div className="bg-muted/50 rounded-lg p-4">
                <p className="text-xs text-muted-foreground mb-2">COMMENT</p>
                <p className="text-sm text-foreground whitespace-pre-wrap">{card.comment}</p>
              </div>
            )}

            {card.watchlist && (
              <div className="bg-muted/50 rounded-lg p-4">
                <p className="text-xs text-muted-foreground mb-2">WATCHLIST</p>
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-primary" />
                  <p className="text-sm font-semibold text-foreground">{card.watchlist}</p>
                </div>
              </div>
            )}

            {card.updatedAt && (
              <div className="bg-muted/50 rounded-lg p-4">
                <p className="text-xs text-muted-foreground mb-2">LAST UPDATED</p>
                <p className="text-sm text-foreground">{new Date(card.updatedAt).toLocaleString()}</p>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-border bg-card/50 backdrop-blur-sm space-y-3">
          {showDeleteConfirm ? (
            <>
              <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-3 mb-3">
                <p className="text-sm text-destructive font-medium">Delete everywhere?</p>
                <p className="text-xs text-muted-foreground mt-1">
                  This removes the card from every connected FRS server and cannot be undone. If any
                  server is currently offline, the delete will be blocked.
                </p>
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
                  onClick={handleDelete}
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
                      Delete Everywhere
                    </>
                  )}
                </button>
              </div>
            </>
          ) : (
            <>
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="w-full py-2 px-4 text-sm font-medium text-destructive bg-destructive/10 rounded-lg hover:bg-destructive/20 transition-colors flex items-center justify-center gap-2"
              >
                <Trash2 className="w-4 h-4" />
                Delete Everywhere
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
          imageUrl={card.photo || "/placeholder.svg"}
          personName={card.name}
          onClose={() => setShowFullImage(false)}
        />
      )}
        </>
      )}
    </AnimatePresence>
  )
}
