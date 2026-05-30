"use client";

// PresenceButton: a manual "I'm online" button.
//
// Posts an empty Status presence ping to the kingdom Public channel via
// usePresenceBeat, refreshing the player's online state when they are otherwise
// idle. Self-contained so it is trivial to relocate; place it in the player's
// own status/profile surface.

import { Radio, LoaderCircle } from "lucide-react";
import { usePresenceBeat } from "@/lib/hooks/usePresenceBeat";
import { cn } from "@/lib/utils";

export interface PresenceButtonProps {
  className?: string;
  // compact omits the label and renders an icon-only pill.
  compact?: boolean;
}

export function PresenceButton({ className, compact = false }: PresenceButtonProps) {
  const { beat, sending } = usePresenceBeat();

  return (
    <button
      type="button"
      onClick={() => void beat()}
      disabled={sending}
      aria-label="Mark yourself online"
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-border-default px-3 py-1.5 text-xs font-semibold text-text-secondary transition-colors hover:border-border-gold hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-60",
        className,
      )}
    >
      {sending ? (
        <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
      ) : (
        <Radio className="h-4 w-4 text-emerald-400" aria-hidden />
      )}
      {compact ? null : sending ? "Updating..." : "I'm online"}
    </button>
  );
}
