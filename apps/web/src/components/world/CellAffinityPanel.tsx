"use client";

import { useMemo } from "react";
import {
  cityTerrain,
  terrainAffinity,
  toGrid,
  type CityAccount,
} from "novus-mundus-sdk";
import { GameIcon } from "@/components/shared/GameIcon";

interface CellAffinityPanelProps {
  cityAccount: CityAccount;
  cell: { gridLat: number; gridLong: number };
}

interface Chip {
  key: string;
  iconId: string;
  value: string;
  label: string;
  tone: "boon" | "penalty";
}

/**
 * "THE LAND OFFERS" — surfaces the on-chain terrain_affinity bonuses for a
 * specific cell within a city. Three numbers from the chain
 * (mining_bps, fishing_bps, elevation_bps) drive at most three chips; only
 * non-zero entries are rendered so a midpoint cell shows a single "balanced
 * ground" line instead of empty rows.
 *
 * Authoritative reference: programs/novus_mundus/src/logic/terrain.rs —
 * `terrain_affinity()` returns zeros for water / peak / midpoint, positive
 * mining bps above the midpoint, positive fishing bps below, and a signed
 * elevation_bps in [-500, +500]. The PvP combat path (attack_player.rs)
 * applies elevation_bps with opposite signs to attacker and defender, so a
 * single "high/low ground" chip captures both attack and defense impact.
 *
 * Activities that DO NOT consume terrain_affinity on chain — encounters,
 * dungeons, castle attacks, travel speed, rallies, hero abilities — are
 * deliberately omitted; surfacing them would imply a bonus the program
 * never actually applies.
 */
export function CellAffinityPanel({ cityAccount, cell }: CellAffinityPanelProps) {
  const aff = useMemo(() => {
    const terrain = cityTerrain(cityAccount);
    const cityLatGrid = toGrid(cityAccount.latitude);
    const cityLongGrid = toGrid(cityAccount.longitude);
    const ox = cell.gridLong - cityLongGrid;
    const oy = cell.gridLat - cityLatGrid;
    return terrainAffinity(terrain, ox, oy);
  }, [cityAccount, cell.gridLat, cell.gridLong]);

  const chips: Chip[] = [];
  if (aff.miningBps > 0) {
    chips.push({
      key: "mining",
      iconId: "buff-mining-affinity",
      value: `+${Math.round(aff.miningBps / 100)}%`,
      label: "mining",
      tone: "boon",
    });
  }
  if (aff.fishingBps > 0) {
    chips.push({
      key: "fishing",
      iconId: "buff-fishing-affinity",
      value: `+${Math.round(aff.fishingBps / 100)}%`,
      label: "fishing",
      tone: "boon",
    });
  }
  if (aff.elevationBps !== 0) {
    const pct = Math.round(Math.abs(aff.elevationBps) / 100);
    if (pct > 0) {
      const isHigh = aff.elevationBps > 0;
      chips.push({
        key: "combat",
        iconId: "map-combat",
        value: `${isHigh ? "+" : "−"}${pct}%`,
        label: isHigh ? "high ground" : "low ground",
        tone: isHigh ? "boon" : "penalty",
      });
    }
  }

  return (
    <>
      <div
        style={{
          marginTop: "0.95rem",
          marginBottom: "0.4rem",
          fontSize: "0.6rem",
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: "var(--ink-soft)",
        }}
      >
        the land offers
      </div>
      {chips.length === 0 ? (
        <p
          style={{
            fontSize: "0.66rem",
            fontStyle: "italic",
            color: "var(--ink-soft)",
            lineHeight: 1.4,
            margin: 0,
          }}
        >
          balanced ground — no terrain edge here.
        </p>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>
          {chips.map((c) => (
            <span
              key={c.key}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.35rem",
                padding: "0.28rem 0.5rem",
                fontSize: "0.64rem",
                letterSpacing: "0.05em",
                background: "var(--readout-tint)",
                border: "1px solid var(--parchment-edge)",
                color: "var(--ink-soft)",
              }}
              title={`${c.value} ${c.label}`}
            >
              <GameIcon id={c.iconId} title={c.label} size={13} />
              <span
                style={{
                  fontFamily: "var(--font-jetbrains), ui-monospace, monospace",
                  fontWeight: 700,
                  color: c.tone === "boon" ? "var(--ink)" : "rgba(160, 60, 40, 0.95)",
                  letterSpacing: 0,
                }}
              >
                {c.value}
              </span>
              <span>{c.label}</span>
            </span>
          ))}
        </div>
      )}
    </>
  );
}
