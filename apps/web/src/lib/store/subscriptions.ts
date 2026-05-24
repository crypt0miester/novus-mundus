import { PublicKey } from "@solana/web3.js";
import {
  NovusMundusClient,
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
export function startGameSubscriptions(
  client: NovusMundusClient,
  wallet: PublicKey
): () => void {
  const store = useAccountStore.getState;

  // Derive the current user's player PDA for WS routing
  const [myPlayerPda] = derivePlayerPda(client.gameEngine, wallet);
  const myPlayerKey = myPlayerPda.toBase58();
  store().setMyPlayerPda(myPlayerKey);

  // Initialize event store from IndexedDB
  useEventStore.getState().init();

  // ── 1. Initial RPC fetch for core accounts ──────────────────
  store().setLoading(true);

  // Reverse lookup for this wallet's PlayerPurchase PDAs — reused by both the
  // initial fetch and the WS handler so the PDA set is derived only once.
  const playerPurchasePdaToId = derivePlayerPurchaseIndex(wallet);

  Promise.all([
    client.fetchGameEngine(),
    client.fetchPlayer(wallet),
    client.fetchUser(wallet),
    client.fetchAllCities(),
    client.fetchShopConfig(),
    client.fetchAllShopItems(),
    client.fetchAllBundles(),
    client.fetchAllFlashSales(),
    client.fetchAllDailyDeals(),
    client.fetchAllWeeklySales(),
    client.fetchAllSeasonalSales(),
    client.fetchAllDaoPromotions(),
    client.fetchPlayerPurchases(wallet, playerPurchasePdaToId),
    client.fetchAllHeroTemplates(),
  ])
    .then(([ge, player, user, cities, shopConfig, shopItems, bundles, flashSales, dailyDeals, weeklySales, seasonalSales, daoPromotions, playerPurchases, heroTemplates]) => {
      if (ge.account) {
        console.log(ge)
        store().setGameEngine(ge.pubkey, ge.account);}
      if (player.account) store().setPlayer(player.pubkey, player.account);
      if (user.account) store().setUser(user.pubkey, user.account);
      console.log("Fetched initial accounts: cities", cities.length, "shop items", shopItems.length, "bundles", bundles.length, "flash sales", flashSales.length, "hero templates", heroTemplates.length);
      for (const city of cities) {
        store().upsertCity(city.pubkey, city.account);
      }
      if (shopConfig.account) store().setShopConfig(shopConfig.pubkey, shopConfig.account);
      for (const item of shopItems) {
        store().upsertShopItem(item.pubkey, item.account, item.itemId);
      }
      for (const bundle of bundles) {
        store().upsertBundle(bundle.pubkey, bundle.account, bundle.bundleId);
      }
      for (const sale of flashSales) {
        store().upsertFlashSale(sale.pubkey, sale.account, sale.saleId);
      }
      for (const deal of dailyDeals) {
        store().upsertDailyDeal(deal.pubkey, deal.account, deal.slot);
      }
      const nowSec = Math.floor(Date.now() / 1000);
      const activeWeekly = weeklySales.find((w) => isWeeklySaleActive(w.account, nowSec)) ?? weeklySales[0];
      if (activeWeekly) store().setWeeklySale(activeWeekly.pubkey, activeWeekly.account);
      const activeSeasonal = seasonalSales.find((s) => isSeasonalSaleActive(s.account, nowSec)) ?? seasonalSales[0];
      if (activeSeasonal) store().setSeasonalSale(activeSeasonal.pubkey, activeSeasonal.account);
      for (const promo of daoPromotions) {
        store().upsertDaoPromotion(promo.pubkey, promo.account);
      }
      for (const pp of playerPurchases) {
        store().upsertPlayerPurchase(pp.pubkey, pp.account, pp.itemId);
      }
      for (const t of heroTemplates) {
        store().upsertHeroTemplate(t.pubkey, t.account);
      }
    })
    .catch(() => {
      // Silently fail — accounts may not exist yet (new player)
    })
    .finally(() => {
      store().setLoading(false);
    });

  // ── 2. Program-wide WebSocket ───────────────────────────────
  const manager = new GameSubscriptionManager(
    client.connection,
    client.gameEngine,
    { commitment: "confirmed" }
  );

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

  // Rally: only from my team
  manager.on(AccountKey.Rally, (account: RallyAccount, pubkey) => {
    const myTeam = store().team;
    if (myTeam && account.team.toBase58() === myTeam.pubkey.toBase58()) {
      store().setRally(pubkey, account);
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
      client.fetchAllBundles().then((results) => {
        store().replaceAllBundles(
          results.map((r) => ({ pubkey: r.pubkey, account: r.account, bundleId: r.bundleId }))
        );
      }).catch(() => {});
    }
  });

  // FlashSale: if new entry (not in Map), refetch all to get saleId
  manager.on(AccountKey.FlashSale, (account: FlashSaleAccount, pubkey) => {
    const isNew = !store().flashSales.has(pubkey.toBase58());
    store().upsertFlashSale(pubkey, account);
    if (isNew) {
      client.fetchAllFlashSales().then((results) => {
        store().replaceAllFlashSales(
          results.map((r) => ({ pubkey: r.pubkey, account: r.account, saleId: r.saleId }))
        );
      }).catch(() => {});
    }
  });

  // DailyDeal: if new entry (not in Map), refetch all slots to resolve slot index
  manager.on(AccountKey.DailyDeal, (account: DailyDealAccount, pubkey) => {
    const isNew = !store().dailyDeals.has(pubkey.toBase58());
    store().upsertDailyDeal(pubkey, account);
    if (isNew) {
      client.fetchAllDailyDeals().then((results) => {
        store().replaceAllDailyDeals(
          results.map((r) => ({ pubkey: r.pubkey, account: r.account, slot: r.slot }))
        );
      }).catch(() => {});
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

  manager.start();

  // ── 3. Log subscription for events + WebSocket confirmation ──
  const logSub = subscribeToGameLogs(
    client.connection,
    (logsPayload) => {
      // First: try to resolve a pending tx (WebSocket-based confirmation)
      const wasPending = resolvePendingTx(
        logsPayload.signature,
        logsPayload.logs,
        logsPayload.err,
      );

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
        if (ts && typeof ts === "object" && "toNumber" in (ts as object)) {
          timestamp = (ts as { toNumber: () => number }).toNumber();
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
        (e) => e.scopes.includes("team") || e.scopes.includes("city") || e.scopes.includes("personal"),
      );
      if (relevant.length > 0) {
        useEventStore.getState().addEvents(relevant);
      }
    },
    { commitment: "confirmed" },
  );

  store().setSubscriptionActive(true);

  // ── Cleanup ─────────────────────────────────────────────────
  return () => {
    manager.destroy();
    logSub.unsubscribe();
    store().setSubscriptionActive(false);
  };
}
