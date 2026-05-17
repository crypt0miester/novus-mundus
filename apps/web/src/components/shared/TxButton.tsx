"use client";

import { useRef, useState, useCallback } from "react";
import { animate } from "animejs";
import { cn } from "@/lib/utils";

export type TxPhase =
  | "idle"
  | "preparing"
  | "signing"
  | "sending"
  | "confirmed"
  | "failed";

interface TxButtonProps {
  onClick: (reportPhase: (phase: TxPhase) => void) => Promise<string>;
  children: React.ReactNode;
  variant?: "primary" | "secondary" | "danger";
  disabled?: boolean;
  className?: string;
}

const phaseLabels: Record<TxPhase, string> = {
  idle: "",
  preparing: "Preparing...",
  signing: "Sign in wallet...",
  sending: "Confirming...",
  confirmed: "Success!",
  failed: "Failed",
};

export function TxButton({
  onClick,
  children,
  variant = "primary",
  disabled,
  className,
}: TxButtonProps) {
  const [phase, setPhase] = useState<TxPhase>("idle");
  const btnRef = useRef<HTMLButtonElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);

  const handleClick = useCallback(async () => {
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

      await onClick(reportPhase);

      setPhase("confirmed");
      setTimeout(() => setPhase("idle"), 2000);
    } catch (e) {
      console.error("Transaction failed:", e);
      setPhase("failed");
      setTimeout(() => setPhase("idle"), 1500);
    }
  }, [phase, disabled, onClick]);

  const variantClasses = {
    primary:
      "text-white accent-border [background-color:var(--tier-accent)] hover:[background-color:var(--tier-accent-bright)]",
    secondary:
      "bg-surface-raised text-text-gold hover:bg-surface-overlay accent-border",
    danger:
      "bg-red-900/50 text-red-400 hover:bg-red-900/70 border border-red-800",
  };

  return (
    <button
      ref={btnRef}
      onClick={handleClick}
      disabled={disabled || phase !== "idle"}
      className={cn(
        "relative flex items-center justify-center overflow-hidden rounded-lg px-4 py-2 text-sm font-semibold transition-colors w-full text-center",
        variantClasses[variant],
        disabled && "cursor-not-allowed opacity-50",
        phase === "preparing" && "scale-[0.97]",
        phase === "confirmed" && "bg-green-600 text-white",
        phase === "failed" && "bg-red-600 text-white",
        phase !== "idle" && phase !== "confirmed" && phase !== "failed" && "cursor-wait",
        className
      )}
    >
      {/* Progress bar overlay */}
      <div
        ref={progressRef}
        className="absolute inset-y-0 left-0 bg-white/10"
        style={{ width: "0%" }}
      />

      {/* Label */}
      <span className="relative z-10 contents">
        {phase === "idle" ? children : phaseLabels[phase]}
      </span>
    </button>
  );
}
