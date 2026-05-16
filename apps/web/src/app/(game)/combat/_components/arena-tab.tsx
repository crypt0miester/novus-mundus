"use client";

import { useMemo } from "react";
import { usePlayer } from "@/lib/hooks/usePlayer";
import { useArenaSeason, useArenaParticipant } from "@/lib/hooks/useArena";
import { useTransact } from "@/lib/hooks/useTransact";
import { useNovusMundusClient } from "@/lib/solana/provider";
import { useWallet } from "@solana/wallet-adapter-react";
import { GoldNumber } from "@/components/shared/GoldNumber";
import { GoldCountdown } from "@/components/shared/GoldCountdown";
import { TxButton } from "@/components/shared/TxButton";
import type { TxPhase } from "@/components/shared/TxButton";
import { GameInfoPanel } from "@/components/shared/GameInfoPanel";
import { InfoGrid } from "@/components/shared/InfoGrid";
import { useGameEngine } from "@/lib/hooks/useGameEngine";
import { bpsToPercent, formatTime } from "@/lib/utils";
import {
  createJoinSeasonInstruction,
  createClaimArenaDailyRewardInstruction,
  createClaimMasterRewardInstruction,
  isSeasonActive,
  ARENA_MAX_DAILY_BATTLES,
  ARENA_MIN_BATTLES_FOR_DAILY_REWARD,
} from "@/lib/sdk";
import { requestCoSign } from "@/lib/cosign";

