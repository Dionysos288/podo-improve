import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow large STL binary uploads for the slicing pipeline (pair insoles
  // can be 20-40 MB). The proxy layer buffers the body in memory; default
  // is 10 MB which truncates the request and causes "body disturbed" errors.
  experimental: {
    proxyClientMaxBodySize: '50mb',
    serverActions: {
      bodySizeLimit: '50mb',
    },
  },
};

export default nextConfig;
