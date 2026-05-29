"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { toGrid, OCCUPANT_CASTLE } from "novus-mundus-sdk";
import { useAccountStore } from "@/lib/store/accounts";
import { useNovusMundusClient } from "@/lib/solana/provider";
import { useWorldCastles } from "@/lib/hooks/world/useWorldCastles";
import { getCosmeticColor, type CosmeticColorAnimation } from "@/lib/config/cosmetics-catalog";

export interface OccupiedCell {
  gridLat: number;
  gridLong: number;
  occupantType: number;
  /* base58 pubkey of the player/encounter occupying the cell */
  occupant: string;
  /* Catalog-resolved player name color. Pushed onto the dot/tile fill so
   * paid cosmetics are visible at every zoom; renderers fall through to
   * their canonical PLAYER_FILL palette when this is undefined. Only set
   * for player occupants whose account is available in the store. */
  nameColorHex?: string;
  /* Catalog-keyed animation when the color is animated (pulse / embered /
   * glimmer / vesper / cinder). Renderers drive per-frame modulation
   * against `nameColorHex`. */
  nameColorAnim?: CosmeticColorAnimation;
  /* Equipped cosmetic IDs — raw on-chain u16 slot values. Resolved
   * through the catalog by renderers (the dot reads frame for its
   * stroke/glow, the label reads title for the suffix, the tooltip
   * composes all four). 0 = nothing equipped. */
  equippedBadge?: number;
  equippedFrame?: number;
  equippedTitle?: number;
  /* Castle footprint metadata — only set for OCCUPANT_CASTLE cells.
   * `footprintSize` is N for an N×N castle; every footprint cell
   * carries the same value so click handlers know how big to draw
   * the selection ring. `footprintAnchor` is true ONLY on the
   * (dlat=0, dlong=0) cell — the renderer paints a single plate
   * spanning N×N cells at the anchor and skips the rest. */
  footprintSize?: number;
  footprintAnchor?: boolean;
  /* Castle tier + status — only set for OCCUPANT_CASTLE cells. The
   * tier drives the tower-glyph layout in the markers layer (1
   * central tower for Outpost up to corner-towers + keep for
   * Citadel); the status drives the corner pip's color so vacant /
   * contested / protected reads at a glance without opening the
   * inspect panel. Numeric enum values match `CastleTier` and
   * `CastleStatus` from the SDK. */
  castleTier?: number;
  castleStatus?: number;
}

/*
 * City occupancy from zustand.
 *
 * Source of truth is `s.locations`, kept live by the program-wide WS
 * subscription (see lib/store/subscriptions.ts AccountKey.Location handler).
 * Locations aren't seeded at boot, so this hook fires a one-shot
 * fetchLocationsInCity per cityId change to warm the store; subsequent
 * updates arrive over WS.
 *
 * React-18 dev double-effect note: in strict mode every effect mounts +
 * immediately cleans up before its real mount. An earlier `inflightFor`
 * ref guarded against duplicate fetches but wasn't reset on cleanup, so
 * the strict-mode shadow run claimed the flag and the real run bailed
 * before firing the fetch — `seededFor` stayed null forever and the UI
 * stuck on "scouting…". We drop the inflight optimization and rely on
 * the `cancelled` flag for local state only; store upserts are always
 * safe because the data is global on-chain state, not UI state. Worst
 * case in dev is one extra RPC per city open; production has strict mode
 * off so this never fires there.
 */
