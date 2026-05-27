"use client";

import { useMemo } from "react";
import { type CityAccount } from "novus-mundus-sdk";
import {
  biomeAffinity,
  biomeAt,
  biomeKnobsFromCity,
  biomeName,
  BIOME_FOREST,
  BIOME_MARSH,
  BIOME_SAND,
  BIOME_SHORE,
  BIOME_SNOW,
  BIOME_ROCK,
  type BiomeType,
} from "@/lib/world/biome";
import { toGrid } from "novus-mundus-sdk";
import { GameIcon, type GameIconId } from "@/components/shared/GameIcon";

interface CellAffinityPanelProps {
  cityAccount: CityAccount;
  cell: { gridLat: number; gridLong: number };
}

interface Chip {
  key: string;
  iconId: GameIconId;
  value: string;
  label: string;
  tone: "boon" | "penalty";
}

/**
 * "THE LAND OFFERS" — surfaces the on-chain biome_affinity bonuses for
 * the specific cell within a city. Three numbers from chain
 * (miningBps, fishingBps, combatBps) drive at most three chips; only
 * non-zero entries render so a featureless grass cell shows the
 * "balanced ground" line.
 *
 * Authoritative reference: programs/novus_mundus/src/logic/biome.rs —
 * `biome_affinity()` is a const lookup keyed by biome ID. Values match
 * the magnitudes of the retired `terrain_affinity` table so PvP
 * balance shifts predictably across the cut.
 *
 * The combat chip label is biome-themed (e.g. "forest defender",
 * "sand attacker") since biomes don't have an elevation gradient — the
 * advantage attribution flows from the biome itself, not from being
 * on higher ground.
 */
export function CellAffinityPanel({ cityAccount, cell }: CellAffinityPanelProps) {
  const { biome, aff } = useMemo(() => {
    const cityLatGrid = toGrid(cityAccount.latitude);
    const cityLongGrid = toGrid(cityAccount.longitude);
    const ox = cell.gridLong - cityLongGrid;
    const oy = cell.gridLat - cityLatGrid;
    const b = biomeAt(cityAccount.biomeSeed, ox, oy, biomeKnobsFromCity(cityAccount));
    return { biome: b, aff: biomeAffinity(b) };
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
  if (aff.combatBps !== 0) {
    const pct = Math.round(Math.abs(aff.combatBps) / 100);
    if (pct > 0) {
      const isBoon = aff.combatBps > 0;
      chips.push({
        key: "combat",
        iconId: "map-combat",
        value: `${isBoon ? "+" : "−"}${pct}%`,
        label: combatLabelFor(biome, isBoon),
        tone: isBoon ? "boon" : "penalty",
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
        the land offers · {biomeName(biome)}
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
          balanced ground — no biome edge here.
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

// Biome-themed combat-bonus label. The retired terrain model used
// "high/low ground" as the cue — under biomes the bonus comes from the
// terrain itself, so the label names which biome favours whom.
function combatLabelFor(biome: BiomeType, attackerBonus: boolean): string {
  if (attackerBonus) {
    switch (biome) {
      case BIOME_SAND:
        return "sand attacker";
      case BIOME_ROCK:
        return "rock attacker";
      default:
        return "favourable ground";
    }
  }
  switch (biome) {
    case BIOME_FOREST:
      return "forest defender";
    case BIOME_MARSH:
      return "marsh defender";
    case BIOME_SNOW:
      return "snow defender";
    case BIOME_SHORE:
      return "shore defender";
    default:
      return "unfavourable ground";
  }
}
