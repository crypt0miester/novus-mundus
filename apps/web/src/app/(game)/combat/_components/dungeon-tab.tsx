"use client";

import { useState, useMemo } from "react";
import type { PublicKey } from "@solana/web3.js";
import { usePlayer } from "@/lib/hooks/usePlayer";
import { useTransact } from "@/lib/hooks/useTransact";
import { useNovusMundusClient } from "@/lib/solana/provider";
import { useWallet } from "@solana/wallet-adapter-react";
import { useConnection } from "@solana/wallet-adapter-react";
import { useQuery } from "@tanstack/react-query";
import { GoldNumber } from "@/components/shared/GoldNumber";
import { StatBar } from "@/components/shared/StatBar";
import { TxButton } from "@/components/shared/TxButton";
import type { TxPhase } from "@/components/shared/TxButton";
import { GameInfoPanel } from "@/components/shared/GameInfoPanel";
import { InfoGrid } from "@/components/shared/InfoGrid";
import { useGameEngine } from "@/lib/hooks/useGameEngine";
import { bpsToPercent } from "@/lib/utils";
import {
  derivePlayerPda,
  deriveDungeonRunPda,
  parseDungeonRun,
  isNullPubkey,
  isTraveling,
  getEncounterStaminaCost,
  getCurrentTimeOfDay,
  getTimeOfDayName,
  getActivityMultiplier,
  ENCOUNTER_STAMINA_COSTS,
  createPurchaseStaminaInstruction,
} from "@/lib/sdk";
import type { DungeonRunAccount } from "@/lib/sdk";
// Strict instruction builders — lib/sdk's re-exports widen these param types.
import {
  createEnterDungeonInstruction,
  createFleeInstruction,
  createClaimDungeonInstruction,
  createResumeInstruction,
  DungeonStatus,
  RoomType,
} from "novus-mundus-sdk";
import { fetchCoSign, useCoSign } from "@/lib/cosign";

const DUNGEON_FLEE_PENALTY_BPS = [7000, 6000, 5000, 4000] as const;
const ROOMS: Record<RoomType, { label: string; icon: string }> = {
  [RoomType.Combat]: { label: "Combat", icon: "⚔" },
  [RoomType.Treasure]: { label: "Treasure", icon: "💰" },
  [RoomType.Camp]: { label: "Camp", icon: "⛺" },
  [RoomType.Rest]: { label: "Rest", icon: "🛏" },
  [RoomType.Trap]: { label: "Trap", icon: "⚡" },
};

