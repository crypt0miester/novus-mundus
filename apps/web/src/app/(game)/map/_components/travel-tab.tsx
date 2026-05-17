"use client";

import { useState, useMemo, useEffect } from "react";
import { usePlayer } from "@/lib/hooks/usePlayer";
import { useGameEngine } from "@/lib/hooks/useGameEngine";
import { useAllCities } from "@/lib/hooks/useAllCities";
import { useEstate } from "@/lib/hooks/useEstate";
import { BuildingId } from "@/lib/hooks/useFeatureGate";
import { useTravelProgress } from "@/lib/hooks/useDerived";
import { useTransact } from "@/lib/hooks/useTransact";
import { useNovusMundusClient } from "@/lib/solana/provider";
import { useWallet } from "@solana/wallet-adapter-react";
import { GoldCountdown } from "@/components/shared/GoldCountdown";
import { GoldNumber } from "@/components/shared/GoldNumber";
import { StatBar } from "@/components/shared/StatBar";
import { TxButton } from "@/components/shared/TxButton";
import type { TxPhase } from "@/components/shared/TxButton";
import { SpeedupPanel } from "@/components/shared/SpeedupPanel";
import { DetailPanel } from "@/components/shared/DetailPanel";
import { GameInfoPanel } from "@/components/shared/GameInfoPanel";
import { InfoGrid } from "@/components/shared/InfoGrid";
import { bpsToPercent } from "@/lib/utils";
import {
  deriveLocationPda,
  toGrid,
  createIntercityStartInstruction,
  createIntercityCompleteInstruction,
  createIntercityCancelInstruction,
  createIntercityTeleportInstruction,
  createTravelSpeedupInstruction,
  calculateDistance,
  calculateIntercityTravelTime,
  calculateTeleportCost,
  getCurrentTimeOfDay,
  getTimeOfDayName,
  getActivityMultiplier,
  isTraveling,
} from "novus-mundus-sdk";

const CITY_TYPE_LABELS = ["Capital", "Resource", "Combat", "Trade"];

// intercity_teleport requires a Transport Bay (BuildingId.Stables) at this level.
const TELEPORT_TRANSPORT_BAY_LEVEL = 10;

