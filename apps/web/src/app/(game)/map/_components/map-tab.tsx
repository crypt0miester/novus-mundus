"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import { useWallet } from "@solana/wallet-adapter-react";
import {
  deriveLocationPda,
  derivePlayerPda,
  deriveLootPda,
  toGrid,
  createIntercityStartInstruction,
  createIntercityCompleteInstruction,
  createIntercityCancelInstruction,
  createIntercityTeleportInstruction,
  createIntracityStartInstruction,
  createIntracityCompleteInstruction,
  createIntracityCancelInstruction,
  createTravelSpeedupInstruction,
  createAttackEncounterInstruction,
  createAttackPlayerInstruction,
  calculateDistance,
  calculateDistanceMeters,
  calculateIntercityTravelTime,
  calculateTeleportCost,
  getCurrentTimeOfDay,
  getTimeOfDayName,
  getActivityMultiplier,
  getEncounterStaminaCost,
  getTotalDefensiveUnits,
  ENCOUNTER_ATTACK_RANGE_METERS,
  ActivityType,
  SubscriptionTier,
  EncounterType,
  TravelType,
  deciToNovi,
} from "novus-mundus-sdk";
import { useWorldPlayers } from "@/lib/hooks/world";
import { useCityPlayers } from "@/lib/hooks/useCityPlayers";
import { useEncounters } from "@/lib/hooks/useEncounters";
import { usePlayer } from "@/lib/hooks/usePlayer";
import { useGameEngine } from "@/lib/hooks/useGameEngine";
import { useAllCities } from "@/lib/hooks/useAllCities";
import { useEstate } from "@/lib/hooks/useEstate";
import { useTravelProgress } from "@/lib/hooks/useDerived";
import { useChainNow } from "@/lib/hooks/useChainTime";
import { useTransact } from "@/lib/hooks/useTransact";
import { useMorphActions } from "@/lib/hooks/useMorphActions";
import { useStamina } from "@/lib/hooks/useStamina";
import { useCombatOutcome } from "@/lib/store/combat-outcome";
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
  type RealmCityNode,
  type RealmMapSelectedContext,
} from "@/components/world/RealmMap";
import { CityTerrainMap, type CityTerrainEntity } from "@/components/world/CityTerrainMap";
import { CellAffinityPanel } from "@/components/world/CellAffinityPanel";

const TYPE_META = [
  { label: "Capital", glyph: "♛" },
  { label: "Resource", glyph: "⛏" },
  { label: "Combat", glyph: "⚔" },
  { label: "Trade", glyph: "◆" },
] as const;
const typeIdx = (t: number) => Math.max(0, Math.min(3, t | 0));

// intercity_teleport requires a Stable (BuildingId.Stables) at this level.
const TELEPORT_STABLE_LEVEL = 10;

