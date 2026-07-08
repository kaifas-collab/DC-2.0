"use client"

import { useEffect, useState } from 'react'
import { frsDataManager } from '@/lib/api'

export default function TestPage() {
  const [testResults, setTestResults] = useState<any>({})
  const [loading, setLoading] = useState(false)

  const runTests = async () => {
    setLoading(true)
    const results: any = {}
    
    try {
      console.log("🧪 Starting API tests...")
      
      // Test 1: Direct proxy call
      console.log("🧪 Test 1: Direct proxy API call")
      const proxyResponse = await fetch('/api/frs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serverName: 'FRS-Server-1',
          endpoint: '/cards/humans/'
        })
      })
      const proxyData = await proxyResponse.json()
      results.proxyTest = {
        status: proxyResponse.status,
        dataLength: proxyData.results?.length || 0,
        sample: proxyData.results?.[0] || 'No data'
      }
      console.log("✅ Proxy test result:", results.proxyTest)
      
      // Test 2: API Manager getAllCards
      console.log("🧪 Test 2: API Manager getAllCards")
      const cards = await frsDataManager.getAllCards()
      results.apiManagerTest = {
        cardsLength: cards.length,
        sample: cards[0] || 'No cards',
        syncStatus: frsDataManager.getSyncStatus()
      }
      console.log("✅ API Manager test result:", results.apiManagerTest)
      
      // Test 3: Manual refresh
      console.log("🧪 Test 3: Manual refresh")
      const refreshedCards = await frsDataManager.manualRefresh()
      results.manualRefreshTest = {
        cardsLength: refreshedCards.length,
        sample: refreshedCards[0] || 'No cards'
      }
      console.log("✅ Manual refresh test result:", results.manualRefreshTest)
      
    } catch (error) {
      console.error("❌ Test failed:", error)
      results.error = error instanceof Error ? error.message : String(error)
    }
    
    setTestResults(results)
    setLoading(false)
  }

  useEffect(() => {
    runTests()
  }, [])

  return (
    <div className="min-h-screen bg-background p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold mb-8">API Debug Test</h1>
        
        <button 
          onClick={runTests}
          disabled={loading}
          className="px-4 py-2 bg-blue-600 text-white rounded mb-6 disabled:bg-gray-400"
        >
          {loading ? 'Running Tests...' : 'Run Tests Again'}
        </button>
        
        <div className="space-y-6">
          <div className="bg-card p-6 rounded-lg border">
            <h2 className="text-xl font-semibold mb-4">Test Results</h2>
            <pre className="bg-muted p-4 rounded text-sm overflow-auto">
              {JSON.stringify(testResults, null, 2)}
            </pre>
          </div>
        </div>
      </div>
    </div>
  )
}
