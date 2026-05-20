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
      {selectedCell && selectedEmpty && !disabled && (
        <TxButton
          onClick={(rp) => onTravel(selectedCell.centerLat, selectedCell.centerLong, rp)}
          variant="secondary"
          className="w-full text-xs"
          disabled={disabled}
        >
          Travel ({selectedCell.distToTarget.toFixed(0)}m)
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
