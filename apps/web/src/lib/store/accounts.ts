import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import type { PublicKey } from "@solana/web3.js";
import type {
  PlayerCore,
  UserAccount,
  CityAccount,
  GameEngine,
  EncounterAccount,
  TeamAccount,
  TeamMemberSlot,
  TeamInviteAccount,
  TreasuryRequest,
  ExpeditionAccount,
  LootAccount,
  ArenaSeasonAccount,
  ArenaParticipantAccount,
  ArenaLoadoutAccount,
  CastleAccount,
  KingRegistryAccount,
  CourtPositionAccount,
  GarrisonContributionAccount,
  TeamCastleRewardAccount,
  RallyAccount,
  RallyParticipant,
  ReinforcementAccount,
  EventAccount,
  EventParticipation,
  DungeonRunAccount,
  DungeonTemplateAccount,
  DungeonLeaderboardAccount,
  ShopConfigAccount,
  ShopItemAccount,
  BundleAccount,
  FlashSaleAccount,
  DailyDealAccount,
  EstateAccount,
  LocationAccount,
  ResearchTemplateAccount,
  ResearchProgressAccount,
  HeroTemplateAccount,
  WeeklySaleAccount,
  SeasonalSaleAccount,
  DAOPromotionAccount,
  AllowedTokenAccount,
  PlayerPurchaseAccount,
} from "novus-mundus-sdk";
import { OCCUPANT_PLAYER } from "novus-mundus-sdk";

// Account Store Types

interface AccountEntry<T> {
  pubkey: PublicKey;
  account: T;
}

// Enriched shop entries — include PDA-derived IDs needed by UI
interface ShopItemEntry extends AccountEntry<ShopItemAccount> {
  itemId: number;
}
interface BundleEntry extends AccountEntry<BundleAccount> {
  bundleId: number;
}
interface FlashSaleEntry extends AccountEntry<FlashSaleAccount> {
  saleId: number;
}
interface DailyDealEntry extends AccountEntry<DailyDealAccount> {
  slot: number;
}
interface PlayerPurchaseEntry extends AccountEntry<PlayerPurchaseAccount> {
  itemId: number;
}

interface AccountsState {
  // Core accounts (nullable until loaded)
  player: AccountEntry<PlayerCore> | null;
  user: AccountEntry<UserAccount> | null;
  gameEngine: AccountEntry<GameEngine> | null;

  // Collection accounts (keyed by pubkey base58)
  cities: Map<string, AccountEntry<CityAccount>>;
  encounters: Map<string, AccountEntry<EncounterAccount>>;
  loot: Map<string, AccountEntry<LootAccount>>;
  otherPlayers: Map<string, AccountEntry<PlayerCore>>;
  /* Enemy war-bands aimed at the local player, kept live by the program-wide
   * WS. Feeds the Cairn's incoming-threat warning; usually empty. */
  incomingRallies: Map<string, AccountEntry<RallyAccount>>;
  teamMembers: Map<string, AccountEntry<TeamMemberSlot>>;
  teamInvites: Map<string, AccountEntry<TeamInviteAccount>>;
  treasuryRequests: Map<string, AccountEntry<TreasuryRequest>>;
  rallyParticipants: Map<string, AccountEntry<RallyParticipant>>;
  events: Map<string, AccountEntry<EventAccount>>;
  eventParticipations: Map<string, AccountEntry<EventParticipation>>;
  dungeonTemplates: Map<string, AccountEntry<DungeonTemplateAccount>>;
  dungeonLeaderboards: Map<string, AccountEntry<DungeonLeaderboardAccount>>;
  garrisonContributions: Map<string, AccountEntry<GarrisonContributionAccount>>;
  kingRegistries: Map<string, AccountEntry<KingRegistryAccount>>;
  courtPositions: Map<string, AccountEntry<CourtPositionAccount>>;
  teamCastleRewards: Map<string, AccountEntry<TeamCastleRewardAccount>>;
  shopItems: Map<string, ShopItemEntry>;
  bundles: Map<string, BundleEntry>;
  flashSales: Map<string, FlashSaleEntry>;
  dailyDeals: Map<string, DailyDealEntry>;
  playerPurchases: Map<string, PlayerPurchaseEntry>;
  locations: Map<string, AccountEntry<LocationAccount>>;
  researchTemplates: Map<string, AccountEntry<ResearchTemplateAccount>>;
  heroTemplates: Map<string, AccountEntry<HeroTemplateAccount>>;
  daoPromotions: Map<string, AccountEntry<DAOPromotionAccount>>;
  allowedTokens: Map<string, AccountEntry<AllowedTokenAccount>>;

