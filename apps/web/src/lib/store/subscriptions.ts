import type { PublicKey } from "@solana/web3.js";
import {
  type NovusMundusClient,
  GameSubscriptionManager,
  AccountKey,
  derivePlayerPda,
  derivePlayerPurchaseIndex,
  subscribeToGameLogs,
  parseEventsFromLogs,
  isWeeklySaleActive,
  isSeasonalSaleActive,
  type PlayerCore,
  type UserAccount,
  type GameEngine,
  type CityAccount,
  type EncounterAccount,
  type TeamAccount,
  type TeamMemberSlot,
  type TeamInviteAccount,
  type TreasuryRequest,
  type ExpeditionAccount,
  type LootAccount,
  type ArenaSeasonAccount,
  type ArenaParticipantAccount,
  type ArenaLoadoutAccount,
  type CastleAccount,
  type KingRegistryAccount,
  type CourtPositionAccount,
  type GarrisonContributionAccount,
  type TeamCastleRewardAccount,
  type RallyAccount,
  type RallyParticipant,
  type ReinforcementAccount,
  type EventAccount,
  type EventParticipation,
  type DungeonRunAccount,
  type DungeonTemplateAccount,
  type DungeonLeaderboardAccount,
  type ShopConfigAccount,
  type ShopItemAccount,
  type BundleAccount,
  type FlashSaleAccount,
  type DailyDealAccount,
  type EstateAccount,
  type LocationAccount,
  type ResearchTemplateAccount,
  type ResearchProgressAccount,
  type HeroTemplateAccount,
  type WeeklySaleAccount,
  type SeasonalSaleAccount,
  type DAOPromotionAccount,
  type AllowedTokenAccount,
  type PlayerPurchaseAccount,
} from "novus-mundus-sdk";

import { useAccountStore } from "./accounts";
import { useEventStore, serializeEventData, type EventEntry } from "./events";
import { classifyEvent } from "@/lib/events/classify";
import { resolvePendingTx } from "@/lib/hooks/useTransact";

/** RallyTargetType.Player — a rally aimed at a defender. */
const RALLY_TARGET_PLAYER = 0;
/** RallyTargetType.Castle — a rally aimed at a held castle. */
const RALLY_TARGET_CASTLE = 2;
/** RallyStatus.Combat — statuses 0/1/2 are still live; 3+ (Returning/Completed/Cancelled) are over. */
const RALLY_LIVE_MAX_STATUS = 2;

// Subscription Bridge

/**
 * Start game subscriptions:
 * 1. Initial RPC fetch to seeds zustand store
 * 2. Single program-wide WebSocket to keeps zustand current
 * 3. Log subscription to routes events to event store + resolves pending txs
 *
 * Zustand is the sole source of truth for account data.
 * Hooks read from zustand. No React Query involved.
 *
 * @returns Cleanup function to stop subscriptions
 */
