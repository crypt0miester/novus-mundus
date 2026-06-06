"use client";

import { useState, useMemo, useEffect } from "react";
import { Check, Hammer, MapPin, X } from "lucide-react";
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
import { InfoButton } from "@/components/shared/InfoButton";
import {
  TripleCountInput,
  DEFENSIVE_UNIT_LABELS,
  DEFENSIVE_UNIT_ICONS,
  WEAPON_LABELS,
  WEAPON_ICONS,
} from "@/components/shared/TripleCountInput";
import { useGameEngine } from "@/lib/hooks/useGameEngine";
import { useTransitionStore } from "@/lib/store/transition";
import { bpsToPercent, cn, formatTime, shortenAddress } from "@/lib/utils";
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
  createFinalizeTransitionInstruction,
  type CastleAccount,
  parsePlayer,
  parseTeamCastleReward,
  deriveGarrisonPda,
  deriveTeamCastleRewardPda,
  deriveCourtPda,
  isNullPubkey,
  CastleStatus,
  WarTableScope,
  deciToNovi,
  calculateCastleReward,
  MAX_FORTIFICATION_LEVEL,
  MAX_TREASURY_LEVEL,
  MAX_CHAMBERS_LEVEL,
  MAX_WATCHTOWER_LEVEL,
  MAX_ARMORY_LEVEL,
} from "novus-mundus-sdk";
import { ThreadRenderer } from "@/components/war-table/ThreadRenderer";
import { MobileTeamDock } from "@/components/war-table/MobileTeamDock";
import { useIsMobile } from "@/lib/hooks/useMediaQuery";
import { useChainNow } from "@/lib/hooks/useChainTime";
import { usePlayerPda } from "@/lib/hooks/usePlayerPda";
import {
  CASTLE_TIER_NAMES,
  CASTLE_STATUS_NAMES,
  CASTLE_STATUS_NARRATION,
  rulerTitle,
} from "@/lib/world/castles";

const COURT_POSITIONS = ["Advisor", "Scholar", "Guardian", "Treasurer", "Marshal"];