export function TravelTab() {
  const { data: playerData } = usePlayer();
  const { data: geData } = useGameEngine();
  const { data: cities, isLoading: citiesLoading } = useAllCities();
  const { data: estateData } = useEstate();
  const travel = useTravelProgress();

  // Teleport needs a Transport Bay building — gate the button on its level.
  const transportBayLevel = useMemo(() => {
    const buildings = estateData?.account?.buildings;
    if (!buildings) return 0;
    const tb = buildings.find(
      (b: { buildingType: number; status: number; level: number }) =>
        b.buildingType === BuildingId.Stables &&
        (b.status === 2 || b.status === 3),
    );
    return tb?.level ?? 0;
  }, [estateData]);
  const canTeleport = transportBayLevel >= TELEPORT_TRANSPORT_BAY_LEVEL;
  const client = useNovusMundusClient();
  const { publicKey } = useWallet();
  const transact = useTransact();

  const player = playerData?.account;
  const ge = geData?.account;

  const [destinationCity, setDestinationCity] = useState<number | null>(null);
  // The exact landing cell in the destination city — player-picked via the grid.
  const [destCell, setDestCell] = useState<{ gridLat: number; gridLong: number } | null>(null);

  const currentCityData = cities?.find((c) => c.account.cityId === player?.currentCity);
  const destCityData = cities?.find((c) => c.account.cityId === destinationCity);

  const now = Math.floor(Date.now() / 1000);

  const travelPreview = useMemo(() => {
    if (!currentCityData || !destCityData || !ge) return null;
    const origin = currentCityData.account;
    const dest = destCityData.account;

    // City lat/long are already plain degrees (f64) — no fixed-point decode.
    const lat1 = origin.latitude;
    const long1 = origin.longitude;
    const lat2 = dest.latitude;
    const long2 = dest.longitude;

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

  // ── Handlers ──────────────────────────────────────────

  const handleIntercityStart = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey || !player || destinationCity == null) throw new Error("Not ready");
    if (!destCell) throw new Error("Pick a landing cell");
    const geKey = client.gameEngine;
    const ix = createIntercityStartInstruction({
      owner: publicKey,
      gameEngine: geKey,
      originCityId: player.currentCity,
      destinationCityId: destinationCity,
      destGridLat: destCell.gridLat,
      destGridLong: destCell.gridLong,
      originLocation: deriveLocationPda(
        geKey, player.currentCity, toGrid(player.currentLat), toGrid(player.currentLong),
      )[0],
      destinationLocation: deriveLocationPda(
        geKey, destinationCity, destCell.gridLat, destCell.gridLong,
      )[0],
      originCreatorRefund: ge?.authority ?? publicKey,
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
    if (!publicKey || !player) throw new Error("Not ready");
    const geKey = client.gameEngine;
    const ix = createIntercityCompleteInstruction({
      owner: publicKey,
      gameEngine: geKey,
      originCityId: player.currentCity,
      destinationCityId: player.destinationCity,
      destinationLocation: deriveLocationPda(
        geKey, player.destinationCity, toGrid(player.travelingToLat), toGrid(player.travelingToLong),
      )[0],
    });
    return transact.mutateAsync({
      instructions: [ix],
      invalidateKeys: [["player"]],
      successMessage: "Arrived at destination!",
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  const handleIntercityCancel = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey || !player) throw new Error("Not ready");
    const originCity = currentCityData?.account;
    if (!originCity) throw new Error("Origin city not loaded");
    const geKey = client.gameEngine;
    const ix = createIntercityCancelInstruction({
      owner: publicKey,
      gameEngine: geKey,
      originCityId: player.currentCity,
      destinationCityId: player.destinationCity,
      originLocation: deriveLocationPda(
        geKey, player.currentCity,
        toGrid(originCity.latitude),
        toGrid(originCity.longitude),
      )[0],
      destinationLocation: deriveLocationPda(
        geKey, player.destinationCity, toGrid(player.travelingToLat), toGrid(player.travelingToLong),
      )[0],
      destinationCreatorRefund: ge?.authority ?? publicKey,
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
    if (!destCell) throw new Error("Pick a landing cell");
    const geKey = client.gameEngine;
    const ix = createIntercityTeleportInstruction({
      owner: publicKey,
      gameEngine: geKey,
      originCityId: player.currentCity,
      destinationCityId: destinationCity,
      originLocation: deriveLocationPda(
        geKey, player.currentCity, toGrid(player.currentLat), toGrid(player.currentLong),
      )[0],
      destinationLocation: deriveLocationPda(
        geKey, destinationCity, destCell.gridLat, destCell.gridLong,
      )[0],
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
      { speedupTier: tier as 1 | 2 },
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
    if (!destCell) throw new Error("Pick a landing cell");
    const geKey = client.gameEngine;
    const startIx = createIntercityStartInstruction({
      owner: publicKey,
      gameEngine: geKey,
      originCityId: player.currentCity,
      destinationCityId: destinationCity,
      destGridLat: destCell.gridLat,
      destGridLong: destCell.gridLong,
      originLocation: deriveLocationPda(
        geKey, player.currentCity, toGrid(player.currentLat), toGrid(player.currentLong),
      )[0],
      destinationLocation: deriveLocationPda(
        geKey, destinationCity, destCell.gridLat, destCell.gridLong,
      )[0],
      originCreatorRefund: ge?.authority ?? publicKey,
    });
    const speedupIx = createTravelSpeedupInstruction(
      { owner: publicKey, gameEngine: geKey },
      { speedupTier: tier as 1 | 2 },
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

  // ── Render ──────────────────────────────────────────

  return (
    <div className="space-y-4">
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

      {/* City Selection — 2-column with sidebar detail */}
      {!travel.traveling && player && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {/* Left: city list */}
          <div className="lg:col-span-2">
            <div className="card">
              <h3 className="mb-4 text-xs font-semibold uppercase tracking-wider text-text-muted">
                Choose Destination
              </h3>
              {citiesLoading ? (
                <div className="text-sm text-text-muted">Loading cities...</div>
              ) : !cities || cities.length === 0 ? (
                <div className="text-sm text-text-muted">No cities found.</div>
              ) : (
                <div className="space-y-2">
                  {cities.map((city) => {
                    const isCurrent = city.account.cityId === player.currentCity;
                    const isSelected = destinationCity === city.account.cityId;
                    const origin = currentCityData?.account;
                    const dest = city.account;

                    let distKm: number | null = null;
                    if (origin && !isCurrent) {
                      distKm = Math.round(
                        calculateDistance(
                          origin.latitude,
                          origin.longitude,
                          dest.latitude,
                          dest.longitude,
                        ),
                      );
                    }

                    return (
                      <button
                        key={city.account.cityId}
                        onClick={() => {
                          if (!isCurrent) {
                            setDestinationCity(city.account.cityId);
                            setDestCell(null);
                          }
                        }}
                        disabled={isCurrent}
                        className={`w-full rounded-lg border p-3 text-left transition-all ${
                          isCurrent
                            ? "cursor-not-allowed border-zinc-800 opacity-50"
                            : isSelected
                              ? "border-amber-600 bg-amber-900/20 ring-1 ring-amber-600/30"
                              : "border-zinc-800 hover:border-zinc-700"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="text-sm font-semibold text-text-primary">
                              {city.account.name || `City ${city.account.cityId}`}
                            </div>
                            <div className="flex items-center gap-2 text-[10px] text-text-muted">
                              <span>{CITY_TYPE_LABELS[city.account.cityType] || "Unknown"}</span>
                              <span>&middot;</span>
                              <span>{city.account.playersPresent} players</span>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {isCurrent && (
                              <span className="rounded-full bg-amber-900/30 px-2 py-0.5 text-[10px] font-semibold text-amber-400">
                                YOU ARE HERE
                              </span>
                            )}
                            {distKm != null && (
                              <span className="text-xs text-text-muted font-mono">
                                {distKm.toLocaleString()} km
                              </span>
                            )}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Right: destination detail panel */}
          <DetailPanel
            open={destinationCity != null && destinationCity !== player.currentCity}
            onClose={() => {
              setDestinationCity(null);
              setDestCell(null);
            }}
          >
            {destCityData && (
              <>
                {/* Destination header */}
                <div className="text-center">
                  <div className="text-lg font-bold text-text-gold">
                    {destCityData.account.name || `City ${destinationCity}`}
                  </div>
                  <div className="text-xs text-text-muted">
                    {CITY_TYPE_LABELS[destCityData.account.cityType] || "Unknown"}
                  </div>
                </div>

                {/* City stats */}
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-lg bg-surface/60 px-3 py-2 text-center">
                    <div className="text-[10px] text-text-muted">Players</div>
                    <div className="font-mono text-sm font-bold text-text-primary">
                      {destCityData.account.playersPresent}
                    </div>
                  </div>
                  <div className="rounded-lg bg-surface/60 px-3 py-2 text-center">
                    <div className="text-[10px] text-text-muted">Encounters</div>
                    <div className="font-mono text-sm font-bold text-text-primary">
                      {destCityData.account.activeEncounters?.toNumber() ?? "—"}
                    </div>
                  </div>
                </div>

                {/* Travel preview */}
                {travelPreview && (
                  <div className="space-y-2">
                    <div className="grid grid-cols-3 gap-2">
                      <div className="rounded-lg bg-surface/60 px-2 py-2 text-center">
                        <div className="text-[10px] text-text-muted">Distance</div>
                        <div className="text-xs font-bold text-text-secondary">
                          {travelPreview.distanceKm.toLocaleString()} km
                        </div>
                      </div>
                      <div className="rounded-lg bg-surface/60 px-2 py-2 text-center">
                        <div className="text-[10px] text-text-muted">Travel Time</div>
                        <div className="text-xs font-bold text-text-gold">
                          {travelPreview.timeStr}
                        </div>
                      </div>
                      <div className="rounded-lg bg-surface/60 px-2 py-2 text-center">
                        <div className="text-[10px] text-text-muted">Teleport</div>
                        <div className="text-xs font-bold text-text-secondary">
                          <GoldNumber value={travelPreview.teleportCost} size="sm" /> NOVI
                        </div>
                      </div>
                    </div>

                    {/* Time-of-day bonus */}
                    <div className="text-center text-[10px] text-text-muted">
                      {travelPreview.todName}
                      {travelPreview.travelMult > 1 && (
                        <span className="ml-1 text-green-400">+{((travelPreview.travelMult - 1) * 100).toFixed(0)}% travel speed</span>
                      )}
                      {travelPreview.travelMult < 1 && (
                        <span className="ml-1 text-amber-400">{((travelPreview.travelMult - 1) * 100).toFixed(0)}% travel speed</span>
                      )}
                    </div>
                  </div>
                )}

                {/* Landing cell picker — choose where to arrive in the destination city */}
                <DestinationCellGrid
                  cityId={destCityData.account.cityId}
                  centerGridLat={toGrid(destCityData.account.latitude)}
                  centerGridLong={toGrid(destCityData.account.longitude)}
                  selected={destCell}
                  onSelect={(gridLat, gridLong) => setDestCell({ gridLat, gridLong })}
                />

                {/* Action buttons */}
                <div className="space-y-2">
                  <TxButton onClick={handleIntercityStart} disabled={!destCell} className="w-full py-3 text-base font-bold">
                    Travel
                  </TxButton>
                  {canTeleport ? (
                    <TxButton onClick={handleTeleport} disabled={!destCell} variant="secondary" className="w-full text-xs">
                      Teleport (instant, costs NOVI)
                    </TxButton>
                  ) : (
                    <p className="rounded-lg border border-zinc-800 bg-surface/60 px-3 py-2 text-center text-[11px] text-text-muted">
                      Teleport needs a Transport Bay building at Lv {TELEPORT_TRANSPORT_BAY_LEVEL}
                      {transportBayLevel > 0 ? ` — yours is Lv ${transportBayLevel}.` : "."}
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <TxButton
                    onClick={(rp) => handleTravelAndSpeedup(1, rp)}
                    disabled={!destCell}
                    variant="secondary"
                    className="w-full text-xs"
                  >
                    Travel + Hasten (50% faster, costs gems)
                  </TxButton>
                  <TxButton
                    onClick={(rp) => handleTravelAndSpeedup(2, rp)}
                    disabled={!destCell}
                    variant="secondary"
                    className="w-full text-xs"
                  >
                    Travel + Rush (75% faster, costs gems)
                  </TxButton>
                </div>
              </>
            )}
          </DetailPanel>
        </div>
      )}

      {/* Game Parameters */}
      {ge && (() => {
        const gp = ge.gameplayConfig;
        const tiers = ge.subscriptionTiers;
        return (
          <GameInfoPanel>
            <InfoGrid items={[
              ...gp.themeTravelSpeedsKmh.map((s: number, i: number) => ({
                label: `Theme ${i} Speed`,
                value: `${Math.round(s)}`,
                suffix: "km/h",
              })),
              { label: "Intracity Speed", value: `${Math.round(gp.intracityTravelSpeedKmh)}`, suffix: "km/h" },
              { label: "Teleport Base Cost", value: gp.teleportBaseCost.toNumber().toLocaleString(), suffix: "NOVI" },
              { label: "Teleport/100km", value: gp.teleportCostPer100km.toNumber().toLocaleString(), suffix: "NOVI" },
              ...tiers.map((t: any) => ({
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

// Destination cell grid: a 5x5 block of candidate landing cells around the
// destination city centre. The player picks one empty cell to land in.
function DestinationCellGrid({
  cityId,
  centerGridLat,
  centerGridLong,
  selected,
  onSelect,
}: {
  cityId: number;
  centerGridLat: number;
  centerGridLong: number;
  selected: { gridLat: number; gridLong: number } | null;
  onSelect: (gridLat: number, gridLong: number) => void;
}) {
  const client = useNovusMundusClient();
  const ge = client.gameEngine;

  const cells = useMemo(() => {
    const result: { gridLat: number; gridLong: number }[] = [];
    for (const dy of [2, 1, 0, -1, -2]) {
      for (const dx of [-2, -1, 0, 1, 2]) {
        result.push({ gridLat: centerGridLat + dy, gridLong: centerGridLong + dx });
      }
    }
    return result;
  }, [centerGridLat, centerGridLong]);

  const [occupancy, setOccupancy] = useState<(boolean | null)[]>(() => new Array(25).fill(null));

  useEffect(() => {
    let cancelled = false;
    const pdas = cells.map((c) => deriveLocationPda(ge, cityId, c.gridLat, c.gridLong)[0]);
    client.connection
      .getMultipleAccountsInfo(pdas)
      .then((accts) => {
        if (!cancelled) setOccupancy(accts.map((a) => a !== null));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [cells, ge, cityId, client]);

  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
        Landing Cell
      </div>
      <div className="mt-1 grid grid-cols-5 gap-1">
        {cells.map((cell, i) => {
          const occupied = occupancy[i];
          const loading = occupied === null;
          const isEmpty = occupied === false;
          const isCenter = i === 12;
          const isSelected =
            selected != null &&
            selected.gridLat === cell.gridLat &&
            selected.gridLong === cell.gridLong;

          let style: string;
          if (isSelected) {
            style = "border-amber-500 bg-amber-900/40 text-amber-300 ring-1 ring-amber-500/50";
          } else if (loading) {
            style = "border-zinc-800 bg-surface/40 text-zinc-600 animate-pulse";
          } else if (!isEmpty) {
            style = "border-zinc-800 bg-zinc-900/50 text-zinc-700 opacity-50";
          } else {
            style = "border-green-800 bg-green-900/10 text-green-500 hover:bg-green-900/30 cursor-pointer";
          }

          return (
            <button
              key={i}
              type="button"
              disabled={!isEmpty}
              onClick={() => isEmpty && onSelect(cell.gridLat, cell.gridLong)}
              className={`aspect-square rounded border text-[10px] font-mono transition-all ${style}`}
            >
              {loading ? "" : isSelected ? "X" : !isEmpty ? "·" : isCenter ? "+" : ""}
            </button>
          );
        })}
      </div>
      <div className="mt-1 flex flex-wrap gap-x-3 text-[9px] text-text-muted">
        <span className="text-amber-300">X selected</span>
        <span className="text-green-500">+ city centre</span>
        <span className="text-zinc-600">· occupied</span>
      </div>
    </div>
  );
}
