"use client";

import { useState, useMemo, useEffect } from "react";
import { Check, X } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useUrlIntParam, useUrlPatch } from "@/lib/hooks/useUrlParam";
import { usePlayer } from "@/lib/hooks/usePlayer";
import { useCombatForecast } from "@/lib/hooks/useCombatForecast";
import { useRefill } from "@/lib/hooks/useRefill";
import { CombatForecastPanel } from "@/components/combat/CombatForecastPanel";
import { useCastle } from "@/lib/hooks/useCastle";
import { useWorldCastles } from "@/lib/hooks/world/useWorldCastles";
import { useTeamMembers } from "@/lib/hooks/useTeamMembers";
import { useLockedHeroes, NO_HERO_SLOT } from "@/lib/hooks/useLockedHeroes";
import { useTransact } from "@/lib/hooks/useTransact";
import { useCourtRoster, useGarrisonRoster } from "@/lib/hooks/useCastleRosters";
import { useNovusMundusClient } from "@/lib/solana/provider";
import { systemFraming } from "@/lib/narrative";
import { useWallet } from "@solana/wallet-adapter-react";
import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { CastleBanner } from "@/components/castles/CastleBanner";
import { GoldNumber } from "@/components/shared/GoldNumber";
import { GoldCountdown } from "@/components/shared/GoldCountdown";
import { TxButton } from "@/components/shared/TxButton";
import type { TxPhase } from "@/components/shared/TxButton";
import { DomainName } from "@/components/shared/DomainName";
import { GameInfoPanel } from "@/components/shared/GameInfoPanel";
import { InfoGrid } from "@/components/shared/InfoGrid";
import {
  TripleCountInput,
  DEFENSIVE_UNIT_LABELS,
  DEFENSIVE_UNIT_ICONS,
  WEAPON_LABELS,
  WEAPON_ICONS,
} from "@/components/shared/TripleCountInput";
import { useGameEngine } from "@/lib/hooks/useGameEngine";
import { useTransitionStore } from "@/lib/store/transition";
import { bpsToPercent, formatTime, shortenAddress } from "@/lib/utils";
import {
  createClaimVacantCastleInstruction,
  createJoinGarrisonInstruction,
  createLeaveGarrisonInstruction,
  createAppointCourtInstruction,
  createDismissCourtInstruction,
  createResignCourtInstruction,
  createInitiateUpgradeInstruction,
  createCancelUpgradeInstruction,
  createCompleteUpgradeInstruction,
  createRelieveGarrisonInstruction,
  createClaimGarrisonLootInstruction,
  createClaimCastleRewardsInstruction,
  createAttackCastleInstruction,
  parsePlayer,
  parseTeamCastleReward,
  derivePlayerPda,
  deriveGarrisonPda,
  deriveTeamCastleRewardPda,
  deriveCourtPda,
  isNullPubkey,
  WarTableScope,
  deciToNovi,
} from "novus-mundus-sdk";
import { ThreadRenderer } from "@/components/war-table/ThreadRenderer";
import {
  CASTLE_TIER_NAMES,
  CASTLE_STATUS_NAMES,
  CASTLE_STATUS_NARRATION,
} from "@/lib/world/castles";

const COURT_POSITIONS = ["Advisor", "Scholar", "Guardian", "Treasurer", "Marshal"];

const CASTLE_FRAMING = systemFraming("castle");
const UPGRADE_TYPES = [
  { value: 1, label: "Fortification" },
  { value: 2, label: "Treasury" },
  { value: 3, label: "Chambers" },
  { value: 4, label: "Watchtower" },
  { value: 5, label: "Armory" },
];

