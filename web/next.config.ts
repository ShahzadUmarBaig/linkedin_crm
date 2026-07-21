import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Server actions default to 1MB; the /compose/new "write from scratch" flow uploads
    // user images up to 8MB (see lib/storage.ts). Give a small buffer for form fields.
    serverActions: {
      bodySizeLimit: '10mb',
    },
  },
};

export default nextConfig;
