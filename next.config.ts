import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  // Cloudflare quick tunnels change hostnames; the wildcard keeps the preview
  // able to load dev chunks and hydrate (otherwise the 3D view stays on its fallback).
  allowedDevOrigins: ["127.0.0.1", "localhost", "*.trycloudflare.com"],
}

export default nextConfig
