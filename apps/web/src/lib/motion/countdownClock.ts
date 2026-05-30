// One shared countdown clock for every chain-truth countdown in the app.
//
// A single module-level createTimer loops while the registry is non-empty and
// fans its onUpdate out to every registered countdown. This bounds main-thread
// cost to one rAF loop regardless of how many countdowns are live, keeps them
// frame-synced, and pauses them together (the engine already pauses on document
// hidden).
//
// CRITICAL correctness note: remainingMs and fraction are computed from the
// browser wall clock (Date.now()), NEVER from anime-scaled timer time. The
// global engine.speed is dropped to ~0.001 under reduced motion and may be
// lowered during the tx confirm beat; if a chain countdown read the timer's own
// scaled clock it would lie about how much real chain time is left. Reading the
// wall clock keeps every countdown truthful regardless of engine.speed.

import { createTimer } from "animejs";
import type { Timer } from "animejs";

interface Countdown {
	endTs: number;
	startTs?: number;
	onTick: (remainingMs: number, fraction: number) => void;
}

// Live registry. Iteration order does not matter; we only ever add, remove, and
// fan out, so a Set is the right shape.
const registry = new Set<Countdown>();

// The single shared timer. Lazily created on first registration and cancelled
// (and dropped) when the registry empties, so an idle app burns no rAF loop.
let timer: Timer | null = null;

// Compute the current remaining time and progress fraction for one countdown
// from the browser wall clock. Kept in one place so the immediate first tick
// and the per-frame fan-out cannot diverge.
function sample(cd: Countdown, wallNow: number): { remainingMs: number; fraction: number } {
	const remainingMs = Math.max(0, cd.endTs - wallNow);
	let fraction: number;
	if (cd.startTs !== undefined) {
		const span = cd.endTs - cd.startTs;
		// Guard a zero or negative span so fraction stays well-defined.
		fraction = span > 0 ? (wallNow - cd.startTs) / span : 1;
	} else {
		// No start anchor: there is nothing to measure progress against, so the
		// fraction is simply 0 while time remains and 1 once expired.
		fraction = remainingMs > 0 ? 0 : 1;
	}
	// Clamp into [0,1] regardless of the branch above.
	if (fraction < 0) fraction = 0;
	else if (fraction > 1) fraction = 1;
	return { remainingMs, fraction };
}

function fanOut(): void {
	// Browser wall-clock time in ms. Deliberately not the timer's own time.
	const wallNow = Date.now();
	for (const cd of registry) {
		const { remainingMs, fraction } = sample(cd, wallNow);
		cd.onTick(remainingMs, fraction);
	}
}

function ensureTimer(): void {
	if (timer) return;
	timer = createTimer({
		// Run indefinitely; we stop it ourselves when the registry empties.
		loop: true,
		// duration only sets the loop period; onUpdate still fires every frame.
		duration: 1000,
		onUpdate: fanOut,
	});
}

function stopTimer(): void {
	if (!timer) return;
	timer.cancel();
	timer = null;
}

export function registerCountdown(opts: {
	endTs: number;
	startTs?: number;
	onTick: (remainingMs: number, fraction: number) => void;
}): () => void {
	const cd: Countdown = {
		endTs: opts.endTs,
		startTs: opts.startTs,
		onTick: opts.onTick,
	};
	registry.add(cd);
	ensureTimer();
	// Emit an immediate first tick so subscribers paint correct state before the
	// next frame, rather than flashing a default for one rAF.
	const { remainingMs, fraction } = sample(cd, Date.now());
	cd.onTick(remainingMs, fraction);

	return () => {
		registry.delete(cd);
		if (registry.size === 0) stopTimer();
	};
}
