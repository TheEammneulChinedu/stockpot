import type { NextConfig } from "next";

// @base-org/account's default (node) entry pulls server-only payment code (cdp-sdk / x402).
// The app only needs the browser SDK, so alias it everywhere.
const BASE_ACCOUNT_BROWSER = "@base-org/account/browser";

const nextConfig: NextConfig = {
  // Static export: deploy anywhere (Vercel, Cloudflare Pages, IPFS). Pot pages use ?address=.
  output: "export",
  images: { unoptimized: true },
  trailingSlash: true,
  turbopack: {
    resolveAlias: { "@base-org/account": BASE_ACCOUNT_BROWSER },
  },
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      "@base-org/account$": require.resolve(BASE_ACCOUNT_BROWSER),
    };
    return config;
  },
};

export default nextConfig;
