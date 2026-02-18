/**
 * Deterministic town layout configuration.
 *
 * Every plot position, building slot offset, and building-to-plot
 * assignment is fixed here. Nothing is randomized at runtime.
 *
 * Coordinate system (camera yaw 30°, pitch 45°):
 *   NW (upper-left viewport) = (-x, -z) in world space
 *   SE (lower-right viewport) = (+x, +z) in world space
 *
 * Plots cascade NW → SE as the player unlocks them (1→5).
 */

export const TOWN_LAYOUT = {
  plots: [
    {
      id: 0,
      label: 'Starter — NW',
      center: { x: -3.5, z: -3.5 },
      slots: [
        { dx: -0.55, dz: -0.55, rotation: 0.785 },
        { dx:  0.55, dz: -0.55, rotation: -0.785 },
        { dx: -0.55, dz:  0.55, rotation: 2.356 },
        { dx:  0.55, dz:  0.55, rotation: -2.356 },
      ],
      buildings: [0, 1, 2, 3], // Mansion, Barracks, Workshop, Vault
    },
    {
      id: 1,
      label: 'Trade — W',
      center: { x: -1.5, z: -1.5 },
      slots: [
        { dx: -0.55, dz: -0.45, rotation: 0.524 },
        { dx:  0.55, dz: -0.45, rotation: -0.524 },
        { dx: -0.55, dz:  0.45, rotation: 2.618 },
        { dx:  0.55, dz:  0.45, rotation: -2.618 },
      ],
      buildings: [4, 5, 6], // Dock, Forge, Market
    },
    {
      id: 2,
      label: 'Knowledge — center',
      center: { x: 0.5, z: 0.0 },
      slots: [
        { dx: -0.55, dz: -0.55, rotation: 0 },
        { dx:  0.55, dz: -0.55, rotation: 0 },
        { dx: -0.55, dz:  0.55, rotation: 3.14159 },
        { dx:  0.55, dz:  0.55, rotation: 3.14159 },
      ],
      buildings: [7, 8], // Academy, Arena
    },
    {
      id: 3,
      label: 'Sacred — E',
      center: { x: 2.5, z: 2.0 },
      slots: [
        { dx: -0.55, dz: -0.55, rotation: -2.356 },
        { dx:  0.55, dz: -0.55, rotation: 2.356 },
        { dx: -0.55, dz:  0.55, rotation: -0.785 },
        { dx:  0.55, dz:  0.55, rotation: 0.785 },
      ],
      buildings: [9, 10], // Sanctuary, Observatory
    },
    {
      id: 4,
      label: 'Prestige — far SE',
      center: { x: 4.0, z: 4.0 },
      slots: [
        { dx: -0.55, dz: -0.55, rotation: -2.356 },
        { dx:  0.55, dz: -0.55, rotation: 2.356 },
        { dx: -0.55, dz:  0.55, rotation: -0.785 },
        { dx:  0.55, dz:  0.55, rotation: 0.785 },
      ],
      buildings: [11, 12], // Treasury, Citadel
    },
  ],

  buildingNames: {
    0:  'Mansion',
    1:  'Barracks',
    2:  'Workshop',
    3:  'Vault',
    4:  'Dock',
    5:  'Forge',
    6:  'Market',
    7:  'Academy',
    8:  'Arena',
    9:  'Sanctuary',
    10: 'Observatory',
    11: 'Treasury',
    12: 'Citadel',
  },
};
