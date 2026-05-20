"use client";

import { useEffect } from "react";
import { useRightPanelStore, type PanelAction } from "@/lib/store/right-panel";

/**
 * Register the actions the mobile morph tab bar should show while this panel
 * is open. The bar swaps from its primary tabs into these buttons; closing the
 * panel (or this component unmounting) clears them.
 *
 * Pass `null` to leave the bar in its nav state — useful when a panel has no
 * meaningful actions yet (e.g. mid-load).
 *
 * @example
 * useMorphActions([
 *   { id: "attack", label: "Attack", onClick: handleAttack, variant: "primary" },
 *   { id: "skip",   label: "Skip",   onClick: handleSkip },
 * ]);
 */
export function useMorphActions(actions: PanelAction[] | null | undefined) {
  const setActions = useRightPanelStore((s) => s.setActions);
  const clearActions = useRightPanelStore((s) => s.clearActions);

  useEffect(() => {
    if (actions && actions.length > 0) {
      setActions(actions);
    } else {
      clearActions();
    }
    return () => {
      clearActions();
    };
    // The action list is rebuilt every render by the caller; rather than
    // deep-equal the array, depend on a stable signature so we only re-sync
    // when the contents actually changed.
  }, [
    setActions,
    clearActions,
    JSON.stringify(
      (actions ?? []).map((a) => [a.id, a.label, a.variant, a.disabled]),
    ),
  ]);
}
