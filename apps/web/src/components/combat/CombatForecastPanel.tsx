"use client";

import { useEffect } from "react";
import { ShieldAlert, Swords } from "lucide-react";
import { cairnBeat } from "@/lib/narrative";
import { useCairnNudgeStore } from "@/lib/store/cairn-nudge";
import type { CombatForecastResult } from "@/lib/hooks/useCombatForecast";
import type { CombatKind } from "@/lib/combat/forecast";
import type { RefillPlan } from "@/lib/combat/refill";

interface RefillControls {
  plan: RefillPlan | null;
  run: () => Promise<unknown>;
  running: boolean;
  isLegendary: boolean;
}

interface CombatForecastPanelProps {
  result: CombatForecastResult;
  combat: CombatKind;
  /** Rally only: pull committed sliders up to the recommended force from stock. */
  onFillFromInventory?: () => void;
  /** Whether owned inventory can cover the recommendation (enables Fill). */
  fillAvailable?: boolean;
  /** Legendary "reinforce & arm" controls — omit to hide the refill action. */
  refill?: RefillControls;
  /**
   * Rally framing: the recommended force is the WHOLE rally's bar, not this
   * player's alone. `pooled` is what allies have already committed. Set on the
   * rally create + join panels so the copy reads as a group effort.
   */
  rally?: { pooled: number };
}

type Tone = "calm" | "watch" | "grave";

/** The Cairn states the situation; tone drives colour + which beat the orb says. */
function read(result: CombatForecastResult): {
  tone: Tone;
  line: string;
  beatKey: string | null;
} {
  const { verdict, coverage } = result;

  // Under-arming is the most common silent loss — surface it first.
  if (coverage.underArmed) {
    return {
      tone: "watch",
      line: `Steel for ${coverage.weapons.toLocaleString()} of ${coverage.units.toLocaleString()} hands. The rest swing at nothing.`,
      beatKey: "combatUnarmed",
    };
  }

  switch (verdict) {
    case "loss-decisive":
      return {
        tone: "grave",
        line: "This host breaks on that wall. It does not come back.",
        beatKey: "combatThinHost",
      };
    case "loss":
      return {
        tone: "grave",
        line: "This host is too thin for that gate. It marches, and it does not march home.",
        beatKey: "combatThinHost",
      };
    case "close":
      return {
        tone: "watch",
        line: "The count runs near even. Even is the ground where a host is spent for nothing.",
        beatKey: "combatCloseRun",
      };
    case "win":
      return { tone: "calm", line: "Enough, with a little to spare.", beatKey: null };
    case "win-decisive":
      return { tone: "calm", line: "The wall there will not hold this host.", beatKey: null };
    default:
      return { tone: "calm", line: "", beatKey: null };
  }
}

const TONE_CLASS: Record<Tone, string> = {
  calm: "border-zinc-800 text-text-muted",
  watch: "border-border-gold/60 bg-accent/10 text-text-gold",
  grave: "border-danger/50 bg-danger/10 text-danger",
};

/**
 * Inline combat forecast — a soft, Cairn-voiced read of whether the committed
 * host wins, with the recommended force and the actions to reach it. Never
 * blocks the attack: the player may want to lose. When the read turns to
 * "watch" or "grave" it also nudges the Cairn orb to speak the matching beat.
 */