export function startGameSubscriptions(client: NovusMundusClient, wallet: PublicKey): () => void {
  const store = useAccountStore.getState;

  // v3 PDA derivation is async, so the wallet-derived routing values (the player
  // PDA key and the PlayerPurchase reverse-lookup) are resolved in an async init
  // below. They are mutable closure state read by the WS handlers; both are seeded
  // before the WebSocket starts, so handlers never observe the pre-derivation gap.
  let myPlayerKey = "";
  const playerPurchasePdaToId = new Map<string, number>();

  // Teardown is collected as init progresses so the synchronously-returned cleanup
  // can tear down whatever has been created, even if init is still in flight.
  let cancelled = false;
  let manager: GameSubscriptionManager | null = null;
  let logSub: { unsubscribe: () => void } | null = null;

  void init();

  async function init(): Promise<void> {
    // Derive the current user's player PDA for WS routing
    const [myPlayerPda] = await derivePlayerPda(client.gameEngine, wallet);
    if (cancelled) return;
    myPlayerKey = myPlayerPda.toBase58();
    store().setMyPlayerPda(myPlayerKey);

    // Initialize event store from IndexedDB
    useEventStore.getState().init();

    // ── 1. Initial RPC fetch for core accounts ──────────────────
    store().setLoading(true);

    // Reverse lookup for this wallet's PlayerPurchase PDAs — reused by both the
    // initial fetch and the WS handler so the PDA set is derived only once.
    const purchaseIndex = await derivePlayerPurchaseIndex(wallet);
    if (cancelled) return;
    for (const [k, v] of purchaseIndex) playerPurchasePdaToId.set(k, v);

  /*
   * Each fetch is independent — one failing (RPC blip, account not yet created)
   * must not blank out the others. Promise.allSettled gives us per-fetch status;
   * rejections are logged so they're not silently swallowed.
   */
  const tasks = [
    ["gameEngine", client.fetchGameEngine()],
    ["player", client.fetchPlayer(wallet)],
    ["user", client.fetchUser(wallet)],
    ["cities", client.fetchAllCities()],
    ["shopConfig", client.fetchShopConfig()],
    ["shopItems", client.fetchAllShopItems()],
    ["bundles", client.fetchAllBundles()],
    ["flashSales", client.fetchAllFlashSales()],
    ["dailyDeals", client.fetchAllDailyDeals()],
    ["weeklySales", client.fetchAllWeeklySales()],
    ["seasonalSales", client.fetchAllSeasonalSales()],
    ["daoPromotions", client.fetchAllDaoPromotions()],
    ["playerPurchases", client.fetchPlayerPurchases(wallet, playerPurchasePdaToId)],
    ["heroTemplates", client.fetchAllHeroTemplates()],
    /*
     * Seed the full player population once at boot so the otherPlayers map is
     * warm by the time the user drills into any city. After this, the program-
     * wide WS keeps every player account live — no per-city or 30-second
     * refetches anywhere downstream.
     */
    ["allPlayers", client.fetchAllPlayers()],
  ] as const;

  Promise.allSettled(tasks.map(([, p]) => p)).then((results) => {
    const ok = <T>(i: number): T | null => {
      const r = results[i];
      if (r.status === "fulfilled") return r.value as T;
      console.warn(`[boot] fetch ${tasks[i][0]} failed:`, r.reason);
      return null;
    };

    const ge = ok<Awaited<ReturnType<typeof client.fetchGameEngine>>>(0);
    const player = ok<Awaited<ReturnType<typeof client.fetchPlayer>>>(1);
    const user = ok<Awaited<ReturnType<typeof client.fetchUser>>>(2);
    const cities = ok<Awaited<ReturnType<typeof client.fetchAllCities>>>(3) ?? [];
    const shopConfig = ok<Awaited<ReturnType<typeof client.fetchShopConfig>>>(4);
    const shopItems = ok<Awaited<ReturnType<typeof client.fetchAllShopItems>>>(5) ?? [];
    const bundles = ok<Awaited<ReturnType<typeof client.fetchAllBundles>>>(6) ?? [];
    const flashSales = ok<Awaited<ReturnType<typeof client.fetchAllFlashSales>>>(7) ?? [];
    const dailyDeals = ok<Awaited<ReturnType<typeof client.fetchAllDailyDeals>>>(8) ?? [];
    const weeklySales = ok<Awaited<ReturnType<typeof client.fetchAllWeeklySales>>>(9) ?? [];
    const seasonalSales = ok<Awaited<ReturnType<typeof client.fetchAllSeasonalSales>>>(10) ?? [];
    const daoPromotions = ok<Awaited<ReturnType<typeof client.fetchAllDaoPromotions>>>(11) ?? [];
    const playerPurchases = ok<Awaited<ReturnType<typeof client.fetchPlayerPurchases>>>(12) ?? [];
    const heroTemplates = ok<Awaited<ReturnType<typeof client.fetchAllHeroTemplates>>>(13) ?? [];
    const allPlayers = ok<Awaited<ReturnType<typeof client.fetchAllPlayers>>>(14) ?? [];

    if (ge?.account) store().setGameEngine(ge.pubkey, ge.account);
    if (player?.account) store().setPlayer(player.pubkey, player.account);
    if (user?.account) store().setUser(user.pubkey, user.account);
    for (const city of cities) store().upsertCity(city.pubkey, city.account);
    if (shopConfig?.account) store().setShopConfig(shopConfig.pubkey, shopConfig.account);
    for (const item of shopItems) store().upsertShopItem(item.pubkey, item.account, item.itemId);
    for (const bundle of bundles)
      store().upsertBundle(bundle.pubkey, bundle.account, bundle.bundleId);
    for (const sale of flashSales) store().upsertFlashSale(sale.pubkey, sale.account, sale.saleId);
    for (const deal of dailyDeals) store().upsertDailyDeal(deal.pubkey, deal.account, deal.slot);
    const nowSec = Math.floor(Date.now() / 1000);
    const activeWeekly =
      weeklySales.find((w) => isWeeklySaleActive(w.account, nowSec)) ?? weeklySales[0];
    if (activeWeekly) store().setWeeklySale(activeWeekly.pubkey, activeWeekly.account);
    const activeSeasonal =
      seasonalSales.find((s) => isSeasonalSaleActive(s.account, nowSec)) ?? seasonalSales[0];
    if (activeSeasonal) store().setSeasonalSale(activeSeasonal.pubkey, activeSeasonal.account);
    for (const promo of daoPromotions) store().upsertDaoPromotion(promo.pubkey, promo.account);
    for (const pp of playerPurchases)
      store().upsertPlayerPurchase(pp.pubkey, pp.account, pp.itemId);
    for (const t of heroTemplates) store().upsertHeroTemplate(t.pubkey, t.account);
    /* Skip self — that one's already owned by setPlayer above. */
    for (const p of allPlayers) {
      if (p.pubkey.toBase58() === myPlayerKey) continue;
      store().upsertOtherPlayer(p.pubkey, p.account);
    }

    store().setLoading(false);
  });

  // ── 2. Program-wide WebSocket ───────────────────────────────
  manager = new GameSubscriptionManager(client.connection, client.gameEngine, {
    commitment: "confirmed",
  });

  const geKey = client.gameEngine.toBase58();

  // ── Core accounts ──────────────────────────────────────────

  // Player — route to `player` (self) or `otherPlayers` (everyone else)
  manager.on(AccountKey.Player, (account: PlayerCore, pubkey) => {
    if (pubkey.toBase58() === myPlayerKey) {
      store().setPlayer(pubkey, account);
    } else {
      store().upsertOtherPlayer(pubkey, account);
    }
  });

  manager.on(AccountKey.User, (account: UserAccount, pubkey) => {
    store().setUser(pubkey, account);
  });
  manager.on(AccountKey.GameEngine, (account: GameEngine, pubkey) => {
    store().setGameEngine(pubkey, account);
  });
  manager.on(AccountKey.City, (account: CityAccount, pubkey) => {
    store().upsertCity(pubkey, account);
  });
  manager.on(AccountKey.Encounter, (account: EncounterAccount, pubkey) => {
    store().upsertEncounter(pubkey, account);
  });

  // ── Team accounts ──────────────────────────────────────────

  manager.on(AccountKey.Team, (account: TeamAccount, pubkey) => {
    store().setTeam(pubkey, account);
  });
  manager.on(AccountKey.TeamMemberSlot, (account: TeamMemberSlot, pubkey) => {
    store().upsertTeamMember(pubkey, account);
  });
  // TeamInvite: only invites addressed to me
  manager.on(AccountKey.TeamInvite, (account: TeamInviteAccount, pubkey) => {
    if (account.invitee.toBase58() === myPlayerKey) {
      store().upsertTeamInvite(pubkey, account);
    }
  });
  // TreasuryRequest: only from my team
  manager.on(AccountKey.TreasuryRequest, (account: TreasuryRequest, pubkey) => {
    const myTeam = store().team;
    if (myTeam && account.team.toBase58() === myTeam.pubkey.toBase58()) {
      store().upsertTreasuryRequest(pubkey, account);
    }
  });

  // ── Expedition / Loot ──────────────────────────────────────

  // Expedition: only the current player's
  manager.on(AccountKey.Expedition, (account: ExpeditionAccount, pubkey) => {
    if (account.player.toBase58() === myPlayerKey) {
      store().setExpedition(pubkey, account);
    }
  });
  // Loot: only the current player's
  manager.on(AccountKey.Loot, (account: LootAccount, pubkey) => {
    if (account.owner.toBase58() === myPlayerKey) {
      store().upsertLoot(pubkey, account);
    }
  });

  // ── Arena ──────────────────────────────────────────────────

  // ArenaSeason: only from our game engine (kingdom)
  manager.on(AccountKey.ArenaSeason, (account: ArenaSeasonAccount, pubkey) => {
    if (account.authority.toBase58() === geKey) {
      store().setArenaSeason(pubkey, account);
    }
  });
  // ArenaParticipant: only the current player's
  manager.on(AccountKey.ArenaParticipant, (account: ArenaParticipantAccount, pubkey) => {
    if (account.player.toBase58() === myPlayerKey) {
      store().setArenaParticipant(pubkey, account);
    }
  });
  // ArenaLoadout: only the current player's
  manager.on(AccountKey.ArenaLoadout, (account: ArenaLoadoutAccount, pubkey) => {
    if (account.player.toBase58() === myPlayerKey) {
      store().setArenaLoadout(pubkey, account);
    }
  });

  // ── Castle ─────────────────────────────────────────────────

  manager.on(AccountKey.Castle, (account: CastleAccount, pubkey) => {
    store().setCastle(pubkey, account);
  });
  // KingRegistry: unfiltered (global — who's king of what castle)
  manager.on(AccountKey.KingRegistry, (account: KingRegistryAccount, pubkey) => {
    store().upsertKingRegistry(pubkey, account);
  });
  // CourtPosition: only positions held by me
  manager.on(AccountKey.CourtPosition, (account: CourtPositionAccount, pubkey) => {
    if (account.holder.toBase58() === myPlayerKey) {
      store().upsertCourtPosition(pubkey, account);
    }
  });
  // GarrisonContribution: only my contributions
  manager.on(AccountKey.CastleGarrison, (account: GarrisonContributionAccount, pubkey) => {
    if (account.contributor.toBase58() === myPlayerKey) {
      store().upsertGarrisonContribution(pubkey, account);
    }
  });
  // TeamCastleReward: only my rewards
  manager.on(AccountKey.TeamCastleReward, (account: TeamCastleRewardAccount, pubkey) => {
    if (account.member.toBase58() === myPlayerKey) {
      store().upsertTeamCastleReward(pubkey, account);
    }
  });

  // ── Rally ──────────────────────────────────────────────────

  // Rally: my team's into `rally`; any war-band aimed at me into `incomingRallies`.
  manager.on(AccountKey.Rally, (account: RallyAccount, pubkey) => {
    const myTeam = store().team;
    if (myTeam && account.team.toBase58() === myTeam.pubkey.toBase58()) {
      store().setRally(pubkey, account);
    }
    // The program-wide WS already delivers every team's rally; keep the ones
    // aimed at you (your defender) or at the castle you hold, and drop them again
    // once they resolve. A rally pointed at you or your seat is hostile by
    // definition, so no team check is needed here.
    const target = account.target.toBase58();
    const aimedAtMe =
      (account.targetType === RALLY_TARGET_PLAYER && target === myPlayerKey) ||
      (account.targetType === RALLY_TARGET_CASTLE && target === store().myCastlePda);
    if (aimedAtMe) {
      if (account.status <= RALLY_LIVE_MAX_STATUS) {
        store().upsertIncomingRally(pubkey, account);
      } else {
        store().removeIncomingRally(pubkey.toBase58());
      }
    }
  });
  // RallyParticipant: only my participations
  manager.on(AccountKey.RallyParticipant, (account: RallyParticipant, pubkey) => {
    if (account.participant.toBase58() === myPlayerKey) {
      store().upsertRallyParticipant(pubkey, account);
    }
  });

  // ── Reinforcement ──────────────────────────────────────────

  // Reinforcement: only involving me (sender or destination)
  manager.on(AccountKey.Reinforcement, (account: ReinforcementAccount, pubkey) => {
    const senderKey = account.sender.toBase58();
    const destKey = account.destination.toBase58();
    if (senderKey === myPlayerKey || destKey === myPlayerKey) {
      store().setReinforcement(pubkey, account);
    }
  });

  // ── Events (game events, not log events) ───────────────────

  // Event: only from our kingdom
  manager.on(AccountKey.Event, (account: EventAccount, pubkey) => {
    if (account.gameEngine.toBase58() === geKey) {
      store().upsertEvent(pubkey, account);
    }
  });
  // EventParticipation: only the current player's
  manager.on(AccountKey.EventParticipation, (account: EventParticipation, pubkey) => {
    if (account.player.toBase58() === myPlayerKey) {
      store().upsertEventParticipation(pubkey, account);
    }
  });

  // ── Dungeon ────────────────────────────────────────────────

  // DungeonRun: only the current player's
  manager.on(AccountKey.DungeonRun, (account: DungeonRunAccount, pubkey) => {
    if (account.player.toBase58() === myPlayerKey) {
      store().setDungeonRun(pubkey, account);
    }
  });
  // DungeonTemplate: unfiltered (static config, useful for all players)
  manager.on(AccountKey.DungeonTemplate, (account: DungeonTemplateAccount, pubkey) => {
    store().upsertDungeonTemplate(pubkey, account);
  });
  // DungeonLeaderboard: unfiltered (global leaderboard)
  manager.on(AccountKey.DungeonLeaderboard, (account: DungeonLeaderboardAccount, pubkey) => {
    store().upsertDungeonLeaderboard(pubkey, account);
  });

  // ── Shop ───────────────────────────────────────────────────

  manager.on(AccountKey.ShopConfig, (account: ShopConfigAccount, pubkey) => {
    store().setShopConfig(pubkey, account);
  });

  // ShopItem: itemId derivable from account.itemType
  manager.on(AccountKey.ShopItem, (account: ShopItemAccount, pubkey) => {
    store().upsertShopItem(pubkey, account);
  });

  // Bundle: if new entry (not in Map), refetch all to get bundleId
  manager.on(AccountKey.ShopBundle, (account: BundleAccount, pubkey) => {
    const isNew = !store().bundles.has(pubkey.toBase58());
    store().upsertBundle(pubkey, account);
    if (isNew) {
      client
        .fetchAllBundles()
        .then((results) => {
          store().replaceAllBundles(
            results.map((r) => ({ pubkey: r.pubkey, account: r.account, bundleId: r.bundleId })),
          );
        })
        .catch(() => {});
    }
  });

  // FlashSale: if new entry (not in Map), refetch all to get saleId
  manager.on(AccountKey.FlashSale, (account: FlashSaleAccount, pubkey) => {
    const isNew = !store().flashSales.has(pubkey.toBase58());
    store().upsertFlashSale(pubkey, account);
    if (isNew) {
      client
        .fetchAllFlashSales()
        .then((results) => {
          store().replaceAllFlashSales(
            results.map((r) => ({ pubkey: r.pubkey, account: r.account, saleId: r.saleId })),
          );
        })
        .catch(() => {});
    }
  });

  // DailyDeal: if new entry (not in Map), refetch all slots to resolve slot index
  manager.on(AccountKey.DailyDeal, (account: DailyDealAccount, pubkey) => {
    const isNew = !store().dailyDeals.has(pubkey.toBase58());
    store().upsertDailyDeal(pubkey, account);
    if (isNew) {
      client
        .fetchAllDailyDeals()
        .then((results) => {
          store().replaceAllDailyDeals(
            results.map((r) => ({ pubkey: r.pubkey, account: r.account, slot: r.slot })),
          );
        })
        .catch(() => {});
    }
  });
  // WeeklySale: unfiltered (global shop)
  manager.on(AccountKey.WeeklySale, (account: WeeklySaleAccount, pubkey) => {
    store().setWeeklySale(pubkey, account);
  });
  // SeasonalSale: unfiltered (global shop)
  manager.on(AccountKey.SeasonalSale, (account: SeasonalSaleAccount, pubkey) => {
    store().setSeasonalSale(pubkey, account);
  });
  // DAOPromotion: unfiltered (global shop promotions)
  manager.on(AccountKey.DaoPromotion, (account: DAOPromotionAccount, pubkey) => {
    store().upsertDaoPromotion(pubkey, account);
  });
  // AllowedToken: unfiltered (static config)
  manager.on(AccountKey.AllowedToken, (account: AllowedTokenAccount, pubkey) => {
    store().upsertAllowedToken(pubkey, account);
  });
  // PlayerPurchase: resolve itemId from the precomputed map; ignore other players'.
  manager.on(AccountKey.PlayerPurchase, (account: PlayerPurchaseAccount, pubkey) => {
    const itemId = playerPurchasePdaToId.get(pubkey.toBase58());
    if (itemId === undefined) return;
    store().upsertPlayerPurchase(pubkey, account, itemId);
  });

  // ── Estate / Location / Research / Hero ──────────────────────

  // Estate: only the current player's
  manager.on(AccountKey.Estate, (account: EstateAccount, pubkey) => {
    if (account.owner.toBase58() === wallet.toString()) {
      store().setEstate(pubkey, account);
    }
  });
  // Location: unfiltered (world map data)
  manager.on(AccountKey.Location, (account: LocationAccount, pubkey) => {
    store().upsertLocation(pubkey, account);
  });
  // ResearchTemplate: unfiltered (static config)
  manager.on(AccountKey.ResearchTemplate, (account: ResearchTemplateAccount, pubkey) => {
    store().upsertResearchTemplate(pubkey, account);
  });
  // ResearchProgress: only the current player's
  manager.on(AccountKey.ResearchProgress, (account: ResearchProgressAccount, pubkey) => {
    if (account.player.toBase58() === myPlayerKey) {
      store().setResearchProgress(pubkey, account);
    }
  });
  // HeroTemplate: unfiltered (static config)
  manager.on(AccountKey.HeroTemplate, (account: HeroTemplateAccount, pubkey) => {
    store().upsertHeroTemplate(pubkey, account);
  });

  // Eviction hook for closed accounts. programSubscribe never reports a close
  // (the closed account leaves program ownership), so this fires only if a
  // per-account close watch is registered for the pubkey. None are wired right
  // now: global maps (locations, encounters, team members) are reconciled by
  // context instead (reconcileCityLocations, per-team fetch). To re-enable
  // real-time eviction for a short-lived account, call manager.watchForClose(
  // pubkey) in its handler above — the SDK manager supports it.
  manager.onClose((pubkey) => {
    store().removeClosedAccount(pubkey.toBase58());
  });

  manager.start();

  // The async init can be cancelled (cleanup called before it finished); if so,
  // tear the manager back down rather than leaving a live subscription behind.
  if (cancelled) {
    manager.destroy();
    manager = null;
    return;
  }

  // ── 3. Log subscription for events + WebSocket confirmation ──
  logSub = subscribeToGameLogs(
    client.connection,
    (logsPayload) => {
      // First: try to resolve a pending tx (WebSocket-based confirmation)
      const wasPending = resolvePendingTx(logsPayload.signature, logsPayload.logs, logsPayload.err);

      // Skip failed txs for event parsing
      if (logsPayload.err) return;

      // Parse events from logs
      const events = parseEventsFromLogs(logsPayload.logs);
      if (events.length === 0) return;

      // If this was our own pending tx, events are already stored by useTransact.
      // Only store events from OTHER players' transactions here.
      if (wasPending) return;

      const currentMyPlayerKey = useAccountStore.getState().myPlayerPda;
      if (!currentMyPlayerKey) return;

      const myTeamPubkey = useAccountStore.getState().team?.pubkey?.toBase58();

      const entries: EventEntry[] = events.map((event, i) => {
        const scopes = classifyEvent(event, currentMyPlayerKey, myTeamPubkey);
        const d = event.data as unknown as Record<string, unknown>;
        const ts = d.timestamp;
        let timestamp: number;
        if (typeof ts === "bigint") {
          timestamp = Number(ts);
        } else if (typeof ts === "number") {
          timestamp = ts;
        } else {
          timestamp = Math.floor(Date.now() / 1000);
        }

        return {
          id: `${logsPayload.signature}:${i}`,
          name: event.name,
          event: serializeEventData(event),
          scopes,
          timestamp,
          txSignature: logsPayload.signature,
          read: false,
        };
      });

      // Only store events that are relevant to us (team or city scope)
      const relevant = entries.filter(
        (e) =>
          e.scopes.includes("team") || e.scopes.includes("city") || e.scopes.includes("personal"),
      );
      if (relevant.length > 0) {
        useEventStore.getState().addEvents(relevant);
      }
    },
      { commitment: "confirmed" },
    );

    if (cancelled) {
      logSub.unsubscribe();
      logSub = null;
      manager.destroy();
      manager = null;
      return;
    }

    store().setSubscriptionActive(true);
  }

  // ── Cleanup ─────────────────────────────────────────────────
  // Returned synchronously; tears down whatever init has wired up so far and
  // flags `cancelled` so an in-flight init unwinds anything it creates after.
  return () => {
    cancelled = true;
    manager?.destroy();
    manager = null;
    logSub?.unsubscribe();
    logSub = null;
    store().setSubscriptionActive(false);
  };
}