export function ArenaTab() {
  const { data: playerData, isSuccess: playerReady } = usePlayer();
  const { data: geData } = useGameEngine();
  const player = playerData?.account;
  const currentSeasonId = 1;

  const { data: seasonData, isSuccess: seasonReady } = useArenaSeason(currentSeasonId || 0);
  const { data: participantData, isSuccess: participantReady } = useArenaParticipant(currentSeasonId || 0);
  const client = useNovusMundusClient();
  const { publicKey } = useWallet();
  const transact = useTransact();

  const season = seasonData?.account;
  const participant = participantData?.account;

  const winRate = useMemo(() => {
    if (!participant) return 0;
    const total = (participant.wins ?? 0) + (participant.losses ?? 0);
    return total > 0 ? ((participant.wins ?? 0) / total * 100) : 0;
  }, [participant]);

  const dailyBattlesUsed = useMemo(() => {
    if (!participant?.battleTimestamps) return 0;
    const startOfDay = Math.floor(Date.now() / 1000 / 86400) * 86400;
    return participant.battleTimestamps.filter(
      (ts: any) => (ts?.toNumber?.() ?? ts) >= startOfDay
    ).length;
  }, [participant]);
  const dailyBattlesRemaining = ARENA_MAX_DAILY_BATTLES - dailyBattlesUsed;

  const handleJoin = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    if (!season) throw new Error("Season not loaded yet");
    const ge = client.gameEngine;
    const ix = createJoinSeasonInstruction({
      owner: publicKey,
      gameEngine: ge,
      seasonAuthority: season.authority,
      seasonId: currentSeasonId,
    });
    return transact.mutateAsync({
      instructions: [ix],
      invalidateKeys: [["arenaParticipant"], ["arenaSeason"]],
      successMessage: "Joined the arena!",
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  const handleClaimDailyReward = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    if (!season) throw new Error("Season not loaded yet");
    const ge = client.gameEngine;
    const ix = createClaimArenaDailyRewardInstruction({
      playerOwner: publicKey,
      gameEngine: ge,
      seasonAuthority: season.authority,
      seasonId: currentSeasonId,
    });
    return transact.mutateAsync({
      instructions: [ix],
      invalidateKeys: [["arenaParticipant"], ["arenaSeason"], ["player"]],
      successMessage: "Daily reward claimed!",
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  const handleClaimMasterReward = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    if (!season) throw new Error("Season not loaded yet");
    const ge = client.gameEngine;
    const ix = createClaimMasterRewardInstruction({
      playerOwner: publicKey,
      gameEngine: ge,
      seasonAuthority: season.authority,
      seasonId: currentSeasonId,
    });
    return transact.mutateAsync({
      instructions: [ix],
      invalidateKeys: [["arenaParticipant"], ["arenaSeason"], ["player"]],
      successMessage: "Master reward claimed!",
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  const handleChallenge = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    const versionedTx = await requestCoSign("/api/cosign/arena/challenge", {
      owner: publicKey.toBase58(),
      seasonId: currentSeasonId,
    });
    return transact.mutateAsync({
      versionedTx,
      invalidateKeys: [["arenaParticipant"], ["arenaSeason"], ["player"]],
      successMessage: "Match resolved!",
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  return (
    <div className="space-y-6">
      {/* Season Info */}
      {season && (
        <div className="card accent-border">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs text-text-muted">Season {currentSeasonId}</div>
              <div className="text-lg font-semibold text-text-primary">
                {isSeasonActive(season) ? "Active" : "Ended"}
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs text-text-muted">Participants</div>
              <GoldNumber value={season.leaderboardCount ?? 0} />
            </div>
          </div>
          {season.endTime && (
            <div className="mt-2">
              <GoldCountdown
                endsAt={season.endTime?.toNumber?.() ?? 0}
                format="full"
                label="Season Ends"
              />
            </div>
          )}
        </div>
      )}

      {/* Participant Status */}
      {participant ? (
        <div className="card">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted">
            Your Standing
          </h3>
          <div className="grid grid-cols-4 gap-4">
            <div>
              <div className="text-xs text-text-muted">Rank</div>
              <div className="text-2xl font-bold text-text-gold">
                #{participant.eloRating ?? "?"}
              </div>
            </div>
            <div>
              <div className="text-xs text-text-muted">Rating</div>
              <GoldNumber value={participant.eloRating ?? 0} />
            </div>
            <div>
              <div className="text-xs text-text-muted">W / L</div>
              <div className="text-sm text-text-primary">
                <span className="text-green-400">{participant.wins ?? 0}</span>
                {" / "}
                <span className="text-red-400">{participant.losses ?? 0}</span>
              </div>
            </div>
            <div>
              <div className="text-xs text-text-muted">Win Rate</div>
              <div className={`text-sm font-semibold ${winRate >= 50 ? "text-green-400" : "text-red-400"}`}>
                {winRate.toFixed(1)}%
              </div>
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between rounded-lg border border-zinc-800 px-3 py-2">
            <span className="text-xs text-text-muted">Daily Battles</span>
            <span className={`text-sm font-semibold ${dailyBattlesRemaining > 0 ? "text-text-gold" : "text-red-400"}`}>
              {dailyBattlesUsed} / {ARENA_MAX_DAILY_BATTLES}
              {dailyBattlesRemaining <= 0 && <span className="ml-1 text-xs">(max reached)</span>}
            </span>
          </div>
          <div className="mt-4 flex flex-col items-center gap-2">
            <TxButton
              onClick={handleChallenge}
              disabled={
                dailyBattlesRemaining <= 0 ||
                (season != null && !isSeasonActive(season))
              }
            >
              Find a Match
            </TxButton>
            <p className="text-center text-[11px] text-text-muted">
              {dailyBattlesRemaining > 0
                ? "An opponent near your rating is matched and battled automatically."
                : "Daily battle limit reached — try again later."}
            </p>
          </div>
          {/* Arena Reward Buttons */}
          <div className="mt-4 flex flex-wrap justify-center gap-3">
            {dailyBattlesUsed >= ARENA_MIN_BATTLES_FOR_DAILY_REWARD && (
              <TxButton onClick={handleClaimDailyReward} variant="secondary">
                Claim Daily Reward
              </TxButton>
            )}
            {season && !isSeasonActive(season) && (
              <TxButton onClick={handleClaimMasterReward}>
                Claim Master Reward
              </TxButton>
            )}
          </div>
        </div>
      ) : (
        seasonReady && (
          <div className="card text-center">
            <p className="mb-4 text-text-secondary">
              You haven't joined this arena season yet.
            </p>
            <TxButton onClick={handleJoin}>Join Arena Season</TxButton>
          </div>
        )
      )}
      {/* Game Parameters */}
      {geData?.account && (() => {
        const ac = geData.account.arenaConfig;
        return (
          <GameInfoPanel>
            <InfoGrid items={[
              { label: "Season Duration", value: formatTime(ac.seasonDuration.toNumber(), "compact"), highlight: true },
              { label: "Melee Power", value: ac.meleeWeaponPower.toNumber().toLocaleString() },
              { label: "Ranged Power", value: ac.rangedWeaponPower.toNumber().toLocaleString() },
              { label: "Siege Power", value: ac.siegeWeaponPower.toNumber().toLocaleString() },
              { label: "Armor Power", value: ac.armorPower.toNumber().toLocaleString() },
              { label: "Starting ELO", value: ac.startingElo.toLocaleString() },
              { label: "ELO K-Factor", value: ac.eloKFactor.toString() },
              { label: "Win Points", value: ac.baseWinPoints.toNumber().toLocaleString() },
              { label: "Loss Points", value: ac.baseLossPoints.toNumber().toLocaleString() },
              { label: "Draw Points", value: ac.drawPoints.toNumber().toLocaleString() },
              { label: "Daily Battles", value: ac.maxDailyBattles.toString() },
              { label: "Underdog Bonus", value: bpsToPercent(ac.underdogBonusBps.toNumber()) },
            ]} />
          </GameInfoPanel>
        );
      })()}
    </div>
  );
}
