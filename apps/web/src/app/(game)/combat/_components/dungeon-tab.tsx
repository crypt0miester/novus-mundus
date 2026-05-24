"use client";

import { useState, useMemo, useEffect } from "react";
import type { PublicKey } from "@solana/web3.js";
import { usePlayer } from "@/lib/hooks/usePlayer";
import { useTransact } from "@/lib/hooks/useTransact";
import { useNovusMundusClient } from "@/lib/solana/provider";
import { useWallet } from "@solana/wallet-adapter-react";
import { useConnection } from "@solana/wallet-adapter-react";
import { useQuery } from "@tanstack/react-query";
import { StatBar } from "@/components/shared/StatBar";
import { TxButton } from "@/components/shared/TxButton";
import type { TxPhase } from "@/components/shared/TxButton";
import { GameInfoPanel } from "@/components/shared/GameInfoPanel";
import { InfoGrid } from "@/components/shared/InfoGrid";
import { useGameEngine } from "@/lib/hooks/useGameEngine";
import { useChainNow } from "@/lib/hooks/useChainTime";
import { bpsToPercent } from "@/lib/utils";
import {
  derivePlayerPda,
  deriveDungeonRunPda,
  parseDungeonRun,
  isTraveling,
  getCurrentTimeOfDay,
  getTimeOfDayName,
  getActivityMultiplier,
  ENCOUNTER_STAMINA_COSTS,
  HeroSpecialization,
  DungeonStatus,
} from "novus-mundus-sdk";
import type { DungeonRunAccount } from "novus-mundus-sdk";
import { useCoSign } from "@/lib/cosign";
import { useUnlockedHeroes } from "@/lib/hooks/useUnlockedHeroes";
import { useDungeonHeroStore } from "@/lib/store/dungeon-hero";
import { useRightPanelStore } from "@/lib/store/right-panel";
import { useDungeonTemplate } from "@/lib/hooks/useDungeonTemplate";
import { useDungeonTemplates } from "@/lib/hooks/useDungeonTemplates";
import { THEMES } from "@/lib/dungeon-lore";
import { RunView } from "./dungeon/RunView";

// Hero specialization is chosen per run — it drives the run's combat bonuses
// on-chain (see HeroSpecialization in the program). No hero NFT carries it.
const SPECS: { id: HeroSpecialization; label: string; perk: string }[] = [
  { id: HeroSpecialization.Warrior, label: "Warrior", perk: "+20% attack" },
  { id: HeroSpecialization.Guardian, label: "Guardian", perk: "+25% unit survival" },
  { id: HeroSpecialization.Scout, label: "Scout", perk: "+15% loot · −25% darkness" },
  { id: HeroSpecialization.Tactician, label: "Tactician", perk: "+30% relic power" },
];