  // Optional accounts (player may not have these)
  team: AccountEntry<TeamAccount> | null;
  /* Multi-team cache, keyed by base58 pubkey. Distinct from the single
   * `team` slot above (which scopes to the local player's team via
   * useTeam). Populated by `useTeams(pubkeys[])` for map-side rival
   * lookups, EntityPanel team chips, etc. */
  teamsByPda: Map<string, AccountEntry<TeamAccount>>;
  expedition: AccountEntry<ExpeditionAccount> | null;
  arenaSeason: AccountEntry<ArenaSeasonAccount> | null;
  arenaParticipant: AccountEntry<ArenaParticipantAccount> | null;
  arenaLoadout: AccountEntry<ArenaLoadoutAccount> | null;
  castle: AccountEntry<CastleAccount> | null;
  rally: AccountEntry<RallyAccount> | null;
  reinforcement: AccountEntry<ReinforcementAccount> | null;
  dungeonRun: AccountEntry<DungeonRunAccount> | null;
  shopConfig: AccountEntry<ShopConfigAccount> | null;
  estate: AccountEntry<EstateAccount> | null;
  researchProgress: AccountEntry<ResearchProgressAccount> | null;
  weeklySale: AccountEntry<WeeklySaleAccount> | null;
  seasonalSale: AccountEntry<SeasonalSaleAccount> | null;

  // Lifecycle
  loading: boolean;
  subscriptionActive: boolean;

  // The current user's player PDA (set during subscription init)
  myPlayerPda: string | null;
  // The castle the current user holds, if any (set by usePlayerCastle). Lets the
  // WS route castle-targeted rallies into incomingRallies without an extra fetch.
  myCastlePda: string | null;

  // Actions — singletons
  setLoading: (loading: boolean) => void;
  setMyPlayerPda: (pda: string) => void;
  setMyCastlePda: (pda: string | null) => void;
  setPlayer: (pubkey: PublicKey, account: PlayerCore) => void;
  setUser: (pubkey: PublicKey, account: UserAccount) => void;
  setGameEngine: (pubkey: PublicKey, account: GameEngine) => void;
  setTeam: (pubkey: PublicKey, account: TeamAccount) => void;
  /** Bulk-upsert into the multi-team cache (`teamsByPda`). */
  upsertTeams: (entries: { pubkey: PublicKey; account: TeamAccount }[]) => void;
  setExpedition: (pubkey: PublicKey, account: ExpeditionAccount) => void;
  setArenaSeason: (pubkey: PublicKey, account: ArenaSeasonAccount) => void;
  setArenaParticipant: (pubkey: PublicKey, account: ArenaParticipantAccount) => void;
  setArenaLoadout: (pubkey: PublicKey, account: ArenaLoadoutAccount) => void;
  setCastle: (pubkey: PublicKey, account: CastleAccount) => void;
  setRally: (pubkey: PublicKey, account: RallyAccount) => void;
  setReinforcement: (pubkey: PublicKey, account: ReinforcementAccount) => void;
  setDungeonRun: (pubkey: PublicKey, account: DungeonRunAccount) => void;
  setShopConfig: (pubkey: PublicKey, account: ShopConfigAccount) => void;
  setEstate: (pubkey: PublicKey, account: EstateAccount) => void;
  setResearchProgress: (pubkey: PublicKey, account: ResearchProgressAccount) => void;
  setWeeklySale: (pubkey: PublicKey, account: WeeklySaleAccount) => void;
  setSeasonalSale: (pubkey: PublicKey, account: SeasonalSaleAccount) => void;
  upsertPlayerPurchase: (
    pubkey: PublicKey,
    account: PlayerPurchaseAccount,
    itemId?: number,
  ) => void;

