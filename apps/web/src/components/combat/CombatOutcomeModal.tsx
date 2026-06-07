"use client";

import { type RefObject, useMemo, useRef } from "react";
import { createTimeline, irregular, stagger, utils } from "animejs";
import { useCombatOutcome } from "@/lib/store/combat-outcome";
import { useFocusTrap } from "@/lib/hooks/useFocusTrap";
import { useAnimeScope } from "@/lib/hooks/useAnimeScope";
import { BLOOM, DUR, STAGGER } from "@/lib/motion/tokens";
import { TxButton } from "@/components/shared/TxButton";
import { GameIcon } from "@/components/shared/GameIcon";
import { formatNoviAmount } from "novus-mundus-sdk";

function num(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "bigint") return Number(v);
  return Number(v) || 0;
}
const fmt = (v: unknown) => num(v).toLocaleString();

/** Sum a fixed-length numeric array field (e.g. units-lost [u64; 3]). */
function sumArr(v: unknown): number {
  if (!Array.isArray(v)) return 0;
  return v.reduce((acc: number, x) => acc + num(x), 0);
}

const RARITY = ["Common", "Uncommon", "Rare", "Epic", "Legendary"];

type Tone = "victory" | "survive" | "defeat";

interface Row {
  label: string;
  value: string;
  highlight?: boolean;
}

interface HpAnim {
  /** Pre-hit HP (damageDealt + healthRemaining). */
  from: number;
  /** Post-hit HP — what the on-chain event says is left. */
  to: number;
  /** Encounter max HP, used as the bar's full-width denominator. */
  max: number;
}

interface OutcomeView {
  tone: Tone;
  heading: string;
  sub: string;
  rows: Row[];
  hint?: string;
  /** Diminishing HP bar shown for encounter hits (PvE only). */
  hpAnim?: HpAnim;
  /** The target is still standing — offer an Attack button, not just Continue. */
  canAttackAgain: boolean;
}

