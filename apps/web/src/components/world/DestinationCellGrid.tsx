"use client";

import { useEffect, useMemo, useState } from "react";
import { deriveLocationPda } from "novus-mundus-sdk";
import { useNovusMundusClient } from "@/lib/solana/provider";
import styles from "./DestinationCellGrid.module.css";

interface Props {
  cityId: number;
  centerGridLat: number;
  centerGridLong: number;
  selected: { gridLat: number; gridLong: number } | null;
  onSelect: (gridLat: number, gridLong: number) => void;
}

/**
 * The 5×5 landing-cell picker shown in the realm-map scroll panel after a
 * destination city is chosen. Reads each candidate cell's PDA via
 * `getMultipleAccountsInfo` so already-occupied cells render dimmed and
 * disabled. Reskinned to sepia ink for the parchment theme.
 */
export function DestinationCellGrid({
  cityId,
  centerGridLat,
  centerGridLong,
  selected,
  onSelect,
}: Props) {
  const client = useNovusMundusClient();
  const ge = client.gameEngine;

  const cells = useMemo(() => {
    const result: { gridLat: number; gridLong: number }[] = [];
    for (const dy of [2, 1, 0, -1, -2]) {
      for (const dx of [-2, -1, 0, 1, 2]) {
        result.push({
          gridLat: centerGridLat + dy,
          gridLong: centerGridLong + dx,
        });
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
      <div className={styles.label}>Landing cell</div>
      <div className={styles.grid}>
        {cells.map((cell, i) => {
          const occupied = occupancy[i];
          const loading = occupied === null;
          const isEmpty = occupied === false;
          const isCenter = i === 12;
          const isSelected =
            selected != null &&
            selected.gridLat === cell.gridLat &&
            selected.gridLong === cell.gridLong;

          let cls = styles.cell;
          if (isSelected) cls += ` ${styles.selected}`;
          else if (loading) cls += ` ${styles.loading}`;
          else if (!isEmpty) cls += ` ${styles.occupied}`;
          else cls += ` ${styles.empty}`;

          return (
            <button
              key={i}
              type="button"
              disabled={!isEmpty}
              onClick={() => isEmpty && onSelect(cell.gridLat, cell.gridLong)}
              className={cls}
              aria-label={isCenter ? "City centre" : !isEmpty ? "Occupied cell" : "Empty cell"}
            >
              {loading ? "" : isSelected ? "✕" : !isEmpty ? "·" : isCenter ? "✦" : ""}
            </button>
          );
        })}
      </div>
      <div className={styles.legend}>
        <span className={styles.legendSel}>✕ chosen</span>
        <span className={styles.legendCtr}>✦ city centre</span>
        <span className={styles.legendOcc}>· occupied</span>
      </div>
    </div>
  );
}
