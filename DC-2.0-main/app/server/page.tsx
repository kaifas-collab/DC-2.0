import { Suspense } from "react"
import ServerDashboard from "@/components/_comps/ServerDashboard"

export default function ServerPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-screen">Loading...</div>}>
      <ServerDashboard />
    </Suspense>
  )
}
