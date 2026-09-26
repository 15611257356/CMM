import type { NextConfig } from "next"

const basePath = process.env.PAGES_BASE_PATH || undefined

const nextConfig: NextConfig = {
  // 静态导出，供 GitHub Pages 长期托管。本地 `next dev` 不受影响。
  output: "export",
  basePath,
  // Cloudflare quick tunnels change hostnames; the wildcard keeps the preview
  // able to load dev chunks and hydrate (otherwise the 3D view stays on its fallback).
  allowedDevOrigins: ["127.0.0.1", "localhost", "*.trycloudflare.com"],
}

export default nextConfig
