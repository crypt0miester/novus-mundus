// Shared motion material, built once at module scope and imported everywhere.
// Recreating a spring per render re-runs its simulation, so springs live here as
// module-level singletons. A global retune is a one-file change.

import { spring } from "animejs";

export const PRESS = spring({ stiffness: 240, damping: 18 });
export const SETTLE = spring({ stiffness: 210, damping: 24 });
export const BLOOM = spring({ stiffness: 190, damping: 14 });
export const REORDER = spring({ stiffness: 200, damping: 20 });
export const WORLD_FLING = spring({ stiffness: 90, damping: 16 });

export const DUR = { fast: 200, base: 420, slow: 700 } as const;

export const STAGGER = { tight: 28, base: 45, loose: 70 } as const;

export const EASE = {
	out: "outExpo",
	inOut: "inOutQuad",
	drama: "outQuart",
	anticipate: "inBack",
} as const;
