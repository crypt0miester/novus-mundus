/**
 * Leaf module for the on-chain BuildingType enum — kept free of React / hook
 * imports so the narrative layer can read these constants without dragging
 * `useFeatureGate` (and through it the entire narrative re-export cycle) back
 * into module evaluation. See systems.ts for the original TDZ that caused.
 *
 * Matches the Rust `BuildingType` enum in programs/novus_mundus/src/state.
 */

export const BuildingId = {
  Mansion: 0, Barracks: 1, Workshop: 2, Vault: 3, Dock: 4,
  Forge: 5, Market: 6, Academy: 7, Arena: 8, Sanctuary: 9,
  Observatory: 10, Treasury: 11, Citadel: 12, Camp: 13,
  Mine: 14, Catacombs: 15, Farm: 16, Stables: 17, Infirmary: 18,
} as const;

export const BuildingName: Record<number, string> = {
  0: "Mansion", 1: "Barracks", 2: "Workshop", 3: "Vault", 4: "Dock",
  5: "Forge", 6: "Market", 7: "Academy", 8: "Arena", 9: "Sanctuary",
  10: "Observatory", 11: "Treasury", 12: "Citadel", 13: "Camp",
  14: "Mine", 15: "Catacombs", 16: "Farm", 17: "Stable", 18: "Infirmary",
};
