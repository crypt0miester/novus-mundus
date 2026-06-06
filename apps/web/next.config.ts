import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // The wallet-adapter packages are symlinked (link:) to a local v3 fork outside
  // this app; Next/Turbopack only resolves+compiles linked packages listed here.
  transpilePackages: [
    "novus-mundus-sdk",
    "@solana/wallet-adapter-base",
    "@solana/wallet-adapter-react",
    "@solana/wallet-adapter-react-ui",
    "@solana/wallet-adapter-wallets",
  ],
  // @napi-rs/canvas ships platform-specific .node binaries that Turbopack /
  // webpack can't bundle; load it as a real Node require at runtime instead.
  // The Switchboard On-Demand SDK (used server-side in the shop cosign routes
  // for JIT oracle quotes) pulls protobufjs/bn.js through deep ESM that the
  // bundler mangles ("toBuffer is not a function"); externalize it so Node
  // requires the published package at runtime, where it works as shipped.
  serverExternalPackages: [
    "@napi-rs/canvas",
    "@switchboard-xyz/on-demand",
    "@switchboard-xyz/common",
    "@switchboard-xyz/common-legacy",
  ],
  turbopack: {
    // The wallet-adapter `link:` symlinks resolve to a fork at
    // /Users/k/solana/wallet-adapter-v3 (a sibling of this repo). Turbopack
    // only bundles files under its root, so raise the root to the common
    // ancestor that contains both the repo and the fork.
    root: path.join(__dirname, "..", "..", "..", ".."),
  },
  // The old /world detail pages were folded into the (game) route group and
  // the standalone /world tree was deleted. Keep old links alive by mapping
  // them to their new homes. permanent: false so the mapping can change later.
  async redirects() {
    return [
      { source: "/world", destination: "/map", permanent: false },
      { source: "/world/leaderboard", destination: "/leaderboard", permanent: false },
      { source: "/world/players/:a*", destination: "/players/:a*", permanent: false },
      { source: "/world/players", destination: "/players", permanent: false },
      { source: "/world/teams/:id", destination: "/team/:id", permanent: false },
      { source: "/world/teams", destination: "/team", permanent: false },
      { source: "/world/cities/:id", destination: "/cities/:id", permanent: false },
      { source: "/world/cities", destination: "/cities", permanent: false },
    ];
  },
};

export default nextConfig;
