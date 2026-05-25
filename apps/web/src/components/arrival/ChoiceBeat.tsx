"use client";

import { useEffect, useMemo, useState } from "react";
import { pickSpawn, toGrid, type SpawnBearing, type SpawnFlavor } from "novus-mundus-sdk";
import { useAllCities } from "@/lib/hooks/useAllCities";
import { cityType } from "@/lib/narrative";
import {
  RealmMap,
  realmMapStyles as mapStyles,
  type RealmMapSelectedContext,
} from "@/components/world/RealmMap";
import { CityTerrainMap } from "@/components/world/CityTerrainMap";
import { CellAffinityPanel } from "@/components/world/CellAffinityPanel";
import { BeatButton, BeatEyebrow } from "./Beat";
import type { CityChoice } from "./Arrival";

interface ChoiceBeatProps {
  onChoose: (city: CityChoice) => void;
}

/**
 * Beat 2 of the Arrival — where you make your stand.
 *
 * Same surface the player uses for travel later: a full-width RealmMap with
 * every settlement on it (least-crowded soft-pulsing as the recommendation).
 * Clicking a city *drills in* — the realm sheet swaps to the CityTerrainMap
 * for that city. The drill-in is dismissable (X / Esc) so the player can pop
 * back to the kingdom view at any time and pick a different ground.
 *
 * `pickSpawn()` pre-fills a passable spawn cell whenever the city changes,
 * so the player can confirm without ever opening the disc; refining is a
 * click inside the drill-in.
 */
