import { fileURLToPath } from "node:url";

/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingRoot: fileURLToPath(new URL("../../", import.meta.url)),
  // Standalone tracing creates symlinks that require elevated privileges on
  // Windows. Docker enables it explicitly for the production image.
  ...(process.env.DOCKER_BUILD === "1" ? { output: "standalone" } : {}),
  reactStrictMode: true,
  async rewrites() {
    const api = process.env.API_INTERNAL_URL;
    return api ? [{ source: "/api/:path*", destination: `${api}/api/:path*` }] : [];
  },
};

export default nextConfig;
