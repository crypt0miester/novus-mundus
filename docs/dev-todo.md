# Webapp Dev TODO

Working backlog for `apps/web` (the Next.js client). Each item records the
problem, the current state with file references, and the plan. Status keys:
`DONE` shipped this pass · `WIP` in progress · `TODO` not started.

Last touched: 2026-05-21.

---

## 1. Top bar stays visible behind the DetailPanel bottom sheet — `DONE`

**Problem.** On mobile, opening a `DetailPanel` (which renders `BottomSheet`)
drops a full-screen backdrop at `z-50`. The mobile top bar (`LeftPanelMobile`)
sits in normal flow with no z-index, so it is dimmed and buried — the player
loses sight of their resources exactly when a detail panel (e.g. an upgrade
cost) makes those resources relevant.

**Current state.**
- `components/shared/BottomSheet.tsx` — sheet container is `fixed inset-0 z-50`.
- `components/layout/LeftPanel.tsx` — `LeftPanelMobile` is the mobile top bar,
  static position, collapsible (`expanded` state), shown `< lg`.
- `components/layout/TopBar.tsx` — desktop/tablet bar, `z-40`, shown `>= md`.

**Plan / done.**
- New `lib/store/sheet.ts` — a tiny counter store (`acquire`/`release`).
- `BottomSheet` acquires while mounted, releases on unmount/close.
- `LeftPanelMobile` + `TopBar` raise to `z-[55]` when a sheet is open, so the
  bar paints above the `z-50` backdrop but below the `z-[60]` MorphTabBar.
  Bar stays collapsed (h-10) and tappable — never overlaps the 92vh sheet.

---

## 2. Make the stats page photogenic / screenshot-worthy — `TODO`

**Problem.** The "stats page" should look good when screenshotted and shared.

**Current state.**
- `app/(game)/dashboard/page.tsx` is the de-facto stats page (treasury, power,
  XP, activity feed, daily reward). It is functional but card-dense and not
  composed as a shareable image.
- `app/world/players/[address]/page.tsx` is the *public* player profile — this
  is the genuinely shareable surface (it has a public URL).

**Plan.**
- Decide the target: private dashboard vs. public profile. The public profile
  is the better "screenshotable" candidate (shareable link, no wallet needed).
- Add a composed "hero" header: name + domain, tier crest, level ring, a few
  headline stats with strong typography, kingdom/theme accent.
- Consider an explicit share affordance (copy link / "save card").
- This is a design pass — best done with the `design-taste-frontend` skill and
  eyes on the running app. Deferred until the structural items land.

---

## 3. Make team invites easy — `DONE`

**Problem.** Inviting someone to a team required pasting a raw 44-char base58
wallet address. No lookup, no names, no validation feedback beyond "invalid".

**Current state.**
- `app/(game)/team/_components/team-tab.tsx` — invite UI is a bare text input
  (`inviteAddress`) duplicated in the desktop sidebar and the mobile section.
  `handleInvite` derives the player PDA from the typed address.
- On-chain: `createTeamInviteInstruction` (invite by invitee player PDA).

**Plan / done.**
- New `lib/players.ts` — `matchesPlayerQuery()` shared search helper.
- New `InvitePlayerPanel` (in `team-tab.tsx`) — a searchable player picker:
  filters all players by name / resolved domain / address, excludes self,
  already-teamed players, and pending invitees; one tap to invite. Still
  accepts a pasted full address for not-yet-fetched accounts.
- `handleInvite` refactored to take an explicit wallet argument.
- Used by both the desktop and mobile settings sections (de-duped).

---

## 4. Give the Mansion a purpose — `TODO`

**Problem.** In the estate UI the Mansion building reads as a dead "Home base"
tile with no interaction.

**Current state — important.** The Mansion is *not* mechanically purposeless.
On-chain (`programs/novus_mundus/src/processor/estate/daily_claim.rs`) it is the
hard gate for the **daily login claim**: daily materials/NOVI/XP, the login
streak multiplier (up to 3x at 90 days), per-level reward bonuses, and the
7/14/30/60/90/180-day milestone rewards. The gap is purely UI:
- `lib/config/building-features.ts:63` — Mansion has `desc: "Home base"`, no
  `primaryFeature`, no panel key → clicking it does nothing.
- The daily-claim UI currently lives on the **dashboard**, disconnected from
  the building that powers it.

**Plan.**
- Give the Mansion a building panel that surfaces: daily claim button + streak
  counter + streak multiplier + next milestone progress + permanent bonus.
- Wire it through `building-features.ts` (panel key) like other buildings.
- Move/mirror the dashboard's Daily Reward card into that panel so the Mansion
  becomes the home of the daily loop. Medium effort — needs a new panel.

