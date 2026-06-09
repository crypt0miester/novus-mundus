// Procedural sound-effect engine for the daily-activity minigames.
//
// Sounds are synthesized at runtime via WebAudio oscillators + gain
// envelopes, so there are zero audio assets to ship or load. One shared
// AudioContext is created lazily on the first play call — which always
// happens inside a user gesture (a tap in a game), satisfying the browser
// autoplay policy. Muting reads the live `soundEnabled` setting, so the
// engine stays decoupled from React.
//
// (Sound is a stateless module singleton — `playSfx` is fire-and-forget —
// whereas the visual FX bus in GameStage is a React context, because it owns
// canvas + RAF lifecycle that must mount and tear down with the game.)

import { useSettings } from "@/lib/store/settings";

export type SfxName =
  | "flip" // a tile turns over / a soft tap
  | "select" // an item is picked
  | "correct" // a right call
  | "wrong" // a wrong call
  | "match" // a pair lands
  | "combo" // a streak ticks up (pitch rises with `count`)
  | "win" // round cleared
  | "tick"; // timer urgency blip

let ctx: AudioContext | null = null;
let master: GainNode | null = null;

// Lazily create (and resume) the shared context. Returns null when WebAudio
// is unavailable or blocked, so callers can no-op silently.
function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const Ctor: typeof AudioContext | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = 0.5; // headroom so layered tones never clip
    master.connect(ctx.destination);
  }
  // A context created before the first gesture starts suspended; resume is a
  // no-op once running. The play path is always gesture-initiated.
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

interface ToneOpts {
  freq: number;
  dur: number; // seconds
  type?: OscillatorType;
  gain?: number; // peak gain (0..1) before master
  attack?: number; // seconds
  slideTo?: number; // optional end frequency for a pitch glide
  delay?: number; // seconds from now
}

// One enveloped oscillator: linear attack to peak, exponential decay to
// silence. Nodes are short-lived and self-stop, so there's nothing to GC.
function tone(c: AudioContext, o: ToneOpts): void {
  if (!master) return;
  const t0 = c.currentTime + (o.delay ?? 0);
  const peak = o.gain ?? 0.12;
  const attack = o.attack ?? 0.005;

  const osc = c.createOscillator();
  osc.type = o.type ?? "sine";
  osc.frequency.setValueAtTime(o.freq, t0);
  if (o.slideTo) osc.frequency.exponentialRampToValueAtTime(o.slideTo, t0 + o.dur);

  const env = c.createGain();
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.linearRampToValueAtTime(peak, t0 + attack);
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);

  osc.connect(env).connect(master);
  osc.start(t0);
  osc.stop(t0 + o.dur + 0.02);
}

/**
 * Play a named effect. No-ops when sound is muted, WebAudio is unavailable,
 * or the page is server-side. `count` lets `combo` rise in pitch with a
 * streak; ignored by the other effects.
 */
export function playSfx(name: SfxName, count = 0): void {
  if (!useSettings.getState().soundEnabled) return;
  const c = audio();
  if (!c) return;

  switch (name) {
    case "flip":
      tone(c, { freq: 620, dur: 0.06, type: "sine", gain: 0.08 });
      break;
    case "select":
      tone(c, { freq: 720, dur: 0.07, type: "triangle", gain: 0.1 });
      break;
    case "correct":
      tone(c, { freq: 660, dur: 0.1, type: "triangle", gain: 0.11 });
      tone(c, { freq: 988, dur: 0.14, type: "triangle", gain: 0.11, delay: 0.06 });
      break;
    case "wrong":
      tone(c, { freq: 200, dur: 0.18, type: "sawtooth", gain: 0.09, slideTo: 120 });
      break;
    case "match":
      // Bright triad pluck.
      tone(c, { freq: 659, dur: 0.12, type: "triangle", gain: 0.1 });
      tone(c, { freq: 988, dur: 0.14, type: "triangle", gain: 0.1, delay: 0.03 });
      tone(c, { freq: 1319, dur: 0.16, type: "sine", gain: 0.08, delay: 0.06 });
      break;
    case "combo": {
      // Each step up the streak climbs a semitone-ish, capped so it stays musical.
      const step = Math.min(count, 8);
      tone(c, { freq: 520 * 1.06 ** step, dur: 0.09, type: "square", gain: 0.07 });
      break;
    }
    case "win": {
      // Ascending arpeggio C-E-G-C.
      const notes = [523, 659, 784, 1047];
      for (let i = 0; i < notes.length; i++) {
        tone(c, { freq: notes[i]!, dur: 0.18, type: "triangle", gain: 0.1, delay: i * 0.08 });
      }
      break;
    }
    case "tick":
      tone(c, { freq: 1500, dur: 0.03, type: "sine", gain: 0.05 });
      break;
  }
}
