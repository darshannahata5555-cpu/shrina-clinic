import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Internal, auth-gated app: every page is request-time dynamic, so we use the
  // classic dynamic rendering model rather than Cache Components.
  serverExternalPackages: ["exceljs", "qrcode"],
  experimental: {
    serverActions: { bodySizeLimit: "12mb" },
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
