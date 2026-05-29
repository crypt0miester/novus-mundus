"use client";

// ReactionRow: the folded reaction chips under a message bubble. Each chip shows
// an emoji and its live count; the chip MINE-highlighted when the connected
// wallet is among the reactors. Tapping a chip toggles: when mine it un-reacts
// (the hook resolves my reaction message id), otherwise it reacts with the emoji.
//
// The store is wallet-agnostic, so `mine` is derived here from the chip's
// reactorWallets vs the connected wallet (not read off the store).

import type { ReactionChip } from "@/lib/store/war-table";
import { cn } from "@/lib/utils";

interface ReactionRowProps {
  reactions: ReactionChip[] | undefined;
  // base58 connected wallet, or null; decides which chips render as mine.
  connectedWallet: string | null;
  // true while this message is an optimistic echo (dim the chips).
  pending: boolean;
  // align under an own (right) or received (left) bubble.
  mine: boolean;
  // toggle a chip: react when not mine, un-react when mine.
  onToggle: (emoji: string, mine: boolean) => void;
}

export function ReactionRow({
  reactions,
  connectedWallet,
  pending,
  mine,
  onToggle,
}: ReactionRowProps) {
  if (!reactions || reactions.length === 0) return null;

  return (
    <div
      className={cn(
        "mt-0.5 flex flex-wrap items-center gap-1 px-1",
        mine ? "justify-end" : "justify-start",
      )}
    >
      {reactions.map((chip) => {
        const reactedByMe =
          connectedWallet !== null && chip.reactorWallets.includes(connectedWallet);
        return (
          <button
            key={chip.emoji}
            type="button"
            aria-pressed={reactedByMe}
            onClick={() => onToggle(chip.emoji, reactedByMe)}
            className={cn(
              "flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors",
              reactedByMe
                ? "border-accent bg-accent/15 text-accent"
                : "border-border-default bg-surface text-text-secondary hover:bg-surface-overlay",
              pending && "opacity-60",
            )}
          >
            <span className="leading-none">{chip.emoji}</span>
            <span className="tabular-nums">{chip.count}</span>
          </button>
        );
      })}
    </div>
  );
}
