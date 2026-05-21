"use client";

import { useEffect, useMemo, useState } from "react";
import {
  calculateDistanceMeters,
  deriveLocationPda,
  GRID_PRECISION,
  toGrid,
} from "novus-mundus-sdk";
import { useNovusMundusClient } from "@/lib/solana/provider";
import { TxButton } from "@/components/shared/TxButton";
import type { TxPhase } from "@/components/shared/TxButton";
import { cn } from "@/lib/utils";
import styles from "./parchment-travel.module.css";

/**
 * A 3×3 grid of the cells around a target — shows which neighbouring cells are
 * empty (travellable) and which are in attack range, and lets the player walk
 * to one. Shared by the encounter and PvP detail views.
 */
export function ProximityGrid({
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
  // The trip the player actually walks — from their position to the chosen
  // cell. Distinct from `distToTarget`, which is how close to the target the
  // cell sits once arrived.
  const selectedTravelDist = selectedCell
    ? calculateDistanceMeters(
        playerLat,
        playerLong,
        selectedCell.centerLat,
        selectedCell.centerLong,
      )
    : 0;

  const anyEmpty = cells.some((c, i) => occupancy[i] === false && !c.isTarget);
  const doneLoading = occupancy.every((o) => o !== null);

  return (
    <div className={styles.grid}>
      <div className={styles.gridLabel}>Nearby Cells</div>
      <div className={styles.cells}>
        {cells.map((cell, i) => {
          const occupied = occupancy[i];
          const loading = occupied === null;
          const isEmpty = occupied === false;
          const isSelected = selectedIdx === i;
          const canClick = isEmpty && !cell.isTarget && !disabled;

          let stateClass: string;
          if (cell.isTarget) stateClass = styles.cellTarget;
          else if (cell.isPlayer) stateClass = styles.cellPlayer;
          else if (loading) stateClass = styles.cellLoading;
          else if (!isEmpty) stateClass = styles.cellOccupied;
          else if (cell.inRange) stateClass = styles.cellInRange;
          else stateClass = styles.cellClose;

          return (
            <button
              key={i}
              disabled={!canClick}
              onClick={() => (canClick ? setSelectedIdx(i) : undefined)}
              className={cn(styles.cell, stateClass, isSelected && styles.cellSelected)}
            >
              {cell.isTarget ? (
                <span className="text-xs">&#9760;</span>
              ) : cell.isPlayer ? (
                <span className="text-[10px]">YOU</span>
              ) : loading ? (
                <span className="text-[10px]">&#8230;</span>
              ) : !isEmpty ? (
                <span className="text-[10px]">&#9632;</span>
              ) : (
                <>
                  <span>{cell.distToTarget.toFixed(0)}m</span>
                  {cell.inRange && <span className={styles.inRangeTag}>IN RANGE</span>}
                </>
              )}
            </button>
          );
        })}
      </div>

      {/* Legend */}
      <div className={styles.legend}>
        <span><span style={{ color: "var(--crimson)" }}>&#9760;</span> Target</span>
        <span><span style={{ color: "var(--seal)" }}>&#10003;</span> In range</span>
        <span><span style={{ color: "var(--ink-soft)" }}>&#9679;</span> Close</span>
        <span><span style={{ color: "var(--ink-faint)" }}>&#9632;</span> Occupied</span>
      </div>

      {/* Travel button for selected cell */}
      {selectedCell && selectedEmpty && !disabled && (
        <TxButton
          onClick={(rp) => onTravel(selectedCell.centerLat, selectedCell.centerLong, rp)}
          variant="secondary"
          className="w-full text-xs"
          disabled={disabled}
        >
          Travel here · {selectedTravelDist.toFixed(0)}m trip
          {selectedCell.inRange
            ? " — in range"
            : ` — ${selectedCell.distToTarget.toFixed(0)}m from target`}
        </TxButton>
      )}

      {doneLoading && !anyEmpty && (
        <div className={styles.allOccupied}>All nearby cells are occupied</div>
      )}
    </div>
  );
}
