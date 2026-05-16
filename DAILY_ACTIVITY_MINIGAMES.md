# Daily Activity Minigames — Design

> The estate `daily_activity` minigame system: the player-facing skill layer,
> the stateful, server-authoritative session architecture that makes its
> `game_authority` co-signature mean something, and the full UI → backend → SDK
> build.

**Status**: Design — for review, not yet implemented
**Scope**: `apps/web` (Route Handlers + UI), `sdks/novus-mundus-ts` (shared window logic), and a **Redis** instance (sessions, locks, rate limits, RPC cache). **No program changes** (one possible exception — §7).
**Date**: 2026-05-16
**Companions**: the implemented co-sign API (`apps/web/src/app/api/cosign/`, `apps/web/src/lib/server/`) — this work supersedes its placeholder estate score roll; `docs/ESTATE_SYSTEM.md` §4 (the original minigame design), `docs/ESTATE_IMPLEMENTATION_STATUS.md` (the on-chain status index)

---

## 1. Purpose

The estate has 18 buildings, and every one of them exposes a `daily_activity`
instruction (disc 166) that grants a score-scaled reward. The score is a `u8`
(0–100) the program clamps and otherwise trusts completely — it requires a
`game_authority` co-signature as the attestation that the score is legitimate.

**Today that attestation is hollow.** `apps/web/src/lib/server/score-logic.ts`
co-signs a flat server-side dice roll (`60 + rng(36)` → band 60–95, avg ~77) for
*every* building, identical regardless of what the player did. The route's own
TODO admits it (`daily-activity/route.ts:74-76`): *"every buildingType would
have its own game theory associated with it … TODO: add game theory."*

This document specifies that game theory. It exists for three reasons:

1. **Make the co-signature real.** A co-signed self-reported number is *security
   theatre* — it proves nothing. After this work, the `game_authority` signature
   attests *the player actually played, the server ran the game, and this is
   their graded result.*
2. **Deliver the daily engagement loop.** `ESTATE_SYSTEM.md` §4 designed the
   estate as a place you *visit* three times a day (Dawn / Midday / Dusk),
   ~15–20 min total — "a mini-game within a game." Right now the estate is a
   spreadsheet. This makes it a destination.
3. **Raise the cost of farming.** `onchain/02-player-journey/daily-loop.md:147`
   states the co-signature exists "to prevent automated farming." A dice roll
   does not — a bot rolls as well as a human. A real, server-run game does not
   stop a determined bot either, but it moves botting from *free* to *more
   expensive than the reward is worth* (§13).

**On the reward shift (§7):** real minigames *re-price* daily rewards — today
everyone banks a flat ~77% of max for free. After this, idlers and bots earn the
floor and engaged players earn the ceiling. The team has accepted this, and is
comfortable tuning so that an *attentive* player is rewarded **generously** —
possibly above today's average. The deflation is not a risk to manage; the
re-pricing is the feature.

---

## 2. Where we are today

### 2.1 Three source documents, written in sequence

| Doc | Said |
|---|---|
| `ESTATE_SYSTEM.md` §4 (oldest) | Designed **12 distinct minigames**, one per building, each with a named game type and a score→reward table. Co-sign flow: *client plays locally → client sends score → server "validates plausibility" → co-signs.* |
| `ESTATE_IMPLEMENTATION_STATUS.md` | The compact index. Marks the **on-chain reward path `✅ Implemented`** for all buildings, and states plainly (line 6): **"Client work has not started."** |
| The co-sign API design | Flagged the §4 flow as theatre — "if the minigame runs purely client-side and the client POSTs a number, the co-signature is worthless." Left score-validation **unresolved**; `score-logic.ts` (§2.2) became the stopgap. |

### 2.2 What actually shipped

`score-logic.ts` resolved the blocker pragmatically — by building **no minigame
at all**. The score is a deterministic server roll, flat 60–95, same for every
building. It is *better* than `ESTATE_SYSTEM.md`'s client-reported number (the
client cannot inflate it, and a retry reproduces it), but it is not a game. The
12-minigame design was, in effect, shelved.

