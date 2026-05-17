"use client";

import { useState, useMemo, useEffect } from "react";
import { usePlayer } from "@/lib/hooks/usePlayer";
import { useTeam } from "@/lib/hooks/useTeam";
import { useEncounters } from "@/lib/hooks/useEncounters";
import { useCityPlayers } from "@/lib/hooks/useCityPlayers";
import { useLockedHeroes, NO_HERO_SLOT } from "@/lib/hooks/useLockedHeroes";
import { useTransact } from "@/lib/hooks/useTransact";
import { useNovusMundusClient } from "@/lib/solana/provider";
import { useWallet } from "@solana/wallet-adapter-react";
import { useConnection } from "@solana/wallet-adapter-react";
import { useQuery } from "@tanstack/react-query";
import { GoldNumber } from "@/components/shared/GoldNumber";
import { GoldCountdown } from "@/components/shared/GoldCountdown";
import { TxButton } from "@/components/shared/TxButton";
import type { TxPhase } from "@/components/shared/TxButton";
import { SpeedupPanel } from "@/components/shared/SpeedupPanel";
import {
  TripleCountInput,
  DEFENSIVE_UNIT_LABELS,
  WEAPON_LABELS,
} from "@/components/shared/TripleCountInput";
import { useGameEngine } from "@/lib/hooks/useGameEngine";
import { DomainName } from "@/components/shared/DomainName";
import { useRightPanelStore } from "@/lib/store/right-panel";
import { formatTime } from "@/lib/utils";
import {
  derivePlayerPda,
  deriveRallyPda,
  deriveCastlePda,
  deriveEstatePda,
  parseRally,
  isNullPubkey,
  createRallyCreateInstruction,
  createRallyCancelInstruction,
  createRallyLeaveInstruction,
  createRallyExecuteInstruction,
  createRallyProcessReturnInstruction,
  createRallyCloseInstruction,
  createRallySpeedupInstruction,
  RallySpeedupType,
  isTraveling,
  getCurrentTimeOfDay,
  getTimeOfDayName,
  getActivityMultiplier,
  type RallyAccount,
} from "novus-mundus-sdk";
import type { PublicKey } from "@solana/web3.js";

const RALLY_STATUS = ["Gathering", "Marching", "Combat", "Returning", "Completed", "Cancelled"];
const TARGET_TYPE = ["Player", "Encounter", "Castle"];

