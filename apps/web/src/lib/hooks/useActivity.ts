"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import bs58 from "bs58";

import { usePlayer } from "./usePlayer";
import { useGameEngine } from "./useGameEngine";
import { useTransact } from "./useTransact";
import { useTravelProgress } from "./useDerived";
import { useExpedition } from "./useExpedition";
import { useAllCities } from "./useAllCities";
import { useChainNow } from "./useChainTime";
import { useNovusMundusClient } from "@/lib/solana/provider";
import type { TxPhase } from "@/components/shared/TxButton";

import {
  derivePlayerPda,
  deriveRallyParticipantPda,
  parsePlayer,
  parseCastle,
  parseGarrisonContribution,
  createProcessArrivalInstruction,
  createRecallReinforcementInstruction,
  createRelieveReinforcementInstruction,
  createClaimGarrisonLootInstruction,
  createLeaveGarrisonInstruction,
  isExpeditionMining,
  getExpeditionEndTime,
  isExpeditionComplete,
  AccountKey,
  PROGRAM_ID,
  RallyStatus,
  ReinforcementStatus,
  RallyTargetType,
  TravelType,
  type RallyAccount,
  type ReinforcementAccount,
  type GarrisonContributionAccount,
} from "novus-mundus-sdk";
import {
  buildTravelSpeedupIxs,
  buildIntercityCompleteIx,
  buildIntracityCompleteIx,
} from "@/lib/chain/travel";
import { maxSpeedupCount } from "@/components/shared/SpeedupPanel";

// What kind of in-flight force a row represents.
export type ActivityKind = "rally" | "reinforcement" | "travel" | "expedition" | "garrison";

// A primary one-tap action for the row. `run` mirrors the TxButton handler
// contract used everywhere (reportPhase callback, resolves to a signature),
// so a consumer can wrap it in <TxButton onClick={primaryAction.run}>. For
// pure-navigation rows the consumer wires the push itself via `detail`; the
// hook never embeds router/focus closures, so every `run` here resolves to a
// transaction signature.
export interface ActivityAction {
  label: string;
  run: (reportPhase: (p: TxPhase) => void) => Promise<string | void>;
  // Optional press-and-hold: holding charges a count 1..maxCount and fires
  // `onHold` with it, packing that many instructions into one tx (e.g. repeated
  // speedups). Both must be set for the row's button to enable holding.
  onHold?: (reportPhase: (p: TxPhase) => void, count: number) => Promise<string | void>;
  maxCount?: number;
}

// Where the row's detail lives, so the consumer can deep-link / open a panel
// without the hook importing the right-panel store. `pubkey` is base58.
export interface ActivityDetail {
  kind: "rally-detail" | "reinforcement" | "castle" | "expedition" | "travel";
  pubkey: string;
}

export interface ActivityItem {
  kind: ActivityKind;
  // Stable React key. Rally/reinforcement/garrison use the account PDA base58;
  // travel uses "travel:<player>"; expedition uses the expedition PDA base58.
  id: string;
  // Human row title, e.g. "Rally · Marching", "Reinforcement to City 4".
  title: string;
  // Short status line, e.g. "Arrives in 4m", "Gathering", "At destination".
  statusText: string;
  // Seconds until the active leg's timer fires, or null when there is no
  // running countdown (stationary garrison, settled-but-unclaimed expedition,
  // arrived-not-completed travel). Recompute against a 1s clock in the consumer.
  etaSeconds: number | null;
  // On-chain city id this force is acting on/at, or null when not city-scoped.
  targetCityId: number | null;
  // True when the row belongs on the map (has a world location): rallies,
  // reinforcements, travel, garrisons. Expeditions are non-spatial.
  spatial: boolean;
  // How to open this row's detail; null when the row has no dedicated panel.
  detail: ActivityDetail | null;
  // Optional single quick-action surfaced inline (Process Arrival, Recall,
  // Relieve, Claim, Leave). Omitted when the row is informational or its
  // resolve actions live in a dedicated panel (rally, travel, expedition).
  primaryAction?: ActivityAction;
}

export interface UseActivityResult {
  items: ActivityItem[];
  // Subset literally moving through the world right now — the count a HUD
  // header badge shows. See IN_MOTION_KINDS.
  inMotion: ActivityItem[];
  inMotionCount: number;
  loading: boolean;
}