The 6 expansion buildings (Camp, Mine, Farm, DungeonEntry, TransportBay,
Infirmary) were added to the processor *after* `ESTATE_SYSTEM.md` §4 — so they
have on-chain reward formulas but **were never given a minigame design at all.**

### 2.3 Three defects this surfaces

Cross-referencing the per-building game theory against the live processor
(`processor/estate/daily_activity.rs`) exposes three concrete bugs:

1. **Citadel is broken.** Citadel's activity is "set defensive stance" — a
   *choice*, not a skill score. The processor maps the score into a stance
   (`daily_activity.rs:511-517`): `<34 → Defensive`, `<67 → Balanced`,
   `else → Aggressive`. The shipped roll is **60–95**, so the stance is always
   Balanced or Aggressive — **Defensive (score < 34) is mathematically
   unreachable.** A Citadel owner can never pick the defensive stance.
2. **Sanctuary's choice is absent.** `ESTATE_SYSTEM.md` defines the Sanctuary
   activity as *"select ONE hero to bless"* — a strategic decision. The route
   (`route.ts:78-83`) instead auto-picks `activeHeroes.find(first non-null)`.
   The player never chooses. (Separately: the processor ignores `score`
   entirely for this building — harmless, but the route rolls one anyway.)
3. **The score means nothing.** For the 15 genuinely score-driven buildings,
   every player gets the same ~77 every day. No skill, no engagement, no
   variation — the reward might as well be a constant.

---

## 3. The trust model

The co-sign API's original design posed score validation as one decision with
three exits: server-authoritative, verifiable replay, or soft scores. **That
framing treated the minigame as one thing.** It is eighteen things, and they fall into
three classes that do not share a trust profile:

- **Class A — choices, not games.** Sanctuary (pick a hero), Citadel (pick a
  stance). No score to validate; a *decision* to record. Trustworthy by
  construction. Riding the `score` field is the source of the Citadel bug.
- **Class B — skill puzzles.** Knowledge, perception, reasoning, and memory
  games. The bulk of the buildings.
