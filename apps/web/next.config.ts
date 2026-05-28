import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  transpilePackages: ["novus-mundus-sdk"],
  // @napi-rs/canvas ships platform-specific .node binaries that Turbopack /
  // webpack can't bundle; load it as a real Node require at runtime instead.
  serverExternalPackages: ["@napi-rs/canvas"],
};

export default nextConfig;
