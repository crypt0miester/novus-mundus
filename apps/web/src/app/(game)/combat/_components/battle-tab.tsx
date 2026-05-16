"use client";

import { useState, useMemo, useEffect } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { usePlayer } from "@/lib/hooks/usePlayer";
import { useGameEngine } from "@/lib/hooks/useGameEngine";
import { useEncounters } from "@/lib/hooks/useEncounters";
import { useCityPlayers } from "@/lib/hooks/useCityPlayers";
import { useCombatPower } from "@/lib/hooks/useDerived";
import { useTransact } from "@/lib/hooks/useTransact";
import { useNovusMundusClient } from "@/lib/solana/provider";
import { useWallet } from "@solana/wallet-adapter-react";
import type { PublicKey } from "@solana/web3.js";
import { GoldNumber } from "@/components/shared/GoldNumber";
import { GoldCountdown } from "@/components/shared/GoldCountdown";
import { StatBar } from "@/components/shared/StatBar";
import { TxButton } from "@/components/shared/TxButton";
import type { TxPhase } from "@/components/shared/TxButton";
import { TabNav } from "@/components/shared/TabNav";
import { UnitGrid } from "@/components/shared/UnitGrid";
import { shortenAddress, bpsToPercent } from "@/lib/utils";
import { GameInfoPanel } from "@/components/shared/GameInfoPanel";
import { InfoGrid } from "@/components/shared/InfoGrid";
import { DetailPanel } from "@/components/shared/DetailPanel";
import { SpeedupPanel } from "@/components/shared/SpeedupPanel";
import { useDomainNames } from "@/lib/hooks/useDomainNames";
import {
  derivePlayerPda,
  deriveLootPda,
  deriveLocationPda,
  toGrid,
  createAttackEncounterInstruction,
  createAttackPlayerInstruction,
  createPurchaseStaminaInstruction,
  createIntracityStartInstruction,
  createIntracityCompleteInstruction,
  createIntracityCancelInstruction,
  createTravelSpeedupInstruction,
  isTraveling,
  getEncounterStaminaCost,
  getCurrentTimeOfDay,
  getTimeOfDayName,
  getActivityMultiplier,
  calculateDamageOutput,
  calculateDefensivePower,
  getTotalDefensiveUnits,
  getTotalOperativeUnits,
} from "novus-mundus-sdk";
import { calculateDistanceMeters, GRID_PRECISION, hasArrived, TravelType } from "novus-mundus-sdk";

type CombatTab = "encounter" | "pvp";

const RARITY_LABELS = ["Common", "Uncommon", "Rare", "Epic", "Legendary"];
const RARITY_COLORS = [
  "text-zinc-400",
  "text-green-400",
  "text-blue-400",
  "text-fuchsia-400",
  "text-amber-400",
];
const RARITY_BORDERS = [
  "border-zinc-700",
  "border-green-800",
  "border-blue-800",
  "border-purple-800",
  "border-amber-800",
];