- **Class C — timed / twitch.** Barracks ("reaction drill"), Forge ("precision
  timing"). Motor-skill games.

### 3.1 The principle: the client never holds the answer

A minigame is server-verifiable if and only if **the client never possesses the
information needed to win.** The server is the source of truth; the client is a
renderer that issues moves.

A *stateless, one-shot* design (generate everything, send it, grade one answer)
satisfies this only for puzzles whose whole content can be shown without
revealing the answer — MCQ, set-selection, sorting, ordering. It **cannot**
support:

- **Memory** — a one-shot memory game must send the whole board, so the
  "forgetting" is client-side and unenforceable.
- **Twitch** — a one-shot design has no server clock on the interaction.

### 3.2 The fix: stateful, server-mediated sessions

A **stateful session** lifts both limits. The server holds the game state
(Redis, §4); the client drives it one move at a time:

- **Memory becomes verifiable.** The server holds the board. The client never
  receives it — it sends *"flip tile 5"* and the server answers *"tile 5 is a
  Griffin."* The client only ever knows tiles it actively flipped; the **score
  is the server-counted move efficiency**, so keeping a stale element visible
  buys nothing.
- **Twitch becomes measurable.** The server stamps the moment of a GO signal and
  the moment a tap arrives; reaction time is `t_tap − t_go`, measured on the
  server's clock. A reaction *bot* still out-speeds a human — that is true of
  any twitch game and is accepted, bounded by once-per-day (§13) — but the
  player cannot fake a *low* time, because they cannot tap before the server
  sends GO.

**This is why Memory and Class C are in scope.** The earlier instinct to drop
them was an artefact of an unflagged choice to keep the backend stateless, not a
property of the games. With Redis-backed sessions, all three classes are
verifiable. The honest residual limits are in §13.

---

## 4. Architecture — stateful sessions

### 4.1 The two halves

**Deterministic generation** — the puzzle *and* its answer key are a pure
function of a server secret and on-chain state:

```
puzzle, answer_key  =  generate( seed )
seed  =  sha256( GAME_AUTHORITY_RNG_SECRET ‖ "estate.minigame" ‖ building
                 ‖ estatePda ‖ daily_date ‖ window )
```

This reuses the `lib/server/rng.ts` `Rng` primitive and its `GAME_AUTHORITY_RNG_SECRET`
unchanged. Its job: a player who abandons and restarts gets the **same** puzzle
— no re-rolling for an easier draw.

**A Redis session** — holds the live game: the generated puzzle, the answer key
(server-side only), per-move progress, timestamps, status. It is what makes
memory and twitch possible and what gives every archetype a real server-enforced
deadline and move log.

### 4.2 Session lifecycle

```
 1. client → POST /api/minigame/estate/{building}/start   { owner }
      server: read EstateAccount; validate preconditions (§10);
              check Redis idempotency lock;
              if a live session already exists for (owner,day,window,building) → RESUME it;
              else derive seed → generate() → store session in Redis (TTL 10m);
      → { sessionId, presentation, window, rules, deadline }   ← presentation only, never the key

 2. client → POST /api/minigame/{sessionId}/move   { move }      (repeated; multi-move archetypes only)
      server: load session; validate + apply move atomically; refresh TTL;
      → { result }   (the revealed tile, hit/miss, remaining moves, …)

 3. client → POST /api/cosign/estate/daily-activity   { owner, sessionId, answer? }
      server: load session; verify owner, not expired, not already finished;
              single-submit archetypes → grade(key, answer);
              multi-move archetypes   → score already accumulated in progress;
              re-validate the window is still current (else 409 WINDOW_CHANGED);
              build daily_activity ix with the score, partial-sign;
              mark session FINISHED + set the completion lock;
      → { transaction }
 4. client → useTransact.mutateAsync({ versionedTx })  → wallet signs → submit
```

**Class A (Sanctuary, Citadel)** skip the session entirely — no puzzle, no
state. `POST /api/cosign/estate/daily-activity` with `{ owner, buildingType,
choice | heroMint }` directly (§6).

### 4.3 Redis keys

| Key | Holds | TTL |
|---|---|---|
| `mg:session:{sessionId}` | the session blob — puzzle, key, progress, owner, building, window, day, status, timestamps | 10 min, refreshed on every `/move` |
| `mg:lock:{owner}:{day}:{window}:{building}` | in-progress / completed marker — the server-side mirror of the on-chain `*_buildings` bitflag; lets the route reject a duplicate *before* building a tx | until window/day rollover |
| `rl:{ip}` / `rl:{owner}` | rate-limit counters (replaces in-memory `rate-limit.ts`) | sliding window |
| `cache:estate:{pda}` / `cache:player:{pda}` | decoded on-chain account, to spare the RPC on every `/start` and `/move` | 10–15 s |

Move application is atomic (a Lua script, or `WATCH`/`MULTI`) so two concurrent
`/move` calls cannot corrupt progress. `sessionId` is a 128-bit unguessable
random token, bound to `owner` inside the blob.

### 4.4 Why this is trustworthy

- **The client cannot inflate.** The answer key lives only in the Redis session,
  server-side. Single-submit archetypes are graded against it; multi-move
  archetypes never expose it — information is doled out per move.
- **No re-rolling.** Generation is seed-deterministic, and `/start` *resumes* a
  live session rather than minting a new puzzle — abandoning buys nothing.
- **No double-submit.** Co-sign flips the session to `FINISHED` and sets the
  completion lock atomically; a second co-sign is rejected before any tx work.
- **Real deadlines and move logs.** Timestamps are server-side; a session past
  its deadline rejects further moves. Speed/efficiency become measurable facts.
- **Per-player, replay-safe.** `estatePda` is in the seed; the co-signed tx
  still needs the player's wallet signature.

### 4.5 No program changes

The program still receives a `u8` score and clamps it. The score is now *earned*
instead of rolled — the instruction, accounts, and reward formulas are
untouched. The one thing that *might* later want a change is the reward *curve*
(§7) — optional, deferred, out of scope.

### 4.6 The window boundary

`window` is in the seed and the session. A `POST /cosign` carries the `window`
the client played; if it no longer equals the current window the route returns
`409 WINDOW_CHANGED` to force a refetch. This also fixes the dual-window bug —
Workshop played in Dawn and again in Midday seeds two distinct sessions.

---

## 5. Puzzle archetypes

Eighteen bespoke minigames is how a half-product dies. Instead: **five graded
archetypes, one timed archetype, and one ungraded choice** — each a small,
well-tested unit, reused across buildings with per-building difficulty configs
and flavor.

| # | Archetype | Puzzle | Interaction | Grade |
|---|---|---|---|---|
| 1 | **MCQ** | `N` questions, `K` options, one correct | single-submit | fraction correct |
| 2 | **SetSelect** | `M` items; a hidden-but-derivable property marks `K` | single-submit | `(correct − wrong)/K`, clamped ≥0 |
| 3 | **Assignment** | `M` items each belong in one of `C` bins by a derivable property | single-submit | fraction correctly binned |
| 4 | **Ordering** | `M` items; clues / a derivable metric fix one order | single-submit | fraction of correct adjacent pairs |
| 5 | **Memory** | server holds a board; client flips tiles to find pairs | **multi-move** | move efficiency vs the optimal |
| 6 | **Reflex** (Class C) | react to a server GO signal, or release at a secret target moment | **timed** | distance from the server-known target |
| — | **Choice** | pick 1 of `N` (no skill) | single-submit | n/a — recorded, not graded |

`score = round( gradeCurve(fraction) × 100 )`. The grade curve is a tuning knob
(§7): generous above ~0.7 so a near-perfect human is near-max and only careless
or blind play falls to the floor.

**Reflex** has two modes sharing one grader (distance from a server-known
moment): *react* — the server sends GO after a secret, randomized delay (a
held-open / long-poll response so the client cannot anticipate it), the client
taps, reaction = `t_tap − t_go`; *precision* — the client watches a
server-parameterised gauge and releases at a secret target point. Network
latency is estimated from the start handshake's round-trip and subtracted
server-side (never client-reported — §13).

**Reuse beyond the estate:** the expedition `strike` score
(`apps/web/src/app/api/cosign/expedition/strike`) co-signs the same flat
`score-logic.ts` roll and has the identical problem — it **will reuse this
archetype library** — out of scope here, but the design accounts for it.

---

## 6. Per-building design — all 18 + 2

Reward formulas quoted from `daily_activity.rs` `grant_building_rewards`.
Mansion is `daily_claim.rs` (a pure streak claim, no minigame) — listed for
completeness, **out of scope.**

| Building | Window(s) | On-chain reward (score 0→100) | Class / Archetype | Activity flavor |
|---|---|---|---|---|
| Barracks | Dawn | unit-eff buff 5%→15% | **C · Reflex (react)** | "Morning Drill" — react to the sergeant's commands |
| Workshop | Dawn/Midday | 10→65 common materials | B · Assignment | "Scrap Sorting" — bin salvage by material type |
| Dock | Dawn/Midday | 10→65 produce | B · SetSelect | "Catch of the Day" — pick the nets that hauled a catch |
| Vault | Dawn/Midday | 50→200 common materials | B · SetSelect | "Security Inspection" — flag the flawed wards |
| Forge | Dawn/Midday | mastery-XP buff 25%→100% | **C · Reflex (precision)** | "Fire the Furnace" — release at the optimal heat |
| Market | Midday | shop discount 5%→20% | B · SetSelect | "Deal Finder" — pick the genuine bargains, skip traps |
| Academy | Midday | research-time cut + 10→50 mastery XP | **B2** · MCQ | "Daily Lecture" — lore comprehension (`WORLD_LORE.md`) |
| Arena | Midday | arena damage 5%→15% | B · Ordering | "Warm-Up Bout" — order your counters to the tells |
| Sanctuary¹ | Dusk | hero blessing (+25%, **score unused**) | **A · Choice** | "Hero Blessing" — choose which hero to bless |
| Observatory | Dusk | loot bonus 5%→25% | B · MCQ | "Star Reading" — identify the constellation |
| Treasury | Dusk | mint 100→900 NOVI | B · **Memory** | "Ledger Audit" — match the ledger entries |
| Citadel | Dusk | sets defensive stance | **A · Choice** | "Watch Report" — choose Defensive / Balanced / Aggressive |
| Camp | Dawn | operative discount 3%→12% | B · Assignment | "Muster Roll" — assign recruits to posts |
| Mine | Dawn/Midday | 5→30 gems | B · SetSelect | "Prospector's Eye" — pick the gem-bearing seams |
| Farm | Dawn/Midday | 10→65 produce | B · Assignment | "Harvest Sort" — bin crops ripe vs unripe |
| DungeonEntry | Dusk | 1→5 fragments | B · Ordering | "Threshold Watch" — order the warding glyphs |
| TransportBay | Midday | travel speed 5%→20% | B · Ordering | "Route Planning" — order the waypoints by distance |
| Infirmary | Dusk | unit recovery 2%→8% | B · MCQ | "Triage" — match each ailment to its remedy |
| *Mansion* | *any* | *streak claim — `daily_claim.rs`* | *— out of scope —* | *"Welcome Home"* |

¹ `BuildingType::MeditationChamber` in the program; "Sanctuary" in the docs/UI.

The 6 expansion buildings (Camp, Mine, Farm, DungeonEntry, TransportBay,
Infirmary) had **no `ESTATE_SYSTEM.md` design** — their flavor above is new and
gets a storyline pass (`PLAYER_JOURNEY_GAMEPLAN.md` §12; the Cairn is the
narrating voice).

**Class A request shapes (no session, no puzzle):**
- **Citadel** — `POST /cosign { owner, building, choice: 0|1|2 }`. The route maps
  the stance to a representative score *inside* the target bucket (`16 / 50 / 83`)
  so all three stances, Defensive included, are reachable. Bug §2.3.1 fixed.
- **Sanctuary** — `POST /cosign { owner, building, heroMint }`. The route uses
  the player's chosen hero (validated: in `active_heroes`; ownership checked
  on-chain) instead of auto-picking the first slot. Bug §2.3.2 fixed. `score` is
  passed as a constant (the program ignores it).

