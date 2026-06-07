# Webapp Dev TODO

Working backlog for `apps/web` (the Next.js client). Each item records the
problem, the current state with file references, and the plan. Status keys:
`DONE` shipped this pass · `WIP` in progress · `TODO` not started.

Last touched: 2026-05-29.

---

## #11 Expedition and Castle — `TODO` (playtest)

Both `expedition-tab.tsx` and `castle-tab.tsx` are wired and read as functional
in code, but the user flagged neither has been exercised end-to-end. Playtest
both flows and capture any bugs as separate items; no code change needed until
specific failures are reproduced.

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

------------------

    
14. small dummy event for quick testing
15. make the cranks api more robust via vercel queeues
16. someone can claim the castle without being close to it. not sure if this is a good idea. its not a problem.
since we cannot garrison the outpost (smallest type of casttle), how do we defend the castle? what is it based on?

98. last audit.
99. fix values to make it devnet/mainnet ready. double check values (events, castles, arena, shop, etc.). check for localhost:3000 links and change with actual domain