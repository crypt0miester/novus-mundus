"use client";

import { useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import { useWallet } from "@solana/wallet-adapter-react";
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
  ActivityType,
} from "novus-mundus-sdk";
import { usePlayer } from "@/lib/hooks/usePlayer";
import { useGameEngine } from "@/lib/hooks/useGameEngine";
import { useAllCities } from "@/lib/hooks/useAllCities";
import { useEstate } from "@/lib/hooks/useEstate";
import { useTravelProgress } from "@/lib/hooks/useDerived";
import { useChainNow } from "@/lib/hooks/useChainTime";
import { useTransact } from "@/lib/hooks/useTransact";
import { useMorphActions } from "@/lib/hooks/useMorphActions";
import { useNovusMundusClient } from "@/lib/solana/provider";
import type { PanelAction } from "@/lib/store/right-panel";
import { BuildingId } from "@/lib/buildings";
import { GoldCountdown } from "@/components/shared/GoldCountdown";
import { TxButton, type TxPhase } from "@/components/shared/TxButton";
import { SpeedupPanel, maxSpeedupCount } from "@/components/shared/SpeedupPanel";
import { formatTime } from "@/lib/utils";
import {
  RealmMap,
  realmMapStyles as styles,
  type RealmMapSelectedContext,
} from "@/components/world/RealmMap";
import { DestinationCellGrid } from "@/components/world/DestinationCellGrid";

const TYPE_META = [
  { label: "Capital", glyph: "♛" },
  { label: "Resource", glyph: "⛏" },
  { label: "Combat", glyph: "⚔" },
  { label: "Trade", glyph: "◆" },
] as const;
const typeIdx = (t: number) => Math.max(0, Math.min(3, t | 0));

// intercity_teleport requires a Stable (BuildingId.Stables) at this level.
const TELEPORT_STABLE_LEVEL = 10;

// Shared styling for the travel-gate hints under the realm-map CTAs.
const TRAVEL_NOTE_STYLE = {
  marginTop: "0.6rem",
  fontSize: "0.65rem",
  fontStyle: "italic",
  color: "var(--ink-soft)",
  textAlign: "center",
} as const;

