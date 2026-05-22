"use client";

import { useRef, useState, useCallback } from "react";
import { animate } from "animejs";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useHoldCharge } from "@/lib/hooks/useHoldCharge";

export type TxPhase = "idle" | "preparing" | "signing" | "sending" | "confirmed" | "failed";

interface TxButtonProps {
  /** Runs the transaction on a normal tap/click. */
  onClick?: (reportPhase: (phase: TxPhase) => void) => Promise<string>;
  /**
   * Press-and-hold handler. With `holdMax` set, holding charges a count from 1
   * to `holdMax` and release fires this with it — so the handler can pack that
   * many instructions into a single transaction. A tap on a hold-enabled
   * button fires it with count 1.
   */
  onHold?: (reportPhase: (phase: TxPhase) => void, count: number) => Promise<string>;
  /**
   * Enables press-and-hold charging (requires `onHold`). Holding ramps a count
   * 1..holdMax; release fires `onHold`. Omitted or <= 1 → plain one-shot.
   */
  holdMax?: number;
  children: React.ReactNode;
  variant?: "primary" | "secondary" | "danger";
  disabled?: boolean;
  className?: string;
}

// Text shown for phases that swap the button label. The "working" phases
// (preparing, signing, sending) are not here — they keep the action label +
// a spinner so the button stays stable; see the render below.
const phaseLabels: Record<TxPhase, string> = {
  idle: "",
  preparing: "",
  signing: "",
  sending: "",
  confirmed: "Success!",
  failed: "Failed",
};

export function TxButton({
  onClick,
  onHold,
  holdMax,
  children,
  variant = "primary",
  disabled,
  className,
}: TxButtonProps) {
  const [phase, setPhase] = useState<TxPhase>("idle");
  const btnRef = useRef<HTMLButtonElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);

  // Drive one transaction through the phase machine. `fn` is the actual send —
  // either the tap handler or the hold handler bound to its charged count.
  const execTx = useCallback(
    async (fn: (reportPhase: (p: TxPhase) => void) => Promise<string>) => {
      if (phase !== "idle" || disabled) return;

      try {
        setPhase("preparing");

        const reportPhase = (p: TxPhase) => {
          setPhase(p);
          // Progress bar for sending phase
          if (p === "sending" && progressRef.current) {
            animate(progressRef.current, {
              width: ["0%", "100%"],
              duration: 4000,
              ease: "inOutQuad",
            });
          }
        };

        await fn(reportPhase);

        setPhase("confirmed");
        setTimeout(() => setPhase("idle"), 1000);
      } catch (e) {
        console.error("Transaction failed:", e);
        setPhase("failed");
        setTimeout(() => setPhase("idle"), 1500);
      }
    },
    [phase, disabled],
  );

  // Press-and-hold charging. The hook is always called (rules of hooks); its
  // pointer handlers are only wired onto the button when `holdMax` + `onHold`
  // make a hold meaningful — otherwise the plain `onClick` path is used.
  const holdEnabled = holdMax != null && holdMax > 1 && onHold != null && !disabled;
  const hold = useHoldCharge({
    max: holdMax ?? 1,
    onFire: (count) => {
      if (onHold) execTx((rp) => onHold(rp, count));
    },
  });

  const variantClasses = {
    primary:
      "text-white accent-border [background-color:var(--tier-accent)] hover:[background-color:var(--tier-accent-bright)]",
    secondary: "bg-surface-raised text-text-gold hover:bg-surface-overlay accent-border",
    danger: "bg-red-900/50 text-red-400 hover:bg-red-900/70 border border-red-800",
  };

  // A tx is in flight — keep the action label, just add a spinner.
  const isWorking = phase === "preparing" || phase === "signing" || phase === "sending";
  const charging = holdEnabled && hold.count > 0;

  return (
    <button
      ref={btnRef}
      onClick={holdEnabled || !onClick ? undefined : () => execTx(onClick)}
      {...(holdEnabled ? hold.bind : {})}
      disabled={disabled || phase !== "idle"}
      className={cn(
        "relative flex select-none items-center justify-center overflow-hidden rounded-lg px-4 py-2 text-sm font-semibold transition-colors w-full text-center",
        variantClasses[variant],
        disabled && "cursor-not-allowed opacity-50",
        phase === "preparing" && "scale-[0.97]",
        phase === "confirmed" && "bg-green-600 text-white",
        phase === "failed" && "bg-red-600 text-white",
        phase !== "idle" && phase !== "confirmed" && phase !== "failed" && "cursor-wait",
        className,
      )}
    >
      {/* Progress bar overlay — tx sending phase */}
      <div
        ref={progressRef}
        className="absolute inset-y-0 left-0 bg-white/10"
        style={{ width: "0%" }}
      />
      {/* Hold-charge fill — ramps with the count while the button is held */}
      {charging && (
        <div
          className="absolute inset-y-0 left-0 bg-white/15 transition-[width] duration-150 ease-out"
          style={{ width: `${(hold.count / (holdMax ?? 1)) * 100}%` }}
        />
      )}
      <span className="relative z-10 flex items-center gap-1.5">
        {phase === "idle" || isWorking ? children : phaseLabels[phase]}
        {isWorking && <Loader2 className="h-4 w-4 shrink-0 animate-spin" />}
      </span>
      {/* Hold-charge count badge */}
      {charging && hold.count > 1 && (
        <span className="absolute right-1.5 top-1.5 z-10 rounded-full bg-black/55 px-1.5 text-[11px] font-bold tabular-nums text-white">
          ×{hold.count}
        </span>
      )}
    </button>
  );
}
