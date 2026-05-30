"use client";

// PresenceDot: a tiny online/offline status dot.
//
// Green (emerald) when the player is online, a muted grey when offline. Sized to
// overlay an avatar corner; the caller positions it (e.g. absolute bottom-right
// inside a relatively-positioned avatar wrapper). Offline can be hidden entirely
// via `hideOffline` so only active players carry a mark.

import { cn } from "@/lib/utils";

export interface PresenceDotProps {
  online: boolean;
  // dot diameter in CSS px; default suits a 28-44px avatar corner.
  size?: number;
  // when true, render nothing while offline instead of a grey dot.
  hideOffline?: boolean;
  className?: string;
}

export function PresenceDot({
  online,
  size = 10,
  hideOffline = false,
  className,
}: PresenceDotProps) {
  if (!online && hideOffline) return null;

  return (
    <span
      role="img"
      aria-label={online ? "Online" : "Offline"}
      title={online ? "Online" : "Offline"}
      style={{ width: size, height: size }}
      className={cn(
        "inline-block rounded-full ring-2 ring-surface",
        online ? "bg-emerald-400" : "bg-text-muted/50",
        className,
      )}
    />
  );
}
