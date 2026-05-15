"use client";

import { useState, useMemo, useEffect } from "react";
import { usePlayer } from "@/lib/hooks/usePlayer";
import { useTeam } from "@/lib/hooks/useTeam";
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
import { useGameEngine } from "@/lib/hooks/useGameEngine";
import { DomainName } from "@/components/shared/DomainName";
import {
  derivePlayerPda,
  deriveRallyPda,
  deriveEstatePda,
  parseRally,
  isNullPubkey,
  createRallyCreateInstruction,
  createRallyCancelInstruction,
  createRallyJoinInstruction,
  createRallyLeaveInstruction,
  createRallyExecuteInstruction,
  createRallyProcessReturnInstruction,
  createRallySpeedupInstruction,
  RallySpeedupType,
  isTraveling,
  getCurrentTimeOfDay,
  getTimeOfDayName,
  getActivityMultiplier,
  getTotalDefensiveUnits,
  getTotalOperativeUnits,
  type RallyAccount,
} from "@/lib/sdk";
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
  const { data: geData } = useGameEngine();
  const ge = geData?.account;

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
  const totalDefensive = player ? getTotalDefensiveUnits(player).toNumber() : 0;
  const totalOperative = player ? getTotalOperativeUnits(player).toNumber() : 0;
  const availableUnits = totalDefensive + totalOperative;

  const [units, setUnits] = useState(10);
  const [targetType, setTargetType] = useState(1); // Encounter by default

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

  const handleJoinRally = async (
    target: { pubkey: PublicKey; account: RallyAccount },
    reportPhase: (p: TxPhase) => void,
  ) => {
    if (!publicKey) throw new Error("Wallet not connected");
    if (!teamId) throw new Error("Team not loaded");
    const geKey = client.gameEngine;
    const ix = createRallyJoinInstruction(
      {
        owner: publicKey,
        gameEngine: geKey,
        rally: target.pubkey,
        rallyCreator: target.account.creator,
        rallyId: target.account.id.toNumber(),
        teamId: teamId.toNumber(),
        rallyCityId: target.account.rallyCity ?? 0,
      },
      {
        defensiveUnit1: units,
        defensiveUnit2: 0,
        defensiveUnit3: 0,
        meleeWeapons: 0,
        rangedWeapons: 0,
        siegeWeapons: 0,
      },
    );
    return transact.mutateAsync({
      instructions: [ix],
      invalidateKeys: [["player"], ["rally"]],
      successMessage: "Joined rally!",
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  const handleCreate = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    const ge = client.gameEngine;
    const [playerPda] = derivePlayerPda(ge, publicKey);
    const ix = createRallyCreateInstruction(
      { player: playerPda, gameEngine: ge, owner: publicKey },
      { targetType, units }
    );
    return transact.mutateAsync({
      instructions: [ix],
      invalidateKeys: [["player"], ["rally"]],
      successMessage: "Rally created!",
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
    if (!publicKey || !rallyData) throw new Error("No rally");
    const ge = client.gameEngine;
    const [playerPda] = derivePlayerPda(ge, publicKey);
    const ix = createRallyCancelInstruction({
      player: playerPda,
      rally: rallyData.pubkey,
      gameEngine: ge,
      owner: publicKey,
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
    // Participant PDAs must be provided; for now empty — a crank typically supplies these
    const ix = createRallyExecuteInstruction({
      gameEngine: ge,
      rally: rallyData.pubkey,
      target: rally.target,
      leaderEstate,
      rallyParticipants: [],
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
            {joinableRallies.map((r) => (
              <div
                key={r.pubkey.toBase58()}
                className="flex items-center justify-between rounded-lg border border-zinc-800 px-3 py-2"
              >
                <div className="flex items-center gap-3">
                  <span className="font-mono text-sm text-text-primary">
                    <DomainName pubkey={r.account.creator} chars={4} />
                  </span>
                  <span className="text-xs text-text-muted">
                    {TARGET_TYPE[r.account.targetType ?? 0]}
                  </span>
                  <span className="text-xs text-text-muted">
                    {r.account.participantCount ?? 0}/{r.account.maxParticipants ?? 0}
                  </span>
                </div>
                <TxButton
                  onClick={(rp) => handleJoinRally(r, rp)}
                  variant="secondary"
                  disabled={
                    traveling ||
                    units > availableUnits ||
                    (r.account.participantCount ?? 0) >= (r.account.maxParticipants ?? 0)
                  }
                >
                  Join
                </TxButton>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create Rally */}
      {!rally && (
        <div className="card">
          <h3 className="mb-4 text-xs font-semibold uppercase tracking-wider text-text-muted">
            Create Rally
          </h3>
          <div className="mb-4 grid gap-3 md:grid-cols-3">
            {TARGET_TYPE.map((t, i) => (
              <button
                key={t}
                onClick={() => setTargetType(i)}
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
          <div className="flex items-center gap-4">
            <label className="text-sm text-text-muted">Units:
              <input
                type="number"
                value={units}
                onChange={(e) => setUnits(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-24 rounded-lg border border-zinc-800 bg-surface px-3 py-2 text-sm text-text-primary"
                min={1}
              />
            </label>
            {units > availableUnits && availableUnits > 0 && (
              <p className="text-xs text-red-400">
                Exceeds available units ({availableUnits.toLocaleString()})
              </p>
            )}
            {availableUnits === 0 && player && (
              <p className="text-xs text-text-muted">No units available — hire some first</p>
            )}
            <TxButton onClick={handleCreate} disabled={units > availableUnits || traveling}>Create Rally</TxButton>
          </div>
        </div>
      )}
    </div>
  );
}