export function RallyTab() {
  const { data: playerData } = usePlayer();
  const player = playerData?.account;
  const client = useNovusMundusClient();
  const { publicKey } = useWallet();
  const { connection } = useConnection();
  const transact = useTransact();
  const showPanel = useRightPanelStore((s) => s.show);
  const { data: geData } = useGameEngine();
  const ge = geData?.account;
  const { data: cityEncounters } = useEncounters(player?.currentCity);
  const { data: cityPlayers } = useCityPlayers(player?.currentCity);
  const ownedUnits: [number, number, number] = [
    player?.defensiveUnit1?.toNumber?.() ?? 0,
    player?.defensiveUnit2?.toNumber?.() ?? 0,
    player?.defensiveUnit3?.toNumber?.() ?? 0,
  ];
  const ownedWeapons: [number, number, number] = [
    player?.meleeWeapons?.toNumber?.() ?? 0,
    player?.rangedWeapons?.toNumber?.() ?? 0,
    player?.siegeWeapons?.toNumber?.() ?? 0,
  ];

  // Locked heroes (slots 0-2); one may optionally be committed to the rally.
  const [rallyHeroSlot, setRallyHeroSlot] = useState(NO_HERO_SLOT);
  const lockedHeroes = useLockedHeroes();

  // Fetch active rally if player has one
  const rallyId = 0;
  const { data: rallyData } = useQuery({
    queryKey: ["rally", rallyId],
    queryFn: async () => {
      if (!rallyId || !publicKey) return null;
      const ge = client.gameEngine;
      const [rallyPda] = deriveRallyPda(ge, publicKey, rallyId);
      const info = await connection.getAccountInfo(rallyPda);
      if (!info) return null;
      return { pubkey: rallyPda, account: parseRally(info) };
    },
    enabled: rallyId > 0 && !!publicKey,
    staleTime: 10_000,
  });

  const rally = rallyData?.account;

  const nowSec = Math.floor(Date.now() / 1000);
  const traveling = player ? isTraveling(player) : false;
  const tod = useMemo(() => getCurrentTimeOfDay(nowSec, 0), [nowSec]);
  const todName = getTimeOfDayName(tod);
  const rallyBonus = getActivityMultiplier('attacking' as any, tod);

  const [targetType, setTargetType] = useState(1); // Encounter by default
  const [rallyUnits, setRallyUnits] = useState<[number, number, number]>([0, 0, 0]);
  const [rallyWeapons, setRallyWeapons] = useState<[number, number, number]>([0, 0, 0]);
  const [rallyTarget, setRallyTarget] = useState<{ pubkey: PublicKey; label: string } | null>(null);
  const [gatherMinutes, setGatherMinutes] = useState(15);

  // Joinable team rallies — fetched via getProgramAccounts filtered on the
  // player's team. Only gathering-phase rallies (status 0) are joinable.
  const teamPubkey = player?.team && !isNullPubkey(player.team) ? player.team : null;
  const { data: teamData } = useTeam(teamPubkey);
  const teamId = teamData?.account?.id;
  const [joinableRallies, setJoinableRallies] = useState<
    { pubkey: PublicKey; account: RallyAccount }[]
  >([]);

  useEffect(() => {
    if (!teamPubkey) {
      setJoinableRallies([]);
      return;
    }
    let cancelled = false;
    client
      .fetchActiveRallies({ team: teamPubkey, activeOnly: true })
      .then((results) => {
        if (cancelled) return;
        // Only gathering-phase rallies can be joined.
        setJoinableRallies(results.filter((r) => r.account.status === 0));
      })
      .catch(() => {
        if (!cancelled) setJoinableRallies([]);
      });
    return () => {
      cancelled = true;
    };
  }, [teamPubkey?.toBase58(), client, transact.isPending]);

  const handleCreate = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey || !player) throw new Error("Wallet not connected");
    if (!teamId) throw new Error("Team not loaded");
    if (!rallyTarget) throw new Error("Pick a rally target");
    if (rallyUnits.every((n) => n === 0) && rallyWeapons.every((n) => n === 0)) {
      throw new Error("Commit units or weapons to the rally");
    }
    const geKey = client.gameEngine;
    const hero = rallyHeroSlot < 3 ? lockedHeroes[rallyHeroSlot] : null;
    const ix = createRallyCreateInstruction(
      {
        owner: publicKey,
        gameEngine: geKey,
        rallyId: player.rallyStats.totalRalliesCreated.toNumber(),
        target: rallyTarget.pubkey,
        teamId: teamId.toNumber(),
        rallyCityId: player.currentCity,
      },
      {
        targetType,
        gatherDuration: gatherMinutes * 60,
        targetCityId: player.currentCity,
        defensiveUnit1: rallyUnits[0],
        defensiveUnit2: rallyUnits[1],
        defensiveUnit3: rallyUnits[2],
        meleeWeapons: rallyWeapons[0],
        rangedWeapons: rallyWeapons[1],
        siegeWeapons: rallyWeapons[2],
        heroSlotIndex: hero ? rallyHeroSlot : NO_HERO_SLOT,
        heroMint: hero?.mint,
        heroTemplateId: hero?.templateId,
      },
    );
    return transact.mutateAsync({
      instructions: [ix],
      invalidateKeys: [["player"], ["rally"]],
      successMessage: `Rally created against ${rallyTarget.label}!`,
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  const handleRallySpeedup = async (tier: number, reportPhase: (p: TxPhase) => void) => {
    if (!publicKey || !rallyData || !rally) throw new Error("No rally");
    const geKey = client.gameEngine;
    const speedupType = rally.status === 0 ? RallySpeedupType.Gather
      : rally.status === 1 ? RallySpeedupType.March
      : RallySpeedupType.Return;
    const ix = createRallySpeedupInstruction(
      {
        owner: publicKey,
        gameEngine: geKey,
        rally: rallyData.pubkey,
        rallyCreator: publicKey,
        rallyId,
        participant: publicKey,
      },
      { speedupType, speedupTier: tier as 1 | 2 },
    );
    return transact.mutateAsync({
      instructions: [ix],
      invalidateKeys: [["rally"], ["player"]],
      successMessage: "Rally sped up!",
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  const rallyRemaining = rally?.arriveAt
    ? Math.max(0, rally.arriveAt.toNumber() - Math.floor(Date.now() / 1000))
    : 0;

  const handleCancel = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey || !rallyData || !rally) throw new Error("No rally");
    const ge = client.gameEngine;
    const ix = createRallyCancelInstruction({
      owner: publicKey,
      gameEngine: ge,
      rally: rallyData.pubkey,
      rallyId: rally.id.toNumber(),
      rallyCityId: rally.rallyCity ?? 0,
    });
    return transact.mutateAsync({
      instructions: [ix],
      invalidateKeys: [["player"], ["rally"]],
      successMessage: "Rally cancelled.",
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  const handleLeave = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey || !rallyData || !rally) throw new Error("No rally");
    const ge = client.gameEngine;
    const ix = createRallyLeaveInstruction({
      owner: publicKey,
      gameEngine: ge,
      rally: rallyData.pubkey,
      rallyCreator: rally.creator ?? publicKey,
      rallyId,
      rallyCityId: rally.rallyCity ?? 0,
      homeCityId: player?.currentCity ?? 0,
    });
    return transact.mutateAsync({
      instructions: [ix],
      invalidateKeys: [["player"], ["rally"]],
      successMessage: "Left the rally.",
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  const handleExecute = async (reportPhase: (p: TxPhase) => void) => {
    if (!rallyData || !rally) throw new Error("No rally");
    const ge = client.gameEngine;
    // Execute is permissionless — derive leader estate from creator
    const [leaderPlayer] = derivePlayerPda(ge, rally.creator);
    const [leaderEstate] = deriveEstatePda(leaderPlayer);
    // rally_execute needs every RallyParticipant account (4 fixed + N), so
    // fetch the participant PDAs and pass them, leader first.
    const parts = await client.fetchRallyParticipants(rallyData.pubkey, rally);
    const ordered = [...parts].sort(
      (a, b) => Number(b.account.isLeader) - Number(a.account.isLeader),
    );
    const ix = createRallyExecuteInstruction({
      gameEngine: ge,
      rally: rallyData.pubkey,
      target: rally.target,
      leaderEstate,
      rallyParticipants: ordered.map((p) => p.pubkey),
    });
    return transact.mutateAsync({
      instructions: [ix],
      invalidateKeys: [["rally"], ["player"]],
      successMessage: "Rally executed!",
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  const handleProcessReturn = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey || !rallyData || !rally) throw new Error("No rally");
    const ge = client.gameEngine;
    const ix = createRallyProcessReturnInstruction({
      gameEngine: ge,
      rally: rallyData.pubkey,
      rallyCreator: rally.creator ?? publicKey,
      rallyId,
      participantOwner: publicKey,
      rallyCityId: rally.rallyCity ?? 0,
      homeCityId: player?.currentCity ?? 0,
    });
    return transact.mutateAsync({
      instructions: [ix],
      invalidateKeys: [["rally"], ["player"]],
      successMessage: "Return processed!",
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  const handleClose = async (reportPhase: (p: TxPhase) => void) => {
    if (!rallyData || !rally) throw new Error("No rally");
    const ix = createRallyCloseInstruction({
      rally: rallyData.pubkey,
      leaderOwner: rally.creator,
    });
    return transact.mutateAsync({
      instructions: [ix],
      invalidateKeys: [["rally"], ["player"]],
      successMessage: "Rally closed.",
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-xs text-text-muted">
        <span>{todName}</span>
        {rallyBonus > 1 ? (
          <span className="text-green-400">+{((rallyBonus - 1) * 100).toFixed(0)}% rally power</span>
        ) : rallyBonus < 1 ? (
          <span className="text-amber-400">{((rallyBonus - 1) * 100).toFixed(0)}% rally power</span>
        ) : null}
      </div>

      {traveling && (
        <div className="rounded-lg border border-amber-800 bg-amber-900/20 px-4 py-3 text-sm text-amber-400">
          You are currently traveling. Rally actions may be restricted.
        </div>
      )}

      {/* Active Rally */}
      {rally && (
        <div className="card accent-border">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs text-text-muted">Active Rally</div>
              <div className="text-lg font-semibold text-text-primary">
                {RALLY_STATUS[rally.status ?? 0]}
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs text-text-muted">Target</div>
              <div className="text-sm text-text-primary">
                {TARGET_TYPE[rally.targetType ?? 0]}
              </div>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-4">
            <div>
              <div className="text-xs text-text-muted">Participants</div>
              <GoldNumber value={rally.participantCount ?? 0} />
            </div>
            <div>
              <div className="text-xs text-text-muted">Total Units</div>
              <GoldNumber value={rally.totalUnits?.toNumber?.() ?? 0} />
            </div>
            <div>
              <div className="text-xs text-text-muted">Time</div>
              {rally.marchStartedAt && (
                <GoldCountdown
                  endsAt={rally.arriveAt?.toNumber?.() ?? 0}
                  startedAt={rally.marchStartedAt?.toNumber?.() ?? 0}
                  format="compact"
                  size="sm"
                />
              )}
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-3">
            {rally.status === 0 && (
              <>
                <TxButton onClick={handleCancel} variant="danger">
                  Cancel Rally
                </TxButton>
                <TxButton onClick={handleLeave} variant="secondary">
                  Leave Rally
                </TxButton>
              </>
            )}
            {rally.status <= 1 && (
              <TxButton onClick={handleExecute} variant="secondary">
                Execute Rally
              </TxButton>
            )}
            {(rally.status === 3 || rally.status === 4) && (
              <TxButton onClick={handleProcessReturn}>
                Process Return
              </TxButton>
            )}
            {rally.status === 4 && (
              <TxButton onClick={handleClose} variant="secondary">
                Close Rally
              </TxButton>
            )}
          </div>
          {/* Speedup */}
          {rally.status < 4 && (
            <SpeedupPanel
              visible={rallyRemaining > 0}
              remainingSeconds={rallyRemaining}
              onSpeedup={handleRallySpeedup}
              gemsPerMinute={ge?.gameplayConfig.gemCostPerMinuteSpeedup ?? 1}
              gemBalance={player?.gems?.toNumber?.()}
              className="mt-4"
            />
          )}
        </div>
      )}

      {/* Joinable Team Rallies */}
      <div className="card">
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted">
          Joinable Team Rallies
        </h3>
        {joinableRallies.length === 0 ? (
          <p className="text-sm text-text-muted">No team rallies are currently gathering.</p>
        ) : (
          <div className="space-y-2">
            {joinableRallies.map((r) => {
              const gatherAt = r.account.gatherAt?.toNumber?.() ?? 0;
              const joined = r.account.participantCount ?? 0;
              const max = r.account.maxParticipants ?? 0;
              const full = joined >= max;
              return (
                <button
                  key={r.pubkey.toBase58()}
                  onClick={() =>
                    showPanel("Team Rally", "rally-detail", {
                      rallyPubkey: r.pubkey.toBase58(),
                    })
                  }
                  className="flex w-full items-center justify-between gap-3 rounded-lg border border-zinc-800 px-3 py-2 text-left transition-colors hover:border-zinc-700 hover:bg-surface-raised/50"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm text-text-primary">
                        <DomainName pubkey={r.account.creator} chars={4} />
                      </span>
                      <span className="text-xs text-text-muted">
                        {TARGET_TYPE[r.account.targetType ?? 0]}
                      </span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-text-muted">
                      <span>
                        {joined}/{max} joined
                      </span>
                      {gatherAt > 0 && (
                        <>
                          <span className="text-zinc-700">·</span>
                          <span>
                            Gathers <InlineCountdown to={gatherAt} />
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                  <span className="shrink-0 rounded-md border border-zinc-700 px-3 py-1 text-xs font-medium text-text-secondary">
                    {full ? "Full" : "View"}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Create Rally */}
      {!rally && (
        <div className="card space-y-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted">
            Create Rally
          </h3>

          {/* Target type */}
          <div className="grid gap-3 md:grid-cols-3">
            {TARGET_TYPE.map((t, i) => (
              <button
                key={t}
                onClick={() => {
                  setTargetType(i);
                  setRallyTarget(null);
                }}
                className={`rounded-lg border p-3 text-center transition-all ${
                  targetType === i
                    ? "border-amber-600 bg-amber-900/20"
                    : "border-zinc-800 hover:border-zinc-700"
                }`}
              >
                <div className="text-sm font-semibold text-text-primary">{t}</div>
              </button>
            ))}
          </div>

          {/* Target picker — an actual encounter / player / castle in your city */}
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
              Target — {TARGET_TYPE[targetType]} in your city
            </div>
            <div className="mt-1 max-h-40 space-y-1 overflow-y-auto">
              {targetType === 0 &&
                ((cityPlayers ?? []).length === 0 ? (
                  <p className="text-xs text-text-muted">No players in your city.</p>
                ) : (
                  cityPlayers!.map((p) => {
                    const label = p.account.name || p.account.owner.toBase58().slice(0, 6);
                    const sel = rallyTarget?.pubkey.equals(p.pubkey) ?? false;
                    return (
                      <button
                        key={p.pubkey.toBase58()}
                        onClick={() => setRallyTarget({ pubkey: p.pubkey, label })}
                        className={`w-full rounded border px-3 py-1.5 text-left text-xs ${
                          sel
                            ? "border-amber-500 bg-amber-900/30 text-text-primary"
                            : "border-zinc-800 text-text-muted hover:border-zinc-700"
                        }`}
                      >
                        {label} · Lv {p.account.level}
                      </button>
                    );
                  })
                ))}
              {targetType === 1 &&
                ((cityEncounters ?? []).length === 0 ? (
                  <p className="text-xs text-text-muted">No encounters in your city.</p>
                ) : (
                  cityEncounters!.map((e) => {
                    const label = `Encounter #${e.account.id.toString()}`;
                    const sel = rallyTarget?.pubkey.equals(e.pubkey) ?? false;
                    return (
                      <button
                        key={e.pubkey.toBase58()}
                        onClick={() => setRallyTarget({ pubkey: e.pubkey, label })}
                        className={`w-full rounded border px-3 py-1.5 text-left text-xs ${
                          sel
                            ? "border-amber-500 bg-amber-900/30 text-text-primary"
                            : "border-zinc-800 text-text-muted hover:border-zinc-700"
                        }`}
                      >
                        {label}
                      </button>
                    );
                  })
                ))}
              {targetType === 2 &&
                [0, 1, 2].map((castleId) => {
                  const pubkey = deriveCastlePda(
                    client.gameEngine,
                    player?.currentCity ?? 0,
                    castleId,
                  )[0];
                  const label = `Castle ${castleId}`;
                  const sel = rallyTarget?.pubkey.equals(pubkey) ?? false;
                  return (
                    <button
                      key={castleId}
                      onClick={() => setRallyTarget({ pubkey, label })}
                      className={`w-full rounded border px-3 py-1.5 text-left text-xs ${
                        sel
                          ? "border-amber-500 bg-amber-900/30 text-text-primary"
                          : "border-zinc-800 text-text-muted hover:border-zinc-700"
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
            </div>
          </div>

          {/* Troops committed to the rally */}
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
              Defensive Units
            </div>
            <TripleCountInput
              labels={DEFENSIVE_UNIT_LABELS}
              available={ownedUnits}
              value={rallyUnits}
              onChange={setRallyUnits}
            />
            <div className="mt-2 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
              Weapons
            </div>
            <TripleCountInput
              labels={WEAPON_LABELS}
              available={ownedWeapons}
              value={rallyWeapons}
              onChange={setRallyWeapons}
            />
          </div>

          {/* Gather window before the rally marches */}
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
              Gather Window
            </div>
            <div className="mt-1 flex gap-2">
              {[5, 15, 60].map((m) => (
                <button
                  key={m}
                  onClick={() => setGatherMinutes(m)}
                  className={`rounded-lg border px-3 py-1.5 text-xs transition-all ${
                    gatherMinutes === m
                      ? "border-amber-600 bg-amber-900/20 text-text-primary"
                      : "border-zinc-800 text-text-muted hover:border-zinc-700"
                  }`}
                >
                  {m < 60 ? `${m}m` : "1h"}
                </button>
              ))}
            </div>
          </div>

          {/* Hero — optional, committed to the rally */}
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
              Hero
            </div>
            <select
              value={rallyHeroSlot}
              onChange={(e) => setRallyHeroSlot(Number(e.target.value))}
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
          </div>

          <TxButton
            onClick={handleCreate}
            disabled={
              traveling ||
              !rallyTarget ||
              (rallyUnits.every((n) => n === 0) && rallyWeapons.every((n) => n === 0))
            }
          >
            Create Rally
          </TxButton>
        </div>
      )}
    </div>
  );
}

/** A compact, self-ticking countdown for inline use within a row of text. */
function InlineCountdown({ to }: { to: number }) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);
  const remaining = Math.max(0, to - now);
  return (
    <span className="font-mono tabular-nums text-text-gold">
      {remaining === 0 ? "ready" : formatTime(remaining, "compact")}
    </span>
  );
}
