"use client"

import { useState, useMemo, useEffect } from "react"
import Link from "next/link"
import { motion } from "framer-motion"
import { useServerConfig } from "@/hooks/useServerConfig"
import { Card } from "@/components/ui/card"
import SearchBar from "./SearchBar"
import ThemeToggle from "./ThemeToggle"
import Pagination from "./Pagination"
import {
  RefreshCw,
  Clock,
  Server,
  Users,
  AlertCircle,
  CheckCircle,
  Grid3x3,
  Calendar,
  Eye
} from "lucide-react"

export default function DashboardHome() {
  const { config, legacyServers } = useServerConfig()
  const [searchQuery, setSearchQuery] = useState("")
  const [isMounted, setIsMounted] = useState(false)
  const [serverHealth, setServerHealth] = useState<Record<string, boolean>>({})
  const [healthCheckLoading, setHealthCheckLoading] = useState(true)
  const [currentPage, setCurrentPage] = useState(1)
  const itemsPerPage = 10

  // Ensure animations only run after hydration
  useEffect(() => {
    setIsMounted(true)
  }, [])

  // Health check function - real FRS-API check (not ICMP ping), so a server that responds to
  // ping but has its FRS service down correctly shows as offline.
  const checkServerHealth = async (server: any) => {
    try {
      if (!server.name) {
        console.log(`❌ No server name found for health check`)
        return false
      }

      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 8000)

      try {
        const response = await fetch('/api/health-check', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache'
          },
          body: JSON.stringify({ serverName: server.name }),
          signal: controller.signal,
          cache: 'no-store',
          keepalive: true
        })

        clearTimeout(timeoutId)

        if (!response.ok) {
          console.log(`❌ Health check response not OK for ${server.name}: ${response.status}`)
          return false
        }

        const result = await response.json()
        console.log(`🏥 Health check result for ${server.name}:`, result)
        return result.success && result.online
      } catch (fetchError) {
        clearTimeout(timeoutId)
        throw fetchError
      }
    } catch (error) {
      // Log the specific error type
      if (error instanceof Error) {
        console.log(`❌ Health check failed for ${server.name}:`, error.message)
      } else {
        console.log(`❌ Health check failed for ${server.name}:`, error)
      }
      return false
    }
  }

  // Health check effect - delayed initial check
  useEffect(() => {
    const checkAllServers = async () => {
      setHealthCheckLoading(true)
      const healthStatus: Record<string, boolean> = {}
      
      // Check each server in parallel for speed
      const healthChecks = config.servers.map(async (server) => {
        const isHealthy = await checkServerHealth(server)
        healthStatus[server.name] = isHealthy
        console.log(`🏥 ${server.name} health check: ${isHealthy ? '✅ Online' : '❌ Offline'}`)
      })
      
      await Promise.allSettled(healthChecks) // Wait for all checks to complete
      setServerHealth(healthStatus)
      setHealthCheckLoading(false)
    }
    
    // Delay initial check by 2 seconds to let page load first
    const initialCheckTimer = setTimeout(() => {
      checkAllServers()
    }, 2000)
    
    // Recheck based on config refresh interval (convert seconds to milliseconds)
    const healthCheckInterval = (config.refreshIntervalSeconds || 240) * 1000
    const interval = setInterval(checkAllServers, healthCheckInterval)
    
    console.log(`🏥 Health check interval set to ${healthCheckInterval/1000} seconds`)
    
    return () => {
      clearTimeout(initialCheckTimer)
      clearInterval(interval)
    }
  }, [])

  const filteredServers = useMemo(() => {
    const query = searchQuery.toLowerCase().trim()
    console.log(`🔍 DashboardHome: Query="${query}", isEmpty: ${!query}`)
    
    if (!query) {
      console.log(`📋 DashboardHome: Empty search, returning all ${legacyServers.length} servers`)
      return legacyServers
    }
    
    console.log(`🔍 DashboardHome: Searching for "${query}"`)
    const filtered = legacyServers.filter(
      (server) =>
        server.name.toLowerCase().includes(query) ||
        server.ip.toLowerCase().includes(query) ||
        server.location.toLowerCase().includes(query),
    )
    console.log(`📋 DashboardHome: Filtered to ${filtered.length} servers`)
    return filtered
  }, [searchQuery, legacyServers])

  // Reset to page 1 when search changes
  useEffect(() => {
    setCurrentPage(1)
  }, [searchQuery])

  // Paginated servers
  const paginatedServers = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage
    const endIndex = startIndex + itemsPerPage
    const paginated = filteredServers.slice(startIndex, endIndex)
    console.log(`📄 Pagination: page ${currentPage}, showing ${startIndex}-${endIndex} of ${filteredServers.length} servers, result: ${paginated.length} servers`)
    return paginated
  }, [filteredServers, currentPage, itemsPerPage])

  const totalPages = Math.ceil(filteredServers.length / itemsPerPage)

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: { staggerChildren: 0.1, delayChildren: 0.2 },
    },
  }

  const itemVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.4 } },
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <motion.header
        className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur-sm"
        initial={isMounted ? { opacity: 0, y: -20 } : { opacity: 1, y: 0 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        <div className="px-6 py-4 flex items-center justify-between max-w-7xl mx-auto">
          <div className="flex items-center gap-4">
            <img
              src="/oe-logo-black.png"
              alt=" "
              className="h-10 w-auto dark:hidden"
            />
            <img
              src="/oe-logo-white.png"
              alt=" "
              className="h-10 w-auto hidden dark:block"
            />
            <div>
              <h1 className="text-2xl font-semibold text-foreground">Central FR Face DB</h1>
              <p className="text-xs text-muted-foreground">Server Management</p>
            </div>
          </div>
          <ThemeToggle />
        </div>
      </motion.header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-6 py-10">
        {/* Title Section */}
        <motion.div className="mb-10" initial={isMounted ? { opacity: 0 } : { opacity: 1 }} animate={{ opacity: 1 }} transition={{ duration: 0.5 }}>
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold text-foreground mb-2">FRS Servers</h2>
              <p className="text-muted-foreground">
                Manage and monitor all connected facial recognition system servers
              </p>
            </div>
            <div className="flex items-center gap-4">
              <Link href="/dashboard">
                <button className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors text-sm font-medium">
                  View All Records
                </button>
              </Link>
              <div className="text-right">
                <div className="text-3xl font-bold text-primary">
                  {healthCheckLoading ? '...' : Object.values(serverHealth).filter(Boolean).length}
                </div>
                <p className="text-sm text-muted-foreground">
                  {healthCheckLoading ? 'Checking' : 'Online Servers'}
                </p>
              </div>
            </div>
          </div>
        </motion.div>

        {/* Search Bar */}
        <motion.div
          className="mb-8"
          initial={isMounted ? { opacity: 0 } : { opacity: 1 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.1 }}
        >
          <SearchBar
            placeholder="Search servers by name or IP address..."
            value={searchQuery}
            onChange={setSearchQuery}
          />
        </motion.div>

        {/* Server Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {paginatedServers.map((server, index) => {
          console.log(`🎨 Rendering server card ${index + 1}:`, server.name, server.ip)
          const isOnline = serverHealth[server.name] ?? false
          const isLoading = healthCheckLoading
          
          return (
            <Card key={server.ip} className={`h-full p-6 transition-all duration-300 ${
              isOnline ? 'bg-card' : 'opacity-75 bg-card/50 border border-dashed border-red-400'
            }`}>
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-lg ${
                    isOnline ? 'bg-primary/10' : 'bg-red-100 dark:bg-red-900'
                  }`}>
                    <Server className={`w-5 h-5 ${
                      isOnline ? 'text-primary' : 'text-red-600 dark:text-red-400'
                    }`} />
                  </div>
                  <h3 className="font-semibold text-foreground">{server.name}</h3>
                </div>

                {/* Real-time status indicator */}
                {isLoading ? (
                  <div className="animate-pulse">
                    <div className="w-2 h-2 bg-gray-400 rounded-full"></div>
                  </div>
                ) : (
                  <div className={`w-2 h-2 rounded-full ${
                    isOnline ? 'bg-green-500 animate-pulse' : 'bg-red-500'
                  }`} />
                )}
              </div>

              <div className="space-y-3 mt-6 pt-4 border-t border-border">
                <div>
                  <p className="text-xs text-muted-foreground mb-1">IP Address</p>
                  <p className="font-mono text-sm text-foreground">{server.ip}</p>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  {isLoading ? (
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-gray-400"></div>
                      <span>Checking...</span>
                    </div>
                  ) : (
                    <>
                      <div className={`w-1.5 h-1.5 rounded-full ${
                        isOnline ? 'bg-green-500' : 'bg-red-500'
                      }`} />
                      <span className={
                        isOnline
                          ? 'text-green-600 dark:text-green-400 font-medium'
                          : 'text-red-600 dark:text-red-400 font-medium'
                      }>
                        {isOnline ? 'Online' : 'Offline'}
                      </span>
                    </>
                  )}
                </div>
              </div>
            </Card>
          )
        })}
        </div>

        {/* Pagination */}
        {filteredServers.length > 0 && (
          <Pagination
            currentPage={currentPage}
            totalPages={totalPages}
            onPageChange={setCurrentPage}
            itemsPerPage={itemsPerPage}
            totalItems={filteredServers.length}
          />
        )}

        {filteredServers.length === 0 && (
          <motion.div
            className="text-center py-16"
            initial={isMounted ? { opacity: 0 } : { opacity: 1 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3 }}
          >
            <Server className="w-12 h-12 text-muted-foreground mx-auto mb-4 opacity-50" />
            <p className="text-muted-foreground">No servers found matching your search</p>
          </motion.div>
        )}
      </main>
    </div>
  )
}
