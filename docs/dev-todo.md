# Webapp Dev TODO

Working backlog for `apps/web` (the Next.js client). Each item records the
problem, the current state with file references, and the plan. Status keys:
`DONE` shipped this pass · `WIP` in progress · `TODO` not started.

Last touched: 2026-05-26.

---

## Recently shipped — verified 2026-05-26

- **Max-effort review pass.** Six parallel reviewers across SDK / web map /
  cosmetics UI / estate tabs / composer panels / shop+stores. Confirmed-bug
  fixes shipped this pass — fuller listing in commit history, highlights:
  - **On-chain.** Bundles + flash-sales now pre-scan and unlock
    `EXT_COSMETICS` so cosmetics in those flows actually deliver instead
    of silently no-op'ing. `fulfill_item` cosmetic arms hard-error on a
    missing section (refunds the tx) and the reserved 1256–1383 ranges
    reject loudly with `InvalidParameter`. Inventory PDA derivation
    fixed from `buyer.address()` → `player_account.address()` to match
    the SDK. Cosmetic `equip` switched to `load_checked_mut_by_key` for
    discriminator + canonical-PDA validation.
  - **Web.** `RallyDetailPanel` Rules-of-Hooks violation fixed (the
    `useMorphActions` call after the early returns was crashing the
    panel every time a rally loaded). Rally-create now requires at
    least one unit (chain rejects weapons-only). `useCastle` gates
    `data` on PDA equality so a re-open for a different castle no
    longer renders the previous castle's data. Wardrobe preflights
    `EXT_COSMETICS`, walks bit 0 of the ownership mask, and the
    placeholder SVG MIME swapped to `;charset=utf-8` so Safari renders
    the badges. Sanctuary meditation UI: XP estimate now uses the
    proportional `(rate × elapsed)/3600` and clamps elapsed at the
    chain's per-Sanctuary `max_seconds`; new `meditationLevelCap` (φ-based)
    gates Begin Meditation alongside the existing fragment-level cap.
    Arena daily-battle window uses the chain's rolling 24h cutoff,
    not UTC midnight. Hero Lock targets the first empty slot instead
    of hardcoded slot 0. Shop strike-through prices use the full
    multiplicative chain stack via `calculateFinalShopPrice` (subscription
    × milestone × streak × fib × market). World-profile tier display
    uses `getEffectiveTier` so an expired Legendary no longer wears the
    crimson ring. Attack link snaps to grid centres before encoding.
    Tab switch in the shop clears `selectedItem`; desktop default is
    tab-scoped. Composer panels guard `close()` on unmounted via the
    new `useIsMountedRef`; BN→number coercions in those panels use the
    new `bnToSafeNumber` (clamped, doesn't throw past 2^53).
  - **Map.** 2D terrain repaint now caches the city's terrain to a
    2048² offscreen canvas per `(cityId, terrain)` and blits via
    `drawImage` on pan/zoom — eliminates the per-pixel rerender that
    was freezing drags. 3D WebGL unmount disposes the live terrain
    (mesh + material + 64 MB colorMap texture) instead of just the
    closure-captured initial build. `markers.dispose` no longer
    double-disposes gridLines. `canUseWebGL2` probe is cached at
    module scope so Safari's per-document GL context cap doesn't fill
    after repeated mounts. Deep-link supports `?player`/`?encounter`/
    `?castle` for accurate occupant typing; `tryFocus` setTimeout
    chains now clean up on unmount.
  - **SDK.** `createEquipCosmeticInstruction` rejects non-integer ids
    (NaN was sliding through and silently unequipping). Encounters
    CLI retry list expanded to all spatial-rejection codes (OutOfRange).
    `team join` CLI bails early on `disbanded`. test-cosmetic-flow.ts
    has a real null guard now.
  - **Settings persistence.** Zustand store bumped to v1 with a
    `merge` that hard-validates `numberFormat` / `explorer` /
    `themePreference` / `mapMode` at rehydrate — invalid persisted
    strings fall back to the in-memory default instead of smuggling
    into props.



- **Market smart-buy.** `market-tab.tsx` Equip-section cards now carry an
  inline deficit + Fill affordance per-equipment-type. Refactored `unitPrice`
  into `unitPrices` (one per EQUIPMENT index) so each card can compute its
  own affordability. Each card shows `owned / need` with a red `−deficit`
  count when short; if there's a deficit, a sibling Fill button appears
  below with `Fill <min(deficit, affordable)>` — capped by what the current
  payment method (NOVI vs cash) can actually buy. Falls back to a disabled
  "Insufficient funds" state (with title-tooltip explaining the gap) when
  the player can't afford even one. Need is tier-mapped: Melee → T1 units
  (du1+ou1), Ranged → T2, Siege → T3; Armor / Produce / Drays scale with
  the full roster.
- **#17 Hero slot expansion clarity.** `HeroSlotCard` empty state now reads
  `Slot N · Empty` with a context-aware hint line ("Lock a hero below" / "Mint
  a hero first" / "Locking gated"); `heroes-tab.tsx` Active Slots header shows
  `X/3 filled · 3 max`; a banner surfaces the `HERO_LOCK` gate's requirements
  above the slot grid when the gate is missing.
- **#2 Stats page hero header.** `app/world/players/[address]/page.tsx`
  rewritten as a composed shareable card: tier-tinted glow, avatar circle
  bordered in the tier color, display-font name, copy-on-click address chip,
  level ring (`ProgressRing`, 128px, tier-coloured stroke) with `current /
  next XP` underneath, tier label as a styled chip plus status badges, three
  headline stats (Networth · Combat Power · Reputation) inside the hero so the
  screenshot reads as one image, share button (top-right) that copies the
  profile URL. Army + Combat Record + Citizen Actions kept below.
- **Meditation XP rate × 100.** `programs/novus_mundus/src/helpers/estate.rs`
  `sanctuary_meditation_xp_per_hour` is now `sanctuary_level * 100` (was
  `* 20`); doc comment examples updated; client mirror in
  `sanctuary-tab.tsx` MeditationView matches. Bonus: the on-display estimate
  was using a hardcoded 50/hr that didn't match the formula at any level —
  now uses the live per-hour rate. **Pending program redeploy** before the
  on-chain rate takes effect (use `solana program deploy`, not validator
  restart — per memory `feedback_never_restart_validator`).
- **#14 Team page per-member data.** Done by user.
- **#9 Table/grid view toggle.** `components/shared/ViewToggle.tsx`,
  `components/shared/DataTable.tsx`, `lib/hooks/useViewMode.ts`, applied across
  `PlayerBrowser`, `CityBrowser`, `TeamBrowser`.
- **#13 Reinforce moved into the team page.**
  `app/(game)/team/_components/reinforce-tab.tsx`.
- **City terrain map rewrite + map content.** `CityTerrainMap.tsx` split into
  `components/world/city3d/` (WebGL, mesh, markers, coords, controls, transition),
  with a `CityTerrainMap2DFallback.tsx`. Markers render players, encounters,
  selection rings; `map-tab.tsx` pipes live other-players and encounters through
  zustand. Closes the "map should show encounters / other players / my position"
  item.
- **#4 Mansion daily-claim panel.** `mansion-tab.tsx` registered in
  `FEATURE_VIEWS`; surfaces claim button + streak + multiplier + next milestone +
  permanent bonus. Building-features Mansion entry gets `centerView: true`.
  Dashboard's `DailyRewardCard` removed. SDK call switched from progression's
  `createClaimDailyRewardInstruction` (research-gated, never callable for most
  players) to `createDailyClaimInstruction` (mansion-based, disc 165). Cooldown
  computed from `estate.lastLoginDate` calendar-day rule.
- **FeatureView scroll/layout fix.** Added the missing `min-h-0 flex-1
  overflow-y-auto pb-24 md:pb-0` inner scroll wrapper (matches
  `/leaderboard`, `/shop`, `/team` pattern); BuildingStrip gets `shrink-0` so flex
  doesn't squash it. Also restacks BuildingStrip vertically on mobile so the
  upgrade button is full-width and unmissable. Fixed the matching mobile bug in
  `BuildingUpgradePanel` (upgrade/complete actions were `hidden lg:block`,
  relied on the easy-to-miss `MorphTabBar`).
- **Combat page deprecated; estate absorbed everything.** `/combat` deleted
  entirely (page, layout, all 4 tabs, `dungeon/RunView`). PRIMARY nav dropped to
  5 entries (no more Combat). SECONDARY Heroes/Arena/Dungeon entries repointed
  to `/estate?building=…` URLs and re-sectioned as "Estate":
  - **Arena** → Arena building feature view (`arena-tab.tsx` registered in
    `FEATURE_VIEWS`, building gets `centerView: true`).
  - **Catacombs (Dungeon)** → Catacombs building feature view
    (`catacombs-tab.tsx` + `catacombs/RunView.tsx`; building gets `centerView:
    true` and the `route` hack is gone). Upgradeable like every other building
    now.
  - **Heroes** → Sanctuary's "Heroes" sub-tab via `TabNav` and
    `useTabParam("heroes", "subtab")` inside `sanctuary-tab.tsx`; meditation is
    the second sub-tab. Sanctuary's registry-level `SANCTUARY_MEDITATE` gate
    dropped — sub-tabs self-gate.
  - **Battle** → already in `map-tab.tsx` (encounter + PvP attacks); battle-tab
    deleted.
- **Heroes refactor.** Old 1106-line `combat/_components/heroes-tab.tsx`
  split: `estate/_components/heroes-tab.tsx` (~480 lines) + `heroes/`
  subdirectory with `helpers.ts`, `types.ts`, `HeroSlotCard`,
  `UnlockedHeroCard`, `TemplateCard`, `HeroDetailPanel`,
  `TemplateDetailPanel`. The slot/card components are now reusable for #16.
- **Player-profile PvP CTA.** `world/players/[address]/page.tsx:234` Attack
  link no longer points at the dead `/combat?type=pvp`; now opens
  `/map?city=…&lat=…&long=…&player=…` so the map opens with the target
  pre-selected (map already supports these params).

---

## #6 Make spectate actually spectate — `TODO`

**Problem.** The landing page's "Spectate the Realm" button just routes to
`/world`, which is the same static city/team/player browsing available from the
nav. It is redundant — it does not let you *watch* the game.

**Current state.**
- `app/(auth)/page.tsx:56` → `trigger(spectateMessage(), "/world")`.
- `/world` = `RealmMap` + browsable lists. No live gameplay view.
- The event pipeline exists: `lib/store/events.ts`, `lib/events/classify.ts`,
  `lib/events/format.ts`, `components/shared/ActivityFeed.tsx`. The city
  account exposes `activeEncounters` / `totalEncountersSpawned` counters.

**Plan.**
- Build a real spectate view: a live realm activity feed — attacks, rallies,
  dungeon clears, encounters, team forms — streamed across all cities, ideally
  pinned to the `RealmMap` (pulse the city where something happened).
- Route "Spectate" to this view (e.g. `/world/live`) instead of `/world`.
- Larger item — needs a realm-wide event subscription strategy. Deferred.

---

## #11 Expedition and Castle — `TODO` (playtest)

Both `expedition-tab.tsx` and `castle-tab.tsx` are wired and read as functional
in code, but the user flagged neither has been exercised end-to-end. Playtest
both flows and capture any bugs as separate items; no code change needed until
specific failures are reproduced.

---

## #12 Team chat — `TODO`

`app/(game)/team/_components/team-tab.tsx:1130-1139` shows a "Team chat coming
soon" placeholder. No chat component exists. Decide on transport (on-chain
memo, off-chain relay, NFT-gated channel) before committing to scope.

---

## #15 Surface in-progress rallies to teammates — `DEFERRED`

Battle/attack now happens on the map (encounter + PvP), and the combat tab is
gone. Team-side rally coordination is no longer the primary combat surface, so
the "joinable rallies" list is lower-priority than originally framed. Revisit
if rally usage picks up.

---

## #16 Rally / attack / reinforce hero selection — `DEFERRED`

Same reason as #15. The dropdowns in `rally-tab.tsx` and `reinforce-tab.tsx`
are ugly but the player-attack flow has moved to the map (`map-tab.tsx`,
`PvpDetailPanel`), where hero selection works differently. The reusable
`HeroSlotCard` / `UnlockedHeroCard` from the heroes refactor are still
available when this is revisited.

---

## #18 Daily-activity minigame UX — `TODO`

Minigame UIs live under `app/(game)/estate/_components/daily-activity/` (meta
at `daily-activity/meta.ts`; the Barracks "Morning Drill" reflex round is the
benchmark). The other archetypes read as bland forms.

**Plan.** Pass for visual treatment, juice (feedback on input, success/fail
states), consistent header/footer pattern, and clear scoring summary. The
server-side minigame system itself is shipped (see memory
`project_minigames_phase0`); this is purely the client-side polish.

---

## Workshop bugs — `TODO` (needs playtest reproduction)

`workshop-tab.tsx` reads as functional in code (material conversion + level
gating at `WORKSHOP_LEVEL_REQ`). The TODO line said "heavily broken" without
specifics — reproduce against current build and capture concrete bugs before
fixing.

---

## "Fix kit" — `TODO` (clarify)

Original backlog line said "fix kit" with no further context. No "kit"
subsystem turns up in the app (`@solana/kit` isn't imported, no `kit/` folder).
Either a typo, shorthand for wallet adapter wiring, or a hero/loadout "kit"
concept that hasn't shipped. Pin down before scheduling.

---

## Cosmetics expansion — `TODO` (design)

**Problem.** The cosmetics catalog is 5–6/64 entries per kind across badges,
titles, and name colors, and every entry is shop-only. Free players have no
on-ramp into the cosmetic system, three enum-allocated kinds (avatar frame,
attack effect, victory pose) are unwired, and there is no on-chain path to
*award* a cosmetic outside of `purchase_item`.

**Current state.**
- Shop UI cosmetics tab + `/cosmetics` wardrobe shipped (this session).
- Catalog at `apps/web/src/lib/config/cosmetics-catalog.ts` covers badges
  (5/64), titles (6/64), name colors (6/64).
- Chain ranges 1000–1191 wired in `programs/novus_mundus/src/processor/shop/common.rs`
  + `helpers/inventory.rs::is_inventory_item_type`. Avatar-frame (kind 0),
  attack-effect (kind 4), victory-pose (kind 5) are in the `CosmeticKind` enum
  (`sdks/novus-mundus-ts/src/instructions/cosmetic.ts`) but have no item-type
  range and no `fulfill_item` decoding.

**Plan.** See `docs/design/COSMETICS_EXPANSION.md` for the full Awarded vs.
Buyable catalog proposal and chain-work breakdown. The biggest single unlock
is a new `award_cosmetic { kind, id }` instruction signed by the game engine
authority, hooked into existing completion flows (PvP win, dungeon clear,
subscription rollover, city visit) — without it, every "awarded" catalog entry
stays unobtainable. Prioritization order:

1. `award_cosmetic` ix + hooks → fill catalog with awarded entries
2. Wire attack effect (highest LTV by frequency × visibility)
3. Wire victory pose (emotional-peak monetization)
4. Wire avatar frame (pairs with badge)
5. New chain section for banners (personal + team)
6. New chain section for city/castle skins