/** Reduce a combat tx's events into a single win/lose breakdown. */
function buildView(
  events: NonNullable<ReturnType<typeof useCombatOutcome.getState>["events"]>,
  maxHealth: number | undefined,
): OutcomeView | null {
  const find = (name: string) =>
    (events.find((e) => e.name === name)?.data ?? null) as Record<string, unknown> | null;

  const attacked = find("EncounterAttacked");
  const defeated = find("EncounterDefeated");
  const pvp = find("PlayerAttacked");
  const xp = find("XpGained");
  const levelUp = find("PlayerLeveledUp");

  if (!attacked && !defeated && !pvp) return null;

  let tone: Tone;
  let heading: string;
  let sub: string;
  let hint: string | undefined;
  const rows: Row[] = [];

  if (pvp) {
    const won = Boolean(pvp.attackerWon);
    tone = won ? "victory" : "defeat";
    heading = won ? "Victory" : "Defeat";
    const target =
      (pvp.defenderName as string) ||
      (pvp.defender as { toBase58?: () => string })?.toBase58?.()?.slice(0, 6) ||
      "your rival";
    const driveBy = Boolean(pvp.driveBy);
    sub =
      (won ? `You overpowered ${target}` : `${target} held their ground`) +
      (driveBy ? " · drive-by" : "");

    rows.push({ label: "Damage dealt", value: fmt(pvp.damageDealt) });
    if (num(pvp.damageReceived) > 0) {
      rows.push({ label: "Damage taken", value: fmt(pvp.damageReceived) });
    }

    // attacker_units_lost / defender_units_lost are [defensive_1, _2, _3].
    const unitsLost = sumArr(pvp.attackerUnitsLost);
    const unitsKilled = sumArr(pvp.defenderUnitsLost);
    rows.push({ label: "Your units lost", value: unitsLost > 0 ? fmt(unitsLost) : "None" });
    rows.push({ label: "Enemy units killed", value: unitsKilled > 0 ? fmt(unitsKilled) : "None" });

    if (num(pvp.cashStolen) > 0)
      rows.push({ label: "Cash stolen", value: `$${fmt(pvp.cashStolen)}` });
    if (num(pvp.armorStolen) > 0) rows.push({ label: "Armor stolen", value: fmt(pvp.armorStolen) });
    if (num(pvp.produceStolen) > 0)
      rows.push({ label: "Produce stolen", value: fmt(pvp.produceStolen) });
    if (num(pvp.vehiclesStolen) > 0)
      rows.push({ label: "Drays taken", value: fmt(pvp.vehiclesStolen) });
  } else if (defeated) {
    tone = "victory";
    heading = "Encounter Defeated";
    sub = `${RARITY[num(defeated.encounterType)] ?? "Encounter"} · Level ${num(defeated.level)}`;
    // `lootCash` is the immediate kill bounty (already in the player's hand);
    // every other field is the LootAccount breakdown waiting for `claim_loot`.
    const cash = num(defeated.lootCash);
    const novi = num(defeated.lootNovi);
    const produce = num(defeated.lootProduce);
    const drays = num(defeated.lootVehicles);
    const melee = num(defeated.lootMelee);
    const ranged = num(defeated.lootRanged);
    const siege = num(defeated.lootSiege);
    const fragments = num(defeated.lootFragments);
    const gems = num(defeated.lootGems);
    if (cash > 0) rows.push({ label: "Kill bounty · cash", value: `$${fmt(cash)}` });
    if (novi > 0) rows.push({ label: "Loot · NOVI", value: formatNoviAmount(novi) });
    if (melee > 0) rows.push({ label: "Loot · melee", value: fmt(melee) });
    if (ranged > 0) rows.push({ label: "Loot · ranged", value: fmt(ranged) });
    if (siege > 0) rows.push({ label: "Loot · siege", value: fmt(siege) });
    if (produce > 0) rows.push({ label: "Loot · produce", value: fmt(produce) });
    if (drays > 0) rows.push({ label: "Loot · drays", value: fmt(drays) });
    if (fragments > 0) rows.push({ label: "Loot · fragments", value: fmt(fragments) });
    if (gems > 0) rows.push({ label: "Loot · gems", value: fmt(gems) });
    const hasLockedLoot =
      novi > 0 ||
      produce > 0 ||
      drays > 0 ||
      melee > 0 ||
      ranged > 0 ||
      siege > 0 ||
      fragments > 0 ||
      gems > 0;
    if (hasLockedLoot) hint = "Unclaimed loot is waiting in your Inventory.";
  } else {
    tone = "survive";
    heading = "Hit Landed";
    sub = "The encounter survives — strike again to finish it.";
  }

  let hpAnim: HpAnim | undefined;
  if (attacked) {
    rows.push({ label: "Damage dealt", value: fmt(attacked.damageDealt) });
    if (num(attacked.staminaConsumed) > 0) {
      rows.push({ label: "Stamina spent", value: fmt(attacked.staminaConsumed) });
    }
    if (num(attacked.noviConsumed) > 0) {
      rows.push({ label: "NOVI spent", value: formatNoviAmount(num(attacked.noviConsumed)) });
    }
    const damage = num(attacked.damageDealt);
    const remaining = num(attacked.healthRemaining);
    // Fall back to pre-hit HP when the call site didn't supply max — gives a
    // sensible "this hit took X% off" read even if it isn't full-encounter-HP.
    const max = maxHealth && maxHealth > 0 ? maxHealth : damage + remaining;
    if (max > 0) {
      hpAnim = { from: damage + remaining, to: remaining, max };
    }
  }

  if (xp && num(xp.amount) > 0) {
    rows.push({ label: "XP gained", value: `+${fmt(xp.amount)}` });
  }
  if (levelUp) {
    rows.push({ label: "Level up", value: `Level ${num(levelUp.newLevel)}`, highlight: true });
  }

  // PvP can always be re-launched; an encounter only while it still lives.
  const canAttackAgain = Boolean(pvp) || (Boolean(attacked) && !defeated);

  return { tone, heading, sub, rows, hint, hpAnim, canAttackAgain };
}

// Post-hit HP severity drives both the bar fill colour and the critical tone the
// HP number cross-fades toward as it settles. Animated to a literal hex so the
// colour tween is clamp-safe under blend-free composition (not a baked class).
const CRIT_GREEN = "#10b981"; // emerald-500
const CRIT_AMBER = "#f59e0b"; // gold-500
const CRIT_RED = "#ef4444"; // red-500
function critTone(toPct: number): string {
  return toPct > 50 ? CRIT_GREEN : toPct > 25 ? CRIT_AMBER : CRIT_RED;
}

interface HpBarRefs {
  fillRef: RefObject<HTMLDivElement | null>;
  numRef: RefObject<HTMLSpanElement | null>;
}

/**
 * Diminishing HP bar — purely presentational. The drain, count-down and the
 * number's pop + colour crossfade are owned by the modal's single cinematic
 * timeline (it also rumbles the card on the same beat), so this just renders the
 * fill/number at their pre-hit start state and hands their refs up. Width is
 * normalised against the encounter's max HP so the bar reads "how much of the
 * enemy is left" rather than "how much this hit took".
 */
