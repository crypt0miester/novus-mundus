# Webapp Dev TODO

Working backlog for `apps/web` (the Next.js client). Each item records the
problem, the current state with file references, and the plan. Status keys:
`DONE` shipped this pass · `WIP` in progress · `TODO` not started.

Last touched: 2026-05-29.

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

## #12 Team chat / War Table - `DONE`

Resolved by the War Table feature. The "Team chat coming soon" placeholder in
`app/(game)/team/_components/team-tab.tsx` is replaced by a `ThreadRenderer`
embed. Transport is the on-chain `novus_mundus` `POST_WAR_TABLE_MESSAGE = 323`
instruction emitting `sol_log_data`, bodies encrypted per-thread under a key
derived from `WT_MASTER_SECRET` keyed on the on-chain `membership_epoch`.

**Shipped (chain + SDK + web, all five scopes).**
- Chain: the post instruction, all five scope access predicates, envelope
  validation, the `key_version == membership_epoch` rule plus the encrypted-flag
  rule, the `membership_epoch` / `joined_at_epoch` account fields, and the
  thirteen epoch-bump sites.
- SDK + crypto: envelope encode/decode, HMAC KDF, XChaCha20-Poly1305 with the
  72-byte AAD, `WarTableClient` (`postMessage` with priority-fee ceiling,
  `readThread`, `subscribeThread`, `discoverDmThreads`), the `ThreadKeyProvider`
  implementations, updated state parsers, crypto unit suite + e2e suite.
- Web: SIWS-authed key route, Zustand store, `useWarTable` / `useDmInbox`,
  `ThreadRenderer`, and the team / rally / encounter / DM / PvP embeds + the
  Messages nav entry.

See `docs/WAR_TABLE_DESIGN.md` (as-built design) and
`docs/WAR_TABLE_IMPL_SPEC.md` (authoritative spec) for details.

**Deferred follow-ups.**
1. **Castle web embed.** Scope 2 (castle) is wired in chain + SDK but not
   surfaced in any web panel, because no `CastleDetailPanel` exists yet. Add a
   `ThreadRenderer scope={WarTableScope.Castle}` embed when that panel is built.
2. **True cross-kingdom encounter e2e.** The current e2e seeds one game engine,
   so the out-of-kingdom access path is exercised by proxy (a player with
   no/foreign `PlayerAccount`). A genuine cross-kingdom test needs a second
   `init_game_engine` in the same SVM to assert
   `sender_player.game_engine != encounter.game_engine`.


---

## #18 Daily-activity minigame UX — `WIP`

Minigame UIs live under `app/(game)/estate/_components/daily-activity/` (meta
at `daily-activity/meta.ts`; the Barracks "Morning Drill" reflex round is the
benchmark). The other archetypes read as bland forms.

**Shipped this pass (2026-05-28).**
- `_shell.tsx` now exports `GameHeader` (round pips, lifted from ReflexGame),
  `ResultBadge` (gold/silver/muted/fail chip), `GameTimer` (round-wide
  countdown bar, color-shifts gold→amber→red, snap-submits on expire),
  and `tierFromRemaining` / `tierFromMemoryMoves` helpers.
- `McqGame`, `AssignmentGame`, `OrderingGame`, `SetSelectGame` each gained
  `GameHeader` + round-wide `GameTimer` (auto-submits on expire; unanswered
  slots count as wrong) + selection scale/glow juice.
- `MemoryGame` gained the timer (display-only pressure), a per-match pulse,
  and a 1.8s "Ledger reconciled" completion overlay with `ResultBadge`
  scored on move efficiency (`tierFromMemoryMoves`).

**Timing knobs to tune from playtest** — all in the per-game `MS_PER_*`
constants at the top of each file: MCQ 6s/question, Assignment 4s/item,
Ordering 6s/item, SetSelect 3s/item, Memory 3s/pair. Bump per archetype if
playtesters report it's too tight.

**Follow-up — cosigner-side elapsed_ms (the actual bot fix).** Time pressure
on the client is human urgency; it doesn't gate bots. The real defense is
the game_authority cosigner refusing submits faster than the human-plausible
floor (~250ms) and tier-gating the reward by elapsed_ms. Lives in the
daily-activity submit handler on the cosigner side; the chain doesn't need
to change because the cosigner is already the authoritative arbiter of
score. When that ships, the client's `tierFromRemaining` / per-game timers
become the visible signal of the same metric the cosigner already enforced.

**Optional later** — render MCQ prompts to SVG/canvas glyphs so naive
DOM-scrapers need OCR. Lower priority than the cosigner-elapsed work; ships
marginal friction at meaningful effort.

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
