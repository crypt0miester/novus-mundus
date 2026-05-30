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

**Deferred follow-ups.**
1. **Castle web embed.** `DONE` — surfaced as a "War Council" `ThreadRenderer`
   card in the existing `CastleTab` (`castle-tab.tsx`), not a new panel (the tab
   already is the castle detail surface). Shown only to members who can read AND
   post on the web — the **king** and **garrison members** (court is server-
   deferred, key-route O6). Gate accounts: empty for the king, the garrison
   contribution PDA for a garrison member.
   - Required plumbing: `useWarTable` / `ThreadRenderer` gained an optional
     `gateAccounts` prop so the embedding panel supplies the Rally/Castle gate
     the thread PDA can't yield. This also **fixed a latent rally bug** —
     `RallyDetailPanel` was posting with an empty gate, which `rally_predicate`
     rejects; it now passes `[participantPda]`.
   - Remaining: court-member access (needs the key route's court branch, O6) and
     an in-app castle-member playtest (pairs with #11).

**Bug fixed this pass.** Same-slot message-id collision: ids were
`slot|0|logIndex` with `logIndex` reset per tx, so two posts in one slot
collided and `foldThread` dropped one. Id is now `slot(8) | txDisc(3) |
logIndex(1)` where `txDisc` = the leading 3 bytes of the tx signature (stable
and identical across the gTFA / standard / live read paths). Regression test in
`tests/unit/wartable-crypto.test.ts`.

**Multi-kingdom finding (out of scope, surfaced).** A second `init_game_engine`
was fully broken: it unconditionally recreated the global NOVI mint singleton
(`AccountAlreadyInUse`). Fixed to skip when the mint already exists, so a real
second kingdom's engine account now creates. A deeper limitation remains: the
NOVI mint authority is the FIRST kingdom's engine, so `init_player` (starter-NOVI
MintTo) fails under any later kingdom with `OwnerMismatch`. Fully functional
multi-kingdom needs a kingdom-agnostic mint authority across every mint CPI —
not done here.

**Public scope + presence (shipped this pass).** Added `WtScope.Public = 5`: a
plaintext, membership-free war-table scope whose thread is the kingdom's
GameEngine PDA (chain `public_predicate` = `sender_player.is_in_kingdom(thread)`,
plaintext rules cloned from Encounter). Renamed dead `WtKind.Pledge` to
`WtKind.Status` (value 1). Presence ("I'm online"): a manual `PresenceButton`
(in Settings) posts an empty Status ping to Public via `usePresenceBeat`;
`usePresence` reads online from `getSignaturesForAddress(playerPda).blockTime`
(300s window), shown as a `PresenceDot` in the DM inbox, profile
(`PvpDetailPanel`), and chat avatars. KIND=1 is hidden from chat bubbles. All
green: chain `cargo build-sbf`, 931 SDK tests, web typecheck. Deferred: the
public CHAT UI (a global channel feed) and CLI `--public` support (nit).

**Presence piggyback + CU win (follow-on).** An opt-in `broadcastPresence`
setting (default OFF) makes `useTransact` append a throttled (>=60s) +
size-guarded (drops if the tx would exceed 1232 bytes; never fails the action)
empty Status ping to normal transactions, keeping the online dot fresh during
play. Builder: `lib/presence/ping.ts`. Also optimized the on-chain player load:
`load_checked_by_key` now verifies the canonical PDA via `create_pda`
(create_program_address) instead of `derive_pda` (find loop), cutting the
war-table post from 3824 to 2334 CU (~39%) and every player load program-wide;
security-equivalent, 724/724 e2e green. Remaining ~2334 CU is dominated by the
single `create_program_address` hash (~1600); could reach ~700 by dropping the
PDA re-derivation entirely (rely on program-owned + owner==signer), deliberately
not done (weakens defense-in-depth for all scopes).


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
