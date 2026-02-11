/**
 * Shared constants for the terrain renderer system.
 * Extracted from terrain-renderer.js for reuse across modules.
 */

export const DEG = Math.PI / 180;
export const M_PER_GU = 11.1; // meters per game unit (1 GU ~ 11.1m)

// ─── Building Types ───

export const BUILDING_TYPES = [
  { id: 0,  name: 'Mansion',     tier: 1, color: 0xd4a574, roof: 0x8b4513 },
  { id: 1,  name: 'Barracks',    tier: 1, color: 0x8b7355, roof: 0x556b2f },
  { id: 2,  name: 'Workshop',    tier: 1, color: 0xa0522d, roof: 0x696969 },
  { id: 3,  name: 'Vault',       tier: 1, color: 0x708090, roof: 0xc0c0c0 },
  { id: 4,  name: 'Dock',        tier: 1, color: 0x8b7355, roof: 0xdeb887 },
  { id: 5,  name: 'Forge',       tier: 2, color: 0x8b4513, roof: 0xb22222 },
  { id: 6,  name: 'Market',      tier: 2, color: 0xdaa520, roof: 0xff6347 },
  { id: 7,  name: 'Academy',     tier: 2, color: 0x4682b4, roof: 0x191970 },
  { id: 8,  name: 'Arena',       tier: 2, color: 0xcd853f, roof: 0x8b0000 },
  { id: 9,  name: 'Sanctuary',   tier: 3, color: 0xe6e6fa, roof: 0x9370db },
  { id: 10, name: 'Observatory', tier: 3, color: 0x2f4f4f, roof: 0x4169e1 },
  { id: 11, name: 'Treasury',    tier: 3, color: 0xffd700, roof: 0xdaa520 },
  { id: 12, name: 'Citadel',     tier: 3, color: 0x696969, roof: 0x2f2f2f },
];

export const DEFAULT_PLOT_POSITIONS = [
  { x: -1.05, z:  0.95 },  // Plot 1 — SW (starter)
  { x:  1.05, z:  0.95 },  // Plot 2 — SE
  { x: -1.05, z: -0.75 },  // Plot 3 — NW
  { x:  1.05, z: -0.75 },  // Plot 4 — NE
  { x:  0.0,  z: -1.70 },  // Plot 5 — N (prestige)
];

export const SLOT_OFFSETS = [
  { dx: -0.17, dz: -0.17 },
  { dx:  0.17, dz: -0.17 },
  { dx: -0.17, dz:  0.17 },
  { dx:  0.17, dz:  0.17 },
];
