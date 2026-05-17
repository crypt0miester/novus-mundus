import { create } from "zustand";

interface DungeonHeroState {
  /**
   * base58 mint of the hero chosen for the next dungeon run. `null` means
   * "no explicit choice" — the Dungeon tab falls back to the first owned hero.
   */
  selectedMint: string | null;
  setSelectedMint(mint: string): void;
}

/**
 * The champion picked for a dungeon run. Written by the DungeonHeroPanel
 * (RightPanel) and read by the Dungeon tab — they are separate components, so
 * the selection lives here between them.
 */
export const useDungeonHeroStore = create<DungeonHeroState>((set) => ({
  selectedMint: null,
  setSelectedMint: (mint) => set({ selectedMint: mint }),
}));
