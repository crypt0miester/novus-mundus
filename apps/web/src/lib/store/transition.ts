import { create } from "zustand";
import { getCachedAct, actDef, cairnBeat } from "@/lib/narrative";

type TransitionPhase = "idle" | "entering" | "holding" | "exiting";
type TransitionKind = "wipe" | "act-beat";

/** An act beat: a copy line resolved from the act or the Cairn. */
type ActBeatPhase = "inciting" | "payoff" | "oath" | "coronation";

// Transition Messages

const ENTER_MESSAGES = [
  "Entering the Kingdom...",
  "The Gates Open...",
  "Your Kingdom Awaits...",
  "The Throne Room Beckons...",
  "Marshaling Your Forces...",
  "A Legend Returns...",
  "The Crown Calls...",
  "Dawn Breaks Over the Kingdom...",
  "Your Armies Await Orders...",
  "The Realm Stirs...",
  "Unsheathing the Blade...",
  "The War Council Convenes...",
  "Torches Light the Hall...",
];

const LEGENDARY_ENTER_MESSAGES = [
  "The Legend Returns...",
  "Reality Bends to Your Will...",
  "The Mythic King Descends...",
  "Kingdoms Tremble at Your Arrival...",
  "The Stars Align Once More...",
  "An Era Begins Anew...",
  "The Cosmos Acknowledges You...",
];

const SPECTATE_MESSAGES = [
  "Observing from the Shadows...",
  "Watching from the Ramparts...",
  "A Curious Wanderer Appears...",
  "Peering Through the Gates...",
  "Lurking in the Tavern...",
  "Slipping Past the Guards...",
  "A Peasant Surveys the Land...",
];

const EXIT_MESSAGES = [
  "Until Next Time, King.",
  "The Gates Close Behind You...",
  "Your Kingdom Rests...",
  "The Throne Stands Empty...",
  "Dusk Falls Over the Realm...",
  "The Banners Lower...",
  "Your Legend Endures...",
  "The Kingdom Sleeps...",
  "The Fires Dim...",
];

const LEGENDARY_EXIT_MESSAGES = [
  "The Legend Fades... For Now.",
  "Even Myths Must Rest...",
  "The Cosmos Remembers Your Name...",
  "Until the Stars Align Again...",
  "Your Myth Echoes Through Time...",
];

function pick(messages: string[]): string {
  return messages[Math.floor(Math.random() * messages.length)]!;
}

// The grand "king/legend" register is reserved for the late acts — only act 4
// (Mastery) and beyond have earned it; earlier acts stay grounded.
export function enterMessage(): string {
  return pick(getCachedAct() >= 4 ? LEGENDARY_ENTER_MESSAGES : ENTER_MESSAGES);
}
export function spectateMessage(): string {
  return pick(SPECTATE_MESSAGES);
}
export function exitMessage(): string {
  return pick(getCachedAct() >= 4 ? LEGENDARY_EXIT_MESSAGES : EXIT_MESSAGES);
}

// Store

interface TransitionStore {
  phase: TransitionPhase;
  kind: TransitionKind;
  message: string;
  /** Act name shown as the eyebrow label on an act-beat. Empty for a wipe. */
  actName: string;
  destination: string | null;

  trigger: (message: string, destination: string) => void;
  triggerActBeat: (opts: { act: number; phase: ActBeatPhase }) => void;
  advance: (phase: TransitionPhase) => void;
  reset: () => void;
}

function actBeatCopy(act: number, phase: ActBeatPhase): string {
  switch (phase) {
    case "inciting":
      return actDef(act).inciting;
    case "payoff":
      return actDef(act).payoff;
    case "oath":
      return cairnBeat("oath");
    case "coronation":
      return cairnBeat("coronation");
  }
}

export const useTransitionStore = create<TransitionStore>((set) => ({
  phase: "idle",
  kind: "wipe",
  message: "",
  actName: "",
  destination: null,

  trigger: (message, destination) =>
    set({ phase: "entering", kind: "wipe", message, actName: "", destination }),

  triggerActBeat: ({ act, phase }) =>
    set({
      phase: "entering",
      kind: "act-beat",
      message: actBeatCopy(act, phase),
      actName: actDef(act).name,
      destination: null,
    }),

  advance: (phase) => set({ phase }),

  reset: () => set({ phase: "idle", kind: "wipe", message: "", actName: "", destination: null }),
}));