---

## 7. Reward economics — accepted

Real minigames re-price the daily reward. Barracks pays `500 + score×10` bps:
today every owner gets the flat ~77 → **+12.7%** for one click; after, the score
is earned. Treasury *mints* NOVI (`100 + score×8`) — so its score directly
drives **token emission**.

**The team has accepted the shift, and the design leans into it:**

- **Difficulty target — "engagement, not mastery."** Tune every puzzle so an
  *attentive* player completing it in the allotted time scores high (~90–100).
  The skill ceiling is modest; the floor is for *not playing*. Engaged players
  end up at or **above** today's average — that is fine and intended; bots and
  idlers earn the floor.
- **Speed is not scored** for the answer archetypes (a client clock would be
  unverifiable). Timers there are UX pressure only. Reflex is the exception —
  its timing *is* server-measured and *is* the score.
- **Grade curve** is the live tuning lever (web-side, free). The lever to avoid
  is rewriting the processor's reward formulas (a program change).
- **Watch Treasury.** Because its score is token emission, its difficulty curve
  should be reviewed against tokenomics, not just feel.

---

## 8. Window-completion bonus — server-side score bump

`ESTATE_SYSTEM.md:4159` promises "+10% to all rewards" for completing a window
and "+25%" for a full day. The processor's `check_window_completion` records the
`windows_completed` bitflags but **no reward path multiplies by them** — the
bonus is designed, tracked, and never paid. The true fix (a reward multiplier)
is on-chain and out of scope.