export function useCityOccupied(cityId: number | null | undefined) {
  const locations = useAccountStore((s) => s.locations);
  /* Cross-reference with the encounters store so we can filter out
   * locations whose encounter just died. The chain closes the location
   * account in the same tx as the killing blow (attack_encounter.rs:693),
   * but Solana's onProgramAccountChange propagates the close notification
   * as `data.length === 0`, which the subscription manager filters out —
   * so the location lingers in this map forever otherwise. Reading the
   * live encounter health gives us sub-second cleanup at render time. */
  const encounters = useAccountStore((s) => s.encounters);
  /* Same problem in reverse for players: when a player completes a walk
   * (intracity_complete) or arrives via intercity travel, the origin
   * location PDA is closed but the WS close-notification is dropped at
   * the same data.length===0 bail. Without cross-referencing, every cell
   * a player has ever stood on lingers as a black dot. Live chain truth
   * for player positions lives in `player.account.currentLat/Long` (self)
   * and `otherPlayers[pubkey].account.currentLat/Long` (everyone else). */
  const localPlayer = useAccountStore((s) => s.player);
  /* Selector narrowing: the program-wide WS replaces the whole otherPlayers
   * Map on every player tick anywhere in the kingdom, which would otherwise
   * re-run the heavy cosmetic-resolution memo below for changes in cities the
   * disc isn't even showing. Pre-filter to this city's players inside the
   * selector (under useShallow) so an out-of-city tick yields a shallow-equal
   * array and the consumer skips the re-render. Locations are city-scoped too,
   * so only this city's players can occupy a rendered cell — narrowing here
   * loses no occupant. */
  const cityPlayers = useAccountStore(
    useShallow((s) =>
      cityId == null
        ? []
        : Array.from(s.otherPlayers.values()).filter((p) => p.account.currentCity === cityId),
    ),
  );
  const client = useNovusMundusClient();
  const ge = client.gameEngine;
  /* Castles aren't in Location PDAs (their lat/long is on the CastleAccount
   * directly), so we fold them in here as synthesised occupants — that way
   * one downstream consumer (CityTerrainMap, EntityPanel selection, etc.)
   * sees a single entity stream regardless of how the chain stores them. */
  const { data: worldCastles } = useWorldCastles();

  const [seededFor, setSeededFor] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Bumped by `refetch` to re-run the one-shot seed fetch after a
  // failed load. It's an effect dependency so the existing seed path
  // (with its cancelled-flag cleanup) is reused verbatim rather than
  // duplicated — a manual retry walks the same code as a cityId change.
  const [reloadNonce, setReloadNonce] = useState(0);
  const refetch = useCallback(() => {
    setReloadNonce((n) => n + 1);
  }, []);
  // 1 Hz wall-clock tick so the despawnAt filter below recomputes once
  // per second even when no other store mutation hits the memo deps.
  // Without this, an encounter whose despawnAt crosses while the disc
  // is idle stays painted until something else upserts.
  const [nowTick, setNowTick] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const id = window.setInterval(() => {
      setNowTick(Math.floor(Date.now() / 1000));
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (cityId == null) return;
    setError(null);
    // Re-arm the loading state so a retry reads as "scanning" again
    // rather than silently re-running under the old error/empty UI.
    if (reloadNonce > 0) setSeededFor(null);

    let cancelled = false;
    client
      .fetchLocationsInCity(cityId, { occupiedOnly: true })
      .then((results) => {
        /* Store upserts run regardless of cancel — the data describes
         * on-chain truth, and writing it benefits any later reader. */
        const store = useAccountStore.getState();
        for (const r of results) {
          store.upsertLocation(r.pubkey, r.account);
        }
        if (!cancelled) setSeededFor(cityId);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : "fetch failed";
        setError(msg);
        setSeededFor(cityId);
      });

    return () => {
      cancelled = true;
    };
  }, [cityId, client, reloadNonce]);

  const data = useMemo<OccupiedCell[]>(() => {
    if (cityId == null) return [];
    const nowSec = nowTick;
    /* Build a "live position" map keyed by player PDA. Any player location
     * whose grid coords don't match the player's chain `currentLat/Long`
     * is either (a) a stale entry from a closed PDA that the WS swallowed
     * or (b) an in-flight intracity reservation — both should be hidden
     * because the walk-line / travel marker covers the reservation case
     * and the player's actual position is the one we want to render. */
    const liveByPlayer = new Map<string, { gridLat: number; gridLong: number }>();
    // Per-player cosmetic snapshot, resolved through the catalog. Pushed
    // onto each cell below so the renderer doesn't have to re-do the lookup.
    interface CellCosmetics {
      hex?: string;
      anim?: CosmeticColorAnimation;
      badgeId: number;
      frameId: number;
      titleId: number;
    }
    const cosmeticsByPlayer = new Map<string, CellCosmetics>();
    const collectCosmetics = (
      key: string,
      equippedNameColor: number,
      equippedBadge: number,
      equippedAvatarFrame: number,
      equippedTitle: number,
    ) => {
      const entry = getCosmeticColor(equippedNameColor);
      cosmeticsByPlayer.set(key, {
        hex: entry?.hex,
        anim: entry?.animation,
        badgeId: equippedBadge,
        frameId: equippedAvatarFrame,
        titleId: equippedTitle,
      });
    };
    if (localPlayer) {
      const key = localPlayer.pubkey.toBase58();
      liveByPlayer.set(key, {
        gridLat: toGrid(localPlayer.account.currentLat),
        gridLong: toGrid(localPlayer.account.currentLong),
      });
      collectCosmetics(
        key,
        localPlayer.account.equippedNameColor,
        localPlayer.account.equippedBadge,
        localPlayer.account.equippedAvatarFrame,
        localPlayer.account.equippedTitle,
      );
    }
    // `cityPlayers` is already narrowed to currentCity === cityId, so this
    // loop only resolves cosmetics for players who can occupy a cell in the
    // city the disc is rendering.
    for (const entry of cityPlayers) {
      const key = entry.pubkey.toBase58();
      liveByPlayer.set(key, {
        gridLat: toGrid(entry.account.currentLat),
        gridLong: toGrid(entry.account.currentLong),
      });
      collectCosmetics(
        key,
        entry.account.equippedNameColor,
        entry.account.equippedBadge,
        entry.account.equippedAvatarFrame,
        entry.account.equippedTitle,
      );
    }

    const out: OccupiedCell[] = [];
    for (const { account } of locations.values()) {
      if (account.cityId !== cityId) continue;
      if (account.occupantType === 0) continue;
      if (!account.gameEngine.equals(ge)) continue;
      /* Encounter occupant (type=2) — skip the cell unless we have a
       * matching live EncounterAccount in the store.
       *
       * useEncounters fetches with `aliveOnly: true`, so the encounters
       * store is the canonical "what's actually alive" view. A Location
       * PDA whose encounter is missing from the store is either:
       *   (a) already dead/despawned — the chain may close the Location
       *       PDA shortly via a follow-up tx, but until the WS delivers
       *       the close, the Location lingers as a stale entry; or
       *   (b) freshly spawned and the encounter account hasn't seeded
       *       yet (brief race window).
       *
       * Hiding both keeps the disc honest: stale dots can't pull users
       * into Strike flows the chain will reject. The cost is a brief
       * missing dot during (b); useEncounters seeds in the same render
       * cycle for visible cities, so the gap is sub-second.
       *
       * If the entry IS present, defend further against the chain-not-
       * yet-closed window by checking health=0 and despawnAt elapsed. */
      if (account.occupantType === 2) {
        const encEntry = encounters.get(account.occupant.toBase58());
        if (!encEntry) continue;
        if (encEntry.account.health.isZero()) continue;
        if (encEntry.account.despawnAt.toNumber() <= nowSec) continue;
      }
      /* Player occupant (type=1) — only keep the cell that matches the
       * player's chain-state `currentLat/Long`. Other cells with the
       * same occupant pubkey are stale ghosts from old walks. Players
       * not in `liveByPlayer` (not the local player and not in this
       * city's narrowed roster) fall through unchanged — the same
       * permissive behaviour the broad-Map version applied to any
       * player it didn't have a live position for. */
      if (account.occupantType === 1) {
        const live = liveByPlayer.get(account.occupant.toBase58());
        if (live && (live.gridLat !== account.gridLat || live.gridLong !== account.gridLong)) {
          continue;
        }
      }
      const occupantKey = account.occupant.toBase58();
      const cosmetic = cosmeticsByPlayer.get(occupantKey);
      out.push({
        gridLat: account.gridLat,
        gridLong: account.gridLong,
        occupantType: account.occupantType,
        occupant: occupantKey,
        nameColorHex: cosmetic?.hex,
        nameColorAnim: cosmetic?.anim,
        equippedBadge: cosmetic?.badgeId,
        equippedFrame: cosmetic?.frameId,
        equippedTitle: cosmetic?.titleId,
      });
    }
    /* Fold castles in. CastleAccount stores lat/long as i32 grid units
     * (×10,000 = LocationAccount precision); the disc grid is in the
     * same units, so no scaling. Each castle occupies an N×N footprint
     * anchored at (latitude, longitude); push one OccupiedCell per
     * cell so any click inside the footprint resolves to the castle.
     * `footprintAnchor` marks the (dlat=0, dlong=0) cell so the
     * renderer can paint ONE plate spanning N×N cells instead of N²
     * independent squares. */
    if (worldCastles) {
      for (const c of worldCastles) {
        if (c.account.cityId !== cityId) continue;
        const anchorLat = c.account.latitude;
        const anchorLong = c.account.longitude;
        // deserializeCastle folds pre-cut zero-padding to 1, so this
        // field is guaranteed >= 1 — no defensive shim needed here.
        const size = c.account.footprintSize;
        for (let dlat = 0; dlat < size; dlat++) {
          for (let dlong = 0; dlong < size; dlong++) {
            out.push({
              gridLat: anchorLat + dlat,
              gridLong: anchorLong + dlong,
              occupantType: OCCUPANT_CASTLE,
              occupant: c.pubkey.toBase58(),
              footprintSize: size,
              footprintAnchor: dlat === 0 && dlong === 0,
              castleTier: c.account.tier,
              castleStatus: c.account.status,
            });
          }
        }
      }
    }
    return out;
  }, [locations, cityId, ge, encounters, localPlayer, cityPlayers, nowTick, worldCastles]);

  return {
    data,
    isLoading: cityId != null && seededFor !== cityId,
    error,
    refetch,
  };
}