export function BattleTab() {
  const searchParams = useSearchParams();
  const initialTab = searchParams.get("type") === "pvp" ? "pvp" : "encounter";

  const { data: playerData } = usePlayer();
  const player = playerData?.account;
  const { data: geData } = useGameEngine();
  const power = useCombatPower();
  const { data: encounterData } = useEncounters(player?.currentCity);
  const { data: cityPlayers, isLoading: playersLoading } = useCityPlayers(player?.currentCity);
  const client = useNovusMundusClient();
  const { publicKey } = useWallet();
  const transact = useTransact();

  const [tab, setTab] = useState<CombatTab>(initialTab);
  const [selectedEncounter, setSelectedEncounter] = useState<number | null>(null);
  const [selectedPlayer, setSelectedPlayer] = useState<PublicKey | null>(null);
  const [driveBy, setDriveBy] = useState(false);

  const encounters = encounterData || [];

  // Attack ranges. Encounter range mirrors the program's compile-time
  // ENCOUNTER_ATTACK_RANGE_METERS constant (attack_encounter.rs enforces that,
  // not the GameEngine CombatConfig field — which a live kingdom may still
  // hold at the old 10m). PvP still reads config.
  const encounterRange = 16;
  const pvpRange = geData?.account?.combatConfig?.pvpAttackRangeMeters ?? 15;

  // Batch-resolve domain names for city player wallets
  const cityPlayerOwners = useMemo(
    () => cityPlayers?.map((p) => p.account.owner) ?? [],
    [cityPlayers],
  );
  const domainNames = useDomainNames(cityPlayerOwners);

  const playerTraveling = player ? isTraveling(player) : false;
  const isIntracity = player?.travelType === TravelType.Intracity;
  const playerArrived = player ? hasArrived(player, Math.floor(Date.now() / 1000)) : false;

  const now = Math.floor(Date.now() / 1000);

  // Time-of-day attack multiplier
  const attackTimeInfo = useMemo(() => {
    if (!player) return null;
    const longitude = (player.currentLong ?? 0) / 10000;
    const tod = getCurrentTimeOfDay(now, longitude);
    const mult = getActivityMultiplier('attacking' as any, tod);
    return { name: getTimeOfDayName(tod), mult };
  }, [player, now]);

  // Distance to each encounter
  const encounterDistances = useMemo(() => {
    if (!player) return [];
    return encounters.map((enc) => {
      const dist = calculateDistanceMeters(
        player.currentLat,
        player.currentLong,
        enc.account.locationLat,
        enc.account.locationLong,
      );
      return { distance: dist, inRange: dist <= encounterRange };
    });
  }, [player, encounters, encounterRange]);

  // Distance to each city player
  const playerDistances = useMemo(() => {
    if (!player || !cityPlayers) return new Map<string, { distance: number; inRange: boolean }>();
    const map = new Map<string, { distance: number; inRange: boolean }>();
    for (const p of cityPlayers) {
      const dist = calculateDistanceMeters(
        player.currentLat,
        player.currentLong,
        p.account.currentLat,
        p.account.currentLong,
      );
      map.set(p.pubkey.toBase58(), { distance: dist, inRange: dist <= pvpRange });
    }
    return map;
  }, [player, cityPlayers, pvpRange]);

  // Stamina info for selected encounter
  const encounterStaminaCost = useMemo(() => {
    if (selectedEncounter == null || !encounters[selectedEncounter]) return null;
    const rarity = encounters[selectedEncounter].account.rarity ?? 0;
    return getEncounterStaminaCost(rarity);
  }, [selectedEncounter, encounters]);

  const playerStamina = player?.encounterStamina?.toNumber?.() ?? 0;
  const hasStamina = encounterStaminaCost != null ? playerStamina >= encounterStaminaCost : true;

  // Estimated damage output
  const estimatedDamage = useMemo(() => {
    if (!player) return null;
    const defUnits = getTotalDefensiveUnits(player).toNumber();
    const offUnits = getTotalOperativeUnits(player).toNumber();
    const weapons = (player.meleeWeapons?.toNumber?.() ?? 0) + (player.rangedWeapons?.toNumber?.() ?? 0) + (player.siegeWeapons?.toNumber?.() ?? 0);
    try {
      return calculateDamageOutput(defUnits + offUnits, weapons, false);
    } catch {
      return null;
    }
  }, [player]);

  // Selected encounter/player data
  const selectedEncData = selectedEncounter != null ? encounters[selectedEncounter] ?? null : null;
  const selectedEncDist = selectedEncounter != null ? encounterDistances[selectedEncounter] ?? null : null;

  const selectedPlayerData = useMemo(() => {
    if (!selectedPlayer || !cityPlayers) return null;
    return cityPlayers.find((p) => p.pubkey.equals(selectedPlayer)) ?? null;
  }, [selectedPlayer, cityPlayers]);

  const selectedPlayerDist = selectedPlayer ? playerDistances.get(selectedPlayer.toBase58()) ?? null : null;

  // ── Handlers ────────────────────────────────────────────

  const handleAttackEncounter = async (reportPhase: (p: TxPhase) => void) => {
    if (selectedEncounter == null || !publicKey || !player) throw new Error("No target selected");
    const ge = client.gameEngine;
    const encounter = encounters[selectedEncounter];
    const enc = encounter.account;
    const [playerPda] = derivePlayerPda(ge, publicKey);
    const [loot] = deriveLootPda(playerPda, player.lootCounter.toNumber());
    const [encounterLocation] = deriveLocationPda(
      ge, enc.cityId, toGrid(enc.locationLat), toGrid(enc.locationLong)
    );
    const locationCreatorRefund = geData?.account?.authority ?? publicKey;
    const ix = createAttackEncounterInstruction(
      {
        owner: publicKey,
        gameEngine: ge,
        encounter: encounter.pubkey,
        loot,
        encounterLocation,
        locationCreatorRefund,
      },
      { encounterId: enc.id.toNumber() }
    );
    return transact.mutateAsync({
      instructions: [ix],
      invalidateKeys: [["player"], ["encounters"], ["loot"]],
      successMessage: "Attack landed!",
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  const handleStaminaAndAttack = async (reportPhase: (p: TxPhase) => void) => {
    if (selectedEncounter == null || !publicKey || !player) throw new Error("No target selected");
    const ge = client.gameEngine;
    const encounter = encounters[selectedEncounter];
    const enc = encounter.account;
    const [playerPda] = derivePlayerPda(ge, publicKey);
    const [loot] = deriveLootPda(playerPda, player.lootCounter.toNumber());
    const [encounterLocation] = deriveLocationPda(
      ge, enc.cityId, toGrid(enc.locationLat), toGrid(enc.locationLong)
    );
    const locationCreatorRefund = geData?.account?.authority ?? publicKey;
    const staminaIx = createPurchaseStaminaInstruction(
      { gameEngine: ge, owner: publicKey },
      { amount: 1 }
    );
    const attackIx = createAttackEncounterInstruction(
      {
        owner: publicKey, gameEngine: ge, encounter: encounter.pubkey,
        loot, encounterLocation, locationCreatorRefund,
      },
      { encounterId: enc.id.toNumber() }
    );
    return transact.mutateAsync({
      instructions: [staminaIx, attackIx],
      invalidateKeys: [["player"], ["encounters"], ["loot"]],
      successMessage: "Bought stamina & attacked!",
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  const handleAttackPlayer = async (reportPhase: (p: TxPhase) => void) => {
    if (!selectedPlayer || !publicKey || !player) throw new Error("No target");
    const ge = client.gameEngine;
    const defenderData = cityPlayers?.find((p) => p.pubkey.equals(selectedPlayer));
    if (!defenderData) throw new Error("Target not found");
    const ix = createAttackPlayerInstruction(
      {
        attacker: publicKey,
        gameEngine: ge,
        defenderPlayer: selectedPlayer,
        attackerCityId: player.currentCity,
        defenderCityId: defenderData.account.currentCity,
      },
      { driveBy }
    );
    return transact.mutateAsync({
      instructions: [ix],
      invalidateKeys: [["player"], ["cityPlayers"]],
      successMessage: "PvP attack executed!",
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  const handleTravelCloser = async (targetLat: number, targetLong: number, reportPhase: (p: TxPhase) => void) => {
    if (!publicKey || !player) throw new Error("Not ready");
    const ge = client.gameEngine;
    const cityId = player.currentCity;
    const [originLocation] = deriveLocationPda(ge, cityId, toGrid(player.currentLat), toGrid(player.currentLong));
    const [destinationLocation] = deriveLocationPda(ge, cityId, toGrid(targetLat), toGrid(targetLong));
    const originCreatorRefund = geData?.account?.authority ?? publicKey;
    const ix = createIntracityStartInstruction(
      {
        owner: publicKey,
        gameEngine: ge,
        cityId,
        originLocation,
        destinationLocation,
        originCreatorRefund,
      },
      { destinationLat: targetLat, destinationLong: targetLong }
    );
    return transact.mutateAsync({
      instructions: [ix],
      invalidateKeys: [["player"]],
      successMessage: "Traveling closer to target!",
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  const handleIntracityComplete = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey || !player) throw new Error("Not ready");
    const ge = client.gameEngine;
    const cityId = player.currentCity;
    const [destinationLocation] = deriveLocationPda(
      ge, cityId, toGrid(player.travelingToLat), toGrid(player.travelingToLong),
    );
    const ix = createIntracityCompleteInstruction({
      owner: publicKey,
      gameEngine: ge,
      cityId,
      destinationLocation,
    });
    return transact.mutateAsync({
      instructions: [ix],
      invalidateKeys: [["player"]],
      successMessage: "Arrived at destination!",
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  const handleIntracityCancel = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey || !player) throw new Error("Not ready");
    const ge = client.gameEngine;
    const cityId = player.currentCity;
    const [originLocation] = deriveLocationPda(
      ge, cityId, toGrid(player.currentLat), toGrid(player.currentLong),
    );
    const [destinationLocation] = deriveLocationPda(
      ge, cityId, toGrid(player.travelingToLat), toGrid(player.travelingToLong),
    );
    const destinationCreatorRefund = geData?.account?.authority ?? publicKey;
    const ix = createIntracityCancelInstruction({
      owner: publicKey,
      gameEngine: ge,
      cityId,
      originLocation,
      destinationLocation,
      destinationCreatorRefund,
    });
    return transact.mutateAsync({
      instructions: [ix],
      invalidateKeys: [["player"]],
      successMessage: "Travel cancelled!",
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  const handleTravelSpeedup = async (tier: number, reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    const ix = createTravelSpeedupInstruction(
      { owner: publicKey, gameEngine: client.gameEngine },
      { speedupTier: tier as 1 | 2 },
    );
    return transact.mutateAsync({
      instructions: [ix],
      invalidateKeys: [["player"]],
      successMessage: "Travel sped up!",
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  const travelRemaining = player && playerTraveling && !playerArrived
    ? Math.max(0, player.arrivalTime.toNumber() - now)
    : 0;

  // ── Render ──────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* Your Forces — compact */}
      {player && (
        <div className="card accent-border">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div>
                <div className="text-xl font-bold text-text-gold">
                  <GoldNumber value={power.total} />
                </div>
                <div className="text-[10px] text-text-muted">COMBAT POWER</div>
              </div>
              <div className="h-8 w-px bg-border-default" />
              <div>
                <div className="text-sm font-bold text-text-secondary"><GoldNumber value={power.defense} size="sm" /></div>
                <div className="text-[10px] text-text-muted">GARRISON</div>
              </div>
              {estimatedDamage != null && (
                <>
                  <div className="h-8 w-px bg-border-default" />
                  <div>
                    <div className="text-sm font-bold text-red-400">{estimatedDamage.toLocaleString()}</div>
                    <div className="text-[10px] text-text-muted">EST. DAMAGE</div>
                  </div>
                </>
              )}
            </div>
            <div className="flex items-center gap-3 text-xs text-text-muted">
              <span>Stamina: <span className="font-mono text-text-gold">{playerStamina}</span></span>
              {attackTimeInfo && (
                <span>
                  {attackTimeInfo.name}
                  {attackTimeInfo.mult > 1 && (
                    <span className="ml-1 text-green-400">+{((attackTimeInfo.mult - 1) * 100).toFixed(0)}%</span>
                  )}
                  {attackTimeInfo.mult < 1 && (
                    <span className="ml-1 text-red-400">{((attackTimeInfo.mult - 1) * 100).toFixed(0)}%</span>
                  )}
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Tab Selector */}
      <TabNav
        tabs={[
          { key: "encounter", label: `Encounters (${encounters.length})` },
          { key: "pvp", label: `Players (${cityPlayers?.length ?? 0})` },
        ]}
        activeTab={tab}
        onTabChange={(key) => {
          setTab(key as CombatTab);
          if (key === "encounter") setSelectedPlayer(null);
          else setSelectedEncounter(null);
        }}
      />

      {/* ── ENCOUNTERS ── */}
      {tab === "encounter" && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {/* Left: encounter list */}
          <div className="lg:col-span-2 space-y-2">
            {encounters.length === 0 ? (
              <div className="card">
                <p className="text-sm text-text-muted">No encounters in your city. Check back later or travel to another city.</p>
              </div>
            ) : (
              encounters.map((enc, i) => {
                const hp = enc.account.health.toNumber();
                const maxHp = enc.account.maxHealth.toNumber();
                const rarity = enc.account.rarity ?? 0;
                const dist = encounterDistances[i];
                const isSelected = selectedEncounter === i;
                const staminaCost = getEncounterStaminaCost(rarity);

                return (
                  <button
                    key={enc.account.id.toString()}
                    onClick={() => setSelectedEncounter(i)}
                    className={`w-full rounded-lg border p-3 text-left transition-all ${
                      isSelected
                        ? `${RARITY_BORDERS[rarity]} bg-surface-raised ring-1 ring-amber-600/30`
                        : `border-zinc-800 hover:border-zinc-700`
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface text-sm font-bold ${RARITY_COLORS[rarity]}`}>
                          {RARITY_LABELS[rarity]?.[0]}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className={`text-sm font-semibold ${RARITY_COLORS[rarity]}`}>
                              {RARITY_LABELS[rarity]} Encounter
                            </span>
                            <span className="text-[10px] text-text-muted">#{enc.account.id.toString()}</span>
                          </div>
                          <div className="flex items-center gap-3 text-[10px] text-text-muted">
                            <span>{hp.toLocaleString()} / {maxHp.toLocaleString()} HP</span>
                            <span>Cost: {staminaCost} stamina</span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {dist && (
                          dist.inRange ? (
                            <span className="rounded-full bg-green-900/30 px-2 py-0.5 text-[10px] font-semibold text-green-400">
                              IN RANGE ({dist.distance.toFixed(1)}m)
                            </span>
                          ) : (
                            <span className="rounded-full bg-red-900/30 px-2 py-0.5 text-[10px] font-semibold text-red-400">
                              {dist.distance.toFixed(1)}m away
                            </span>
                          )
                        )}
                      </div>
                    </div>
                    <div className="mt-2">
                      <StatBar current={hp} max={maxHp} color="gold" size="sm" showValues={false} />
                    </div>
                  </button>
                );
              })
            )}
          </div>

          {/* Right: detail panel — desktop sidebar / mobile bottom sheet */}
          <DetailPanel
            open={!!(selectedEncData && selectedEncDist)}
            onClose={() => setSelectedEncounter(null)}
          >
            {selectedEncData && selectedEncDist && (
              <>
                {/* Target header */}
                <div className="text-center">
                  <div className={`text-lg font-bold ${RARITY_COLORS[selectedEncData.account.rarity ?? 0]}`}>
                    {RARITY_LABELS[selectedEncData.account.rarity ?? 0]} Encounter
                  </div>
                  <div className="text-xs text-text-muted">
                    #{selectedEncData.account.id.toString()}
                  </div>
                </div>

                {/* HP */}
                <div>
                  <div className="flex justify-between text-xs text-text-muted mb-1">
                    <span>Health</span>
                    <span>{selectedEncData.account.health.toNumber().toLocaleString()} / {selectedEncData.account.maxHealth.toNumber().toLocaleString()}</span>
                  </div>
                  <StatBar
                    current={selectedEncData.account.health.toNumber()}
                    max={selectedEncData.account.maxHealth.toNumber()}
                    color="gold"
                    showValues={false}
                  />
                </div>

                {/* Stats */}
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-lg bg-surface/60 px-3 py-2 text-center">
                    <div className="text-[10px] text-text-muted">Stamina Cost</div>
                    <div className={`font-mono text-sm font-bold ${hasStamina ? "text-text-primary" : "text-red-400"}`}>
                      {encounterStaminaCost ?? "—"}
                    </div>
                  </div>
                  <div className="rounded-lg bg-surface/60 px-3 py-2 text-center">
                    <div className="text-[10px] text-text-muted">Distance</div>
                    <div className={`font-mono text-sm font-bold ${selectedEncDist.inRange ? "text-green-400" : "text-red-400"}`}>
                      {selectedEncDist.distance.toFixed(1)}m
                    </div>
                  </div>
                </div>

                {/* Range status */}
                {selectedEncDist.inRange ? (
                  <div className="rounded-lg border border-green-800/50 bg-green-900/10 p-3 text-center">
                    <div className="text-xs font-semibold text-green-400">Target in range</div>
                    <div className="text-[10px] text-green-600">
                      {selectedEncDist.distance.toFixed(1)}m / {encounterRange}m max
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="rounded-lg border border-red-800/50 bg-red-900/10 p-3 text-center">
                      <div className="text-xs font-semibold text-red-400">Out of range</div>
                      <div className="text-[10px] text-red-600">
                        {selectedEncDist.distance.toFixed(1)}m away (max {encounterRange}m)
                      </div>
                    </div>
                    <ProximityGrid
                      targetLat={selectedEncData.account.locationLat}
                      targetLong={selectedEncData.account.locationLong}
                      playerLat={player!.currentLat}
                      playerLong={player!.currentLong}
                      cityId={player!.currentCity}
                      attackRange={encounterRange}
                      onTravel={handleTravelCloser}
                      disabled={playerTraveling}
                    />
                  </div>
                )}

                {/* Travel controls — shown when traveling */}
                {playerTraveling && player && (
                  <div className="space-y-3">
                    <div className="rounded-lg border border-amber-800/50 bg-amber-900/20 p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-amber-300">
                          {isIntracity ? "Traveling within city" : "Traveling between cities"}
                        </span>
                        {playerArrived ? (
                          <span className="rounded-full bg-green-900/40 px-2 py-0.5 text-[10px] font-semibold text-green-400">
                            ARRIVED
                          </span>
                        ) : (
                          <GoldCountdown
                            endsAt={player.arrivalTime.toNumber()}
                            startedAt={player.departureTime.toNumber()}
                            showProgress
                            format="compact"
                            size="sm"
                          />
                        )}
                      </div>
                      {isIntracity && playerArrived && (
                        <TxButton onClick={handleIntracityComplete} className="w-full text-xs">
                          Complete Travel
                        </TxButton>
                      )}
                      {isIntracity && !playerArrived && (
                        <TxButton onClick={handleIntracityCancel} variant="secondary" className="w-full text-xs">
                          Cancel Travel
                        </TxButton>
                      )}
                      {!isIntracity && (
                        <Link
                          href="/map"
                          className="block rounded-md border border-amber-800/50 bg-amber-900/20 px-3 py-1.5 text-center text-xs font-medium text-text-gold hover:bg-amber-900/40"
                        >
                          Go to Travel
                        </Link>
                      )}
                    </div>
                    <SpeedupPanel
                      visible={!playerArrived}
                      remainingSeconds={travelRemaining}
                      onSpeedup={handleTravelSpeedup}
                      gemsPerMinute={geData?.account?.gameplayConfig?.gemCostPerMinuteSpeedup ?? 1}
                      gemBalance={player.gems?.toNumber?.()}
                    />
                  </div>
                )}

                {/* Stamina warning */}
                {!hasStamina && !playerTraveling && (
                  <div className="rounded-lg border border-red-800/50 bg-red-900/10 p-2 text-center text-xs text-red-400">
                    Insufficient stamina ({playerStamina} / {encounterStaminaCost})
                  </div>
                )}

                {/* Attack buttons */}
                {!playerTraveling && (
                  <div className="space-y-2">
                    <TxButton
                      onClick={handleAttackEncounter}
                      className="w-full py-3 text-base font-bold"
                      disabled={!hasStamina || !selectedEncDist.inRange}
                    >
                      ATTACK
                    </TxButton>
                    <TxButton
                      onClick={handleStaminaAndAttack}
                      variant="secondary"
                      className="w-full text-xs"
                      disabled={!selectedEncDist.inRange}
                    >
                      Buy Stamina &amp; Attack
                    </TxButton>
                  </div>
                )}
              </>
            )}
          </DetailPanel>
        </div>
      )}

      {/* ── PVP ── */}
      {tab === "pvp" && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {/* Left: player list */}
          <div className="lg:col-span-2 space-y-2">
            {playersLoading ? (
              <div className="card">
                <p className="text-sm text-text-muted">Scanning for nearby players...</p>
              </div>
            ) : (cityPlayers?.length ?? 0) === 0 ? (
              <div className="card">
                <p className="text-sm text-text-muted">
                  No other players in your city. Travel to a busier city to find targets.
                </p>
              </div>
            ) : (
              cityPlayers!.map((p) => {
                const def = calculateDefensivePower(
                  p.account.defensiveUnit1.toNumber(),
                  p.account.defensiveUnit2.toNumber(),
                  p.account.defensiveUnit3.toNumber(),
                );
                const totalOps = p.account.operativeUnit1.toNumber()
                  + p.account.operativeUnit2.toNumber()
                  + p.account.operativeUnit3.toNumber();
                const isProtected = p.account.newPlayerProtectionUntil.toNumber() > now;
                const isSelected = selectedPlayer?.equals(p.pubkey);
                const isTargetTraveling = isTraveling(p.account);
                const dist = playerDistances.get(p.pubkey.toBase58());

                return (
                  <button
                    key={p.pubkey.toBase58()}
                    onClick={() => !isProtected && !isTargetTraveling ? setSelectedPlayer(p.pubkey) : undefined}
                    disabled={isProtected || isTargetTraveling}
                    className={`w-full rounded-lg border p-3 text-left transition-all ${
                      isSelected
                        ? "border-red-600 bg-red-900/20 ring-1 ring-red-600/30"
                        : isProtected || isTargetTraveling
                          ? "border-zinc-900 opacity-50"
                          : "border-zinc-800 hover:border-zinc-700"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div>
                          <Link
                            href={`/world/players/${p.account.owner.toBase58()}`}
                            className="text-sm font-semibold text-text-primary hover:text-text-gold transition-colors"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {p.account.name || domainNames.get(p.account.owner.toBase58()) || shortenAddress(p.account.owner.toBase58())}
                          </Link>
                          <div className="flex items-center gap-2 text-[10px] text-text-muted">
                            <span>Lv {p.account.level}</span>
                            <span>&middot;</span>
                            <span>NW <GoldNumber value={p.account.networth.toNumber()} size="sm" /></span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="text-right mr-2">
                          <div className="text-xs text-text-secondary">{def.toLocaleString()}</div>
                          <div className="text-[10px] text-text-muted">POWER</div>
                        </div>
                        {def === 0 && totalOps > 0 && (
                          <span className="rounded bg-red-900/40 px-1.5 py-0.5 text-[10px] font-semibold text-red-300">
                            EXPOSED
                          </span>
                        )}
                        {isProtected && (
                          <span className="rounded bg-blue-900/40 px-1.5 py-0.5 text-[10px] font-semibold text-blue-300">
                            PROTECTED
                          </span>
                        )}
                        {isTargetTraveling && (
                          <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-semibold text-text-muted">
                            TRAVELING
                          </span>
                        )}
                        {dist && !isProtected && !isTargetTraveling && (
                          dist.inRange ? (
                            <span className="rounded-full bg-green-900/30 px-2 py-0.5 text-[10px] font-semibold text-green-400">
                              IN RANGE
                            </span>
                          ) : (
                            <span className="rounded-full bg-red-900/30 px-2 py-0.5 text-[10px] font-semibold text-red-400">
                              {dist.distance.toFixed(1)}m
                            </span>
                          )
                        )}
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>

          {/* Right: detail panel — desktop sidebar / mobile bottom sheet */}
          <DetailPanel
            open={!!(selectedPlayerData && selectedPlayerDist)}
            onClose={() => setSelectedPlayer(null)}
          >
            {selectedPlayerData && selectedPlayerDist && (
              <>
                {/* Target header */}
                <div className="text-center">
                  <div className="text-lg font-bold text-text-primary">
                    {selectedPlayerData.account.name || domainNames.get(selectedPlayerData.account.owner.toBase58()) || shortenAddress(selectedPlayerData.account.owner.toBase58())}
                  </div>
                  <div className="text-xs text-text-muted">
                    Level {selectedPlayerData.account.level}
                  </div>
                </div>

                {/* Target stats */}
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-lg bg-surface/60 px-3 py-2 text-center">
                    <div className="text-[10px] text-text-muted">Net Worth</div>
                    <GoldNumber value={selectedPlayerData.account.networth.toNumber()} size="sm" />
                  </div>
                  <div className="rounded-lg bg-surface/60 px-3 py-2 text-center">
                    <div className="text-[10px] text-text-muted">Cash on Hand</div>
                    <GoldNumber value={selectedPlayerData.account.cashOnHand.toNumber()} prefix="$" size="sm" />
                  </div>
                </div>

                {/* Target units */}
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-2">Target Forces</div>
                  <UnitGrid
                    defense={[
                      selectedPlayerData.account.defensiveUnit1.toNumber(),
                      selectedPlayerData.account.defensiveUnit2.toNumber(),
                      selectedPlayerData.account.defensiveUnit3.toNumber(),
                    ]}
                    offense={[
                      selectedPlayerData.account.operativeUnit1.toNumber(),
                      selectedPlayerData.account.operativeUnit2.toNumber(),
                      selectedPlayerData.account.operativeUnit3.toNumber(),
                    ]}
                  />
                </div>

                {/* Distance / Range */}
                <div className="rounded-lg bg-surface/60 px-3 py-2 text-center">
                  <div className="text-[10px] text-text-muted">Distance</div>
                  <div className={`font-mono text-sm font-bold ${selectedPlayerDist.inRange ? "text-green-400" : "text-red-400"}`}>
                    {selectedPlayerDist.distance.toFixed(1)}m
                  </div>
                </div>

                {selectedPlayerDist.inRange ? (
                  <div className="rounded-lg border border-green-800/50 bg-green-900/10 p-3 text-center">
                    <div className="text-xs font-semibold text-green-400">Target in range</div>
                    <div className="text-[10px] text-green-600">
                      {selectedPlayerDist.distance.toFixed(1)}m / {pvpRange}m max
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="rounded-lg border border-red-800/50 bg-red-900/10 p-3 text-center">
                      <div className="text-xs font-semibold text-red-400">Out of range</div>
                      <div className="text-[10px] text-red-600">
                        {selectedPlayerDist.distance.toFixed(1)}m away (max {pvpRange}m)
                      </div>
                    </div>
                    <ProximityGrid
                      targetLat={selectedPlayerData.account.currentLat}
                      targetLong={selectedPlayerData.account.currentLong}
                      playerLat={player!.currentLat}
                      playerLong={player!.currentLong}
                      cityId={player!.currentCity}
                      attackRange={pvpRange}
                      onTravel={handleTravelCloser}
                      disabled={playerTraveling}
                    />
                  </div>
                )}

                {/* Operative exposure hint */}
                {(() => {
                  const tDef = calculateDefensivePower(
                    selectedPlayerData.account.defensiveUnit1.toNumber(),
                    selectedPlayerData.account.defensiveUnit2.toNumber(),
                    selectedPlayerData.account.defensiveUnit3.toNumber(),
                  );
                  const tOps = selectedPlayerData.account.operativeUnit1.toNumber()
                    + selectedPlayerData.account.operativeUnit2.toNumber()
                    + selectedPlayerData.account.operativeUnit3.toNumber();
                  if (tOps > 0 && (tDef === 0 || (estimatedDamage != null && estimatedDamage > tDef * 2)))
                    return (
                      <div className="rounded border border-red-800/30 bg-red-900/10 px-3 py-2 text-xs text-red-300">
                        {tDef === 0
                          ? `Garrison empty — ${tOps.toLocaleString()} operatives take full damage`
                          : `Garrison may break — ${tOps.toLocaleString()} ops exposed`}
                      </div>
                    );
                  return null;
                })()}

                {/* Travel controls — shown when traveling */}
                {playerTraveling && player && (
                  <div className="space-y-3">
                    <div className="rounded-lg border border-amber-800/50 bg-amber-900/20 p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-amber-300">
                          {isIntracity ? "Traveling within city" : "Traveling between cities"}
                        </span>
                        {playerArrived ? (
                          <span className="rounded-full bg-green-900/40 px-2 py-0.5 text-[10px] font-semibold text-green-400">
                            ARRIVED
                          </span>
                        ) : (
                          <GoldCountdown
                            endsAt={player.arrivalTime.toNumber()}
                            startedAt={player.departureTime.toNumber()}
                            showProgress
                            format="compact"
                            size="sm"
                          />
                        )}
                      </div>
                      {isIntracity && playerArrived && (
                        <TxButton onClick={handleIntracityComplete} className="w-full text-xs">
                          Complete Travel
                        </TxButton>
                      )}
                      {isIntracity && !playerArrived && (
                        <TxButton onClick={handleIntracityCancel} variant="secondary" className="w-full text-xs">
                          Cancel Travel
                        </TxButton>
                      )}
                      {!isIntracity && (
                        <Link
                          href="/map"
                          className="block rounded-md border border-amber-800/50 bg-amber-900/20 px-3 py-1.5 text-center text-xs font-medium text-text-gold hover:bg-amber-900/40"
                        >
                          Go to Travel
                        </Link>
                      )}
                    </div>
                    <SpeedupPanel
                      visible={!playerArrived}
                      remainingSeconds={travelRemaining}
                      onSpeedup={handleTravelSpeedup}
                      gemsPerMinute={geData?.account?.gameplayConfig?.gemCostPerMinuteSpeedup ?? 1}
                      gemBalance={player.gems?.toNumber?.()}
                    />
                  </div>
                )}

                {/* Drive-by Toggle + Attack — hidden while traveling */}
                {!playerTraveling && (
                  <>
                    <label className="flex cursor-pointer items-center gap-2 text-sm text-text-secondary">
                      <input
                        type="checkbox"
                        checked={driveBy}
                        onChange={(e) => setDriveBy(e.target.checked)}
                        className="rounded border-zinc-700"
                      />
                      Drive-by
                      <span className="text-[10px] text-text-muted">(10k+ units, -25% dmg)</span>
                    </label>

                    <TxButton
                      onClick={handleAttackPlayer}
                      variant="danger"
                      className="w-full py-3 text-base font-bold"
                      disabled={!selectedPlayerDist.inRange}
                    >
                      ATTACK PLAYER
                    </TxButton>
                  </>
                )}
              </>
            )}
          </DetailPanel>
        </div>
      )}

      {/* Game Parameters */}
      {geData?.account && (() => {
        const ge = geData.account;
        const gp = ge.gameplayConfig;
        const cc = ge.combatConfig;
        return (
          <GameInfoPanel>
            <InfoGrid items={[
              { label: "Safebox Protection", value: bpsToPercent(gp.safeboxProtectionPercent), highlight: true },
              { label: "PvP Loot Base", value: bpsToPercent(gp.pvpLootPercentageBase) },
              { label: "Armor Reduction", value: bpsToPercent(gp.armorDamageReductionBps) },
              { label: "Armor Reduction Cap", value: bpsToPercent(gp.armorDamageReductionCapBps) },
              { label: "Weapon Loot Rate", value: bpsToPercent(cc.weaponLootRateBps) },
              { label: "Armory Raid (Ops)", value: bpsToPercent(cc.armoryRaidWithOperativesBps) },
              { label: "Armory Undefended", value: bpsToPercent(cc.armoryRaidUndefendedBps) },
              { label: "Siege Capture Rate", value: bpsToPercent(cc.siegeCaptureRateBps) },
              { label: "Dmg Dist T1", value: bpsToPercent(gp.damageUnit1Percent) },
              { label: "Dmg Dist T2", value: bpsToPercent(gp.damageUnit2Percent) },
              { label: "Dmg Dist T3", value: bpsToPercent(gp.damageUnit3Percent) },
              { label: "PvP Range", value: cc.pvpAttackRangeMeters.toLocaleString(), suffix: "m" },
              { label: "Siege Dmg/Weapon", value: cc.damagePerSiegeWeapon.toNumber().toLocaleString() },
              { label: "Encounter Range", value: cc.encounterAttackRangeMeters.toLocaleString(), suffix: "m" },
            ]} />
          </GameInfoPanel>
        );
      })()}
    </div>
  );
}

// ─── Proximity Grid ─────────────────────────────────────────
function ProximityGrid({
  targetLat,
  targetLong,
  playerLat,
  playerLong,
  cityId,
  attackRange,
  onTravel,
  disabled,
}: {
  targetLat: number;
  targetLong: number;
  playerLat: number;
  playerLong: number;
  cityId: number;
  attackRange: number;
  onTravel: (destLat: number, destLong: number, rp: (p: TxPhase) => void) => Promise<string>;
  disabled: boolean;
}) {
  const client = useNovusMundusClient();
  const ge = client.gameEngine;

  const tGridLat = toGrid(targetLat);
  const tGridLong = toGrid(targetLong);
  const pGridLat = toGrid(playerLat);
  const pGridLong = toGrid(playerLong);

  // Build 3x3 cell metadata (top row = north = +lat)
  const cells = useMemo(() => {
    const result: Array<{
      gridLat: number;
      gridLong: number;
      centerLat: number;
      centerLong: number;
      isTarget: boolean;
      isPlayer: boolean;
      distToTarget: number;
      inRange: boolean;
    }> = [];

    for (const dy of [1, 0, -1]) {
      for (const dx of [-1, 0, 1]) {
        const gLat = tGridLat + dy;
        const gLong = tGridLong + dx;
        const cLat = gLat / GRID_PRECISION;
        const cLong = gLong / GRID_PRECISION;
        const dist = calculateDistanceMeters(cLat, cLong, targetLat, targetLong);
        result.push({
          gridLat: gLat,
          gridLong: gLong,
          centerLat: cLat,
          centerLong: cLong,
          isTarget: dy === 0 && dx === 0,
          isPlayer: gLat === pGridLat && gLong === pGridLong,
          distToTarget: dist,
          inRange: dist <= attackRange,
        });
      }
    }
    return result;
  }, [tGridLat, tGridLong, pGridLat, pGridLong, targetLat, targetLong, attackRange]);

  // Batch-check cell occupancy via a single RPC call
  const [occupancy, setOccupancy] = useState<(boolean | null)[]>(() => new Array(9).fill(null));

  useEffect(() => {
    const pdas = cells.map((c) =>
      deriveLocationPda(ge, cityId, c.gridLat, c.gridLong)[0],
    );
    client.connection
      .getMultipleAccountsInfo(pdas)
      .then((accounts) => setOccupancy(accounts.map((a) => a !== null)))
      .catch(() => {});
  }, [cells, ge, cityId, client]);

  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const selectedCell = selectedIdx != null ? cells[selectedIdx] : null;
  const selectedEmpty = selectedIdx != null && occupancy[selectedIdx] === false;

  const anyEmpty = cells.some((c, i) => occupancy[i] === false && !c.isTarget);
  const doneLoading = occupancy.every((o) => o !== null);

  return (
    <div className="space-y-2">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
        Nearby Cells
      </div>
      <div className="grid grid-cols-3 gap-1">
        {cells.map((cell, i) => {
          const occupied = occupancy[i];
          const loading = occupied === null;
          const isEmpty = occupied === false;
          const isSelected = selectedIdx === i;
          const canClick = isEmpty && !cell.isTarget && !disabled;

          let style: string;
          if (cell.isTarget) {
            style = "border-red-600 bg-red-900/30 text-red-400";
          } else if (cell.isPlayer) {
            style = "border-amber-600 bg-amber-900/30 text-amber-400";
          } else if (isSelected) {
            style = "border-amber-500 bg-amber-900/40 text-amber-300 ring-1 ring-amber-500/50";
          } else if (loading) {
            style = "border-zinc-800 bg-surface/40 text-zinc-600 animate-pulse";
          } else if (!isEmpty) {
            style = "border-zinc-800 bg-zinc-900/50 text-zinc-600 opacity-50";
          } else if (cell.inRange) {
            style = "border-green-700 bg-green-900/20 text-green-400 hover:bg-green-900/40 cursor-pointer";
          } else {
            style = "border-yellow-800 bg-yellow-900/10 text-yellow-500 hover:bg-yellow-900/30 cursor-pointer";
          }

          return (
            <button
              key={i}
              disabled={!canClick}
              onClick={() => canClick ? setSelectedIdx(i) : undefined}
              className={`aspect-square rounded border flex flex-col items-center justify-center text-[9px] font-mono transition-all ${style}`}
            >
              {cell.isTarget ? (
                <span className="text-xs">&#9760;</span>
              ) : cell.isPlayer ? (
                <span className="text-[10px] font-bold">YOU</span>
              ) : loading ? (
                <span className="text-[10px]">...</span>
              ) : !isEmpty ? (
                <span className="text-[10px]">&#9632;</span>
              ) : (
                <>
                  <span>{cell.distToTarget.toFixed(0)}m</span>
                  {cell.inRange && <span className="text-[7px] text-green-500">IN RANGE</span>}
                </>
              )}
            </button>
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[9px] text-text-muted">
        <span><span className="text-red-400">&#9760;</span> Target</span>
        <span><span className="text-green-400">&#10003;</span> In range</span>
        <span><span className="text-yellow-500">&#9679;</span> Close</span>
        <span><span className="text-zinc-600">&#9632;</span> Occupied</span>
      </div>

      {/* Travel button for selected cell */}
      {selectedCell && selectedEmpty && (
        <TxButton
          onClick={(rp) => onTravel(selectedCell.centerLat, selectedCell.centerLong, rp)}
          variant="secondary"
          className="w-full text-xs"
          disabled={disabled}
        >
          Travel to cell ({selectedCell.distToTarget.toFixed(0)}m from target
          {selectedCell.inRange ? " — IN RANGE" : ""})
        </TxButton>
      )}

      {doneLoading && !anyEmpty && (
        <div className="text-[10px] text-red-400 text-center">
          All nearby cells are occupied
        </div>
      )}
    </div>
  );
}
