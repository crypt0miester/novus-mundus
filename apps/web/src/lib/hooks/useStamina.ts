"use client";

import { useState, useEffect } from "react";

interface StaminaResult {
  current: number;
  max: number;
  regenPerSecond: number;
}

/**
 * Calculate real-time stamina from on-chain snapshot.
 * The Rust program stores stamina at a point in time and it regens over time.
 * We interpolate client-side for smooth display.
 */
export function useStamina(
  storedStamina: number | undefined,
  lastStaminaUpdate: number | undefined,
  maxStamina: number | undefined,
  regenRate: number | undefined // per second
): StaminaResult {
  const [current, setCurrent] = useState(0);

  useEffect(() => {
    if (
      storedStamina === undefined ||
      lastStaminaUpdate === undefined ||
      maxStamina === undefined ||
      regenRate === undefined
    ) {
      return;
    }

    const update = () => {
      const now = Math.floor(Date.now() / 1000);
      const elapsed = now - lastStaminaUpdate;
      const regenerated = elapsed * regenRate;
      setCurrent(Math.min(maxStamina, Math.floor(storedStamina + regenerated)));
    };

    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [storedStamina, lastStaminaUpdate, maxStamina, regenRate]);

  return {
    current,
    max: maxStamina ?? 0,
    regenPerSecond: regenRate ?? 0,
  };
}