**Decision: ship the server-side score bump.** When the activity a player is
submitting *completes* their window (every owned building for that window done),
the route adds a flat bonus to that submission's score before co-signing,
clamped ≤100. The Redis completion locks (§4.3) make "is this the last building
of the window" a cheap lookup. This delivers a real engagement reward with no
program change; the imperfection — it bonuses the *completing* building, not
literally "all rewards" — is accepted. The UI surfaces `windows_completed` as a
visible streak regardless.

---

## 9. Backend design

### 9.1 Modules

```
apps/web/src/lib/server/
  redis.ts                  Redis client (singleton, server-only)
  session.ts                session create / load / move / finish; the idempotency lock
  rate-limit.ts             ← reworked onto Redis
  minigame/
    archetypes/
      mcq.ts  set-select.ts  assignment.ts  ordering.ts  memory.ts  reflex.ts
      index.ts              registry { name → { generate, applyMove?, grade } }
    buildings.ts            building → { archetype, difficulty, flavor, content? }
    puzzle.ts               generate(building,…) ; the grade curve
    content/lore-quiz.json  Academy question bank (authored from WORLD_LORE.md)
  score-logic.ts            ← retired, replaced by minigame/
```

`puzzle.ts` builds on `rng.ts`; `cosign.ts`, `game-authority.ts`, `chain.ts`,
`rng.ts` are unchanged except `chain.ts` gains the Redis read-through cache.

