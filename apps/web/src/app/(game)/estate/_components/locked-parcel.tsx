"use client";

import { Lock } from "lucide-react";
import { TxButton } from "@/components/shared/TxButton";
import type { TxPhase } from "@/components/shared/TxButton";
import { InfoButton } from "@/components/shared/InfoButton";
import { PLOT_NUMERALS } from "./estate-layout";

interface LockedParcelProps {
  /** Zero-based plot index this locked parcel represents. */
  index: number;
  /** The next claimable plot carries the buy affordance; the rest are inert. */
  claimable: boolean;
  /** NOVI cost of this plot — shown on the claimable parcel. */
  cost: number;
  /** Buy the next plot; wired only on the claimable parcel. */
  onClaim?: (reportPhase: (p: TxPhase) => void) => Promise<string>;
}

/**
 * A not-yet-claimed plot, drawn as a faded blueprint parcel so the land beyond
 * the claim reads as part of the same survey. The next claimable parcel carries
 * the claim `TxButton` in its frame; further ones render ghosted and inert,
 * since plots claim in sequence. Replaces the old "Land Beyond Your Claim" list.
 */
export function LockedParcel({ index, claimable, cost, onClaim }: LockedParcelProps) {
  const numeral = PLOT_NUMERALS[index] ?? String(index + 1);
  // Only the next claimable parcel carries the buy action; the rest are ghosts.
  const claim = claimable ? onClaim : undefined;

  return (
    <div data-parcel className={`blueprint-parcel rounded-lg p-2.5 ${claim ? "" : "opacity-45"}`}>
      <div className="mb-2 flex items-baseline justify-between gap-2 px-1">
        <h2
          className={`font-display text-xs font-bold uppercase tracking-[0.2em] ${
            claim ? "text-text-gold" : "text-text-muted"
          }`}
        >
          Plot {numeral}
        </h2>
        <span className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-text-muted">
          <Lock className="h-2.5 w-2.5" aria-hidden /> Locked
          {claim && (
            <InfoButton>
              Unclaimed ground. Claiming a plot adds 4 building slots. A holding can claim up to 5
              plots (20 slots), each costing more than the last.
            </InfoButton>
          )}
        </span>
      </div>

      {claim ? (
        <TxButton
          onClick={claim}
          variant="secondary"
          className="blueprint-grid flex min-h-[11.5rem] w-full flex-col items-center justify-center gap-1 rounded p-3 text-center"
        >
          <span className="text-sm font-semibold text-text-gold">Claim this ground</span>
          <span className="text-[11px] text-text-muted">
            {(cost / 1000).toFixed(0)}k NOVI · +4 slots
          </span>
        </TxButton>
      ) : (
        <div className="blueprint-grid flex min-h-[11.5rem] items-center justify-center rounded p-3 text-center text-[11px] text-text-muted">
          Unclaimed ground
        </div>
      )}
    </div>
  );
}