const CASTLE_FRAMING = systemFraming("castle");
// Each upgrade carries its own level accessor off the castle, so the
// value->stat correspondence lives in one table instead of a parallel lookup.
const UPGRADE_TYPES: {
  value: number;
  label: string;
  max: number;
  level: (c: CastleAccount | null | undefined) => number;
}[] = [
  { value: 1, label: "Fortification", max: MAX_FORTIFICATION_LEVEL, level: (c) => c?.fortificationLevel ?? 0 },
  { value: 2, label: "Treasury", max: MAX_TREASURY_LEVEL, level: (c) => c?.treasuryLevel ?? 0 },
  { value: 3, label: "Chambers", max: MAX_CHAMBERS_LEVEL, level: (c) => c?.chambersLevel ?? 0 },
  { value: 4, label: "Watchtower", max: MAX_WATCHTOWER_LEVEL, level: (c) => c?.watchtowerLevel ?? 0 },
  { value: 5, label: "Armory", max: MAX_ARMORY_LEVEL, level: (c) => c?.armoryLevel ?? 0 },
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
  const [upgradeType, setUpgradeType] = useState(1);
  // War Council chat: on mobile it lives in a MobileTeamDock (peek strip +
  // bottom sheet), the same surface the team chat uses; desktop keeps it inline.
  const [warCouncilOpen, setWarCouncilOpen] = useState(false);
  const isMobile = useIsMobile();
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

  // The wallet's PlayerAccount PDA. On-chain, castle.king and transitionNewKing
  // store the PLAYER PDA (claim_vacant_castle.rs: king = player_account.address()),
  // not the wallet, so kingship is decided against this PDA.
  const myPlayerPda = usePlayerPda();

  const isKing = useMemo(() => {
    if (!castle || !castle.hasKing || !myPlayerPda) return false;
    return castle.king.equals(myPlayerPda);
  }, [castle, myPlayerPda]);

  // The court seat this wallet personally holds, if any. courtRoster entries
  // carry the resolved owner wallet, so this is a wallet-vs-wallet match.
  const myCourtSeat = useMemo(
    () => (publicKey ? (courtRoster.find((c) => c.ownerWallet?.equals(publicKey)) ?? null) : null),
    [courtRoster, publicKey],
  );

  const hasUpgradeInProgress = useMemo(() => {
    if (!castle) return false;
    return castle.upgradeType > 0;
  }, [castle]);

  /* Mirror the on-chain gates so the buttons explain *why* an action is
   * blocked instead of firing a tx that bounces with a raw GameError.
   * Claim eligibility -> claim_vacant_castle.rs (level / networth-millions /
   * troops-thousands). Attackability -> CastleAccount::can_be_attacked. */
  // Chain-anchored, ticks every second so countdowns/gates (protection,
  // contest, upgrade-ready) flip live rather than waiting on an unrelated
  // re-render.
  const nowSec = useChainNow(1000);

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

  // Contest-window end + protection-shield end, derived once from the seat and
  // shared by attackInfo + statusTimer. protectionEnd = contestEnd + the base
  // protection duration scaled by the watchtower (each level adds 10% via bps).
  const { contestEnd, protectionEnd } = useMemo(() => {
    if (!castle) return { contestEnd: 0, protectionEnd: 0 };
    const contestEnd = Number(castle.contestEndAt ?? 0n);
    const watchtowerBps = (castle.watchtowerLevel ?? 0) * 1000;
    const protSecs = Math.floor(
      (Number(castle.protectionDuration ?? 0n) * (10_000 + watchtowerBps)) / 10_000,
    );
    return { contestEnd, protectionEnd: contestEnd + protSecs };
  }, [castle]);

  const attackInfo = useMemo<{
    attackable: boolean;
    reason: string;
    opensAt: number | null;
  }>(() => {
    if (!castle) return { attackable: false, reason: "No castle here.", opensAt: null };
    switch (castle.status) {
      case CastleStatus.Vacant:
        return {
          attackable: false,
          reason: "The seat is empty. There is no garrison to fight; claim it instead.",
          opensAt: null,
        };
      case CastleStatus.Contest:
        return nowSec < contestEnd
          ? { attackable: true, reason: "", opensAt: null }
          : {
              attackable: false,
              reason: "The contest has ended and protection is settling over the seat.",
              opensAt: null,
            };
      case CastleStatus.Protected:
        return nowSec >= protectionEnd
          ? { attackable: true, reason: "", opensAt: null }
          : {
              attackable: false,
              reason: "The seat is shielded by protection. It cannot be moved against yet.",
              opensAt: protectionEnd,
            };
      case CastleStatus.Vulnerable:
        return { attackable: true, reason: "", opensAt: null };
      case CastleStatus.Transitioning:
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
  }, [castle, nowSec, contestEnd, protectionEnd]);

  // Am I the challenger who won the seat and is now waiting out the transition?
  // While TRANSITIONING (status 4), the crown does not pass until the contest
  // window closes AND the old garrison + court have dispersed (finalize_transition.rs).
  // Until then the new king should see a "claim the crown" flow, not "attack".
  const iAmNewKing =
    !!castle &&
    castle.status === CastleStatus.Transitioning &&
    !!myPlayerPda &&
    !isNullPubkey(castle.transitionNewKing) &&
    castle.transitionNewKing.equals(myPlayerPda);
  const transitionSettleAt = contestEnd;
  const transitionFinalizable =
    iAmNewKing &&
    nowSec >= transitionSettleAt &&
    (castle?.garrisonCount ?? 0) === 0 &&
    (castle?.courtCount ?? 0) === 0;

  // A seat is "settled" when it is neither being contested nor mid-handover.
  // Court appointments (appoint_court.rs) and upgrades (initiate_upgrade.rs)
  // both pause in those windows; the on-chain processors enforce the same.
  const seatSettled =
    castle?.status !== CastleStatus.Contest && castle?.status !== CastleStatus.Transitioning;

  // Court gating: a court needs a Citadel-grade seat (max_court > 0) on a
  // settled seat.
  const courtSupported = (castle?.maxCourt ?? 0) > 0;
  const courtAppointable = courtSupported && seatSettled;

  // Upgrades are king-only on a settled seat.
  const upgradeAllowed = isKing && seatSettled;
  const selectedUpgrade = UPGRADE_TYPES.find((u) => u.value === upgradeType) ?? UPGRADE_TYPES[0];
  const selectedUpgradeMaxed = selectedUpgrade.level(castle) >= selectedUpgrade.max;
  const upgradeEndsAt = Number(castle?.upgradeEndAt ?? 0n);

  // Headline countdown for the status chip. The two short (2h) windows —
  // Contest and Transitioning — are the ones players must act on, so they
  // render urgent (gold pill); the 10-day Protected shield renders quiet.
  const statusTimer = useMemo<{ endsAt: number; label: string; urgent: boolean } | null>(() => {
    if (!castle) return null;
    switch (castle.status) {
      case CastleStatus.Contest: // 2h challenge window
        return nowSec < contestEnd
          ? { endsAt: contestEnd, label: "Contest ends", urgent: true }
          : null;
      case CastleStatus.Protected: // 10d shield
        return nowSec < protectionEnd
          ? { endsAt: protectionEnd, label: "Protected until", urgent: false }
          : null;
      case CastleStatus.Transitioning: // 2h settle window
        return nowSec < contestEnd
          ? { endsAt: contestEnd, label: "Crown settles", urgent: true }
          : null;
      default:
        return null;
    }
  }, [castle, nowSec, contestEnd, protectionEnd]);

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

  /* EFFECTIVE daily reward by role = base × tier bonus × treasury bonus,
   * mirroring on-chain calculate_reward. Base per-day rates are FLAT across
   * tiers, so the seat's payout is set entirely by tierMultiplierBps (×0.25
   * Outpost → ×2.0 Citadel) + treasury level (+10%/level). Memoized on the
   * castle so the per-second chain-time tick doesn't recompute these stable
   * values. */
  const effectiveRewards = useMemo(() => {
    if (!castle) return null;
    const eff = (base: bigint) =>
      calculateCastleReward(base, castle.tierMultiplierBps ?? 0, castle.treasuryLevel ?? 0, 1);
    return {
      kingNovi: deciToNovi(eff(castle.kingNoviPerDay)),
      kingCash: eff(castle.kingCashPerDay),
      courtNovi: deciToNovi(eff(castle.courtNoviPerDay)),
      courtCash: eff(castle.courtCashPerDay),
      memberNovi: deciToNovi(eff(castle.memberNoviPerDay)),
      memberCash: eff(castle.memberCashPerDay),
    };
  }, [castle]);

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
    if (!publicKey || !myCourtSeat) throw new Error("You do not hold a court seat");
    const ge = client.gameEngine;
    const ix = await createResignCourtInstruction(
      {
        courtMember: publicKey,
        gameEngine: ge,
        cityId,
        castleId,
      },
      { position: myCourtSeat.position },
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

  const handleFinalizeTransition = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey || !castle) throw new Error("Wallet not connected");
    // Permissionless. The new king is this wallet; the old king's registry
    // decrement (optional account) is left to a separate sweep.
    const ix = await createFinalizeTransitionInstruction({
      payer: publicKey,
      gameEngine: client.gameEngine,
      cityId,
      castleId,
      newKing: publicKey,
    });
    return transact
      .mutateAsync({
        instructions: [ix],
        invalidateKeys: [["castle"], ["player"]],
        successMessage: "The crown is yours. Long may you reign.",
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

      {/* Castle selector — scrollable pills, one per castle in this city. The
          Locate action moved onto the banner (top-right) so it no longer
          crowds this row. */}
      <div className="flex flex-1 min-w-0 gap-1 overflow-x-auto rounded-lg bg-surface p-1">
        {cityCastles.length === 0 ? (
          <span className="px-3 py-1.5 text-xs text-text-muted">No castle in this city</span>
        ) : (
          cityCastles.map((c) => (
            <button
              key={c.account.castleId}
              type="button"
              onClick={() => setCastleId(c.account.castleId)}
              className={`shrink-0 whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
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

      {/* Castle Info */}
      {castle ? (
        <>
          {/* Hero header: on desktop the landmark banner sits beside the stat
              block instead of ballooning to full content width above it. They
              stack again on narrow viewports. On desktop the banner stretches
              to the full height of the (taller) stat column via items-stretch +
              an absolutely-filled banner, so there is no dead space beneath it;
              on mobile it falls back to a clean 16:9. */}
          <div className="grid gap-4 xl:grid-cols-2 xl:items-stretch">
            <div className="relative xl:h-full">
              <CastleBanner castle={castle} className="xl:absolute xl:inset-0 xl:h-full" />
              {castlePda && (
                <button
                  type="button"
                  // Round-trip to the realm map: drop tab/castleId/cityId, set
                  // city + decimal lat/long (grid units / 10000) + castle pubkey
                  // so map-tab pans the disc and pops the EntityPanel on this seat.
                  onClick={() =>
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
                  className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-md border border-border-default bg-surface/80 px-2.5 py-1 text-xs font-medium text-text-secondary backdrop-blur-sm transition-colors hover:text-text-gold"
                >
                  <MapPin size={12} />
                  Locate
                </button>
              )}
            </div>
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
                    <div className="text-xs text-text-muted">
                      Status{" "}
                      <InfoButton>
                        Attackable only when Contest (2h window after a claim) or Vulnerable.
                        Protected and Vacant cannot be attacked.
                      </InfoButton>
                    </div>
                    <div className="text-sm font-semibold text-text-primary">
                      {CASTLE_STATUS_NAMES[castle.status ?? 0]}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-text-muted">
                      Garrison{" "}
                      <InfoButton>
                        Teammates defending the castle. Slots cap by king tier: Rookie 5, Expert 10,
                        Epic 15, Legendary 25.
                      </InfoButton>
                    </div>
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
                <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                  <p className="text-xs italic text-text-muted">
                    {CASTLE_STATUS_NARRATION[castle.status ?? 0] ??
                      "The condition of the seat is unclear."}
                  </p>
                  {statusTimer &&
                    (statusTimer.urgent ? (
                      <div className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-md border border-border-gold/50 bg-[var(--nm-accent)]/10 px-3 py-1.5">
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-text-gold/80">
                          {statusTimer.label}
                        </span>
                        <GoldCountdown
                          endsAt={statusTimer.endsAt}
                          format="compact"
                          urgentThreshold={900}
                          size="sm"
                        />
                      </div>
                    ) : (
                      <span className="shrink-0 whitespace-nowrap text-[11px] text-text-muted">
                        {statusTimer.label}{" "}
                        <span className="font-mono tabular-nums">
                          {formatTime(Math.max(0, statusTimer.endsAt - nowSec), "compact")}
                        </span>
                      </span>
                    ))}
                </div>
                {castle.hasKing && (
                  <div className="mt-3 border-t border-zinc-800 pt-3">
                    <div className="text-xs text-text-muted">{rulerTitle(castle.tier ?? 0)}</div>
                    <div className="text-sm text-text-primary">
                      <DomainName pubkey={castle.king} chars={6} />
                    </div>
                  </div>
                )}
              </div>

              {/* Daily Rewards — the castle's EFFECTIVE daily NOVI + cash payout
                  by role, plus the gated claim (king / court / garrison member
                  only). Base per-day rates are FLAT across tiers on-chain; the
                  seat's payout is set by its tier bonus (×0.25 Outpost → ×2.0
                  Citadel) and treasury level (+10%/level), so we surface the
                  scaled numbers here — `calculateCastleReward` mirrors the chain
                  exactly — rather than the identical-looking base rates. */}
              <div className="card">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                    Daily Rewards
                  </h3>
                  <span className="flex items-center gap-1 text-[10px] font-medium text-text-gold/80">
                    ×{((castle.tierMultiplierBps ?? 0) / 10000).toFixed(2)} tier
                    {(castle.treasuryLevel ?? 0) > 0 && (
                      <span className="text-text-muted">
                        {" "}
                        · +{(castle.treasuryLevel ?? 0) * 10}% treasury
                      </span>
                    )}
                    <InfoButton>
                      Effective daily payout. Every seat shares the same base rate; the tier
                      bonus (×0.25 Outpost up to ×2.0 Citadel) and treasury level (+10% per
                      level) scale it — so a Citadel pays 8× an Outpost.
                    </InfoButton>
                  </span>
                </div>
                <div className="space-y-1.5 text-xs">
                  {[
                    {
                      role: rulerTitle(castle.tier ?? 0),
                      novi: effectiveRewards?.kingNovi,
                      cash: effectiveRewards?.kingCash,
                    },
                    {
                      role: "Court",
                      novi: effectiveRewards?.courtNovi,
                      cash: effectiveRewards?.courtCash,
                    },
                    {
                      role: "Member",
                      novi: effectiveRewards?.memberNovi,
                      cash: effectiveRewards?.memberCash,
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
                    <div className="text-text-muted">{rulerTitle(castle.tier ?? 0)}&apos;s loot cut</div>
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
           * non-member can neither read nor post). On desktop it sits inline;
           * on mobile it rides the same MobileTeamDock surface as the team chat
           * (a peek strip above the bottom nav that expands into a bottom sheet)
           * instead of a bulky always-open card. The inline copy is gated to
           * desktop so it doesn't mount on mobile and steal the dock's unread
           * tracking; the dock's sheet only mounts its thread when opened. */}
          {castlePda && canPostCastle && !isMobile && (
            <div className="card flex flex-col">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted">
                War Council
              </h3>
              <ThreadRenderer
                threadPda={castlePda}
                scope={WarTableScope.Castle}
                gateAccounts={castleGate}
                canPost={canPostCastle}
                placeholder="write a message..."
              />
            </div>
          )}
          {castlePda && canPostCastle && (
            <MobileTeamDock
              threadPda={castlePda}
              scope={WarTableScope.Castle}
              title="War Council"
              emptyText="Rally the garrison."
              open={warCouncilOpen}
              onOpenChange={setWarCouncilOpen}
              bottomClass="bottom-[calc(3.5rem+env(safe-area-inset-bottom))] md:bottom-4"
            >
              <ThreadRenderer
                threadPda={castlePda}
                scope={WarTableScope.Castle}
                gateAccounts={castleGate}
                canPost={canPostCastle}
                placeholder="write a message..."
                maxHeightClass="max-h-[70dvh]"
                composeInBar={warCouncilOpen}
              />
            </MobileTeamDock>
          )}

          {/* Court Positions — only a Keep or larger holds a court; an Outpost
              has none, so the card is hidden there entirely. Render only the
              seats this seat actually grants (maxCourt grows with Chambers). */}
          {courtSupported && (
          <div className="card">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted">
              Court Positions ({castle.courtCount ?? 0} / {castle.maxCourt ?? 0})
            </h3>
            <div className="grid gap-2 md:grid-cols-5">
              {COURT_POSITIONS.slice(0, castle.maxCourt ?? 0).map((pos, i) => {
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
                {!courtSupported ? (
                  <p className="text-xs italic text-text-muted">
                    This seat is too modest to hold a court. Raise it to a Citadel to seat advisors.
                  </p>
                ) : !courtAppointable ? (
                  <p className="text-xs italic text-text-muted">
                    The realm is unsettled. Court appointments resume once the seat is no longer
                    contested.
                  </p>
                ) : courtCandidates.length === 0 ? (
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

            {!isKing && myCourtSeat && (
              <div className="mt-4 space-y-2">
                <h4 className="text-xs font-semibold text-text-muted">Your Court Seat</h4>
                <div className="flex items-center justify-between gap-2 rounded-lg border border-zinc-800 px-3 py-2">
                  <span className="text-sm text-text-primary">
                    {COURT_POSITIONS[myCourtSeat.position] ?? `Position ${myCourtSeat.position}`}
                  </span>
                  <TxButton onClick={handleResignCourt} variant="danger">
                    Resign
                  </TxButton>
                </div>
              </div>
            )}
          </div>
          )}

          {/* Castle Upgrade (King only) */}
          {isKing && (
            <div className="card">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted">
                Castle Upgrades
              </h3>
              {/* The five stat tiles double as the picker: tap one to choose
                  what to raise. No dropdown — the grid the king already reads
                  is the control. Tiles disable when maxed, mid-upgrade, or the
                  seat is unsettled. */}
              <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
                {UPGRADE_TYPES.map((u) => {
                  const lvl = u.level(castle);
                  const maxed = lvl >= u.max;
                  const selected = upgradeType === u.value;
                  const selectable = upgradeAllowed && !hasUpgradeInProgress && !maxed;
                  return (
                    <button
                      key={u.value}
                      type="button"
                      disabled={!selectable}
                      onClick={() => setUpgradeType(u.value)}
                      className={cn(
                        "rounded-lg border px-3 py-2 text-left transition-colors",
                        selected && selectable
                          ? "border-border-gold bg-[var(--nm-accent)]/15"
                          : "border-zinc-800",
                        selectable && "hover:border-border-gold/50",
                        !selectable && "cursor-default opacity-60",
                      )}
                    >
                      <div className="text-xs text-text-muted">{u.label}</div>
                      <div className="text-sm font-semibold text-text-primary">
                        Lv {lvl}
                        {u.max < 255 && <span className="text-text-muted"> / {u.max}</span>}
                      </div>
                      {maxed && (
                        <div className="text-[10px] uppercase tracking-wider text-text-gold">
                          Maxed
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>

              {hasUpgradeInProgress ? (
                <div className="mt-4 space-y-2">
                  <div className="flex items-center justify-between rounded-lg border border-zinc-800 px-3 py-2">
                    {/* Mirrors GoldCountdown's skeleton (flex-col gap-1 ->
                        uppercase muted label -> icon + value row) so the
                        Upgrading block reads as a matched pair beside Completes. */}
                    <div className="flex flex-col gap-1">
                      <span className="text-xs uppercase tracking-wider text-zinc-500">
                        Upgrading
                      </span>
                      <div className="flex items-center gap-2">
                        <Hammer className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
                        <span className="text-sm text-text-primary">
                          {UPGRADE_TYPES.find((u) => u.value === castle.upgradeType)?.label ??
                            "Unknown"}{" "}
                          to Lv {castle.upgradeTargetLevel ?? "?"}
                        </span>
                      </div>
                    </div>
                    <GoldCountdown endsAt={upgradeEndsAt} format="full" label="Completes" />
                  </div>
                  <div className="flex gap-2">
                    <TxButton onClick={handleCancelUpgrade} variant="danger">
                      Cancel Upgrade
                    </TxButton>
                    {/* complete_upgrade.rs rejects with CastleUpgradeNotReady
                        until the timer elapses; disable until then so the
                        button never fires a tx that bounces. */}
                    <TxButton
                      onClick={handleCompleteUpgrade}
                      variant="secondary"
                      disabled={nowSec < upgradeEndsAt}
                    >
                      {nowSec < upgradeEndsAt ? "Complete" : "Complete Upgrade"}
                    </TxButton>
                  </div>
                </div>
              ) : upgradeAllowed ? (
                <div className="mt-4">
                  <TxButton onClick={handleInitiateUpgrade} disabled={selectedUpgradeMaxed}>
                    {selectedUpgradeMaxed
                      ? "Pick a stat to raise"
                      : `Upgrade ${selectedUpgrade.label}`}
                  </TxButton>
                </div>
              ) : (
                <p className="mt-4 text-xs italic text-text-muted">
                  The seat must settle before you can raise its walls. Upgrades pause while it is
                  contested or changing hands.
                </p>
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
                    Contribute to Garrison{" "}
                    <InfoButton>
                      You commit defensive units, weapons, and one hero to defend the castle. They
                      are held in the garrison, not consumed up front.
                    </InfoButton>
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
           * applies and explain when it is blocked. Hidden for the seat's own
           * ruler: you neither claim nor attack a seat you already hold. */}
          {!isKing && (
          <div className="card space-y-3">
            {castle.status === CastleStatus.Vacant ? (
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
            ) : iAmNewKing ? (
              <>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                  Transition
                </h3>
                <p className="text-xs text-text-secondary">
                  You stormed the seat. The crown does not pass at once: once the contest window
                  closes and the old garrison and court disperse, the castle is yours.
                </p>
                {nowSec < transitionSettleAt && (
                  <GoldCountdown endsAt={transitionSettleAt} format="compact" label="Settles in" />
                )}
                {nowSec >= transitionSettleAt && !transitionFinalizable && (
                  <p className="text-xs italic text-text-muted">
                    The previous garrison and court must clear before the crown can pass.
                  </p>
                )}
                <TxButton onClick={handleFinalizeTransition} disabled={!transitionFinalizable}>
                  Claim the Crown
                </TxButton>
              </>
            ) : (
              <>
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
          )}
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
                    label: (
                      <>
                        Protection{" "}
                        <InfoButton>
                          Protected = safe from attack. A new or claimed castle gets a 10-day window,
                          extended by the watchtower.
                        </InfoButton>
                      </>
                    ),
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
