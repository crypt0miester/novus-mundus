"use client";

import { useEffect, useState } from "react";
import { canUseWebGL2 } from "./probe";

/**
 * True once mounted on a client that supports WebGL2. SSR-safe: returns false
 * during SSR and the first client render (so server and client markup match),
 * then flips true after mount. Centralises the mounted-gate + capability probe
 * the minigame WebGL/DOM choosers all need.
 */
export function useWebGL2Ready(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted && canUseWebGL2();
}
