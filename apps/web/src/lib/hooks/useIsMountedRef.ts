"use client";

import { useEffect, useRef } from "react";

/**
 * Returns a ref whose `.current` is `true` while the component is mounted,
 * `false` once it unmounts. Use for guard-rails around async work whose
 * resolver may run after a panel/page closes — calling `close()` or
 * `setState` on an unmounted component otherwise either no-ops with a dev
 * warning, or worse, races with a re-mount under React StrictMode.
 *
 * @example
 *   const isMounted = useIsMountedRef();
 *   await transact.mutateAsync(...);
 *   if (isMounted.current) close();
 */
export function useIsMountedRef() {
  const ref = useRef(true);
  useEffect(() => {
    ref.current = true;
    return () => {
      ref.current = false;
    };
  }, []);
  return ref;
}