export function DungeonTab() {
  const { data: playerData, isSuccess: playerReady } = usePlayer();
  const { data: geData } = useGameEngine();
  const client = useNovusMundusClient();
  const { publicKey } = useWallet();
  const { connection } = useConnection();
  const transact = useTransact();
  const { requestCoSign } = useCoSign();

  const player = playerData?.account;
  const ownerStr = publicKey?.toBase58() ?? null;

  // Fetch active dungeon run
  const { data: runData, isSuccess: runReady } = useQuery({
    queryKey: ["dungeonRun", publicKey?.toBase58()],
    queryFn: async () => {
      const ge = client.gameEngine;
      const [playerPda] = derivePlayerPda(ge, publicKey!);
      const [runPda] = deriveDungeonRunPda(playerPda);
      const info = await connection.getAccountInfo(runPda);
      if (!info) return { pubkey: runPda, account: null, exists: false };
      const parsed = parseDungeonRun(info);
      return { pubkey: runPda, account: parsed, exists: true };
    },
    enabled: !!publicKey && playerReady,
    staleTime: 5_000,
  });

  const run = runData?.account as DungeonRunAccount | null | undefined;
  const runHp = run ? run.remainingUnits.reduce((a, b) => a.add(b)).toNumber() : 0;
  const runMaxHp = run ? run.originalUnits.reduce((a, b) => a.add(b)).toNumber() : 100;
  const room = ROOMS[(run?.roomType ?? RoomType.Combat) as RoomType] ?? ROOMS[RoomType.Combat];
  const [selectedDungeon, setSelectedDungeon] = useState(0);
  const [attackCount, setAttackCount] = useState(1);

  // First locked hero — required to enter a dungeon (the hero is escrowed).
  const heroMint = useMemo<PublicKey | null>(() => {
    if (!player) return null;
    for (const h of player.activeHeroes as PublicKey[]) {
      if (!isNullPubkey(h)) return h;
    }
    return null;
  }, [player]);

  // Relic offer — fetched from the co-sign API only while awaiting a choice.
  const awaitingRelic = run?.status === DungeonStatus.AwaitingRelic;
  const { data: relicOffer } = useQuery({
    queryKey: ["dungeonRelicOffer", ownerStr, run?.currentFloor],
    queryFn: () =>
      fetchCoSign<{ relicOptions: number[]; firstRoomType: number }>(
        `/api/cosign/dungeon/choose-relic?owner=${ownerStr}`,
      ),
    enabled: !!ownerStr && awaitingRelic,
    staleTime: 30_000,
  });

  // Traveling check
  const playerTraveling = player ? isTraveling(player) : false;

  // Stamina info
  const playerStamina = player?.encounterStamina?.toNumber?.() ?? 0;
  const playerMaxStamina = player?.maxEncounterStamina?.toNumber?.() ?? 100;

  // Dungeon entry costs stamina equivalent to encounter type 0 (Common)
  const dungeonStaminaCost = useMemo(() => getEncounterStaminaCost(selectedDungeon), [selectedDungeon]);
  const hasStamina = playerStamina >= dungeonStaminaCost;

  // Per-room stamina cost (each room in a dungeon costs 1 encounter worth)
  const roomStaminaCost = useMemo(() => ENCOUNTER_STAMINA_COSTS[0] ?? 10, []);

  // attack_multi batches up to 5 attacks; each one still costs a room's stamina.
  const maxAttacks = Math.min(5, Math.floor(playerStamina / roomStaminaCost));
  const effectiveAttacks = Math.min(attackCount, Math.max(1, maxAttacks));

  // Time-of-day indicator
  const now = Math.floor(Date.now() / 1000);
  const timeOfDayInfo = useMemo(() => {
    if (!player) return null;
    const longitude = (player.currentLong ?? 0) / 10000;
    const tod = getCurrentTimeOfDay(now, longitude);
    const mult = getActivityMultiplier('loot_drop' as any, tod);
    return { name: getTimeOfDayName(tod), mult };
  }, [player, now]);

  // Flee penalty for current dungeon tier
  const fleePenaltyPercent = useMemo(() => {
    const bps = DUNGEON_FLEE_PENALTY_BPS[Math.min(selectedDungeon, 3)] ?? 7000;
    return Math.floor(bps / 100);
  }, [selectedDungeon]);

  // ── Wallet-only handlers (enter / flee / claim / resume) ──────

  const handleEnter = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    if (!heroMint) {
      throw new Error("Lock a hero in the Heroes tab before entering a dungeon");
    }
    const ix = createEnterDungeonInstruction(
      { gameEngine: client.gameEngine, owner: publicKey, heroMint },
      { templateId: selectedDungeon, firstRoomType: 0, heroSpecialization: 0 },
    );
    return transact.mutateAsync({
      instructions: [ix],
      invalidateKeys: [["dungeonRun"], ["player"]],
      successMessage: "Entered the dungeon!",
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  const handleStaminaAndEnter = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    if (!heroMint) {
      throw new Error("Lock a hero in the Heroes tab before entering a dungeon");
    }
    const staminaIx = createPurchaseStaminaInstruction(
      { owner: publicKey, gameEngine: client.gameEngine },
      { amount: 1 },
    );
    const enterIx = createEnterDungeonInstruction(
      { gameEngine: client.gameEngine, owner: publicKey, heroMint },
      { templateId: selectedDungeon, firstRoomType: 0, heroSpecialization: 0 },
    );
    return transact.mutateAsync({
      instructions: [staminaIx, enterIx],
      invalidateKeys: [["dungeonRun"], ["player"]],
      successMessage: "Bought stamina & entered the dungeon!",
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  const handleFlee = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    if (!run) throw new Error("No active dungeon run");
    const ix = createFleeInstruction({
      gameEngine: client.gameEngine,
      owner: publicKey,
      heroMint: run.heroMint,
    });
    return transact.mutateAsync({
      instructions: [ix],
      invalidateKeys: [["dungeonRun"], ["player"]],
      successMessage: "Escaped the dungeon!",
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  const handleClaim = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    if (!run) throw new Error("No active dungeon run");
    const ix = createClaimDungeonInstruction({
      gameEngine: client.gameEngine,
      owner: publicKey,
      heroMint: run.heroMint,
    });
    return transact.mutateAsync({
      instructions: [ix],
      invalidateKeys: [["dungeonRun"], ["player"]],
      successMessage: "Dungeon rewards claimed!",
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  const handleResume = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    if (!run) throw new Error("No dungeon run to resume");
    const ix = createResumeInstruction(
      { gameEngine: client.gameEngine, owner: publicKey },
      { templateId: run.dungeonId, firstRoomType: 0 },
    );
    return transact.mutateAsync({
      instructions: [ix],
      invalidateKeys: [["dungeonRun"], ["player"]],
      successMessage: "Dungeon run resumed!",
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  // ── Co-signed handlers (attack / interact / choose-relic) ─────
  // These need the off-chain game_authority signature, so they go through the
  // /api/cosign endpoints and submit via useTransact's versionedTx path.

  // One co-signed attack, or a batched attack_multi (2-5) — one roll, one tx.
  const handleAttack = async (reportPhase: (p: TxPhase) => void) => {
    if (!ownerStr) throw new Error("Wallet not connected");
    const count = effectiveAttacks;
    const versionedTx =
      count > 1
        ? await requestCoSign("/api/cosign/dungeon/attack-multi", {
            attackCount: count,
          })
        : await requestCoSign("/api/cosign/dungeon/attack");
    return transact.mutateAsync({
      versionedTx,
      invalidateKeys: [["dungeonRun"], ["player"]],
      successMessage:
        count > 1 ? `Struck ${count}× — room cleared!` : "Room cleared!",
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  const handleInteract = async (reportPhase: (p: TxPhase) => void) => {
    if (!ownerStr) throw new Error("Wallet not connected");
    const versionedTx = await requestCoSign("/api/cosign/dungeon/interact");
    return transact.mutateAsync({
      versionedTx,
      invalidateKeys: [["dungeonRun"], ["player"]],
      successMessage: "Room resolved!",
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  const handleChooseRelic = async (
    relicId: number,
    reportPhase: (p: TxPhase) => void,
  ) => {
    if (!ownerStr) throw new Error("Wallet not connected");
    const versionedTx = await requestCoSign("/api/cosign/dungeon/choose-relic", {
      relicId,
    });
    return transact.mutateAsync({
      versionedTx,
      invalidateKeys: [["dungeonRun"], ["player"]],
      successMessage: "Relic claimed — descending!",
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  // Run actions, keyed by the run's state-machine status.
  const renderActions = () => {
    if (!run) return null;
    switch (run.status) {
      case DungeonStatus.AwaitingRelic:
        return (
          <div className="card accent-border">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted">
              Choose a Relic
            </h3>
            {!relicOffer ? (
              <p className="text-sm text-text-muted">Loading relic options…</p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-3">
                {relicOffer.relicOptions.map((relicId) => (
                  <TxButton
                    key={relicId}
                    onClick={(rp) => handleChooseRelic(relicId, rp)}
                    variant="secondary"
                  >
                    {"🔮"} Relic #{relicId}
                  </TxButton>
                ))}
              </div>
            )}
          </div>
        );
      case DungeonStatus.Failed:
        return (
          <div className="flex flex-col items-center gap-2">
            <div className="text-sm text-red-400">
              This run failed. Resume from the last checkpoint?
            </div>
            <TxButton onClick={handleResume}>Resume Run</TxButton>
          </div>
        );
      case DungeonStatus.Completed:
        return (
          <div className="flex flex-col items-center gap-2">
            <div className="text-sm text-green-400">
              Dungeon complete — claim your rewards.
            </div>
            <TxButton onClick={handleClaim}>Claim Rewards</TxButton>
          </div>
        );
      case DungeonStatus.Fled:
        return (
          <div className="text-center text-sm text-text-muted">
            This run has ended.
          </div>
        );
      default:
        return (
          <>
            {/* Flee Penalty Warning */}
            <div className="rounded-lg border border-red-900/50 bg-red-950/20 p-3">
              <div className="text-xs font-semibold text-red-400">Flee Warning</div>
              <div className="mt-1 text-[11px] text-red-300/80">
                Fleeing forfeits <span className="font-semibold text-red-400">{fleePenaltyPercent}%</span> of all collected loot.
                You lose dungeon progress and all unclaimed rewards above the last checkpoint.
              </div>
            </div>

            <div className="flex flex-wrap items-start justify-center gap-3">
              {run.roomType === RoomType.Combat ? (
                <div className="flex flex-col items-center gap-2">
                  {maxAttacks > 1 && (
                    <div className="flex items-center gap-1">
                      <span className="text-[11px] text-text-muted">Strikes:</span>
                      {Array.from({ length: maxAttacks }, (_, i) => i + 1).map(
                        (n) => (
                          <button
                            key={n}
                            onClick={() => setAttackCount(n)}
                            className={`h-6 w-6 rounded text-xs transition-colors ${
                              effectiveAttacks === n
                                ? "bg-amber-600 text-white"
                                : "border border-zinc-700 text-text-muted hover:border-zinc-500"
                            }`}
                          >
                            {n}
                          </button>
                        ),
                      )}
                    </div>
                  )}
                  <TxButton
                    onClick={handleAttack}
                    className="px-6"
                    disabled={playerStamina < effectiveAttacks * roomStaminaCost}
                  >
                    {room.icon} Attack
                    {effectiveAttacks > 1 ? ` ×${effectiveAttacks}` : " Room"}
                  </TxButton>
                </div>
              ) : (
                <TxButton onClick={handleInteract} className="px-6">
                  {room.icon} Resolve Room
                </TxButton>
              )}
              <TxButton onClick={handleFlee} variant="secondary">
                Flee
              </TxButton>
              <TxButton onClick={handleClaim} variant="secondary">
                Claim &amp; Exit
              </TxButton>
            </div>
            {run.roomType === RoomType.Combat &&
              playerStamina < effectiveAttacks * roomStaminaCost && (
                <div className="text-center text-[11px] text-red-400">
                  Not enough stamina to attack ({playerStamina}/
                  {effectiveAttacks * roomStaminaCost})
                </div>
              )}
          </>
        );
    }
  };

  return (
    <div className="space-y-6">
      {/* Traveling Warning */}
      {playerTraveling && (
        <div className="rounded-lg border border-amber-800/50 bg-amber-900/20 p-3 text-sm text-amber-300">
          You are currently traveling. Complete or cancel travel before entering a dungeon.
        </div>
      )}

      {/* Stamina Display */}
      {player && !run && (
        <div className="card">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex-1 min-w-[200px]">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-text-muted">Stamina</span>
                <span className="text-xs">
                  <span className={playerStamina > 0 ? "text-green-400" : "text-red-400"}>{playerStamina}</span>
                  <span className="text-text-muted"> / {playerMaxStamina}</span>
                </span>
              </div>
              <StatBar current={playerStamina} max={playerMaxStamina} color="gold" size="sm" showValues={false} />
            </div>
            {timeOfDayInfo && (
              <div className="text-right text-[11px] text-text-muted">
                {timeOfDayInfo.name}
                {timeOfDayInfo.mult > 1 && (
                  <span className="ml-1 text-green-400">+{((timeOfDayInfo.mult - 1) * 100).toFixed(0)}% loot bonus</span>
                )}
                {timeOfDayInfo.mult < 1 && (
                  <span className="ml-1 text-red-400">{((timeOfDayInfo.mult - 1) * 100).toFixed(0)}% loot penalty</span>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* No active run */}
      {!runData?.exists && runReady && (
        <div className="card accent-border">
          <h3 className="mb-4 text-xs font-semibold uppercase tracking-wider text-text-muted">
            Select Dungeon
          </h3>
          <div className="grid gap-3 md:grid-cols-3">
            {[0, 1, 2].map((id) => {
              const cost = getEncounterStaminaCost(id);
              return (
                <button
                  key={id}
                  onClick={() => setSelectedDungeon(id)}
                  className={`rounded-lg border p-4 text-left transition-all ${
                    selectedDungeon === id
                      ? "border-amber-600 bg-amber-900/20"
                      : "border-zinc-800 hover:border-zinc-700"
                  }`}
                >
                  <div className="text-lg font-bold text-text-gold">
                    {["Crypt", "Cavern", "Abyss"][id]}
                  </div>
                  <div className="text-xs text-text-muted">
                    Difficulty: {["Normal", "Hard", "Nightmare"][id]}
                  </div>
                  <div className="mt-1 text-[11px] text-text-muted">
                    Entry cost: <span className={playerStamina >= cost ? "text-text-secondary" : "text-red-400"}>{cost} stamina</span>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Stamina cost + insufficient warning */}
          <div className="mt-3 text-center text-xs text-text-muted">
            Stamina cost: <span className={hasStamina ? "text-text-secondary" : "text-red-400"}>{dungeonStaminaCost}</span>
            {" / "}Current: <span className={hasStamina ? "text-green-400" : "text-red-400"}>{playerStamina}</span>
            {!hasStamina && <span className="ml-2 text-red-400">Insufficient stamina</span>}
          </div>
          <div className="mt-1 text-center text-[11px] text-text-muted">
            Per room: <span className="text-text-secondary">{roomStaminaCost} stamina</span>
          </div>
          {!heroMint && (
            <div className="mt-1 text-center text-[11px] text-amber-400">
              Lock a hero in the Heroes tab — a dungeon run escrows one hero.
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
            <TxButton onClick={handleEnter} className="px-8 py-3 text-lg" disabled={playerTraveling || !hasStamina || !heroMint}>
              Enter Dungeon
            </TxButton>
            <TxButton
              onClick={handleStaminaAndEnter}
              variant="secondary"
              className="text-xs"
              disabled={playerTraveling || !heroMint}
            >
              +Stamina &amp; Enter
            </TxButton>
          </div>
        </div>
      )}

      {/* Active Run */}
      {run && (
        <>
          <div className="card accent-border">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-text-primary">
                  Floor {run.currentFloor ?? 0} / 10
                </h3>
                <div className="text-xs text-text-muted">
                  Room Type: {room.icon} {room.label}
                </div>
              </div>
              <div className="text-right">
                <div className="text-xs text-text-muted">HP</div>
                <GoldNumber
                  value={runHp}
                  suffix={`/${runMaxHp}`}
                  size="sm"
                />
              </div>
            </div>
            <div className="mt-3">
              <StatBar
                current={runHp}
                max={runMaxHp}
                color="gold"
                label="HP"
              />
            </div>
            <div className="mt-2">
              <StatBar
                current={run.currentFloor ?? 0}
                max={10}
                color="gold"
                label="Progress"
                size="sm"
              />
            </div>

            {/* Stamina in active run */}
            {player && (
              <div className="mt-3 flex items-center justify-between text-[11px]">
                <div className="text-text-muted">
                  Stamina: <span className={playerStamina > 0 ? "text-green-400" : "text-red-400"}>{playerStamina}</span>
                  <span className="text-text-muted"> / {playerMaxStamina}</span>
                </div>
                {timeOfDayInfo && (
                  <div className="text-text-muted">
                    {timeOfDayInfo.name}
                    {timeOfDayInfo.mult > 1 && (
                      <span className="ml-1 text-green-400">+{((timeOfDayInfo.mult - 1) * 100).toFixed(0)}% loot</span>
                    )}
                    {timeOfDayInfo.mult < 1 && (
                      <span className="ml-1 text-red-400">{((timeOfDayInfo.mult - 1) * 100).toFixed(0)}% loot</span>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Loot Summary */}
          <div className="card">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
              Loot Collected
            </h3>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <div className="text-xs text-text-muted">Cash</div>
                <GoldNumber value={run.pendingNovi.toNumber()} prefix="$ " />
              </div>
              <div>
                <div className="text-xs text-text-muted">XP</div>
                <GoldNumber value={run.pendingXp.toNumber()} />
              </div>
              <div>
                <div className="text-xs text-text-muted">Fragments</div>
                <GoldNumber value={run.pendingGems.toNumber()} prefix="&#9671; " />
              </div>
            </div>
          </div>

          {renderActions()}
        </>
      )}
      {/* Game Parameters */}
      {geData?.account && (() => {
        const dc = geData.account.dungeonConfig;
        return (
          <GameInfoPanel>
            <InfoGrid items={[
              { label: "Resume Gem Cost", value: dc.resumeGemCost.toNumber().toLocaleString(), highlight: true },
              { label: "Unit Power T1", value: dc.unitPower[0]?.toNumber().toLocaleString() ?? "—" },
              { label: "Unit Power T2", value: dc.unitPower[1]?.toNumber().toLocaleString() ?? "—" },
              { label: "Unit Power T3", value: dc.unitPower[2]?.toNumber().toLocaleString() ?? "—" },
              { label: "Unit Health T1", value: dc.unitHealth[0]?.toNumber().toLocaleString() ?? "—" },
              { label: "Unit Health T2", value: dc.unitHealth[1]?.toNumber().toLocaleString() ?? "—" },
              { label: "Unit Health T3", value: dc.unitHealth[2]?.toNumber().toLocaleString() ?? "—" },
              { label: "Treasure Loot Mult", value: bpsToPercent(dc.treasureLootMultiplierBps) },
              { label: "Trap XP Bonus", value: bpsToPercent(dc.trapXpBonusBps) },
              { label: "Rest Heal", value: `${dc.restHealPercent}%` },
              { label: "Darkness Dmg/Floor", value: bpsToPercent(dc.darknessDamagePenaltyPerFloorBps) },
              { label: "Flee Penalty F1", value: bpsToPercent(dc.fleePenaltyBps[0] ?? 0) },
              { label: "Flee Penalty F2", value: bpsToPercent(dc.fleePenaltyBps[1] ?? 0) },
              { label: "Flee Penalty F3", value: bpsToPercent(dc.fleePenaltyBps[2] ?? 0) },
            ]} />
          </GameInfoPanel>
        );
      })()}
    </div>
  );
}