const ENCOUNTER_RANGE_METERS = ENCOUNTER_ATTACK_RANGE_METERS;

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
  const { data: worldPlayers } = useWorldPlayers();
  const { data: estateData } = useEstate();
  const travel = useTravelProgress();
  const client = useNovusMundusClient();
  const transact = useTransact();

  const player = playerData?.account;
  const ge = geData?.account;

  const [destinationCity, setDestinationCity] = useState<number | null>(null);
  // Encounters for the currently-viewed city — used to enrich the entity
  // panel when the user clicks an encounter dot. Declared AFTER
  // `destinationCity` because the hook reads it.
  const { data: viewedEncounters } = useEncounters(destinationCity);
  // Live, zustand-backed list of OTHER players in the drilled-in city
  // (already excludes self, filtered by `currentCity`). Empty when no city
  // is drilled in. The program-wide WS keeps it fresh — no 30 s tanstack
  // polling. Used to render every in-flight intracity walker on the disc.
  const { data: cityPlayers } = useCityPlayers(destinationCity ?? undefined);
  const [destCell, setDestCell] = useState<{
    gridLat: number;
    gridLong: number;
  } | null>(null);
  // Entity selection inside the city terrain disc. Setting this swaps the
  // right-hand scroll panel from "city detail" to "entity detail" (player
  // profile or encounter target). Cleared by clicking empty terrain.
  const [selectedEntity, setSelectedEntity] = useState<CityTerrainEntity | null>(null);

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
    const baseTeleportCost = deciToNovi(ge.gameplayConfig?.teleportBaseCost?.toNumber?.()) ?? 100_000;
    const costPer100km = deciToNovi(ge.gameplayConfig?.teleportCostPer100km?.toNumber?.()) ?? 10_000;
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

  // ── Intracity travel (within home city) ──────────────────────────────
  // We're in intracity mode whenever the viewer city == player's current
  // city AND a cell is picked. Then the panel/morph CTAs hand off to the
  // intracity_start / intracity_complete pair instead of intercity.
  const isHomeDestination =
    destinationCity != null && player != null && destinationCity === player.currentCity;
  const isIntracityTravel = travel.traveling && player?.travelType === TravelType.Intracity;

  /*
   * Distance from the player to the currently-selected entity, in meters.
   * Used to decide whether the morph bar + EntityPanel should offer Strike
   * (in attack range) or Approach (out of range). Computed from grid units so
   * the answer matches what attack_encounter / attack_player sees on-chain.
   */
  const selectedEntityDistMeters = useMemo(() => {
    if (!selectedEntity || !player) return null;
    return calculateDistanceMeters(
      player.currentLat,
      player.currentLong,
      selectedEntity.gridLat / 10000,
      selectedEntity.gridLong / 10000,
    );
  }, [selectedEntity, player]);

  /*
   * Per-entity Strike eligibility. Mirrors EncounterDetailPanel + PvpDetailPanel
   * guards so we don't dispatch a tx the program will reject:
   *  - level band (encounter only): |enc.level − player.level| ≤ maxEncounterLevelDiff
   *  - stamina (encounter only): playerStamina ≥ encounter rarity's stamina cost
   *  - attack range (both): distance ≤ ENCOUNTER_ATTACK_RANGE_METERS / pvpAttackRangeMeters
   * `reason` is the first failing check (in display order) — surfaced as the
   * disabled-button tooltip / hint copy.
   */
  const pvpRangeMeters = ge?.combatConfig?.pvpAttackRangeMeters ?? 15;
  const maxLevelDiff = ge?.gameplayConfig?.maxEncounterLevelDiff ?? 30;
  const { current: playerStamina } = useStamina(player);

  /* Clear the side-panel selection when the selected encounter dies, so the
   * right-hand panel mirrors the disc's own dead-encounter filter (see
   * useCityOccupied). Otherwise the panel keeps showing the encounter's
   * stats and a Strike CTA pointing at a corpse, which the chain would
   * reject with EncounterDead. We don't clear while `viewedEncounters` is
   * still loading (data === undefined) or the selection would evaporate on
   * first mount before the store catches up. */
  useEffect(() => {
    if (!selectedEntity || selectedEntity.occupantType !== 2) return;
    if (!viewedEncounters) return;
    const enc = viewedEncounters.find(
      (e) => e.pubkey.toBase58() === selectedEntity.pubkey,
    );
    if (!enc || enc.account.health.isZero()) {
      setSelectedEntity(null);
    }
  }, [selectedEntity, viewedEncounters]);

  const selectedEntityCombat = useMemo(() => {
    if (!selectedEntity || !player || !isHomeDestination) return null;
    const isEnc = selectedEntity.occupantType === 2;
    if (isEnc) {
      const enc = (viewedEncounters ?? []).find(
        (e) => e.pubkey.toBase58() === selectedEntity.pubkey,
      );
      if (!enc) return null;
      const inRange =
        selectedEntityDistMeters != null && selectedEntityDistMeters <= ENCOUNTER_RANGE_METERS;
      const diff = Math.abs((enc.account.level ?? 0) - (player.level ?? 0));
      const levelOk = diff <= maxLevelDiff;
      const staminaCost = getEncounterStaminaCost(enc.account.rarity ?? 0);
      const staminaOk = playerStamina >= staminaCost;
      const reason = !levelOk
        ? `Level gap too wide (${diff} > ${maxLevelDiff})`
        : !staminaOk
          ? `Stamina ${playerStamina}/${staminaCost}`
          : null;
      return {
        kind: "encounter" as const,
        inRange,
        canStrike: inRange && levelOk && staminaOk,
        reason,
        maxHealth: enc.account.maxHealth.toNumber(),
      };
    }
    /* PvP — no level gate on attack_player today; the program checks range +
     * unit count only. Drive-by / overrun branch is left to a follow-up since
     * the morph bar only fits one Strike action. */
    const target = (cityPlayers ?? []).find(
      (p) => p.pubkey.toBase58() === selectedEntity.pubkey,
    );
    if (!target) return null;
    const inRange =
      selectedEntityDistMeters != null && selectedEntityDistMeters <= pvpRangeMeters;
    const hasUnits = getTotalDefensiveUnits(player).toNumber() > 0;
    return {
      kind: "pvp" as const,
      inRange,
      canStrike: inRange && hasUnits,
      reason: !inRange ? "Out of range" : !hasUnits ? "No standing army" : null,
      maxHealth: 0,
    };
  }, [
    selectedEntity,
    player,
    isHomeDestination,
    viewedEncounters,
    cityPlayers,
    selectedEntityDistMeters,
    maxLevelDiff,
    playerStamina,
    pvpRangeMeters,
  ]);

  const startIntraTravel = async (
    targetGridLat: number,
    targetGridLong: number,
    successMessage: string,
    reportPhase: (p: TxPhase) => void,
  ) => {
    if (!publicKey || !player) throw new Error("Not ready");
    const geKey = client.gameEngine;
    const cityId = player.currentCity;
    const [originLocation] = deriveLocationPda(
      geKey,
      cityId,
      toGrid(player.currentLat),
      toGrid(player.currentLong),
    );
    const [destinationLocation] = deriveLocationPda(geKey, cityId, targetGridLat, targetGridLong);
    const targetLat = targetGridLat / 10000;
    const targetLong = targetGridLong / 10000;
    const ix = createIntracityStartInstruction(
      {
        owner: publicKey,
        gameEngine: geKey,
        cityId,
        originLocation,
        destinationLocation,
        originCreatorRefund: ge?.authority ?? publicKey,
      },
      { destinationLat: targetLat, destinationLong: targetLong },
    );
    const res = await transact.mutateAsync({
      instructions: [ix],
      invalidateKeys: [["player"]],
      successMessage,
      onPhase: reportPhase,
    });
    setDestCell(null);
    setSelectedEntity(null);
    return res.signature;
  };

  const startIntraWalk = (reportPhase: (p: TxPhase) => void) => {
    if (!destCell) throw new Error("Pick a destination cell");
    return startIntraTravel(
      destCell.gridLat,
      destCell.gridLong,
      "Walking within the city!",
      reportPhase,
    );
  };

  const approachEntity = async (reportPhase: (p: TxPhase) => void) => {
    if (!selectedEntity || !player) throw new Error("No entity selected");
    const isEnc = selectedEntity.occupantType === 2;
    /*
     * Land on a NEIGHBOUR of the entity, not the entity's own cell — the cell
     * is already held by the encounter/player Location PDA, so an
     * intracity_start onto it fails with CellOccupied. Pick the unoccupied
     * 8-neighbour closest to the player so the walk is shortest.
     */
    const ge = client.gameEngine;
    const cityId = player.currentCity;
    const eLat = selectedEntity.gridLat;
    const eLong = selectedEntity.gridLong;
    const pLat = toGrid(player.currentLat);
    const pLong = toGrid(player.currentLong);
    const candidates: { gridLat: number; gridLong: number; dist: number }[] = [];
    for (const dy of [-1, 0, 1]) {
      for (const dx of [-1, 0, 1]) {
        if (dx === 0 && dy === 0) continue;
        const gLat = eLat + dy;
        const gLong = eLong + dx;
        candidates.push({
          gridLat: gLat,
          gridLong: gLong,
          dist: Math.hypot(gLat - pLat, gLong - pLong),
        });
      }
    }
    candidates.sort((a, b) => a.dist - b.dist);
    const pdas = candidates.map(
      (c) => deriveLocationPda(ge, cityId, c.gridLat, c.gridLong)[0],
    );
    const infos = await client.connection.getMultipleAccountsInfo(pdas);
    const idx = infos.findIndex((info) => info === null);
    if (idx === -1) throw new Error("All cells around the target are occupied");
    const chosen = candidates[idx]!;
    return startIntraTravel(
      chosen.gridLat,
      chosen.gridLong,
      isEnc ? "Closing in on the wild…" : "Walking to the player…",
      reportPhase,
    );
  };

  const strikeSelectedEncounter = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey || !player || !selectedEntity) throw new Error("Not ready");
    const enc = (viewedEncounters ?? []).find(
      (e) => e.pubkey.toBase58() === selectedEntity.pubkey,
    );
    if (!enc) throw new Error("Encounter not found");
    const geKey = client.gameEngine;
    const [playerPda] = derivePlayerPda(geKey, publicKey);
    const [loot] = deriveLootPda(playerPda, player.lootCounter.toNumber());
    const [encounterLocation] = deriveLocationPda(
      geKey,
      enc.account.cityId,
      toGrid(enc.account.locationLat),
      toGrid(enc.account.locationLong),
    );
    const ix = createAttackEncounterInstruction(
      {
        owner: publicKey,
        gameEngine: geKey,
        encounter: enc.pubkey,
        loot,
        encounterLocation,
        locationCreatorRefund: ge?.authority ?? publicKey,
      },
      { encounterId: enc.account.id.toNumber() },
    );
    const maxHealth = enc.account.maxHealth.toNumber();
    return transact
      .mutateAsync({
        instructions: [ix],
        invalidateKeys: [["player"], ["encounters"], ["loot"]],
        successMessage: "Attack landed!",
        onPhase: reportPhase,
      })
      .then((r) => {
        useCombatOutcome
          .getState()
          .show(r.events, strikeSelectedEncounter, { maxHealth });
        return r.signature;
      });
  };

  const strikeSelectedPlayer = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey || !player || !selectedEntity) throw new Error("Not ready");
    const target = (cityPlayers ?? []).find(
      (p) => p.pubkey.toBase58() === selectedEntity.pubkey,
    );
    if (!target) throw new Error("Target player not found in this city");
    const ix = createAttackPlayerInstruction(
      {
        attacker: publicKey,
        gameEngine: client.gameEngine,
        defenderPlayer: target.pubkey,
        attackerCityId: player.currentCity,
        defenderCityId: target.account.currentCity,
      },
      { driveBy: false },
    );
    return transact
      .mutateAsync({
        instructions: [ix],
        invalidateKeys: [["player"], ["cityPlayers"]],
        successMessage: "Attack executed!",
        onPhase: reportPhase,
      })
      .then((r) => {
        useCombatOutcome.getState().show(r.events, strikeSelectedPlayer, {});
        return r.signature;
      });
  };

  const completeIntra = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey || !player) throw new Error("Not ready");
    const geKey = client.gameEngine;
    const cityId = player.currentCity;
    const [destinationLocation] = deriveLocationPda(
      geKey,
      cityId,
      toGrid(player.travelingToLat),
      toGrid(player.travelingToLong),
    );
    const ix = createIntracityCompleteInstruction({
      owner: publicKey,
      gameEngine: geKey,
      cityId,
      destinationLocation,
    });
    return transact
      .mutateAsync({
        instructions: [ix],
        invalidateKeys: [["player"]],
        successMessage: "Arrived!",
        onPhase: reportPhase,
      })
      .then((r) => r.signature);
  };

  const cancelIntra = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey || !player) throw new Error("Not ready");
    const geKey = client.gameEngine;
    const cityId = player.currentCity;
    const [originLocation] = deriveLocationPda(
      geKey,
      cityId,
      toGrid(player.currentLat),
      toGrid(player.currentLong),
    );
    const [destinationLocation] = deriveLocationPda(
      geKey,
      cityId,
      toGrid(player.travelingToLat),
      toGrid(player.travelingToLong),
    );
    const ix = createIntracityCancelInstruction({
      owner: publicKey,
      gameEngine: geKey,
      cityId,
      originLocation,
      destinationLocation,
      // intracity_start sets dest_location.location_creator = owner, so the
      // refund of the freed destination cell must go to the player wallet.
      destinationCreatorRefund: publicKey,
    });
    return transact
      .mutateAsync({
        instructions: [ix],
        invalidateKeys: [["player"]],
        successMessage: "Turned back!",
        onPhase: reportPhase,
      })
      .then((r) => r.signature);
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

  // Travel-completion / cancellation hand off to the right instruction based
  // on travel type — intercity_complete for cross-city travel, intracity_complete
  // for in-city. Hoisted out of the morph-actions branch so the desktop
  // "step through the gate" / "turn back" buttons in renderDefault use the
  // same branching — without this, the desktop button fires intercity_complete
  // for an intracity journey and leaves the player stuck in flight.
  const completeFn = isIntracityTravel ? completeIntra : completeTravel;
  const cancelFn = isIntracityTravel ? cancelIntra : cancelTravel;

  // Inline travel controls — countdown + Hasten/Rush + complete/cancel.
  // Used in both `renderDefault` (no city selected) and `renderSelected`
  // (a city is being inspected mid-flight) so the player can speed up the
  // journey from either surface. Desktop-only buttons; the morph bar
  // carries the equivalent CTAs on mobile.
  const renderInflightControls = () => {
    if (!travel.traveling) return null;
    const arrived = travel.pct >= 100;
    return (
      <>
        <div style={{ marginTop: "0.9rem" }}>
          <GoldCountdown
            endsAt={travel.endsAt}
            startedAt={travel.startedAt}
            showProgress
            format="compact"
            size="md"
          />
        </div>
        <div className="hidden md:block" style={{ marginTop: "1rem" }}>
          {arrived ? (
            <TxButton onClick={completeFn} className={styles.seal}>
              <span>{isIntracityTravel ? "arrive" : "step through the gate"}</span>
              <span>
                <ChevronRight className="h-3.5 w-3.5" />
              </span>
            </TxButton>
          ) : (
            <TxButton onClick={cancelFn} variant="danger" className="w-full text-xs">
              turn back
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
  };

  // Mobile surfaces the travel CTAs through the MorphTabBar — the realm-map
  // scroll panel is desktop-only for actions (its inline buttons are hidden
  // below md). Rebuilt each render; useMorphActions diffs before registering.
  const morphActions: PanelAction[] = [];
  if (travel.traveling) {
    if (travel.pct >= 100) {
      morphActions.push({
        id: "complete",
        label: "complete",
        onClick: completeFn,
        variant: "primary",
      });
    } else {
      // In-flight speedups — mobile parity with the desktop SpeedupPanel.
      // Hold-to-charge packs multiple speedups into one tx; the cap is
      // derived from remaining time × gem affordability above. A tier whose
      // cap collapses to zero (no gems / journey already short) is dropped
      // entirely so the bar doesn't surface an unusable button.
      const hastenMax = speedupTiers[0]?.maxCount ?? 0;
      const rushMax = speedupTiers[1]?.maxCount ?? 0;
      if (hastenMax > 0) {
        morphActions.push({
          id: "hasten-flight",
          label: "Hasten",
          onClick: (rp) => speedup(1, rp, 1),
          onHold: (rp, count) => speedup(1, rp, count),
          holdMax: hastenMax,
          variant: "secondary",
        });
      }
      if (rushMax > 0) {
        morphActions.push({
          id: "rush-flight",
          label: "Rush",
          onClick: (rp) => speedup(2, rp, 1),
          onHold: (rp, count) => speedup(2, rp, count),
          holdMax: rushMax,
          variant: "secondary",
        });
      }
      morphActions.push({
        id: "turn-back",
        label: "turn back",
        onClick: cancelFn,
        variant: "danger",
      });
    }
  } else if (selectedEntity && isHomeDestination) {
    // Encounter or other-soul approach from inside the home city. Self-cell
    // is a no-op so we drop the action — only "✕" remains.
    const isSelfEntity = playerData?.pubkey?.toBase58?.() === selectedEntity.pubkey;
    const isEnc = selectedEntity.occupantType === 2;
    if (!isSelfEntity) {
      /*
       * In range → Strike (gated by level-band + stamina + units, so the chain
       * never sees a rejected tx). Out of range → Approach an adjacent cell.
       * A combat snapshot may be null while encounters/cityPlayers are still
       * loading; treat that as "approach" since we can't yet prove it's safe
       * to strike.
       */
      const inAttackRange =
        selectedEntityCombat?.inRange ??
        (isEnc &&
          selectedEntityDistMeters != null &&
          selectedEntityDistMeters <= ENCOUNTER_RANGE_METERS);
      if (inAttackRange) {
        morphActions.push({
          id: "strike",
          label: "Strike",
          onClick: isEnc ? strikeSelectedEncounter : strikeSelectedPlayer,
          variant: "primary",
          disabled: selectedEntityCombat?.canStrike === false,
        });
      } else {
        morphActions.push({
          id: "approach",
          label: isEnc ? "Approach" : "Walk to",
          onClick: approachEntity,
          variant: "primary",
          disabled: !hasStables,
        });
      }
    }
    morphActions.push({
      id: "cancel",
      kind: "dismiss",
      label: "✕",
      onClick: async () => {
        setSelectedEntity(null);
        return "";
      },
    });
  } else if (isHomeDestination && destCell) {
    // Intracity walk: a cell in your own city has been picked.
    morphActions.push({
      id: "intra-walk",
      label: "Walk here",
      onClick: startIntraWalk,
      variant: "primary",
      disabled: !hasStables,
    });
    morphActions.push({
      id: "cancel",
      kind: "dismiss",
      label: "✕",
      onClick: async () => {
        setDestCell(null);
        return "";
      },
    });
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

    // Entity selection takes over the panel.
    if (selectedEntity) {
      // Show "Approach & strike" only when the entity is in the player's
      // current city — intracity travel can't cross city boundaries.
      const canApproach =
        !travel.traveling && isHomeDestination && publicKey != null && player != null;
      return (
        <EntityPanel
          entity={selectedEntity}
          city={node.city}
          worldPlayers={worldPlayers}
          encounters={viewedEncounters}
          myPlayerPda={playerData?.pubkey?.toBase58?.()}
          onApproach={canApproach ? approachEntity : undefined}
          onStrike={
            canApproach && selectedEntityCombat?.inRange
              ? selectedEntity.occupantType === 2
                ? strikeSelectedEncounter
                : strikeSelectedPlayer
              : undefined
          }
          strikeDisabledReason={
            selectedEntityCombat?.inRange && selectedEntityCombat?.canStrike === false
              ? selectedEntityCombat.reason
              : null
          }
          onDismiss={() => setSelectedEntity(null)}
        />
      );
    }

    return (
      <>
        <div className={styles.detailName}>{node.city.name}</div>
        <span className={`${styles.detailType} ${isHome ? styles.home : ""}`}>
          <span className={styles.glyph}>{meta.glyph}</span>
          {meta.label}
          {isHome ? ". your seat" : ""}
        </span>

        <dl className={styles.lineMeta}>
          <dt>people present</dt>
          <dd className={styles.numeral}>{node.city.playersPresent.toLocaleString()}</dd>
          <dt>wilds about it</dt>
          <dd className={styles.numeral}>
            lv {node.city.minEncounterLevel}–{node.city.maxEncounterLevel}
          </dd>
          {!isCurrent && travelPreview && (
            <>
              <dt>road by foot</dt>
              <dd className={styles.numeral}>
                {travelPreview.distanceKm.toLocaleString()} km · {travelPreview.timeStr}
              </dd>
              <dt>by the stables (travel cost)</dt>
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
          inFlight ? (
            renderInflightControls()
          ) : (
            <>
              {/* Home-city panel: shows intracity walk affordance when a cell
                  is picked. Mirror the intercity inline buttons (desktop-
                  only) so the MorphTabBar isn't the only access path. */}
              <p
                style={{
                  marginTop: "0.9rem",
                  fontStyle: "italic",
                  fontSize: "0.72rem",
                  color: destCell ? "var(--seal)" : "var(--ink-soft)",
                  lineHeight: 1.5,
                }}
              >
                {destCell
                  ? "destination chosen, walk below."
                  : "your seat. Touch a cell in the disc to walk there, or another city to set out."}
              </p>

              {/* On-chain terrain bonuses for the chosen walk cell. Hidden
                  until a cell is picked so we don't suggest bonuses for an
                  unselected target. */}
              {destCell && currentCityData && (
                <CellAffinityPanel cityAccount={currentCityData.account} cell={destCell} />
              )}

              <div className="hidden md:block">
                <div style={{ marginTop: "0.9rem" }}>
                  <TxButton
                    onClick={startIntraWalk}
                    disabled={!destCell || !hasStables}
                    className={styles.seal}
                  >
                    <span>Walk here</span>
                    <span>
                      <ChevronRight className="h-3.5 w-3.5" />
                    </span>
                  </TxButton>
                </div>
              </div>

              {!hasStables && (
                <p style={TRAVEL_NOTE_STYLE}>
                  no road will carry you yet. raise a Stable on your estate to walk anywhere.
                </p>
              )}
            </>
          )
        ) : inFlight ? (
          renderInflightControls()
        ) : (
          <>
            {/* The cell picker lives in the main sheet now (renderSheetOverride
                below) — the panel only shows text + CTAs. We surface a one-line
                hint about the cell state so the player has a panel-side cue. */}
            <p
              style={{
                marginTop: "0.9rem",
                fontStyle: "italic",
                fontSize: "0.72rem",
                color: destCell ? "var(--seal)" : "var(--ink-soft)",
                lineHeight: 1.5,
              }}
            >
              {destCell
                ? "landing cell chosen, set out below."
                : "touch the mapadd to pick where to alight."}
            </p>

            {/* On-chain terrain bonuses for the chosen landing cell in the
                destination city. Lets the player pick tactically — land on
                a hill for mining/combat, on the shore for fishing. */}
            {destCell && destCityData && (
              <CellAffinityPanel cityAccount={destCityData.account} cell={destCell} />
            )}

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
                  <span>
                    <ChevronRight className="h-3.5 w-3.5" />
                  </span>
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
                no road will carry you yet. raise a Stable on your estate to set out.
              </p>
            ) : !canTeleport ? (
              <p style={TRAVEL_NOTE_STYLE}>
                stable at level {TELEPORT_STABLE_LEVEL} would let the horses make this journey at
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
      return (
        <>
          <div className={styles.detailName}>en route</div>
          <span className={styles.detailType}>
            <span className={styles.glyph}>↣</span>
            to {destName}
          </span>
          {renderInflightControls()}
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
            <dt>seat</dt>
            <dd>{currentCityData.account.name}</dd>
            <dt>City type</dt>
            <dd>{TYPE_META[typeIdx(currentCityData.account.cityType)]?.label}</dd>
          </dl>
        )}
      </>
    );
  };

  // Drill-in: any selected city opens the terrain disc full-sheet. For a
  // non-home destination, picking a cell becomes the intercity landing cell
  // (drives the Walk/Hasten/Rush CTAs in the scroll panel). For the home
  // city, the disc is pure visualization — see encounters and other players
  // in your own city; intercity travel still goes through the realm view.
  //
  // While intercity-traveling we still allow the drill-in so the player can
  // look at their destination (or origin) during flight — pick on an empty
  // cell sets destCell harmlessly (the morph bar / scroll panel branch on
  // `travel.traveling` first, so any destCell-driven CTA stays suppressed).
  const renderSheetOverride = (node: RealmCityNode) => {
    const isHome = node.city.cityId === player?.currentCity;
    const targetCity = isHome ? currentCityData : destCityData;
    if (!targetCity) return null;
    // Cell pick semantics:
    //   - In a destination city → set the intercity LANDING cell.
    //   - In the home city → set the intracity WALK destination.
    // Same destCell state; what we do with it is decided by `isHomeDestination`
    // when building the morph actions / panel CTAs.
    //
    // During travel the local destCell state is stale (startTravel clears
    // it once the journey is in flight), so derive the selected cell from
    // chain state instead:
    //   - viewing the destination city → the landing cell (travelingToLat/Long)
    //   - viewing the origin city → the takeoff cell (currentLat/Long, frozen
    //     until intercity_complete)
    //   - any other city → no selection
    // For intracity travel currentCity == destinationCity, so the first
    // branch wins and the moving destination is what shows.
    // We also drop `onSelect` during travel — the destination cell can't
    // change mid-flight, and a click that silently mutates destCell would
    // ghost-resurrect after the journey completes.
    let inflightSelected: { gridLat: number; gridLong: number } | null = null;
    if (travel.traveling && player) {
      if (node.city.cityId === player.destinationCity) {
        inflightSelected = {
          gridLat: toGrid(player.travelingToLat),
          gridLong: toGrid(player.travelingToLong),
        };
      } else if (node.city.cityId === player.currentCity) {
        inflightSelected = {
          gridLat: toGrid(player.currentLat),
          gridLong: toGrid(player.currentLong),
        };
      }
    }
    const selectedCell = travel.traveling ? inflightSelected : destCell;
    const onSelectCell = travel.traveling
      ? undefined
      : (gridLat: number, gridLong: number) => {
          setDestCell({ gridLat, gridLong });
          setSelectedEntity(null);
        };

    // Intracity travel — draw a line + moving marker from the player's
    // start cell to their destination cell ON the disc. Realm-map scale
    // can't show this (it's sub-pixel within one city dot), so the disc
    // is the only meaningful surface. Only set when the viewed city IS
    // the city the walk is happening in (player.currentCity during
    // intracity flight; currentCity == destinationCity for intracity).
    const walkLine =
      isIntracityTravel && player && node.city.cityId === player.currentCity
        ? {
            fromGridLat: toGrid(player.currentLat),
            fromGridLong: toGrid(player.currentLong),
            toGridLat: toGrid(player.travelingToLat),
            toGridLong: toGrid(player.travelingToLong),
            pct: travel.pct,
          }
        : undefined;

    // Every OTHER player intracity-walking in this city. Source is the
    // live zustand-backed `cityPlayers` — already filtered to this city
    // and self-excluded, kept fresh by the program-wide WebSocket (no
    // 30 s tanstack polling). Each entry's `departureTime` / `arrivalTime`
    // are stable for the duration of the walk, so we interpolate `pct`
    // against `chainNow` (1 Hz) and the marker glides smoothly between
    // WS pushes. Remaining filter: in-flight + intracity-flavoured.
    const otherWalks = cityPlayers
      .filter((p) => {
        const a = p.account;
        if (!a) return false;
        if (a.travelType !== TravelType.Intracity) return false;
        if (a.arrivalTime.toNumber() <= 0) return false;
        return true;
      })
      .map((p) => {
        const a = p.account;
        const dep = a.departureTime.toNumber();
        const arr = a.arrivalTime.toNumber();
        const total = arr - dep;
        const pct =
          total > 0
            ? Math.min(100, Math.max(0, ((chainNow - dep) / total) * 100))
            : 0;
        return {
          fromGridLat: toGrid(a.currentLat),
          fromGridLong: toGrid(a.currentLong),
          toGridLat: toGrid(a.travelingToLat),
          toGridLong: toGrid(a.travelingToLong),
          pct,
        };
      });

    return (
      <CityTerrainMap
        cityAccount={targetCity.account}
        selected={selectedCell}
        onSelect={onSelectCell}
        selectedEntity={selectedEntity}
        onEntitySelect={setSelectedEntity}
        travel={walkLine}
        otherWalks={otherWalks}
      />
    );
  };

  // While intercity-flying, draw a path on the realm map from the player's
  // origin city (still `currentCity` until intercity_complete) to the
  // destination, with a marker at the current progress. Intracity travel
  // happens inside one city, so it has no realm-map line.
  const realmTravel =
    travel.traveling && !isIntracityTravel && player
      ? {
          fromCityId: player.currentCity,
          toCityId: player.destinationCity,
          pct: travel.pct,
        }
      : undefined;

  return (
    <RealmMap
      selectedId={destinationCity}
      onSelectChange={(id) => {
        setDestinationCity(id);
        setDestCell(null);
        setSelectedEntity(null);
      }}
      travel={realmTravel}
      renderSelected={renderSelected}
      renderDefault={renderDefault}
      renderSheetOverride={renderSheetOverride}
      scrollHead={
        selectedEntity
          ? selectedEntity.occupantType === 2
            ? "the wild"
            : "the player"
          : travel.traveling
            ? "the journey"
            : destinationCity
              ? "the road"
              : "the chart"
      }
    />
  );
}

// ── Entity Panel ─────────────────────────────────────────────────────────
// Compact, sectioned view of a player or encounter that the user tapped in
// the city terrain disc. Hero (name + level + tier + bearing) on top, then a
// combat strip, a wealth strip, and an action at the foot. All inline-styled
// against the parchment palette inherited from RealmMap.module.css.

const TIER_NAMES: Record<number, string> = {
  [SubscriptionTier.Rookie]: "Rookie",
  [SubscriptionTier.Expert]: "Expert",
  [SubscriptionTier.Epic]: "Epic",
  [SubscriptionTier.Legendary]: "Legendary",
};

/**
 * Display-format a numeric quantity. Accepts `number`, `bigint`, or a
 * BN-like (`{ toString(): string }`) so on-chain u64 values can be passed
 * directly without going through `Number(...)` first — for whale-tier
 * networth (~3.7e17 base units per test 27) that f64 coercion loses ~9
 * significant digits before this function runs. We bucket on the bigint
 * magnitude and only convert to f64 for the formatted tail (which is
 * already small enough to round safely).
 */
function formatCompact(n: number | bigint | { toString(): string }): string {
  let big: bigint;
  if (typeof n === "bigint") {
    big = n;
  } else if (typeof n === "number") {
    if (!Number.isFinite(n)) return "—";
    if (Math.abs(n) < 1_000) return n.toLocaleString();
    big = BigInt(Math.trunc(n));
  } else {
    try {
      big = BigInt(n.toString());
    } catch {
      return "—";
    }
  }
  const abs = big < 0n ? -big : big;
  const sign = big < 0n ? "-" : "";
  if (abs >= 1_000_000_000_000n) {
    const t = Number((big * 10n) / 1_000_000_000_000n) / 10;
    return `${t.toFixed(abs >= 100_000_000_000_000n ? 0 : 1)}T`;
  }
  if (abs >= 1_000_000_000n) {
    const t = Number((big * 10n) / 1_000_000_000n) / 10;
    return `${t.toFixed(abs >= 100_000_000_000n ? 0 : 1)}B`;
  }
  if (abs >= 1_000_000n) {
    const t = Number((big * 10n) / 1_000_000n) / 10;
    return `${t.toFixed(abs >= 100_000_000n ? 0 : 1)}M`;
  }
  if (abs >= 1_000n) {
    const t = Number((big * 10n) / 1_000n) / 10;
    return `${t.toFixed(abs >= 100_000n ? 0 : 1)}K`;
  }
  return `${sign}${abs.toLocaleString()}`;
}

function bearingLabel(ox: number, oy: number): string {
  // ox = east-positive grid units, oy = north-positive grid units.
  if (ox === 0 && oy === 0) return "centre";
  const angleDeg = (Math.atan2(ox, oy) * 180) / Math.PI; // 0 = north, 90 = east
  const compass = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  const idx = Math.round(((angleDeg + 360) % 360) / 45) % 8;
  return compass[idx]!;
}

const PANEL_VARS = {
  card: {
    background: "var(--readout-tint)",
    border: "1px solid var(--parchment-edge)",
    padding: "0.5rem 0.6rem",
    minWidth: 0,
  } as const,
};

function StatCard({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: boolean;
}) {
  return (
    <div style={PANEL_VARS.card}>
      <div
        style={{
          fontSize: "0.55rem",
          letterSpacing: "0.16em",
          textTransform: "uppercase",
          color: "var(--ink-soft)",
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: "var(--font-jetbrains), ui-monospace, monospace",
          fontVariantNumeric: "tabular-nums",
          fontWeight: 700,
          fontSize: "1.1rem",
          color: accent ? "var(--seal)" : "var(--ink)",
          marginTop: "0.15rem",
          lineHeight: 1.1,
        }}
      >
        {value}
      </div>
      {hint && (
        <div
          style={{
            fontSize: "0.55rem",
            color: "var(--ink-soft)",
            marginTop: "0.15rem",
            letterSpacing: "0.04em",
          }}
        >
          {hint}
        </div>
      )}
    </div>
  );
}

interface EntityPanelProps {
  entity: CityTerrainEntity;
  city: RealmCityNode["city"];
  worldPlayers:
    | { pubkey: { toBase58: () => string }; account: PlayerSnapshot | null }[]
    | undefined;
  encounters: { pubkey: { toBase58: () => string }; account: EncounterSnapshot }[] | undefined;
  myPlayerPda: string | undefined;
  /**
   * Fire intracity_start to an adjacent cell of the entity. Omit when the
   * entity is in a different city or the player is already traveling — the
   * button hides.
   */
  onApproach?: (reportPhase: (p: TxPhase) => void) => Promise<string>;
  /**
   * Fire attack_encounter / attack_player directly. Set only when the player
   * is within attack range of the entity — otherwise the panel falls back to
   * onApproach. When wired but strikeDisabledReason is non-null, the button
   * renders disabled with the reason as a hint.
   */
  onStrike?: (reportPhase: (p: TxPhase) => void) => Promise<string>;
  /**
   * Why Strike is blocked even though the entity is in range (level gap, no
   * stamina, no standing army). Null means the strike is clear to dispatch.
   */
  strikeDisabledReason?: string | null;
  onDismiss: () => void;
}

// Minimal projection of the EncounterAccount fields we render. Pulled from
// EncounterAccount in the SDK — we only need rarity/level/health/etc here.
interface EncounterSnapshot {
  level: number;
  rarity: number;
  health: { toString(): string; gtn?(n: number): boolean };
  maxHealth: { toString(): string };
  defense: number;
  attackerCount: number;
  despawnAt: { toNumber(): number };
  spawnedAt: { toNumber(): number };
}

const ENCOUNTER_RARITY_NAMES: Record<number, string> = {
  [EncounterType.Common]: "Common",
  [EncounterType.Uncommon]: "Uncommon",
  [EncounterType.Rare]: "Rare",
  [EncounterType.Epic]: "Epic",
  [EncounterType.Legendary]: "Legendary",
  [EncounterType.WorldEvent]: "World event",
};

// Rarity → seal colour. Stays inside the parchment palette but trends hotter
// for higher tiers so the danger-band reads at a glance.
const ENCOUNTER_RARITY_COLOR: Record<number, string> = {
  [EncounterType.Common]: "rgba(110, 70, 30, 0.85)",
  [EncounterType.Uncommon]: "rgba(80, 110, 40, 0.9)",
  [EncounterType.Rare]: "rgba(50, 90, 140, 0.95)",
  [EncounterType.Epic]: "rgba(130, 60, 160, 0.95)",
  [EncounterType.Legendary]: "rgba(200, 130, 30, 1)",
  [EncounterType.WorldEvent]: "rgba(180, 30, 30, 1)",
};

function formatDuration(seconds: number): string {
  if (seconds <= 0) return "expired";
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

// Minimal projection of the player account fields we actually render —
// using `any` would bleed into the UI; pulling the SDK PlayerCore type is
// overkill (it has ~80 fields). Mirror only what EntityPanel reads.
interface PlayerSnapshot {
  name: string;
  level: number;
  reputation: { toString(): string };
  networth: { toString(): string };
  lockedNovi: { toString(): string };
  subscriptionTier: number;
  defensiveUnit1: { toString(): string };
  defensiveUnit2: { toString(): string };
  defensiveUnit3: { toString(): string };
  operativeUnit1: { toString(): string };
  operativeUnit2: { toString(): string };
  operativeUnit3: { toString(): string };
  owner: { toBase58(): string };
}

function EntityPanel({
  entity,
  city,
  worldPlayers,
  encounters,
  myPlayerPda,
  onApproach,
  onStrike,
  strikeDisabledReason,
  onDismiss,
}: EntityPanelProps) {
  const isEncounter = entity.occupantType === 2;
  const ox = entity.gridLong - Math.round(city.longitude * 10000);
  const oy = entity.gridLat - Math.round(city.latitude * 10000);
  const distM = Math.round(Math.sqrt(ox * ox + oy * oy) * 11);
  const distLabel =
    distM >= 1000 ? `${(distM / 1000).toFixed(1)} km` : `${distM.toLocaleString()} m`;
  const bearing = bearingLabel(ox, oy);
  const shortPubkey = `${entity.pubkey.slice(0, 4)}…${entity.pubkey.slice(-4)}`;

  const playerHit = !isEncounter
    ? worldPlayers?.find((p) => p.pubkey.toBase58() === entity.pubkey)
    : undefined;
  const account = (playerHit?.account ?? null) as PlayerSnapshot | null;
  const isSelf = myPlayerPda === entity.pubkey;

  const encounterHit = isEncounter
    ? encounters?.find((e) => e.pubkey.toBase58() === entity.pubkey)
    : undefined;
  const enc = encounterHit?.account ?? null;
  const encRarityName = enc ? (ENCOUNTER_RARITY_NAMES[enc.rarity] ?? "Wild") : null;
  const encRarityColor = enc
    ? (ENCOUNTER_RARITY_COLOR[enc.rarity] ?? "rgba(160, 30, 30, 0.95)")
    : "rgba(160, 30, 30, 0.95)";
  /*
   * Encounter HP can exceed 2^53 for high-rarity bosses; convert via BigInt
   * so the percentage stays accurate. Display fields below still pass the
   * BN through `formatCompact` which is bigint-aware now.
   */
  const encHealthBig = enc ? BigInt(enc.health.toString()) : 0n;
  const encMaxHealthBig = enc ? BigInt(enc.maxHealth.toString()) : 0n;
  const encHealthPct =
    encMaxHealthBig > 0n
      ? Math.max(0, Math.min(100, Number((encHealthBig * 10000n) / encMaxHealthBig) / 100))
      : 0;
  const nowSec = Math.floor(Date.now() / 1000);
  const despawnIn = enc ? enc.despawnAt.toNumber() - nowSec : 0;

  const displayName = isEncounter
    ? encRarityName
      ? `${encRarityName} encounter`
      : "Wild encounter"
    : account?.name && account.name.trim() && !account.name.startsWith("Player #")
      ? account.name
      : isSelf
        ? "You"
        : account?.name?.trim() || "Unnamed player";

  const tierName = account ? (TIER_NAMES[account.subscriptionTier] ?? null) : null;

  /*
   * Whale-tier u64 fields (networth, lockedNovi, unit counts) routinely
   * exceed 2^53 base units. Keep them as bigints through the sum step so
   * the f64 rounding happens only inside formatCompact's tail division.
   */
  const defensiveTotal: bigint = account
    ? BigInt(account.defensiveUnit1.toString()) +
      BigInt(account.defensiveUnit2.toString()) +
      BigInt(account.defensiveUnit3.toString())
    : 0n;
  const operativeTotal: bigint = account
    ? BigInt(account.operativeUnit1.toString()) +
      BigInt(account.operativeUnit2.toString()) +
      BigInt(account.operativeUnit3.toString())
    : 0n;
  const networth: bigint = account ? BigInt(account.networth.toString()) : 0n;
  const lockedNovi: bigint = account ? BigInt(account.lockedNovi.toString()) : 0n;
  const reputation: bigint = account ? BigInt(account.reputation.toString()) : 0n;

  return (
    <>
      {/* Hero — name + level pip + tier + city/bearing. */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "auto 1fr",
          gap: "0.7rem",
          alignItems: "center",
        }}
      >
        {/* Level pip — encounters get a swords + their level under it. */}
        <div
          style={{
            width: "48px",
            height: "48px",
            borderRadius: "50%",
            border: `2px solid ${isEncounter ? encRarityColor : "var(--seal)"}`,
            background: "var(--readout-tint)",
            display: "grid",
            placeItems: "center",
            color: isEncounter ? encRarityColor : "var(--seal)",
            fontFamily: "var(--font-jetbrains), ui-monospace, monospace",
            fontWeight: 700,
            fontSize: isEncounter ? "1.1rem" : "1.2rem",
            lineHeight: 1,
            boxShadow: "inset 0 0 8px rgba(110,70,30,0.18)",
            position: "relative",
          }}
        >
          {isEncounter ? (
            enc ? (
              // Encounter pip stacks: ⚔ glyph on top, level numeral below.
              <div style={{ textAlign: "center", lineHeight: 1 }}>
                <div style={{ fontSize: "0.9rem" }}>⚔</div>
                <div style={{ fontSize: "0.65rem", marginTop: "0.1rem", letterSpacing: "0.04em" }}>
                  lv{enc.level}
                </div>
              </div>
            ) : (
              "⚔"
            )
          ) : (
            (account?.level ?? "—")
          )}
        </div>
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontSize: "1rem",
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "var(--ink)",
              lineHeight: 1.15,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={displayName}
          >
            {displayName}
          </div>
          <div
            style={{
              marginTop: "0.2rem",
              fontSize: "0.65rem",
              color: "var(--ink-soft)",
              fontStyle: "italic",
              letterSpacing: "0.04em",
            }}
          >
            {isEncounter ? "stalks" : isSelf ? "your seat in" : "stands in"} {city.name}
          </div>
          {tierName && !isEncounter && (
            <div
              style={{
                display: "inline-block",
                marginTop: "0.35rem",
                fontSize: "0.55rem",
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                padding: "0.15rem 0.45rem",
                border: "1px solid var(--seal)",
                color: "var(--seal)",
                background: "var(--readout-tint)",
              }}
            >
              {tierName}
            </div>
          )}
          {isEncounter && encRarityName && (
            <div
              style={{
                display: "inline-block",
                marginTop: "0.35rem",
                fontSize: "0.55rem",
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                padding: "0.15rem 0.45rem",
                border: `1px solid ${encRarityColor}`,
                color: encRarityColor,
                background: "var(--readout-tint)",
              }}
            >
              {encRarityName}
            </div>
          )}
        </div>
      </div>

      {/* Bearing pill — a single readable line for "where they are". */}
      <div
        style={{
          marginTop: "0.8rem",
          padding: "0.45rem 0.6rem",
          background: "var(--readout-tint)",
          border: "1px solid var(--parchment-edge)",
          fontSize: "0.7rem",
          letterSpacing: "0.04em",
          color: "var(--ink)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: "0.5rem",
        }}
      >
        <span style={{ color: "var(--ink-soft)", fontStyle: "italic" }}>
          {bearing === "centre" ? "at the city heart" : `${bearing} of heart`}
        </span>
        <span
          style={{
            fontFamily: "var(--font-jetbrains), ui-monospace, monospace",
            fontVariantNumeric: "tabular-nums",
            fontWeight: 700,
          }}
        >
          {distLabel}
        </span>
      </div>

      {!isEncounter && (
        <>
          {/* Combat row — three stats side by side. */}
          <div
            style={{
              marginTop: "0.7rem",
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr",
              gap: "0.4rem",
            }}
          >
            <StatCard label="defence" value={formatCompact(defensiveTotal)} hint="units" />
            <StatCard label="operative" value={formatCompact(operativeTotal)} hint="units" />
            <StatCard label="renown" value={formatCompact(reputation)} />
          </div>

          {/* Wealth row — two stats. */}
          <div
            style={{
              marginTop: "0.4rem",
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "0.4rem",
            }}
          >
            <StatCard label="networth" value={formatCompact(networth)} hint="NOVI" accent />
            <StatCard label="locked" value={formatCompact(deciToNovi(lockedNovi))} hint="NOVI" />
          </div>
        </>
      )}

      {!isEncounter && !account && (
        <p
          style={{
            marginTop: "0.8rem",
            fontStyle: "italic",
            fontSize: "0.7rem",
            color: "var(--ink-soft)",
          }}
        >
          The cartographer is fetching their book…
        </p>
      )}

      {/* Encounter stats — health bar (its own block, more visceral than a
          stat card), then defense/attackers/despawn as a 3-up. */}
      {isEncounter && enc && (
        <>
          {/* Health bar — visual first, number second. */}
          <div style={{ marginTop: "0.7rem" }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
                fontSize: "0.55rem",
                letterSpacing: "0.16em",
                textTransform: "uppercase",
                color: "var(--ink-soft)",
              }}
            >
              <span>health</span>
              <span
                style={{
                  fontFamily: "var(--font-jetbrains), ui-monospace, monospace",
                  color: "var(--ink)",
                  letterSpacing: 0,
                }}
              >
                {formatCompact(encHealthBig)} / {formatCompact(encMaxHealthBig)}
              </span>
            </div>
            <div
              style={{
                marginTop: "0.25rem",
                height: "0.55rem",
                background: "var(--readout-tint)",
                border: "1px solid var(--parchment-edge)",
                position: "relative",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  width: `${encHealthPct}%`,
                  background:
                    encHealthPct > 60
                      ? "linear-gradient(90deg, rgba(120,40,40,0.85), rgba(160,30,30,0.95))"
                      : encHealthPct > 25
                        ? "linear-gradient(90deg, rgba(180,100,30,0.85), rgba(200,130,30,0.95))"
                        : "linear-gradient(90deg, rgba(110,80,30,0.85), rgba(160,110,30,0.95))",
                  transition: "width 0.4s ease",
                }}
              />
            </div>
          </div>

          {/* Defense / Attackers / Despawn. */}
          <div
            style={{
              marginTop: "0.5rem",
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr",
              gap: "0.4rem",
            }}
          >
            <StatCard label="defence" value={formatCompact(enc.defense)} />
            <StatCard
              label="attackers"
              value={String(enc.attackerCount)}
              hint={enc.attackerCount === 1 ? "player" : "players"}
            />
            <StatCard
              label="despawns"
              value={formatDuration(despawnIn)}
              hint={despawnIn <= 0 ? "" : "in"}
              accent={despawnIn > 0 && despawnIn < 300}
            />
          </div>
        </>
      )}

      {isEncounter && !enc && (
        <p
          style={{
            marginTop: "0.8rem",
            fontStyle: "italic",
            fontSize: "0.7rem",
            color: "var(--ink-soft)",
          }}
        >
          The wild's bestiary entry hasn't loaded yet…
        </p>
      )}

      {/* Action — Strike directly when the encounter is already in attack
          range (no walk needed); otherwise approach an adjacent cell. When
          neither callback is wired the entity is in another city or the
          player is already traveling — both states make the button useless. */}
      {!isSelf && onStrike ? (
        <div style={{ marginTop: "0.9rem" }}>
          <TxButton
            onClick={onStrike}
            className={styles.seal}
            disabled={
              !!strikeDisabledReason ||
              (isEncounter && !!enc && encHealthPct <= 0)
            }
          >
            <span>Strike</span>
            <span>
              <ChevronRight className="h-3.5 w-3.5" />
            </span>
          </TxButton>
          <p
            style={{
              marginTop: "0.4rem",
              fontSize: "0.6rem",
              fontStyle: "italic",
              color: strikeDisabledReason ? "var(--ink-warning, #c47b2a)" : "var(--ink-soft)",
              lineHeight: 1.4,
            }}
          >
            {strikeDisabledReason ?? "In range — strike from where you stand."}
          </p>
        </div>
      ) : !isSelf && onApproach ? (
        <div style={{ marginTop: "0.9rem" }}>
          <TxButton
            onClick={onApproach}
            className={styles.seal}
            disabled={isEncounter && !!enc && encHealthPct <= 0}
          >
            <span>{isEncounter ? "Approach & strike" : "Walk to them"}</span>
            <span>
              <ChevronRight className="h-3.5 w-3.5" />
            </span>
          </TxButton>
          <p
            style={{
              marginTop: "0.4rem",
              fontSize: "0.6rem",
              fontStyle: "italic",
              color: "var(--ink-soft)",
              lineHeight: 1.4,
            }}
          >
            {isEncounter
              ? "Walk to an adjacent cell, then strike."
              : "Travel intracity to a cell adjacent to them."}
          </p>
        </div>
      ) : !isSelf && !onApproach ? (
        <p
          style={{
            marginTop: "0.9rem",
            padding: "0.55rem 0.7rem",
            border: "1px dashed var(--ink-faint)",
            color: "var(--ink-soft)",
            fontSize: "0.7rem",
            fontStyle: "italic",
          }}
        >
          {isEncounter
            ? "Travel to this city first, then approach."
            : "Travel to this city first to walk over."}
        </p>
      ) : isSelf ? (
        <p
          style={{
            marginTop: "0.9rem",
            padding: "0.55rem 0.7rem",
            border: "1px dashed var(--seal)",
            color: "var(--seal)",
            fontSize: "0.7rem",
            fontStyle: "italic",
          }}
        >
          This is you. Touch another cell to set out.
        </p>
      ) : null}

      {/* Footnotes — fine print, kept out of the way. */}
      <div
        style={{
          marginTop: "0.9rem",
          paddingTop: "0.6rem",
          borderTop: "1px dotted var(--legend-divider)",
          fontFamily: "var(--font-jetbrains), ui-monospace, monospace",
          fontSize: "0.6rem",
          color: "var(--ink-soft)",
          display: "grid",
          gridTemplateColumns: "auto 1fr",
          rowGap: "0.15rem",
          columnGap: "0.5rem",
        }}
      >
        <span style={{ letterSpacing: "0.1em", textTransform: "uppercase" }}>cell</span>
        <span style={{ textAlign: "right" }}>
          {entity.gridLat.toLocaleString()}, {entity.gridLong.toLocaleString()}
        </span>
        <span style={{ letterSpacing: "0.1em", textTransform: "uppercase" }}>account</span>
        <span style={{ textAlign: "right" }}>{shortPubkey}</span>
        {account?.owner && (
          <>
            <span style={{ letterSpacing: "0.1em", textTransform: "uppercase" }}>wallet</span>
            <span style={{ textAlign: "right" }}>
              {account.owner.toBase58().slice(0, 4)}…{account.owner.toBase58().slice(-4)}
            </span>
          </>
        )}
      </div>

      <button
        type="button"
        onClick={onDismiss}
        style={{
          marginTop: "0.9rem",
          padding: "0.5rem 0.85rem",
          background: "transparent",
          border: "1px dashed var(--ink-faint)",
          color: "var(--ink-soft)",
          fontSize: "0.65rem",
          letterSpacing: "0.16em",
          textTransform: "uppercase",
          cursor: "pointer",
          width: "100%",
        }}
      >
        Back to the chart
      </button>
    </>
  );
}
