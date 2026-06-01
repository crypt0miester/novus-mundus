/**
 * Shop Item & Bundle Data
 */

import { LAMPORTS_PER_SOL } from '@solana/web3.js';

export interface ShopItemData {
  itemId: number;
  name: string;
  itemType: number;
  category: number;    // 0=Equipment, 1=Consumable, 2=Material, 3=Cosmetic, 4=Currency
  rarity: number;
  quantityPerPurchase: number;
  baseStatsBps: number;
  priceSolLamports: number;
  maxGlobalStock: number;   // 0=unlimited
  maxPerPlayer: number;     // 0=unlimited
  maxPerDay: number;        // 0=unlimited
  isActive: boolean;
  isFeatured: boolean;
}

export interface BundleItemData {
  itemId: number;
  quantity: number;
}

export interface ShopBundleData {
  bundleId: number;
  name: string;
  tier: number;
  category: number;
  requiresSubscription: number;
  savingsBps: number;
  priceSolLamports: number;
  isActive: boolean;
  items: BundleItemData[];
}

export interface AllowedTokenData {
  name: string;
  mintAddress: string;
  discountBps: number;
}

export const SHOP_ITEMS: ShopItemData[] = [
  {
    itemId: 1,
    name: 'Gem Pack (100)',
    itemType: 50,
    category: 1,            // Consumable (Currency=4 not yet deployed)
    rarity: 0,
    quantityPerPurchase: 100,
    baseStatsBps: 0,
    priceSolLamports: Math.floor(LAMPORTS_PER_SOL * 0.01),
    maxGlobalStock: 0,
    maxPerPlayer: 0,
    maxPerDay: 0,
    isActive: true,
    isFeatured: false,
  },
  {
    itemId: 2,
    name: 'Fragment Pack (100)',
    itemType: 52,
    category: 1,            // Consumable (Currency=4 not yet deployed)
    rarity: 0,
    quantityPerPurchase: 100,
    baseStatsBps: 0,
    priceSolLamports: Math.floor(LAMPORTS_PER_SOL * 0.01),
    maxGlobalStock: 0,
    maxPerPlayer: 0,
    maxPerDay: 0,
    isActive: true,
    isFeatured: false,
  },
  {
    itemId: 3,
    name: 'Material Pack (50)',
    itemType: 200,
    category: 2,
    rarity: 0,
    quantityPerPurchase: 50,
    baseStatsBps: 0,
    priceSolLamports: Math.floor(LAMPORTS_PER_SOL * 0.01),
    maxGlobalStock: 0,
    maxPerPlayer: 0,
    maxPerDay: 0,
    isActive: true,
    isFeatured: false,
  },
  {
    // Legacy/broken: item_type 53 has no arm in fulfill_item, so this granted
    // nothing. item_type is immutable on-chain (update_item can't change it),
    // so this slot is retired and superseded by item #9 below.
    itemId: 4,
    name: 'Stamina Refill (legacy)',
    itemType: 53,
    category: 1,
    rarity: 0,
    quantityPerPurchase: 1,
    baseStatsBps: 0,
    priceSolLamports: Math.floor(LAMPORTS_PER_SOL * 0.005),
    maxGlobalStock: 0,
    maxPerPlayer: 0,
    maxPerDay: 10,
    isActive: false,
    isFeatured: false,
  },
  {
    // item_type 51 credits `cash_on_hand` in fulfill_item (NOT locked NOVI),
    // so the name reflects cash. quantityPerPurchase 10000 = 10k cash per buy.
    itemId: 5,
    name: 'Cash Pack (10,000)',
    itemType: 51,
    category: 1,            // Consumable (Currency=4 not yet deployed)
    rarity: 0,
    quantityPerPurchase: 10000,
    baseStatsBps: 0,
    priceSolLamports: Math.floor(LAMPORTS_PER_SOL * 0.05),
    maxGlobalStock: 0,
    maxPerPlayer: 0,
    maxPerDay: 0,
    isActive: true,
    isFeatured: true,
  },
  // Larger gem packs — same itemType (50) as Gem Pack (100), priced with a
  // bulk discount so buying gems in volume costs fewer txs and less SOL.
  {
    itemId: 6,
    name: 'Gem Pack (1,000)',
    itemType: 50,
    category: 1,
    rarity: 1,
    quantityPerPurchase: 1000,
    baseStatsBps: 0,
    priceSolLamports: Math.floor(LAMPORTS_PER_SOL * 0.09),  // ~10% bulk saving
    maxGlobalStock: 0,
    maxPerPlayer: 0,
    maxPerDay: 0,
    isActive: true,
    isFeatured: false,
  },
  {
    itemId: 7,
    name: 'Gem Pack (10,000)',
    itemType: 50,
    category: 1,
    rarity: 2,
    quantityPerPurchase: 10000,
    baseStatsBps: 0,
    priceSolLamports: Math.floor(LAMPORTS_PER_SOL * 0.8),   // ~20% bulk saving
    maxGlobalStock: 0,
    maxPerPlayer: 0,
    maxPerDay: 0,
    isActive: true,
    isFeatured: false,
  },
  {
    itemId: 8,
    name: 'Gem Pack (100,000)',
    itemType: 50,
    category: 1,
    rarity: 3,
    quantityPerPurchase: 100000,
    baseStatsBps: 0,
    priceSolLamports: Math.floor(LAMPORTS_PER_SOL * 7),     // ~30% bulk saving
    maxGlobalStock: 0,
    maxPerPlayer: 0,
    maxPerDay: 0,
    isActive: true,
    isFeatured: true,
  },
  {
    // Working stamina refill — replaces the retired item #4. item_type 60 is
    // `encounter_stamina` in fulfill_item, so a purchase adds 100 stamina.
    itemId: 9,
    name: 'Stamina Refill (100)',
    itemType: 60,
    category: 1,
    rarity: 0,
    quantityPerPurchase: 100,
    baseStatsBps: 0,
    priceSolLamports: Math.floor(LAMPORTS_PER_SOL * 0.005),
    maxGlobalStock: 0,
    maxPerPlayer: 0,
    maxPerDay: 10,
    isActive: true,
    isFeatured: false,
  },
  {
    // Cosmetic — Vanguard's Mark badge. item_type 1003 decodes to badge id 3
    // in fulfill_item (1000 base + id 3), which matches COSMETIC_BADGES[3]
    // in apps/web/src/lib/config/cosmetics-catalog.ts. Purchase flips the
    // owned_badges bit 3; the player can then equip via cosmetic::equip.
    itemId: 100,
    name: "Vanguard's Mark (Badge)",
    itemType: 1003,
    category: 3,            // Cosmetic
    rarity: 3,              // Legendary
    quantityPerPurchase: 1,
    baseStatsBps: 0,
    priceSolLamports: Math.floor(LAMPORTS_PER_SOL * 0.01),
    maxGlobalStock: 0,
    maxPerPlayer: 1,
    maxPerDay: 0,
    isActive: true,
    isFeatured: true,
  },
  // ── Cosmetic catalog (items 101–140) ──────────────────────────────
  // Pricing: rarity-based ladder, animated mythics priced higher.
  // All cosmetics use category=3, quantityPerPurchase=1, maxPerPlayer=1
  // (chain rejects re-buys via PurchaseLimitReached, mirrored by the
  // bitmask check in the web shop tab).
  //
  //   item_type formula (see processor/shop/common.rs):
  //     badge    = 1000 + catalog id (1–63)
  //     title    = 1064 + catalog id
  //     color    = 1128 + catalog id
  //     frame    = 1192 + catalog id
  //
  // Catalog rarity (common/rare/epic/legendary/mythic) collapses to the
  // chain enum (Common=0, Uncommon=1, Rare=2, Epic=3, Legendary=4); we
  // map mythic to Legendary since the chain enum has no Mythic.

  // Badges
  { itemId: 101, name: "Kingdom Pioneer (Badge)",  itemType: 1001, category: 3, rarity: 3, quantityPerPurchase: 1, baseStatsBps: 0, priceSolLamports: Math.floor(LAMPORTS_PER_SOL * 0.012), maxGlobalStock: 0, maxPerPlayer: 1, maxPerDay: 0, isActive: true, isFeatured: false },
  { itemId: 102, name: "Genesis Patron (Badge)",   itemType: 1002, category: 3, rarity: 4, quantityPerPurchase: 1, baseStatsBps: 0, priceSolLamports: Math.floor(LAMPORTS_PER_SOL * 0.05),  maxGlobalStock: 0, maxPerPlayer: 1, maxPerDay: 0, isActive: true, isFeatured: false },
  { itemId: 103, name: "Forgemaster (Badge)",      itemType: 1004, category: 3, rarity: 2, quantityPerPurchase: 1, baseStatsBps: 0, priceSolLamports: Math.floor(LAMPORTS_PER_SOL * 0.008), maxGlobalStock: 0, maxPerPlayer: 1, maxPerDay: 0, isActive: true, isFeatured: false },
  { itemId: 104, name: "Wanderer (Badge)",         itemType: 1005, category: 3, rarity: 0, quantityPerPurchase: 1, baseStatsBps: 0, priceSolLamports: Math.floor(LAMPORTS_PER_SOL * 0.005), maxGlobalStock: 0, maxPerPlayer: 1, maxPerDay: 0, isActive: true, isFeatured: false },
  { itemId: 105, name: "Crowned Patron (Badge)",   itemType: 1006, category: 3, rarity: 4, quantityPerPurchase: 1, baseStatsBps: 0, priceSolLamports: Math.floor(LAMPORTS_PER_SOL * 0.05),  maxGlobalStock: 0, maxPerPlayer: 1, maxPerDay: 0, isActive: true, isFeatured: false },
  { itemId: 106, name: "Sigilbearer (Badge)",      itemType: 1007, category: 3, rarity: 4, quantityPerPurchase: 1, baseStatsBps: 0, priceSolLamports: Math.floor(LAMPORTS_PER_SOL * 0.02),  maxGlobalStock: 0, maxPerPlayer: 1, maxPerDay: 0, isActive: true, isFeatured: false },
  { itemId: 107, name: "Sun-Sealed (Badge)",       itemType: 1008, category: 3, rarity: 3, quantityPerPurchase: 1, baseStatsBps: 0, priceSolLamports: Math.floor(LAMPORTS_PER_SOL * 0.012), maxGlobalStock: 0, maxPerPlayer: 1, maxPerDay: 0, isActive: true, isFeatured: false },
  { itemId: 108, name: "Goldleafed (Badge)",       itemType: 1009, category: 3, rarity: 2, quantityPerPurchase: 1, baseStatsBps: 0, priceSolLamports: Math.floor(LAMPORTS_PER_SOL * 0.008), maxGlobalStock: 0, maxPerPlayer: 1, maxPerDay: 0, isActive: true, isFeatured: false },

  // Titles
  { itemId: 109, name: "Wayfarer (Title)",          itemType: 1065, category: 3, rarity: 0, quantityPerPurchase: 1, baseStatsBps: 0, priceSolLamports: Math.floor(LAMPORTS_PER_SOL * 0.005), maxGlobalStock: 0, maxPerPlayer: 1, maxPerDay: 0, isActive: true, isFeatured: false },
  { itemId: 110, name: "Hearthkeeper (Title)",      itemType: 1066, category: 3, rarity: 2, quantityPerPurchase: 1, baseStatsBps: 0, priceSolLamports: Math.floor(LAMPORTS_PER_SOL * 0.008), maxGlobalStock: 0, maxPerPlayer: 1, maxPerDay: 0, isActive: true, isFeatured: false },
  { itemId: 111, name: "Stormcaller (Title)",       itemType: 1067, category: 3, rarity: 3, quantityPerPurchase: 1, baseStatsBps: 0, priceSolLamports: Math.floor(LAMPORTS_PER_SOL * 0.012), maxGlobalStock: 0, maxPerPlayer: 1, maxPerDay: 0, isActive: true, isFeatured: false },
  { itemId: 112, name: "Dungeon Conqueror (Title)", itemType: 1068, category: 3, rarity: 4, quantityPerPurchase: 1, baseStatsBps: 0, priceSolLamports: Math.floor(LAMPORTS_PER_SOL * 0.02),  maxGlobalStock: 0, maxPerPlayer: 1, maxPerDay: 0, isActive: true, isFeatured: false },
  { itemId: 113, name: "Treasury Whale (Title)",    itemType: 1069, category: 3, rarity: 4, quantityPerPurchase: 1, baseStatsBps: 0, priceSolLamports: Math.floor(LAMPORTS_PER_SOL * 0.02),  maxGlobalStock: 0, maxPerPlayer: 1, maxPerDay: 0, isActive: true, isFeatured: false },
  { itemId: 114, name: "Realm Pillar (Title)",      itemType: 1070, category: 3, rarity: 4, quantityPerPurchase: 1, baseStatsBps: 0, priceSolLamports: Math.floor(LAMPORTS_PER_SOL * 0.05),  maxGlobalStock: 0, maxPerPlayer: 1, maxPerDay: 0, isActive: true, isFeatured: false },
  { itemId: 115, name: "Patron (Title)",            itemType: 1071, category: 3, rarity: 2, quantityPerPurchase: 1, baseStatsBps: 0, priceSolLamports: Math.floor(LAMPORTS_PER_SOL * 0.008), maxGlobalStock: 0, maxPerPlayer: 1, maxPerDay: 0, isActive: true, isFeatured: false },
  { itemId: 116, name: "Maecenas (Title)",          itemType: 1072, category: 3, rarity: 3, quantityPerPurchase: 1, baseStatsBps: 0, priceSolLamports: Math.floor(LAMPORTS_PER_SOL * 0.012), maxGlobalStock: 0, maxPerPlayer: 1, maxPerDay: 0, isActive: true, isFeatured: false },
  { itemId: 117, name: "Endowed (Title)",           itemType: 1073, category: 3, rarity: 4, quantityPerPurchase: 1, baseStatsBps: 0, priceSolLamports: Math.floor(LAMPORTS_PER_SOL * 0.02),  maxGlobalStock: 0, maxPerPlayer: 1, maxPerDay: 0, isActive: true, isFeatured: false },
  { itemId: 118, name: "Skirmisher (Title)",        itemType: 1074, category: 3, rarity: 2, quantityPerPurchase: 1, baseStatsBps: 0, priceSolLamports: Math.floor(LAMPORTS_PER_SOL * 0.008), maxGlobalStock: 0, maxPerPlayer: 1, maxPerDay: 0, isActive: true, isFeatured: false },
  { itemId: 119, name: "Lancer (Title)",            itemType: 1075, category: 3, rarity: 2, quantityPerPurchase: 1, baseStatsBps: 0, priceSolLamports: Math.floor(LAMPORTS_PER_SOL * 0.008), maxGlobalStock: 0, maxPerPlayer: 1, maxPerDay: 0, isActive: true, isFeatured: false },
  { itemId: 120, name: "Crossbowman (Title)",       itemType: 1076, category: 3, rarity: 2, quantityPerPurchase: 1, baseStatsBps: 0, priceSolLamports: Math.floor(LAMPORTS_PER_SOL * 0.008), maxGlobalStock: 0, maxPerPlayer: 1, maxPerDay: 0, isActive: true, isFeatured: false },

  // Name colors — static
  { itemId: 121, name: "Parchment Ink (Color)",   itemType: 1129, category: 3, rarity: 0, quantityPerPurchase: 1, baseStatsBps: 0, priceSolLamports: Math.floor(LAMPORTS_PER_SOL * 0.005), maxGlobalStock: 0, maxPerPlayer: 1, maxPerDay: 0, isActive: true, isFeatured: false },
  // Off-theme; deactivated. Kept in the file (and on chain) so init shop
  // can flip isActive without leaving an orphan active row behind.
  { itemId: 122, name: "Mossbark (Color)",        itemType: 1130, category: 3, rarity: 2, quantityPerPurchase: 1, baseStatsBps: 0, priceSolLamports: Math.floor(LAMPORTS_PER_SOL * 0.008), maxGlobalStock: 0, maxPerPlayer: 1, maxPerDay: 0, isActive: false, isFeatured: false },
  { itemId: 123, name: "Ember (Color)",           itemType: 1131, category: 3, rarity: 2, quantityPerPurchase: 1, baseStatsBps: 0, priceSolLamports: Math.floor(LAMPORTS_PER_SOL * 0.008), maxGlobalStock: 0, maxPerPlayer: 1, maxPerDay: 0, isActive: true, isFeatured: false },
  // Off-theme; deactivated.
  { itemId: 124, name: "Royal Purple (Color)",    itemType: 1132, category: 3, rarity: 3, quantityPerPurchase: 1, baseStatsBps: 0, priceSolLamports: Math.floor(LAMPORTS_PER_SOL * 0.012), maxGlobalStock: 0, maxPerPlayer: 1, maxPerDay: 0, isActive: false, isFeatured: false },
  { itemId: 125, name: "Goldleaf (Color)",        itemType: 1133, category: 3, rarity: 4, quantityPerPurchase: 1, baseStatsBps: 0, priceSolLamports: Math.floor(LAMPORTS_PER_SOL * 0.02),  maxGlobalStock: 0, maxPerPlayer: 1, maxPerDay: 0, isActive: true, isFeatured: false },
  // Off-theme; deactivated.
  { itemId: 126, name: "Iridescent (Color)",      itemType: 1134, category: 3, rarity: 4, quantityPerPurchase: 1, baseStatsBps: 0, priceSolLamports: Math.floor(LAMPORTS_PER_SOL * 0.05),  maxGlobalStock: 0, maxPerPlayer: 1, maxPerDay: 0, isActive: false, isFeatured: false },
  { itemId: 127, name: "Copper (Color)",          itemType: 1135, category: 3, rarity: 2, quantityPerPurchase: 1, baseStatsBps: 0, priceSolLamports: Math.floor(LAMPORTS_PER_SOL * 0.008), maxGlobalStock: 0, maxPerPlayer: 1, maxPerDay: 0, isActive: true, isFeatured: false },
  { itemId: 128, name: "Electrum (Color)",        itemType: 1136, category: 3, rarity: 3, quantityPerPurchase: 1, baseStatsBps: 0, priceSolLamports: Math.floor(LAMPORTS_PER_SOL * 0.012), maxGlobalStock: 0, maxPerPlayer: 1, maxPerDay: 0, isActive: true, isFeatured: false },
  { itemId: 129, name: "Mithril (Color)",         itemType: 1137, category: 3, rarity: 4, quantityPerPurchase: 1, baseStatsBps: 0, priceSolLamports: Math.floor(LAMPORTS_PER_SOL * 0.02),  maxGlobalStock: 0, maxPerPlayer: 1, maxPerDay: 0, isActive: true, isFeatured: false },
  { itemId: 130, name: "Adamantine (Color)",      itemType: 1138, category: 3, rarity: 4, quantityPerPurchase: 1, baseStatsBps: 0, priceSolLamports: Math.floor(LAMPORTS_PER_SOL * 0.02),  maxGlobalStock: 0, maxPerPlayer: 1, maxPerDay: 0, isActive: true, isFeatured: false },
  { itemId: 131, name: "Obsidian (Color)",        itemType: 1139, category: 3, rarity: 4, quantityPerPurchase: 1, baseStatsBps: 0, priceSolLamports: Math.floor(LAMPORTS_PER_SOL * 0.05),  maxGlobalStock: 0, maxPerPlayer: 1, maxPerDay: 0, isActive: true, isFeatured: false },

  // Name colors — animated (priced higher; CSS keyframes drive the
  // visible animation in EntityPanel + wardrobe; canvas modulator in
  // CityTerrainMap2DFallback drives the world-map dot)
  { itemId: 132, name: "Pulse (Color)",           itemType: 1140, category: 3, rarity: 4, quantityPerPurchase: 1, baseStatsBps: 0, priceSolLamports: Math.floor(LAMPORTS_PER_SOL * 0.08),  maxGlobalStock: 0, maxPerPlayer: 1, maxPerDay: 0, isActive: true, isFeatured: false },
  { itemId: 133, name: "Embered (Color)",         itemType: 1141, category: 3, rarity: 4, quantityPerPurchase: 1, baseStatsBps: 0, priceSolLamports: Math.floor(LAMPORTS_PER_SOL * 0.08),  maxGlobalStock: 0, maxPerPlayer: 1, maxPerDay: 0, isActive: true, isFeatured: false },
  { itemId: 134, name: "Glimmer (Color)",         itemType: 1142, category: 3, rarity: 4, quantityPerPurchase: 1, baseStatsBps: 0, priceSolLamports: Math.floor(LAMPORTS_PER_SOL * 0.08),  maxGlobalStock: 0, maxPerPlayer: 1, maxPerDay: 0, isActive: true, isFeatured: false },
  { itemId: 135, name: "Vesper (Color)",          itemType: 1143, category: 3, rarity: 4, quantityPerPurchase: 1, baseStatsBps: 0, priceSolLamports: Math.floor(LAMPORTS_PER_SOL * 0.08),  maxGlobalStock: 0, maxPerPlayer: 1, maxPerDay: 0, isActive: true, isFeatured: false },
  { itemId: 136, name: "Cinder (Color)",          itemType: 1144, category: 3, rarity: 4, quantityPerPurchase: 1, baseStatsBps: 0, priceSolLamports: Math.floor(LAMPORTS_PER_SOL * 0.08),  maxGlobalStock: 0, maxPerPlayer: 1, maxPerDay: 0, isActive: true, isFeatured: false },

  // Avatar frames
  { itemId: 137, name: "Parchment Scroll (Frame)", itemType: 1193, category: 3, rarity: 0, quantityPerPurchase: 1, baseStatsBps: 0, priceSolLamports: Math.floor(LAMPORTS_PER_SOL * 0.005), maxGlobalStock: 0, maxPerPlayer: 1, maxPerDay: 0, isActive: true, isFeatured: false },
  { itemId: 138, name: "Royal Crest (Frame)",      itemType: 1194, category: 3, rarity: 3, quantityPerPurchase: 1, baseStatsBps: 0, priceSolLamports: Math.floor(LAMPORTS_PER_SOL * 0.012), maxGlobalStock: 0, maxPerPlayer: 1, maxPerDay: 0, isActive: true, isFeatured: false },
  { itemId: 139, name: "Dragon Coil (Frame)",      itemType: 1195, category: 3, rarity: 4, quantityPerPurchase: 1, baseStatsBps: 0, priceSolLamports: Math.floor(LAMPORTS_PER_SOL * 0.02),  maxGlobalStock: 0, maxPerPlayer: 1, maxPerDay: 0, isActive: true, isFeatured: false },
  { itemId: 140, name: "Starlight Aureole (Frame)", itemType: 1196, category: 3, rarity: 4, quantityPerPurchase: 1, baseStatsBps: 0, priceSolLamports: Math.floor(LAMPORTS_PER_SOL * 0.05),  maxGlobalStock: 0, maxPerPlayer: 1, maxPerDay: 0, isActive: true, isFeatured: false },
];

export const SHOP_BUNDLES: ShopBundleData[] = [
  {
    bundleId: 1,
    name: 'Starter Bundle',
    tier: 0,
    category: 0,
    requiresSubscription: 0,
    savingsBps: 1500,
    priceSolLamports: Math.floor(LAMPORTS_PER_SOL * 0.02),
    isActive: true,
    items: [
      { itemId: 1, quantity: 2 },  // Gems x200
      { itemId: 2, quantity: 1 },  // Fragments x100
      { itemId: 3, quantity: 1 },  // Materials x50
    ],
  },
  {
    bundleId: 2,
    name: 'Combat Bundle',
    tier: 0,
    category: 0,
    requiresSubscription: 0,
    savingsBps: 2000,
    priceSolLamports: Math.floor(LAMPORTS_PER_SOL * 0.04),
    isActive: true,
    items: [
      { itemId: 2, quantity: 5 },  // Fragments x500
      { itemId: 9, quantity: 3 },  // Stamina x300 (3 × Stamina Refill 100) — item 4 was retired
    ],
  },
];

export const ALLOWED_TOKENS: AllowedTokenData[] = [];