  // Actions — collections
  upsertCity: (pubkey: PublicKey, account: CityAccount) => void;
  upsertEncounter: (pubkey: PublicKey, account: EncounterAccount) => void;
  removeEncounter: (key: string) => void;
  upsertLoot: (pubkey: PublicKey, account: LootAccount) => void;
  removeLoot: (key: string) => void;
  upsertOtherPlayer: (pubkey: PublicKey, account: PlayerCore) => void;
  upsertIncomingRally: (pubkey: PublicKey, account: RallyAccount) => void;
  removeIncomingRally: (key: string) => void;
  upsertTeamMember: (pubkey: PublicKey, account: TeamMemberSlot) => void;
  upsertTeamInvite: (pubkey: PublicKey, account: TeamInviteAccount) => void;
  removeTeamInvite: (key: string) => void;
  upsertTreasuryRequest: (pubkey: PublicKey, account: TreasuryRequest) => void;
  upsertRallyParticipant: (pubkey: PublicKey, account: RallyParticipant) => void;
  upsertEvent: (pubkey: PublicKey, account: EventAccount) => void;
  upsertEventParticipation: (pubkey: PublicKey, account: EventParticipation) => void;
  upsertDungeonTemplate: (pubkey: PublicKey, account: DungeonTemplateAccount) => void;
  upsertDungeonLeaderboard: (pubkey: PublicKey, account: DungeonLeaderboardAccount) => void;
  upsertGarrisonContribution: (pubkey: PublicKey, account: GarrisonContributionAccount) => void;
  upsertKingRegistry: (pubkey: PublicKey, account: KingRegistryAccount) => void;
  upsertCourtPosition: (pubkey: PublicKey, account: CourtPositionAccount) => void;
  upsertTeamCastleReward: (pubkey: PublicKey, account: TeamCastleRewardAccount) => void;
  upsertLocation: (pubkey: PublicKey, account: LocationAccount) => void;
  removeLocation: (key: string) => void;
  // Reconcile the store's locations for one city against an authoritative
  // fetched set (the on-chain occupied cells). Removes any city cell the chain
  // no longer reports: this clears ghosts left by closes the WS never
  // delivered (programSubscribe drops closes of accounts reassigned to System).
  reconcileCityLocations: (cityId: number, presentKeys: Set<string>) => void;
  // Evict a closed PDA from every short-lived map that may hold it. The close
  // notification carries no discriminator, so we cannot route by AccountKey;
  // this checks each closable map by pubkey and rebuilds only the ones that hit.
  removeClosedAccount: (key: string) => void;
  upsertResearchTemplate: (pubkey: PublicKey, account: ResearchTemplateAccount) => void;
  upsertHeroTemplate: (pubkey: PublicKey, account: HeroTemplateAccount) => void;
  upsertDaoPromotion: (pubkey: PublicKey, account: DAOPromotionAccount) => void;
  upsertAllowedToken: (pubkey: PublicKey, account: AllowedTokenAccount) => void;

  // Shop upserts (with enriched IDs)
  upsertShopItem: (pubkey: PublicKey, account: ShopItemAccount, itemId?: number) => void;
  upsertBundle: (pubkey: PublicKey, account: BundleAccount, bundleId?: number) => void;
  upsertFlashSale: (pubkey: PublicKey, account: FlashSaleAccount, saleId?: number) => void;
  upsertDailyDeal: (pubkey: PublicKey, account: DailyDealAccount, slot?: number) => void;
  // Bulk replace (for refetch after WS detects new entries)
  replaceAllBundles: (entries: BundleEntry[]) => void;
  replaceAllFlashSales: (entries: FlashSaleEntry[]) => void;
  replaceAllDailyDeals: (entries: DailyDealEntry[]) => void;
  replaceAllPlayerPurchases: (entries: PlayerPurchaseEntry[]) => void;

  setSubscriptionActive: (active: boolean) => void;
  reset: () => void;
}

// Helpers

function upsertMap<T>(
  map: Map<string, AccountEntry<T>>,
  pubkey: PublicKey,
  account: T,
): Map<string, AccountEntry<T>> {
  const next = new Map(map);
  next.set(pubkey.toBase58(), { pubkey, account });
  return next;
}