export function MapTab() {
  const { publicKey } = useWallet();
  const { data: playerData } = usePlayer();
  const { data: geData } = useGameEngine();
  const { data: cities } = useAllCities();
  const { data: estateData } = useEstate();
  const travel = useTravelProgress();
  const client = useNovusMundusClient();
  const transact = useTransact();

  const player = playerData?.account;
  const ge = geData?.account;

  const [destinationCity, setDestinationCity] = useState<number | null>(null);
  const [destCell, setDestCell] = useState<{
    gridLat: number;
    gridLong: number;
  } | null>(null);

  const stableLevel = useMemo(() => {
    const buildings = estateData?.account?.buildings;
    if (!buildings) return 0;
    const tb = buildings.find(
      (b: { buildingType: number; status: number; level: number }) =>
        b.buildingType === BuildingId.Stables && (b.status === 2 || b.status === 3),
    );
    return tb?.level ?? 0;
  }, [estateData]);
  const canTeleport = stableLevel >= TELEPORT_STABLE_LEVEL;
  // The chain hard-gates intercity travel on a Stable (intercity_start.rs:
  // `require_stables(estate, 1)`) — mirror it so the CTAs never offer a tx
  // the program will reject.
  const hasStables = stableLevel >= 1;

  const currentCityData = cities?.find((c) => c.account.cityId === player?.currentCity);
  const destCityData = cities?.find((c) => c.account.cityId === destinationCity);

  // Chain-anchored time — the travel multiplier the player sees must match
  // what `intercity_start.rs` computes from `Clock::unix_timestamp`.
  const chainNow = useChainNow();

  const travelPreview = useMemo(() => {
    if (!currentCityData || !destCityData || !ge) return null;
    const origin = currentCityData.account;
    const dest = destCityData.account;
    const distanceKm = calculateDistance(
      origin.latitude,
      origin.longitude,
      dest.latitude,
      dest.longitude,
    );
    const baseSpeedKmh = ge.gameplayConfig?.themeTravelSpeedsKmh?.[0] ?? 50;
    const travelTimeSec = calculateIntercityTravelTime(distanceKm, baseSpeedKmh);
    const baseTeleportCost = ge.gameplayConfig?.teleportBaseCost?.toNumber?.() ?? 100_000;
    const costPer100km = ge.gameplayConfig?.teleportCostPer100km?.toNumber?.() ?? 10_000;
    const teleportCost = calculateTeleportCost(distanceKm, baseTeleportCost, costPer100km);
    const tod = getCurrentTimeOfDay(chainNow, origin.longitude);
    const travelMult = getActivityMultiplier(ActivityType.Traveling, tod);
    return {
      distanceKm: Math.round(distanceKm),
      travelTimeSec,
      timeStr: formatTime(travelTimeSec, "compact"),
      teleportCost,
      todName: getTimeOfDayName(tod),
      travelMult,
    };
  }, [currentCityData, destCityData, ge, chainNow]);

  const startTravel = async (reportPhase: (p: TxPhase) => void) => {
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
        geKey,
        player.currentCity,
        toGrid(player.currentLat),
        toGrid(player.currentLong),
      )[0],
      destinationLocation: deriveLocationPda(
        geKey,
        destinationCity,
        destCell.gridLat,
        destCell.gridLong,
      )[0],
      originCreatorRefund: ge?.authority ?? publicKey,
    });
    const destName = destCityData?.account.name ?? `City ${destinationCity}`;
    const res = await transact.mutateAsync({
      instructions: [ix],
      invalidateKeys: [["player"]],
      successMessage: `Traveling to ${destName}!`,
      onPhase: reportPhase,
    });
    // Clear the destination selection so the map drops back to renderDefault —
    // the "En route" panel — instead of the now-stale selected-city view.
    setDestinationCity(null);
    setDestCell(null);
    return res.signature;
  };

  const completeTravel = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey || !player) throw new Error("Not ready");
    const geKey = client.gameEngine;
    // intercity_cancel sends the player back to the origin city CENTRE and
    // sets destination_city = current_city, but leaves traveling_to_lat/long
    // pointing at the original forward destination. On that return leg the
    // reserved cell is the city centre — deriving from traveling_to_lat/long
    // would pass a non-existent (System-owned) PDA and the ix would fail.
    const returningHome = player.destinationCity === player.currentCity;
    const homeCity = currentCityData?.account;
    if (returningHome && !homeCity) throw new Error("Origin city not loaded");
    const ix = createIntercityCompleteInstruction({
      owner: publicKey,
      gameEngine: geKey,
      originCityId: player.currentCity,
      destinationCityId: player.destinationCity,
      destinationLocation: deriveLocationPda(
        geKey,
        player.destinationCity,
        toGrid(returningHome ? homeCity!.latitude : player.travelingToLat),
        toGrid(returningHome ? homeCity!.longitude : player.travelingToLong),
      )[0],
    });
    return transact
      .mutateAsync({
        instructions: [ix],
        invalidateKeys: [["player"]],
        successMessage: "Arrived at destination!",
        onPhase: reportPhase,
      })
      .then((r) => r.signature);
  };

  const cancelTravel = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey || !player) throw new Error("Not ready");
    const origin = currentCityData?.account;
    if (!origin) throw new Error("Origin city not loaded");
    const geKey = client.gameEngine;
    const ix = createIntercityCancelInstruction({
      owner: publicKey,
      gameEngine: geKey,
      originCityId: player.currentCity,
      destinationCityId: player.destinationCity,
      originLocation: deriveLocationPda(
        geKey,
        player.currentCity,
        toGrid(origin.latitude),
        toGrid(origin.longitude),
      )[0],
      destinationLocation: deriveLocationPda(
        geKey,
        player.destinationCity,
        toGrid(player.travelingToLat),
        toGrid(player.travelingToLong),
      )[0],
      // intercity_start stamps the destination cell's location_creator with
      // the traveling player's wallet and intercity_cancel refunds its rent
      // there — any other account trips GameError::InvalidParameter (6007).
      destinationCreatorRefund: publicKey,
    });
    return transact
      .mutateAsync({
        instructions: [ix],
        invalidateKeys: [["player"]],
        successMessage: "Travel cancelled!",
        onPhase: reportPhase,
      })
      .then((r) => r.signature);
  };

  const teleport = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey || !player || destinationCity == null) throw new Error("Not ready");
    if (!destCell) throw new Error("Pick a landing cell");
    const geKey = client.gameEngine;
    const ix = createIntercityTeleportInstruction({
      owner: publicKey,
      gameEngine: geKey,
      originCityId: player.currentCity,
      destinationCityId: destinationCity,
      originLocation: deriveLocationPda(
        geKey,
        player.currentCity,
        toGrid(player.currentLat),
        toGrid(player.currentLong),
      )[0],
      destinationLocation: deriveLocationPda(
        geKey,
        destinationCity,
        destCell.gridLat,
        destCell.gridLong,
      )[0],
    });
    const destName = destCityData?.account.name ?? `City ${destinationCity}`;
    const res = await transact.mutateAsync({
      instructions: [ix],
      invalidateKeys: [["player"]],
      successMessage: `Teleported to ${destName}!`,
      onPhase: reportPhase,
    });
    // Arrived — drop the stale destination selection (see startTravel).
    setDestinationCity(null);
    setDestCell(null);
    return res.signature;
  };

  const speedup = async (tier: number, reportPhase: (p: TxPhase) => void, count: number = 1) => {
    if (!publicKey) throw new Error("Wallet not connected");
    // Hold-to-charge packs `count` speedups into one tx; each reads the live timer.
    const n = Math.max(1, Math.floor(count));
    const instructions = Array.from({ length: n }, () =>
      createTravelSpeedupInstruction(
        { owner: publicKey, gameEngine: client.gameEngine },
        { speedupTier: tier as 1 | 2 },
      ),
    );
    return transact
      .mutateAsync({
        instructions,
        invalidateKeys: [["player"]],
        successMessage: n > 1 ? `Travel sped up ×${n}!` : "Travel sped up!",
        onPhase: reportPhase,
      })
      .then((r) => r.signature);
  };

  const startAndSpeedup = async (tier: number, reportPhase: (p: TxPhase) => void) => {
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
        geKey,
        player.currentCity,
        toGrid(player.currentLat),
        toGrid(player.currentLong),
      )[0],
      destinationLocation: deriveLocationPda(
        geKey,
        destinationCity,
        destCell.gridLat,
        destCell.gridLong,
      )[0],
      originCreatorRefund: ge?.authority ?? publicKey,
    });
    const speedupIx = createTravelSpeedupInstruction(
      { owner: publicKey, gameEngine: geKey },
      { speedupTier: tier as 1 | 2 },
    );
    const destName = destCityData?.account.name ?? `City ${destinationCity}`;
    const res = await transact.mutateAsync({
      instructions: [startIx, speedupIx],
      invalidateKeys: [["player"]],
      successMessage: `Traveling to ${destName} (sped up)!`,
      onPhase: reportPhase,
    });
    // Travel started — drop the selection so the "En route" panel shows.
    setDestinationCity(null);
    setDestCell(null);
    return res.signature;
  };

  const travelRemaining = travel.traveling
    ? Math.max(0, travel.endsAt - Math.floor(Date.now() / 1000))
    : 0;

  // Hold-to-charge caps for the in-transit speedup tiers — how many speedup
  // instructions one tx can usefully hold (timer-collapse ∧ gem affordability).
  // Travel: T1 leaves 50% of time / 1x cost, T2 leaves 25% / 2x cost.
  const travelGemsPerMinute = ge?.gameplayConfig.gemCostPerMinuteSpeedup ?? 1;
  const travelGemBalance = player?.gems?.toNumber?.() ?? 0;
  const speedupTiers = [
    {
      tier: 1,
      label: "Hasten",
      description: "50% time reduction",
      maxCount: maxSpeedupCount({
        remainingSeconds: travelRemaining,
        timeMultiplier: 0.5,
        costMultiplier: 1,
        gemsPerMinute: travelGemsPerMinute,
        gemBalance: travelGemBalance,
      }),
    },
    {
      tier: 2,
      label: "Rush",
      description: "75% time reduction",
      maxCount: maxSpeedupCount({
        remainingSeconds: travelRemaining,
        timeMultiplier: 0.25,
        costMultiplier: 2,
        gemsPerMinute: travelGemsPerMinute,
        gemBalance: travelGemBalance,
      }),
    },
  ];

  // Mobile surfaces the travel CTAs through the MorphTabBar — the realm-map
  // scroll panel is desktop-only for actions (its inline buttons are hidden
  // below md). Rebuilt each render; useMorphActions diffs before registering.
  const morphActions: PanelAction[] = [];
  if (travel.traveling) {
    if (travel.pct >= 100) {
      morphActions.push({
        id: "complete",
        label: "Step through the gate",
        onClick: completeTravel,
        variant: "primary",
      });
    } else {
      morphActions.push({
        id: "turn-back",
        label: "Turn back",
        onClick: cancelTravel,
        variant: "danger",
      });
    }
  } else if (destinationCity != null && destinationCity !== player?.currentCity) {
    morphActions.push(
      {
        id: "walk",
        label: "Walk",
        onClick: startTravel,
        variant: "primary",
        disabled: !destCell || !hasStables,
      },
      {
        id: "hasten",
        label: "Hasten",
        onClick: (rp) => startAndSpeedup(1, rp),
        variant: "secondary",
        disabled: !destCell || !hasStables,
      },
      {
        id: "rush",
        label: "Rush",
        onClick: (rp) => startAndSpeedup(2, rp),
        variant: "secondary",
        disabled: !destCell || !hasStables,
      },
    );
    if (canTeleport) {
      morphActions.push({
        id: "teleport",
        label: "Teleport",
        onClick: teleport,
        variant: "secondary",
        disabled: !destCell,
      });
    }
    // Back out of a chosen destination — without it the bar morphs to travel
    // actions with no way back to the nav tabs. `kind: "dismiss"` makes the
    // morph bar render it as a circle in the same slot as nav mode's `+`.
    morphActions.push({
      id: "cancel",
      kind: "dismiss",
      label: "✕",
      onClick: async () => {
        setDestinationCity(null);
        setDestCell(null);
        return "";
      },
    });
  }
  useMorphActions(morphActions);

  const renderSelected = ({ node, isHome }: RealmMapSelectedContext) => {
    const meta = TYPE_META[typeIdx(node.city.cityType)];
    const isCurrent = node.city.cityId === player?.currentCity;
    const inFlight = travel.traveling;

    return (
      <>
        <div className={styles.detailName}>{node.city.name}</div>
        <span className={`${styles.detailType} ${isHome ? styles.home : ""}`}>
          <span className={styles.glyph}>{meta.glyph}</span>
          {meta.label}
          {isHome ? " — your seat" : ""}
        </span>

        <dl className={styles.lineMeta}>
          <dt>People present</dt>
          <dd className={styles.numeral}>{node.city.playersPresent.toLocaleString()}</dd>
          <dt>Wilds about it</dt>
          <dd className={styles.numeral}>
            lv {node.city.minEncounterLevel}–{node.city.maxEncounterLevel}
          </dd>
          {!isCurrent && travelPreview && (
            <>
              <dt>Road by foot</dt>
              <dd className={styles.numeral}>
                {travelPreview.distanceKm.toLocaleString()} km · {travelPreview.timeStr}
              </dd>
              <dt>By the stables</dt>
              <dd className={styles.numeral}>{travelPreview.teleportCost.toLocaleString()} NOVI</dd>
            </>
          )}
        </dl>

        {!isCurrent && travelPreview && (
          <p
            style={{
              fontStyle: "italic",
              fontSize: "0.7rem",
              color: "var(--ink-soft)",
              margin: "0.6rem 0 0.4rem",
            }}
          >
            {travelPreview.todName}
            {travelPreview.travelMult > 1 &&
              ` · the hour favours travel (+${Math.round((travelPreview.travelMult - 1) * 100)}%)`}
            {travelPreview.travelMult < 1 &&
              ` · the hour slows the road (${Math.round((travelPreview.travelMult - 1) * 100)}%)`}
          </p>
        )}

        {isCurrent ? (
          <p
            style={{
              marginTop: "0.9rem",
              padding: "0.7rem 0.85rem",
              border: "1px dashed var(--ink-faint)",
              fontSize: "0.74rem",
              color: "var(--ink-soft)",
              fontStyle: "italic",
            }}
          >
            This is your seat. Touch another city to set out.
          </p>
        ) : inFlight ? (
          <p
            style={{
              marginTop: "0.9rem",
              padding: "0.7rem 0.85rem",
              border: "1px dashed var(--seal)",
              color: "var(--seal)",
              fontSize: "0.74rem",
              fontStyle: "italic",
            }}
          >
            You are already on the road. Finish that journey before another.
          </p>
        ) : (
          <>
            <div style={{ marginTop: "1rem" }}>
              <DestinationCellGrid
                cityId={node.city.cityId}
                centerGridLat={toGrid(node.city.latitude)}
                centerGridLong={toGrid(node.city.longitude)}
                selected={destCell}
                onSelect={(gridLat, gridLong) => setDestCell({ gridLat, gridLong })}
              />
            </div>

            {/* Desktop keeps the inline CTAs; on mobile they're hidden and
                the MorphTabBar carries them (see useMorphActions above). */}
            <div className="hidden md:block">
              <div style={{ marginTop: "0.9rem" }}>
                <TxButton
                  onClick={startTravel}
                  disabled={!destCell || !hasStables}
                  className={styles.seal}
                >
                  <span>Walk the road</span>
                  <span><ChevronRight className="h-3.5 w-3.5" /></span>
                </TxButton>
              </div>

              <div
                style={{
                  marginTop: "0.6rem",
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: "0.4rem",
                }}
              >
                <TxButton
                  onClick={(rp) => startAndSpeedup(1, rp)}
                  disabled={!destCell || !hasStables}
                  variant="secondary"
                  className="w-full text-xs"
                >
                  Hasten (+50%)
                </TxButton>
                <TxButton
                  onClick={(rp) => startAndSpeedup(2, rp)}
                  disabled={!destCell || !hasStables}
                  variant="secondary"
                  className="w-full text-xs"
                >
                  Rush (+75%)
                </TxButton>
              </div>

              {canTeleport && (
                <div style={{ marginTop: "0.5rem" }}>
                  <TxButton
                    onClick={teleport}
                    disabled={!destCell}
                    variant="secondary"
                    className="w-full text-xs"
                  >
                    Teleport (instant · NOVI)
                  </TxButton>
                </div>
              )}
            </div>

            {!hasStables ? (
              <p style={TRAVEL_NOTE_STYLE}>
                No road will carry you yet — raise a Stable on your estate to set out.
              </p>
            ) : !canTeleport ? (
              <p style={TRAVEL_NOTE_STYLE}>
                A Stable at level {TELEPORT_STABLE_LEVEL} would let the horses make this journey at
                once (yours is lv {stableLevel}).
              </p>
            ) : null}
          </>
        )}
      </>
    );
  };

  const renderDefault = () => {
    if (travel.traveling) {
      const destName =
        cities?.find((c) => c.account.cityId === player?.destinationCity)?.account.name ??
        `City ${player?.destinationCity}`;
      const arrived = travel.pct >= 100;
      return (
        <>
          <div className={styles.detailName}>En route</div>
          <span className={styles.detailType}>
            <span className={styles.glyph}>↣</span>
            to {destName}
          </span>
          <div style={{ marginTop: "0.9rem" }}>
            <GoldCountdown
              endsAt={travel.endsAt}
              startedAt={travel.startedAt}
              showProgress
              format="compact"
              size="md"
            />
          </div>
          {/* Desktop only — on mobile the MorphTabBar carries these. */}
          <div className="hidden md:block" style={{ marginTop: "1rem" }}>
            {arrived ? (
              <TxButton onClick={completeTravel} className={styles.seal}>
                <span>Step through the gate</span>
                <span><ChevronRight className="h-3.5 w-3.5" /></span>
              </TxButton>
            ) : (
              <TxButton onClick={cancelTravel} variant="danger" className="w-full text-xs">
                Turn back
              </TxButton>
            )}
          </div>
          {!arrived && (
            <div style={{ marginTop: "0.8rem" }}>
              <SpeedupPanel
                visible
                remainingSeconds={travelRemaining}
                tiers={speedupTiers}
                onSpeedup={(tier, rp, count) => speedup(tier, rp, count)}
                gemsPerMinute={ge?.gameplayConfig.gemCostPerMinuteSpeedup ?? 1}
                gemBalance={player?.gems?.toNumber?.()}
              />
            </div>
          )}
        </>
      );
    }
    return (
      <>
        <div className={styles.detailName}>The chart</div>
        <p
          style={{
            marginTop: "0.6rem",
            fontStyle: "italic",
            fontSize: "0.78rem",
            color: "var(--ink-soft)",
            lineHeight: 1.5,
          }}
        >
          Touch a city to weigh the road — its distance, the hour, what the horses ask.
        </p>
        {currentCityData && (
          <dl className={styles.lineMeta} style={{ marginTop: "1rem" }}>
            <dt>Your seat</dt>
            <dd>{currentCityData.account.name}</dd>
            <dt>City type</dt>
            <dd>{TYPE_META[typeIdx(currentCityData.account.cityType)]?.label}</dd>
          </dl>
        )}
      </>
    );
  };

  return (
    <RealmMap
      selectedId={destinationCity}
      onSelectChange={(id) => {
        setDestinationCity(id);
        setDestCell(null);
      }}
      renderSelected={renderSelected}
      renderDefault={renderDefault}
      scrollHead={travel.traveling ? "the journey" : destinationCity ? "the road" : "the chart"}
    />
  );
}
