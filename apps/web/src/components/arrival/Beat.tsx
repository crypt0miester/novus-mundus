import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface BeatEyebrowProps {
  children: ReactNode;
  className?: string;
  /** Mark as a `useRevealOnMount` target — starts hidden, staggered in. */
  reveal?: boolean;
}

/** The small mono caption above each Arrival beat's heading. */
export function BeatEyebrow({ children, className, reveal = false }: BeatEyebrowProps) {
  return (
    <p
      data-reveal={reveal || undefined}
      className={cn(
        "font-mono text-[11px] lowercase tracking-[0.3em] text-text-muted",
        reveal && "opacity-0",
        className,
      )}
    >
      {children}
    </p>
  );
}

interface BeatButtonProps {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  /**
   * The look of the disabled state. `disabled` is a hard stop (dimmed,
   * not-allowed); `waiting` is a transient hold (no dimming, wait cursor).
   */
  disabledTone?: "disabled" | "waiting";
  className?: string;
  /** Mark as a `useRevealOnMount` target — starts hidden, staggered in. */
  reveal?: boolean;
}

/** The gold call-to-action that closes each Arrival beat. */
export function BeatButton({
  children,
  onClick,
  disabled = false,
  disabledTone = "disabled",
  className,
  reveal = false,
}: BeatButtonProps) {
  return (
    <button
      data-reveal={reveal || undefined}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "rounded-lg border px-7 py-2.5 text-sm font-semibold transition-colors",
        reveal && "opacity-0",
        disabled
          ? disabledTone === "waiting"
            ? "cursor-wait border-border-default text-text-muted"
            : "cursor-not-allowed border-border-default text-text-muted opacity-50"
          : "border-border-gold bg-surface-raised text-text-gold hover:bg-surface-overlay",
        className,
      )}
    >
      {children}
    </button>
  );
}
