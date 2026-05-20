"use client";

import { useEffect, useMemo, useRef } from "react";
import { animate, spring } from "animejs";
import { useCombatOutcome } from "@/lib/store/combat-outcome";
import { TxButton } from "@/components/shared/TxButton";

function num(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "bigint") return Number(v);
  if (v && typeof (v as { toNumber?: () => number }).toNumber === "function") {
    return (v as { toNumber: () => number }).toNumber();
  }
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

    if (num(pvp.cashStolen) > 0) rows.push({ label: "Cash stolen", value: `$${fmt(pvp.cashStolen)}` });
    if (num(pvp.armorStolen) > 0) rows.push({ label: "Armor stolen", value: fmt(pvp.armorStolen) });
    if (num(pvp.produceStolen) > 0) rows.push({ label: "Produce stolen", value: fmt(pvp.produceStolen) });
    if (num(pvp.vehiclesStolen) > 0) rows.push({ label: "Vehicles stolen", value: fmt(pvp.vehiclesStolen) });
  } else if (defeated) {
    tone = "victory";
    heading = "Encounter Defeated";
    sub = `${RARITY[num(defeated.encounterType)] ?? "Encounter"} · Level ${num(defeated.level)}`;
    const cash = num(defeated.lootCash);
    const novi = num(defeated.lootNovi);
    if (cash > 0) rows.push({ label: "Loot · cash", value: `$${fmt(cash)}` });
    if (novi > 0) rows.push({ label: "Loot · NOVI", value: fmt(novi) });
    if (cash > 0 || novi > 0) hint = "Unclaimed loot is waiting in your Inventory.";
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
      rows.push({ label: "NOVI spent", value: fmt(attacked.noviConsumed) });
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

/**
 * Diminishing HP bar — starts at pre-hit HP and animates down to the post-hit
 * value via animejs. Width is normalised against the encounter's max HP so the
 * bar reads "how much of the enemy is left" rather than "how much this hit took".
 */
function HpDiminishBar({ from, to, max }: HpAnim) {
  const fillRef = useRef<HTMLDivElement | null>(null);
  const numRef = useRef<HTMLSpanElement | null>(null);

  const fromPct = Math.max(0, Math.min(100, (from / max) * 100));
  const toPct = Math.max(0, Math.min(100, (to / max) * 100));
  // Ramp colour to match the post-hit HP — red when critical, amber low, green healthy.
  const fillColor = toPct > 50 ? "bg-emerald-500" : toPct > 25 ? "bg-amber-500" : "bg-red-500";

  useEffect(() => {
    if (!fillRef.current) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      fillRef.current.style.width = `${toPct}%`;
      if (numRef.current) numRef.current.textContent = Math.round(to).toLocaleString();
      return;
    }

    fillRef.current.style.width = `${fromPct}%`;
    animate(fillRef.current, {
      width: [`${fromPct}%`, `${toPct}%`],
      duration: 900,
      delay: 220,
      ease: "outQuart",
    });

    const counter = { v: from };
    animate(counter, {
      v: to,
      duration: 900,
      delay: 220,
      ease: "outQuart",
      onUpdate: () => {
        if (numRef.current) {
          numRef.current.textContent = Math.round(counter.v).toLocaleString();
        }
      },
    });
  }, [from, to, fromPct, toPct]);

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
  victory: { ring: "border-amber-500/40", text: "text-amber-300", glow: "shadow-amber-500/20" },
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

  const view = useMemo(
    () => (events ? buildView(events, context.maxHealth) : null),
    [events, context.maxHealth],
  );

  // Pop the card in with a spring; fade the backdrop.
  useEffect(() => {
    if (!view) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (backdropRef.current) {
      animate(backdropRef.current, { opacity: [0, 1], duration: 160, ease: "outQuad" });
    }
    if (cardRef.current) {
      animate(cardRef.current, {
        opacity: [0, 1],
        scale: [0.86, 1],
        ease: spring({ stiffness: 190, damping: 19 }),
      });
    }
  }, [view]);

  useEffect(() => {
    if (!view) return;
    const onKey = (e: KeyboardEvent) => {
      // Only Escape — Enter must not fire a stamina/NOVI-costing attack.
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view, close]);

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
        <div className="text-center">
          <div className={`font-display text-2xl font-bold uppercase tracking-[0.18em] ${t.text}`}>
            {view.heading}
          </div>
          <div className="mt-1 text-xs text-text-muted">{view.sub}</div>
        </div>

        {view.hpAnim && (
          <div className="mt-5">
            <HpDiminishBar {...view.hpAnim} />
          </div>
        )}

        {view.rows.length > 0 && (
          <div className="mt-5 space-y-1.5">
            {view.rows.map((row, i) => (
              <div
                key={i}
                className={`flex items-baseline justify-between rounded-md px-3 py-1.5 text-sm ${
                  row.highlight ? "bg-amber-500/10" : "bg-surface/60"
                }`}
              >
                <span className="text-xs text-text-muted">{row.label}</span>
                <span
                  className={`font-mono font-semibold ${
                    row.highlight ? "text-amber-300" : "text-text-primary"
                  }`}
                >
                  {row.value}
                </span>
              </div>
            ))}
          </div>
        )}

        {view.hint && (
          <p className="mt-3 text-center text-[11px] text-text-muted">{view.hint}</p>
        )}

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
