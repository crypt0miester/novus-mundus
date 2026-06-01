"use client";

import { useEffect, useId, useRef } from "react";
import type { PublicKey } from "@solana/web3.js";
import {
  type HeroTemplateAccount,
  getAbilityKindMeta,
  getAbilityDescription,
  hasAbility,
  formatDurationCompact,
  AbilityKind,
} from "novus-mundus-sdk";
import { animate, svg, utils, type JSAnimation } from "animejs";
import { TxButton } from "@/components/shared/TxButton";
import { InfoButton } from "@/components/shared/InfoButton";
import {
  useHeroAbilityCooldown,
  useUseAbility,
  usePendingEffect,
} from "@/lib/hooks/useHeroAbility";
import { useAnimeScope } from "@/lib/hooks/useAnimeScope";
import { registerCountdown } from "@/lib/motion/countdownClock";
import { prefersReducedMotion } from "@/lib/utils";
import { BLOOM } from "@/lib/motion/tokens";

interface AbilityCardProps {
  template: HeroTemplateAccount;
  /** When omitted: read-only card (template browser). When present: interactive (locked-hero detail). */
  interactive?: {
    heroMint: PublicKey;
    slotIndex: number;
  };
}

/**
 * Renders a hero's signature ability. Two modes:
 *  - Read-only (template detail): shows kind, description, cooldown duration.
 *  - Interactive (locked-hero detail): adds Use Ability button + live cooldown.
 *
 * Hidden entirely when the template has no ability configured (kind 0).
 */
export function AbilityCard({ template, interactive }: AbilityCardProps) {
  if (!hasAbility(template)) return null;

  const meta = getAbilityKindMeta(template.abilityKind);
  const description = getAbilityDescription(template);

  return (
    <div className="rounded-md border border-zinc-800 bg-surface px-3 py-2">
      <div className="mb-1.5 flex items-center justify-between">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
          Signature Ability <InfoButton>One active ability per locked hero: a one-shot combat buff, or instant cash/fragments on use.</InfoButton>
        </div>
        <span className={`text-xs font-bold ${meta.accentClass}`}>
          {meta.icon} {meta.label}
        </span>
      </div>

      <p className="text-xs leading-snug text-text-secondary">{description}</p>

      <div className="mt-1 flex items-center justify-between text-[10px] text-text-muted">
        <span>Cooldown <InfoButton>After use, that hero&apos;s ability is locked for its cooldown. The timer survives unlock and relock.</InfoButton></span>
        <span className="font-mono">{formatDurationCompact(template.abilityCooldownSecs)}</span>
      </div>

      {interactive && (
        <InteractiveTrigger
          template={template}
          heroMint={interactive.heroMint}
          slotIndex={interactive.slotIndex}
        />
      )}
    </div>
  );
}

interface InteractiveTriggerProps {
  template: HeroTemplateAccount;
  heroMint: PublicKey;
  slotIndex: number;
}

// The cooldown ring radius in its local 36x36 viewBox.
const RING_R = 15.5;