---

## 5. Players need their own page — `DONE`

**Problem.** There was a player *detail* page but no players *directory*. The
`/world` nav had Overview / Leaderboard / Teams / Cities — no Players.

**Current state.**
- `app/world/players/[address]/page.tsx` — player profile (exists, decent).
- No `app/world/players/page.tsx` index. `components/layout/WorldNav.tsx` had
  no Players entry.

**Plan / done.**
- New `components/world/PlayerBrowser.tsx` — directory with search, sort,
  grid + table views, pagination.
- New `app/world/players/page.tsx` + `layout.tsx`.
- `WorldNav` gains a "Players" entry.

---

## 6. Make spectate actually spectate — `TODO`

**Problem.** The landing page's "Spectate the Realm" button just routes to
`/world`, which is the same static city/team/player browsing available from the
nav. It is redundant — it does not let you *watch* the game.

**Current state.**
- `app/(auth)/page.tsx` → `trigger(spectateMessage(), "/world")`.
- `/world` = `RealmMap` + browsable lists. No live gameplay view.
- There IS an event pipeline: `lib/store/events.ts`, `lib/events/classify.ts`,
  `lib/events/format.ts`, `components/shared/ActivityFeed.tsx`. The city
  account also exposes `activeEncounters` / `totalEncountersSpawned` counters.

**Plan.**
- Build a real spectate view: a live realm activity feed — attacks, rallies,
  dungeon clears, encounters, team forms — streamed across all cities, ideally
  pinned to the `RealmMap` (pulse the city where something happened).
- Route "Spectate" to this view (e.g. `/world/live`) instead of `/world`.
- Larger item — needs a realm-wide event subscription strategy. Deferred.

---

## 7. Make the map more interactive — `DONE`

**7a. Per-city storyline — done.** New `lib/cityLore.ts` — all 24 cities'
storyline (region + a 1–3 sentence blurb), lifted from `docs/WORLD_LORE.md`
§XI. Surfaced in the RealmMap selected-city panel and the `/world/cities/[id]`
page (blurb + region label).

**7b/7c. Water + mountains — dropped.** A first procedural pass (scattered
lakes + triangle clusters, `RealmTerrain.tsx`) was low-quality and reverted.
Three redo directions were offered — coastal / mountain-framed / none — and the
call was to leave the map clean: the parchment + city dots + roads holds on its
own, and a realm-scale terrain layer risked clutter. Component removed.

**7d. Optional follow-up — per-city local terrain view.** The on-chain per-city
terrain (`terrainSeed`/`waterLine`/`peakLine`/anchors) is genuine LOCAL terrain
— a city's own ~50 km neighbourhood. Its proper home is a terrain mini-map on
`/world/cities/[id]`, rendered via the SDK decoder (`sdks/novus-mundus-ts/src/
calculators/terrain.ts` — `terrainElevation`, `renderTerrainPixels`). Needs
cities to carry anchor data first: `novus terrain set <city-id>` (only cities
0–2 have CLI presets today).

**Map-marker icons — skipped.** The `map-*.svg` icons stay in the legend and
panels (via `GameIcon`); the in-`<svg>` city markers keep their unicode glyphs
— the traced icons (combat is 17 paths) turn muddy at ~12 px marker size.

---

## 8. Easy search for players — `DONE`

**Problem.** No way to search for a player anywhere — discovery was scroll the
leaderboard or hand-type a profile URL.

**Plan / done.** Search box on the new Players directory (item 5): matches
name, resolved AllDomains name, or wallet address. Shares `lib/players.ts`
`matchesPlayerQuery()` with the team invite picker (item 3).

---

## 9. Table view and grid view for lists — `DONE`

**Problem.** No view toggle anywhere. Cities/Teams were card-grid only;
the leaderboard was a hand-rolled table. Each browser reimplemented layout.

**Plan / done.**
- New `components/shared/ViewToggle.tsx` — grid/table segmented control.
- New `components/shared/DataTable.tsx` — generic column-driven table.
- New `lib/hooks/useViewMode.ts` — localStorage-backed view preference.
- Applied to `PlayerBrowser`, `CityBrowser`, `TeamBrowser`.

---

## Shipped

Items **1, 3, 5, 8, 9** — top-bar/sheet fix, easy team invites, the Players
directory, player search, and the table/grid toggle — plus **7a**, the per-city
storyline. Item 7's realm-map water/mountains (7b/7c) were tried and dropped as
not worth the clutter.

## Still open

Items **2, 4, 6** — stats-page polish, the Mansion panel, and real spectating.
Optional: **7d**, a per-city local terrain view. Notes above are enough to pick
any of them up cold.
