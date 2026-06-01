# Event System — `claim_prize` Test Gap Audit

Status: **TODO — pick up in next session**
Scope: `programs/novus_mundus/src/processor/event/claim_prize.rs` and `sdks/novus-mundus-ts/tests/e2e/19-event.test.ts`.

## Summary

The four event processors (`create`, `join`, `finalize`, `claim_prize`) are unevenly tested. The first three have solid success + reject coverage. **`claim_prize` has zero successful-claim tests** — every one of its tests is a negative case. The full happy path of the instruction is unverified.

## Coverage matrix (current)

| Processor | Tests | State |
|---|---|---|
| `event/create.rs` | 4 (create with params, ended event, level requirement, reject non-DAO) | ✅ Good |
| `event/join.rs` | 6 (success, already-in-event reject, ended reject, non-existent reject, level reject, different-payer) | ✅ Good |
| `event/finalize.rs` | 5 (success, active reject, already-finalized reject, non-existent reject, preserve count) | ✅ Good |
| `event/claim_prize.rs` | **0 success, 4 reject-only** | 🔴 **Gap** |

### Existing `claim_prize` tests (all reject-only)

| Test | File:line | Path covered |
|---|---|---|
| reject claim on non-finalized event | `19-event.test.ts:569` | `event.status != Finalized` |
| reject claim by non-participant | `19-event.test.ts:606` | no participation PDA |
| reject claim for non-existent event | `19-event.test.ts:630` | empty event account |
| reject claim on finalized event with no participation | `19-event.test.ts:647` | finalized + no participation |

### The lifecycle test pretends to test claim

`19-event.test.ts:920-967` sets up a full winning scenario (join → score → finalize → leaderboard rank 1) and then **expects the claim to fail with `AccountTooNew (6122)`** because litesvm-created accounts are < 7 days old. Comment at line 948-951 acknowledges this. Result: even the lifecycle test's claim assertion only proves "anti-sybil age check fires"; it does not exercise any post-age-check code.

## What is NOT tested

All references are to `programs/novus_mundus/src/processor/event/claim_prize.rs` unless noted.

### Untested success paths (4 prize types, each its own branch)

`match prize_type` at `:214-278`:

1. **`PrizeType::LockedNovi`** (`:215-241`) — mints NOVI via `GameEngine` PDA signer (`crate::helpers::mint_tokens`) AND updates `winner.locked_novi`. Two failure modes uncovered: bad mint authority signer derivation, off-by-one in `checked_add`.
2. **`PrizeType::Gems`** (`:242-244`) — `winner.gems = winner.gems.saturating_add(prize_share)`.
3. **`PrizeType::Cash`** (`:245-247`) — `winner.cash_on_hand = winner.cash_on_hand.saturating_add(prize_share)`.
4. **`PrizeType::SPLToken`** (`:248-277`) — CPI transfer from event vault to winner ATA, signed by `EventAccount` PDA (seeds: `EVENT_SEED + game_engine + event_id + bump`). Highest risk path — token vault + signer derivation untested.

### Untested side effects

| Side effect | Code | Risk if broken |
|---|---|---|
| `prize_remaining` decrement | `:282` `event_data.prize_remaining = event_data.prize_remaining.saturating_sub(prize_share)` | Pool drains incorrectly; future claims see wrong remaining |
| `current_event = 0` | `:287` | Winner can't join a new event after claiming |
| Participation account closed + rent refunded to `winner_owner` | `:289+` (calls `close_account`) | Rent leaks; or claim is silently re-callable |
| `EventPrizeClaimed` event emission with correct payload | end of file | Indexers / UI don't see claims |

### Untested guard paths

| Guard | Code | Why it matters |
|---|---|---|
| Double-claim rejection | `:171` `if participation_account.lamports() == 0` | Without test, refactor could bypass and let a winner claim twice |
| Rank > 9 reject | `:180` | Top-10 only; rank 11+ should fail |
| Insufficient pool remaining | `:206-208` `if event_data.prize_remaining < prize_share` | Race between concurrent claims |
| `NothingToClaim` (zero share) | `:189-191` `if base_prize_share == 0` | Edge case for tiny pools / lowest ranks |
| Treasury building bonus | `:193-203` `treasury_prize_bonus_bps(estate)` | +10% / +25% / +40% / +50% at Treasury Lv 5/10/15/20 — never exercised |
| Anti-Sybil tier 2 (prize ≥ 25K) | `eligibility.rs` via `:147-149,162` | 30-day account age + 20 attacks; only tier 1 is implicitly hit (via `AccountTooNew`) |
| Anti-Sybil tier 3 (prize ≥ 100K) | same | 60-day age + 50 attacks |
| Transfer ratio check | `:154-158` `check_transfer_ratio(total_received, total_sent, max_transfer_ratio)` | Consolidation-bot detector; never reached because age check fails first in current tests |

### Untested PRIZE_DISTRIBUTION math

`constants::PRIZE_DISTRIBUTION` (top-10 share table in bps). `event_data.find_rank()` lookup at `:176` is unverified. A 10-winner end-to-end test would validate the entire distribution table sums correctly and each rank receives its share.

## How to write the missing tests

The litesvm clock is fully manipulable. `tests/fixtures/time.ts:78-92` exposes `advanceTime(svm, seconds)` — `19-event.test.ts:922` already uses it to push past `endTime` for finalize. The same trick handles the age check.