function HpDiminishBar({
  from,
  max,
  fromPct,
  toPct,
  fillRef,
  numRef,
}: HpBarRefs & {
  from: number;
  max: number;
  fromPct: number;
  toPct: number;
}) {
  // Ramp colour to match the post-hit HP — red when critical, amber low, green healthy.
  const fillColor = toPct > 50 ? "bg-emerald-500" : toPct > 25 ? "bg-gold-500" : "bg-red-500";

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-text-muted">Enemy HP</span>
        <span className="font-mono text-text-primary">
          <span ref={numRef}>{Math.round(from).toLocaleString()}</span>
          <span className="text-text-muted"> / {max.toLocaleString()}</span>
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-zinc-800">
        <div
          ref={fillRef}
          className={`h-full rounded-full ${fillColor}`}
          style={{ width: `${fromPct}%` }}
        />
      </div>
    </div>
  );
}

const TONE: Record<Tone, { ring: string; text: string; glow: string }> = {
  victory: {
    ring: "border-border-gold-bright/40",
    text: "text-text-gold",
    glow: "shadow-gold-500/20",
  },
  survive: { ring: "border-sky-700/50", text: "text-sky-300", glow: "shadow-sky-500/10" },
  defeat: { ring: "border-red-800/60", text: "text-red-400", glow: "shadow-red-900/30" },
};

/**
 * CombatOutcomeModal — a centered modal shown after an attack, summarising the
 * result from the transaction's events: win/lose, damage, loot, XP, level-ups.
 * Mounted once at the game-layout root; driven by the useCombatOutcome store.
 */
