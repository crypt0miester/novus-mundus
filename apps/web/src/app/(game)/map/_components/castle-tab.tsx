"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { usePlayer } from "@/lib/hooks/usePlayer";
import { useCastle } from "@/lib/hooks/useCastle";
import { useTeamMembers } from "@/lib/hooks/useTeamMembers";
import { useLockedHeroes, NO_HERO_SLOT } from "@/lib/hooks/useLockedHeroes";
import { useTransact } from "@/lib/hooks/useTransact";
import { useNovusMundusClient } from "@/lib/solana/provider";
import { systemFraming } from "@/lib/narrative";
import { useWallet } from "@solana/wallet-adapter-react";
import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
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
  deriveCourtPda,
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
  createAttackCastleInstruction,
  parseCourtPosition,
  parseGarrisonContribution,
  parsePlayer,
  AccountKey,
  PROGRAM_ID as NOVUS_PROGRAM_ID,
  type CourtPositionAccount,
  type GarrisonContributionAccount,
} from "novus-mundus-sdk";
import bs58 from "bs58";

const CASTLE_TIERS = ["Outpost", "Keep", "Stronghold", "Fortress", "Citadel"];
const CASTLE_STATUS = ["Vacant", "Contest", "Protected", "Vulnerable", "Transitioning"];
const COURT_POSITIONS = ["Advisor", "Scholar", "Guardian", "Treasurer", "Marshal"];

