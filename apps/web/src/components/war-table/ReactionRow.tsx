"use client";

// ReactionRow: the folded reaction chips under a message bubble. Each chip shows
// an emoji and its live count; the chip MINE-highlighted when the connected
// wallet is among the reactors. Tapping a chip toggles: when mine it un-reacts
// (the hook resolves my reaction message id), otherwise it reacts with the emoji.
//
// The store is wallet-agnostic, so `mine` is derived here from the chip's
// reactorWallets vs the connected wallet (not read off the store).
//
// Motion: chips deal in on a spatial stagger whose origin flips by bubble side
// (from the bubble edge: last under an own/right bubble, first under a
// received/left bubble), so they appear to spill out from the message. A chip
// that flips to MINE does a scale punch plus a center-origin glow burst; that
// false->true transition is edge-detected against the previous reactedByMe set
// so it fires on the toggle, not on every unrelated re-render.

import { useMemo, useRef } from "react";
import { animate, stagger, utils } from "animejs";
import { PRESS, STAGGER } from "@/lib/motion/tokens";
import { useAnimeScope } from "@/lib/hooks/useAnimeScope";
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
  const rootRef = useRef<HTMLDivElement | null>(null);
  // Previous-render edge state: the set of emoji that were present, and the set
  // of emoji that were reacted-by-me. Diffed in the scope builder so deal-in
  // fires only for genuinely new chips and the mine-punch only on a false->true
  // flip, never on a count tick or an unrelated parent re-render.
  const prevEmoji = useRef<Set<string>>(new Set());
  const prevMine = useRef<Set<string>>(new Set());

  // Resolve mine per chip once, here, so render and the motion effect agree.
  const resolved = useMemo(() => {
    const list = reactions ?? [];
    return list.map((chip) => ({
      chip,
      reactedByMe:
        connectedWallet !== null && chip.reactorWallets.includes(connectedWallet),
    }));
  }, [reactions, connectedWallet]);

  // Signature that changes only when something the motion cares about changes:
  // the emoji set, their order, and which are mine. Counts alone do not retrigger
  // choreography (the number just updates in place).
  const sig = useMemo(
    () => resolved.map((r) => `${r.chip.emoji}:${r.reactedByMe ? 1 : 0}`).join("|"),
    [resolved],
  );

  // Deal-in stagger origin flips by bubble side: chips spill from the bubble's
  // inner edge (last-to-first under an own/right bubble, first-to-last under a
  // received/left bubble).
  useAnimeScope(
    { root: rootRef, deps: [sig, mine] },
    ({ reduce }) => {
      const root = rootRef.current;
      if (!root) return;
      const chipEls = Array.from(
        root.querySelectorAll<HTMLElement>("[data-reaction-chip]"),
      );
      if (chipEls.length === 0) return;

      const seenEmoji = prevEmoji.current;
      const seenMine = prevMine.current;

      // Reduced motion: pin everything to the resting state and bail before any
      // choreography. Ambient/one-shot motion must not run, even fast.
      if (reduce) {
        utils.set(chipEls, { scale: 1, opacity: 1, boxShadow: "none" });
        return;
      }

      // Fresh chips deal in; chips already on screen stay put. Splitting them
      // keeps a single new reaction from re-staggering the whole row.
      const fresh: HTMLElement[] = [];
      const flippedMine: HTMLElement[] = [];
      for (const el of chipEls) {
        const emoji = el.dataset.reactionChip ?? "";
        const isMineNow = el.dataset.reactionMine === "1";
        if (!seenEmoji.has(emoji)) {
          fresh.push(el);
        } else if (isMineNow && !seenMine.has(emoji)) {
          // Existing chip that just flipped to mine: punch + glow, no deal-in.
          flippedMine.push(el);
        }
      }

      if (fresh.length > 0) {
        utils.set(fresh, { scale: 0.6, opacity: 0 });
        animate(fresh, {
          scale: [0.6, 1],
          opacity: [0, 1],
          ease: PRESS,
          duration: 360,
          delay: stagger(STAGGER.tight, { from: mine ? "last" : "first" }),
        });
      }

      // A chip flipping to mine punches its scale and bursts a center-origin
      // glow that settles back to the resting (no-shadow) chip. box-shadow is
      // main-thread paint, but this is a short one-shot on a single chip. The
      // glow uses the accent hue via a literal rgba so it reads the same in both
      // themes without depending on a CSS custom property being defined.
      for (const el of flippedMine) {
        animate(el, { scale: [1, 1.28, 1], ease: PRESS, duration: 420 });
        animate(el, {
          boxShadow: [
            "0 0 0 0 rgba(99, 102, 241, 0)",
            "0 0 14px 3px rgba(99, 102, 241, 0.55)",
            "0 0 0 0 rgba(99, 102, 241, 0)",
          ],
          duration: 520,
          ease: "outQuad",
        });
      }

      // Record this render's edge state for the next diff.
      const nextEmoji = new Set<string>();
      const nextMine = new Set<string>();
      for (const el of chipEls) {
        const emoji = el.dataset.reactionChip ?? "";
        nextEmoji.add(emoji);
        if (el.dataset.reactionMine === "1") nextMine.add(emoji);
      }
      prevEmoji.current = nextEmoji;
      prevMine.current = nextMine;
    },
  );

  if (resolved.length === 0) return null;

  return (
    <div
      ref={rootRef}
      className={cn(
        "mt-0.5 flex flex-wrap items-center gap-1 px-1",
        mine ? "justify-end" : "justify-start",
      )}
    >
      {resolved.map(({ chip, reactedByMe }) => (
        <button
          key={chip.emoji}
          type="button"
          data-reaction-chip={chip.emoji}
          data-reaction-mine={reactedByMe ? "1" : "0"}
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
      ))}
    </div>
  );
}
