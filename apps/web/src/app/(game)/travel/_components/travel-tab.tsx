"use client";

import { useState, useMemo } from "react";
import { usePlayer } from "@/lib/hooks/usePlayer";
import { useGameEngine } from "@/lib/hooks/useGameEngine";
import { useAllCities } from "@/lib/hooks/useAllCities";
import { useTravelProgress } from "@/lib/hooks/useDerived";
import { useTransact } from "@/lib/hooks/useTransact";
import { useNovusMundusClient } from "@/lib/solana/provider";
import { useWallet } from "@solana/wallet-adapter-react";
import { GoldCountdown } from "@/components/shared/GoldCountdown";
import { StatBar } from "@/components/shared/StatBar";
import { TxButton } from "@/components/shared/TxButton";
import type { TxPhase } from "@/components/shared/TxButton";
import { SpeedupPanel } from "@/components/shared/SpeedupPanel";
import { GameInfoPanel } from "@/components/shared/GameInfoPanel";
import { InfoGrid } from "@/components/shared/InfoGrid";
import { bpsToPercent } from "@/lib/utils";
import {
  derivePlayerPda,
  deriveCityPda,
  createIntercityStartInstruction,
  createIntercityCompleteInstruction,
  createIntercityCancelInstruction,
  createIntercityTeleportInstruction,
  createTravelSpeedupInstruction,
  calculateDistance,
  calculateIntercityTravelTime,
  calculateTeleportCost,
  fixedPointToFloat,
  getCurrentTimeOfDay,
  getTimeOfDayName,
  getActivityMultiplier,
  isTraveling,
} from "@/lib/sdk";

const CITY_TYPE_LABELS = ["Capital", "Resource", "Combat", "Trade"];