// The condition of the seat, told as a line rather than a status word.
const CASTLE_STATUS_NARRATION: Record<number, string> = {
  0: "The seat stands empty. A banner could be planted here today.",
  1: "The seat is contested — blades are already in the field for it.",
  2: "The seat is held and under protection. No one may move against it yet.",
  3: "The seat is held, but its protection has lapsed. It can be taken.",
  4: "The seat is changing hands. Wait for the dust to settle.",
};

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
  const router = useRouter();
  const pathname = usePathname();
  const cityId = useMemo(() => {
    const raw = searchParams.get("cityId");
    if (raw != null) {
      const n = Number(raw);
      if (Number.isInteger(n) && n >= 0) return n;
    }
    return player?.currentCity ?? 0;
  }, [searchParams, player?.currentCity]);
  const castleId = useMemo(() => {
    const raw = searchParams.get("castleId");
    if (raw == null) return 0;
    const n = Number(raw);
    return Number.isInteger(n) && n >= 0 ? n : 0;
  }, [searchParams]);
  const setCastleId = useCallback(
    (id: number) => {
      const params = new URLSearchParams(searchParams.toString());
      if (id === 0) params.delete("castleId");
      else params.set("castleId", String(id));
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [searchParams, router, pathname],
  );
  const { data: castleData } = useCastle(cityId, castleId);
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
    player?.defensiveUnit1?.toNumber?.() ?? 0,
    player?.defensiveUnit2?.toNumber?.() ?? 0,
    player?.defensiveUnit3?.toNumber?.() ?? 0,
  ];
  const availWeapons: [number, number, number] = [
    player?.meleeWeapons?.toNumber?.() ?? 0,
    player?.rangedWeapons?.toNumber?.() ?? 0,
    player?.siegeWeapons?.toNumber?.() ?? 0,
  ];

  // The player's locked heroes (slots 0-2); one may optionally join the garrison.
  const lockedHeroes = useLockedHeroes();

  // The king's House — the court is drawn from its sworn members.
  const houseKey =
    player?.team && player.team.toBase58() !== "11111111111111111111111111111111"
      ? player.team
      : null;
  const { data: houseMembers } = useTeamMembers(houseKey);

  // Court roster — court positions are enumerable: 5 fixed slots per castle.
  // Each entry carries the holder's player PDA + resolved owner wallet.
  const [courtRoster, setCourtRoster] = useState<
    { position: number; account: CourtPositionAccount; ownerWallet: PublicKey | null }[]
  >([]);
  // Garrison roster — fetched via getProgramAccounts filtered on the castle pubkey.
  const [garrisonRoster, setGarrisonRoster] = useState<
    { account: GarrisonContributionAccount; ownerWallet: PublicKey | null }[]
  >([]);
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

  // Fetch court roster: derive all 5 court PDAs, fetch + parse, resolve holder wallets.
  useEffect(() => {
    if (!castlePda) {
      setCourtRoster([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const courtPdas = [0, 1, 2, 3, 4].map((i) => deriveCourtPda(castlePda, i)[0]);
      const infos = await connection.getMultipleAccountsInfo(courtPdas);
      const occupied: { position: number; account: CourtPositionAccount }[] = [];
      for (let i = 0; i < infos.length; i++) {
        const info = infos[i];
        if (!info) continue;
        const parsed = parseCourtPosition(info);
        if (parsed) occupied.push({ position: i, account: parsed });
      }
      const wallets = await resolveWallets(occupied.map((c) => c.account.holder));
      if (cancelled) return;
      setCourtRoster(
        occupied.map((c) => ({
          position: c.position,
          account: c.account,
          ownerWallet: wallets.get(c.account.holder.toBase58()) ?? null,
        })),
      );
    })().catch(() => {
      if (!cancelled) setCourtRoster([]);
    });
    return () => {
      cancelled = true;
    };
  }, [castlePda?.toBase58(), connection, transact.isPending]);

  // Fetch garrison roster via getProgramAccounts filtered on castle pubkey.
  useEffect(() => {
    if (!castlePda) {
      setGarrisonRoster([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const keyByte = bs58.encode(Buffer.from([AccountKey.CastleGarrison]));
      const accounts = await connection.getProgramAccounts(NOVUS_PROGRAM_ID, {
        filters: [
          { memcmp: { offset: 0, bytes: keyByte } },
          // castle pubkey is the first field after the 1-byte account_key
          { memcmp: { offset: 1, bytes: castlePda.toBase58() } },
        ],
      });
      const parsedList: GarrisonContributionAccount[] = [];
      for (const { account } of accounts) {
        const parsed = parseGarrisonContribution(account);
        if (parsed) parsedList.push(parsed);
      }
      const wallets = await resolveWallets(parsedList.map((g) => g.contributor));
      if (cancelled) return;
      setGarrisonRoster(
        parsedList.map((g) => ({
          account: g,
          ownerWallet: wallets.get(g.contributor.toBase58()) ?? null,
        })),
      );
    })().catch(() => {
      if (!cancelled) setGarrisonRoster([]);
    });
    return () => {
      cancelled = true;
    };
  }, [castlePda?.toBase58(), connection, transact.isPending]);

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

  // Check team prerequisite
  const teamKey = player?.team;
  const hasTeam = !!teamKey && teamKey.toBase58() !== "11111111111111111111111111111111";

  const handleClaimVacant = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    const ge = client.gameEngine;
    const ix = createClaimVacantCastleInstruction({
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
    const ix = createJoinGarrisonInstruction(
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
          : `Joined garrison with ${garrisonUnits.reduce((a, b) => a + b, 0).toLocaleString()} units!`,
        onPhase: reportPhase,
      })
      .then((r) => r.signature);
  };

  const handleLeaveGarrison = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    const ge = client.gameEngine;
    const ix = createLeaveGarrisonInstruction({
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
    const ix = createAppointCourtInstruction(
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
    const ix = createDismissCourtInstruction(
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
    const ix = createResignCourtInstruction(
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
    const ix = createInitiateUpgradeInstruction(
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
    const ix = createCancelUpgradeInstruction({
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
    const ix = createCompleteUpgradeInstruction({
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
    const ix = createRelieveGarrisonInstruction({
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
    const ix = createClaimGarrisonLootInstruction({
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
    const ix = createAttackCastleInstruction(
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
        <div className="flex flex-1 gap-1 rounded-lg bg-surface p-1">
          {[0, 1, 2].map((id) => (
            <button
              key={id}
              onClick={() => setCastleId(id)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                castleId === id
                  ? "bg-surface-raised text-text-gold"
                  : "text-text-muted hover:text-text-secondary"
              }`}
            >
              Castle {id}
            </button>
          ))}
        </div>
        {castlePda && castle && (
          <button
            type="button"
            onClick={() => {
              /* Map-tab's deep-link consumer (map-tab.tsx ~237)
               * early-exits unless `?city=` is present, and it only
               * pans/selects when `?lat=` AND `?long=` are ALSO set.
               * Send all four so the round-trip actually focuses the
               * camera and pops the EntityPanel on the right castle.
               * CastleAccount.latitude / longitude are i32 grid units
               * (degrees * 10000); the URL contract expects decimal
               * degrees so we divide before pushing. */
              const params = new URLSearchParams(searchParams.toString());
              params.delete("tab");
              params.delete("castleId");
              params.delete("cityId");
              params.set("city", String(castle.cityId));
              params.set("lat", String(castle.latitude / 10000));
              params.set("long", String(castle.longitude / 10000));
              params.set("castle", castlePda.toBase58());
              router.replace(`${pathname}?${params.toString()}`, {
                scroll: false,
              });
            }}
            className="rounded-md border border-border-default bg-surface px-3 py-1.5 text-xs font-medium text-text-secondary hover:text-text-gold"
          >
            Locate
          </button>
        )}
      </div>

      {/* Castle Info */}
      {castle ? (
        <>
          <div className="card accent-border">
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <div>
                <div className="text-xs text-text-muted">Tier</div>
                <div className="text-sm font-semibold text-text-gold">
                  {CASTLE_TIERS[castle.tier ?? 0]}
                </div>
              </div>
              <div>
                <div className="text-xs text-text-muted">Status</div>
                <div className="text-sm font-semibold text-text-primary">
                  {CASTLE_STATUS[castle.status ?? 0]}
                </div>
              </div>
              <div>
                <div className="text-xs text-text-muted">Garrison</div>
                <GoldNumber value={castle.garrisonCount ?? 0} size="sm" />
              </div>
              <div>
                <div className="text-xs text-text-muted">Total Rewards</div>
                <GoldNumber
                  value={castle.totalRewardsDistributed?.toNumber?.() ?? 0}
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
                    {isKing && member && member.ownerWallet && (
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
                      endsAt={castle.upgradeEndAt?.toNumber?.() ?? 0}
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

          {/* Garrison Actions */}
          <div className="card">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted">
              Garrison Actions
            </h3>
            {/* Contribute units & weapons to the castle garrison */}
            <div className="rounded-lg border border-zinc-800 p-3">
              <h4 className="mb-2 text-xs font-semibold text-text-muted">Contribute to Garrison</h4>
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
              <TxButton
                onClick={handleJoinGarrison}
                variant="secondary"
                className="mt-3 w-full"
                disabled={
                  garrisonUnits.every((n) => n === 0) && garrisonWeapons.every((n) => n === 0)
                }
              >
                Join Garrison
              </TxButton>
            </div>

            <div className="mt-3 flex flex-wrap gap-3">
              <TxButton onClick={handleLeaveGarrison} variant="danger">
                Leave Garrison
              </TxButton>
              <TxButton onClick={handleClaimGarrisonLoot} variant="secondary">
                Claim Garrison Loot
              </TxButton>
            </div>

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
                      (g.account.du1?.toNumber?.() ?? 0) +
                      (g.account.du2?.toNumber?.() ?? 0) +
                      (g.account.du3?.toNumber?.() ?? 0);
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

          {/* Actions */}
          <div className="flex flex-wrap gap-3">
            {castle.status === 0 && <TxButton onClick={handleClaimVacant}>Claim Castle</TxButton>}
            <div className="flex items-center gap-2">
              <TxButton onClick={handleAttackCastle} variant="danger">
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
                    value: cc.kingNoviPerDay.toNumber().toLocaleString(),
                    highlight: true,
                  },
                  { label: "King Cash/Day", value: cc.kingCashPerDay.toNumber().toLocaleString() },
                  {
                    label: "Court NOVI/Day",
                    value: cc.courtNoviPerDay.toNumber().toLocaleString(),
                  },
                  {
                    label: "Court Cash/Day",
                    value: cc.courtCashPerDay.toNumber().toLocaleString(),
                  },
                  {
                    label: "Member NOVI/Day",
                    value: cc.memberNoviPerDay.toNumber().toLocaleString(),
                  },
                  {
                    label: "Member Cash/Day",
                    value: cc.memberCashPerDay.toNumber().toLocaleString(),
                  },
                  { label: "King Loot Cut", value: bpsToPercent(cc.kingLootCutBps) },
                  {
                    label: "Protection",
                    value: formatTime(cc.protectionDuration.toNumber(), "compact"),
                  },
                  { label: "Garrison T0", value: cc.garrisonCapByTier[0]?.toString() ?? "—" },
                  { label: "Garrison T1", value: cc.garrisonCapByTier[1]?.toString() ?? "—" },
                  { label: "Garrison T2", value: cc.garrisonCapByTier[2]?.toString() ?? "—" },
                  { label: "Max Fortification", value: cc.maxFortificationLevel.toString() },
                ]}
              />
            </GameInfoPanel>
          );
        })()}
    </div>
  );
}