// Rallies, reinforcements, and travel are the things literally moving through
// the world. Garrisons are stationary and expeditions are an estate activity,
// so neither counts toward the "forces in motion" header badge.
const IN_MOTION_KINDS: readonly ActivityKind[] = ["rally", "reinforcement", "travel"];

const RALLY_STATUS_LABEL = ["Gathering", "Marching", "Combat", "Returning", "Completed", "Cancelled"];
const RALLY_TARGET_LABEL = ["Player", "Encounter", "Castle"];

// Parsed rally enriched with whether it belongs to the local wallet.
interface RallyRow {
  pubkey: PublicKey;
  account: RallyAccount;
}

// In-flight reinforcement; `direction` is web-derived (not on-chain).
interface ReinforcementRow {
  pubkey: PublicKey;
  account: ReinforcementAccount;
  direction: "sent" | "received";
  senderWallet: PublicKey | null;
  destinationWallet: PublicKey | null;
}

// Garrison membership enriched with its castle's city + castle id for display
// and for the leave/claim instruction builders (both key off city + castle id).
interface GarrisonRow {
  pubkey: PublicKey;
  account: GarrisonContributionAccount;
  cityId: number;
  castleId: number;
}

function fmtRemaining(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem > 0 ? `${h}h ${rem}m` : `${h}h`;
}

/**
 * Aggregate every in-flight "force" the local player owns into one typed,
 * UI-agnostic list: active rallies (created + joined, all statuses),
 * reinforcements (sent + received, in-flight), own travel, the active
 * expedition, and castle garrison memberships.
 *
 * The hook returns raw data plus a `detail` descriptor and an optional
 * one-tap `primaryAction`. It never embeds navigation/focus closures — the
 * consumer wires those off `detail`. ETAs are computed against the chain clock
 * (`useChainNow`) because the validator clock drifts from wall-clock; recompute
 * against your own 1s tick in the consumer for a live countdown.
 */
