/**
 * terrain-renderer.js — Backward-compatible entry point.
 *
 * Re-exports from the modular src/ folder structure.
 * All logic has been split into reusable modules:
 *
 *   src/core/     — constants, utilities, facade renderer
 *   src/globe/    — globe sphere, azimuthal projection
 *   src/city/     — city terrain heightmap
 *   src/town/     — town estate editor (buildings, environment, HUD)
 *
 * Import from this file or directly from src/ — both work.
 */

export { TerrainRenderer, BUILDING_TYPES } from './src/core/renderer.js';
export { DEFAULT_PLOT_POSITIONS, SLOT_OFFSETS } from './src/core/constants.js';
