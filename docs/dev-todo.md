# Webapp Dev TODO

Working backlog for `apps/web` (the Next.js client). Each item records the
problem, the current state with file references, and the plan. Status keys:
`DONE` shipped this pass · `WIP` in progress · `TODO` not started.

Last touched: 2026-05-26.

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
