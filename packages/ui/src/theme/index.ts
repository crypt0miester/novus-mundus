// Gold theme tokens — importable for JS-land usage (anime.js, etc.)
export const theme = {
  colors: {
    gold: {
      50: "#fefce8",
      100: "#fef9c3",
      200: "#fef08a",
      300: "#fde047",
      400: "#fbbf24",
      500: "#f59e0b",
      600: "#d97706",
      700: "#b45309",
      800: "#92400e",
      900: "#78350f",
    },
    surface: {
      base: "#09090b",
      raised: "#18181b",
      overlay: "#27272a",
    },
    text: {
      primary: "#fafafa",
      secondary: "#a1a1aa",
      gold: "#fbbf24",
      muted: "#52525b",
    },
    status: {
      danger: "#ef4444",
      success: "#22c55e",
      info: "#3b82f6",
    },
  },
  shadows: {
    goldSm: "0 0 8px rgba(251, 191, 36, 0.15)",
    goldMd: "0 0 16px rgba(251, 191, 36, 0.2)",
    goldLg: "0 0 32px rgba(251, 191, 36, 0.3)",
    goldGlow: "0 0 40px rgba(251, 191, 36, 0.4), 0 0 80px rgba(251, 191, 36, 0.1)",
  },
  // Golden ratio constant used throughout game math
  phi: 1.618033988749895,
} as const;

// Rarity colors
export const rarityColors = {
  common: "#a1a1aa",    // zinc-400
  uncommon: "#22c55e",  // green-500
  rare: "#3b82f6",      // blue-500
  epic: "#a855f7",      // purple-500
  legendary: "#fbbf24", // amber-400 (gold)
  mythic: "#ef4444",    // red-500
} as const;

// Unit tier colors
export const tierColors = {
  1: "#a1a1aa",  // zinc-400
  2: "#22c55e",  // green
  3: "#3b82f6",  // blue
  4: "#a855f7",  // purple
  5: "#fbbf24",  // gold
  6: "#ef4444",  // red
} as const;