For activity (`total_attacks`) and transfer ratio (`total_sent` / `total_received`), two options:

1. **Real path**: have the player actually perform attacks / transfers as fixture setup. Slow but accurate.
2. **Direct account edit**: `svm.setAccount(playerPda, { ...patched data })` to set `total_attacks` and `total_sent` / `total_received` to satisfy the eligibility math without running gameplay. Faster, isolates the claim_prize logic.

Recommend option 2 for the dedicated `claim_prize` tests (focused unit-style), option 1 for one integration-style end-to-end.

### Test plan for `describe('Claiming Prizes')`

Add to `19-event.test.ts:568-668`:

```ts
it('should claim Cash prize and credit winner', async () => {
  // Setup: rank-1 winner on a finalized Cash-prize event
  // - advanceTime past 7 days (anti-sybil tier 1 age)
  // - patch winner.total_attacks >= 5 (tier 1 activity)
  // - patch winner.total_received / total_sent within 10:1 ratio
  // Act: claimPrize
  // Assert:
  //   - tx succeeds
  //   - winner.cashOnHand == before + (prize_amount * 4000/10000)  // rank-1 = 40%
  //   - event.prizeRemaining == prize_amount - rank-1 share
  //   - participation PDA closed (data_len == 0)
  //   - winner.currentEvent == 0
  //   - EventPrizeClaimed event emitted with correct rank + amount
});

it('should claim LockedNovi prize, mint NOVI, and update locked_novi', async () => {
  // Same setup, but event.prizeType = LockedNovi
  // Assert:
  //   - winner ATA balance increased by prize_share
  //   - winner.lockedNovi increased by prize_share
});

it('should claim Gems prize and credit gems', async () => { ... });

it('should claim SPLToken prize via event vault transfer', async () => {
  // Need: event vault token account funded with prize_amount
  // Assert: vault balance decreased, winner SPL balance increased
});

it('should reject double-claim of same prize', async () => {
  // First claim succeeds (as above).
  // Second claim attempt: assert fails with EventPrizeAlreadyClaimed.
  // Covers participation_account.lamports() == 0 guard at claim_prize.rs:171.
});

it('should apply Treasury building bonus to prize share', async () => {
  // Build Treasury Lv 10 first → +25% prize bonus.
  // Assert claimed amount = base_share * 1.25.
});

it('should reject claim with insufficient prize_remaining', async () => {
  // Drain prize_remaining via prior claims, then attempt one more.
  // Assert InsufficientBalance.
});

it('should clear winner.currentEvent allowing join of new event', async () => {
  // After successful claim, joinEvent to a different event — should succeed.
});

it('should distribute correctly across top-10 ranks', async () => {
  // 10 winners with distinct scores. Each claims. Assert each receives
  // PRIZE_DISTRIBUTION[rank] * prize_amount / 10000.
  // Validates the full distribution table sums to 100%.
});

it('should reject claim from rank 11+ (non-top-10)', async () => {
  // 11 participants. Rank-11 player attempts claim. Assert NotEventWinner.
});

it('should enforce anti-sybil tier 2 age for 25K+ prize', async () => {
  // Event with prize_amount = 50_000.
  // Winner has only 7 days age (tier 1 passes, tier 2 fails: needs 30).
  // Assert AccountTooNew.
});

it('should enforce anti-sybil tier 3 age for 100K+ prize', async () => {
  // prize_amount = 200_000. Age 30 days. Assert AccountTooNew (needs 60).
});

it('should reject claim from consolidation account (bad transfer ratio)', async () => {
  // Patch total_received = 100, total_sent = 0 → ratio 100:0 > 10:1.
  // Assert eligibility error.
});
```

## Other event processors — secondary gaps

While here, also note:

- `event/create.rs` — no test that creates an SPL-token-prize event end-to-end (vault funding, mint validation). The lifecycle test uses Cash.
- `event/join.rs` — payer-different-from-owner is tested, but the corresponding state side effects (participation PDA owner field == owner, payer field ≠ owner) are not asserted.
- `event/finalize.rs` — leaderboard is verified to have entries, but the ordering (highest score → rank 0) is not asserted across multiple participants with distinct scores. Worth one focused test.

## Acceptance criteria

When picking this up:

1. All 13 tests listed under "Test plan" above added to `19-event.test.ts` under `describe('Claiming Prizes')` (or a new `describe('Prize Distribution')` block).
2. Each prize type (`LockedNovi`, `Gems`, `Cash`, `SPLToken`) has at least one success test.
3. Treasury bonus, rank-distribution math, and double-claim guard each have a dedicated test.
4. Anti-Sybil tiers 2 and 3 each have a dedicated test.
5. `bun test tests/e2e/19-event.test.ts` reports 0 fail.
6. Secondary gaps above are either covered or filed as a follow-up.

## Files in scope

- `programs/novus_mundus/src/processor/event/claim_prize.rs` — instruction under test
- `programs/novus_mundus/src/logic/eligibility.rs` — anti-Sybil tier helpers
- `programs/novus_mundus/src/helpers/estate.rs` — `treasury_prize_bonus_bps`
- `programs/novus_mundus/src/constants.rs` — `PRIZE_DISTRIBUTION`
- `sdks/novus-mundus-ts/tests/e2e/19-event.test.ts` — target file for new tests
- `sdks/novus-mundus-ts/tests/fixtures/time.ts` — `advanceTime` helper (already used in lifecycle test)