/** Live cooldown countdown + Use Ability button. Re-renders every second. */
function InteractiveTrigger({ template, heroMint, slotIndex }: InteractiveTriggerProps) {
  const cd = useHeroAbilityCooldown(slotIndex, template.abilityCooldownSecs);
  const pending = usePendingEffect();
  // Renamed off the `use*` prefix so the rules-of-hooks lint does not mistake the
  // callback returned by useUseAbility() for a hook when it is called in JSX.
  const triggerAbility = useUseAbility();

  // The pending banner shows kind already; if THIS hero's kind sets a pending
  // one-shot and it matches, surface that here too for clarity.
  const armedHere =
    pending !== null &&
    pending.kind === template.abilityKind &&
    template.abilityKind <= AbilityKind.EncounterSkip;

  // Scoped to this trigger so selectors do not collide with sibling cards.
  const rootRef = useRef<HTMLDivElement>(null);
  // A stable, render-survivable SVG path id (the trigger re-renders every
  // second; a fresh id per render would orphan the drawable proxy).
  const ringId = `cd-ring-${useId().replace(/:/g, "")}`;

  // The cooldown arc animation. autoplay:false; we never let time drive it. Its
  // `progress` is seek()-ed to the real remaining fraction from the wall-clock
  // countdown clock, so it stays truthful even when engine.speed is lowered. It
  // lives in a ref because the trigger re-renders every second and must not
  // recreate the instance.
  const ringAnimRef = useRef<JSAnimation | null>(null);
  const btnWrapRef = useRef<HTMLDivElement>(null);
  const wasReadyRef = useRef<boolean>(cd.ready);

  // Build the arc drawable + autoplay:false draw animation ONCE per cooldown
  // window (keyed on readyAt, which changes only when the ability is freshly
  // used). Living in a ref means the per-second re-render never recreates it.
  useAnimeScope(
    { root: rootRef, deps: [cd.readyAt, cd.ready], revertOnCleanup: false },
    ({ reduce }) => {
      const ringEl = rootRef.current?.querySelector<SVGPathElement>(`#${CSS.escape(ringId)}`);
      if (!ringEl) return;

      // No active cooldown: clear the arc and skip provisioning the instance.
      if (cd.ready || cd.readyAt <= 0) {
        ringAnimRef.current = null;
        utils.set(ringEl, { strokeDashoffset: 0 });
        return;
      }

      const [drawable] = svg.createDrawable(ringEl);
      // "0 1" is a full ring, "0 0" is empty: the cooldown starts full and
      // drains to nothing as it burns down. progress is driven, not time.
      const ring = animate(drawable, {
        draw: ["0 1", "0 0"],
        autoplay: false,
        duration: 1000,
        ease: "linear",
      });
      ringAnimRef.current = ring;

      // Reduced motion: seek the arc to truth once and bail (the countdown clock
      // wiring below is the reactive path; here we only need the resting frame).
      if (reduce) {
        const span = template.abilityCooldownSecs * 1000;
        const elapsed = span - cd.remainingSecs * 1000;
        ring.progress = span > 0 ? utils.clamp(elapsed / span, 0, 1) : 1;
      }
    },
  );

  // Drive the arc from the shared wall-clock countdown clock. Kept OUT of
  // useAnimeScope because its builder discards the return value, so a cleanup
  // belongs in its own effect. Re-registers whenever the cooldown window
  // changes; seeks the ref'd arc each frame so it reads remaining chain time.
  useEffect(() => {
    if (cd.ready || cd.readyAt <= 0) return;
    if (prefersReducedMotion()) return;
    const endTs = cd.readyAt * 1000;
    const startTs = (cd.readyAt - template.abilityCooldownSecs) * 1000;
    const unregister = registerCountdown({
      endTs,
      startTs,
      onTick: (_remainingMs, fraction) => {
        const ring = ringAnimRef.current;
        if (ring) ring.seek(ring.duration * fraction);
      },
    });
    return unregister;
  }, [cd.ready, cd.readyAt, template.abilityCooldownSecs]);

  // Ready-edge bloom: bloom the button once when the cooldown completes. The
  // per-second timer pulse was removed, so the countdown number now sits still.
  useEffect(() => {
    if (prefersReducedMotion()) {
      wasReadyRef.current = cd.ready;
      return;
    }
    if (cd.ready && !wasReadyRef.current && btnWrapRef.current) {
      animate(btnWrapRef.current, { scale: [0.9, 1.06, 1], ease: BLOOM, duration: 520 });
    }
    wasReadyRef.current = cd.ready;
  }, [cd.ready]);

  return (
    <div ref={rootRef} className="mt-2 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div ref={btnWrapRef} className="flex-1">
          <TxButton
            onClick={(rp) =>
              triggerAbility(heroMint, template.templateId, slotIndex, rp).then((r) => r.signature)
            }
            disabled={!cd.ready}
            variant="primary"
            className="text-xs"
          >
            {cd.ready ? "Use Ability" : `On Cooldown`}
          </TxButton>
        </div>
        <div className="flex min-w-[70px] items-center justify-end gap-1.5">
          {/* Cooldown arc, anchored in its own 36x36 box and rotated so the draw
              starts at top. Drained by the shared wall-clock countdown clock,
              never by free-running time. Hidden once the ability is ready. */}
          <svg
            role="img"
            aria-label="Cooldown progress"
            viewBox="0 0 36 36"
            className="h-5 w-5 shrink-0 -rotate-90"
            style={{ opacity: cd.ready ? 0 : 1 }}
          >
            <circle
              cx="18"
              cy="18"
              r={RING_R}
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              className="text-zinc-800"
            />
            <path
              id={ringId}
              d={ringArcPath(RING_R)}
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              className="text-text-gold"
            />
          </svg>
          <div className="text-right font-mono text-[11px] text-text-secondary">
            {cd.ready ? "Ready" : formatDurationCompact(cd.remainingSecs)}
          </div>
        </div>
      </div>
    </div>
  );
}

// A full-circle path drawn as one arc command so createDrawable can etch it edge
// to edge. The near-zero offset on the closing point keeps the arc a valid
// 360-degree sweep rather than a degenerate zero-length path.
function ringArcPath(r: number): string {
  const cx = 18;
  const cy = 18;
  return `M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx - 0.01} ${cy - r} Z`;
}
