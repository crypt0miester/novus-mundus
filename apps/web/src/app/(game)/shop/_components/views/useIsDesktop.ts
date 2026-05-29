"use client";

import { useState, useEffect } from "react";

/**
 * Tracks whether the viewport is desktop-width (>= 1024px), read once on mount.
 * Drives the shop views' desktop-default selection so the detail sidebar is
 * always populated on wide screens.
 */
export function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    setIsDesktop(window.innerWidth >= 1024);
  }, []);
  return isDesktop;
}
