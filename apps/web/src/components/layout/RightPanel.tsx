"use client";

import { useEffect, useCallback, lazy, Suspense, type ComponentType } from "react";
import { useRightPanelStore } from "@/lib/store/right-panel";
import { BuildingUpgradePanel } from "@/components/panels/BuildingUpgradePanel";
import { ResearchPanel } from "@/components/panels/ResearchDetailPanel";

// ── Panel component registry ──
// Components resolved by contentKey from the store.
const PANELS: Record<string, ComponentType<any>> = {
  "building-detail": BuildingUpgradePanel,
  "building-speedup": BuildingUpgradePanel,
  "research": ResearchPanel,
};

/** Register a panel component for a given key. Call at module scope. */
export function registerPanel(key: string, component: ComponentType<any>) {
  PANELS[key] = component;
}

function PanelContent() {
  const contentKey = useRightPanelStore((s) => s.contentKey);
  const contentProps = useRightPanelStore((s) => s.contentProps);

  if (!contentKey) return null;

  const Component = PANELS[contentKey];
  if (!Component) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-xs text-red-400">Unknown panel: {contentKey}</p>
      </div>
    );
  }

  return (
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center">
          <p className="text-xs text-text-muted">Loading...</p>
        </div>
      }
    >
      <Component {...contentProps} />
    </Suspense>
  );
}

/** RightPanel — desktop: fixed sidebar. Mobile: bottom sheet modal. */
export function RightPanel() {
  const open = useRightPanelStore((s) => s.open);
  const title = useRightPanelStore((s) => s.title);
  const close = useRightPanelStore((s) => s.close);

  // Close on Escape
  const handleKey = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    },
    [close]
  );

  useEffect(() => {
    if (!open) return;
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, handleKey]);

  // Lock body scroll on mobile when open
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    const mql = window.matchMedia("(min-width: 1024px)");
    if (!mql.matches) document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <>
      {/* ── Desktop: fixed right sidebar ── */}
      <aside className="hidden lg:flex lg:w-72 flex-shrink-0 flex-col border-l border-border-default bg-[var(--nm-bg-bar)]">
        {open ? (
          <div className="flex flex-1 flex-col overflow-y-auto">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-border-default px-4 py-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                {title}
              </h3>
              <button
                onClick={close}
                className="rounded border border-border-default px-2 py-0.5 text-xs text-text-muted hover:text-text-secondary"
              >
                Close
              </button>
            </div>
            <div className="flex-1 p-4 space-y-4">
              <PanelContent />
            </div>
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <p className="text-xs text-text-muted">
              Select something to view details
            </p>
          </div>
        )}
      </aside>

      {/* ── Mobile: bottom sheet ── */}
      {open && (
        <div className="lg:hidden fixed inset-0 z-50 flex flex-col justify-end">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={close}
          />

          {/* Sheet */}
          <div className="relative max-h-[85vh] overflow-y-auto rounded-t-2xl border-t border-border-default bg-surface-raised animate-in slide-in-from-bottom duration-200">
            {/* Drag handle + close */}
            <div className="sticky top-0 z-10 flex items-center justify-center bg-surface-raised pb-2 pt-3">
              <div className="h-1 w-10 rounded-full bg-zinc-700" />
              <button
                onClick={close}
                className="absolute right-3 top-2.5 rounded-full p-1 text-text-muted hover:text-text-primary"
              >
                &#10005;
              </button>
            </div>
            {/* Title */}
            <div className="px-4 pb-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                {title}
              </h3>
            </div>
            <div className="space-y-4 px-4 pb-6">
              <PanelContent />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