### 9.2 Endpoints

| Endpoint | Purpose |
|---|---|
| `POST /api/minigame/estate/[building]/start` | preconditions → generate or resume session → return presentation |
| `POST /api/minigame/[sessionId]/move` | apply one move (multi-move archetypes); for Reflex *react* the response is held open until the secret GO |
| `POST /api/cosign/estate/daily-activity` | grade / read the session score, validate window, co-sign; or — Class A — encode the choice directly |

All declare `runtime = "nodejs"`. `start` and `move` validate preconditions and
return `4xx { error, code }` so the UI can show *why* something is unavailable.
Rate-limited per IP and per `owner` via Redis.

### 9.3 Content pipeline (Academy)

Academy is the lone B2 (knowledge) building. `content/lore-quiz.json` —
a committed, hand-authored array of `{ prompt, options[4], correctIndex,
sourceRef }`, written from `WORLD_LORE.md`. **For v1: a small starter bank;
expand `lore-quiz.json` over time** (a larger bank devalues a lookup-table bot —
§13). The generator deterministically samples `N` questions per day.

---

## 10. SDK additions — one source of truth for windows

The window logic (Dawn/Midday/Dusk boundaries, building→window mapping,
already-done bitflag checks) lives **only** in the Rust processor today. Both the
server route and the client UI need it. Add to `sdks/novus-mundus-ts` a faithful
TS mirror of `daily_activity.rs`:

```ts
currentTimeWindow(estate, now): "dawn" | "midday" | "dusk" | "expired"
buildingAllowedWindows(buildingType): TimeWindow[]
isActivityDoneThisWindow(estate, buildingType, window): boolean
nextWindowOpensAt(estate, now): number | null
```

The Rust file is the spec; the TS port must match it constant-for-constant, with
a test pinning them together. Confirm the SDK estate decoder exposes
`dawn_timestamp`, `windows_completed`, `dawn/midday/dusk_buildings`,
`expansion_daily`, `daily_date` — extend the decoder if not.

---

## 11. UI / UX design

### 11.1 Layout

`apps/web/src/app/(game)/estate/_components/daily-activity/`

```
DailyActivityTracker.tsx     the 3-window overview on the estate page
DailyActivityPanel.tsx       per-building entry point (building card / interior)
MinigameSession.tsx          drives start → move loop → cosign for one session
games/
  McqGame.tsx  SetSelectGame.tsx  AssignmentGame.tsx  OrderingGame.tsx
  MemoryGame.tsx             issues /move per tile flip
  ReflexGame.tsx             react + precision modes
choices/
  BlessingChoice.tsx         Sanctuary — hero picker
  StanceChoice.tsx           Citadel — three stance cards
ActivityResult.tsx           score + reward reveal
```

### 11.2 Flow

```
Estate page → DailyActivityTracker (Dawn ●/Midday ○/Dusk ○, time to next window)
  └ building card → DailyActivityPanel
        ├ window open  → [ Play ] (Class B/C)  or  [ Choose ] (Class A)
        ├ wrong window → "Opens at Midday" (disabled, countdown)
        └ done today   → ✓ result summary, greyed
  └ [ Play ] → MinigameSession
        POST /start → render the archetype component
        single-submit: collect answer        multi-move: drive /move per interaction
        → POST /cosign → useTransact.mutateAsync({versionedTx})
        → ActivityResult (score, reward, "come back at Dusk for …")
```

