import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

function gitValue(args, fallback) {
  try {
    return (
      execFileSync("git", args, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim() || fallback
    );
  } catch {
    return fallback;
  }
}

const buildVersion =
  process.env.MCP_OPS_VERSION ??
  gitValue(["describe", "--tags", "--always"], "development");
const buildCommit =
  process.env.MCP_OPS_COMMIT_SHA ??
  process.env.GITHUB_SHA ??
  gitValue(["rev-parse", "HEAD"], "unknown");

/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingRoot: fileURLToPath(new URL("../../", import.meta.url)),
  // Linting is a repository-level CI step. Keeping it out of next build avoids
  // running a second, partial lint pass with a different working directory.
  eslint: { ignoreDuringBuilds: true },
  env: {
    NEXT_PUBLIC_MCP_OPS_VERSION: buildVersion,
    NEXT_PUBLIC_MCP_OPS_COMMIT_SHA: buildCommit,
  },
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
