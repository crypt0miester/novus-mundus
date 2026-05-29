"use client";

// Navigation-only actions for a single player, keyed by their PlayerAccount PDA
// (base58). Read-only: no transactions, no shims. Subscribing to just the one
// otherPlayers entry keeps the player's coordinates fresh as they move without
// re-rendering on unrelated store ticks.

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { useAccountStore } from "@/lib/store/accounts";

export interface PlayerActions {
  // Deep-link the map to the player's current city + cell and preselect them,
  // which opens the inline EntityPanel. That panel is the profile surface.
  viewOnMap: () => void;
  // Identical to viewOnMap: there is no standalone cross-context profile panel,
  // so the map's preselected EntityPanel doubles as the profile.
  viewProfile: () => void;
  // Route to the DM conversation with this player. Always works since the route
  // only needs the PDA; it does not depend on otherPlayers being loaded.
  sendDm: () => void;
}

export function usePlayerActions(playerPda: string): PlayerActions {
  const router = useRouter();
  // Subscribe to the single entry so coordinates stay live as the player moves.
  const entry = useAccountStore((s) => s.otherPlayers.get(playerPda));

  return useMemo<PlayerActions>(() => {
    const goToMap = () => {
      const acc = entry?.account;
      // Not loaded yet (or self / unknown player): still land on the map rather
      // than block the action. A real degrade branch, not a shim.
      if (!acc) {
        router.push("/map");
        return;
      }
      const params = new URLSearchParams();
      params.set("city", String(acc.currentCity));
      // RAW degree floats; the map grid-rounds via lat*10000 on consumption.
      params.set("lat", String(acc.currentLat));
      params.set("long", String(acc.currentLong));
      // The PlayerAccount PDA: the map sets OCCUPANT_PLAYER and preselects it.
      params.set("player", playerPda);
      router.push(`/map?${params.toString()}`);
    };

    const goToDm = () => {
      router.push(`/messages/${playerPda}`);
    };

    return {
      viewOnMap: goToMap,
      viewProfile: goToMap,
      sendDm: goToDm,
    };
  }, [router, entry, playerPda]);
}
