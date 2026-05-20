import { create } from "zustand";
import type { NovusMundusEvent } from "novus-mundus-sdk";
import type { TxPhase } from "@/components/shared/TxButton";

/** Re-runs the same attack; shaped to drop straight into a TxButton's onClick. */
export type AttackAgain = (
  reportPhase: (phase: TxPhase) => void,
) => Promise<string>;

/**
 * Out-of-band context the modal needs but can't read from the events alone.
 * `maxHealth` lets the HP bar scale to the encounter's full health instead of
 * falling back to "pre-hit HP", which would mis-represent a multi-attack fight.
 */
export interface CombatOutcomeContext {
  maxHealth?: number;
}

interface CombatOutcomeState {
  /** Events from the most recent combat tx, or null when the modal is closed. */
  events: NovusMundusEvent[] | null;
  /** Re-run the same attack — wired by the panel so the modal can offer it. */
  onAttackAgain: AttackAgain | null;
  /** Side-channel data (encounter max HP, …) the modal renders alongside events. */
  context: CombatOutcomeContext;
  /** Open the outcome modal with a transaction's parsed events. */
  show: (
    events: NovusMundusEvent[],
    onAttackAgain?: AttackAgain,
    context?: CombatOutcomeContext,
  ) => void;
  close: () => void;
}

/**
 * Holds the events from the latest attack so the CombatOutcomeModal can render
 * a win/lose breakdown. Fed from attack handlers via `show(result.events, …)`.
 */
export const useCombatOutcome = create<CombatOutcomeState>((set) => ({
  events: null,
  onAttackAgain: null,
  context: {},
  show: (events, onAttackAgain, context) =>
    set({
      events,
      onAttackAgain: onAttackAgain ?? null,
      context: context ?? {},
    }),
  close: () => set({ events: null, onAttackAgain: null, context: {} }),
}));
