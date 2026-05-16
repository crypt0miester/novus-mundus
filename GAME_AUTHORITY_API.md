# Game Authority API — Co-Signer Design

> The off-chain `game_authority` that co-signs the game's skill/RNG instructions —
> built as **Next.js Route Handlers inside `apps/web`**, not a separate service.

**Status**: Design — approved direction, not yet implemented
**Scope**: `apps/web` only — Route Handlers + server-only modules. No separate service. No program changes.
**Date**: 2026-05-15
**Companion**: `apps/web/UI_GAPS.md` (the gaps this unblocks)

---

## 1. Why this exists

Seven on-chain instructions require a **second signer** — the `game_authority` — in addition to the player's wallet. The program has no on-chain RNG; it trusts the `game_authority` signature as an attestation that the non-deterministic data carried in the instruction (dungeon room rolls, crit flags, relic pools, arena matchmaking, minigame scores) is legitimate.

`apps/web` cannot produce these transactions today — `useTransact` signs only with the connected wallet. So dungeon combat, arena challenges, expedition strikes, and estate daily-activities are unreachable from the client (and `dungeon-tab.tsx`'s calls are mis-wired against the old API — see `UI_GAPS.md`). This document specifies the `game_authority` co-signer that unblocks them.

---

## 2. Decisions (locked)

| Decision | Choice |
|---|---|
| Where it lives | **Next.js Route Handlers** in `apps/web/src/app/api/` — same repo, same deploy, same-origin calls, shared SDK. No separate service. |
| Scope | All **4 systems / 7 instructions** that require `game_authority`. |
| Process | This design doc first, then implementation. |

**Implication of the Next.js choice:** the web app must deploy to a **Node server runtime** — not a static export, not edge-only. ed25519 signing and `@solana/web3.js` need Node APIs. Every co-sign route handler declares `export const runtime = "nodejs"`. The `game_authority` secret key becomes a **server-only env var** in that runtime (§5).

---

## 3. The co-sign surface — 7 instructions, 4 systems

Every one validates `game_authority` identically: it must be a transaction **signer**, and its pubkey must equal `GameEngine.game_authority` (`state/game_engine.rs:46`). There is **one `game_authority` per `GameEngine`** — i.e. per kingdom.

| System | Instruction | disc | What the `game_authority` signature attests |
|---|---|---|---|
| Dungeon | `attack` | 251 | next-room-type roll · crit roll · double-strike roll |
| Dungeon | `attack_multi` | 252 | same three rolls (one roll covers the 1–5 batch) |
| Dungeon | `interact` | 253 | camp-bonus magnitude · next-room-type roll |
| Dungeon | `choose_relic` | 254 | the relic option pool (3–4 ids) · next floor's first room |
| Arena | `challenge_player` | — | the matchmaking — opponent pairing, `match_id`, `match_timestamp` |
| Expedition | `strike` | — | the minigame `score` (0–100) |
| Estate | `daily_activity` | — | the minigame `score` (0–100) |

The program never reproduces a roll. It does only **range/membership/gating** checks (e.g. `relic_id` must be 0–19 and a member of the signed pool; `crit` only applies if the run actually has crit chance). Everything else rests on the signature.

---

## 4. Architecture

### 4.1 The request flow

```
 dungeon-tab.tsx / arena-tab.tsx / …  (client)
   │  POST /api/cosign/dungeon/attack   { owner, attackCount? , … }
   ▼
 Route Handler  apps/web/src/app/api/cosign/dungeon/attack/route.ts   ── SERVER ONLY
   │  1. Read live on-chain state itself (DungeonRun, DungeonTemplate, …) via RPC
   │  2. Validate on-chain preconditions (right status / room / window)
   │  3. Compute the authoritative data — deterministic state-seeded RNG (§7)
   │  4. Build the instruction with the REAL typed SDK builder
   │  5. Assemble a VersionedTransaction, set a fresh blockhash,
   │     partial-sign with the game_authority keypair
   │  6. Return base64(serialized partially-signed tx)
   ▼
 client → useTransact.mutateAsync({ versionedTx })
   │  wallet adds the player's signature → sendRawTransaction
   ▼
 Solana program — verifies the game_authority signature, trusts the RNG data
```

The client side is **already wired for this**: `useTransact` has a dormant `versionedTx?: VersionedTransaction` path (`useTransact.ts:70`, comment: *"e.g. from AllDomains co-signer API"*) that submits a pre-built, foreign-signed transaction raw. The co-signed tx from a route handler drops straight into it.

### 4.2 Project layout

```
apps/web/src/
  app/api/cosign/
    dungeon/attack/route.ts
    dungeon/attack-multi/route.ts
    dungeon/interact/route.ts
    dungeon/choose-relic/route.ts
    arena/challenge/route.ts
    expedition/strike/route.ts
    estate/daily-activity/route.ts
  lib/server/                  ← server-only modules; each starts with  import "server-only"
    game-authority.ts          ← loads + caches the game_authority Keypair from env
    cosign.ts                  ← build instruction → VersionedTransaction → partial-sign → serialize
    chain.ts                   ← server-side RPC reads (DungeonRun, Expedition, Estate, Arena…)
    rng.ts                     ← deterministic state-seeded RNG primitive (§7)
    dungeon-logic.ts           ← room rolls, crit / double-strike, relic pools, camp bonus
    matchmaker.ts              ← arena opponent selection + match_id issuance
```

`import "server-only"` makes a build fail loudly if any of these is ever pulled into a client bundle — the guardrail that keeps the key server-side.

The route handlers build instructions with the **real, typed SDK builders** (`createAttackInstruction`, etc.) imported directly from `novus-mundus-sdk` — *not* through `apps/web/src/lib/sdk.ts`'s `FlexIxBuilder` cast. Server code stays fully type-checked against the true signatures; that is exactly the safety the client `sdk.ts` threw away (and which let `dungeon-tab.tsx` rot).

---

## 5. The `game_authority` key

- **Storage**: a server-only env var — `GAME_AUTHORITY_SECRET_KEY` (base58 secret key). **Never** `NEXT_PUBLIC_*`. Read only inside `lib/server/game-authority.ts`.
- **Provision a dedicated keypair.** On `init`, `GameEngine.game_authority` defaults to the DAO authority (`initialization/game_engine.rs`: `l: authority // … can be changed later`). Do **not** ship the DAO's master key to a web server. Generate a fresh keypair, point the GameEngine at it via `update_game_config`, and give the server only that key.
- **Blast radius if leaked**: an attacker can forge every roll this doc covers — guaranteed crits, hand-picked relics, rigged matchmaking, perfect minigame scores. It cannot mint, withdraw, or touch DAO governance. Still: treat it as a high-value secret (secret manager, not a committed `.env`).
- **Rotation**: it's a single `GameEngine` field — `update_game_config` swaps it. Rotation = generate new keypair → `update_game_config` → update the env var. Cheap; do it on any suspicion.
- **Multi-kingdom**: one key per `GameEngine`. v1 targets a single kingdom (one key). Multi-kingdom support = a kingdom-id→key map in env; flagged in §12.

---

## 6. Trust model — what the signature is actually worth

The seven payloads split into **two categories**, and they are not equally trustworthy.

### 6.1 Backend-generated — genuinely authoritative

Dungeon room rolls, crit/double-strike, relic pools, camp bonus, arena opponent + `match_id`. **The backend itself decides these values.** There is no "player input" to validate — the server is the source of truth. The only attack is the client **re-rolling by retrying** the endpoint until it sees a good result. Defeated by deterministic, state-seeded RNG (§7): the same on-chain state always yields the same roll, so retrying changes nothing.

### 6.2 Backend-attested — only as strong as the input path

Expedition `strike` and estate `daily_activity` carry a `score` (0–100) that is the **result of a player minigame**. The program clamps it to ≤100 and otherwise trusts it completely; the score scales rewards linearly (expedition: avg score → 0…+25% yield; estate: per-building reward formulas).

**If the minigame runs purely client-side and the client POSTs a number, the co-signature is worthless** — the server is rubber-stamping a self-reported score. For the signature to mean anything, the minigame must be **server-authoritative**: either the server runs the minigame logic (client streams inputs, server scores), or the client submits a verifiable replay/commitment the server checks. **This is an unresolved decision — see §12.** Until it is resolved, treat expedition/estate scores as soft and lean on the on-chain rate limits (1 strike/elapsed-hour; one activity per building per window per day).

### 6.3 Non-negotiable handler rules

1. **Never trust client-claimed game state.** The handler reads `DungeonRun` / `ExpeditionAccount` / `EstateAccount` / `ArenaParticipant` from chain itself. The request body carries only the player's `owner` pubkey and the player's *chosen action* (e.g. `attackCount`, the `relicId` they picked, which building).
2. **Validate preconditions before co-signing.** If the run isn't in a combat room, or the activity window is closed, return an error — don't hand back a transaction that will revert, and don't burn a co-sign.
3. **Deterministic RNG** (§7) — retrying never changes the outcome.
4. **A forged request is low-harm but not zero.** The returned tx still needs the victim's wallet signature, so an attacker can't *submit* it — but they can probe outcomes and waste server compute. Rate-limit per IP and per `owner`; optionally require a lightweight wallet-signed auth token.
5. **Fresh blockhash, prompt submit.** The handler sets the blockhash and signs the finalized message; the client only appends its signature. If the blockhash expires before submit, the client re-requests. (Arena's 300 s `match_id` window is separate and longer-lived than a blockhash.)

---

## 7. Deterministic, state-seeded RNG

Every backend-generated roll uses one primitive:

```
seed  = sha256( GAME_AUTHORITY_RNG_SECRET ‖ domain ‖ accountPubkey ‖ stateDiscriminator )
roll  = a PRNG (e.g. chacha) seeded by `seed`
```

- `domain` — a constant per roll kind (`"dungeon.room"`, `"dungeon.crit"`, `"arena.match"`, …).
- `accountPubkey` — the `DungeonRun` / `ExpeditionAccount` / `ArenaParticipant` PDA.
- `stateDiscriminator` — fields that **change every legitimate action but are fixed within one**: e.g. for a dungeon attack, `current_floor ‖ current_room ‖ enemy_health ‖ attacks_taken`. Each distinct attack has a distinct discriminator → a distinct roll; re-requesting the *same* attack reproduces it.

Properties this buys: **no re-rolling** (retry = identical result), **reproducibility** (support/audit can recompute any roll), and a path to **public verifiability** later (publish the per-roll seed inputs; the README already promises skill/RNG moments are "verified independently").

`GAME_AUTHORITY_RNG_SECRET` is a *separate* server secret from the signing key — leaking the signing key forges rolls; leaking the RNG secret only lets someone *predict* them.

---

## 8. Per-system design

### 8.1 Dungeon — `/api/cosign/dungeon/{attack,attack-multi,interact,choose-relic}`

The handler reads the active `DungeonRun` (`["dungeon_run", playerPda]`) and its `DungeonTemplate`, then:

- **attack / attack-multi** — precondition: run status `Active|BossFight`, `room_type == Combat`, `enemy_health > 0`. Compute: `next_room_type` (weighted sample of the template's 5 room weights); `double_strike` (run has relic 14? roll its 15% chance, ×1.3 if Tactician hero); `crit` (relic 2 = 2000 bps, +1000 if the 3-piece Offense synergy is up, − darkness penalty 30 bps/floor from floor 4, 0 if relic 16 — roll the net chance). The program *gates* both flags against on-chain relic state and recomputes crit *damage* itself, so the handler only supplies the booleans. For `attack_multi`, one roll covers the whole 1–5 batch; `attackCount` comes from the request (validate 1–5).
- **interact** — precondition: run active, `room_type != Combat`. Compute `next_room_type`; for a Camp room also a `camp_bonus_bps` — the program applies **no cap or validation** on this, so the backend solely owns the range (pick a sane band, e.g. a bounded attack-buff).
- **choose-relic** — precondition: run status **exactly** `AwaitingRelic`. Compute the option pool: 3 distinct relic ids from 0–19, **excluding relics the run already owns** (`relic_mask`); add a 4th option iff the run's `time_period` is Dawn or it holds relic 19. The player's chosen `relicId` comes from the request and must be one of the pool. Also compute `first_room_type` for the next floor (ignored by the program if the next floor is the boss floor — send a valid value anyway).

### 8.2 Arena — `/api/cosign/arena/challenge`

The handler is the **matchmaker**. It reads the `ArenaSeason`, the challenger's `ArenaParticipant` + `ArenaLoadout`, then:

- **Picks an opponent** — an ELO-appropriate `defender` (on-chain ELO is K-factor 32 with diff-bucketed expected scores; fair pairing keeps the point economy sane). Reads candidate participants/loadouts to score match quality.
- **Issues `match_id`** = `challenger.last_match_id + 1` (the on-chain replay guard requires strictly-greater).
- **Sets `match_timestamp`** = now. On-chain redemption window is **300 s** (`ARENA_MATCH_EXPIRY_SECONDS`) — issue client-side tickets that expire well before that to absorb clock skew.
- Respects the on-chain caps so it never offers a doomed match: 10 battles / rolling 24 h, 2 / opponent / 24 h, season `Active`, no self-challenge.
- Builds the 14-account `challenge_player` instruction (both players' participant/loadout/hero/estate PDAs).

Matchmaking is genuinely backend-authoritative — but note the **match-shopping** risk in §12.

### 8.3 Expedition — `/api/cosign/expedition/strike`

Reads the `ExpeditionAccount` (`["expedition", ownerWallet]`). Precondition: not past `end_time`; `strikes < durationHours`; `now ≥ start_time + strikes·3600` (one strike unlocks per elapsed hour). Co-signs the `score` (0–100). **Score origin is the open question of §6.2 / §12.**

### 8.4 Estate — `/api/cosign/estate/daily-activity`

Reads the `EstateAccount` (`["estate", playerPda]`). Precondition: the building exists+active; the current time-window (Dawn/Midday/Dusk, relative to the day's first activity) is the one that building is allowed in; not already done this window/day. Attaches the conditionally-required accounts: `hero_mint` for MeditationChamber, `player NOVI ATA + novi_mint` for Treasury, `research_progress` for Academy. Co-signs `building_type` + `score` (0–100). **Score origin — §6.2 / §12.**

---

## 9. API surface

All endpoints: `POST /api/cosign/{system}/{action}`, JSON in, JSON out.

**Request** (per endpoint) — only what the server can't read from chain: the player's `owner` pubkey, and the player's chosen action params (`attackCount`, chosen `relicId`, `buildingType`, the claimed `score`, …).

**Response** — `200 { transaction: "<base64 partially-signed VersionedTransaction>" }`, or `4xx { error, code }` when a precondition fails (so the client can show *why* — "not your turn", "window closed", "daily cap reached").

**Client wrapper** — one helper, `requestCoSignedTx(endpoint, body)`, returns a `VersionedTransaction`; each screen passes it to `useTransact.mutateAsync({ versionedTx })`.

---

## 10. Client integration

- **`useTransact`** — no change needed; the `versionedTx` path already exists. Wire screens to call `requestCoSignedTx(...)` then `mutateAsync({ versionedTx })`.
- **`dungeon-tab.tsx`** — its `attack`/`interact` handlers currently call the builders with the wrong arguments (see `UI_GAPS.md`). They get rewritten to call the `/api/cosign/dungeon/*` endpoints. (`enter`/`flee`/`claim`/`resume` are wallet-only — fix those call sites directly, no backend.)
- **`arena-tab.tsx`** — add the challenge UI (opponent list / "find match") backed by `/api/cosign/arena/challenge`.
- **expedition / estate** — wire the strike and daily-activity minigame completion to their endpoints.
- **`sdk.ts` `FlexIxBuilder`** — leave the client cast as-is for now, but server route handlers must import the **typed** builders directly so the co-sign code is type-checked.

---

## 11. Build phases

1. **Co-sign plumbing** — `lib/server/{game-authority,cosign,chain,rng}.ts`, env wiring, the Node-runtime deploy target, one end-to-end vertical (dungeon `attack`) proven on a local validator.
2. **Dungeon** — the remaining 3 endpoints + rewire `dungeon-tab.tsx` (and fix enter/flee/claim/resume).
3. **Arena** — the matchmaker + challenge endpoint + `arena-tab.tsx` challenge UI.
4. **Expedition + Estate** — the two score endpoints — **gated on the §12 score-validation decision.**
5. **Hardening** — rate limiting, request auth, RNG-verifiability surface, key rotation runbook.

---

## 12. Open questions & risks

- **Score validation (the big one).** Expedition/estate `score` is a minigame result. If the minigame is client-side, co-signing it is security theatre (§6.2). Decide: make the minigame **server-authoritative** (server runs/scores it), accept a **verifiable replay**, or accept **soft scores** backed only by rate limits. Phase 4 is blocked on this.
- **Arena match-shopping.** If a challenger can call `/arena/challenge` repeatedly and only submit favourable matches, matchmaking is gamed. Mitigate by making the pairing **deterministic per challenger per time-window** (same inputs → same opponent), or by penalising unredeemed matches.
- **Per-kingdom keys.** One `game_authority` per `GameEngine`. v1 = one kingdom. Multi-kingdom needs a kingdom→key map and per-request kingdom routing.
- **Deploy runtime.** Co-sign routes require the Node runtime — the web app can no longer be a static/edge-only deploy. Confirm the hosting target supports a Node server.
- **Availability.** With this live, dungeon/arena/expedition/estate actions depend on the route handlers being up. The co-signer is now on the critical path — it needs the same uptime treatment as the web app itself.
- **The latent `dungeon-tab.tsx` bug.** Independent of this backend, today's shipped dungeon `attack/flee/claim` calls pass wrong account/param shapes (hidden by `FlexIxBuilder`). Phase 2 fixes them as part of rewiring.

---

## 13. One-paragraph summary

A set of Next.js Route Handlers under `apps/web/src/app/api/cosign/` holds the `game_authority` key server-side, reads live on-chain state, computes the game's RNG / matchmaking / score data with a deterministic state-seeded PRNG, builds the instruction with the real SDK types, partial-signs a `VersionedTransaction`, and hands it back for the wallet to finish — unblocking all seven `game_authority`-gated instructions across dungeon, arena, expedition, and estate, with no separate service and no program changes. The one genuine unknown is how minigame scores reach the server trustworthily; everything else the server legitimately owns.
