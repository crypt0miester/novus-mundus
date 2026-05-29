"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PublicKey } from "@solana/web3.js";
import { ChevronRight } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import {
  toGrid,
  calculateDistance,
  calculateDistanceMeters,
  calculateIntercityTravelTime,
  calculateIntracityTravelTime,
  calculateTeleportCost,
  getCurrentTimeOfDay,
  getTimeOfDayName,
  getActivityMultiplier,
  getEncounterStaminaCost,
  getTotalDefensiveUnits,
  ENCOUNTER_ATTACK_RANGE_METERS,
  OCCUPANT_PLAYER,
  OCCUPANT_ENCOUNTER,
  OCCUPANT_CASTLE,
  ActivityType,
  SubscriptionTier,
  EncounterType,
  TravelType,
  deciToNovi,
  isNullPubkey,
} from "novus-mundus-sdk";
import {
  buildAttackEncounterIx,
  buildAttackPlayerIx,
  buildIntercityCancelIx,
  buildIntercityCompleteIx,
  buildIntercityStartIx,
  buildIntercityTeleportIx,
  buildIntracityCancelIx,
  buildIntracityCompleteIx,
  buildIntracityStartIx,
  buildTravelSpeedupIxs,
  cellLocationPda,
} from "@/lib/chain/travel";
import { useWorldPlayers, useWorldCastles } from "@/lib/hooks/world";
import { useCityPlayers } from "@/lib/hooks/useCityPlayers";
import { useTeam } from "@/lib/hooks/useTeam";
import { useTeams } from "@/lib/hooks/useTeams";
import { useCityOccupied } from "@/lib/hooks/useCityOccupied";
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
import { useAccountStore } from "@/lib/store/accounts";
import type { PanelAction } from "@/lib/store/right-panel";
import { useRightPanelStore } from "@/lib/store/right-panel";
import { BuildingId } from "@/lib/buildings";
import { GoldCountdown } from "@/components/shared/GoldCountdown";
import { DomainName } from "@/components/shared/DomainName";
import {
  CASTLE_TIER_NAMES,
  CASTLE_STATUS_NAMES,
  CASTLE_STATUS_NARRATION,
  isCastleStatusDanger,
} from "@/lib/world/castles";
import { useUrlPatch } from "@/lib/hooks/useUrlParam";
import { TxButton, type TxPhase } from "@/components/shared/TxButton";
import { SpeedupPanel, maxSpeedupCount } from "@/components/shared/SpeedupPanel";
import { formatTime } from "@/lib/utils";
import {
  RealmMap,
  realmMapStyles as styles,
  type RealmCityNode,
  type RealmMapSelectedContext,
} from "@/components/world/RealmMap";
import { ReinforceComposerPanel } from "@/components/panels/ReinforceComposerPanel";
import { RallyComposerPanel } from "@/components/panels/RallyComposerPanel";
import { GarrisonComposerPanel } from "@/components/panels/GarrisonComposerPanel";
import { ChevronLeft } from "lucide-react";
import {
  CityTerrainMap,
  type CityTerrainEntity,
  type CityTerrainMapHandle,
  type DotTooltip,
} from "@/components/world/CityTerrainMap";
import { CellAffinityPanel } from "@/components/world/CellAffinityPanel";
import { CosmeticBadgeChip } from "@/components/cosmetics/CosmeticBadgeChip";
import { CosmeticTitleChip } from "@/components/cosmetics/CosmeticTitleChip";
import {
  getCosmeticColor,
  getCosmeticFrame,
  cosmeticColorAnimationClass,
} from "@/lib/config/cosmetics-catalog";

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

/**
 * URL-driven RightPanel openers. Each entry maps a `?openPanel=<key>` value
 * to a resolver that pulls the panel's props out of the same URLSearchParams
 * (along with a display title). Returning `null` skips opening — used when
 * the required props are missing or malformed.
 *
 * Keys must match the registry in `RightPanel.tsx` (`PANELS[key]`).
 */
const PANEL_RESOLVERS: Record<
  string,
  (sp: URLSearchParams) => { title: string; props: Record<string, unknown> } | null