### 11.3 The tracker

```
┌─ Daily Activities ───────────────────────────────────────┐
│  ☀ Dawn      ◐ Midday        ☾ Dusk                       │
│  ●●●○         ○○○○○            ─────       next: Midday 2h │
│  Barracks ✓  Workshop ✓  Vault ✓  Forge —    Dawn 3/4     │
└───────────────────────────────────────────────────────────┘
```

### 11.4 A single-submit game (SetSelect — Market "Deal Finder")

```
┌─ Deal Finder ───────────────── Market · Midday ──── ⏱ 0:24 ─┐
│  Tap the genuine bargains. Skip the traps.                  │
│   ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐               │
│   │ Iron   │ │ Hide   │ │ Salt   │ │ Rope   │               │
│   │ 40 / 55│ │ 30 / 22│ │ 18 / 60│ │ 25 / 25│               │
│   │  [ ✓ ] │ │  [   ] │ │  [ ✓ ] │ │  [   ] │               │
│   └────────┘ └────────┘ └────────┘ └────────┘               │
│   price / value — a deal is real when price < value         │
│                                       [ Submit ]            │
└─────────────────────────────────────────────────────────────┘
```

### 11.5 A multi-move game (Memory — Treasury "Ledger Audit")

Each tap on a tile is a `/move`; the server returns that tile's face. The board
state lives server-side — the component renders only what the server has
revealed and shows the running move count. No timer scoring; efficiency *is* the
score.

### 11.6 Class A screens

Sanctuary (`BlessingChoice`) — locked heroes as cards, pick one. Citadel
(`StanceChoice`) — three stance cards with their on-chain effects. No session,
no timer, no GET.

### 11.7 Feel

The estate is "a place you visit" — give it craft: per-building entrance, a
satisfying submit, a reward count-up, the window dots filling. Use the
`frontend-design` skill at build time. Keep each game ≤30–45 s; respect
`ESTATE_SYSTEM.md`'s ~15–20 min/day total.

---

## 12. Client integration

- **`useDailyActivity(building)`** — manages one session: `POST /start`, the
  `/move` loop for multi-move archetypes, `POST /cosign`, then
  `useTransact.mutateAsync({ versionedTx })`. The `versionedTx` path already
  exists in `useTransact.ts` (used by the co-sign client helpers) — no change to
  `useTransact`.
- Thin fetch helpers, alongside the existing `useCoSign` hook (`apps/web/src/lib/cosign.ts`).
- Window availability comes from the SDK helpers (§10) so the UI and the server
  agree on what is playable.

---

## 13. Security & residual risks

| Vector | Outcome | Mitigation |
|---|---|---|
| Client inflates its score | — | The answer key lives only in the Redis session; single-submit grading and multi-move reveals never expose it (§4.4). |
| Re-roll by restarting `/start` | — | Generation is seed-deterministic and `/start` *resumes* a live session — abandoning yields the identical puzzle. |
| Double co-sign | — | Co-sign flips the session to `FINISHED` + sets the completion lock atomically. |
| Memory "keep the DOM visible" | — | Irrelevant — the board is server-side; the score is server-counted move efficiency. |
| Reaction: tap before GO | — | Impossible — GO is a held-open server response after a secret randomized delay. |
| Reaction bot out-speeds humans | Earns near-max on Barracks/day | Accepted, bounded: one activity per building per window per day. The honest limit of any twitch game. |
| Latency spoofing on Reflex | Faster-looking reaction | Latency is measured **server-side** from the start handshake RTT, never client-reported; the subtraction is capped. |
| Blind guessing / idle bot | Floor reward | By design — linear no-dead-zone curve pays the floor; engaged humans earn the ceiling (§7). |
| B2 lookup-table bot (Academy) | Soft — quiz beatable | Accepted: low reward, growing question bank (§3, §9.3). |
| Smart bot solves a B-class puzzle | Near-max on one building/day | Accepted and bounded — botting cost > reward. No client minigame is bot-proof; the §7 economics are the real defense. |
| Forged request (no wallet sig) | Probe outcomes, waste compute | Redis rate-limit per IP + per `owner`; the tx is useless without the wallet signature. |
| Session hijack | — | `sessionId` is a 128-bit unguessable token bound to `owner`; co-sign still needs the wallet signature. |
| Redis outage | Daily activities unavailable | The co-sign routes are already on the critical path; Redis joins it — needs the same uptime treatment. |