export function TravelTab() {
  const { data: playerData } = usePlayer();
  const { data: geData } = useGameEngine();
  const { data: cities, isLoading: citiesLoading } = useAllCities();
  const travel = useTravelProgress();
  const client = useNovusMundusClient();
  const { publicKey } = useWallet();
  const transact = useTransact();

  const player = playerData?.account;
  const ge = geData?.account;

  const [destinationCity, setDestinationCity] = useState<number | null>(null);

  const currentCityData = cities?.find((c) => c.account.cityId === player?.currentCity);
  const destCityData = cities?.find((c) => c.account.cityId === destinationCity);

  const now = Math.floor(Date.now() / 1000);

  const travelPreview = useMemo(() => {
    if (!currentCityData || !destCityData || !ge) return null;
    const origin = currentCityData.account;
    const dest = destCityData.account;

    const lat1 = fixedPointToFloat(origin.latitude);
    const long1 = fixedPointToFloat(origin.longitude);
    const lat2 = fixedPointToFloat(dest.latitude);
    const long2 = fixedPointToFloat(dest.longitude);

    const distanceKm = calculateDistance(lat1, long1, lat2, long2);

    const baseSpeedKmh = ge.gameplayConfig?.themeTravelSpeedsKmh?.[0] ?? 50;
    const travelTimeSec = calculateIntercityTravelTime(distanceKm, baseSpeedKmh);

    const baseTeleportCost = ge.gameplayConfig?.teleportBaseCost?.toNumber?.() ?? 100_000;
    const costPer100km = ge.gameplayConfig?.teleportCostPer100km?.toNumber?.() ?? 10_000;
    const teleportCost = calculateTeleportCost(distanceKm, baseTeleportCost, costPer100km);

    const longitude = long1;
    const tod = getCurrentTimeOfDay(now, longitude);
    const travelMult = getActivityMultiplier('traveling' as any, tod);

    const hours = Math.floor(travelTimeSec / 3600);
    const minutes = Math.floor((travelTimeSec % 3600) / 60);
    const timeStr = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;

    return {
      distanceKm: Math.round(distanceKm),
      travelTimeSec,
      timeStr,
      teleportCost,
      todName: getTimeOfDayName(tod),
      travelMult,
    };
  }, [currentCityData, destCityData, ge, now]);

  const handleIntercityStart = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey || !player || destinationCity == null) throw new Error("Not ready");
    const geKey = client.gameEngine;
    const [playerPda] = derivePlayerPda(geKey, publicKey);
    const [originCityPda] = deriveCityPda(geKey, player.currentCity);
    const [destCityPda] = deriveCityPda(geKey, destinationCity);
    const ix = createIntercityStartInstruction({
      player: playerPda,
      originCity: originCityPda,
      destinationCity: destCityPda,
      gameEngine: geKey,
      owner: publicKey,
    });
    const destName = destCityData?.account.name || `City ${destinationCity}`;
    return transact.mutateAsync({
      instructions: [ix],
      invalidateKeys: [["player"]],
      successMessage: `Traveling to ${destName}!`,
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  const handleIntercityComplete = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    const geKey = client.gameEngine;
    const [playerPda] = derivePlayerPda(geKey, publicKey);
    const ix = createIntercityCompleteInstruction({
      player: playerPda,
      gameEngine: geKey,
      owner: publicKey,
    });
    return transact.mutateAsync({
      instructions: [ix],
      invalidateKeys: [["player"]],
      successMessage: "Arrived at destination!",
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  const handleIntercityCancel = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    const geKey = client.gameEngine;
    const [playerPda] = derivePlayerPda(geKey, publicKey);
    const ix = createIntercityCancelInstruction({
      player: playerPda,
      gameEngine: geKey,
      owner: publicKey,
    });
    return transact.mutateAsync({
      instructions: [ix],
      invalidateKeys: [["player"]],
      successMessage: "Travel cancelled!",
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  const handleTeleport = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey || !player || destinationCity == null) throw new Error("Not ready");
    const geKey = client.gameEngine;
    const [playerPda] = derivePlayerPda(geKey, publicKey);
    const [originCityPda] = deriveCityPda(geKey, player.currentCity);
    const [destCityPda] = deriveCityPda(geKey, destinationCity);
    const ix = createIntercityTeleportInstruction({
      player: playerPda,
      originCity: originCityPda,
      destinationCity: destCityPda,
      gameEngine: geKey,
      owner: publicKey,
    });
    const destName = destCityData?.account.name || `City ${destinationCity}`;
    return transact.mutateAsync({
      instructions: [ix],
      invalidateKeys: [["player"]],
      successMessage: `Teleported to ${destName}!`,
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  const handleSpeedup = async (tier: number, reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    const geKey = client.gameEngine;
    const ix = createTravelSpeedupInstruction(
      { owner: publicKey, gameEngine: geKey },
      { speedupTier: tier },
    );
    return transact.mutateAsync({
      instructions: [ix],
      invalidateKeys: [["player"]],
      successMessage: `Travel sped up!`,
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  const handleTravelAndSpeedup = async (tier: number, reportPhase: (p: TxPhase) => void) => {
    if (!publicKey || !player || destinationCity == null) throw new Error("Not ready");
    const geKey = client.gameEngine;
    const [playerPda] = derivePlayerPda(geKey, publicKey);
    const [originCityPda] = deriveCityPda(geKey, player.currentCity);
    const [destCityPda] = deriveCityPda(geKey, destinationCity);
    const startIx = createIntercityStartInstruction({
      player: playerPda, originCity: originCityPda, destinationCity: destCityPda,
      gameEngine: geKey, owner: publicKey,
    });
    const speedupIx = createTravelSpeedupInstruction(
      { owner: publicKey, gameEngine: geKey },
      { speedupTier: tier },
    );
    const destName = destCityData?.account.name || `City ${destinationCity}`;
    return transact.mutateAsync({
      instructions: [startIx, speedupIx],
      invalidateKeys: [["player"]],
      successMessage: `Traveling to ${destName} (sped up)!`,
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  const travelRemaining = travel.traveling
    ? Math.max(0, travel.endsAt - Math.floor(Date.now() / 1000))
    : 0;

  return (
    <div className="space-y-6">
      {/* Current Location */}
      {player && (
        <div className="card accent-border">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs text-text-muted">Current City</div>
              <div className="text-lg font-semibold text-text-primary">
                {currentCityData?.account.name || `City ${player.currentCity}`}
              </div>
              {currentCityData && (
                <div className="text-xs text-text-muted">
                  {CITY_TYPE_LABELS[currentCityData.account.cityType] || "Unknown"} &middot; {currentCityData.account.playersPresent} players
                </div>
              )}
            </div>
            {travel.traveling && (
              <div className="text-right">
                <div className="text-xs text-text-muted">
                  Traveling to {cities?.find((c) => c.account.cityId === player.destinationCity)?.account.name || `City ${player.destinationCity}`}
                </div>
                <GoldCountdown
                  endsAt={travel.endsAt}
                  startedAt={travel.startedAt}
                  showProgress
                  format="compact"
                  size="sm"
                />
              </div>
            )}
          </div>
          {travel.traveling && (
            <div className="mt-3">
              <StatBar
                current={travel.pct}
                max={100}
                color="gold"
                label="Travel Progress"
                showValues={false}
              />
            </div>
          )}
        </div>
      )}

      {/* Active Travel Actions */}
      {travel.traveling && (
        <div className="space-y-4">
          <div className="flex flex-wrap justify-center gap-3">
            {travel.pct >= 100 ? (
              <TxButton onClick={handleIntercityComplete} className="px-8">
                Complete Journey
              </TxButton>
            ) : (
              <TxButton onClick={handleIntercityCancel} variant="danger">
                Cancel Travel
              </TxButton>
            )}
          </div>

          {/* Speedup */}
          {travel.pct < 100 && (
            <SpeedupPanel
              visible
              remainingSeconds={travelRemaining}
              onSpeedup={handleSpeedup}
              gemsPerMinute={ge?.gameplayConfig.gemCostPerMinuteSpeedup ?? 1}
              gemBalance={player?.gems?.toNumber?.()}
            />
          )}
        </div>
      )}

      {/* City Selection */}
      {!travel.traveling && player && (
        <div className="card">
          <h3 className="mb-4 text-xs font-semibold uppercase tracking-wider text-text-muted">
            Choose Destination
          </h3>
          {citiesLoading ? (
            <div className="text-sm text-text-muted">Loading cities...</div>
          ) : !cities || cities.length === 0 ? (
            <div className="text-sm text-text-muted">No cities found.</div>
          ) : (
            <div className="grid gap-3 md:grid-cols-3">
              {cities.map((city) => {
                const isCurrent = city.account.cityId === player.currentCity;
                const isSelected = destinationCity === city.account.cityId;
                return (
                  <button
                    key={city.account.cityId}
                    onClick={() => !isCurrent && setDestinationCity(city.account.cityId)}
                    disabled={isCurrent}
                    className={`rounded-lg border p-4 text-left transition-all ${
                      isCurrent
                        ? "cursor-not-allowed border-zinc-800 opacity-50"
                        : isSelected
                          ? "border-amber-600 bg-amber-900/20"
                          : "border-zinc-800 hover:border-zinc-700"
                    }`}
                  >
                    <div className="text-sm font-semibold text-text-primary">
                      {city.account.name || `City ${city.account.cityId}`}
                    </div>
                    <div className="text-xs text-text-muted">
                      {CITY_TYPE_LABELS[city.account.cityType] || "Unknown"} &middot; {city.account.playersPresent} players
                    </div>
                    {isCurrent && (
                      <div className="mt-1 text-xs text-amber-400">You are here</div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
          {destinationCity != null && destinationCity !== player.currentCity && (
            <div className="mt-4 space-y-3">
              {travelPreview && (
                <div className="rounded-lg border border-zinc-800 bg-surface-overlay p-3 text-sm">
                  <div className="grid grid-cols-3 gap-4 text-center">
                    <div>
                      <div className="text-[10px] uppercase text-text-muted">Distance</div>
                      <div className="text-text-secondary">{travelPreview.distanceKm.toLocaleString()} km</div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase text-text-muted">Est. Travel Time</div>
                      <div className="text-text-gold">{travelPreview.timeStr}</div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase text-text-muted">Teleport Cost</div>
                      <div className="text-text-secondary">{travelPreview.teleportCost.toLocaleString()} NOVI</div>
                    </div>
                  </div>
                  <div className="mt-2 text-center text-[11px] text-text-muted">
                    {travelPreview.todName}
                    {travelPreview.travelMult > 1 && (
                      <span className="ml-1 text-green-400">+{((travelPreview.travelMult - 1) * 100).toFixed(0)}% travel speed bonus</span>
                    )}
                    {travelPreview.travelMult < 1 && (
                      <span className="ml-1 text-amber-400">{((travelPreview.travelMult - 1) * 100).toFixed(0)}% travel speed</span>
                    )}
                  </div>
                </div>
              )}
              <div className="flex flex-wrap justify-center gap-3">
                <TxButton onClick={handleIntercityStart}>
                  Travel to {destCityData?.account.name || `City ${destinationCity}`}
                </TxButton>
                <TxButton
                  onClick={handleTeleport}
                  variant="secondary"
                >
                  Teleport (costs gems)
                </TxButton>
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                <TxButton
                  onClick={(rp) => handleTravelAndSpeedup(1, rp)}
                  variant="secondary"
                  className="text-xs"
                >
                  Travel &amp; Hasten (50% faster, costs gems)
                </TxButton>
                <TxButton
                  onClick={(rp) => handleTravelAndSpeedup(2, rp)}
                  variant="secondary"
                  className="text-xs"
                >
                  Travel &amp; Rush (75% faster, costs gems)
                </TxButton>
              </div>
            </div>
          )}
        </div>
      )}
      {/* Game Parameters */}
      {ge && (() => {
        const gp = ge.gameplayConfig;
        const tiers = ge.subscriptionTiers;
        return (
          <GameInfoPanel>
            <InfoGrid items={[
              ...gp.themeTravelSpeedsKmh.map((s, i) => ({
                label: `Theme ${i} Speed`,
                value: `${Math.round(s)}`,
                suffix: "km/h",
              })),
              { label: "Intracity Speed", value: `${Math.round(gp.intracityTravelSpeedKmh)}`, suffix: "km/h" },
              { label: "Teleport Base Cost", value: gp.teleportBaseCost.toNumber().toLocaleString(), suffix: "NOVI" },
              { label: "Teleport/100km", value: gp.teleportCostPer100km.toNumber().toLocaleString(), suffix: "NOVI" },
              ...tiers.map((t) => ({
                label: `${t.name} Speed Bonus`,
                value: bpsToPercent(t.travelSpeedBonusBps),
              })),
            ]} />
          </GameInfoPanel>
        );
      })()}
    </div>
  );
}
