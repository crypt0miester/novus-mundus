"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import { animate, createAnimatable, engine, type AnimatableObject } from "animejs";
import { Loader2 } from "lucide-react";
import { cn, prefersReducedMotion } from "@/lib/utils";
import { useHoldCharge } from "@/lib/hooks/useHoldCharge";
import { useReducedMotion } from "@/lib/hooks/useReducedMotion";
import { useCanAct } from "@/lib/hooks/useCanAct";
import { useWalletModal } from "@/components/shared/wallet-adapter";
import { PRESS, SETTLE } from "@/lib/motion/tokens";

export type TxPhase = "idle" | "preparing" | "signing" | "sending" | "confirmed" | "failed";

interface TxButtonProps {
  /** Runs the transaction on a normal tap/click. */
  onClick?: (reportPhase: (phase: TxPhase) => void) => Promise<string>;
  /**
   * Press-and-hold handler. With `holdMax` set, holding charges a count from 1
   * to `holdMax` and release fires this with it - so the handler can pack that
   * many instructions into a single transaction. A tap on a hold-enabled
   * button fires it with count 1.
   */
  onHold?: (reportPhase: (phase: TxPhase) => void, count: number) => Promise<string>;
  /**
   * Enables press-and-hold charging (requires `onHold`). Holding ramps a count
   * 1..holdMax; release fires `onHold`. Omitted or <= 1 to plain one-shot.
   */
  holdMax?: number;
  children: React.ReactNode;
  variant?: "primary" | "secondary" | "danger";
  disabled?: boolean;
  className?: string;
}

// Text shown for phases that swap the button label. The "working" phases
// (preparing, signing, sending) are not here - they keep the action label +
// a spinner so the button stays stable; see the render below.
const phaseLabels: Record<TxPhase, string> = {
  idle: "",
  preparing: "",
  signing: "",
  sending: "",
  confirmed: "Success!",
  failed: "Failed",
};

