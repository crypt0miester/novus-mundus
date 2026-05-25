# Webapp Dev TODO

Working backlog for `apps/web` (the Next.js client). Each item records the
problem, the current state with file references, and the plan. Status keys:
`DONE` shipped this pass · `WIP` in progress · `TODO` not started.

Last touched: 2026-05-21.

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

## 9. Table view and grid view for lists - needs to be used everywhere — `TODO`

**Problem.** No view toggle anywhere. Cities/Teams were card-grid only;
the leaderboard was a hand-rolled table. Each browser reimplemented layout.

**Plan / done.**
- New `components/shared/ViewToggle.tsx` — grid/table segmented control.
- New `components/shared/DataTable.tsx` — generic column-driven table.
- New `lib/hooks/useViewMode.ts` — localStorage-backed view preference.
- Applied to `PlayerBrowser`, `CityBrowser`, `TeamBrowser`.

----

13. reinforce should be in team page
14. team page needs more player data (reinforce, user stats, etc.)
11. expedition, castle untested.
15. players have no idea if there is another rally going on in the team that they may want to join.
16. rally, player attack, reinforce view need to be rethought of. it is completely unusable. hero selection needs to be 3 slots rather than a drop down. 
17. its not clear how to open up more slots. in heroes tab
18. mini activities are so bland. needs a UX overramps. best one right now is morning drill. others are very bad UX.
xx. map should have all the encounters, other players, my position. I'm thinking of dropping it from combat tab. arena should open on arena building click. dungeon too. not sure where to put the heroes. so I'm thinking of replacing combat tab with arena. everything should be wired properly.
xx. workshop is heavily broken.
xx. market needs to be smart about how much weapons are needed and vehicles
xx. increase meditation xp rate to 100xp/hr
12. chat
13. fix kit