export function ChoiceBeat({ onChoose }: ChoiceBeatProps) {
  const { data: cities } = useAllCities();

  // Recommend the least-crowded settlement — a gentler, less-contested start.
  const recommendedId = useMemo(() => {
    if (cities.length === 0) return null;
    return [...cities].sort(
      (a, b) =>
        a.account.playersPresent - b.account.playersPresent || a.account.cityId - b.account.cityId,
    )[0]!.account.cityId;
  }, [cities]);

  // Land on the world view — no city selected, drill-in closed, recommended
  // dot pulses to guide the player. They have to click a city deliberately
  // to enter the terrain disc.
  const [selectedCityId, setSelectedCityId] = useState<number | null>(null);

  const selectedCity = useMemo(
    () => cities.find((c) => c.account.cityId === selectedCityId) ?? null,
    [cities, selectedCityId],
  );

  // Auto-pick a spawn cell whenever the city changes. The user can still
  // override by clicking the terrain disc — that updates `spawnCell` and
  // leaves `autoSpawn` alone so the narrative flavour/bearing carry through.
  const [spawnCell, setSpawnCell] = useState<{ gridLat: number; gridLong: number } | null>(null);
  const [autoSpawn, setAutoSpawn] = useState<{
    flavor: SpawnFlavor;
    bearing: SpawnBearing;
  } | null>(null);
  /*
   * Surfaces the (vanishingly rare) case where pickSpawn finds no passable
   * cell — without this the lore card sits on "finding you a patch…"
   * forever and the disabled button has no explanation.
   */
  const [pickError, setPickError] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedCity) {
      setSpawnCell(null);
      setAutoSpawn(null);
      setPickError(null);
      return;
    }
    const a = selectedCity.account;
    try {
      const spawn = pickSpawn({
        cityId: a.cityId,
        latitude: a.latitude,
        longitude: a.longitude,
        radiusKm: a.radiusKm,
        cityType: a.cityType,
        terrain: {
          seed: a.terrainSeed,
          waterLine: a.waterLine,
          peakLine: a.peakLine,
          anchorCount: a.anchorCount,
          version: a.terrainVersion,
          anchors: a.anchors,
        },
      });
      setSpawnCell({ gridLat: toGrid(spawn.lat), gridLong: toGrid(spawn.long) });
      setAutoSpawn({ flavor: spawn.flavor, bearing: spawn.bearing });
      setPickError(null);
    } catch {
      /*
       * No passable cells found — the chain would reject any spawn here
       * with TerrainImpassable. Surface a real message so the disabled
       * button is explained; player can pick a different city.
       */
      setSpawnCell(null);
      setAutoSpawn(null);
      setPickError(`${a.name} has no passable land. Choose another settlement.`);
    }
    /*
     * Depend on cityId only — re-rolling the auto-spawn every time the city
     * account is refetched would yank the player's chosen cell. Re-running
     * on `cities` identity would also clobber a manual disc override.
     */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCityId]);

  // Drill into the terrain disc when a city is chosen. Mirrors map-tab.tsx.
  const renderSheetOverride = (node: { city: { cityId: number } }) => {
    const target = cities.find((c) => c.account.cityId === node.city.cityId);
    if (!target) return null;
    return (
      <CityTerrainMap
        cityAccount={target.account}
        selected={spawnCell}
        onSelect={(gridLat, gridLong) => setSpawnCell({ gridLat, gridLong })}
      />
    );
  };

  const commitChoice = () => {
    if (!selectedCity || !spawnCell || !autoSpawn) return;
    const a = selectedCity.account;
    onChoose({
      cityId: a.cityId,
      name: a.name,
      cityType: a.cityType,
      latitude: a.latitude,
      longitude: a.longitude,
      spawnLat: spawnCell.gridLat / 10000,
      spawnLong: spawnCell.gridLong / 10000,
      /*
       * Flavor/bearing come from the auto-pick. When the player overrides
       * the cell we keep the original narrative anchor — recomputing for an
       * arbitrary cell would need a separate classifier and the narrative
       * is approximate either way.
       */
      spawnFlavor: autoSpawn.flavor,
      spawnBearing: autoSpawn.bearing,
    });
  };

  const renderSelected = ({ node }: RealmMapSelectedContext) => {
    const a = node.city;
    const t = cityType(a.cityType);
    const isRec = a.cityId === recommendedId;
    return (
      <>
        <div className={mapStyles.detailName}>{a.name}</div>
        <span className={mapStyles.detailType}>
          <span className={mapStyles.glyph}>{TYPE_GLYPH[a.cityType] ?? "♛"}</span>
          {t.name}
          {isRec ? " · for newcomers" : ""}
        </span>
        <p
          style={{
            marginTop: "0.9rem",
            fontStyle: "italic",
            fontSize: "0.78rem",
            lineHeight: 1.55,
            color: "var(--ink-soft)",
          }}
        >
          {t.line}
        </p>
        <dl className={mapStyles.lineMeta}>
          <dt>players here</dt>
          <dd className={mapStyles.numeral}>{a.playersPresent.toLocaleString()}</dd>
          <dt>wilds about it</dt>
          <dd className={mapStyles.numeral}>
            lv {a.minEncounterLevel}–{a.maxEncounterLevel}
          </dd>
        </dl>
        <p
          style={{
            marginTop: "0.9rem",
            padding: "0.6rem 0.75rem",
            border: "1px dashed var(--ink-faint)",
            fontSize: "0.7rem",
            color: pickError
              ? "var(--ink-warn, #b54848)"
              : spawnCell
                ? "var(--seal)"
                : "var(--ink-soft)",
            fontStyle: "italic",
            lineHeight: 1.5,
          }}
        >
          {pickError
            ? pickError
            : spawnCell
              ? "your patch is chosen. Click the disc to move it, or drive your stakes."
              : "finding you a patch…"}
        </p>
        {/* On-chain terrain bonuses for the chosen spawn cell. This is
            arguably the most important place to surface them — the new
            player's first cell sets up what they're naturally good at. */}
        {spawnCell && selectedCity && (
          <CellAffinityPanel cityAccount={selectedCity.account} cell={spawnCell} />
        )}
        <BeatButton
          disabled={!spawnCell || !autoSpawn || !!pickError}
          className="mt-4 w-full lowercase"
          onClick={commitChoice}
        >
          drive your stakes at {a.name}
        </BeatButton>
      </>
    );
  };

  return (
    // ChoiceBeat is the one beat that needs to *escape* the arrival's
    // narrow centred column — the realm map deserves the full page width
    // the player will see at /map later. RealmMap caps itself at 1320 px
    // internally so this won't go absurdly wide on ultrawide displays.
    <div className="flex w-full flex-col items-center">
      <BeatEyebrow className="mb-2 lowercase">The Choice</BeatEyebrow>
      <h2 className="tier-title mb-2 font-display text-2xl font-bold tracking-wide lowercase">
        Where you make your stand
      </h2>
      <p className="mb-7 max-w-md text-center text-sm leading-relaxed text-text-secondary lowercase">
        Every settlement was raised on the bones of an old-world city. The ground you choose decides
        the life you will fight for.
      </p>

      {cities.length === 0 ? (
        <p className="animate-pulse text-sm text-text-muted lowercase">Reading the maps…</p>
      ) : (
        <div className="w-full">
          <RealmMap
            selectedId={selectedCityId}
            onSelectChange={setSelectedCityId}
            recommendedId={recommendedId}
            scrollHead="the choice"
            renderSelected={renderSelected}
            renderSheetOverride={renderSheetOverride}
            /* Arrival owns the page heading; suppress the parchment "THE
             * KINGDOM" cartouche so the two don't stack and fight. */
            hideCartouche
          />
        </div>
      )}
    </div>
  );
}

/** Mirror of TYPE_META[].glyph in RealmMap — kept inline so the lore card
 *  doesn't have to import the full meta table. */
const TYPE_GLYPH: Record<number, string> = {
  0: "♛", // Capital
  1: "⛏", // Resource
  2: "⚔", // Combat
  3: "◆", // Trade
};
