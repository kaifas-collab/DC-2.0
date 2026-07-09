"use client"
import { motion } from "framer-motion"
import type { CardData } from "@/config/config"
import { Card } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Checkbox } from "@/components/ui/checkbox"
import { Check } from "lucide-react"

interface CardGridProps {
  cards: CardData[]
  onCardClick: (card: CardData) => void
  loading?: boolean
  selectionMode?: boolean
  selectedCards?: Set<string>
  onCardSelect?: (cardId: string, selected: boolean) => void
}

export default function CardGrid({ 
  cards, 
  onCardClick, 
  loading,
  selectionMode = false,
  selectedCards = new Set(),
  onCardSelect
}: CardGridProps) {
  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: { staggerChildren: 0.05, delayChildren: 0 },
    },
  }

  const itemVariants = {
    hidden: { opacity: 0, scale: 0.95 },
    visible: { opacity: 1, scale: 1, transition: { duration: 0.3 } },
  }

  if (loading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {[...Array(8)].map((_, i) => (
          <Card key={i} className="h-64 p-4">
            <Skeleton className="w-full h-full rounded-lg" />
          </Card>
        ))}
      </div>
    )
  }

  return (
    <motion.div
      key={`cards-${cards.length}`}
      className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      {cards.map((card) => {
        const isSelected = selectedCards.has(card.cardId)
        
        return (
          <motion.div key={card.cardId} variants={itemVariants}>
            <Card
              className={`overflow-hidden cursor-pointer group h-auto min-h-[320px] flex flex-col transition-all duration-300 ${
                isSelected 
                  ? 'ring-2 ring-primary border-primary shadow-lg' 
                  : 'hover:shadow-lg hover:border-primary/50'
              }`}
              onClick={(e) => {
                if (selectionMode && onCardSelect) {
                  e.stopPropagation()
                  onCardSelect(card.cardId, !isSelected)
                } else {
                  onCardClick(card)
                }
              }}
            >
              {/* Selection Checkbox (shown in selection mode) */}
              {selectionMode && (
                <div className="absolute top-3 left-3 z-10">
                  <div 
                    className={`w-6 h-6 rounded-md border-2 flex items-center justify-center transition-all ${
                      isSelected 
                        ? 'bg-primary border-primary' 
                        : 'bg-background border-muted-foreground/30 group-hover:border-primary/50'
                    }`}
                    onClick={(e) => {
                      e.stopPropagation()
                      if (onCardSelect) {
                        onCardSelect(card.cardId, !isSelected)
                      }
                    }}
                  >
                    {isSelected && <Check className="w-4 h-4 text-primary-foreground" />}
                  </div>
                </div>
              )}

              {/* Image Container */}
              <div className="relative w-full h-48 overflow-hidden bg-muted flex items-center justify-center">
                <img
                  src={card.thumbnail || "/placeholder.svg"}
                  alt={card.personName}
                  className="max-w-full max-h-full object-contain group-hover:scale-105 transition-transform duration-300"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/30 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
              </div>

              {/* Info Container */}
              <div className="flex-1 p-4 flex flex-col justify-between border-t border-border">
                <div>
                  <p className="text-xs text-muted-foreground mb-1">ID: {card.cardId}</p>
                  <h4 className="font-semibold text-foreground text-sm truncate">{card.personName}</h4>
                </div>
                <div className="flex items-center gap-2 pt-2 border-t border-border">
                  <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                  <span className="text-xs text-muted-foreground truncate">{card.watchlistName}</span>
                </div>
              </div>
            </Card>
          </motion.div>
        )
      })}
    </motion.div>
  )
}