export function useActivity(): UseActivityResult {
  const client = useNovusMundusClient();
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const { data: playerData } = usePlayer();
  const player = playerData?.account;
  const { data: geData } = useGameEngine();
  const transact = useTransact();

  // Chain-anchored 1s clock for ETA math — the on-chain program reads
  // Clock::unix_timestamp, which can drift minutes from this device's wall
  // clock, and rally/reinforcement timers are gated on it.
  const now = useChainNow(1000);

  // Re-fetch the live queries whenever a transaction lands so an action
  // invalidates the list, mirroring the inline tabs (which keyed their
  // useEffect on transact.isPending).
  const txEpoch = transact.isPending ? 1 : 0;

  const teamPubkey = useMemo(() => {
    const t = player?.team;
    if (!t) return null;
    // A null/default-pubkey team means "no team" — treat as none.
    return t.equals(PublicKey.default) ? null : t;
  }, [player?.team]);

  const walletStr = publicKey?.toBase58() ?? null;
  const teamStr = teamPubkey?.toBase58() ?? null;
  const ge = client.gameEngine;

  // Rallies — team rallies across ALL statuses, narrowed to the ones the local
  // player is actually in (created it, or holds its RallyParticipant account).
  const ralliesQuery = useQuery({
    queryKey: ["activity", "rallies", teamStr, walletStr, txEpoch],
    enabled: !!teamPubkey && !!publicKey,
    staleTime: 10_000,
    queryFn: async (): Promise<RallyRow[]> => {
      if (!teamPubkey || !publicKey) return [];
      const results = await client.fetchActiveRallies({ team: teamPubkey });
      // Resolve which rallies are mine. The participant PDA is keyed on the
      // WALLET (rally.rs gate), so probe one per rally I didn't create, batched.
      const mine = new Set<string>();
      const probes: { pda: PublicKey; rally: string }[] = [];
      for (const r of results) {
        if (r.account.creator.equals(publicKey)) {
          mine.add(r.pubkey.toBase58());
        } else {
          const [pda] = deriveRallyParticipantPda(
            ge,
            r.account.creator,
            r.account.id.toNumber(),
            publicKey,
          );
          probes.push({ pda, rally: r.pubkey.toBase58() });
        }
      }
      if (probes.length > 0) {
        const infos = await connection.getMultipleAccountsInfo(probes.map((p) => p.pda));
        infos.forEach((info, i) => {
          if (info) mine.add(probes[i]!.rally);
        });
      }
      return results
        .filter((r) => mine.has(r.pubkey.toBase58()))
        .sort(
          (a, b) =>
            (b.account.createdAt?.toNumber?.() ?? 0) - (a.account.createdAt?.toNumber?.() ?? 0),
        );
    },
  });

  // Reinforcements — sent + received, in-flight only (status !== Completed),
  // with sender/destination player-PDA resolved to owner wallets (recall and
  // relieve need the counterparty wallet).
  const reinforcementsQuery = useQuery({
    queryKey: ["activity", "reinforcements", walletStr, txEpoch],
    enabled: !!publicKey,
    staleTime: 10_000,
    queryFn: async (): Promise<ReinforcementRow[]> => {
      if (!publicKey) return [];
      const [myPlayerPda] = derivePlayerPda(ge, publicKey);
      const [sent, received] = await Promise.all([
        client.fetchReinforcementsSent(myPlayerPda),
        client.fetchReinforcementsReceived(myPlayerPda),
      ]);
      const rows = [
        ...sent.map((r) => ({ ...r, direction: "sent" as const })),
        ...received.map((r) => ({ ...r, direction: "received" as const })),
      ].filter((r) => r.account.status !== ReinforcementStatus.Completed);

      // Resolve sender/destination player PDAs to owner wallets.
      const pdaSet = new Set<string>();
      for (const r of rows) {
        pdaSet.add(r.account.sender.toBase58());
        pdaSet.add(r.account.destination.toBase58());
      }
      const pdaList = Array.from(pdaSet).map((s) => new PublicKey(s));
      const walletMap = new Map<string, PublicKey>();
      if (pdaList.length > 0) {
        const infos = await connection.getMultipleAccountsInfo(pdaList);
        for (let i = 0; i < infos.length; i++) {
          const info = infos[i];
          if (!info) continue;
          const parsed = parsePlayer(info);
          if (parsed) walletMap.set(pdaList[i]!.toBase58(), parsed.owner);
        }
      }
      return rows.map((r) => ({
        pubkey: r.pubkey,
        account: r.account,
        direction: r.direction,
        senderWallet: walletMap.get(r.account.sender.toBase58()) ?? null,
        destinationWallet: walletMap.get(r.account.destination.toBase58()) ?? null,
      }));
    },
  });

  // Garrisons — discovered player-wide via getProgramAccounts on CastleGarrison
  // filtered by `contributor` (the player PDA) at offset 33 (1-byte account_key
  // + 32-byte castle pubkey). There is no SDK client.fetchGarrisons(contributor),
  // so this mirrors useGarrisonRoster but keys on contributor, then resolves
  // each account.castle to its city + castle id via parseCastle.
  const garrisonsQuery = useQuery({
    queryKey: ["activity", "garrisons", walletStr, txEpoch],
    enabled: !!publicKey,
    staleTime: 15_000,
    queryFn: async (): Promise<GarrisonRow[]> => {
      if (!publicKey) return [];
      const [myPlayerPda] = derivePlayerPda(ge, publicKey);
      const keyByte = bs58.encode(Buffer.from([AccountKey.CastleGarrison]));
      const accounts = await connection.getProgramAccounts(PROGRAM_ID, {
        filters: [
          { memcmp: { offset: 0, bytes: keyByte } },
          // contributor sits after account_key (1) + castle pubkey (32).
          { memcmp: { offset: 33, bytes: myPlayerPda.toBase58() } },
        ],
      });
      const parsed: { pubkey: PublicKey; account: GarrisonContributionAccount }[] = [];
      for (const { pubkey, account } of accounts) {
        const g = parseGarrisonContribution(account);
        if (g) parsed.push({ pubkey, account: g });
      }
      if (parsed.length === 0) return [];
      // Resolve each garrison's castle to its city + castle id.
      const castleInfos = await connection.getMultipleAccountsInfo(
        parsed.map((p) => p.account.castle),
      );
      const rows: GarrisonRow[] = [];
      for (let i = 0; i < parsed.length; i++) {
        const info = castleInfos[i];
        if (!info) continue;
        const castle = parseCastle(info);
        if (!castle) continue;
        rows.push({
          pubkey: parsed[i]!.pubkey,
          account: parsed[i]!.account,
          cityId: castle.cityId,
          castleId: castle.castleId,
        });
      }
      return rows;
    },
  });

  // Own travel + expedition come from existing hooks, not new queries.
  const travel = useTravelProgress();
  const expedition = useExpedition();
  // Cities resolve the origin centre for the intercity return-home Arrive leg.
  const { data: cities } = useAllCities();

  const items = useMemo<ActivityItem[]>(() => {
    const out: ActivityItem[] = [];

    // Rallies — resolve actions live in RallyDetailPanel, so no primaryAction.
    for (const r of ralliesQuery.data ?? []) {
      const st = r.account.status ?? RallyStatus.Gathering;
      const gatherAt = r.account.gatherAt?.toNumber?.() ?? 0;
      const arriveAt = r.account.arriveAt?.toNumber?.() ?? 0;
      const cityId = r.account.rallyCity ?? r.account.targetCity ?? null;
      const targetLabel = RALLY_TARGET_LABEL[r.account.targetType ?? RallyTargetType.Player] ?? "Target";

      let eta: number | null = null;
      if (st === RallyStatus.Gathering && gatherAt > 0) eta = gatherAt - now;
      else if ((st === RallyStatus.Marching || st === RallyStatus.Combat) && arriveAt > 0)
        eta = arriveAt - now;
      if (eta != null && eta < 0) eta = 0;

      const statusLabel = RALLY_STATUS_LABEL[st] ?? "Rally";
      let statusText: string;
      if (st === RallyStatus.Gathering) statusText = eta ? `Gathers in ${fmtRemaining(eta)}` : "Gathering";
      else if (st === RallyStatus.Marching || st === RallyStatus.Combat)
        statusText = eta ? `Arrives in ${fmtRemaining(eta)}` : statusLabel;
      else if (st === RallyStatus.Returning) statusText = "Returning";
      else statusText = statusLabel;

      out.push({
        kind: "rally",
        id: r.pubkey.toBase58(),
        title: `rally`,
        statusText,
        etaSeconds: eta,
        targetCityId: cityId,
        spatial: true,
        detail: { kind: "rally-detail", pubkey: r.pubkey.toBase58() },
      });
    }

    // Reinforcements — Process Arrival (permissionless, sent+traveling),
    // Recall (sender, traveling/active), or Relieve (destination, active).
    for (const row of reinforcementsQuery.data ?? []) {
      const status = row.account.status ?? ReinforcementStatus.Traveling;
      const arrivesAt = row.account.arrivesAt?.toNumber?.() ?? 0;
      const returnAt = (row.account.returnStartedAt?.toNumber?.() ?? 0) + (row.account.returnDuration ?? 0);
      const targetCityId =
        row.direction === "sent" ? row.account.destinationCity : row.account.senderCity;

      let eta: number | null = null;
      if (status === ReinforcementStatus.Traveling && arrivesAt > 0) eta = arrivesAt - now;
      else if (status === ReinforcementStatus.Returning && returnAt > 0) eta = returnAt - now;
      if (eta != null && eta < 0) eta = 0;

      let statusText: string;
      if (status === ReinforcementStatus.Traveling)
        statusText = eta ? `Arrives in ${fmtRemaining(eta)}` : "Traveling";
      else if (status === ReinforcementStatus.Active) statusText = "Active (parked)";
      else if (status === ReinforcementStatus.Returning)
        statusText = eta ? `Returns in ${fmtRemaining(eta)}` : "Returning";
      else statusText = "Reinforcement";

      let primaryAction: ActivityAction | undefined;
      if (row.direction === "sent" && status === ReinforcementStatus.Traveling) {
        // Process arrival is permissionless once travel completes.
        primaryAction = {
          label: "Process Arrival",
          run: (reportPhase) =>
            transact
              .mutateAsync({
                instructions: [
                  createProcessArrivalInstruction({
                    reinforcement: row.pubkey,
                    destinationPlayer: row.account.destination,
                  }),
                ],
                invalidateKeys: [["player"]],
                successMessage: "Reinforcement arrival processed!",
                onPhase: reportPhase,
              })
              .then((res) => res.signature),
        };
      } else if (
        row.direction === "sent" &&
        status === ReinforcementStatus.Active &&
        publicKey &&
        row.destinationWallet
      ) {
        const destWallet = row.destinationWallet;
        primaryAction = {
          label: "Recall",
          run: (reportPhase) =>
            transact
              .mutateAsync({
                instructions: [
                  createRecallReinforcementInstruction({
                    sender: publicKey,
                    gameEngine: ge,
                    destinationOwner: destWallet,
                    senderCityId: row.account.senderCity ?? 0,
                    destinationCityId: row.account.destinationCity ?? 0,
                  }),
                ],
                invalidateKeys: [["player"]],
                successMessage: "Reinforcements recalled!",
                onPhase: reportPhase,
              })
              .then((res) => res.signature),
        };
      } else if (
        row.direction === "received" &&
        status === ReinforcementStatus.Active &&
        publicKey &&
        row.senderWallet
      ) {
        const senderWallet = row.senderWallet;
        primaryAction = {
          label: "Relieve",
          run: (reportPhase) =>
            transact
              .mutateAsync({
                instructions: [
                  createRelieveReinforcementInstruction({
                    destinationOwner: publicKey,
                    gameEngine: ge,
                    senderOwner: senderWallet,
                    senderCityId: row.account.senderCity ?? 0,
                    destinationCityId: row.account.destinationCity ?? 0,
                  }),
                ],
                invalidateKeys: [["player"]],
                successMessage: "Reinforcements relieved (sent back)!",
                onPhase: reportPhase,
              })
              .then((res) => res.signature),
        };
      }

      out.push({
        kind: "reinforcement",
        id: row.pubkey.toBase58(),
        title:
          row.direction === "sent"
            ? `reinforcement`
            : `reinforcement`,
        statusText,
        etaSeconds: eta,
        targetCityId,
        spatial: true,
        detail: { kind: "reinforcement", pubkey: row.pubkey.toBase58() },
        ...(primaryAction ? { primaryAction } : {}),
      });
    }

    // Own travel. Rush (tier-2 speedup) and Arrive (complete) are buildable here;
    // Cancel and the cheaper Hasten stay on the map (click the row to focus and
    // see the full controls). Arrive: intracity needs no city account; intercity
    // needs the origin city only on the return-home leg, passed from `cities`.
    if (player && travel.traveling && publicKey) {
      const arrived = now >= travel.endsAt;
      const eta = arrived ? null : travel.endsAt - now;
      const intra = player.travelType === TravelType.Intracity;
      const statusText = arrived
        ? "arrived"
        : eta != null
          ? `arrives in ${fmtRemaining(eta)}`
          : "traveling";

      const travelAction: ActivityAction = arrived
        ? {
            label: "Arrive",
            run: (reportPhase) => {
              const ix = intra
                ? buildIntracityCompleteIx({ owner: publicKey, gameEngine: ge, player }).ix
                : buildIntercityCompleteIx({
                    owner: publicKey,
                    gameEngine: ge,
                    player,
                    homeCity: cities?.find((c) => c.account.cityId === player.currentCity)?.account,
                  }).ix;
              return transact
                .mutateAsync({
                  instructions: [ix],
                  invalidateKeys: [["player"]],
                  successMessage: "Arrived at destination!",
                  onPhase: reportPhase,
                })
                .then((res) => res.signature);
            },
          }
        : {
            label: "Rush",
            run: (reportPhase) =>
              transact
                .mutateAsync({
                  instructions: buildTravelSpeedupIxs({ owner: publicKey, gameEngine: ge, tier: 2 }),
                  invalidateKeys: [["player"]],
                  successMessage: "Travel sped up!",
                  onPhase: reportPhase,
                })
                .then((res) => res.signature),
            // Hold to charge multiple tier-2 speedups into one tx, capped at
            // collapsing the timer ∧ what the player's gems cover.
            onHold: (reportPhase, count) =>
              transact
                .mutateAsync({
                  instructions: buildTravelSpeedupIxs({
                    owner: publicKey,
                    gameEngine: ge,
                    tier: 2,
                    count,
                  }),
                  invalidateKeys: [["player"]],
                  successMessage: count > 1 ? `Travel sped up ×${count}!` : "Travel sped up!",
                  onPhase: reportPhase,
                })
                .then((res) => res.signature),
            maxCount: maxSpeedupCount({
              remainingSeconds: eta ?? 0,
              timeMultiplier: 0.25,
              costMultiplier: 2,
              gemsPerMinute: geData?.account?.gameplayConfig?.gemCostPerMinuteSpeedup ?? 1,
              gemBalance: player.gems?.toNumber?.() ?? 0,
            }),
          };

      out.push({
        kind: "travel",
        id: `travel:${publicKey.toBase58()}`,
        title: intra
          ? `marching`
          : `traveling`,
        statusText,
        etaSeconds: eta,
        targetCityId: player.destinationCity ?? null,
        spatial: true,
        detail: { kind: "travel", pubkey: playerData!.pubkey.toBase58() },
        primaryAction: travelAction,
      });
    }

    // Expedition — non-spatial estate activity. Claim lives in the estate /
    // expedition UI, so the row deep-links there rather than re-building the tx.
    if (expedition.data) {
      const exp = expedition.data.account;
      const endsAt = getExpeditionEndTime(exp);
      const complete = isExpeditionComplete(exp, now);
      const eta = complete ? null : endsAt - now;
      out.push({
        kind: "expedition",
        id: expedition.data.pubkey.toBase58(),
        title: isExpeditionMining(exp) ? "Mining expedition" : "Fishing expedition",
        statusText: complete
          ? "Ready"
          : eta != null
            ? `Completes in ${fmtRemaining(eta)}`
            : "In progress",
        etaSeconds: eta,
        targetCityId: exp.cityId ?? null,
        spatial: false,
        detail: { kind: "expedition", pubkey: expedition.data.pubkey.toBase58() },
      });
    }

    // Garrisons — stationary (etaSeconds null). Claim loot if any is unclaimed,
    // otherwise Leave. Both instruction builders key on city + castle id.
    for (const g of garrisonsQuery.data ?? []) {
      const hasUnclaimedLoot =
        !g.account.lootClaimed &&
        (g.account.lootMelee?.toNumber?.() ?? 0) +
          (g.account.lootRanged?.toNumber?.() ?? 0) +
          (g.account.lootSiege?.toNumber?.() ?? 0) >
          0;

      let primaryAction: ActivityAction | undefined;
      if (publicKey) {
        const owner = publicKey;
        if (hasUnclaimedLoot) {
          primaryAction = {
            label: "Claim",
            run: (reportPhase) =>
              transact
                .mutateAsync({
                  instructions: [
                    createClaimGarrisonLootInstruction({
                      castleId: g.castleId,
                      cityId: g.cityId,
                      gameEngine: ge,
                      owner,
                    }),
                  ],
                  invalidateKeys: [["castle"], ["player"]],
                  successMessage: "Garrison loot claimed!",
                  onPhase: reportPhase,
                })
                .then((res) => res.signature),
          };
        } else {
          primaryAction = {
            label: "Leave",
            run: (reportPhase) =>
              transact
                .mutateAsync({
                  instructions: [
                    createLeaveGarrisonInstruction({
                      castleId: g.castleId,
                      cityId: g.cityId,
                      gameEngine: ge,
                      owner,
                    }),
                  ],
                  invalidateKeys: [["castle"], ["player"]],
                  successMessage: "Left garrison.",
                  onPhase: reportPhase,
                })
                .then((res) => res.signature),
          };
        }
      }

      out.push({
        kind: "garrison",
        id: g.pubkey.toBase58(),
        title: `Garrison · City ${g.cityId}`,
        statusText: hasUnclaimedLoot ? "Loot ready to claim" : "Standing garrison",
        etaSeconds: null,
        targetCityId: g.cityId,
        spatial: true,
        detail: { kind: "castle", pubkey: g.account.castle.toBase58() },
        ...(primaryAction ? { primaryAction } : {}),
      });
    }

    return out;
  }, [
    ralliesQuery.data,
    reinforcementsQuery.data,
    garrisonsQuery.data,
    travel.traveling,
    travel.endsAt,
    expedition.data,
    player,
    playerData,
    publicKey,
    ge,
    cities,
    transact,
    now,
  ]);

  // Only genuinely-moving rows count toward the header badge: a rally in a
  // moving status with a live timer, a traveling/returning reinforcement, or
  // travel that has not yet arrived. Active(parked) reinforcements, arrived
  // travel, stationary garrisons and expeditions never count.
  const inMotion = useMemo(
    () =>
      items.filter(
        (i) =>
          IN_MOTION_KINDS.includes(i.kind) && i.etaSeconds != null && i.etaSeconds > 0,
      ),
    [items],
  );

  const loading =
    ralliesQuery.isLoading ||
    reinforcementsQuery.isLoading ||
    garrisonsQuery.isLoading ||
    expedition.isLoading;

  return {
    items,
    inMotion,
    inMotionCount: inMotion.length,
    loading,
  };
}
