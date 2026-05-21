"use client";

import { useEffect, useId, useRef } from "react";
import { useRightPanelStore, type PanelAction } from "@/lib/store/right-panel";

/**
 * Register the actions the mobile morph tab bar should show while this panel
 * is open. The bar swaps from its primary tabs into these buttons; closing the
 * panel (or this component unmounting) clears them.
 *
 * Pass `null` to leave the bar in its nav state — useful when a panel has no
 * meaningful actions yet (e.g. mid-load).
 *
 * Each caller holds its own slot in the store, keyed by a stable `useId`, so
 * panels whose lifetimes overlap don't clobber each other: the bar shows the
 * most recently registered panel and falls back to the next when one closes.
 *
 * @example
 * useMorphActions([
 *   { id: "attack", label: "Attack", onClick: handleAttack, variant: "primary" },
 *   { id: "skip",   label: "Skip",   onClick: handleSkip },
 * ]);
 */
export function useMorphActions(actions: PanelAction[] | null | undefined) {
  const owner = useId();
  const register = useRightPanelStore((s) => s.registerMorphActions);
  const unregister = useRightPanelStore((s) => s.unregisterMorphActions);

  // The caller rebuilds the list every render, but the effect below only
  // re-registers when an action's id/label/variant/disabled changes — never
  // for a handler rebuilt with the same signature. So keep the live list in a
  // ref and have each registered onClick delegate to it; otherwise the bar
  // could fire a handler that closed over stale state (e.g. an account that
  // hadn't loaded yet at registration time).
  const latest = useRef(actions);
  latest.current = actions;

  // Sync this panel's actions into its own slot whenever the signature
  // changes. Deliberately no cleanup here: a re-run must upsert in place, not
  // unregister-then-append (which would jump the panel ahead of others in the
  // stack).
  useEffect(() => {
    const list = actions ?? [];
    if (list.length === 0) {
      unregister(owner);
      return;
    }
    register(
      owner,
      list.map((a) => ({
        ...a,
        onClick: (reportPhase) =>
          ((latest.current ?? []).find((x) => x.id === a.id) ?? a).onClick(
            reportPhase,
          ),
      })),
    );
  }, [
    owner,
    register,
    unregister,
    JSON.stringify(
      (actions ?? []).map((a) => [a.id, a.label, a.variant, a.disabled]),
    ),
  ]);

  // Drop this panel's slot on unmount — and only its own, so other open
  // panels keep theirs.
  useEffect(() => () => unregister(owner), [owner, unregister]);
}