// The whole-library slowdown applied during the on-chain sending beat so
// attention concentrates on the confirming action. Kept very short and gentle;
// it is reverted the instant the tx resolves. This is safe against chain-truth
// countdowns: registerCountdown reads the wall clock, never engine-scaled time.
const SENDING_ENGINE_SPEED = 0.6;

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

  // The global write floor. A spectator (no wallet / no player / viewAs) can't
  // act: the button is forced disabled, and a press opens the claim CTA instead
  // of running onClick - connect a wallet if anonymous, else head to the
  // Arrival flow at /estate to claim a seat. This gates all 66 call sites at the
  // seam, on top of each tab's own canX predicate.
  const canAct = useCanAct();
  const spectator = !canAct;
  const { connected } = useWallet();
  const { setVisible: setWalletModalVisible } = useWalletModal();
  const router = useRouter();
  const claimSeat = useCallback(() => {
    if (!connected) {
      setWalletModalVisible(true);
      return;
    }
    router.push("/estate");
  }, [connected, setWalletModalVisible, router]);
  // One reused animatable that fuses two of the three motion layers: the
  // preparing press-scale on the button and the hold-charge fill width (driven
  // through a `--hold-fill` custom property the fill div reads). Each hold tick
  // and each phase change RETARGETS this single instance - no animate() is
  // spawned per increment. The 4s sending bar stays a separate animate() tween.
  const layersRef = useRef<AnimatableObject | null>(null);

  const reducedMotion = useReducedMotion();

  // Build the fused animatable once the button is mounted; revert on unmount so
  // no stray instance survives. Not built under reduced motion - that path snaps
  // the fill via an inline style and skips the press-scale entirely.
  useEffect(() => {
    if (reducedMotion) return;
    if (!btnRef.current) return;
    const a = createAnimatable(btnRef.current, {
      scale: { unit: "", duration: 220, ease: PRESS },
      "--hold-fill": { unit: "%", duration: 150, ease: SETTLE },
    });
    layersRef.current = a;
    return () => {
      a.revert();
      if (layersRef.current === a) layersRef.current = null;
    };
  }, [reducedMotion]);

  // Restore the engine to its correct resting speed. Under reduced motion the
  // MotionEngineProvider holds the library near-frozen (0.001), so we must not
  // stomp it back to 1; otherwise full speed is the resting state.
  const restoreEngineSpeed = useCallback(() => {
    engine.speed = prefersReducedMotion() ? 0.001 : 1;
  }, []);

  // Drive one transaction through the phase machine. `fn` is the actual send -
  // either the tap handler or the hold handler bound to its charged count.
  const execTx = useCallback(
    async (fn: (reportPhase: (p: TxPhase) => void) => Promise<string>) => {
      if (phase !== "idle" || disabled) return;

      try {
        setPhase("preparing");
        // Reset the progress fill so each run starts empty - the animejs
        // tween does this via its `0%` keyframe; the reduced-motion snap below
        // needs it done explicitly.
        if (progressRef.current) progressRef.current.style.width = "0%";

        const reportPhase = (p: TxPhase) => {
          setPhase(p);
          // Progress bar for sending phase. Honour reduced motion - snap the
          // fill straight to its end state instead of tweening across 4s. The
          // 4s sending fill stays a plain animate() tween (not a spring, not
          // the fused animatable), per the linear-over-time intent.
          if (p === "sending" && progressRef.current) {
            if (prefersReducedMotion()) {
              progressRef.current.style.width = "100%";
            } else {
              // Concentrate attention on the confirming on-chain action by
              // gently slowing the whole library for the sending beat.
              engine.speed = SENDING_ENGINE_SPEED;
              animate(progressRef.current, {
                width: ["0%", "100%"],
                duration: 4000,
                ease: "inOutQuad",
              });
            }
          }
        };

        await fn(reportPhase);

        // Snap the engine back the instant the chain confirms - the slow-mo
        // beat is deliberately brief.
        restoreEngineSpeed();
        setPhase("confirmed");
        setTimeout(() => setPhase("idle"), 1000);
      } catch (e) {
        console.error("Transaction failed:", e);
        restoreEngineSpeed();
        setPhase("failed");
        setTimeout(() => setPhase("idle"), 1500);
      }
    },
    [phase, disabled, restoreEngineSpeed],
  );

  // Press-and-hold charging. The hook is always called (rules of hooks); its
  // pointer handlers are only wired onto the button when `holdMax` + `onHold`
  // make a hold meaningful - otherwise the plain `onClick` path is used.
  const holdEnabled = holdMax != null && holdMax > 1 && onHold != null && !disabled && !spectator;
  const hold = useHoldCharge({
    max: holdMax ?? 1,
    onFire: (count) => {
      if (onHold) execTx((rp) => onHold(rp, count));
    },
  });

  // Hold-charge fill - retarget the fused animatable's `--hold-fill` property on
  // each tick instead of spawning an animate() per increment. Under reduced
  // motion the fill snaps via an inline style (set in the render) and this
  // effect no-ops.
  const charging = holdEnabled && hold.count > 0;
  const holdPct = charging ? (hold.count / (holdMax ?? 1)) * 100 : 0;
  useEffect(() => {
    if (reducedMotion) return;
    const a = layersRef.current;
    if (!a) return;
    a["--hold-fill"](holdPct);
  }, [holdPct, reducedMotion]);

  // Preparing press - retarget the same animatable's `scale` rather than toggling
  // a CSS class, so it shares the PRESS material and settles back smoothly.
  const isWorking = phase === "preparing" || phase === "signing" || phase === "sending";
  useEffect(() => {
    if (reducedMotion) return;
    const a = layersRef.current;
    if (!a) return;
    a.scale(phase === "preparing" ? 0.97 : 1);
  }, [phase, reducedMotion]);

  const variantClasses = {
    primary:
      "text-white accent-border [background-color:var(--tier-accent)] hover:[background-color:var(--tier-accent-bright)]",
    secondary: "bg-surface-raised text-text-gold hover:bg-surface-overlay accent-border",
    danger: "bg-red-900/50 text-red-400 hover:bg-red-900/70 border border-red-800",
  };

  return (
    <button
      ref={btnRef}
      // A spectator press never runs the tx - it opens the claim CTA. We keep
      // the element clickable (no native `disabled`) so the press fires, but
      // wear the disabled look below. Players keep the normal onClick path.
      onClick={
        spectator
          ? claimSeat
          : holdEnabled || !onClick
            ? undefined
            : () => execTx(onClick)
      }
      {...(holdEnabled ? hold.bind : {})}
      disabled={!spectator && (disabled || phase !== "idle")}
      className={cn(
        "relative flex select-none items-center justify-center overflow-hidden rounded-lg px-4 py-2 text-sm font-semibold transition-colors w-full text-center",
        variantClasses[variant],
        (disabled || spectator) && "cursor-not-allowed opacity-50",
        // The press-scale now rides the fused animatable; under reduced motion
        // there is no scale at all.
        phase === "confirmed" && "bg-green-600 text-white",
        phase === "failed" && "bg-red-600 text-white",
        phase !== "idle" && phase !== "confirmed" && phase !== "failed" && "cursor-wait",
        className,
      )}
    >
      {/* Progress bar overlay - tx sending phase */}
      <div
        ref={progressRef}
        className="absolute inset-y-0 left-0 bg-white/10"
        style={{ width: "0%" }}
      />
      {/* Hold-charge fill - ramps with the count while the button is held. The
          width rides the fused animatable's `--hold-fill` var; under reduced
          motion it snaps to the current count with no transition. */}
      {charging && (
        <div
          className="absolute inset-y-0 left-0 bg-white/15"
          style={reducedMotion ? { width: `${holdPct}%` } : { width: "var(--hold-fill, 0%)" }}
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