> = {
  "reinforce-composer": (sp) => {
    const targetWallet = sp.get("targetWallet");
    if (!targetWallet) return null;
    return { title: "Reinforce", props: { targetWallet } };
  },
  "rally-detail": (sp) => {
    const rallyPubkey = sp.get("rallyPubkey");
    if (!rallyPubkey) return null;
    return { title: "Rally", props: { rallyPubkey } };
  },
  "rally-composer": (sp) => {
    const targetPubkey = sp.get("targetPubkey");
    const targetType = parseInt(sp.get("targetType") ?? "", 10);
    const targetCityId = parseInt(sp.get("targetCityId") ?? "", 10);
    if (!targetPubkey || !Number.isFinite(targetType) || !Number.isFinite(targetCityId))
      return null;
    return {
      title: "Raise Rally",
      props: {
        targetPubkey,
        targetType,
        targetCityId,
        targetLabel: sp.get("targetLabel") ?? undefined,
      },
    };
  },
  "garrison-composer": (sp) => {
    const cityId = parseInt(sp.get("cityId") ?? "", 10);
    const castleId = parseInt(sp.get("castleId") ?? "", 10);
    if (!Number.isFinite(cityId) || !Number.isFinite(castleId)) return null;
    return { title: "Join Garrison", props: { cityId, castleId } };
  },
};

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
  const { data: worldCastles } = useWorldCastles();
  const { data: estateData } = useEstate();
  const travel = useTravelProgress();
  const client = useNovusMundusClient();
  const transact = useTransact();

  const player = playerData?.account;
  const ge = geData?.account;

  const [destinationCity, setDestinationCity] = useState<number | null>(null);
  /* Composer state — when set, the realm map's detail panel swaps from
   * the EntityPanel to the corresponding composer (Reinforce/Rally/
   * Garrison) with a Back arrow. Cleared on entity change, city change,
   * the composer's own success path, and the back arrow. Type lives at
   * module scope so EntityPanel can reference it via its props. */
  const [composer, setComposer] = useState<ComposerSpec | null>(null);
  /* Default the /map view to the home-city terrain disc once the player's
   * currentCity is known. Tracked with a ref so the user can dismiss the
   * drill-in (bottom-right back button → setDestinationCity(null)) and stay
   * on the realm-map view — we don't re-promote them back to the disc on
   * subsequent renders. If they navigate away and return, /map remounts
   * fresh and the ref starts null again, which is the right behaviour
   * (open the tab → land in your city). */
  const hasInitDestinationRef = useRef(false);
  // Imperative handle on the disc — `mapRef.current?.focusCell(lat, lng)`
  // pans and zooms the disc onto a cell. Used by the EntityPanel's name
  // click handler today; intended as the generic "navigate the map"
  // entry point for future prompts (search hits, deep-link routes, etc.).
  const mapRef = useRef<CityTerrainMapHandle | null>(null);

  useEffect(() => {
    if (hasInitDestinationRef.current) return;
    if (player?.currentCity == null) return;
    hasInitDestinationRef.current = true;
    setDestinationCity(player.currentCity);
    // The actual snap onto the player's cell is handled by the disc's
    // own auto-focus effect: it waits for the wrap to measure, then
    // fires focusCell on the `autoFocusCell` prop below. That gates on
    // the canvas being in real geometry — the polling approach this
    // replaces would expire after 3 s of retries when useAllCities was
    // slow on a cold start, leaving the disc parked at scale 1.
  }, [player?.currentCity]);

  // Deep-link entry — two independent payloads, consumed together so back/
  // refresh doesn't replay them:
  //   1. ?city=<id>&lat=<rawLat>&long=<rawLong>[&player=<pda>] — drill into
  //      the city, focus the cell, optionally pre-select an entity. From the
  //      team tab's "Locate" action.
  //   2. ?openPanel=<key>&...props — open the named RightPanel composer with
  //      the props forwarded straight through. Used by team tab Reinforce /
  //      rally browse Join clicks so the action lands on the map instead of
  //      a /team sub-route.
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const urlPatch = useUrlPatch();
  const deepLinkConsumedRef = useRef(false);
  // Cancel handle for the in-flight tryFocus chain started by the
  // deep-link effect — the StrictMode re-mount otherwise leaves two
  // parallel chains racing for 2 s.
  const deepLinkFocusCleanupRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (deepLinkConsumedRef.current) return;
    const cityParam = searchParams.get("city");
    const latParam = searchParams.get("lat");
    const longParam = searchParams.get("long");
    const playerParam = searchParams.get("player");
    const encounterParam = searchParams.get("encounter");
    const castleParam = searchParams.get("castle");
    const openPanel = searchParams.get("openPanel");
    if (!cityParam && !openPanel) return;
    deepLinkConsumedRef.current = true;

    /* Resolve the pre-selected entity from whichever pubkey param is
     * present. `?player=` and `?encounter=` map to the LocationAccount
     * occupant types (1, 2). `?castle=` is the disc's UI-only castle
     * sentinel (3) — castles aren't in Location PDAs, but the click
     * pipeline routes them through the same EntityPanel dispatch. */
    let preselected: {
      pubkey: string;
      occupantType: number;
    } | null = null;
    if (playerParam) preselected = { pubkey: playerParam, occupantType: OCCUPANT_PLAYER };
    else if (encounterParam)
      preselected = { pubkey: encounterParam, occupantType: OCCUPANT_ENCOUNTER };
    else if (castleParam) preselected = { pubkey: castleParam, occupantType: OCCUPANT_CASTLE };

    if (cityParam) {
      const cityId = parseInt(cityParam, 10);
      if (Number.isFinite(cityId)) {
        hasInitDestinationRef.current = true;
        setDestinationCity(cityId);
        if (latParam && longParam) {
          const lat = parseFloat(latParam);
          const long = parseFloat(longParam);
          if (Number.isFinite(lat) && Number.isFinite(long)) {
            const gridLat = Math.round(lat * 10000);
            const gridLong = Math.round(long * 10000);
            if (preselected) {
              setSelectedEntity({
                pubkey: preselected.pubkey,
                occupantType: preselected.occupantType,
                gridLat,
                gridLong,
              });
            }
            let tries = 20;
            let timeoutId: ReturnType<typeof setTimeout> | null = null;
            let cancelled = false;
            const tryFocus = () => {
              if (cancelled) return;
              if (mapRef.current) {
                mapRef.current.focusCell(gridLat, gridLong);
              } else if (tries-- > 0) {
                timeoutId = setTimeout(tryFocus, 100);
              }
            };
            tryFocus();
            deepLinkFocusCleanupRef.current = () => {
              cancelled = true;
              if (timeoutId != null) clearTimeout(timeoutId);
            };
          }
        }
      }
    }

    // openPanel — resolve title + props per registered key. Anything not in
    // PANEL_RESOLVERS is silently ignored (a bad key would just no-op
    // instead of throwing in the URL effect).
    if (openPanel) {
      const resolver = PANEL_RESOLVERS[openPanel];
      if (resolver) {
        const resolved = resolver(searchParams);
        if (resolved) {
          useRightPanelStore.getState().show(resolved.title, openPanel, resolved.props);
        }
      }
    }

    // Strip every consumed param so back/refresh doesn't repeat the focus.
    const next = new URLSearchParams(searchParams.toString());
    for (const k of [
      "city",
      "lat",
      "long",
      "player",
      "encounter",
      "castle",
      "openPanel",
      // Panel-prop names — same set the resolvers below read.
      "targetWallet",
      "rallyPubkey",
      "targetPubkey",
      "targetType",
      "targetCityId",
      "targetLabel",
      "cityId",
      "castleId",
    ]) {
      next.delete(k);
    }
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });

    return () => {
      deepLinkFocusCleanupRef.current?.();
      deepLinkFocusCleanupRef.current = null;
    };
  }, [searchParams, pathname, router]);
  // Encounters for the currently-viewed city — used to enrich the entity
  // panel when the user clicks an encounter dot. Declared AFTER
  // `destinationCity` because the hook reads it.
  const { data: viewedEncounters } = useEncounters(destinationCity);
  // Live, zustand-backed list of OTHER players in the drilled-in city
  // (already excludes self, filtered by `currentCity`). Empty when no city
  // is drilled in. The program-wide WS keeps it fresh — no 30 s tanstack
  // polling. Used to render every in-flight intracity walker on the disc.
  const { data: cityPlayers } = useCityPlayers(destinationCity ?? undefined);
  /* Mirror the disc's occupancy view so the entity-cleanup effect
   * can detect a despawned/dead encounter even when it's already
   * been filtered out of `viewedEncounters` (useEncounters drops
   * entries with `despawnAt <= now`). When an encounter despawns
   * its Location PDA is closed, removing it from `occupied`. */
  const { data: viewedOccupied, isLoading: viewedOccupiedLoading } =
    useCityOccupied(destinationCity);
  const [destCell, setDestCell] = useState<{
    gridLat: number;
    gridLong: number;
  } | null>(null);
  // Entity selection inside the city terrain disc. Setting this swaps the
  // right-hand scroll panel from "city detail" to "entity detail" (player
  // profile or encounter target). Cleared by clicking empty terrain.
  const [selectedEntity, setSelectedEntity] = useState<CityTerrainEntity | null>(null);

  // Composer state must follow the entity / city it was opened against —
  // changing either invalidates the in-flight form. Cheaper than wiring
  // setComposer(null) into every selection setter.
  useEffect(() => {
    setComposer(null);
  }, [selectedEntity?.pubkey, destinationCity]);

  /* Local team affiliation — base58 of `player.team` if the local
   * player has joined a team, else null. Drives the same-team dot
   * colour and the "Same Team" / "Rival" tooltip suffix below. */
  const myTeamStr = player && !isNullPubkey(player.team) ? player.team.toBase58() : null;
  /* On-demand fetch of the local team's account so we can surface its
   * NAME (not just slot index) on team-mate tooltips. The hook is a
   * no-op when myTeam is null. */
  const { data: myTeamData } = useTeam(player && !isNullPubkey(player.team) ? player.team : null);
  const myTeamName = myTeamData?.account?.name?.trim() || null;

  /* Multi-team fetch — all unique team PDAs referenced by players in
   * the viewed city. Resolves rival names too (a rival player's
   * "Rival #N · <Team Name>") so the disc reads as a full battlefield
   * roster rather than anonymous red dots. */
  const cityTeamPubkeys = useMemo(() => {
    if (!cityPlayers) return [];
    const seen = new Set<string>();
    const out: PublicKey[] = [];
    for (const p of cityPlayers) {
      if (!p.account || isNullPubkey(p.account.team)) continue;
      const s = p.account.team.toBase58();
      if (seen.has(s)) continue;
      seen.add(s);
      out.push(p.account.team);
    }
    return out;
  }, [cityPlayers]);
  const teamsByPda = useTeams(cityTeamPubkeys);

  /* Pubkeys of OTHER players in the viewed city who are on my team.
   * Computed from `cityPlayers` (already filtered to this city) so
   * we don't drag in the whole world. Empty array when the viewer
   * is solo. */
  const teamMatePubkeys = useMemo(() => {
    if (!myTeamStr || !cityPlayers) return [];
    const out: string[] = [];
    for (const p of cityPlayers) {
      if (!p.account) continue;
      if (isNullPubkey(p.account.team)) continue;
      if (p.account.team.toBase58() !== myTeamStr) continue;
      out.push(p.pubkey.toBase58());
    }
    return out;
  }, [myTeamStr, cityPlayers]);

  /* Hover-tooltip resolver — looks up the rich label for a dot when
   * the cursor passes over it on the disc. Uses the same chain data
   * the EntityPanel uses (cityPlayers / viewedEncounters / local
   * player). The renderer is game-agnostic; this callback bridges. */
  const resolveDotTooltip = useCallback(
    (occupant: string, occupantType: number): DotTooltip | null => {
      if (occupantType === OCCUPANT_PLAYER) {
        // Local player — derive from chain-state `player` + pubkey.
        if (player && playerData?.pubkey?.toBase58?.() === occupant) {
          const tier = TIER_NAMES[player.subscriptionTier] ?? null;
          // Show the player's own on-chain name — including the default
          // "Player #N" — instead of swapping it for "You". The user
          // wants to see THEIR identity in the tooltip, not a viewer
          // pronoun.
          const displayName = player.name?.trim() || "Unnamed player";
          const colorEntry = getCosmeticColor(player.equippedNameColor);
          return {
            primary: displayName,
            secondary: tier ? `lv ${player.level ?? 0} · ${tier}` : `lv ${player.level ?? 0}`,
            badgeId: player.equippedBadge,
            frameId: player.equippedAvatarFrame,
            titleId: player.equippedTitle,
            nameColorHex: colorEntry?.hex,
            nameColorAnim: colorEntry?.animation,
          };
        }
        // Other players — cityPlayers is already filtered to the viewed city.
        const p = cityPlayers?.find((x) => x.pubkey.toBase58() === occupant);
        if (!p?.account) return null;
        // Use whatever the chain has — `init_player` always sets a default
        // "Player #<n>" name, and custom names override it. Falling back to
        // a generic "Unnamed" string would hide that the chain *does*
        // identify the player, just without a vanity name yet.
        const name = p.account.name?.trim() || "Unnamed player";
        const tier = TIER_NAMES[p.account.subscriptionTier] ?? null;
        // Team status — same as my team, rival, or solo.
        const theirTeamStr = isNullPubkey(p.account.team) ? null : p.account.team.toBase58();
        let teamSuffix = "";
        let accent: string | undefined;
        if (theirTeamStr && myTeamStr && theirTeamStr === myTeamStr) {
          // Same team — name + rank ("Vanguard's Hand #3").
          const teamLabel = myTeamName ?? "Team";
          teamSuffix = ` · ${teamLabel} #${p.account.teamSlotIndex ?? 0}`;
          accent = "rgba(220, 175, 60, 0.95)"; // allied gold
        } else if (theirTeamStr) {
          // Rival — pull the team name from the multi-team cache (filled
          // by useTeams above). Falls back to "Rival" when the fetch
          // hasn't landed yet so the tooltip never lies about identity.
          const rivalTeam = teamsByPda.get(theirTeamStr);
          const rivalName = rivalTeam?.name?.trim();
          teamSuffix = rivalName
            ? ` · ${rivalName} #${p.account.teamSlotIndex ?? 0}`
            : ` · Rival #${p.account.teamSlotIndex ?? 0}`;
          accent = "rgba(180, 60, 60, 0.85)"; // rival red
        }
        const tierSeg = tier ? ` · ${tier}` : "";
        const colorEntry = getCosmeticColor(p.account.equippedNameColor);
        return {
          primary: name,
          secondary: `lv ${p.account.level ?? 0}${tierSeg}${teamSuffix}`,
          accent,
          badgeId: p.account.equippedBadge,
          frameId: p.account.equippedAvatarFrame,
          titleId: p.account.equippedTitle,
          nameColorHex: colorEntry?.hex,
          nameColorAnim: colorEntry?.animation,
        };
      }
      if (occupantType === OCCUPANT_ENCOUNTER) {
        const e = viewedEncounters?.find((x) => x.pubkey.toBase58() === occupant);
        if (!e?.account) return null;
        const rarity = ENCOUNTER_RARITY_NAMES[e.account.rarity] ?? "Wild";
        const level = e.account.level ?? 0;
        // Encounter HP can exceed 2^53 for boss-tier wilds, so percent
        // math goes through BigInt and lands on a clamped 0–100 number.
        const hpBig = BigInt(e.account.health.toString());
        const maxHpBig = BigInt(e.account.maxHealth.toString());
        const hpPct =
          maxHpBig > 0n ? Math.max(0, Math.min(100, Number((hpBig * 100n) / maxHpBig))) : 0;
        return {
          primary: `${rarity} wild`,
          secondary: `lv ${level} · HP ${hpPct}%`,
          accent: ENCOUNTER_RARITY_COLOR[e.account.rarity],
        };
      }
      if (occupantType === OCCUPANT_CASTLE) {
        const c = worldCastles?.find((x) => x.pubkey.toBase58() === occupant);
        if (!c?.account) return null;
        /* Reuse the module-scope CASTLE_TIER_NAMES / CASTLE_STATUS_NAMES
         * so the hover bubble agrees with the EntityPanel inspect block.
         * The previous inline arrays were stale (status order shifted
         * by one against the chain CastleStatus enum), so a Vulnerable
         * castle read as "Protected" in the hover bubble while the
         * inspect panel correctly said "Vulnerable" — directly
         * contradicting each other on the same castle's attackability. */
        const tierName = CASTLE_TIER_NAMES[c.account.tier] ?? `T${c.account.tier}`;
        const statusName = c.account.isVacant
          ? "Vacant"
          : (CASTLE_STATUS_NAMES[c.account.status] ?? `S${c.account.status}`);
        const displayName = c.account.name?.trim() || `Castle #${c.account.castleId}`;
        /* Slate accent ties the bubble border to the on-disc castle
         * fill (rgba(95, 105, 120) — same vocabulary). Selection-aware
         * accent (gold for own castle) could land later via `king` /
         * `team` matches; for now slate-everywhere is clear enough. */
        return {
          primary: displayName,
          secondary: `${tierName}${statusName ? ` · ${statusName}` : ""}`,
          accent: "rgba(95, 105, 120, 0.95)",
        };
      }
      return null;
    },
    [
      player,
      playerData,
      cityPlayers,
      viewedEncounters,
      worldCastles,
      myTeamStr,
      myTeamName,
      teamsByPda,
    ],
  );

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
    const baseTeleportCost =
      deciToNovi(ge.gameplayConfig?.teleportBaseCost?.toNumber?.()) ?? 100_000;
    const costPer100km =
      deciToNovi(ge.gameplayConfig?.teleportCostPer100km?.toNumber?.()) ?? 10_000;
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

  /* Intracity walk preview — surfaces distance + time for a chosen
   * landing cell inside the player's home city. Intracity travel has no
   * NOVI fee on chain (intracity_start.rs deducts no fee), so the chip
   * only shows the distance/time pair. Mirrors the intercity preview
   * shape so both contexts read the same way. */
  const intracityPreview = useMemo(() => {
    if (!player || !destCell) return null;
    // Player's current grid position vs the chosen cell. 1 grid unit ≈
    // 0.0001° ≈ 11 m at the equator (same constant used by the disc
    // renderer for its "X m from centre" readout).
    const ox = destCell.gridLong - Math.round(player.currentLong * 10000);
    const oy = destCell.gridLat - Math.round(player.currentLat * 10000);
    const distanceMeters = Math.round(Math.sqrt(ox * ox + oy * oy) * 11);
    const baseSpeedKmh = ge?.gameplayConfig?.themeTravelSpeedsKmh?.[0] ?? 5;
    const travelTimeSec = calculateIntracityTravelTime(distanceMeters, baseSpeedKmh);
    return {
      distanceMeters,
      travelTimeSec,
      timeStr: formatTime(travelTimeSec, "compact"),
    };
  }, [player, destCell, ge]);

  const startTravel = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey || !player || destinationCity == null) throw new Error("Not ready");
    if (!destCell) throw new Error("Pick a landing cell");
    const ix = buildIntercityStartIx({
      owner: publicKey,
      gameEngine: client.gameEngine,
      gameAuthority: ge?.authority,
      player,
      destinationCityId: destinationCity,
      destGridLat: destCell.gridLat,
      destGridLong: destCell.gridLong,
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
    const { ix, destinationCityId, destLat, destLong } = buildIntercityCompleteIx({
      owner: publicKey,
      gameEngine: client.gameEngine,
      player,
      homeCity: currentCityData?.account,
    });
    const sig = await transact
      .mutateAsync({
        instructions: [ix],
        invalidateKeys: [["player"]],
        successMessage: "Arrived at destination!",
        onPhase: reportPhase,
      })
      .then((r) => r.signature);
    // Optimistic: bump the local player to the destination city + cell
    // so the dot lands on the new city's disc immediately rather than
    // waiting for the WS push to propagate.
    const store = useAccountStore.getState();
    const cur = store.player;
    if (cur) {
      store.setPlayer(cur.pubkey, {
        ...cur.account,
        currentCity: destinationCityId,
        currentLat: destLat,
        currentLong: destLong,
      });
    }
    return sig;
  };

  const cancelTravel = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey || !player) throw new Error("Not ready");
    const origin = currentCityData?.account;
    if (!origin) throw new Error("Origin city not loaded");
    const ix = buildIntercityCancelIx({
      owner: publicKey,
      gameEngine: client.gameEngine,
      player,
      originCity: origin,
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
    const ix = buildIntercityTeleportIx({
      owner: publicKey,
      gameEngine: client.gameEngine,
      player,
      destinationCityId: destinationCity,
      destGridLat: destCell.gridLat,
      destGridLong: destCell.gridLong,
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
    const instructions = buildTravelSpeedupIxs({
      owner: publicKey,
      gameEngine: client.gameEngine,
      tier: tier as 1 | 2,
      count: n,
    });
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
    const startIx = buildIntercityStartIx({
      owner: publicKey,
      gameEngine: client.gameEngine,
      gameAuthority: ge?.authority,
      player,
      destinationCityId: destinationCity,
      destGridLat: destCell.gridLat,
      destGridLong: destCell.gridLong,
    });
    const [speedupIx] = buildTravelSpeedupIxs({
      owner: publicKey,
      gameEngine: client.gameEngine,
      tier: tier as 1 | 2,
    });
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
   * reject with EncounterDead.
   *
   * Two signals trigger a clear:
   *  (a) The encounter account IS in the store and its health is zero
   *      — the chain just hasn't closed the location PDA yet.
   *  (b) The encounter's Location PDA is no longer in `viewedOccupied`
   *      AND useCityOccupied has finished its seed fetch for this
   *      city — the chain closed the location (dead or despawned).
   *
   * (b) catches the despawn race: when an encounter's `despawnAt`
   * elapses, `useEncounters` filters it out of `data` and `enc`
   * becomes undefined, but `useCityOccupied` (location PDA stream)
   * also drops the cell because the PDA was closed on-chain. */
  useEffect(() => {
    if (!selectedEntity) return;
    // Encounter-only signal: the EncounterAccount in the store reports
    // health=0 — the chain has killed it but hasn't closed the Location
    // PDA yet, so it's still in viewedOccupied for a moment.
    if (selectedEntity.occupantType === 2) {
      const enc = viewedEncounters.find((e) => e.pubkey.toBase58() === selectedEntity.pubkey);
      if (enc?.account.health.isZero()) {
        setSelectedEntity(null);
        return;
      }
    }
    // Generic signal (players AND encounters): the entity's Location
    // PDA is no longer in viewedOccupied. For encounters this catches
    // despawn; for players it catches walk-away / leave-city / death.
    // selectedEntity stores a snapshot of grid coords at click time;
    // when the player moves, viewedOccupied drops the old cell, so the
    // snapshot is stale and Strike CTAs would dispatch against stale
    // coords. Clearing forces the user to reselect at the new position.
    if (!viewedOccupiedLoading) {
      const stillOccupied = viewedOccupied.some(
        (c) =>
          c.gridLat === selectedEntity.gridLat &&
          c.gridLong === selectedEntity.gridLong &&
          c.occupant === selectedEntity.pubkey,
      );
      if (!stillOccupied) {
        setSelectedEntity(null);
      }
    }
  }, [selectedEntity, viewedEncounters, viewedOccupied, viewedOccupiedLoading]);

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
    const target = (cityPlayers ?? []).find((p) => p.pubkey.toBase58() === selectedEntity.pubkey);
    if (!target) return null;
    const inRange = selectedEntityDistMeters != null && selectedEntityDistMeters <= pvpRangeMeters;
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
    const ix = buildIntracityStartIx({
      owner: publicKey,
      gameEngine: client.gameEngine,
      gameAuthority: ge?.authority,
      player,
      targetGridLat,
      targetGridLong,
    });
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
    const pdas = candidates.map((c) => cellLocationPda(ge, cityId, c.gridLat, c.gridLong));
    const infos = await client.connection.getMultipleAccountsInfo(pdas);
    const idx = infos.indexOf(null);
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
    const enc = (viewedEncounters ?? []).find((e) => e.pubkey.toBase58() === selectedEntity.pubkey);
    if (!enc) throw new Error("Encounter not found");
    const ix = buildAttackEncounterIx({
      owner: publicKey,
      gameEngine: client.gameEngine,
      gameAuthority: ge?.authority,
      player,
      encounterPubkey: enc.pubkey,
      encounter: enc.account,
    });
    const maxHealth = enc.account.maxHealth.toNumber();
    return transact
      .mutateAsync({
        instructions: [ix],
        invalidateKeys: [["player"], ["encounters"], ["loot"]],
        successMessage: "Attack landed!",
        onPhase: reportPhase,
      })
      .then((r) => {
        useCombatOutcome.getState().show(r.events, strikeSelectedEncounter, { maxHealth });
        return r.signature;
      });
  };

  const strikeSelectedPlayer = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey || !player || !selectedEntity) throw new Error("Not ready");
    const target = (cityPlayers ?? []).find((p) => p.pubkey.toBase58() === selectedEntity.pubkey);
    if (!target) throw new Error("Target player not found in this city");
    const ix = buildAttackPlayerIx({
      attacker: publicKey,
      gameEngine: client.gameEngine,
      attackerCityId: player.currentCity,
      defenderPlayer: target.pubkey,
      defenderCityId: target.account.currentCity,
      driveBy: false,
    });
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
    // Destination is captured for the optimistic store update below — by the
    // time the success callback fires, `player` here is still the pre-tx
    // snapshot, which is what we want.
    const { ix, destLat, destLong } = buildIntracityCompleteIx({
      owner: publicKey,
      gameEngine: client.gameEngine,
      player,
    });
    const sig = await transact
      .mutateAsync({
        instructions: [ix],
        invalidateKeys: [["player"]],
        successMessage: "Arrived!",
        onPhase: reportPhase,
      })
      .then((r) => r.signature);
    // Optimistic: move the dot to the destination immediately. Without
    // this, the useCityOccupied filter (which compares Location PDAs
    // against the local player's chain currentLat/Long) keeps the OLD
    // PDA visible until the WS push of the new player state arrives —
    // a several-second window where the dot lingers at the old cell.
    // WS will overwrite this with the canonical state shortly.
    const store = useAccountStore.getState();
    const cur = store.player;
    if (cur) {
      store.setPlayer(cur.pubkey, {
        ...cur.account,
        currentLat: destLat,
        currentLong: destLong,
      });
    }
    return sig;
  };

  const cancelIntra = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey || !player) throw new Error("Not ready");
    const ix = buildIntracityCancelIx({
      owner: publicKey,
      gameEngine: client.gameEngine,
      player,
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
    const isCastleEntity = selectedEntity.occupantType === 3;
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
          label: "Approach",
          onClick: approachEntity,
          variant: "primary",
          disabled: !hasStables,
        });
      }

      /* Composer actions — Reinforce / Rally / Garrison. Mirrors the
       * EntityPanel's desktop buttons so mobile players reach the same
       * composers through the morph bar. Same chain-side gating: team
       * relationship for Reinforce/Garrison (same team) and Rally
       * (different team). The morph action calls setComposer, which
       * swaps the floating panel's content to the composer — exactly
       * what the desktop buttons do. */
      const otherPlayerAcc =
        !isEnc && !isCastleEntity
          ? worldPlayers?.find((p) => p.pubkey.toBase58() === selectedEntity.pubkey)?.account
          : undefined;
      const castleAcc = isCastleEntity
        ? worldCastles?.find((c) => c.pubkey.toBase58() === selectedEntity.pubkey)?.account
        : undefined;
      const theirPlayerTeam = otherPlayerAcc?.team?.toBase58?.() ?? null;
      const theirCastleTeam = castleAcc?.team?.toBase58?.() ?? null;
      const sameTeam =
        !!myTeamStr &&
        ((!!theirPlayerTeam &&
          theirPlayerTeam !== "11111111111111111111111111111111" &&
          theirPlayerTeam === myTeamStr) ||
          (!!theirCastleTeam &&
            theirCastleTeam !== "11111111111111111111111111111111" &&
            theirCastleTeam === myTeamStr));

      // Reinforce — same-team player.
      if (!isEnc && !isCastleEntity && otherPlayerAcc?.owner && sameTeam) {
        const targetWallet = otherPlayerAcc.owner.toBase58();
        morphActions.push({
          id: "reinforce",
          label: "Reinforce",
          variant: "secondary",
          onClick: async () => {
            setComposer({ kind: "reinforce", targetWallet });
            return "";
          },
        });
      }
      // Rally — I have a team, target is enemy (encounter, non-teammate player, opposing castle).
      const canRally = !!myTeamStr && !sameTeam && (isEnc || isCastleEntity || !!otherPlayerAcc);
      if (canRally) {
        const targetType = isEnc ? 1 : isCastleEntity ? 2 : 0;
        const targetCityId = isCastleEntity
          ? (castleAcc?.cityId ?? player!.currentCity)
          : player!.currentCity;
        const targetPubkey = selectedEntity.pubkey;
        morphActions.push({
          id: "rally",
          label: "Rally",
          variant: "secondary",
          onClick: async () => {
            setComposer({
              kind: "rally",
              targetPubkey,
              targetType,
              targetCityId,
              targetLabel: "",
            });
            return "";
          },
        });
      }
      // Garrison — castle whose team matches mine.
      if (isCastleEntity && castleAcc && sameTeam) {
        const cityIdArg = castleAcc.cityId;
        const castleIdArg = castleAcc.castleId;
        morphActions.push({
          id: "garrison",
          label: "Garrison",
          variant: "secondary",
          onClick: async () => {
            setComposer({ kind: "garrison", cityId: cityIdArg, castleId: castleIdArg });
            return "";
          },
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
    // intracity_start gates on require_stables(estate, 1) at
    // programs/novus_mundus/src/processor/travel/intracity_start.rs:136,
    // so we must mirror that gate in the UI to avoid an on-chain reject.
    morphActions.push({
      id: "intra-walk",
      label: "move here",
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

    // Composer takes over the panel when set. Same surface that would
    // otherwise show the entity detail — keeps the player in one
    // visual region rather than launching a separate sidebar/modal.
    if (composer) {
      return (
        <ComposerFrame title={composerTitle(composer)} onBack={() => setComposer(null)}>
          {composer.kind === "reinforce" && (
            <ReinforceComposerPanel
              targetWallet={composer.targetWallet}
              onClose={() => setComposer(null)}
            />
          )}
          {composer.kind === "rally" && (
            <RallyComposerPanel
              targetPubkey={composer.targetPubkey}
              targetType={composer.targetType}
              targetCityId={composer.targetCityId}
              targetLabel={composer.targetLabel}
              onClose={() => setComposer(null)}
            />
          )}
          {composer.kind === "garrison" && (
            <GarrisonComposerPanel
              cityId={composer.cityId}
              castleId={composer.castleId}
              onClose={() => setComposer(null)}
            />
          )}
        </ComposerFrame>
      );
    }

    // Entity selection takes over the panel.
    if (selectedEntity) {
      // Show "Approach & strike" only when the entity is in the player's
      // current city — intracity travel can't cross city boundaries.
      const canApproach =
        !travel.traveling && isHomeDestination && publicKey != null && player != null;
      const sameCity = player?.currentCity === node.city.cityId;
      return (
        <EntityPanel
          entity={selectedEntity}
          city={node.city}
          worldPlayers={worldPlayers}
          worldCastles={worldCastles}
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
          myPlayerLevel={player?.level}
          maxLevelDiff={maxLevelDiff}
          myTeamStr={myTeamStr}
          myTeamName={myTeamName}
          teamsByPda={teamsByPda}
          onFocus={(gridLat, gridLong) => mapRef.current?.focusCell(gridLat, gridLong)}
          sameCity={sameCity}
          onOpenComposer={setComposer}
          onOpenInCastles={(castleId, cityId) =>
            /* Pass cityId too — castle-tab derives the PDA via
             * `useCastle(cityId, castleId)`; the previous version
             * fell through to `player.currentCity`, so a deep link
             * from a castle inspected in a different city resolved
             * to the wrong castle's PDA. */
            urlPatch({
              tab: "castle",
              castleId: String(castleId),
              cityId: String(cityId),
            })
          }
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

        {/* City detail stats — same StatCard grid as the player EntityPanel,
            so a city readout and an entity readout share one visual language.
            "in your range" mirrors the chain-side strike window in
            attack_encounter; if the windows don't overlap we render it in
            seal-red so a level-1 player scouting a lv 50–100 city sees "no"
            at a glance. */}
        {(() => {
          let rangeLabel: string | null = null;
          let rangeTone: "danger" | undefined;
          if (player && maxLevelDiff != null) {
            const pLevel = player.level ?? 0;
            const lo = Math.max(pLevel - maxLevelDiff, node.city.minEncounterLevel);
            const hi = Math.min(pLevel + maxLevelDiff, node.city.maxEncounterLevel);
            if (lo <= hi) {
              rangeLabel = `${lo}–${hi}`;
            } else {
              rangeLabel = "out of reach";
              rangeTone = "danger";
            }
          }
          return (
            <>
              <div
                style={{
                  marginTop: "0.7rem",
                  display: "grid",
                  gridTemplateColumns: rangeLabel ? "1fr 1fr 1fr" : "1fr 1fr",
                  gap: "0.4rem",
                }}
              >
                <StatCard
                  label="people present"
                  value={node.city.playersPresent.toLocaleString()}
                />
                <StatCard
                  label="encounters (lv)"
                  value={`${node.city.minEncounterLevel}–${node.city.maxEncounterLevel}`}
                />
                {rangeLabel && (
                  <StatCard label="in your range (lv)" value={rangeLabel} tone={rangeTone} />
                )}
              </div>
              {!isCurrent && travelPreview && (
                <div
                  style={{
                    marginTop: "0.4rem",
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: "0.4rem",
                  }}
                >
                  <StatCard
                    label="road by foot"
                    value={`${travelPreview.distanceKm.toLocaleString()} km`}
                    hint={travelPreview.timeStr}
                  />
                  <StatCard
                    label="by the stables"
                    value={travelPreview.teleportCost.toLocaleString()}
                    hint="NOVI"
                  />
                </div>
              )}
            </>
          );
        })()}

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
                {destCell ? "destination chosen, walk below." : "touch a cell to walk there."}
              </p>

              {/* Travel preview — distance + time for the chosen walk.
                  Intracity has no NOVI cost on chain, so the chip is a
                  two-up matching the intercity preview's first row. */}
              {destCell && intracityPreview && (
                <div
                  style={{
                    marginTop: "0.7rem",
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: "0.4rem",
                  }}
                >
                  <StatCard
                    label="distance"
                    value={
                      intracityPreview.distanceMeters >= 1000
                        ? `${(intracityPreview.distanceMeters / 1000).toFixed(1)} km`
                        : `${intracityPreview.distanceMeters.toLocaleString()} m`
                    }
                  />
                  <StatCard label="on foot" value={intracityPreview.timeStr} />
                </div>
              )}

              {/* Cell coordinates — same readout the EntityPanel surfaces
                  for occupants, available here too so the player sees the
                  picked cell's lat/long before committing. */}
              {destCell && (
                <div
                  style={{
                    marginTop: "0.35rem",
                    padding: "0.35rem 0.6rem",
                    background: "var(--readout-tint)",
                    border: "1px solid var(--parchment-edge)",
                    fontSize: "0.6rem",
                    letterSpacing: "0.04em",
                    color: "var(--ink-soft)",
                    display: "flex",
                    justifyContent: "space-between",
                    gap: "0.5rem",
                    fontFamily: "var(--font-jetbrains), ui-monospace, monospace",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  <span>lat</span>
                  <span>{(destCell.gridLat / 10000).toFixed(4)}°</span>
                  <span style={{ color: "var(--ink-faint)" }}>·</span>
                  <span>long</span>
                  <span>{(destCell.gridLong / 10000).toFixed(4)}°</span>
                </div>
              )}

              {/* On-chain terrain bonuses for the chosen walk cell. Hidden
                  until a cell is picked so we don't suggest bonuses for an
                  unselected target. */}
              {destCell && currentCityData && (
                <CellAffinityPanel cityAccount={currentCityData.account} cell={destCell} />
              )}

              {/* Only render the Walk here CTA once the player has actually
                  picked a cell — a disabled button in the default state
                  reads as broken UI when there's nothing to commit. The
                  stables-gated disabled state stays for the case where
                  a cell is picked but the player can't move yet. */}
              {destCell && (
                <div className="hidden md:block">
                  <div style={{ marginTop: "0.9rem" }}>
                    <TxButton
                      onClick={startIntraWalk}
                      disabled={!hasStables}
                      className={styles.seal}
                    >
                      <span>move here</span>
                      <span>
                        <ChevronRight className="h-3.5 w-3.5" />
                      </span>
                    </TxButton>
                  </div>
                </div>
              )}

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
              {destCell ? "landing cell chosen." : "touch the map to pick where to alight."}
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
          /* Don't clear the entity selection here — the user is
           * usually picking a neighbour cell to walk to a selected
           * encounter/player for the strike workflow. Keeping the
           * entity selected means the EntityPanel + its
           * Approach/Strike button stay visible alongside the
           * landing-cell square. */
        };

    // Intracity travel — draw a line + moving marker from the player's
    // start cell to their destination cell ON the disc. Realm-map scale
    // can't show this (it's sub-pixel within one city dot), so the disc
    // is the only meaningful surface. Only set when the viewed city IS
    // the city the walk is happening in (player.currentCity during
    // intracity flight; currentCity == destinationCity for intracity).
    const walkLine =
      isIntracityTravel && player && node.city.cityId === player.currentCity
        ? (() => {
            // Local player's walk carries their own cosmetic identity
            // so the line + marker pulse in their equipped color — same
            // contract as `otherWalks` below. Catalog lookups are cheap
            // (O(1) record reads).
            const colorEntry = getCosmeticColor(player.equippedNameColor);
            const frameEntry = getCosmeticFrame(player.equippedAvatarFrame);
            return {
              fromGridLat: toGrid(player.currentLat),
              fromGridLong: toGrid(player.currentLong),
              toGridLat: toGrid(player.travelingToLat),
              toGridLong: toGrid(player.travelingToLong),
              pct: travel.pct,
              nameColorHex: colorEntry?.hex,
              nameColorAnim: colorEntry?.animation,
              frameBorderColor: frameEntry?.ring.borderColor,
            };
          })()
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
        const pct = total > 0 ? Math.min(100, Math.max(0, ((chainNow - dep) / total) * 100)) : 0;
        // Walker's cosmetic identity travels with the line + marker.
        // Color comes from the catalog (animated when the entry sets
        // `animation`); frame ring color comes from the catalog frame
        // entry. Both fall through to undefined for un-cosmeticked
        // walkers — the renderer uses the canonical seal-orange.
        const colorEntry = getCosmeticColor(a.equippedNameColor);
        const frameEntry = getCosmeticFrame(a.equippedAvatarFrame);
        return {
          fromGridLat: toGrid(a.currentLat),
          fromGridLong: toGrid(a.currentLong),
          toGridLat: toGrid(a.travelingToLat),
          toGridLong: toGrid(a.travelingToLong),
          pct,
          nameColorHex: colorEntry?.hex,
          nameColorAnim: colorEntry?.animation,
          frameBorderColor: frameEntry?.ring.borderColor,
        };
      });

    return (
      <CityTerrainMap
        ref={mapRef}
        cityAccount={targetCity.account}
        selected={selectedCell}
        onSelect={onSelectCell}
        selectedEntity={selectedEntity}
        onEntitySelect={(entity) => {
          // Picking an entity drops any in-flight landing cell — the
          // entity selection IS the new focus, and a stale travel marker
          // sitting elsewhere on the disc reads as a competing pick.
          setSelectedEntity(entity);
          if (entity) setDestCell(null);
        }}
        travel={walkLine}
        otherWalks={otherWalks}
        myPlayerPubkey={playerData?.pubkey?.toBase58?.()}
        teamMatePubkeys={teamMatePubkeys}
        getDotTooltip={resolveDotTooltip}
        /* Auto-focus only on the home-city drill-in — destination views
         * are for scouting and shouldn't snap-yank the viewer to a cell
         * that isn't theirs yet. `isHome` already gates the targetCity
         * selection above, so we forward the player's chain coords when
         * (and only when) the disc is showing their seat. */
        autoFocusCell={
          isHome && player
            ? {
                gridLat: toGrid(player.currentLat),
                gridLong: toGrid(player.currentLong),
              }
            : null
        }
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
      /* X-close in the floating panel deselects without exiting the
       * city — entity + landing cell + composer go, but destinationCity
       * stays so the disc remains mounted. */
      onCloseRequest={() => {
        setSelectedEntity(null);
        setDestCell(null);
        setComposer(null);
      }}
      travel={realmTravel}
      renderSelected={renderSelected}
      renderDefault={renderDefault}
      renderSheetOverride={renderSheetOverride}
      fullscreen
      /* Stable id for whatever the player is acting on right now. The
       * floating detail panel auto-opens on every transition to a new
       * non-null id, so picking a *different* cell or entity also
       * re-surfaces the action panel. Priority matches the panel-render
       * order in `renderSelected` below (entity > travel > cell) so the
       * id transitions in lock-step with what the panel actually shows. */
      actionId={
        selectedEntity
          ? `entity:${selectedEntity.pubkey}`
          : travel.traveling
            ? "travel"
            : destCell
              ? `cell:${destCell.gridLat},${destCell.gridLong}`
              : null
      }
      scrollHead={
        selectedEntity
          ? selectedEntity.occupantType === 2
            ? "the wild"
            : selectedEntity.occupantType === 3
              ? "the castle"
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
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  /** `true` renders the value in seal-gold — used for "headline" stats like networth. */
  accent?: boolean;
  /** `"danger"` overrides accent in red — used when a stat shouts "no" at a glance. */
  tone?: "danger";
}) {
  const valueColor =
    tone === "danger" ? "rgba(180, 60, 60, 0.95)" : accent ? "var(--seal)" : "var(--ink)";
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
          /* Dropped from 1.1rem — long text values (castle tier
           * "Stronghold", status "Transitioning", "Vacant", etc.)
           * overflowed the 1fr column in a 3-up grid inside the
           * right panel. Numeric stats (level, networth, garrison
           * "N/M") stay legible at 0.95rem because they're shorter
           * to begin with. */
          fontSize: "0.95rem",
          color: valueColor,
          marginTop: "0.15rem",
          lineHeight: 1.1,
          /* Truncate gracefully if the value still overflows — same
           * sentinel a CSS text-overflow chain needs. minWidth:0
           * lets the value flex DOWN inside a grid track that would
           * otherwise size to content. */
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          minWidth: 0,
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
  /**
   * Every castle in the kingdom — looked up by pubkey when the selected
   * entity is a castle. Castles aren't in worldPlayers/encounters because
   * their lat/long lives directly on the CastleAccount, not a Location PDA.
   */
  worldCastles?: { pubkey: { toBase58: () => string }; account: CastleSnapshot }[] | undefined;
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
  /**
   * Local player's level — used to render the encounter-vs-you level-gap
   * preview before the player commits to approach/strike. Omit (or pass
   * undefined) and the gap row is suppressed.
   */
  myPlayerLevel?: number;
  /**
   * Local player's team pubkey (base58) — drives the same/rival chip
   * colour on the inspected player's team chip. Null = solo viewer.
   */
  myTeamStr?: string | null;
  /**
   * Local player's team display name. Used to label the chip when the
   * inspected player is on the same team — falls back to "Team" when
   * the team account hasn't loaded yet.
   */
  myTeamName?: string | null;
  /**
   * Multi-team cache (base58 → TeamAccount). Lets the panel resolve
   * the inspected player's team name even when it's a rival team.
   */
  teamsByPda?: Map<string, { name: string }>;
  /**
   * GameEngine.gameplayConfig.maxEncounterLevelDiff — the chain-side cap.
   * If `myPlayerLevel` is set but this is undefined, we still show the
   * raw delta but skip the "vs cap" colouring.
   */
  maxLevelDiff?: number;
  /**
   * Click-the-name → pan/zoom the disc onto the entity's cell. Generic
   * navigation hook — same shape as the mount-time auto-focus. Omit to
   * render the name as plain text (no click target).
   */
  onFocus?: (gridLat: number, gridLong: number) => void;
  /**
   * True when the local player's `currentCity` matches the city this
   * entity lives in. Reinforce / Rally / Garrison require co-location
   * (chain-side and game-side), so we gate the buttons disabled when
   * the player is somewhere else.
   */
  sameCity?: boolean;
  /**
   * Open the composer panel in-place inside the realm map's floating
   * detail panel. Parent owns the state and the back-arrow that
   * returns to this entity view.
   */
  onOpenComposer?: (spec: ComposerSpec) => void;
  /**
   * Open the dedicated Castles tab pre-selected on this castle.
   * The inspect panel is read-only by design — court appointments,
   * upgrades, attack, claim, garrison composer all live in the
   * Castle tab where they have room. Caller is expected to push
   * both `castleId` AND `cityId` to the URL because the Castle tab
   * derives the PDA from both; passing only castleId resolves a
   * different castle's PDA when the inspected castle sits in a
   * different city than the player's `currentCity`.
   */
  onOpenInCastles?: (castleId: number, cityId: number) => void;
}

// Minimal projection of the CastleAccount fields the panel renders. The
// SDK CastleAccount has many more fields (upgrades, court, DAO config) but
// the inspect panel only needs identity + ownership + garrison.
interface CastleSnapshot {
  name: string;
  castleId: number;
  cityId: number;
  tier: number;
  status: number;
  team: { toBase58(): string };
  king: { toBase58(): string };
  garrisonCount: number;
  maxGarrison: number;
  isVacant: boolean;
  hasKing: boolean;
  claimedAt: { toNumber(): number };
  contestEndAt: { toNumber(): number };
}

/* Castle vocabulary (tier name, status name, status narration) lives
 * in `@/lib/world/castles` so the EntityPanel inspect block, the
 * on-disc hover tooltip, and the dedicated Castles tab can't drift. */

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
  // Team affiliation — `team` is NULL_PUBKEY when the player is solo,
  // a TeamAccount PDA otherwise.
  team?: { toBase58(): string };
  teamSlotIndex?: number;
  // Cosmetics (default 0 until EXT_COSMETICS is set + an equip ix flips a slot).
  // Optional so older PlayerSnapshot consumers still type-check.
  equippedAvatarFrame?: number;
  equippedNameColor?: number;
  equippedTitle?: number;
  equippedBadge?: number;
}

function EntityPanel({
  entity,
  city,
  worldPlayers,
  worldCastles,
  encounters,
  myPlayerPda,
  onApproach,
  onStrike,
  strikeDisabledReason,
  myPlayerLevel,
  maxLevelDiff,
  myTeamStr,
  myTeamName,
  teamsByPda,
  onFocus,
  sameCity = false,
  onOpenComposer,
  onOpenInCastles,
}: EntityPanelProps) {
  const isEncounter = entity.occupantType === 2;
  const isCastle = entity.occupantType === 3;
  const ox = entity.gridLong - Math.round(city.longitude * 10000);
  const oy = entity.gridLat - Math.round(city.latitude * 10000);
  const distM = Math.round(Math.sqrt(ox * ox + oy * oy) * 11);
  const distLabel =
    distM >= 1000 ? `${(distM / 1000).toFixed(1)} km` : `${distM.toLocaleString()} m`;
  const bearing = bearingLabel(ox, oy);
  const shortPubkey = `${entity.pubkey.slice(0, 4)}…${entity.pubkey.slice(-4)}`;

  // Player resolution only when the entity actually is a player; castles
  // and encounters skip the worldPlayers lookup entirely.
  const playerHit =
    !isEncounter && !isCastle
      ? worldPlayers?.find((p) => p.pubkey.toBase58() === entity.pubkey)
      : undefined;
  const account = (playerHit?.account ?? null) as PlayerSnapshot | null;
  const isSelf = !isCastle && myPlayerPda === entity.pubkey;

  const castleHit = isCastle
    ? worldCastles?.find((c) => c.pubkey.toBase58() === entity.pubkey)
    : undefined;
  const castle = castleHit?.account ?? null;

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

  // Player display name — prefer the on-chain name verbatim (custom or
  // the chain's default `Player #N`); it's always THE player's name, so
  // collapsing it to "You" or "Unnamed" buries identity the chain
  // already gave us. Only fall through to the placeholder when the
  // account itself is missing.
  const displayName = isEncounter
    ? encRarityName
      ? `${encRarityName} encounter`
      : "Wild encounter"
    : isCastle
      ? castle?.name?.trim() || `Castle #${castle?.castleId ?? "?"}`
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

  // Cosmetic name colour — falls through `var(--ink)` until the player
  // has equipped a colour AND the catalog has the matching entry.
  const nameColorEntry =
    !isEncounter && !isCastle ? getCosmeticColor(account?.equippedNameColor) : null;
  const nameColor = nameColorEntry?.hex ?? "var(--ink)";
  // CSS class for animated colors (pulse / embered / glimmer / vesper /
  // cinder). Null for static colors and non-player entities.
  const nameAnimClass = cosmeticColorAnimationClass(nameColorEntry);
  // Avatar frame — replaces the default seal border on the level pip
  // when set. Glow halo wraps the pip when the catalog entry defines one.
  const frameEntry =
    !isEncounter && !isCastle ? getCosmeticFrame(account?.equippedAvatarFrame) : null;
  const pipBorderColor = isEncounter
    ? encRarityColor
    : (frameEntry?.ring.borderColor ?? "var(--seal)");
  const pipBorderStyle = frameEntry?.ring.borderStyle ?? "solid";
  const pipBorderWidth = frameEntry ? frameEntry.ring.borderWidth : 2;
  const pipGlow = frameEntry?.ring.glow;

  return (
    <>
      {/* Hero — name + level pip + tier/title/badge chips. */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "auto 1fr",
          gap: "0.7rem",
          alignItems: "center",
        }}
      >
        {/* Level pip — encounters get a swords + their level under it.
            Players with an equipped avatar frame swap the default seal
            border for the frame's ring + glow, so the most-prominent
            avatar surface in the panel surfaces frame ownership at
            first glance. */}
        <div
          title={
            frameEntry
              ? `${frameEntry.name}${frameEntry.flavorText ? ` — ${frameEntry.flavorText}` : ""}`
              : undefined
          }
          style={{
            width: "48px",
            height: "48px",
            borderRadius: "50%",
            border: `${pipBorderWidth}px ${pipBorderStyle} ${pipBorderColor}`,
            background: "var(--readout-tint)",
            display: "grid",
            placeItems: "center",
            color: isEncounter ? encRarityColor : (frameEntry?.ring.borderColor ?? "var(--seal)"),
            fontFamily: "var(--font-jetbrains), ui-monospace, monospace",
            fontWeight: 700,
            fontSize: isEncounter ? "1.1rem" : "1.2rem",
            lineHeight: 1,
            boxShadow: pipGlow
              ? `inset 0 0 8px rgba(110,70,30,0.18), 0 0 12px ${pipGlow}`
              : "inset 0 0 8px rgba(110,70,30,0.18)",
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
          {onFocus ? (
            // Clicking the name pans/zooms the disc onto this entity —
            // the generic "find me on the map" affordance shared by any
            // future navigation prompt.
            <button
              type="button"
              onClick={() => onFocus(entity.gridLat, entity.gridLong)}
              title={`Focus map on ${displayName}`}
              className={nameAnimClass ?? undefined}
              style={{
                appearance: "none",
                background: "transparent",
                border: "none",
                padding: 0,
                margin: 0,
                textAlign: "left",
                cursor: "pointer",
                font: "inherit",
                fontSize: "1rem",
                fontWeight: 700,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: nameColor,
                lineHeight: 1.15,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                width: "100%",
              }}
            >
              {displayName}
            </button>
          ) : (
            <div
              className={nameAnimClass ?? undefined}
              style={{
                fontSize: "1rem",
                fontWeight: 700,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: nameColor,
                lineHeight: 1.15,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={displayName}
            >
              {displayName}
            </div>
          )}
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
            {(() => {
              if (isEncounter) return null;
              const theirTeam = account?.team?.toBase58?.();
              if (!theirTeam || theirTeam === "11111111111111111111111111111111") return null;
              const same = !!myTeamStr && theirTeam === myTeamStr;
              const teamName = same
                ? (myTeamName ?? "Team")
                : teamsByPda?.get(theirTeam)?.name?.trim() || "Rival";
              return <> · {teamName}</>;
            })()}
          </div>
          {!isEncounter &&
            (tierName ||
              (account?.equippedTitle ?? 0) > 0 ||
              (account?.equippedBadge ?? 0) > 0 ||
              (account?.team?.toBase58?.() &&
                account.team.toBase58() !== "11111111111111111111111111111111")) && (
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "0.35rem",
                  marginTop: "0.35rem",
                }}
              >
                {tierName && (
                  <div
                    style={{
                      display: "inline-block",
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
                {/* Team chip — name + rank, color-coded by viewer's
                 * affiliation. Falls back to "Team" while the team
                 * account fetch is in flight so the layout doesn't
                 * shift when it resolves. */}
                {(() => {
                  const theirTeam = account?.team?.toBase58?.();
                  if (!theirTeam || theirTeam === "11111111111111111111111111111111") return null;
                  const same = !!myTeamStr && theirTeam === myTeamStr;
                  const teamName = same
                    ? (myTeamName ?? "Team")
                    : teamsByPda?.get(theirTeam)?.name?.trim() || "Rival";
                  const color = same ? "rgba(220, 175, 60, 0.95)" : "rgba(180, 60, 60, 0.95)";
                  return (
                    <div
                      title={`${teamName} · slot ${account?.teamSlotIndex ?? 0}`}
                      style={{
                        display: "inline-block",
                        fontSize: "0.55rem",
                        letterSpacing: "0.18em",
                        textTransform: "uppercase",
                        padding: "0.15rem 0.45rem",
                        border: `1px solid ${color}`,
                        color,
                        background: "var(--readout-tint)",
                      }}
                    >
                      {teamName} #{account?.teamSlotIndex ?? 0}
                    </div>
                  );
                })()}
                <CosmeticBadgeChip id={account?.equippedBadge ?? 0} />
                <CosmeticTitleChip id={account?.equippedTitle ?? 0} />
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

      {/* Cell coordinates — converted back from on-chain grid (×10,000)
          to float degrees so they're readable as map coords. Sits below
          the bearing pill in the same chip palette. */}
      <div
        style={{
          marginTop: "0.35rem",
          padding: "0.35rem 0.6rem",
          background: "var(--readout-tint)",
          border: "1px solid var(--parchment-edge)",
          fontSize: "0.6rem",
          letterSpacing: "0.04em",
          color: "var(--ink-soft)",
          display: "flex",
          justifyContent: "space-between",
          gap: "0.5rem",
          fontFamily: "var(--font-jetbrains), ui-monospace, monospace",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        <span>lat</span>
        <span>{(entity.gridLat / 10000).toFixed(4)}°</span>
        <span style={{ color: "var(--ink-faint)" }}>·</span>
        <span>long</span>
        <span>{(entity.gridLong / 10000).toFixed(4)}°</span>
      </div>

      {!isEncounter && !isCastle && (
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

      {!isEncounter && !isCastle && !account && (
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

      {isCastle && castle && (
        <>
          {/* Castle row 1 — tier · status · garrison. The danger tone
           * fires on Contest (active conflict) and Vulnerable (held
           * but exposed), since those are the two states that demand
           * a decision. Protected reads neutral — the seat's safe. */}
          <div
            style={{
              marginTop: "0.7rem",
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr",
              gap: "0.4rem",
            }}
          >
            <StatCard label="tier" value={CASTLE_TIER_NAMES[castle.tier] ?? `T${castle.tier}`} />
            <StatCard
              label="status"
              value={CASTLE_STATUS_NAMES[castle.status] ?? `S${castle.status}`}
              tone={isCastleStatusDanger(castle.status) ? "danger" : undefined}
            />
            <StatCard label="garrison" value={`${castle.garrisonCount}/${castle.maxGarrison}`} />
          </div>

          {/* Status narration — one-line story so the seat's current
           * disposition reads without decoding the status word. */}
          <p
            style={{
              marginTop: "0.4rem",
              fontStyle: "italic",
              fontSize: "0.7rem",
              lineHeight: 1.35,
              color: "var(--ink-soft)",
            }}
          >
            {CASTLE_STATUS_NARRATION[castle.status] ?? "The condition of the seat is unclear."}
          </p>

          {/* Garrison strength bar — visual reinforcement of the
           * numerical N/M stat-card above. Filled portion uses the
           * danger tone when the castle is in Contest or Vulnerable
           * (states where garrison strength matters most). */}
          {castle.maxGarrison > 0 &&
            (() => {
              const pct = Math.min(
                100,
                Math.round((castle.garrisonCount / castle.maxGarrison) * 100),
              );
              const dangerState = isCastleStatusDanger(castle.status);
              return (
                <div
                  style={{
                    marginTop: "0.4rem",
                    height: "6px",
                    borderRadius: "3px",
                    background: "var(--readout-tint)",
                    border: "1px solid var(--parchment-edge)",
                    overflow: "hidden",
                  }}
                  title={`Garrison ${castle.garrisonCount}/${castle.maxGarrison}`}
                >
                  <div
                    style={{
                      width: `${pct}%`,
                      height: "100%",
                      background: dangerState ? "rgba(180, 60, 30, 0.85)" : "var(--seal)",
                    }}
                  />
                </div>
              );
            })()}

          {/* Castle row 2 — ownership chips */}
          <div
            style={{
              marginTop: "0.4rem",
              padding: "0.45rem 0.6rem",
              background: "var(--readout-tint)",
              border: "1px solid var(--parchment-edge)",
              fontSize: "0.7rem",
              letterSpacing: "0.04em",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              gap: "0.5rem",
            }}
          >
            <span style={{ color: "var(--ink-soft)", fontStyle: "italic" }}>
              {castle.isVacant
                ? "vacant — claimable"
                : castle.hasKing
                  ? "held by"
                  : "garrisoned by"}
            </span>
            <span
              style={{
                fontFamily: "var(--font-jetbrains), ui-monospace, monospace",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {castle.isVacant
                ? "—"
                : (() => {
                    const teamStr = castle.team.toBase58();
                    if (teamStr === "11111111111111111111111111111111") return "solo king";
                    const same = !!myTeamStr && teamStr === myTeamStr;
                    return same
                      ? (myTeamName ?? "Your team")
                      : teamsByPda?.get(teamStr)?.name?.trim() || "Rival team";
                  })()}
            </span>
          </div>

          {/* King identity — DomainName resolves the king's wallet to
           * their .sol name when one is registered, falling through to
           * a shortened address otherwise. Only shown when held. */}
          {castle.hasKing && (
            <div
              style={{
                marginTop: "0.4rem",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
                padding: "0.35rem 0.6rem",
                fontSize: "0.7rem",
                letterSpacing: "0.04em",
              }}
            >
              <span style={{ color: "var(--ink-soft)", fontStyle: "italic" }}>king</span>
              <span
                style={{
                  fontFamily: "var(--font-jetbrains), ui-monospace, monospace",
                }}
              >
                <DomainName pubkey={castle.king.toBase58()} chars={6} />
              </span>
            </div>
          )}

          {/* Open in Castles — deep-link to the dedicated tab pre-
           * selected on this castle. The map panel is a quick inspect;
           * court appointments, upgrades, garrison composer, and the
           * full action surface live in the Castles tab. */}
          {onOpenInCastles && (
            <button
              type="button"
              onClick={() => onOpenInCastles(castle.castleId, castle.cityId)}
              style={{
                marginTop: "0.7rem",
                width: "100%",
                padding: "0.5rem 0.7rem",
                background: "transparent",
                border: "1px solid var(--parchment-edge)",
                color: "var(--ink)",
                fontSize: "0.72rem",
                letterSpacing: "0.05em",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "0.35rem",
              }}
            >
              Open in Castles
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          )}
        </>
      )}

      {isCastle && !castle && (
        <p
          style={{
            marginTop: "0.8rem",
            fontStyle: "italic",
            fontSize: "0.7rem",
            color: "var(--ink-soft)",
          }}
        >
          The cartographer is fetching the castle rolls…
        </p>
      )}

      {/* Encounter stats — health bar (its own block, more visceral than a
          stat card), then defense/attackers/despawn as a 3-up. */}
      {isEncounter && enc && (
        <>
          {/* Level gap — visible BEFORE the player commits to approach/
           * strike, so an out-of-range fight is legible at a glance.
           * Mirrors the chain-side check at programs/.../attack_encounter:
           * |encounter.level - player.level| must be ≤ maxLevelDiff. */}
          {myPlayerLevel != null &&
            (() => {
              const diff = Math.abs(enc.level - myPlayerLevel);
              const overCap = maxLevelDiff != null && diff > maxLevelDiff;
              const borderColor = overCap ? "rgba(180, 30, 30, 0.6)" : "var(--parchment-edge)";
              const deltaColor = overCap ? "rgba(220, 60, 60, 0.95)" : "var(--ink)";
              return (
                <div
                  style={{
                    marginTop: "0.7rem",
                    padding: "0.45rem 0.6rem",
                    background: "var(--readout-tint)",
                    border: `1px solid ${borderColor}`,
                    fontSize: "0.7rem",
                    letterSpacing: "0.04em",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "baseline",
                    gap: "0.5rem",
                  }}
                >
                  <span style={{ color: "var(--ink-soft)", fontStyle: "italic" }}>
                    lv {enc.level} vs you (lv {myPlayerLevel})
                  </span>
                  <span
                    style={{
                      fontFamily: "var(--font-jetbrains), ui-monospace, monospace",
                      fontVariantNumeric: "tabular-nums",
                      fontWeight: 700,
                      color: deltaColor,
                    }}
                  >
                    Δ {diff}
                    {maxLevelDiff != null && ` / ${maxLevelDiff}`}
                    {overCap && " · too wide"}
                  </span>
                </div>
              );
            })()}

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
          player is already traveling — both states make the button useless.
          Desktop-only (`hidden md:block`); on mobile the MorphTabBar carries
          the same Strike / Approach action so we don't double up. */}
      {!isSelf && onStrike ? (
        <div className="hidden md:block" style={{ marginTop: "0.9rem" }}>
          <TxButton
            onClick={onStrike}
            className={styles.seal}
            disabled={!!strikeDisabledReason || (isEncounter && !!enc && encHealthPct <= 0)}
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
        <div className="hidden md:block" style={{ marginTop: "0.9rem" }}>
          <TxButton
            onClick={onApproach}
            className={styles.seal}
            disabled={isEncounter && !!enc && encHealthPct <= 0}
          >
            <span>Approach</span>
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
      ) : null}

      {/* Context actions — Reinforce / Rally / Garrison. Desktop-only —
       *  on mobile the MorphTabBar carries the same actions so the panel
       *  doesn't double them up. Chain-side rules per button match what
       *  the morph-action registration below enforces. */}
      <div className="hidden md:block">
        {(() => {
          const buttons: React.ReactNode[] = [];
          const enabledStyle = {
            fontSize: "0.65rem",
            letterSpacing: "0.08em",
            textTransform: "uppercase" as const,
            padding: "0.4rem 0.7rem",
            border: "1px solid var(--seal)",
            color: "var(--seal)",
            background: "var(--readout-tint)",
            cursor: "pointer",
          };
          const disabledStyle = {
            ...enabledStyle,
            opacity: 0.4,
            cursor: "not-allowed",
          };
          const gatedTitle = sameCity ? undefined : "Travel to this city first.";
          const theirPlayerTeam = !isEncounter && !isCastle ? account?.team?.toBase58?.() : null;
          const theirCastleTeam = isCastle ? castle?.team?.toBase58?.() : null;
          const onSameTeam =
            !!myTeamStr &&
            ((!!theirPlayerTeam &&
              theirPlayerTeam !== "11111111111111111111111111111111" &&
              theirPlayerTeam === myTeamStr) ||
              (!!theirCastleTeam &&
                theirCastleTeam !== "11111111111111111111111111111111" &&
                theirCastleTeam === myTeamStr));

          // Reinforce — same-team player, both in the same city.
          if (!isEncounter && !isCastle && !isSelf && account?.owner && onSameTeam) {
            const owner = account.owner;
            buttons.push(
              <button
                key="reinforce"
                type="button"
                disabled={!sameCity}
                aria-disabled={!sameCity}
                title={gatedTitle}
                onClick={() =>
                  sameCity &&
                  onOpenComposer?.({ kind: "reinforce", targetWallet: owner.toBase58() })
                }
                style={sameCity ? enabledStyle : disabledStyle}
              >
                Reinforce
              </button>,
            );
          }

          // Rally — I have a team, target is enemy (non-self, non-teammate),
          // we're in the same city as the target.
          const canRally =
            !!myTeamStr && !isSelf && !onSameTeam && (isEncounter || isCastle || !!account);
          if (canRally) {
            const targetType = isEncounter ? 1 : isCastle ? 2 : 0;
            const targetCityId = isCastle ? (castle?.cityId ?? city.cityId) : city.cityId;
            const targetLabel = displayName;
            buttons.push(
              <button
                key="rally"
                type="button"
                disabled={!sameCity}
                aria-disabled={!sameCity}
                title={gatedTitle}
                onClick={() =>
                  sameCity &&
                  onOpenComposer?.({
                    kind: "rally",
                    targetPubkey: entity.pubkey,
                    targetType,
                    targetCityId,
                    targetLabel,
                  })
                }
                style={sameCity ? enabledStyle : disabledStyle}
              >
                Rally
              </button>,
            );
          }

          // Garrison — castle whose team matches mine, in the same city.
          if (isCastle && castle && onSameTeam) {
            buttons.push(
              <button
                key="garrison"
                type="button"
                disabled={!sameCity}
                aria-disabled={!sameCity}
                title={gatedTitle}
                onClick={() =>
                  sameCity &&
                  onOpenComposer?.({
                    kind: "garrison",
                    cityId: castle.cityId,
                    castleId: castle.castleId,
                  })
                }
                style={sameCity ? enabledStyle : disabledStyle}
              >
                Garrison
              </button>,
            );
          }

          if (buttons.length === 0) return null;
          return (
            <div style={{ marginTop: "0.7rem", display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
              {buttons}
            </div>
          );
        })()}
      </div>

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
    </>
  );
}

// ── Composer frame ────────────────────────────────────────────────────
// Wraps a composer (Reinforce / Rally / Garrison) in the realm map's
// floating detail panel so the player stays in one visual region rather
// than launching a separate sidebar/modal. Carries a back arrow that
// dismisses the composer and returns to the entity detail above.

type ComposerSpec =
  | { kind: "reinforce"; targetWallet: string }
  | {
      kind: "rally";
      targetPubkey: string;
      targetType: number;
      targetCityId: number;
      targetLabel: string;
    }
  | { kind: "garrison"; cityId: number; castleId: number };

function composerTitle(spec: ComposerSpec): string {
  switch (spec.kind) {
    case "reinforce":
      return "Reinforce";
    case "rally":
      return "Raise Rally";
    case "garrison":
      return "Join Garrison";
  }
}

function ComposerFrame({
  title,
  onBack,
  children,
}: {
  title: string;
  onBack: () => void;
  children: React.ReactNode;
}) {
  return (
    <div>
      <button
        type="button"
        onClick={onBack}
        aria-label="Back to entity detail"
        title="Back"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "0.3rem",
          padding: "0.25rem 0.55rem 0.25rem 0.35rem",
          marginBottom: "0.6rem",
          background: "transparent",
          border: "1px solid var(--parchment-edge)",
          borderRadius: "999px",
          color: "var(--ink-soft)",
          fontFamily: "inherit",
          fontSize: "0.62rem",
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          cursor: "pointer",
        }}
      >
        <ChevronLeft className="h-3 w-3" aria-hidden />
        <span>{title}</span>
      </button>
      {children}
    </div>
  );
}
