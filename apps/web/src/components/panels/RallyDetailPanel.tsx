"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PublicKey } from "@solana/web3.js";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import {
  parseRally,
  parseRallyParticipant,
  parseAssetV1,
  parsePlayer,
  parseEncounter,
  parseEstate,
  derivePlayerPda,
  deriveEstatePda,
  createRallyJoinInstruction,
  createRallyExecuteInstruction,
  createRallyCancelInstruction,
  createRallyProcessReturnInstruction,
  createRallyCloseInstruction,
  createRallySpeedupInstruction,
  RallySpeedupType,
  canCloseRally,
  deriveRallyParticipantPda,
  RallyStatus,
  WarTableScope,
  isNullPubkey,
  isTraveling,
} from "novus-mundus-sdk";
import { ThreadRenderer } from "@/components/war-table/ThreadRenderer";
import { usePlayer } from "@/lib/hooks/usePlayer";
import { useGameEngine } from "@/lib/hooks/useGameEngine";
import { useTeam } from "@/lib/hooks/useTeam";
import { useEncounters } from "@/lib/hooks/useEncounters";
import { useLockedHeroes, NO_HERO_SLOT } from "@/lib/hooks/useLockedHeroes";
import { useTransact } from "@/lib/hooks/useTransact";
import { useNovusMundusClient } from "@/lib/solana/provider";
import { useRightPanelStore } from "@/lib/store/right-panel";
import { GoldCountdown } from "@/components/shared/GoldCountdown";
import { GoldNumber } from "@/components/shared/GoldNumber";
import { SpeedupPanel } from "@/components/shared/SpeedupPanel";
import { TxButton } from "@/components/shared/TxButton";
import type { TxPhase } from "@/components/shared/TxButton";
import { DomainName } from "@/components/shared/DomainName";
import {
  TripleCountInput,
  DEFENSIVE_UNIT_LABELS,
  DEFENSIVE_UNIT_ICONS,
  WEAPON_LABELS,
  WEAPON_ICONS,
} from "@/components/shared/TripleCountInput";
import { formatTime, bnToSafeNumber } from "@/lib/utils";
import { useMorphActions } from "@/lib/hooks/useMorphActions";
import { useChainNow } from "@/lib/hooks/useChainTime";
import { useIsMountedRef } from "@/lib/hooks/useIsMountedRef";
import { useCombatForecast, type ForecastTarget } from "@/lib/hooks/useCombatForecast";
import { useRefill } from "@/lib/hooks/useRefill";
import { rallyLeaderBuffs } from "@/lib/combat/forecast";
import { CombatForecastPanel } from "@/components/combat/CombatForecastPanel";

const TARGET_TYPE = ["Player", "Encounter", "Castle"];
const ENCOUNTER_RARITY = ["Common", "Uncommon", "Rare", "Epic", "Legendary", "World Event"];

interface RallyDetailPanelProps {
  rallyPubkey: string;
  // Optional dismiss override. Defaults to the global RightPanel closer so
  // the combat/team tab usage is unchanged; the in-map floating-panel host
  // passes its own closer (() => setDetail(null)) so success dismisses the
  // in-panel detail instead of a sidebar that isn't open.
  onClose?: () => void;
}

/**
 * Detail + join view for a joinable team rally — opened from the Rally tab's
 * "Joinable Team Rallies" list into the RightPanel. Shows the gather window,
 * the march/combat timeline, the target encounter, and a self-contained join
 * (troop commitment + hero).
 */