**Telemetry (Phase 5):** log per-building score distributions; a player or IP
sustaining ~100s across every building every day is the bot signature — flag for
review. Detection, not prevention; the economics are the real defense.

---

## 14. Build phases

**Phase 0 — Fixes & foundations (ships alone).** Provision Redis; `redis.ts` +
rework `rate-limit.ts` onto it. SDK window helpers (§10, the TS port + parity
test). Fix Citadel (`stance` param, §2.3.1) and Sanctuary (`heroMint` param,
§2.3.2). Add full precondition validation to the existing co-sign route. *This
alone makes `daily_activity` correct, before any minigame exists.*

**Phase 1 — Session framework.** `lib/server/{session,minigame}` — the
`Rng`-seeded generator, the archetype registry, the grade curve, the Redis
session lifecycle. The `start` / `move` / reworked `cosign` endpoints. Two
reference buildings proven end-to-end on a local validator: **Observatory**
(single-submit MCQ — the simplest path) and **Treasury** (multi-move Memory — to
prove the `/move` loop and idempotency).

**Phase 2 — Archetype UIs.** The 6 game components + 2 Class A screens,
`MinigameSession`, `DailyActivityPanel`, `ActivityResult`. Polish, juice,
timers. Wire `useDailyActivity`.

**Phase 3 — Roll out the remaining buildings.** Map each to its archetype,
author per-building difficulty configs, write `lore-quiz.json` from
`WORLD_LORE.md`, storyline pass on the 6 expansion-building flavors.

**Phase 4 — Engagement layer.** `DailyActivityTracker`, the `windows_completed`
surface, the server-side window-completion score bump (§8).

**Phase 5 — Hardening.** Rate-limit tuning, score-distribution telemetry, the
bot-signature flag, difficulty re-tuning from real data.

---

## 15. Decisions locked & open

**Locked (this review):**
- Reward re-pricing is accepted; tune so attentive players score high — rewards
  for engaged play may exceed today's average (§7).
- Window-completion bonus ships as the server-side score bump (§8).
- Class C (twitch) stays — Barracks and Forge keep their reflex games (§3).
- Memory stays — Treasury is a server-mediated memory game (§3).
- Backend is stateful, Redis-backed (§4).
- Academy lore bank starts small, expands over time (§9.3).
- Expansion-building flavor gets a storyline pass (§6).
- The archetype library will be reused for expedition `strike` (§5).

**Open:**
1. **Redis hosting** — managed (Upstash/Elasticache/…) vs self-hosted; and the
   §13 outage posture (hard-fail vs degrade).
2. **Reflex latency handling** — the exact handshake/long-poll protocol and the
   latency-subtraction cap need a spike before Phase 2.
3. **Session TTL** — 10 min proposed; confirm against the slowest archetype.
4. **Lore bank v1 size** — how many questions for launch, and who authors them.

---

## 16. One-paragraph summary

The estate's 18 daily activities currently co-sign a meaningless flat dice roll;
this replaces it with real, server-authoritative minigames. The activities split
into three classes — pure choices (Sanctuary, Citadel — fix their two live bugs
and just record the decision), skill puzzles, and timed twitch games — and a
**stateful, Redis-backed session** makes every class verifiable: the server
holds the game state and answer key, the client drives it one move at a time and
never possesses the answer, so memory games (server-counted move efficiency) and
reaction games (server-clocked taps) work alongside the one-shot puzzles.
Generation stays deterministic and on-chain-seeded so abandoning never re-rolls;
the program is untouched, the score is now *earned*; sixteen games are built
from six reusable archetypes plus a content bank for the one knowledge quiz;
rewards are deliberately re-priced so engaged players earn the ceiling and idlers
the floor; and the build runs from a self-contained bug-fix Phase 0 through a
full UI, backend, and SDK delivery.
