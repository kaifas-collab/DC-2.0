"use client"

import { useState, useEffect } from "react"
import { frsDataManager } from "@/lib/api"
import type { UnifiedCardData } from "@/lib/types"

export default function DebugDashboard() {
  console.log("🚀 DebugDashboard: Component mounting")
  
  const [cards, setCards] = useState<UnifiedCardData[]>([])
  const [loading, setLoading] = useState(true)
  
  // Immediate test without useEffect
  console.log("🧪 Testing immediate FRSDataManager access...")
  try {
    const syncStatus = frsDataManager.getSyncStatus()
    console.log("🧪 Immediate sync status:", syncStatus)
    
    if (syncStatus.totalCards === 0) {
      console.log("🔄 No cached data found, triggering immediate refresh...")
      // Trigger immediate refresh without waiting for useEffect
      frsDataManager.refreshAllData().then((cards) => {
        console.log("✅ Immediate refresh successful:", cards.length, "cards")
        setCards(cards)
        setLoading(false)
      }).catch((error) => {
        console.error("❌ Immediate refresh failed:", error)
        setLoading(false)
      })
    } else {
      console.log("💾 Found cached data, getting cards...")
      frsDataManager.getAllCards().then((cards) => {
        console.log("💾 Retrieved cached cards:", cards.length)
        setCards(cards)
        setLoading(false)
      })
    }
  } catch (error) {
    console.error("🧪 Immediate FRSDataManager access failed:", error)
  }
  
  useEffect(() => {
    console.log("🚀 DebugDashboard: useEffect RUNNING! This should appear!")
    
    const loadCards = async () => {
      try {
        console.log("🚀 DebugDashboard: Getting cards from API manager...")
        const allCards = await frsDataManager.getAllCards()
        console.log("🚀 DebugDashboard: Retrieved cards:", allCards.length)
        setCards(allCards)
        setLoading(false)
      } catch (error) {
        console.error("🚀 DebugDashboard: Error:", error)
        setLoading(false)
      }
    }
    
    loadCards()
  }, [])
  
  console.log("🚀 DebugDashboard: Rendering with", cards.length, "cards, loading:", loading)
  
  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-4">Debug Dashboard</h1>
      <p className="mb-4">Loading: {loading ? 'Yes' : 'No'}</p>
      <p className="mb-4">Cards: {cards.length}</p>
      
      {loading && <p>Loading cards...</p>}
      
      {!loading && cards.length > 0 && (
        <div>
          <h2 className="text-xl font-semibold mb-2">Found {cards.length} cards:</h2>
          <div className="grid gap-4">
            {cards.slice(0, 3).map((card, index) => (
              <div key={index} className="border p-4 rounded">
                <h3 className="font-medium">{card.name}</h3>
                <p className="text-sm text-gray-600">Server: {card.server_name}</p>
                <p className="text-sm text-gray-600">ID: {card.card_id}</p>
              </div>
            ))}
          </div>
        </div>
      )}
      
      {!loading && cards.length === 0 && (
        <p className="text-red-600">No cards found</p>
      )}
    </div>
  )
}