export function CombatForecastPanel({
  result,
  combat,
  onFillFromInventory,
  fillAvailable,
  refill,
  rally,
}: CombatForecastPanelProps) {
  const { tone, line, beatKey } = read(result);
  const say = useCairnNudgeStore((s) => s.say);

  // Fire the orb when the read becomes a warning. Keyed on the band (not the raw
  // counts) so dragging a slider within the same verdict doesn't re-trigger.
  useEffect(() => {
    if (beatKey) say(cairnBeat(beatKey));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [beatKey, combat]);

  if (!result.ready || !line) return null;

  const rec = result.recommended;
  const acquire = result.acquire;
  const showRecommendation = tone !== "calm" && rec && rec.totalUnits > 0;
  const needsAcquire = !!acquire && (acquire.troops > 0 || acquire.weapons > 0);

  const Icon = tone === "grave" ? ShieldAlert : Swords;

  return (
    <div className={`rounded-lg border px-3 py-2.5 text-xs ${TONE_CLASS[tone]}`}>
      <div className="flex items-start gap-2">
        <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <p className="leading-snug">{line}</p>
      </div>

      {showRecommendation && rec && (
        <div className="mt-2 border-t border-current/15 pt-2 text-text-muted">
          {rec.achievable ? (
            <p>
              {rally ? "The rally needs" : "To take it:"}{" "}
              <span className="font-semibold text-text-primary">
                ~{rec.totalUnits.toLocaleString()} troops
              </span>
              {rally ? " in all" : ""}, fully armed (
              <span className="font-semibold text-text-primary">
                {rec.weaponsTotal.toLocaleString()} weapons
              </span>
              ).
              {rally && rally.pooled > 0 && (
                <span> {rally.pooled.toLocaleString()} already gathered.</span>
              )}
            </p>
          ) : (
            <p>No host within reach takes this one. Pick a softer target.</p>
          )}

          {needsAcquire && acquire && (
            <p className="mt-1">
              {rally ? "Allies or a refill must still bring:" : "Beyond your muster:"}
              {acquire.troops > 0 && (
                <span className="text-text-primary">
                  {" "}
                  {acquire.troops.toLocaleString()} more troops
                </span>
              )}
              {acquire.troops > 0 && acquire.weapons > 0 && " and"}
              {acquire.weapons > 0 && (
                <span className="text-text-primary">
                  {" "}
                  {acquire.weapons.toLocaleString()} more weapons
                </span>
              )}
              .
            </p>
          )}
        </div>
      )}

      {(onFillFromInventory || refill) && tone !== "calm" && (
        <div className="mt-2 flex flex-wrap gap-2">
          {onFillFromInventory && (
            <button
              type="button"
              onClick={onFillFromInventory}
              disabled={!fillAvailable}
              className="rounded-md border border-border-gold/50 bg-accent/20 px-2.5 py-1 text-[11px] font-medium text-text-primary transition-colors enabled:hover:bg-accent/40 disabled:cursor-not-allowed disabled:opacity-40"
              title={
                fillAvailable
                  ? "Commit up to the recommended force from your stock"
                  : "Your muster can't cover the recommendation"
              }
            >
              Bring up the host
            </button>
          )}
          {refill && <RefillButton refill={refill} />}
        </div>
      )}
    </div>
  );
}

/** Legendary-gated "reinforce & arm" — disabled with a reason when not viable. */
function RefillButton({ refill }: { refill: RefillControls }) {
  const { plan, run, running, isLegendary } = refill;

  if (!isLegendary) {
    return (
      <span
        className="rounded-md border border-zinc-700 px-2.5 py-1 text-[11px] text-text-muted"
        title="Auto reinforce & arm is a Legendary charter privilege"
      >
        Reinforce & arm (Legendary)
      </span>
    );
  }

  const blocked = !plan || plan.empty || plan.blockers.length > 0;
  const title = plan?.blockers.length
    ? `Can't refill: ${plan.blockers.join(", ")}`
    : "Hire the missing troops and buy the weapons to arm them";

  return (
    <button
      type="button"
      onClick={() => void run()}
      disabled={blocked || running}
      className="rounded-md border border-border-gold/60 bg-accent/30 px-2.5 py-1 text-[11px] font-medium text-text-gold transition-colors enabled:hover:bg-accent/50 disabled:cursor-not-allowed disabled:opacity-40"
      title={title}
    >
      {running ? "Raising levies…" : "Reinforce & arm"}
    </button>
  );
}