function removeFromMap<T>(map: Map<string, T>, key: string): Map<string, T> {
  const next = new Map(map);
  next.delete(key);
  return next;
}

// Store

const initialState = {
  player: null,
  user: null,
  gameEngine: null,
  cities: new Map() as Map<string, AccountEntry<CityAccount>>,
  encounters: new Map() as Map<string, AccountEntry<EncounterAccount>>,
  loot: new Map() as Map<string, AccountEntry<LootAccount>>,
  otherPlayers: new Map() as Map<string, AccountEntry<PlayerCore>>,
  incomingRallies: new Map() as Map<string, AccountEntry<RallyAccount>>,
  teamMembers: new Map() as Map<string, AccountEntry<TeamMemberSlot>>,
  teamInvites: new Map() as Map<string, AccountEntry<TeamInviteAccount>>,
  treasuryRequests: new Map() as Map<string, AccountEntry<TreasuryRequest>>,
  rallyParticipants: new Map() as Map<string, AccountEntry<RallyParticipant>>,
  events: new Map() as Map<string, AccountEntry<EventAccount>>,
  eventParticipations: new Map() as Map<string, AccountEntry<EventParticipation>>,
  dungeonTemplates: new Map() as Map<string, AccountEntry<DungeonTemplateAccount>>,
  dungeonLeaderboards: new Map() as Map<string, AccountEntry<DungeonLeaderboardAccount>>,
  garrisonContributions: new Map() as Map<string, AccountEntry<GarrisonContributionAccount>>,
  kingRegistries: new Map() as Map<string, AccountEntry<KingRegistryAccount>>,
  courtPositions: new Map() as Map<string, AccountEntry<CourtPositionAccount>>,
  teamCastleRewards: new Map() as Map<string, AccountEntry<TeamCastleRewardAccount>>,
  shopItems: new Map() as Map<string, ShopItemEntry>,
  bundles: new Map() as Map<string, BundleEntry>,
  flashSales: new Map() as Map<string, FlashSaleEntry>,
  dailyDeals: new Map() as Map<string, DailyDealEntry>,
  playerPurchases: new Map() as Map<string, PlayerPurchaseEntry>,
  locations: new Map() as Map<string, AccountEntry<LocationAccount>>,
  researchTemplates: new Map() as Map<string, AccountEntry<ResearchTemplateAccount>>,
  heroTemplates: new Map() as Map<string, AccountEntry<HeroTemplateAccount>>,
  daoPromotions: new Map() as Map<string, AccountEntry<DAOPromotionAccount>>,
  allowedTokens: new Map() as Map<string, AccountEntry<AllowedTokenAccount>>,
  team: null,
  teamsByPda: new Map() as Map<string, AccountEntry<TeamAccount>>,
  expedition: null,
  arenaSeason: null,
  arenaParticipant: null,
  arenaLoadout: null,
  castle: null,
  rally: null,
  reinforcement: null,
  dungeonRun: null,
  shopConfig: null,
  estate: null,
  researchProgress: null,
  weeklySale: null,
  seasonalSale: null,
  loading: false,
  subscriptionActive: false,
  myPlayerPda: null,
  myCastlePda: null,
};