export function RallyDetailPanel({ rallyPubkey, onClose }: RallyDetailPanelProps) {
  const { publicKey } = useWallet();
  const { connection } = useConnection();
  const client = useNovusMundusClient();
  const transact = useTransact();
  const { data: playerData } = usePlayer();
  const player = playerData?.account;
  const { data: geData } = useGameEngine();
  const ge = geData?.account;
  const storeClose = useRightPanelStore((s) => s.close);
  const close = onClose ?? storeClose;
  const isMounted = useIsMountedRef();

  const rallyKey = useMemo(() => new PublicKey(rallyPubkey), [rallyPubkey]);

  const { data: rally, isLoading } = useQuery({
    queryKey: ["rally", "detail", rallyPubkey],
    queryFn: async () => {
      const info = await connection.getAccountInfo(rallyKey);
      return info ? parseRally(info) : null;
    },
    staleTime: 10_000,
  });

  const teamPubkey = player?.team && !isNullPubkey(player.team) ? player.team : null;
  const { data: teamData } = useTeam(teamPubkey);
  const teamId = teamData?.account?.id;

  const lockedHeroes = useLockedHeroes();
  const [heroSlot, setHeroSlot] = useState(NO_HERO_SLOT);
  const [units, setUnits] = useState<[number, number, number]>([0, 0, 0]);
  const [weapons, setWeapons] = useState<[number, number, number]>([0, 0, 0]);
  const [nextOpen, setNextOpen] = useState(false);

  const ownedUnits: [number, number, number] = [
    bnToSafeNumber(player?.defensiveUnit1),
    bnToSafeNumber(player?.defensiveUnit2),
    bnToSafeNumber(player?.defensiveUnit3),
  ];
  const ownedWeapons: [number, number, number] = [
    bnToSafeNumber(player?.meleeWeapons),
    bnToSafeNumber(player?.rangedWeapons),
    bnToSafeNumber(player?.siegeWeapons),
  ];

  // The target encounter, when this rally hunts one — matched out of the
  // rally's target city.
  const encounterCity = rally && rally.targetType === 1 ? rally.targetCity : null;
  const { data: encounters } = useEncounters(encounterCity);
  const targetEncounter = useMemo(() => {
    if (!rally || rally.targetType !== 1) return null;
    return (encounters ?? []).find((e) => e.pubkey.equals(rally.target)) ?? null;
  }, [encounters, rally]);

  // War-table post access: the viewer may post only if their RallyParticipant
  // account exists. The participant PDA is keyed on the WALLET, not the player
  // PDA (rally.rs gate), so derive it from publicKey and probe for existence.
  const { data: myParticipant = null } = useQuery({
    queryKey: ["rally", "participant", rallyPubkey, publicKey?.toBase58() ?? ""],
    enabled: !!publicKey && !!rally,
    queryFn: async () => {
      if (!publicKey || !rally) return null;
      const [participantPda] = await deriveRallyParticipantPda(
        client.gameEngine,
        rally.creator,
        rally.id,
        publicKey,
      );
      const info = await connection.getAccountInfo(participantPda);
      return info ? parseRallyParticipant(info) : null;
    },
    staleTime: 10_000,
  });
  const isParticipant = !!myParticipant;

  // A committed hero rides home on process_return, which must pass the hero NFT
  // accounts to restore it. Resolve the mint's template id from its asset
  // metadata (same source as useLockedHeroes). Without this, process_return
  // reaches the hero-restore step and fails with NotEnoughAccountKeys.
  const committedHero =
    myParticipant && !isNullPubkey(myParticipant.hero) ? myParticipant.hero : null;
  const { data: heroInfo = null } = useQuery({
    queryKey: ["rally", "committed-hero", committedHero?.toBase58() ?? ""],
    enabled: !!committedHero,
    queryFn: async () => {
      if (!committedHero) return null;
      const info = await connection.getAccountInfo(committedHero);
      const asset = info?.data ? parseAssetV1(info.data) : null;
      if (!asset) return null;
      return { mint: committedHero, templateId: parseInt(asset.attributes.Template ?? "0", 10) };
    },
    staleTime: 60_000,
  });
  // All three hero slots full means process_return transfers the hero to the
  // wallet instead of a slot (needs hero_collection + system_program).
  const heroNeedsTransfer =
    !!player && (player.activeHeroes as PublicKey[]).filter((h) => !isNullPubkey(h)).length >= 3;

  // The post-time gate account the chain's rally_predicate requires: the
  // caller's RallyParticipant PDA (keyed on the wallet). Passed to the war-table
  // embed so a participant's message clears the membership check on-chain.
  const [participantGate, setParticipantGate] = useState<PublicKey[] | undefined>(undefined);
  useEffect(() => {
    if (!publicKey || !rally) {
      setParticipantGate(undefined);
      return;
    }
    let cancelled = false;
    deriveRallyParticipantPda(client.gameEngine, rally.creator, rally.id, publicKey).then(
      ([pda]) => {
        if (!cancelled) setParticipantGate([pda]);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [publicKey, rally, client.gameEngine]);

  // Combat forecast for the WHOLE rally (everyone joined so far + your join),
  // resolved with the LEADER's buffs as the chain does. The target defender and
  // the leader's Citadel bonus are fetched here so a joiner sees the real odds.
  const { data: forecastTarget } = useQuery({
    queryKey: ["rally", "forecast-target", rallyPubkey, rally?.targetType ?? -1],
    enabled: !!rally,
    queryFn: async (): Promise<ForecastTarget> => {
      if (!rally) return { kind: "none" };
      const info = await connection.getAccountInfo(rally.target);
      if (!info) return { kind: "none" };
      switch (rally.targetType) {
        case 0: {
          const p = parsePlayer(info);
          return p ? { kind: "player", player: p } : { kind: "none" };
        }
        case 1: {
          const e = parseEncounter(info);
          return e
            ? { kind: "encounter", defenseBps: e.defense, health: bnToSafeNumber(e.health) }
            : { kind: "none" };
        }
        default:
          // Castle: garrison strength isn't aggregated client-side — coverage-only.
          return { kind: "none" };
      }
    },
    staleTime: 10_000,
  });

  const { data: leaderCitadelBps = 0 } = useQuery({
    queryKey: ["rally", "leader-citadel", rally?.creator?.toBase58() ?? ""],
    enabled: !!rally,
    queryFn: async (): Promise<number> => {
      if (!rally) return 0;
      const [leaderPlayer] = await derivePlayerPda(client.gameEngine, rally.creator);
      const [leaderEstate] = await deriveEstatePda(leaderPlayer);
      const info = await connection.getAccountInfo(leaderEstate);
      const est = info ? parseEstate(info) : null;
      return est?.pvpDamageBps ?? 0;
    },
    staleTime: 30_000,
  });

  const rallyCtx = useMemo(() => {
    if (!rally) return undefined;
    return {
      pooledUnits: bnToSafeNumber(rally.totalUnits),
      pooledMelee: bnToSafeNumber(rally.totalMeleeWeapons),
      pooledRanged: bnToSafeNumber(rally.totalRangedWeapons),
      pooledSiege: bnToSafeNumber(rally.totalSiegeWeapons),
      leaderBuffs: rallyLeaderBuffs(rally),
      leaderCitadelBps,
    };
  }, [rally, leaderCitadelBps]);

  const forecast = useCombatForecast({
    combat: "rally",
    units,
    weapons,
    target: forecastTarget ?? { kind: "none" },
    rally: rallyCtx,
  });
  const refill = useRefill(forecast.acquire?.troops ?? 0, forecast.acquire?.weapons ?? 0);

  // "Bring up the host": commit up to the rally's remaining need from your own
  // stock, tankiest tiers first (siege, cavalry, infantry) to minimise losses.
  const recForce = forecast.recommended;
  const fill = useMemo(() => {
    if (!recForce || !rally) return null;
    const pooled = bnToSafeNumber(rally.totalUnits);
    const remaining = Math.max(0, recForce.totalUnits - pooled);
    const u: [number, number, number] = [0, 0, 0];
    let need = remaining;
    for (const tier of [2, 1, 0] as const) {
      const take = Math.min(ownedUnits[tier], Math.max(0, need));
      u[tier] = take;
      need -= take;
    }
    const committed = u[0] + u[1] + u[2];
    let wneed = Math.min(committed, ownedWeapons[0] + ownedWeapons[1] + ownedWeapons[2]);
    const w: [number, number, number] = [0, 0, 0];
    for (let i = 0; i < 3 && wneed > 0; i++) {
      const take = Math.min(ownedWeapons[i], wneed);
      w[i] = take;
      wneed -= take;
    }
    const changes =
      u[0] !== units[0] ||
      u[1] !== units[1] ||
      u[2] !== units[2] ||
      w[0] !== weapons[0] ||
      w[1] !== weapons[1] ||
      w[2] !== weapons[2];
    return { u, w, changes };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    recForce,
    rally,
    JSON.stringify(ownedUnits),
    JSON.stringify(ownedWeapons),
    JSON.stringify(units),
    JSON.stringify(weapons),
  ]);

  const handleJoin = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    if (!rally) throw new Error("Rally not loaded");
    if (!teamId) throw new Error("Team not loaded");
    const joinHero = heroSlot < 3 ? lockedHeroes[heroSlot] : null;
    const ix = await createRallyJoinInstruction(
      {
        owner: publicKey,
        gameEngine: client.gameEngine,
        rally: rallyKey,
        rallyCreator: rally.creator,
        rallyId: rally.id,
        teamId,
        rallyCityId: rally.rallyCity ?? 0,
      },
      {
        defensiveUnit1: units[0],
        defensiveUnit2: units[1],
        defensiveUnit3: units[2],
        meleeWeapons: weapons[0],
        rangedWeapons: weapons[1],
        siegeWeapons: weapons[2],
        heroSlotIndex: joinHero ? heroSlot : NO_HERO_SLOT,
        heroMint: joinHero?.mint,
        heroTemplateId: joinHero?.templateId,
      },
    );
    return transact
      .mutateAsync({
        instructions: [ix],
        invalidateKeys: [["player"], ["rally"]],
        successMessage: "Joined rally!",
        onPhase: reportPhase,
      })
      .then((r) => {
        if (isMounted.current) close();
        return r.signature;
      });
  };

  // March = execute the rally — sends the gathered force at the target.
  // rally_execute expects 4 fixed accounts + one RallyParticipant account per
  // participant, so we fetch the participant PDAs and pass them (leader first).
  const handleMarch = async (reportPhase: (p: TxPhase) => void) => {
    if (!rally) throw new Error("Rally not loaded");
    const ge = client.gameEngine;
    const [leaderPlayer] = await derivePlayerPda(ge, rally.creator);
    const [leaderEstate] = await deriveEstatePda(leaderPlayer);
    const parts = await client.fetchRallyParticipants(rallyKey, rally);
    const ordered = [...parts].sort(
      (a, b) => Number(b.account.isLeader) - Number(a.account.isLeader),
    );
    const ix = await createRallyExecuteInstruction({
      gameEngine: ge,
      rally: rallyKey,
      target: rally.target,
      leaderEstate,
      rallyParticipants: ordered.map((p) => p.pubkey),
    });
    return transact
      .mutateAsync({
        instructions: [ix],
        invalidateKeys: [["player"], ["rally"]],
        successMessage: "Rally is marching!",
        onPhase: reportPhase,
      })
      .then((r) => {
        if (isMounted.current) close();
        return r.signature;
      });
  };

  const handleCancel = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    if (!rally) throw new Error("Rally not loaded");
    const ix = await createRallyCancelInstruction({
      owner: publicKey,
      gameEngine: client.gameEngine,
      rally: rallyKey,
      rallyId: rally.id,
      rallyCityId: rally.rallyCity ?? 0,
    });
    return transact
      .mutateAsync({
        instructions: [ix],
        invalidateKeys: [["player"], ["rally"]],
        successMessage: "Rally cancelled.",
        onPhase: reportPhase,
      })
      .then((r) => r.signature); // panel stays open — re-renders into the cancelled state
  };

  // Settle an ended rally. Processes the viewer's return and — when that
  // return (or a prior one) leaves every participant home — bundles the
  // permissionless close into the *same* transaction, so a rally that only
  // needs the viewer resolves in a single click. close_rally runs after
  // process_return within the tx, so the returned_count it checks is current.
  const handleResolve = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    if (!rally) throw new Error("Rally not loaded");

    const returnedCount = rally.returnedCount ?? 0;
    const participantCount = rally.participantCount ?? 0;
    // Once this return lands, is every participant accounted for?
    const willClose = closeable || returnedCount + 1 >= participantCount;

    const instructions = [];
    if (!closeable) {
      // A committed hero must be resolved before we can build the return (it
      // needs the hero NFT accounts); fail clearly instead of hitting the
      // chain's NotEnoughAccountKeys at the hero-restore step.
      if (committedHero && !heroInfo) {
        throw new Error("Loading your committed hero, try again in a moment.");
      }
      instructions.push(
        await createRallyProcessReturnInstruction({
          gameEngine: client.gameEngine,
          rally: rallyKey,
          rallyCreator: rally.creator,
          rallyId: rally.id,
          participantOwner: publicKey,
          rallyCityId: rally.rallyCity ?? 0,
          homeCityId: player?.currentCity ?? 0,
          ...(heroInfo
            ? { heroMint: heroInfo.mint, heroTemplateId: heroInfo.templateId, heroNeedsTransfer }
            : {}),
        }),
      );
    }
    if (willClose) {
      instructions.push(
        await createRallyCloseInstruction({
          rally: rallyKey,
          leaderOwner: rally.creator,
        }),
      );
    }

    return transact
      .mutateAsync({
        instructions,
        invalidateKeys: [["player"], ["rally"]],
        successMessage: closeable
          ? "Rally closed."
          : willClose
            ? "Return processed and rally closed."
            : "Return processed.",
        onPhase: reportPhase,
      })
      .then((r) => {
        if (willClose && isMounted.current) close();
        return r.signature;
      });
  };

  // Speed up a rally leg with gems. Three legs (all permissionless per chain):
  // Gather = your travel to the rally point, March = the army's march to target,
  // Return = your journey home. We always speed up the VIEWER's own participant.
  const makeSpeedup =
    (speedupType: RallySpeedupType, label: string) =>
    async (tier: number, reportPhase: (p: TxPhase) => void) => {
      if (!publicKey || !rally) throw new Error("Not ready");
      const ix = await createRallySpeedupInstruction(
        {
          owner: publicKey,
          gameEngine: client.gameEngine,
          rally: rallyKey,
          rallyCreator: rally.creator,
          rallyId: rally.id,
          participant: publicKey,
        },
        { speedupType, speedupTier: tier as 1 | 2 },
      );
      return transact
        .mutateAsync({
          instructions: [ix],
          invalidateKeys: [["player"], ["rally"]],
          successMessage: `${label} sped up!`,
          onPhase: reportPhase,
        })
        .then((r) => r.signature);
    };
  const handleGatherSpeedup = makeSpeedup(RallySpeedupType.Gather, "Arrival");
  const handleMarchSpeedup = makeSpeedup(RallySpeedupType.March, "March");
  const handleReturnSpeedup = makeSpeedup(RallySpeedupType.Return, "Return");

  // Derive lifecycle + morph-bar actions ABOVE any early return.
  // React's hook order must be stable across renders; useMorphActions used
  // to live after `if (isLoading) return …`, which would crash when the
  // query resolved (hook count delta between "loading" and "loaded"
  // renders). The derivations below tolerate rally === null so we can run
  // them unconditionally.
  // Chain-anchored clock (1s tick). The gather/return gates must match what the
  // program sees via Clock::unix_timestamp — a local validator's clock drifts
  // from wall-clock, so a Date.now() gate read "ready" while the chain still
  // rejected Process Return with ReturnNotComplete (7181).
  const nowSec = useChainNow(1000);
  const gatherAt = Number(rally?.gatherAt ?? 0n);
  const createdAt = Number(rally?.createdAt ?? 0n);
  const gatherDone = gatherAt > 0 && nowSec >= gatherAt;
  const marchDuration = rally?.marchDuration ?? 0;
  const traveling = player ? isTraveling(player) : false;
  const full = (rally?.participantCount ?? 0) >= (rally?.maxParticipants ?? 0);
  const noCommit = units.every((n) => n === 0) && weapons.every((n) => n === 0);
  const isCreator = !!rally && !!publicKey && rally.creator.equals(publicKey);
  const minParticipants = rally?.minParticipants || 2;
  const joinedCount = rally?.participantCount ?? 0;
  const enoughForMarch = joinedCount >= minParticipants;

  const status = rally?.status ?? RallyStatus.Gathering;
  const isGathering = !!rally && status === RallyStatus.Gathering;
  const isReturning = status === RallyStatus.Returning;
  const isCompleted = status === RallyStatus.Completed;
  const isCancelled = status === RallyStatus.Cancelled;
  const inFlight = status === RallyStatus.Marching || status === RallyStatus.Combat;

  // Your arrival at the rally point. The rally gathers at the city CENTER, not
  // where you stand — even the leader walks to it. Marching before you arrive is
  // what orphans troops, so the leader can't march until they've arrived; while
  // en route, a Gather speedup gets you there sooner.
  const myArrivesAt = Number(myParticipant?.arrivesAtRally ?? 0n);
  const myArrived =
    !!myParticipant && (myParticipant.arrivedAtRally || (myArrivesAt > 0 && nowSec >= myArrivesAt));
  const myArrivalRemaining = Math.max(0, myArrivesAt - nowSec);
  const canMarch = isGathering && gatherDone && enoughForMarch && !traveling && myArrived;
  // The army's march-to-target timer, for the March speedup while in flight.
  const arriveAt = Number(rally?.arriveAt ?? 0n);
  const marchRemaining = Math.max(0, arriveAt - nowSec);
  const closeable = rally ? canCloseRally(rally) : false;

  // Viewer's own return journey. The chain rejects Process Return with
  // ReturnNotComplete (7181) until return_started_at + return_duration elapses,
  // so gate the action on the timer (and offer a gem speedup to skip the wait)
  // rather than letting the raw error surface.
  const myReturnStartedAt = Number(myParticipant?.returnStartedAt ?? 0n);
  const myReturnCompletesAt =
    myReturnStartedAt > 0 ? myReturnStartedAt + (myParticipant?.returnDuration ?? 0) : 0;
  const myReturnRemaining = Math.max(0, myReturnCompletesAt - nowSec);
  const myReturnInFlight = myReturnStartedAt > 0 && nowSec < myReturnCompletesAt;
  const alreadyReturned = myParticipant?.returned ?? false;

  const morphActions = (() => {
    if (!rally) return null;
    if (isGathering && isCreator) {
      return [
        {
          id: "march-rally",
          label: !enoughForMarch
            ? "Missing participants"
            : !gatherDone
              ? "March"
              : !myArrived
                ? "Reaching rally point…"
                : "March Rally",
          variant: "primary" as const,
          disabled: !canMarch,
          onClick: handleMarch,
        },
        {
          id: "cancel-rally",
          label: "Cancel Rally",
          variant: "danger" as const,
          onClick: handleCancel,
        },
      ];
    }
    if (isReturning || isCompleted || isCancelled) {
      // Permissionless close once everyone is home — no return needed.
      if (closeable) {
        return [
          {
            id: "close-rally",
            label: "Close Rally",
            variant: "primary" as const,
            onClick: handleResolve,
          },
        ];
      }
      // Viewer already processed their own return, or isn't a participant —
      // nothing to do here but wait for the rest of the rally.
      if (!myParticipant || alreadyReturned) return null;
      // Process Return is the two-step: the FIRST call starts the return
      // journey (return_started_at == 0 -> now), then a later call collects once
      // it lands. So only DISABLE while a return is actively in flight; allow the
      // click when it hasn't started yet (to start it) or has completed (to
      // collect). The body shows the countdown + gem speedup while in flight.
      return [
        {
          id: "process-return",
          label: myReturnInFlight
            ? "Returning home…"
            : (rally.returnedCount ?? 0) + 1 >= joinedCount
              ? "Return & Close"
              : "Process Return",
          variant: "primary" as const,
          disabled: myReturnInFlight,
          onClick: handleResolve,
        },
      ];
    }
    return null;
  })();
  useMorphActions(morphActions);

  if (isLoading) {
    return <p className="text-sm text-text-muted">Loading rally…</p>;
  }
  if (!rally) {
    return <p className="text-sm text-text-muted">This rally is no longer available.</p>;
  }

  // Post-gathering status line, shown in place of the gather window.
  const statusBanner = isCancelled
    ? { text: "This rally was cancelled.", tone: "text-red-400" }
    : isCompleted
      ? { text: "The rally is complete.", tone: "text-green-400" }
      : isReturning
        ? { text: "The rally is returning home.", tone: "text-text-secondary" }
        : status === RallyStatus.Combat
          ? { text: "The rally is in combat.", tone: "text-text-gold" }
          : { text: "The rally is marching to its target.", tone: "text-text-gold" };

  // Combat result — read off the rally + your participant once it has resolved.
  // Chain state, so it persists even if someone else executed the rally.
  const resolved = !!myParticipant && (isReturning || isCompleted);
  const marched = !!myParticipant?.includedInMarch;
  const rallyWon = rally.attackerWon;
  const myCommitted = myParticipant
    ? bnToSafeNumber(myParticipant.unitsCommitted1) +
      bnToSafeNumber(myParticipant.unitsCommitted2) +
      bnToSafeNumber(myParticipant.unitsCommitted3)
    : 0;
  const myLost = myParticipant
    ? bnToSafeNumber(myParticipant.casualties1) +
      bnToSafeNumber(myParticipant.casualties2) +
      bnToSafeNumber(myParticipant.casualties3)
    : 0;
  const mySurvived = Math.max(0, myCommitted - myLost);
  const myLootCash = myParticipant ? bnToSafeNumber(myParticipant.lootCash) : 0;
  const myLootNovi = myParticipant ? bnToSafeNumber(myParticipant.lootLockedNovi) : 0;
  const myLootGems = myParticipant ? bnToSafeNumber(myParticipant.lootGems) : 0;

  return (
    <div className="space-y-4">
      {/* Leader + target type */}
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs text-text-muted">Led by</div>
          <div className="font-mono text-sm text-text-primary">
            <DomainName pubkey={rally.creator} chars={4} />
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs text-text-muted">Target</div>
          <div className="text-sm text-text-primary">{TARGET_TYPE[rally.targetType ?? 0]}</div>
        </div>
      </div>

      {/* Status — the gather window while gathering, a status line after */}
      <div className="rounded-lg border border-zinc-800 bg-surface/60 p-3">
        {isGathering ? (
          gatherDone ? (
            <div className="text-sm font-semibold text-green-400">Gathering complete</div>
          ) : (
            <GoldCountdown
              endsAt={gatherAt}
              startedAt={createdAt}
              label="Gather window"
              showProgress
              format="compact"
            />
          )
        ) : (
          <div className={`text-sm font-semibold ${statusBanner.tone}`}>{statusBanner.text}</div>
        )}
      </div>

      {/* Your arrival at the rally point — it gathers at the city CENTER, so even
          the leader marches to it. En route, Gather-speed to arrive before the
          march or you get left behind. */}
      {myParticipant && (isGathering || inFlight) && !myArrived && (
        <div className="space-y-3 rounded-lg border border-zinc-800 bg-surface/60 p-3">
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="text-text-gold">Marching to the rally point...</span>
            <GoldCountdown endsAt={myArrivesAt} format="compact" size="sm" />
          </div>
          {isGathering && (
            <SpeedupPanel
              visible={myArrivalRemaining > 0}
              remainingSeconds={myArrivalRemaining}
              onSpeedup={(tier, rp) => handleGatherSpeedup(tier, rp)}
              gemsPerMinute={ge?.gameplayConfig.gemCostPerMinuteSpeedup ?? 1}
              gemBalance={Number(player?.gems ?? 0n)}
            />
          )}
        </div>
      )}
      {myParticipant && isGathering && myArrived && (
        <div className="rounded-lg border border-zinc-800 bg-surface/60 p-3 text-xs font-semibold text-green-400">
          You're at the rally point.
        </div>
      )}

      {/* Combat result — win/lose + your own losses and loot, shown once the
          rally has fought. Answers "did we win, did I lose troops". */}
      {resolved && (
        <div
          className={`rounded-lg border p-3 ${
            rallyWon ? "border-green-700/50 bg-green-950/15" : "border-red-800/50 bg-red-950/15"
          }`}
        >
          <div className="mb-2 flex items-center justify-between">
            <span className={`text-sm font-bold ${rallyWon ? "text-green-400" : "text-red-400"}`}>
              {rallyWon ? "Victory" : "Defeat"}
            </span>
            <span className="text-[10px] uppercase tracking-wider text-text-muted">Your forces</span>
          </div>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-text-muted">Committed</div>
              <div className="text-sm font-semibold tabular-nums text-text-primary">
                {myCommitted.toLocaleString()}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-text-muted">Lost</div>
              <div className="text-sm font-semibold tabular-nums text-red-400">
                {myLost.toLocaleString()}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-text-muted">Survived</div>
              <div className="text-sm font-semibold tabular-nums text-green-400">
                {mySurvived.toLocaleString()}
              </div>
            </div>
          </div>
          {rallyWon && (myLootCash > 0 || myLootNovi > 0 || myLootGems > 0) && (
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-muted">
              <span className="text-[10px] uppercase tracking-wider">Loot</span>
              {myLootCash > 0 && <span>{myLootCash.toLocaleString()} cash</span>}
              {myLootNovi > 0 && <span>{myLootNovi.toLocaleString()} NOVI</span>}
              {myLootGems > 0 && <span>{myLootGems.toLocaleString()} gems</span>}
            </div>
          )}
          {!marched && (
            <p className="mt-2 text-[11px] text-text-muted">
              Your troops didn't make the march in time.
            </p>
          )}
          {marched && mySurvived > 0 && !alreadyReturned && (
            <p className="mt-2 text-[11px] text-text-muted">
              Surviving troops are marching home — process the return to collect them
              {rallyWon ? " and your loot." : "."}
            </p>
          )}
        </div>
      )}

      {/* What happens next — only meaningful while gathering */}
      {isGathering && (
        <div className="rounded-lg border border-zinc-800 bg-surface/60 text-xs">
          <button
            type="button"
            onClick={() => setNextOpen((v) => !v)}
            className="flex w-full items-center justify-between p-3 text-left font-semibold uppercase tracking-wider text-text-muted"
          >
            <span>What happens next</span>
            <span aria-hidden>{nextOpen ? "▾" : "▸"}</span>
          </button>
          {nextOpen && (
            <div className="px-3 pb-3">
              <ol className="space-y-1.5">
                <li className={gatherDone ? "text-zinc-600 line-through" : "text-text-secondary"}>
                  1. Gather {">"} members commit troops
                  {gatherDone ? "" : " (in progress)"}
                </li>
                <li className="text-text-secondary">
                  2. March {">"} the leader sends the rally at the target
                  {marchDuration > 0 ? ` (~${formatTime(marchDuration, "compact")})` : ""}
                </li>
                <li className="text-text-secondary">
                  3. Combat {">"} the rally attacks once it arrives
                </li>
              </ol>
            </div>
          )}
        </div>
      )}

      {/* Target encounter — while the target still matters */}
      {rally.targetType === 1 && !isCancelled && !isCompleted && (
        <div className="rounded-lg border border-zinc-800 bg-surface/60 p-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
            Encounter
          </div>
          {targetEncounter ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-text-primary">
                  #{targetEncounter.account.id.toString()} ·{" "}
                  {ENCOUNTER_RARITY[targetEncounter.account.rarity] ?? "—"}
                </span>
                <span className="text-text-muted">Lv {targetEncounter.account.level}</span>
              </div>
              {(() => {
                const hp = Number(targetEncounter.account.health ?? 0n);
                const maxHp = Number(targetEncounter.account.maxHealth ?? 0n);
                const pct = maxHp > 0 ? Math.round((hp / maxHp) * 100) : 0;
                return (
                  <div>
                    <div className="mb-1 flex justify-between text-[10px] text-text-muted">
                      <span>Health</span>
                      <span>
                        {hp.toLocaleString()} / {maxHp.toLocaleString()}
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800">
                      <div
                        className="h-full rounded-full bg-red-500"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })()}
              <div className="flex justify-between text-xs text-text-muted">
                <span>Defense {targetEncounter.account.defense}</span>
                <span>{targetEncounter.account.attackerCount} attacking</span>
              </div>
            </div>
          ) : (
            <p className="text-xs text-text-muted">
              Encounter details unavailable.
            </p>
          )}
        </div>
      )}

      {/* Force gathered so far */}
      <div className="grid grid-cols-3 gap-3 rounded-lg border border-zinc-800 bg-surface/60 p-3">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-text-muted">Joined</div>
          <div className="text-sm font-semibold text-text-primary">
            {rally.participantCount ?? 0}/{rally.maxParticipants ?? 0}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-text-muted">Units</div>
          <GoldNumber value={Number(rally.totalUnits ?? 0n)} size="sm" />
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-text-muted">Power</div>
          <GoldNumber value={Number(rally.totalPower ?? 0n)} size="sm" />
        </div>
      </div>

      {/* Gathering — the leader marches or cancels */}
      {isGathering && isCreator && (
        <div className="space-y-3">
          {traveling && (
            <p className="text-xs text-danger">
              You are traveling. rally actions may be restricted.
            </p>
          )}

          {gatherDone && !myArrived && (
            <p className="text-xs text-danger">
              You haven't reached the rally point yet — wait until you arrive (or Gather-speed
              above), or your committed troops get left behind.
            </p>
          )}

          <TxButton onClick={handleMarch} disabled={!canMarch} className="hidden lg:block">
            {!enoughForMarch
              ? "Missing participants"
              : !gatherDone
                ? "March"
                : !myArrived
                  ? "Reaching rally point…"
                  : "March Rally"}
          </TxButton>
          <TxButton onClick={handleCancel} variant="danger" className="hidden lg:block">
            Cancel Rally
          </TxButton>
        </div>
      )}

      {/* In flight — speed the army to its target, else wait for the return. */}
      {inFlight && (
        <div className="space-y-3">
          <div className="rounded-lg border border-border-gold/40 bg-accent/10 p-3 text-xs text-text-muted">
            The rally is underway. Return and close unlock once it comes home.
          </div>
          {status === RallyStatus.Marching && marchRemaining > 0 && (
            <div className="space-y-3 rounded-lg border border-zinc-800 bg-surface/60 p-3">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="text-text-gold">Marching to target...</span>
                <GoldCountdown endsAt={arriveAt} format="compact" size="sm" />
              </div>
              <SpeedupPanel
                visible={marchRemaining > 0}
                remainingSeconds={marchRemaining}
                onSpeedup={(tier, rp) => handleMarchSpeedup(tier, rp)}
                gemsPerMinute={ge?.gameplayConfig.gemCostPerMinuteSpeedup ?? 1}
                gemBalance={Number(player?.gems ?? 0n)}
              />
            </div>
          )}
        </div>
      )}

      {/* Ended or returning — recover committed troops, then close */}
      {(isReturning || isCompleted || isCancelled) && (
        <div className="space-y-3">
          {isCancelled && (
            <div className="rounded-lg border border-red-900/40 bg-red-950/10 p-3 text-xs text-text-muted">
              The rally was called off. Recover the troops and weapons you committed — once everyone
              is home the rally closes in the same step.
            </div>
          )}

          {/* Your troops are still marching home — Process Return is gated until
              the return lands. Wait out the countdown, or spend gems to speed it
              up (the chain rejects an early Process Return with code 7181). */}
          {!closeable && myReturnInFlight && (
            <div className="space-y-3 rounded-lg border border-zinc-800 bg-surface/60 p-3">
              <GoldCountdown
                endsAt={myReturnCompletesAt}
                startedAt={myReturnStartedAt}
                label="Returning home"
                showProgress
                format="compact"
              />
              <SpeedupPanel
                visible={myReturnRemaining > 0}
                remainingSeconds={myReturnRemaining}
                onSpeedup={(tier, rp) => handleReturnSpeedup(tier, rp)}
                gemsPerMinute={ge?.gameplayConfig.gemCostPerMinuteSpeedup ?? 1}
                gemBalance={Number(player?.gems ?? 0n)}
              />
            </div>
          )}

          {(closeable || (!!myParticipant && !alreadyReturned)) && (
            <TxButton
              onClick={handleResolve}
              disabled={!closeable && myReturnInFlight}
              className="hidden lg:block"
            >
              {closeable
                ? "Close Rally"
                : myReturnInFlight
                  ? "Returning home…"
                  : (rally.returnedCount ?? 0) + 1 >= joinedCount
                    ? "Process Return & Close"
                    : "Process Return"}
            </TxButton>
          )}

          {!closeable && !!myParticipant && alreadyReturned && (
            <p className="text-xs text-text-muted">
              You're home. Waiting for the rest of the rally to return.
            </p>
          )}
        </div>
      )}

      {/* Gathering — a teammate commits troops and joins */}
      {isGathering && !isCreator && (
        <>
          <div className="space-y-2">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
              Your defensive units
            </div>
            <TripleCountInput
              labels={DEFENSIVE_UNIT_LABELS}
              icons={DEFENSIVE_UNIT_ICONS}
              available={ownedUnits}
              value={units}
              onChange={setUnits}
            />
            <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
              Your weapons
            </div>
            <TripleCountInput
              labels={WEAPON_LABELS}
              icons={WEAPON_ICONS}
              available={ownedWeapons}
              value={weapons}
              onChange={setWeapons}
            />
            <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
              Hero
            </div>
            <select
              value={heroSlot}
              onChange={(e) => setHeroSlot(Number(e.target.value))}
              className="w-full rounded border border-zinc-800 bg-surface px-2 py-1.5 text-sm text-text-primary"
            >
              <option value={NO_HERO_SLOT}>No hero</option>
              {lockedHeroes.map((h, i) =>
                h ? (
                  <option key={i} value={i}>
                    Slot {i}: {h.name}
                  </option>
                ) : null,
              )}
            </select>
          </div>

          {/* Whole-rally forecast (pool + your join), resolved with leader buffs. */}
          <CombatForecastPanel
            result={forecast}
            combat="rally"
            rally={{ pooled: bnToSafeNumber(rally.totalUnits) }}
            onFillFromInventory={
              fill?.changes
                ? () => {
                    setUnits(fill.u);
                    setWeapons(fill.w);
                  }
                : undefined
            }
            fillAvailable={!!fill?.changes}
            refill={{
              plan: refill.plan,
              run: refill.run,
              running: refill.running,
              isLegendary: forecast.isLegendary,
            }}
          />

          {traveling && (
            <p className="text-xs text-danger">You are traveling — joining may be restricted.</p>
          )}

          <TxButton onClick={handleJoin} disabled={traveling || full || noCommit || !teamId}>
            {full ? "Rally is full" : noCommit ? "Commit troops to join" : "Join Rally"}
          </TxButton>
        </>
      )}

      {/* War-table: coordinate the rally while it gathers or marches */}
      {rally && (rally.status === RallyStatus.Gathering || inFlight) && (
        <div className="rounded-lg border border-zinc-800 bg-surface/60 p-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
            War-table
          </div>
          <ThreadRenderer
            threadPda={rallyKey}
            scope={WarTableScope.Rally}
            gateAccounts={participantGate}
            canPost={isParticipant}
            placeholder="coordinate..."
          />
        </div>
      )}
    </div>
  );
}
