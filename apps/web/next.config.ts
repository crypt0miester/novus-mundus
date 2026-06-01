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
  serverExternalPackages: ["@napi-rs/canvas"],
  turbopack: {
    // The wallet-adapter `link:` symlinks resolve to a fork at
    // /Users/k/solana/wallet-adapter-v3 (a sibling of this repo). Turbopack
    // only bundles files under its root, so raise the root to the common
    // ancestor that contains both the repo and the fork.
    root: path.join(__dirname, "..", "..", "..", ".."),
  },
};

export default nextConfig;