export function CastleTab() {
  const { data: playerData } = usePlayer();
  const { data: geData } = useGameEngine();
  const player = playerData?.account;

  /* Castle selection is URL-driven so the map's "Open in Castles"
   * deep-link can pre-select a castle and so the URL itself is the
   * source of truth (shareable, back-button friendly). Both `cityId`
   * and `castleId` come from the URL when present; cityId falls
   * through to the player's current city when absent. The previous
   * implementation hard-coded `cityId = player.currentCity` and
   * clamped `castleId < 3`, which meant a deep-link from a castle
   * inspected outside the player's city silently resolved to a
   * castle 0 PDA in the WRONG city. */
  const searchParams = useSearchParams();
  const urlPatch = useUrlPatch();
  const playerCity = player?.currentCity ?? 0;
  /* cityId has a dynamic default (player's current city), so it can't
   * use useUrlIntParam directly — that helper takes a static default
   * baked into the URL's delete-on-default logic. */
  const cityId = useMemo(() => {
    const raw = searchParams.get("cityId");
    if (raw != null) {
      const n = Number(raw);
      if (Number.isInteger(n) && n >= 0) return n;
    }
    return playerCity;
  }, [searchParams, playerCity]);
  const [castleId, setCastleId] = useUrlIntParam("castleId", 0);
  const { data: castleData } = useCastle(cityId, castleId);

  /* The castles that actually exist in this city. `castleId` is a GLOBAL id
   * (not a per-city 0/1/2), and the live deployment seeds one castle per city
   * with an arbitrary id — so the selector must be built from real on-chain
   * castles, not a hardcoded [0,1,2]. */
  const { data: allCastles } = useWorldCastles();
  const cityCastles = useMemo(
    () =>
      (allCastles ?? [])
        .filter((c) => c.account.cityId === cityId)
        .sort((a, b) => a.account.castleId - b.account.castleId),
    [allCastles, cityId],
  );
  /* Land on a real castle: if the URL/default castleId isn't one of this
   * city's castles, snap to the first that is. Skips while the list is still
   * loading so we don't fight a pending fetch. */
  useEffect(() => {
    if (cityCastles.length === 0) return;
    if (cityCastles.some((c) => c.account.castleId === castleId)) return;
    setCastleId(cityCastles[0]!.account.castleId);
  }, [cityCastles, castleId, setCastleId]);
  const client = useNovusMundusClient();
  const { publicKey } = useWallet();
  const { connection } = useConnection();
  const transact = useTransact();

  const castle = castleData?.account;
  const castlePda = castleData?.pubkey ?? null;

  const [appointPosition, setAppointPosition] = useState(0);
  const [appointeeWallet, setAppointeeWallet] = useState("");
  const [resignPosition, setResignPosition] = useState(0);
  const [upgradeType, setUpgradeType] = useState(1);
  const [driveBy, setDriveBy] = useState(false);

  // Garrison contribution the player commits when joining (on-chain order).
  const [garrisonUnits, setGarrisonUnits] = useState<[number, number, number]>([0, 0, 0]);
  const [garrisonWeapons, setGarrisonWeapons] = useState<[number, number, number]>([0, 0, 0]);
  const [garrisonHeroSlot, setGarrisonHeroSlot] = useState(NO_HERO_SLOT);
  const availUnits: [number, number, number] = [
    Number(player?.defensiveUnit1 ?? 0n),
    Number(player?.defensiveUnit2 ?? 0n),
    Number(player?.defensiveUnit3 ?? 0n),
  ];
  const availWeapons: [number, number, number] = [
    Number(player?.meleeWeapons ?? 0n),
    Number(player?.rangedWeapons ?? 0n),
    Number(player?.siegeWeapons ?? 0n),
  ];

  // Castle assault commits the whole army; the garrison lives in separate
  // contribution accounts not loaded here, so this is coverage-only (an arm-up
  // warning when troops outnumber weapons) rather than a win/loss verdict.
  const castleForecast = useCombatForecast({
    combat: "castle",
    units: availUnits,
    weapons: availWeapons,
    target: { kind: "none" },
    driveBy,
  });
  const castleRefill = useRefill(0, castleForecast.coverage.deficit);

  // The player's locked heroes (slots 0-2); one may optionally join the garrison.
  const lockedHeroes = useLockedHeroes();

  // The king's House — the court is drawn from its sworn members.
  const houseKey =
    player?.team && player.team.toBase58() !== "11111111111111111111111111111111"
      ? player.team
      : null;
  const { data: houseMembers } = useTeamMembers(houseKey);

  // House members eligible for court appointment — sworn members resolved to
  // their owner wallets, with the king's own wallet excluded.
  const [courtCandidates, setCourtCandidates] = useState<
    { playerPda: PublicKey; wallet: PublicKey }[]
  >([]);

  // Resolve player-PDA to owner wallet for a batch of player PDAs.
  const resolveWallets = async (playerPdas: PublicKey[]): Promise<Map<string, PublicKey>> => {
    const out = new Map<string, PublicKey>();
    if (playerPdas.length === 0) return out;
    const infos = await connection.getMultipleAccountsInfo(playerPdas);
    for (let i = 0; i < infos.length; i++) {
      const info = infos[i];
      if (!info) continue;
      const parsed = parsePlayer(info);
      if (parsed) out.set(playerPdas[i].toBase58(), parsed.owner);
    }
    return out;
  };

  // Court roster — court positions are enumerable: 5 fixed slots per castle.
  // Each entry carries the holder's player PDA + resolved owner wallet.
  // Garrison roster — fetched via getProgramAccounts filtered on the castle
  // pubkey. Both re-fetch when a transaction settles (transact.isPending).
  const courtRoster = useCourtRoster({
    castlePda,
    refresh: transact.isPending,
    resolveWallets,
  });
  const garrisonRoster = useGarrisonRoster({
    castlePda,
    refresh: transact.isPending,
    resolveWallets,
  });

  // Resolve the king's House members to owner wallets for the court picker.
  // The king cannot appoint themselves, so their own wallet is dropped.
  useEffect(() => {
    if (!houseMembers || houseMembers.length === 0 || !publicKey) {
      setCourtCandidates([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const memberPdas = houseMembers.map((m) => m.account.player);
      const wallets = await resolveWallets(memberPdas);
      if (cancelled) return;
      const candidates: { playerPda: PublicKey; wallet: PublicKey }[] = [];
      for (const pda of memberPdas) {
        const wallet = wallets.get(pda.toBase58());
        if (!wallet || wallet.equals(publicKey)) continue;
        candidates.push({ playerPda: pda, wallet });
      }
      setCourtCandidates(candidates);
    })().catch(() => {
      if (!cancelled) setCourtCandidates([]);
    });
    return () => {
      cancelled = true;
    };
  }, [houseMembers, publicKey?.toBase58(), connection]);

  const isKing = useMemo(() => {
    if (!castle || !publicKey || !castle.hasKing) return false;
    return castle.king.equals(publicKey);
  }, [castle, publicKey]);

  const hasUpgradeInProgress = useMemo(() => {
    if (!castle) return false;
    return castle.upgradeType > 0;
  }, [castle]);

  /* Mirror the on-chain gates so the buttons explain *why* an action is
   * blocked instead of firing a tx that bounces with a raw GameError.
   * Claim eligibility -> claim_vacant_castle.rs (level / networth-millions /
   * troops-thousands). Attackability -> CastleAccount::can_be_attacked. */
  const nowSec = Math.floor(Date.now() / 1000);

  const claimReqs = useMemo(() => {
    if (!castle || !player) return [];
    const networthMillions = Math.floor(Number(player.networth ?? 0n) / 1_000_000);
    const troops =
      Number(player.defensiveUnit1 ?? 0n) +
      Number(player.defensiveUnit2 ?? 0n) +
      Number(player.defensiveUnit3 ?? 0n);
    const troopsThousands = Math.floor(troops / 1_000);
    return [
      {
        label: "Level",
        have: String(player.level ?? 0),
        need: String(castle.minLevel ?? 0),
        ok: (player.level ?? 0) >= (castle.minLevel ?? 0),
      },
      {
        label: "Net worth",
        have: `${networthMillions}M`,
        need: `${castle.minNetworthMillions ?? 0}M`,
        ok: networthMillions >= (castle.minNetworthMillions ?? 0),
      },
      {
        label: "Troops",
        have: `${troopsThousands}k`,
        need: `${castle.minTroopsThousands ?? 0}k`,
        ok: troopsThousands >= (castle.minTroopsThousands ?? 0),
      },
    ];
  }, [castle, player]);

  // Residue from a force-removed king blocks a claim with CastleNotVacant.
  const claimBlockedByResidue =
    !!castle && ((castle.garrisonCount ?? 0) > 0 || (castle.courtCount ?? 0) > 0);
  const canClaim = claimReqs.length > 0 && claimReqs.every((r) => r.ok) && !claimBlockedByResidue;

  const attackInfo = useMemo<{
    attackable: boolean;
    reason: string;
    opensAt: number | null;
  }>(() => {
    if (!castle) return { attackable: false, reason: "No castle here.", opensAt: null };
    const contestEnd = Number(castle.contestEndAt ?? 0n);
    const watchtowerBps = (castle.watchtowerLevel ?? 0) * 1000;
    const protSecs = Math.floor(
      (Number(castle.protectionDuration ?? 0n) * (10_000 + watchtowerBps)) / 10_000,
    );
    const protectionEnd = contestEnd + protSecs;
    switch (castle.status) {
      case 0: // Vacant
        return {
          attackable: false,
          reason: "The seat is empty. There is no garrison to fight; claim it instead.",
          opensAt: null,
        };
      case 1: // Contest
        return nowSec < contestEnd
          ? { attackable: true, reason: "", opensAt: null }
          : {
              attackable: false,
              reason: "The contest has ended and protection is settling over the seat.",
              opensAt: null,
            };
      case 2: // Protected
        return nowSec >= protectionEnd
          ? { attackable: true, reason: "", opensAt: null }
          : {
              attackable: false,
              reason: "The seat is shielded by protection. It cannot be moved against yet.",
              opensAt: protectionEnd,
            };
      case 3: // Vulnerable
        return { attackable: true, reason: "", opensAt: null };
      case 4: // Transitioning
        return nowSec < contestEnd
          ? { attackable: true, reason: "", opensAt: null }
          : {
              attackable: false,
              reason: "The transition window has closed.",
              opensAt: null,
            };
      default:
        return {
          attackable: false,
          reason: "This seat cannot be contested right now.",
          opensAt: null,
        };
    }
  }, [castle, nowSec]);

  // Check team prerequisite
  const teamKey = player?.team;
  const hasTeam = !!teamKey && teamKey.toBase58() !== "11111111111111111111111111111111";

  /* Garrison gates mirror join_garrison.rs / leave_garrison.rs /
   * claim_garrison_loot.rs. You may only garrison a held castle that
   * your own House holds, and only when its tier supports a garrison
   * (Outposts have max_garrison = 0). */
  const tierSupportsGarrison = (castle?.maxGarrison ?? 0) > 0;
  const onCastleTeam = !!castle && !!teamKey && castle.hasKing && castle.team.equals(teamKey);
  const canSeeGarrison = onCastleTeam && tierSupportsGarrison;
  const garrisonFull = !!castle && (castle.garrisonCount ?? 0) >= (castle.maxGarrison ?? 0);
  const myGarrison = useMemo(
    () =>
      publicKey ? (garrisonRoster.find((g) => g.ownerWallet?.equals(publicKey)) ?? null) : null,
    [garrisonRoster, publicKey],
  );
  const inGarrison = !!myGarrison;
  const hasUnclaimedLoot =
    !!myGarrison &&
    !myGarrison.account.lootClaimed &&
    Number(myGarrison.account.lootMelee ?? 0n) +
      Number(myGarrison.account.lootRanged ?? 0n) +
      Number(myGarrison.account.lootSiege ?? 0n) >
      0;
  const noContribution =
    garrisonUnits.every((n) => n === 0) && garrisonWeapons.every((n) => n === 0);

  /* Castle war-table (the War Council) — surfaced only to members who can both
   * READ and POST on the web: the king and garrison members. The web key route
   * serves keys to those two (court access is server-deferred, O6), so showing
   * the embed to anyone else would only render a gate that never resolves. The
   * chain's castle_predicate takes the garrison contribution account as the
   * post gate (empty for the king), derived here from the selected castle. */
  const [myPlayerPda, setMyPlayerPda] = useState<PublicKey | null>(null);
  useEffect(() => {
    if (!publicKey) {
      setMyPlayerPda(null);
      return;
    }
    let cancelled = false;
    derivePlayerPda(client.gameEngine, publicKey).then(([pda]) => {
      if (!cancelled) setMyPlayerPda(pda);
    });
    return () => {
      cancelled = true;
    };
  }, [publicKey, client.gameEngine]);
  const canPostCastle = isKing || inGarrison;
  const [castleGate, setCastleGate] = useState<PublicKey[] | undefined>(undefined);
  useEffect(() => {
    if (!castlePda) {
      setCastleGate(undefined);
      return;
    }
    if (isKing) {
      setCastleGate([]); // king branch: no gate account
      return;
    }
    if (inGarrison && myPlayerPda) {
      let cancelled = false;
      deriveGarrisonPda(castlePda, myPlayerPda).then(([pda]) => {
        if (!cancelled) setCastleGate([pda]);
      });
      return () => {
        cancelled = true;
      };
    }
    setCastleGate(undefined);
  }, [castlePda, isKing, inGarrison, myPlayerPda]);

  /* Daily-rewards eligibility — anyone on the castle's team (king, court, or
   * member) can claim, per claim_castle_rewards.rs role resolution. The button
   * is hidden for everyone else. */
  const eligibleForRewards =
    !!castle && !!teamKey && !isNullPubkey(castle.team) && castle.team.equals(teamKey);

  /* The player's per-castle reward-accrual account. `lastClaimedAt` drives the
   * once-per-day cooldown; a missing account means never claimed (the first
   * claim just seeds accrual). Re-fetches when a tx settles. */
  const SECONDS_PER_DAY = 86400;
  const [rewardLastClaim, setRewardLastClaim] = useState<number | null>(null);
  useEffect(() => {
    if (!castlePda || !myPlayerPda || !eligibleForRewards) {
      setRewardLastClaim(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const [rewardPda] = await deriveTeamCastleRewardPda(castlePda, myPlayerPda);
      const info = await connection.getAccountInfo(rewardPda);
      const acct = info ? parseTeamCastleReward(info) : null;
      if (!cancelled) setRewardLastClaim(acct ? Number(acct.lastClaimedAt) : null);
    })().catch(() => {
      if (!cancelled) setRewardLastClaim(null);
    });
    return () => {
      cancelled = true;
    };
  }, [castlePda, myPlayerPda, eligibleForRewards, connection, transact.isPending]);

  const rewardNowSec = Math.floor(Date.now() / 1000);
  // Whole days accrued since the last claim (or 0 if never claimed). The chain
  // caps a single claim at 7 days, so mirror that in the button label.
  const rewardElapsedDays =
    rewardLastClaim != null ? Math.floor((rewardNowSec - rewardLastClaim) / SECONDS_PER_DAY) : 0;
  const rewardClaimDays = Math.min(7, rewardElapsedDays);
  // Claimable when never-claimed (first claim seeds accrual) OR a full day has
  // passed. Otherwise show the countdown to the next claim window.
  const rewardClaimable = eligibleForRewards && (rewardLastClaim == null || rewardElapsedDays >= 1);
  const rewardNextClaimAt = rewardLastClaim != null ? rewardLastClaim + SECONDS_PER_DAY : 0;

  // Held-since + activation, for the Castle Record card.
  const heldSinceSec = castle ? Number(castle.claimedAt ?? 0n) : 0;
  const heldSinceLabel =
    heldSinceSec > 0 ? new Date(heldSinceSec * 1000).toLocaleDateString() : "—";
  const activatesAtSec = castle ? Number(castle.activatesAt ?? 0n) : 0;
  const activatesInFuture = activatesAtSec > rewardNowSec;
  const activatesLabel =
    activatesAtSec <= 0 ? "—" : new Date(activatesAtSec * 1000).toLocaleDateString();

  const handleClaimRewards = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey || !castle) throw new Error("Wallet not connected");
    // Pass the court-position PDA when claiming as a court member so the
    // program credits the court rate rather than the lower member rate.
    let courtPosition: PublicKey | undefined;
    const courtSeat = courtRoster.find((c) => c.ownerWallet?.equals(publicKey));
    if (courtSeat && castlePda) {
      [courtPosition] = await deriveCourtPda(castlePda, courtSeat.position);
    }
    const ix = await createClaimCastleRewardsInstruction({
      claimant: publicKey,
      gameEngine: client.gameEngine,
      cityId: castle.cityId,
      castleId: castle.castleId,
      ...(courtPosition ? { courtPosition } : {}),
    });
    return transact
      .mutateAsync({
        instructions: [ix],
        invalidateKeys: [["player"], ["castle"]],
        successMessage: "Daily castle rewards claimed!",
        onPhase: reportPhase,
      })
      .then((r) => r.signature);
  };

  const handleClaimVacant = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    const ge = client.gameEngine;
    const ix = await createClaimVacantCastleInstruction({
      castleId,
      cityId,
      gameEngine: ge,
      claimer: publicKey,
    });
    return transact
      .mutateAsync({
        instructions: [ix],
        invalidateKeys: [["castle"], ["player"]],
        successMessage: "Castle claimed!",
        onPhase: reportPhase,
      })
      .then((r) => {
        useTransitionStore.getState().triggerActBeat({ act: 5, phase: "coronation" });
        return r.signature;
      });
  };

  const handleJoinGarrison = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    if (garrisonUnits.every((n) => n === 0) && garrisonWeapons.every((n) => n === 0)) {
      throw new Error("Choose units or weapons to contribute");
    }
    const ge = client.gameEngine;
    const hero = garrisonHeroSlot < 3 ? lockedHeroes[garrisonHeroSlot] : null;
    const ix = await createJoinGarrisonInstruction(
      { owner: publicKey, gameEngine: ge, cityId, castleId },
      {
        units: garrisonUnits,
        weapons: garrisonWeapons,
        heroSlot: hero ? garrisonHeroSlot : NO_HERO_SLOT,
        heroMint: hero?.mint,
        heroTemplateId: hero?.templateId,
      },
    );
    return transact
      .mutateAsync({
        instructions: [ix],
        invalidateKeys: [["castle"], ["player"]],
        successMessage: hero
          ? `Joined garrison with hero ${hero.name}!`
          : `Joined garrison with ${garrisonUnits
              .reduce((a, b) => a + b, 0)
              .toLocaleString()} units!`,
        onPhase: reportPhase,
      })
      .then((r) => r.signature);
  };

  const handleLeaveGarrison = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    const ge = client.gameEngine;
    const ix = await createLeaveGarrisonInstruction({
      castleId,
      cityId,
      gameEngine: ge,
      owner: publicKey,
    });
    return transact
      .mutateAsync({
        instructions: [ix],
        invalidateKeys: [["castle"], ["player"]],
        successMessage: "Left garrison.",
        onPhase: reportPhase,
      })
      .then((r) => r.signature);
  };

  const handleAppointCourt = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    const ge = client.gameEngine;
    if (!appointeeWallet) throw new Error("Choose a House member to appoint");
    const appointeePubkey = new PublicKey(appointeeWallet);
    if (appointeePubkey.equals(publicKey)) {
      throw new Error("A king cannot appoint himself to his own court");
    }
    const ix = await createAppointCourtInstruction(
      {
        king: publicKey,
        appointee: appointeePubkey,
        gameEngine: ge,
        cityId,
        castleId,
      },
      { position: appointPosition },
    );
    return transact
      .mutateAsync({
        instructions: [ix],
        invalidateKeys: [["castle"], ["player"]],
        successMessage: "Court member appointed!",
        onPhase: reportPhase,
      })
      .then((r) => r.signature);
  };

  const handleDismissCourt = async (
    position: number,
    dismissedWallet: PublicKey,
    reportPhase: (p: TxPhase) => void,
  ) => {
    if (!publicKey) throw new Error("Wallet not connected");
    const ge = client.gameEngine;
    const ix = await createDismissCourtInstruction(
      {
        king: publicKey,
        dismissed: dismissedWallet,
        gameEngine: ge,
        cityId,
        castleId,
      },
      { position },
    );
    return transact
      .mutateAsync({
        instructions: [ix],
        invalidateKeys: [["castle"], ["player"]],
        successMessage: "Court member dismissed!",
        onPhase: reportPhase,
      })
      .then((r) => r.signature);
  };

  const handleResignCourt = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    const ge = client.gameEngine;
    const ix = await createResignCourtInstruction(
      {
        courtMember: publicKey,
        gameEngine: ge,
        cityId,
        castleId,
      },
      { position: resignPosition },
    );
    return transact
      .mutateAsync({
        instructions: [ix],
        invalidateKeys: [["castle"], ["player"]],
        successMessage: "Resigned from court.",
        onPhase: reportPhase,
      })
      .then((r) => r.signature);
  };

  const handleInitiateUpgrade = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    const ge = client.gameEngine;
    const ix = await createInitiateUpgradeInstruction(
      {
        king: publicKey,
        gameEngine: ge,
        cityId,
        castleId,
      },
      { upgradeType },
    );
    return transact
      .mutateAsync({
        instructions: [ix],
        invalidateKeys: [["castle"], ["player"]],
        successMessage: "Upgrade initiated!",
        onPhase: reportPhase,
      })
      .then((r) => r.signature);
  };

  const handleCancelUpgrade = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    const ge = client.gameEngine;
    const ix = await createCancelUpgradeInstruction({
      king: publicKey,
      gameEngine: ge,
      cityId,
      castleId,
    });
    return transact
      .mutateAsync({
        instructions: [ix],
        invalidateKeys: [["castle"], ["player"]],
        successMessage: "Upgrade cancelled.",
        onPhase: reportPhase,
      })
      .then((r) => r.signature);
  };

  const handleCompleteUpgrade = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    const ge = client.gameEngine;
    const ix = await createCompleteUpgradeInstruction({
      payer: publicKey,
      gameEngine: ge,
      cityId,
      castleId,
    });
    return transact
      .mutateAsync({
        instructions: [ix],
        invalidateKeys: [["castle"]],
        successMessage: "Upgrade completed!",
        onPhase: reportPhase,
      })
      .then((r) => r.signature);
  };

  const handleRelieveGarrison = async (
    memberWallet: PublicKey,
    reportPhase: (p: TxPhase) => void,
  ) => {
    if (!publicKey) throw new Error("Wallet not connected");
    const ge = client.gameEngine;
    const ix = await createRelieveGarrisonInstruction({
      king: publicKey,
      garrisonMember: memberWallet,
      gameEngine: ge,
      cityId,
      castleId,
    });
    return transact
      .mutateAsync({
        instructions: [ix],
        invalidateKeys: [["castle"], ["player"]],
        successMessage: "Garrison member relieved.",
        onPhase: reportPhase,
      })
      .then((r) => r.signature);
  };

  const handleClaimGarrisonLoot = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    const ge = client.gameEngine;
    const ix = await createClaimGarrisonLootInstruction({
      owner: publicKey,
      gameEngine: ge,
      cityId,
      castleId,
    });
    return transact
      .mutateAsync({
        instructions: [ix],
        invalidateKeys: [["castle"], ["player"]],
        successMessage: "Garrison loot claimed!",
        onPhase: reportPhase,
      })
      .then((r) => r.signature);
  };

  const handleAttackCastle = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    const ge = client.gameEngine;
    const ix = await createAttackCastleInstruction(
      {
        attacker: publicKey,
        gameEngine: ge,
        cityId,
        castleId,
      },
      { driveBy },
    );
    return transact
      .mutateAsync({
        instructions: [ix],
        invalidateKeys: [["castle"], ["player"]],
        successMessage: driveBy ? "Drive-by attack launched!" : "Castle attacked!",
        onPhase: reportPhase,
      })
      .then((r) => r.signature);
  };

  if (!hasTeam) {
    return (
      <div className="card text-center">
        <p className="text-text-muted">
          A seat is held by a House, not a lone hand. Swear to a House before you contest a castle.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-display text-lg font-semibold text-text-primary">
          {CASTLE_FRAMING.title}
        </h2>
        <p className="mt-1 text-xs italic text-text-muted">{CASTLE_FRAMING.line}</p>
      </div>

      {/* Castle selector + Locate — Locate closes the round-trip from
       * the inspect panel on the map. We drop `tab` so we land on the
       * default realm view, drop `castleId` (castle-tab state), and set
       * `castle=<pubkey>` which map-tab.tsx already consumes to preselect
       * the entity + pan/zoom the disc onto its cell. */}
      <div className="flex items-center gap-2">
        <div className="flex flex-1 gap-1 rounded-lg bg-surface p-1 ">
          {cityCastles.length === 0 ? (
            <span className="px-3 py-1.5 text-xs text-text-muted">No castle in this city</span>
          ) : (
            cityCastles.map((c) => (
              <button
                key={c.account.castleId}
                type="button"
                onClick={() => setCastleId(c.account.castleId)}
                className={`truncate rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  castleId === c.account.castleId
                    ? "bg-surface-raised text-text-gold"
                    : "text-text-muted hover:text-text-secondary"
                }`}
              >
                {c.account.name?.trim() || `Castle ${c.account.castleId}`}
              </button>
            ))
          )}
        </div>
        {castlePda && castle && (
          <button
            type="button"
            onClick={() =>
              /* Map-tab's deep-link consumer (map-tab.tsx ~237)
               * early-exits unless `?city=` is present, and it only
               * pans/selects when `?lat=` AND `?long=` are also set.
               * Send all four so the round-trip actually focuses the
               * camera and pops the EntityPanel on the right castle.
               * CastleAccount.latitude / longitude are i32 grid units
               * (degrees × 10000); the URL contract expects decimal
               * degrees so we divide before pushing. */
              urlPatch({
                tab: null,
                castleId: null,
                cityId: null,
                city: String(castle.cityId),
                lat: String(castle.latitude / 10000),
                long: String(castle.longitude / 10000),
                castle: castlePda.toBase58(),
              })
            }
            className="rounded-md border border-border-default bg-surface px-3 py-1.5 text-xs font-medium text-text-secondary hover:text-text-gold"
          >
            Locate
          </button>
        )}
      </div>

      {/* Castle Info */}
      {castle ? (
        <>
          {/* Hero header: on desktop the landmark banner sits beside the stat
              block instead of ballooning to full content width above it. They
              stack again on narrow viewports, and items-start keeps the banner
              at a clean 16:9 rather than stretching to the stat card height. */}
          <div className="grid gap-4 xl:grid-cols-2 xl:items-start">
            <CastleBanner castle={castle} />
            {/* Right column: the stat block plus the daily-rewards and record
                cards, stacked beside the banner. */}
            <div className="space-y-4">
              <div className="card accent-border">
                <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                  <div>
                    <div className="text-xs text-text-muted">Tier</div>
                    <div className="text-sm font-semibold text-text-gold">
                      {CASTLE_TIER_NAMES[castle.tier ?? 0]}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-text-muted">Status</div>
                    <div className="text-sm font-semibold text-text-primary">
                      {CASTLE_STATUS_NAMES[castle.status ?? 0]}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-text-muted">Garrison</div>
                    <GoldNumber value={castle.garrisonCount ?? 0} size="sm" />
                  </div>
                  <div>
                    <div className="text-xs text-text-muted">Total Rewards</div>
                    <GoldNumber
                      value={Number(castle.totalRewardsDistributed ?? 0n)}
                      prefix="$ "
                      size="sm"
                    />
                  </div>
                </div>
                <p className="mt-3 text-xs italic text-text-muted">
                  {CASTLE_STATUS_NARRATION[castle.status ?? 0] ??
                    "The condition of the seat is unclear."}
                </p>
                {castle.hasKing && (
                  <div className="mt-3 border-t border-zinc-800 pt-3">
                    <div className="text-xs text-text-muted">King</div>
                    <div className="text-sm text-text-primary">
                      <DomainName pubkey={castle.king} chars={6} />
                    </div>
                  </div>
                )}
              </div>

              {/* Daily Rewards — the castle's daily NOVI + cash payout by role,
                  plus the gated claim (king / court / garrison member only). */}
              <div className="card">
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted">
                  Daily Rewards
                </h3>
                <div className="space-y-1.5 text-xs">
                  {[
                    {
                      role: "King",
                      novi: deciToNovi(castle.kingNoviPerDay),
                      cash: castle.kingCashPerDay,
                    },
                    {
                      role: "Court",
                      novi: deciToNovi(castle.courtNoviPerDay),
                      cash: castle.courtCashPerDay,
                    },
                    {
                      role: "Member",
                      novi: deciToNovi(castle.memberNoviPerDay),
                      cash: castle.memberCashPerDay,
                    },
                  ].map((r) => (
                    <div
                      key={r.role}
                      className="flex items-center justify-between rounded bg-surface px-2 py-1"
                    >
                      <span className="text-text-secondary">{r.role}</span>
                      <span className="flex items-center gap-2 font-mono">
                        <span className="text-text-gold">
                          {Number(r.novi ?? 0n).toLocaleString()} NOVI
                        </span>
                        <span className="text-text-muted">·</span>
                        <span className="text-text-primary">
                          $ {Number(r.cash ?? 0n).toLocaleString()}
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
                {eligibleForRewards &&
                  (rewardClaimable ? (
                    <TxButton onClick={handleClaimRewards} className="mt-3 w-full text-xs">
                      {rewardLastClaim == null
                        ? "Start Earning"
                        : `Claim ${rewardClaimDays} day${rewardClaimDays === 1 ? "" : "s"}`}
                    </TxButton>
                  ) : (
                    <div className="mt-3 rounded-lg border border-zinc-800 px-3 py-2">
                      <GoldCountdown
                        endsAt={rewardNextClaimAt}
                        label="Next claim"
                        format="compact"
                        size="sm"
                      />
                    </div>
                  ))}
              </div>

              {/* Castle Record — defense history, economics, and the minor
                  stats surfaced straight from the castle account. */}
              <div className="card">
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted">
                  Castle Record
                </h3>
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-3">
                  <div>
                    <div className="text-text-muted">Held since</div>
                    <div className="text-text-primary">{heldSinceLabel}</div>
                  </div>
                  <div>
                    <div className="text-text-muted">Defenses</div>
                    <div className="text-text-primary">
                      <span className="text-emerald-400">{castle.successfulDefenses ?? 0}W</span>
                      {" · "}
                      <span className="text-red-400">{castle.failedDefenses ?? 0}L</span>
                    </div>
                  </div>
                  <div>
                    <div className="text-text-muted">Times claimed</div>
                    <div className="text-text-primary">{castle.timesClaimed ?? 0}</div>
                  </div>
                  <div>
                    <div className="text-text-muted">King&apos;s loot cut</div>
                    <div className="text-text-primary">
                      {bpsToPercent(castle.kingLootCutBps ?? 0)}%
                    </div>
                  </div>
                  <div>
                    <div className="text-text-muted">Tier bonus</div>
                    <div className="text-text-primary">
                      ×{((castle.tierMultiplierBps ?? 0) / 10000).toFixed(2)}
                    </div>
                  </div>
                  <div>
                    <div className="text-text-muted">Footprint</div>
                    <div className="text-text-primary">
                      {castle.footprintSize ?? 1}×{castle.footprintSize ?? 1}
                    </div>
                  </div>
                  <div>
                    <div className="text-text-muted">Court cooldown</div>
                    <div className="text-text-primary">
                      {formatTime(castle.courtAppointmentCooldown ?? 0)}
                    </div>
                  </div>
                  <div>
                    <div className="text-text-muted">
                      {activatesInFuture ? "Activates" : "Active since"}
                    </div>
                    <div className="text-text-primary">{activatesLabel}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* War Council — the castle's encrypted war-table, for the king and
           * garrison members of this seat. Hidden for everyone else (a
           * non-member can neither read nor post). */}
          {castlePda && canPostCastle && (
            <div className="card flex flex-col">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted">
                War Council
              </h3>
              <ThreadRenderer
                threadPda={castlePda}
                scope={WarTableScope.Castle}
                gateAccounts={castleGate}
                canPost={canPostCastle}
                placeholder="Rally the garrison..."
              />
            </div>
          )}

          {/* Court Positions */}
          <div className="card">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted">
              Court Positions ({castle.courtCount ?? 0} / {castle.maxCourt ?? 5})
            </h3>
            <div className="grid gap-2 md:grid-cols-5">
              {COURT_POSITIONS.map((pos, i) => {
                const member = courtRoster.find((c) => c.position === i);
                return (
                  <div key={pos} className="rounded-lg border border-zinc-800 p-3 text-center">
                    <div className="text-xs text-text-muted">{pos}</div>
                    {member ? (
                      <div className="mt-1 text-xs text-text-primary">
                        <DomainName pubkey={member.account.holder} chars={4} />
                      </div>
                    ) : (
                      <div className="mt-1 text-xs text-text-secondary">Vacant</div>
                    )}
                    {isKing && member?.ownerWallet && (
                      <TxButton
                        onClick={(rp) => handleDismissCourt(i, member.ownerWallet!, rp)}
                        variant="danger"
                      >
                        Dismiss
                      </TxButton>
                    )}
                  </div>
                );
              })}
            </div>

            {isKing && (
              <div className="mt-4 space-y-2">
                <h4 className="text-xs font-semibold text-text-muted">Appoint Court Member</h4>
                {courtCandidates.length === 0 ? (
                  <p className="text-xs italic text-text-muted">
                    A court is your own people — a House must stand behind you first. Swear members
                    to your House, then call them to court.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    <select
                      value={appointPosition}
                      onChange={(e) => setAppointPosition(Number(e.target.value))}
                      className="rounded-lg border border-zinc-800 bg-surface px-3 py-2 text-sm text-text-primary"
                    >
                      {COURT_POSITIONS.map((pos, i) => (
                        <option key={pos} value={i}>
                          {pos}
                        </option>
                      ))}
                    </select>
                    <select
                      value={appointeeWallet}
                      onChange={(e) => setAppointeeWallet(e.target.value)}
                      className="flex-1 rounded-lg border border-zinc-800 bg-surface px-3 py-2 text-sm text-text-primary"
                    >
                      <option value="">Choose a House member…</option>
                      {courtCandidates.map((c) => (
                        <option key={c.wallet.toBase58()} value={c.wallet.toBase58()}>
                          {shortenAddress(c.wallet.toBase58(), 4)}
                        </option>
                      ))}
                    </select>
                    <TxButton onClick={handleAppointCourt} disabled={!appointeeWallet}>
                      Appoint
                    </TxButton>
                  </div>
                )}
              </div>
            )}

            {!isKing && castle.hasKing && (
              <div className="mt-4 space-y-2">
                <h4 className="text-xs font-semibold text-text-muted">Resign from Court</h4>
                <div className="flex gap-2">
                  <select
                    value={resignPosition}
                    onChange={(e) => setResignPosition(Number(e.target.value))}
                    className="rounded-lg border border-zinc-800 bg-surface px-3 py-2 text-sm text-text-primary"
                  >
                    {COURT_POSITIONS.map((pos, i) => (
                      <option key={pos} value={i}>
                        {pos}
                      </option>
                    ))}
                  </select>
                  <TxButton onClick={handleResignCourt} variant="danger">
                    Resign
                  </TxButton>
                </div>
              </div>
            )}
          </div>

          {/* Castle Upgrade (King only) */}
          {isKing && (
            <div className="card">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted">
                Castle Upgrades
              </h3>
              <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
                <div>
                  <div className="text-xs text-text-muted">Fortification</div>
                  <div className="text-sm font-semibold text-text-primary">
                    Lv {castle.fortificationLevel ?? 0}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-text-muted">Treasury</div>
                  <div className="text-sm font-semibold text-text-primary">
                    Lv {castle.treasuryLevel ?? 0}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-text-muted">Chambers</div>
                  <div className="text-sm font-semibold text-text-primary">
                    Lv {castle.chambersLevel ?? 0}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-text-muted">Watchtower</div>
                  <div className="text-sm font-semibold text-text-primary">
                    Lv {castle.watchtowerLevel ?? 0}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-text-muted">Armory</div>
                  <div className="text-sm font-semibold text-text-primary">
                    Lv {castle.armoryLevel ?? 0}
                  </div>
                </div>
              </div>

              {hasUpgradeInProgress ? (
                <div className="mt-4 space-y-2">
                  <div className="flex items-center justify-between rounded-lg border border-zinc-800 px-3 py-2">
                    <span className="text-xs text-text-muted">
                      Upgrading:{" "}
                      {UPGRADE_TYPES.find((u) => u.value === castle.upgradeType)?.label ??
                        "Unknown"}
                      {" to Lv "}
                      {castle.upgradeTargetLevel ?? "?"}
                    </span>
                    <GoldCountdown
                      endsAt={Number(castle.upgradeEndAt ?? 0n)}
                      format="full"
                      label="Completes"
                    />
                  </div>
                  <div className="flex gap-2">
                    <TxButton onClick={handleCancelUpgrade} variant="danger">
                      Cancel Upgrade
                    </TxButton>
                    <TxButton onClick={handleCompleteUpgrade} variant="secondary">
                      Complete Upgrade
                    </TxButton>
                  </div>
                </div>
              ) : (
                <div className="mt-4 flex gap-2">
                  <select
                    value={upgradeType}
                    onChange={(e) => setUpgradeType(Number(e.target.value))}
                    className="rounded-lg border border-zinc-800 bg-surface px-3 py-2 text-sm text-text-primary"
                  >
                    {UPGRADE_TYPES.map((u) => (
                      <option key={u.value} value={u.value}>
                        {u.label}
                      </option>
                    ))}
                  </select>
                  <TxButton onClick={handleInitiateUpgrade}>Initiate Upgrade</TxButton>
                </div>
              )}
            </div>
          )}

          {/* Garrison Actions — only rendered for a held castle your own
           * House holds whose tier supports a garrison. When you are not
           * yet in it you contribute to join; once in it you leave or
           * claim captured loot. */}
          {canSeeGarrison && (
            <div className="card">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted">
                Garrison Actions
              </h3>
              {inGarrison ? (
                <div className="space-y-3">
                  <p className="text-xs text-text-secondary">
                    You stand with this garrison.
                    {hasUnclaimedLoot
                      ? " Weapons captured in its defense are waiting for you."
                      : " There are no captured weapons to claim right now."}
                  </p>
                  <div className="flex flex-wrap gap-3">
                    <TxButton onClick={handleLeaveGarrison} variant="danger">
                      Leave Garrison
                    </TxButton>
                    <TxButton
                      onClick={handleClaimGarrisonLoot}
                      variant="secondary"
                      disabled={!hasUnclaimedLoot}
                    >
                      Claim Garrison Loot
                    </TxButton>
                  </div>
                </div>
              ) : (
                /* Contribute units & weapons to the castle garrison */
                <div className="rounded-lg border border-zinc-800 p-3">
                  <h4 className="mb-2 text-xs font-semibold text-text-muted">
                    Contribute to Garrison
                  </h4>
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                    Defensive Units
                  </div>
                  <TripleCountInput
                    labels={DEFENSIVE_UNIT_LABELS}
                    icons={DEFENSIVE_UNIT_ICONS}
                    available={availUnits}
                    value={garrisonUnits}
                    onChange={setGarrisonUnits}
                  />
                  <div className="mt-2 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                    Weapons
                  </div>
                  <TripleCountInput
                    labels={WEAPON_LABELS}
                    icons={WEAPON_ICONS}
                    available={availWeapons}
                    value={garrisonWeapons}
                    onChange={setGarrisonWeapons}
                  />
                  <div className="mt-2">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                      Hero
                    </div>
                    <select
                      value={garrisonHeroSlot}
                      onChange={(e) => setGarrisonHeroSlot(Number(e.target.value))}
                      className="mt-1 w-full rounded border border-zinc-800 bg-surface px-2 py-1.5 text-sm text-text-primary"
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
                    {lockedHeroes.every((h) => h === null) && (
                      <p className="mt-1 text-[10px] text-text-muted">
                        Lock a hero in the Heroes tab to commit one.
                      </p>
                    )}
                  </div>
                  {garrisonFull && (
                    <p className="mt-2 text-xs italic text-text-muted">
                      The garrison is full ({castle.garrisonCount} / {castle.maxGarrison}). No more
                      swords can be added until a seat frees.
                    </p>
                  )}
                  <TxButton
                    onClick={handleJoinGarrison}
                    variant="secondary"
                    className="mt-3 w-full"
                    disabled={noContribution || garrisonFull}
                  >
                    Join Garrison
                  </TxButton>
                </div>
              )}

              {/* Garrison roster */}
              <div className="mt-4 space-y-2">
                <h4 className="text-xs font-semibold text-text-muted">
                  Garrison Members ({garrisonRoster.length})
                </h4>
                {garrisonRoster.length === 0 ? (
                  <p className="text-xs text-text-muted">No garrison members.</p>
                ) : (
                  <div className="space-y-2">
                    {garrisonRoster.map((g) => {
                      const totalUnits =
                        Number(g.account.du1 ?? 0n) +
                        Number(g.account.du2 ?? 0n) +
                        Number(g.account.du3 ?? 0n);
                      return (
                        <div
                          key={g.account.contributor.toBase58()}
                          className="flex items-center justify-between rounded-lg border border-zinc-800 px-3 py-2"
                        >
                          <div className="flex items-center gap-3">
                            <span className="font-mono text-sm text-text-primary">
                              <DomainName pubkey={g.account.contributor} chars={4} />
                            </span>
                            <span className="text-xs text-text-muted">{totalUnits} units</span>
                          </div>
                          {isKing && g.ownerWallet && (
                            <TxButton
                              onClick={(rp) => handleRelieveGarrison(g.ownerWallet!, rp)}
                              variant="danger"
                            >
                              Relieve
                            </TxButton>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Actions — Vacant seats are claimed (gated on eligibility);
           * held seats are attacked (gated on attackability). The two are
           * mutually exclusive on-chain, so we surface only the one that
           * applies and explain when it is blocked. */}
          <div className="card space-y-3">
            {castle.status === 0 ? (
              <>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                  Claim Requirements
                </h3>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                  {claimReqs.map((r) => (
                    <span key={r.label} className="inline-flex items-center gap-1">
                      {r.ok ? (
                        <Check className="h-3.5 w-3.5 text-emerald-400" />
                      ) : (
                        <X className="h-3.5 w-3.5 text-red-400" />
                      )}
                      <span className={r.ok ? "text-text-secondary" : "text-red-400"}>
                        {r.label} {r.have} / {r.need}
                      </span>
                    </span>
                  ))}
                </div>
                {claimBlockedByResidue && (
                  <p className="text-xs italic text-text-muted">
                    The previous court has not yet dispersed. The seat must be swept clean before it
                    can be claimed.
                  </p>
                )}
                {!canClaim && !claimBlockedByResidue && (
                  <p className="text-xs italic text-text-muted">
                    You do not yet meet the terms to take this seat.
                  </p>
                )}
                <TxButton onClick={handleClaimVacant} disabled={!canClaim}>
                  Claim Castle
                </TxButton>
              </>
            ) : (
              <>
                {!attackInfo.attackable && (
                  <p className="flex flex-wrap items-center gap-1 text-xs italic text-text-muted">
                    {attackInfo.reason}
                    {attackInfo.opensAt != null && (
                      <GoldCountdown
                        endsAt={attackInfo.opensAt}
                        format="compact"
                        label="Opens in"
                      />
                    )}
                  </p>
                )}
                <div className="flex items-center gap-2">
                  <TxButton
                    onClick={handleAttackCastle}
                    variant="danger"
                    disabled={!attackInfo.attackable}
                  >
                    Attack Castle
                  </TxButton>
                  <button
                    onClick={() => setDriveBy(!driveBy)}
                    className={`rounded-lg px-3 py-2 text-sm ${
                      driveBy ? "bg-accent/30 text-text-gold" : "text-text-muted"
                    }`}
                  >
                    Drive-by
                  </button>
                </div>
                <CombatForecastPanel
                  result={castleForecast}
                  combat="castle"
                  refill={{
                    plan: castleRefill.plan,
                    run: castleRefill.run,
                    running: castleRefill.running,
                    isLegendary: castleForecast.isLegendary,
                  }}
                />
                {attackInfo.attackable && (
                  <p className="text-[10px] text-text-muted">
                    You must stand within striking range of the castle and not be traveling.
                  </p>
                )}
              </>
            )}
          </div>
        </>
      ) : (
        <div className="card text-center">
          <p className="text-text-muted">No castle found at this location.</p>
        </div>
      )}

      {/* Game Parameters */}
      {geData?.account &&
        (() => {
          const cc = geData.account.castleConfig;
          return (
            <GameInfoPanel>
              <InfoGrid
                items={[
                  {
                    label: "King NOVI/Day",
                    value: Number(cc.kingNoviPerDay).toLocaleString(),
                    highlight: true,
                  },
                  {
                    label: "King Cash/Day",
                    value: Number(cc.kingCashPerDay).toLocaleString(),
                  },
                  {
                    label: "Court NOVI/Day",
                    value: Number(cc.courtNoviPerDay).toLocaleString(),
                  },
                  {
                    label: "Court Cash/Day",
                    value: Number(cc.courtCashPerDay).toLocaleString(),
                  },
                  {
                    label: "Member NOVI/Day",
                    value: Number(cc.memberNoviPerDay).toLocaleString(),
                  },
                  {
                    label: "Member Cash/Day",
                    value: Number(cc.memberCashPerDay).toLocaleString(),
                  },
                  {
                    label: "King Loot Cut",
                    value: bpsToPercent(cc.kingLootCutBps),
                  },
                  {
                    label: "Protection",
                    value: formatTime(Number(cc.protectionDuration), "compact"),
                  },
                  {
                    label: "Garrison T0",
                    value: cc.garrisonCapByTier[0]?.toString() ?? "—",
                  },
                  {
                    label: "Garrison T1",
                    value: cc.garrisonCapByTier[1]?.toString() ?? "—",
                  },
                  {
                    label: "Garrison T2",
                    value: cc.garrisonCapByTier[2]?.toString() ?? "—",
                  },
                  {
                    label: "Max Fortification",
                    value: cc.maxFortificationLevel.toString(),
                  },
                ]}
              />
            </GameInfoPanel>
          );
        })()}
    </div>
  );
}
