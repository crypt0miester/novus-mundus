"use client";

import { cn } from "@/lib/utils";
import { ChevronRight } from "lucide-react";
import { GameIcon } from "./GameIcon";
import { TxButton } from "./TxButton";
import type { TxPhase } from "./TxButton";
import Link from "next/link";

interface GemActionProps {
  /** Handler that returns tx signature */
  onClick: (reportPhase: (phase: TxPhase) => void) => Promise<string>;
  /** Gem cost for this action */
  gemCost: number;
  /** Player's current gem balance */
  gemBalance: number;
  /** Button label */
  children: React.ReactNode;
  /** Additional disabled condition */
  disabled?: boolean;
  className?: string;
}

/**
 * A TxButton that shows gem cost and handles the upsell flow.
 *
 * - If user can afford: shows an actionable button with gem cost badge
 * - If user can't afford: shows cost, deficit, and a link to the shop
 */
export function GemAction({
  onClick,
  gemCost,
  gemBalance,
  children,
  disabled,
  className,
}: GemActionProps) {
  const canAfford = gemBalance >= gemCost;

  if (!canAfford) {
    const deficit = gemCost - gemBalance;
    return (
      <div
        className={cn(
          "flex flex-col items-center gap-1.5 rounded-lg border border-zinc-800 bg-surface px-4 py-3",
          className,
        )}
      >
        <div className="flex items-center gap-2 text-sm text-zinc-400">
          <span>{children}</span>
          <span className="rounded bg-accent/30 px-1.5 py-0.5 font-mono text-xs text-text-gold">
            {gemCost.toLocaleString()} gems
          </span>
        </div>
        <div className="flex items-center gap-2 text-[11px]">
          <span className="text-zinc-500">You have {gemBalance.toLocaleString()}</span>
          <span className="text-zinc-600">·</span>
          <span className="text-red-400">Need {deficit.toLocaleString()} more</span>
        </div>
        <Link
          href="/shop"
          className="mt-0.5 inline-flex items-center gap-1 rounded-md bg-accent/20 px-3 py-1 text-xs font-semibold text-text-gold transition-colors hover:bg-accent/40"
        >
          Get Gems
          <ChevronRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col items-center gap-1", className)}>
      <TxButton onClick={onClick} disabled={disabled}>
        <span className="flex items-center gap-2">
          {children}
          <span className="inline-flex items-center gap-1 rounded bg-black/20 px-1.5 py-0.5 font-mono text-[10px] opacity-80">
            {gemCost.toLocaleString()}
            <GameIcon id="resource-gem" title="gems" size={13} />
          </span>
        </span>
      </TxButton>
    </div>
  );
}
