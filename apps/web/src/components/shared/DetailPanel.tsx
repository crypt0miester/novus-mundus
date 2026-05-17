"use client";

import { useEffect, useCallback } from "react";
import { BottomSheet } from "@/components/shared/BottomSheet";

/**
 * DetailPanel — sticky sidebar on desktop, bottom sheet modal on mobile.
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
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  // Close on Escape
  const handleKey = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose],
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
      {/* ── Desktop: inline sticky panel ── */}
      <div className={`hidden lg:block lg:col-span-1 ${className}`}>
        {open ? (
          <div className="sticky top-0 rounded-lg border border-border-default bg-surface-raised p-4 space-y-4">
            {children}
          </div>
        ) : null}
      </div>

      {/* ── Mobile: bottom sheet ── */}
      <BottomSheet open={open} onClose={onClose}>
        {children}
      </BottomSheet>
    </>
  );
}