export function CombatOutcomeModal() {
  const events = useCombatOutcome((s) => s.events);
  const onAttackAgain = useCombatOutcome((s) => s.onAttackAgain);
  const context = useCombatOutcome((s) => s.context);
  const close = useCombatOutcome((s) => s.close);

  const backdropRef = useRef<HTMLDivElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const fillRef = useRef<HTMLDivElement | null>(null);
  const numRef = useRef<HTMLSpanElement | null>(null);

  const view = useMemo(
    () => (events ? buildView(events, context.maxHealth) : null),
    [events, context.maxHealth],
  );

  // The card springs in, then the load-bearing beat lands: the HP bar drains in
  // one decisive outQuart sweep while the card does a sub-6px irregular() rumble
  // timed exactly to the drain starting (heavier on defeat), the HP number counts
  // down in lockstep and pops outElastic, cross-fading its colour to the crit
  // tone, and the breakdown rows deal in on a stagger trailing the HP beat.
  //
  // Reference integration for the scope + mediaQueries.reduce + teardown pattern:
  // under reduce we set the final HP width + number directly, skip choreography,
  // and bail. Re-keyed on the rendered view's identity so a fresh outcome replays.
  const hp = view?.hpAnim;
  const fromPct = hp ? Math.max(0, Math.min(100, (hp.from / hp.max) * 100)) : 0;
  const toPct = hp ? Math.max(0, Math.min(100, (hp.to / hp.max) * 100)) : 0;
  const heavy = view?.tone === "defeat";

  useAnimeScope(
    {
      root: cardRef,
      mediaQueries: { reduce: "(prefers-reduced-motion: reduce)" },
      deps: [view],
    },
    ({ reduce }) => {
      if (!view) return;

      // Reduced motion: snap card + backdrop visible, settle HP final state, bail.
      if (reduce) {
        if (cardRef.current) {
          cardRef.current.style.opacity = "1";
          cardRef.current.style.transform = "none";
        }
        if (backdropRef.current) backdropRef.current.style.opacity = "1";
        if (hp) {
          if (fillRef.current) fillRef.current.style.width = `${toPct}%`;
          if (numRef.current) numRef.current.textContent = Math.round(hp.to).toLocaleString();
        }
        return;
      }

      // Pin initial state before the timeline plays so nothing flashes its final
      // frame for a tick (the rows render visible by default for SSR / reduce).
      if (view.rows.length > 0) utils.set(".outcome-row", { opacity: 0 });

      const tl = createTimeline({ defaults: { ease: "outQuart" } });

      // 1. Card springs in.
      tl.add(cardRef.current as HTMLElement, { scale: [0.86, 1], opacity: [0, 1], ease: BLOOM }, 0);

      if (backdropRef.current) {
        tl.add(backdropRef.current, { opacity: [0, 1], duration: 160, ease: "outQuad" }, 0);
      }

      if (hp && fillRef.current && numRef.current) {
        const drainMs = 820;

        // 2. Decisive HP drain (outQuart), trailing the card spring.
        tl.add(
          fillRef.current,
          { width: [`${fromPct}%`, `${toPct}%`], duration: drainMs },
          "+=120",
        );

        // 3. Sub-6px irregular() impact rumble, the SAME instant the drain starts.
        //    Amplitude stays under 6px or it reads as a glitch; defeat hits harder.
        tl.add(
          cardRef.current as HTMLElement,
          {
            x: [0, heavy ? 5 : 4, 0],
            y: [0, heavy ? -4 : -3, 0],
            duration: heavy ? 380 : 280,
            ease: irregular(10, heavy ? 2.4 : 1.4),
          },
          "<<",
        );

        // 4. HP number counts down in lockstep (plain-object target, utils.round).
        const counter = { v: hp.from };
        tl.add(
          counter,
          {
            v: [hp.from, hp.to],
            duration: drainMs,
            modifier: utils.round(0),
            onUpdate: () => {
              if (numRef.current) {
                numRef.current.textContent = Math.round(counter.v).toLocaleString();
              }
            },
          },
          "<<",
        );

        // 5. As it settles, the number pops outElastic and cross-fades its colour
        //    to the critical tone (animated, not baked at render). Positioned so
        //    the ring lands as the drain finishes, reading as "the blow settles".
        tl.add(
          numRef.current,
          { scale: [1, 1.25, 1], color: critTone(toPct), ease: "outElastic", duration: 620 },
          `<<+=${Math.round(drainMs * 0.55)}`,
        );
      }

      // 6. Breakdown rows deal in on a stagger trailing the HP beat.
      if (view.rows.length > 0) {
        tl.add(
          ".outcome-row",
          {
            opacity: [0, 1],
            y: [10, 0],
            duration: DUR.fast,
            delay: stagger(STAGGER.base),
          },
          hp ? "<<+=120" : "+=80",
        );
      }
    },
  );

  // Contain focus inside the card while the modal is up, move focus in on open,
  // restore it on close, and close on Escape. Only Escape closes — Enter must
  // not fire a stamina/NOVI-costing attack, so the trap's Tab cycling keeps
  // the keyboard on the modal's own buttons.
  useFocusTrap(cardRef, { active: Boolean(view), onEscape: close });

  if (!view) return null;

  const t = TONE[view.tone];

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4">
      <div
        ref={backdropRef}
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        style={{ opacity: 0 }}
        onClick={close}
      />

      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        style={{ opacity: 0 }}
        className={`relative w-full max-w-sm rounded-2xl border ${t.ring} bg-surface-raised p-6 shadow-2xl ${t.glow}`}
      >
        {/* Outcome emblem — a background-stripped bronze relief mark floating
            over the top edge. Rides the card's spring-in as a child. Decorative
            (empty title): the heading already names the outcome. */}
        <div className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/2">
          <GameIcon id={`combat-${view.tone}`} size={80} title="" className="object-contain" />
        </div>

        <div className="mt-7 text-center">
          <div className={`font-display text-2xl font-bold uppercase tracking-[0.18em] ${t.text}`}>
            {view.heading}
          </div>
          <div className="mt-1 text-xs text-text-muted">{view.sub}</div>
        </div>

        {view.hpAnim && (
          <div className="mt-5">
            <HpDiminishBar
              from={view.hpAnim.from}
              max={view.hpAnim.max}
              fromPct={fromPct}
              toPct={toPct}
              fillRef={fillRef}
              numRef={numRef}
            />
          </div>
        )}

        {view.rows.length > 0 && (
          <div className="mt-5 space-y-1.5">
            {view.rows.map((row, i) => (
              <div
                key={i}
                className={`outcome-row flex items-baseline justify-between rounded-md px-3 py-1.5 text-sm ${
                  row.highlight ? "bg-gold-500/10" : "bg-surface/60"
                }`}
              >
                <span className="text-xs text-text-muted">{row.label}</span>
                <span
                  className={`font-mono font-semibold ${
                    row.highlight ? "text-text-gold" : "text-text-primary"
                  }`}
                >
                  {row.value}
                </span>
              </div>
            ))}
          </div>
        )}

        {view.hint && <p className="mt-3 text-center text-[11px] text-text-muted">{view.hint}</p>}

        {view.canAttackAgain && onAttackAgain ? (
          <div className="mt-5 flex items-stretch gap-2">
            <button
              onClick={close}
              className="flex-1 rounded-lg border border-border-default bg-surface px-4 py-2.5 text-sm font-semibold text-text-muted hover:bg-surface/60"
            >
              Close
            </button>
            <div className="flex-[2]">
              <TxButton onClick={onAttackAgain} variant="primary">
                Attack Again
              </TxButton>
            </div>
          </div>
        ) : (
          <button
            onClick={close}
            className="mt-5 w-full rounded-lg border border-border-default bg-surface px-4 py-2.5 text-sm font-semibold text-text-primary hover:bg-surface/60"
          >
            Continue
          </button>
        )}
      </div>
    </div>
  );
}
