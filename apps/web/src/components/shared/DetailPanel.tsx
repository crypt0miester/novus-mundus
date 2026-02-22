"use client";

import { useEffect, useCallback } from "react";

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
      {open && (
        <div className="lg:hidden fixed inset-0 z-50 flex flex-col justify-end">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={onClose}
          />

          {/* Sheet */}
          <div className="relative max-h-[85vh] overflow-y-auto rounded-t-2xl border-t border-border-default bg-surface-raised animate-in slide-in-from-bottom duration-200">
            {/* Drag handle + close */}
            <div className="sticky top-0 z-10 flex items-center justify-center bg-surface-raised pb-2 pt-3">
              <div className="h-1 w-10 rounded-full bg-zinc-700" />
              <button
                onClick={onClose}
                className="absolute right-3 top-2.5 rounded-full p-1 text-text-muted hover:text-text-primary"
              >
                &#10005;
              </button>
            </div>
            <div className="space-y-4 px-4 pb-6">
              {children}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
