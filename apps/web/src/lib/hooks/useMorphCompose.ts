"use client";

import { useEffect, useId, useRef } from "react";
import { useMorphComposeStore, type ComposeDismiss } from "@/lib/store/morph-compose";

/**
 * Request that the mobile morph tab bar host this surface's composer while
 * `active` is true, and return the live slot element the bar paints (null until
 * the bar enters compose and publishes it, and null while this caller is not the
 * topmost owner). The caller portals its composer into the returned element.
 *
 * Each caller holds its own slot keyed by a stable `useId`, mirroring
 * `useMorphActions`: stacked surfaces don't clobber each other. Releases on
 * unmount or when `active` flips false.
 *
 * `dismiss` is the back/close control the bar shows in its circle on a sheet-less
 * surface (the full-page DM). Surfaces inside a BottomSheet (team dock) pass
 * `undefined`; the bar synthesizes a sheet-close from useSheetStore there.
 *
 * @example
 * const slotEl = useMorphCompose(isPhone && composeInBar, {
 *   icon: "back",
 *   onClick: () => router.push("/messages"),
 * });
 */
export function useMorphCompose(
  active: boolean,
  dismiss: ComposeDismiss | undefined,
): HTMLElement | null {
  const owner = useId();
  const register = useMorphComposeStore((s) => s.register);
  const unregister = useMorphComposeStore((s) => s.unregister);
  // Only the topmost owner reads a non-null slot; a lower entry portals to its
  // inline fallback. Subscribe to the slot only when this caller is on top.
  const slotEl = useMorphComposeStore((s) =>
    s.entries[s.entries.length - 1]?.owner === owner ? s.slotEl : null,
  );

  // Keep the live dismiss in a ref so the registered handler can't fire a stale
  // closure (e.g. a router not ready at first registration). Same discipline as
  // useMorphActions' `latest`: re-register only when the icon changes, run the
  // freshest closure regardless.
  const latest = useRef(dismiss);
  latest.current = dismiss;

  // Sync ownership + the published dismiss. Deliberately no cleanup in THIS
  // effect: a re-run on an active toggle must register/unregister directly, not
  // unregister-then-append (which would jump this owner ahead in the stack).
  // Re-runs only when active flips or the icon changes.
  useEffect(() => {
    if (!active) {
      unregister(owner);
      return;
    }
    const d = latest.current;
    register(owner, d ? { icon: d.icon, onClick: () => latest.current?.onClick() } : null);
  }, [owner, active, register, unregister, dismiss?.icon]);

  // Drop this surface's claim on unmount, and only its own.
  useEffect(() => () => unregister(owner), [owner, unregister]);

  return active ? slotEl : null;
}
