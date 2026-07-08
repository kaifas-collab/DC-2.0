/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  experimental: {
    // Enables instrumentation.ts (register() on server boot), which starts the in-process sync
    // scheduler. Required on Next 13; on Next 15+ instrumentation is on by default.
    instrumentationHook: true,
  },
}

export default nextConfig
