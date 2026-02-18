import { create } from "zustand";

interface GameStore {
  // UI state
  selectedCityId: number | null;
  activeModal: string | null;

  // Wallet-derived
  walletConnected: boolean;

  // Actions
  setSelectedCity: (id: number) => void;
  openModal: (id: string) => void;
  closeModal: () => void;
  setWalletConnected: (connected: boolean) => void;
}

export const useGameStore = create<GameStore>((set) => ({
  selectedCityId: null,
  activeModal: null,
  walletConnected: false,

  setSelectedCity: (id) => set({ selectedCityId: id }),
  openModal: (id) => set({ activeModal: id }),
  closeModal: () => set({ activeModal: null }),
  setWalletConnected: (connected) => set({ walletConnected: connected }),
}));