export function DungeonTab() {
  const { data: playerData, isSuccess: playerReady } = usePlayer();
  const { data: geData } = useGameEngine();
  const client = useNovusMundusClient();
  const { publicKey } = useWallet();
  const { connection } = useConnection();
  const transact = useTransact();
  const { requestCoSign } = useCoSign();

  const player = playerData?.account;

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
    staleTime: 2_000,
    // A run advances room-by-room; poll so the UI self-heals if a post-action
    // refetch raced the RPC and cached a stale room state.
    refetchInterval: (query) => (query.state.data?.exists ? 4_000 : false),
  });

  const run = runData?.account as DungeonRunAccount | null | undefined;
  const { data: template } = useDungeonTemplate(run?.dungeonId);

  const [selectedDungeon, setSelectedDungeon] = useState(0);
  const [heroSpec, setHeroSpec] = useState<HeroSpecialization>(HeroSpecialization.Warrior);
  // Every dungeon that exists on-chain — drives the selector. Names, floors,
  // entry cost and the level gate all come from the template; nothing here is
  // hardcoded.
  const { data: dungeons } = useDungeonTemplates();
  const selectedTemplate = dungeons?.find((d) => d.id === selectedDungeon)?.template;

  // Snap the selection to a real dungeon once the list loads.
  useEffect(() => {
    if (!dungeons || dungeons.length === 0) return;
    if (!dungeons.some((d) => d.id === selectedDungeon)) {
      setSelectedDungeon(dungeons[0].id);
    }
  }, [dungeons, selectedDungeon]);

  // A dungeon run escrows a wallet-held hero for its duration, so the
  // champion is drawn from the player's unlocked (wallet-owned) heroes. The
  // pick comes from the DungeonHeroPanel; it falls back to the first owned
  // hero, and to that too if the chosen hero is no longer held.
  const unlockedHeroes = useUnlockedHeroes();
  const selectedMint = useDungeonHeroStore((s) => s.selectedMint);
  const showPanel = useRightPanelStore((s) => s.show);
  const champion =
    unlockedHeroes.find((h) => h.mint.toBase58() === selectedMint) ?? unlockedHeroes[0] ?? null;
  const heroMint: PublicKey | null = champion?.mint ?? null;

  // A finished run's recap + claim live in the DungeonClaimPanel (RightPanel).
  const runEnded =
    !!run &&
    (run.status === DungeonStatus.Completed ||
      run.status === DungeonStatus.Failed ||
      run.status === DungeonStatus.Fled);
  const runEndedTitle = run?.status === DungeonStatus.Completed ? "Dungeon Cleared" : "Run Ended";

  useEffect(() => {
    if (runEnded) showPanel(runEndedTitle, "dungeon-claim");
  }, [runEnded, runEndedTitle, showPanel]);

  // Traveling check
  const playerTraveling = player ? isTraveling(player) : false;

  // Stamina info
  const playerStamina = player?.encounterStamina?.toNumber?.() ?? 0;
  const playerMaxStamina = player?.maxEncounterStamina?.toNumber?.() ?? 100;

  // Entry cost comes straight off the chosen dungeon's template.
  const dungeonStaminaCost = selectedTemplate?.staminaCost ?? 0;
  const hasStamina = playerStamina >= dungeonStaminaCost;

  // The selected dungeon's minimum player level — entry is rejected on-chain
  // (InsufficientLevel) below it, so gate the button and say so up front.
  const minLevel = selectedTemplate?.minPlayerLevel ?? 0;
  const meetsLevel = !player || player.level >= minLevel;

  // Per-room stamina cost (each room in a dungeon costs 1 encounter worth)
  const roomStaminaCost = useMemo(() => ENCOUNTER_STAMINA_COSTS[0] ?? 10, []);

  // Time-of-day indicator — chain-anchored so the previewed loot multiplier
  // matches what the program computes from `Clock::unix_timestamp`.
  const now = useChainNow();
  const timeOfDayInfo = useMemo(() => {
    if (!player) return null;
    // `PlayerCore.currentLong` is f64 degrees (`state/player.rs:104`), NOT
    // the ×10000 grid form. Pass straight through.
    const longitude = player.currentLong ?? 0;
    const tod = getCurrentTimeOfDay(now, longitude);
    const mult = getActivityMultiplier("loot_drop" as any, tod);
    return { name: getTimeOfDayName(tod), mult };
  }, [player, now]);

  const handleEnter = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    if (!heroMint) {
      throw new Error("Mint or unlock a hero in the Heroes tab first");
    }
    // The program rejects an entry that is not game_authority-co-signed.
    const versionedTx = await requestCoSign("/api/cosign/dungeon/enter", {
      dungeonId: selectedDungeon,
      heroMint: heroMint.toBase58(),
      heroSpecialization: heroSpec,
    });
    return transact
      .mutateAsync({
        versionedTx,
        invalidateKeys: [["dungeonRun"], ["player"]],
        successMessage: "Entered the dungeon!",
        onPhase: reportPhase,
      })
      .then((r) => r.signature);
  };

  const handleStaminaAndEnter = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    if (!heroMint) {
      throw new Error("Mint or unlock a hero in the Heroes tab first");
    }
    // buyStamina bundles a stamina top-up into the same co-signed entry tx.
    const versionedTx = await requestCoSign("/api/cosign/dungeon/enter", {
      dungeonId: selectedDungeon,
      heroMint: heroMint.toBase58(),
      heroSpecialization: heroSpec,
      buyStamina: true,
    });
    return transact
      .mutateAsync({
        versionedTx,
        invalidateKeys: [["dungeonRun"], ["player"]],
        successMessage: "Bought stamina & entered the dungeon!",
        onPhase: reportPhase,
      })
      .then((r) => r.signature);
  };

  return (
    <div className="space-y-6">
      {/* Traveling Warning */}
      {playerTraveling && (
        <div className="rounded-lg border border-border-gold/50 bg-accent/20 p-3 text-sm text-danger">
          You are currently traveling. Complete or cancel travel before entering a dungeon.
        </div>
      )}

      {/* Stamina Display — outside a run, or once one has ended */}
      {player && (!run || runEnded) && (
        <div className="card">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex-1 min-w-[200px]">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                  Stamina
                </span>
                <span className="text-xs">
                  <span className={playerStamina > 0 ? "text-green-400" : "text-red-400"}>
                    {playerStamina}
                  </span>
                  <span className="text-text-muted"> / {playerMaxStamina}</span>
                </span>
              </div>
              <StatBar
                current={playerStamina}
                max={playerMaxStamina}
                color="gold"
                size="sm"
                showValues={false}
              />
            </div>
            {timeOfDayInfo && (
              <div className="text-right text-[11px] text-text-muted">
                {timeOfDayInfo.name}
                {timeOfDayInfo.mult > 1 && (
                  <span className="ml-1 text-green-400">
                    +{((timeOfDayInfo.mult - 1) * 100).toFixed(0)}% loot bonus
                  </span>
                )}
                {timeOfDayInfo.mult < 1 && (
                  <span className="ml-1 text-red-400">
                    {((timeOfDayInfo.mult - 1) * 100).toFixed(0)}% loot penalty
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* No active run (or one just ended) — pick a dungeon and enter */}
      {(!runData?.exists || runEnded) && runReady && (
        <div className="card accent-border">
          <h3 className="mb-4 text-xs font-semibold uppercase tracking-wider text-text-muted">
            Select Dungeon
          </h3>
          {!dungeons ? (
            <p className="text-sm text-text-muted">Loading dungeons…</p>
          ) : dungeons.length === 0 ? (
            <p className="text-sm text-text-muted">No dungeons available.</p>
          ) : (
            <div className="grid gap-3 md:grid-cols-3">
              {dungeons.map(({ id, template: t }) => {
                const affordable = playerStamina >= t.staminaCost;
                const levelOk = !player || player.level >= t.minPlayerLevel;
                return (
                  <button
                    key={id}
                    onClick={() => setSelectedDungeon(id)}
                    className={`rounded-lg border p-4 text-left transition-all ${
                      selectedDungeon === id
                        ? "border-border-gold bg-accent/20"
                        : "border-zinc-800 hover:border-zinc-700"
                    }`}
                  >
                    <div className="text-lg font-bold text-text-gold">{t.name}</div>
                    <div className="text-xs text-text-muted">
                      {THEMES[t.theme]?.name ?? `Theme ${t.theme}`}
                    </div>
                    <div className="mt-1 text-[11px] text-text-muted">
                      {t.totalFloors} floors · {t.roomsPerFloor} rooms each
                    </div>
                    <div className="text-[11px] text-text-muted">
                      Entry:{" "}
                      <span className={affordable ? "text-text-secondary" : "text-red-400"}>
                        {t.staminaCost} stamina
                      </span>
                    </div>
                    {t.minPlayerLevel > 0 && (
                      <div className="text-[11px] text-text-muted">
                        Requires{" "}
                        <span className={levelOk ? "text-text-secondary" : "text-red-400"}>
                          level {t.minPlayerLevel}
                        </span>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {/* Stamina cost + insufficient warning */}
          <div className="mt-3 text-center text-xs text-text-muted">
            Stamina cost:{" "}
            <span className={hasStamina ? "text-text-secondary" : "text-red-400"}>
              {dungeonStaminaCost}
            </span>
            {" / "}Current:{" "}
            <span className={hasStamina ? "text-green-400" : "text-red-400"}>{playerStamina}</span>
            {!hasStamina && <span className="ml-2 text-red-400">Insufficient stamina</span>}
          </div>
          <div className="mt-1 text-center text-[11px] text-text-muted">
            Per room: <span className="text-text-secondary">{roomStaminaCost} stamina</span>
          </div>
          {minLevel > 0 && (
            <div className="mt-1 text-center text-[11px]">
              <span className="text-text-muted">Requires level </span>
              <span className={meetsLevel ? "text-text-secondary" : "text-red-400"}>
                {minLevel}
              </span>
              {!meetsLevel && (
                <span className="ml-1 text-red-400">— you are level {player?.level ?? 0}</span>
              )}
            </div>
          )}
          {champion ? (
            <div className="mt-1 flex items-center justify-center gap-2 text-[11px] text-text-muted">
              <span>
                Champion: <span className="text-text-secondary">{champion.name}</span> — escrowed
                for the run
              </span>
              {unlockedHeroes.length > 1 && (
                <button
                  onClick={() => showPanel("Choose Champion", "dungeon-hero")}
                  className="rounded border border-zinc-700 px-1.5 py-0.5 text-text-muted transition-colors hover:text-text-secondary"
                >
                  Change
                </button>
              )}
            </div>
          ) : (
            <div className="mt-1 text-center text-[11px] text-danger">
              No hero available — mint or unlock one in the Heroes tab. A dungeon run escrows a
              wallet-held hero.
            </div>
          )}

          {/* Hero specialization — chosen per run, locked in for its duration */}
          <div className="mt-4">
            <div className="mb-2 text-center text-xs font-semibold uppercase tracking-wider text-text-muted">
              Hero Specialization
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {SPECS.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setHeroSpec(s.id)}
                  className={`rounded-lg border p-2 text-left transition-all ${
                    heroSpec === s.id
                      ? "border-border-gold bg-accent/20"
                      : "border-zinc-800 hover:border-zinc-700"
                  }`}
                >
                  <div className="text-sm font-semibold text-text-primary">{s.label}</div>
                  <div className="text-[10px] text-text-muted">{s.perk}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
            {runEnded ? (
              // A finished run must be claimed (it owns the run PDA) before a
              // new one can start — this reopens the recap/claim panel.
              <button
                type="button"
                onClick={() => showPanel(runEndedTitle, "dungeon-claim")}
                className="rounded-md border border-border-gold px-8 py-3 text-lg font-semibold text-text-gold transition-colors hover:bg-surface-overlay"
              >
                Claim Last Run First
              </button>
            ) : (
              <>
                <TxButton
                  onClick={handleEnter}
                  className="px-8 py-3 text-lg"
                  disabled={playerTraveling || !hasStamina || !heroMint || !meetsLevel}
                >
                  Enter Dungeon
                </TxButton>
                <TxButton
                  onClick={handleStaminaAndEnter}
                  variant="secondary"
                  className="text-xs"
                  disabled={playerTraveling || !heroMint || !meetsLevel}
                >
                  +Stamina &amp; Enter
                </TxButton>
              </>
            )}
          </div>
        </div>
      )}

      {/* Active run — the full run experience. A finished run falls back to
          the entry screen above; its recap + claim live in the RightPanel. */}
      {run && !runEnded && (
        <RunView
          run={run}
          template={template ?? null}
          playerStamina={playerStamina}
          playerMaxStamina={playerMaxStamina}
        />
      )}

      {/* Game Parameters */}
      {geData?.account &&
        (() => {
          const dc = geData.account.dungeonConfig;
          return (
            <GameInfoPanel>
              <InfoGrid
                items={[
                  {
                    label: "Resume Gem Cost",
                    value: dc.resumeGemCost.toNumber().toLocaleString(),
                    highlight: true,
                  },
                  {
                    label: "Unit Power T1",
                    value: dc.unitPower[0]?.toNumber().toLocaleString() ?? "—",
                  },
                  {
                    label: "Unit Power T2",
                    value: dc.unitPower[1]?.toNumber().toLocaleString() ?? "—",
                  },
                  {
                    label: "Unit Power T3",
                    value: dc.unitPower[2]?.toNumber().toLocaleString() ?? "—",
                  },
                  {
                    label: "Unit Health T1",
                    value: dc.unitHealth[0]?.toNumber().toLocaleString() ?? "—",
                  },
                  {
                    label: "Unit Health T2",
                    value: dc.unitHealth[1]?.toNumber().toLocaleString() ?? "—",
                  },
                  {
                    label: "Unit Health T3",
                    value: dc.unitHealth[2]?.toNumber().toLocaleString() ?? "—",
                  },
                  {
                    label: "Treasure Loot Mult",
                    value: bpsToPercent(dc.treasureLootMultiplierBps),
                  },
                  { label: "Trap XP Bonus", value: bpsToPercent(dc.trapXpBonusBps) },
                  { label: "Rest Heal", value: `${dc.restHealPercent}%` },
                  {
                    label: "Darkness Dmg/Floor",
                    value: bpsToPercent(dc.darknessDamagePenaltyPerFloorBps),
                  },
                  { label: "Flee Penalty F1", value: bpsToPercent(dc.fleePenaltyBps[0] ?? 0) },
                  { label: "Flee Penalty F2", value: bpsToPercent(dc.fleePenaltyBps[1] ?? 0) },
                  { label: "Flee Penalty F3", value: bpsToPercent(dc.fleePenaltyBps[2] ?? 0) },
                ]}
              />
            </GameInfoPanel>
          );
        })()}
    </div>
  );
}
