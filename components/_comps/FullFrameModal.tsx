"use client"
import { motion, AnimatePresence } from "framer-motion"
import { X, Download } from "lucide-react"

interface FullFrameModalProps {
  imageUrl: string
  personName: string
  onClose: () => void
}

export default function FullFrameModal({ imageUrl, personName, onClose }: FullFrameModalProps) {
  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 bg-black z-50 flex flex-col"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      >
        {/* Controls */}
        <div className="relative z-10 flex items-center justify-between p-6 bg-gradient-to-b from-black/80 to-transparent">
          <div>
            <h3 className="text-lg font-semibold text-white">{personName}</h3>
            <p className="text-sm text-gray-400">Full Frame View</p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                const link = document.createElement("a")
                link.href = imageUrl
                link.download = `${personName}-${Date.now()}.jpg`
                link.click()
              }}
              className="p-2 hover:bg-white/10 rounded-lg transition-colors text-white"
              title="Download image"
            >
              <Download className="w-5 h-5" />
            </button>
            <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-lg transition-colors text-white">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Image */}
        <motion.div
          className="flex-1 flex items-center justify-center overflow-hidden"
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          transition={{ duration: 0.3 }}
        >
          <img src={imageUrl || "/placeholder.svg"} alt={personName} className="max-w-full max-h-full object-contain" />
        </motion.div>

        {/* Footer Info */}
        <div className="bg-gradient-to-t from-black/80 to-transparent p-6 text-center text-gray-400 text-sm">
          Press ESC or click X to close • Click and drag to pan • Scroll to zoom
        </div>
      </motion.div>
    </AnimatePresence>
  )
}