export const useAccountStore = create<AccountsState>()(
  subscribeWithSelector((set) => ({
    ...initialState,

    setLoading: (loading) => set({ loading }),
    setMyPlayerPda: (pda) => set({ myPlayerPda: pda }),
    setMyCastlePda: (pda) => set({ myCastlePda: pda }),

    // Singletons
    setPlayer: (pubkey, account) => set({ player: { pubkey, account } }),
    setUser: (pubkey, account) => set({ user: { pubkey, account } }),
    setGameEngine: (pubkey, account) => set({ gameEngine: { pubkey, account } }),
    setTeam: (pubkey, account) => set({ team: { pubkey, account } }),
    upsertTeams: (entries) =>
      set((s) => {
        if (entries.length === 0) return {};
        const next = new Map(s.teamsByPda);
        for (const e of entries) {
          next.set(e.pubkey.toBase58(), { pubkey: e.pubkey, account: e.account });
        }
        return { teamsByPda: next };
      }),
    setExpedition: (pubkey, account) => set({ expedition: { pubkey, account } }),
    setArenaSeason: (pubkey, account) => set({ arenaSeason: { pubkey, account } }),
    setArenaParticipant: (pubkey, account) => set({ arenaParticipant: { pubkey, account } }),
    setArenaLoadout: (pubkey, account) => set({ arenaLoadout: { pubkey, account } }),
    setCastle: (pubkey, account) => set({ castle: { pubkey, account } }),
    setRally: (pubkey, account) => set({ rally: { pubkey, account } }),
    setReinforcement: (pubkey, account) => set({ reinforcement: { pubkey, account } }),
    setDungeonRun: (pubkey, account) => set({ dungeonRun: { pubkey, account } }),
    setShopConfig: (pubkey, account) => set({ shopConfig: { pubkey, account } }),
    setEstate: (pubkey, account) => set({ estate: { pubkey, account } }),
    setResearchProgress: (pubkey, account) => set({ researchProgress: { pubkey, account } }),
    setWeeklySale: (pubkey, account) => set({ weeklySale: { pubkey, account } }),
    setSeasonalSale: (pubkey, account) => set({ seasonalSale: { pubkey, account } }),
    upsertPlayerPurchase: (pubkey, account, itemId?) =>
      set((s) => {
        const key = pubkey.toBase58();
        const next = new Map(s.playerPurchases);
        const existing = s.playerPurchases.get(key);
        const id = itemId ?? existing?.itemId ?? -1;
        next.set(key, { pubkey, account, itemId: id });
        return { playerPurchases: next };
      }),

    // Collections
    upsertCity: (pubkey, account) => set((s) => ({ cities: upsertMap(s.cities, pubkey, account) })),
    upsertEncounter: (pubkey, account) =>
      set((s) => ({ encounters: upsertMap(s.encounters, pubkey, account) })),
    removeEncounter: (key) => set((s) => ({ encounters: removeFromMap(s.encounters, key) })),
    upsertLoot: (pubkey, account) => set((s) => ({ loot: upsertMap(s.loot, pubkey, account) })),
    removeLoot: (key) => set((s) => ({ loot: removeFromMap(s.loot, key) })),
    upsertOtherPlayer: (pubkey, account) =>
      set((s) => ({ otherPlayers: upsertMap(s.otherPlayers, pubkey, account) })),
    upsertIncomingRally: (pubkey, account) =>
      set((s) => ({ incomingRallies: upsertMap(s.incomingRallies, pubkey, account) })),
    removeIncomingRally: (key) =>
      set((s) => ({ incomingRallies: removeFromMap(s.incomingRallies, key) })),
    upsertTeamMember: (pubkey, account) =>
      set((s) => ({ teamMembers: upsertMap(s.teamMembers, pubkey, account) })),
    upsertTeamInvite: (pubkey, account) =>
      set((s) => ({ teamInvites: upsertMap(s.teamInvites, pubkey, account) })),
    removeTeamInvite: (key) => set((s) => ({ teamInvites: removeFromMap(s.teamInvites, key) })),
    upsertTreasuryRequest: (pubkey, account) =>
      set((s) => ({ treasuryRequests: upsertMap(s.treasuryRequests, pubkey, account) })),
    upsertRallyParticipant: (pubkey, account) =>
      set((s) => ({ rallyParticipants: upsertMap(s.rallyParticipants, pubkey, account) })),
    upsertEvent: (pubkey, account) =>
      set((s) => ({ events: upsertMap(s.events, pubkey, account) })),
    upsertEventParticipation: (pubkey, account) =>
      set((s) => ({ eventParticipations: upsertMap(s.eventParticipations, pubkey, account) })),
    upsertDungeonTemplate: (pubkey, account) =>
      set((s) => ({ dungeonTemplates: upsertMap(s.dungeonTemplates, pubkey, account) })),
    upsertDungeonLeaderboard: (pubkey, account) =>
      set((s) => ({ dungeonLeaderboards: upsertMap(s.dungeonLeaderboards, pubkey, account) })),
    upsertGarrisonContribution: (pubkey, account) =>
      set((s) => ({ garrisonContributions: upsertMap(s.garrisonContributions, pubkey, account) })),
    upsertKingRegistry: (pubkey, account) =>
      set((s) => ({ kingRegistries: upsertMap(s.kingRegistries, pubkey, account) })),
    upsertCourtPosition: (pubkey, account) =>
      set((s) => ({ courtPositions: upsertMap(s.courtPositions, pubkey, account) })),
    upsertTeamCastleReward: (pubkey, account) =>
      set((s) => ({ teamCastleRewards: upsertMap(s.teamCastleRewards, pubkey, account) })),
    upsertLocation: (pubkey, account) =>
      set((s) => {
        const key = pubkey.toBase58();
        const next = new Map(s.locations);
        // One player occupies exactly one cell on-chain (the old cell's PDA is
        // closed on move). programSubscribe does not reliably deliver that
        // close, so the old entry can linger as a ghost. When a player cell
        // arrives, evict any other cell the same player held: the new cell's
        // arrival is reliable even when the old cell's close is not.
        if (account.occupantType === OCCUPANT_PLAYER) {
          const occ = account.occupant.toBase58();
          for (const [k, entry] of next) {
            if (
              k !== key &&
              entry.account.occupantType === OCCUPANT_PLAYER &&
              entry.account.occupant.toBase58() === occ
            ) {
              next.delete(k);
            }
          }
        }
        next.set(key, { pubkey, account });
        return { locations: next };
      }),
    removeLocation: (key) => set((s) => ({ locations: removeFromMap(s.locations, key) })),
    reconcileCityLocations: (cityId, presentKeys) =>
      set((s) => {
        let next: Map<string, AccountEntry<LocationAccount>> | null = null;
        for (const [k, entry] of s.locations) {
          if (entry.account.cityId === cityId && !presentKeys.has(k)) {
            if (!next) next = new Map(s.locations);
            next.delete(k);
          }
        }
        return next ? { locations: next } : {};
      }),
    removeClosedAccount: (key) =>
      set((s) => {
        // Only the maps that mirror closable PDAs. Pubkeys are globally unique,
        // so a key can hit at most one map; rebuild just those (usually one,
        // often zero). Returning an empty patch is a no-op for zustand.
        const patch: Partial<AccountsState> = {};
        if (s.locations.has(key)) patch.locations = removeFromMap(s.locations, key);
        if (s.encounters.has(key)) patch.encounters = removeFromMap(s.encounters, key);
        if (s.loot.has(key)) patch.loot = removeFromMap(s.loot, key);
        if (s.incomingRallies.has(key))
          patch.incomingRallies = removeFromMap(s.incomingRallies, key);
        if (s.rallyParticipants.has(key))
          patch.rallyParticipants = removeFromMap(s.rallyParticipants, key);
        if (s.teamMembers.has(key)) patch.teamMembers = removeFromMap(s.teamMembers, key);
        if (s.teamInvites.has(key)) patch.teamInvites = removeFromMap(s.teamInvites, key);
        if (s.treasuryRequests.has(key))
          patch.treasuryRequests = removeFromMap(s.treasuryRequests, key);
        if (s.eventParticipations.has(key))
          patch.eventParticipations = removeFromMap(s.eventParticipations, key);
        if (s.garrisonContributions.has(key))
          patch.garrisonContributions = removeFromMap(s.garrisonContributions, key);
        if (s.teamCastleRewards.has(key))
          patch.teamCastleRewards = removeFromMap(s.teamCastleRewards, key);
        if (s.courtPositions.has(key))
          patch.courtPositions = removeFromMap(s.courtPositions, key);
        if (s.allowedTokens.has(key)) patch.allowedTokens = removeFromMap(s.allowedTokens, key);
        return patch;
      }),
    upsertResearchTemplate: (pubkey, account) =>
      set((s) => ({ researchTemplates: upsertMap(s.researchTemplates, pubkey, account) })),
    upsertHeroTemplate: (pubkey, account) =>
      set((s) => ({ heroTemplates: upsertMap(s.heroTemplates, pubkey, account) })),
    upsertDaoPromotion: (pubkey, account) =>
      set((s) => ({ daoPromotions: upsertMap(s.daoPromotions, pubkey, account) })),
    upsertAllowedToken: (pubkey, account) =>
      set((s) => ({ allowedTokens: upsertMap(s.allowedTokens, pubkey, account) })),

    // ShopItem: itemId = account.itemType (stored in the account itself)
    upsertShopItem: (pubkey, account, itemId?) =>
      set((s) => {
        const key = pubkey.toBase58();
        const next = new Map(s.shopItems);
        const existing = s.shopItems.get(key);
        const id = itemId ?? existing?.itemId ?? account.itemType;
        next.set(key, { pubkey, account, itemId: id });
        return { shopItems: next };
      }),

    // Bundle: bundleId is PDA-derived, not in account data
    upsertBundle: (pubkey, account, bundleId?) =>
      set((s) => {
        const key = pubkey.toBase58();
        const next = new Map(s.bundles);
        const existing = s.bundles.get(key);
        const id = bundleId ?? existing?.bundleId ?? -1;
        next.set(key, { pubkey, account, bundleId: id });
        return { bundles: next };
      }),

    // FlashSale: saleId is PDA-derived, not in account data
    upsertFlashSale: (pubkey, account, saleId?) =>
      set((s) => {
        const key = pubkey.toBase58();
        const next = new Map(s.flashSales);
        const existing = s.flashSales.get(key);
        const id = saleId ?? existing?.saleId ?? -1;
        next.set(key, { pubkey, account, saleId: id });
        return { flashSales: next };
      }),

    // DailyDeal: slot is PDA-derived, not in account data
    upsertDailyDeal: (pubkey, account, slot?) =>
      set((s) => {
        const key = pubkey.toBase58();
        const next = new Map(s.dailyDeals);
        const existing = s.dailyDeals.get(key);
        const id = slot ?? existing?.slot ?? -1;
        next.set(key, { pubkey, account, slot: id });
        return { dailyDeals: next };
      }),

    // Bulk replace after refetch (to pick up IDs for new entries)
    replaceAllBundles: (entries) =>
      set(() => {
        const next = new Map<string, BundleEntry>();
        for (const e of entries) next.set(e.pubkey.toBase58(), e);
        return { bundles: next };
      }),

    replaceAllFlashSales: (entries) =>
      set(() => {
        const next = new Map<string, FlashSaleEntry>();
        for (const e of entries) next.set(e.pubkey.toBase58(), e);
        return { flashSales: next };
      }),

    replaceAllDailyDeals: (entries) =>
      set(() => {
        const next = new Map<string, DailyDealEntry>();
        for (const e of entries) next.set(e.pubkey.toBase58(), e);
        return { dailyDeals: next };
      }),

    replaceAllPlayerPurchases: (entries) =>
      set(() => {
        const next = new Map<string, PlayerPurchaseEntry>();
        for (const e of entries) next.set(e.pubkey.toBase58(), e);
        return { playerPurchases: next };
      }),

    setSubscriptionActive: (active) => set({ subscriptionActive: active }),
    reset: () =>
      set({
        ...initialState,
        cities: new Map(),
        encounters: new Map(),
        loot: new Map(),
        otherPlayers: new Map(),
        incomingRallies: new Map(),
        teamMembers: new Map(),
        teamInvites: new Map(),
        treasuryRequests: new Map(),
        rallyParticipants: new Map(),
        events: new Map(),
        eventParticipations: new Map(),
        dungeonTemplates: new Map(),
        dungeonLeaderboards: new Map(),
        garrisonContributions: new Map(),
        kingRegistries: new Map(),
        courtPositions: new Map(),
        teamCastleRewards: new Map(),
        shopItems: new Map(),
        bundles: new Map(),
        flashSales: new Map(),
        dailyDeals: new Map(),
        playerPurchases: new Map(),
        locations: new Map(),
        researchTemplates: new Map(),
        heroTemplates: new Map(),
        daoPromotions: new Map(),
        allowedTokens: new Map(),
      }),
  })),
);
