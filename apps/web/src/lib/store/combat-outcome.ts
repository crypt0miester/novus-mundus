import { create } from "zustand";
import type { NovusMundusEvent } from "novus-mundus-sdk";
import type { TxPhase } from "@/components/shared/TxButton";

/** Re-runs the same attack; shaped to drop straight into a TxButton's onClick. */
export type AttackAgain = (
  reportPhase: (phase: TxPhase) => void,
) => Promise<string>;

interface CombatOutcomeState {
  /** Events from the most recent combat tx, or null when the modal is closed. */
  events: NovusMundusEvent[] | null;
  /** Re-run the same attack — wired by the panel so the modal can offer it. */
  onAttackAgain: AttackAgain | null;
  /** Open the outcome modal with a transaction's parsed events. */
  show: (events: NovusMundusEvent[], onAttackAgain?: AttackAgain) => void;
  close: () => void;
}

/**
 * Holds the events from the latest attack so the CombatOutcomeModal can render
 * a win/lose breakdown. Fed from attack handlers via `show(result.events, …)`.
 */
export const useCombatOutcome = create<CombatOutcomeState>((set) => ({
  events: null,
  onAttackAgain: null,
  show: (events, onAttackAgain) =>
    set({ events, onAttackAgain: onAttackAgain ?? null }),
  close: () => set({ events: null, onAttackAgain: null }),
}));
