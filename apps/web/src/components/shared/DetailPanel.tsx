"use client";

import { BottomSheet } from "@/components/shared/BottomSheet";

/**
 * DetailPanel — a detail view rendered as a bottom-sheet modal on mobile and,
 * on desktop, one of two layouts:
 *
 *   - "sticky" (default) — a sticky sidebar. The panel pins while its grid
 *     row is in view; it only has travel room when the sibling column is the
 *     taller one.
 *   - "column" — a fixed-height column that scrolls its own content
 *     independently of the list beside it, so the panel stays visible no
 *     matter how tall either side is. Requires the parent grid to be a
 *     fixed-height single row — `lg:grid-cols-3 lg:grid-rows-1 lg:h-full`
 *     inside a height-bounded scroll area (see heroes-tab).
 *
 * Usage:
 *   <DetailPanel open={!!selected} onClose={() => setSelected(null)}>
 *     <div className="space-y-4">...</div>
 *   </DetailPanel>
 */
export function DetailPanel({
  open,
  onClose,
  children,
  className = "",
  variant = "sticky",
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
  variant?: "sticky" | "column";
}) {
  // Escape-to-close and mobile body-scroll-lock are owned by BottomSheet,
  // which is always mounted below — no need to duplicate them here.

  return (
    <>
      {/* Desktop: inline panel — sticky sidebar or self-scrolling column */}
      <div
        className={`hidden lg:col-span-1 lg:block ${
          variant === "column" ? "lg:min-h-0" : ""
        } ${className}`}
      >
        {open ? (
          <div
            className={`overflow-y-auto overscroll-contain rounded-lg border border-border-default bg-surface-raised p-4 space-y-4 ${
              variant === "column" ? "h-full" : "sticky top-0 max-h-[calc(100vh_-_5.5rem)]"
            }`}
          >
            {children}
          </div>
        ) : null}
      </div>

      {/* Mobile: bottom sheet */}
      <BottomSheet open={open} onClose={onClose}>
        {children}
      </BottomSheet>
    </>
  );
}
