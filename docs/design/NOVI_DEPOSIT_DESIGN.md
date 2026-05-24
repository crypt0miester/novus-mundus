# NOVI Deposit — Design

Status: draft, awaiting decisions on tuning knobs.
Scope: a new `deposit_novi` instruction that lets a wallet credit NOVI back into the game economy, plus the companion changes needed to make that safe.

## 1. Why

Today NOVI has a one-way exit and no return path:

- `withdraw_reserved` moves NOVI from a `UserAccount` PDA-owned ATA to the user's wallet ATA after a 7-day vesting period — the only path tokens leave program-controlled accounts.
- Nothing reads ATA balance to credit state, so any NOVI sent to a PDA-owned ATA from outside the program is **permanently stuck**.
- `mint_for_prize` already supports DAO mints with non-gameplay purposes — Marketing (2), Partnerships (4), **Liquidity (6, "DEX pools" per the doc-comment)**. Without a return path, those tokens have no in-game utility, so the DAO can't make them valuable in markets.

We want a controlled re-entry so:

- A player who bought NOVI on a DEX can put it back into the game.
- DAO mints for purposes 2/4/6 actually do work (recipients have a way to convert into game value).
- Tokens accidentally sent to a PDA-owned ATA aren't permanently lost (see §6 for the optional sweep).
- The treasury still captures revenue on the round-trip, rather than ceding it entirely to peer-to-peer DEX trades.

## 2. Scope

In scope:

- A new instruction: `deposit_novi(amount)` — `wallet ATA → UserAccount reserved ATA`, credits `user.reserved_novi`, charges a tunable treasury fee.
- Fixing the `mint_for_prize` cap-atomicity hazard (audit M-17) — its caps are circumventable inside a batched tx today.
- Documenting the relationship between deposit volume and DAO mint discretion on `mint_for_prize` purposes 2/4/6.
- Constants for the deposit fee and (optional) per-wallet daily cap, named and tunable like the `saturating_yield` knobs.
- SDK + CLI surfaces, instruction-map / error-code doc updates.

Out of scope:

- Wallet → `locked_novi` direct deposits (would bypass any future reserved-side mechanics; see §3).
- Changes to `purchase_novi` SOL pricing.
- Changes to time-generated NOVI (`update_locked_novi`) rates or caps.
- Changes to `mint_for_prize` allocation caps themselves — those are governance levers, not part of this design.
- Repointing existing `reserved_to_locked` (kept free; see §3).

## 3. Economic background — condensed

Three NOVI token accounts exist, distinguished by owner:

| Account | Owner | Role |
|---|---|---|
| Player NOVI ATA | `PlayerAccount` PDA | Backs `player.locked_novi`. Burned by spend instructions. |
| Reserved NOVI ATA | `UserAccount` PDA | Backs `user.reserved_novi`. Subject to 7-day vesting on withdraw. |
| Wallet NOVI ATA | wallet | Created on demand by `withdraw_reserved`; freely tradable. |

The program never reads ATA balance to update state — state is always the source of truth, ATA mirrors it via paired CPI mint/burn. That property must be preserved by `deposit_novi`: the deposit is a paired *transfer in* + *state credit*, both in one ix, never a "read ATA, infer credit" lookup.

**Supply pressure on the DEX comes from two sources:**

- *Gameplay-bounded:* `reserved_novi` earned via `mint_for_prize` purposes 0/1 (Prizes/Events) — hard-capped at 5% of `max_supply_cap` lifetime, plus per-claim caps from prize accounts. Emission rate is gameplay-gated.
- *DAO-discretion:* `mint_for_prize` purposes 2/3/4/5/6 — capped per-purpose but otherwise at the DAO's pace. Purpose 6 is *explicitly* a DEX liquidity injection.

**Treasury captures value through:**

- `purchase_novi` (SOL → NOVI mint to locked) — directly impacted by deposit volume.
- Other shop items, hero NFT mints, subscriptions — *not* affected by NOVI flows.
- DAO-owned DEX LP sales (when the DAO is the LP for purpose-6 mints) — treasury captures SOL when buyers route through DEX.
- The deposit fee in this design — treasury captures fee on every deposit, including peer-to-peer trades that would otherwise yield treasury zero.

**Why "deposit to reserved" instead of "deposit to locked":**

`reserved_to_locked` today is free and instant — so reserved → locked is one cheap ix. That means "only to reserved" is *not* meaningful friction. We're picking reserved anyway because:

1. It composes with any future reserved-side mechanic (vesting on convert, conversion tax, reserved-side interest). Going straight to locked closes those design moves.
2. The fee is taken on the deposit side, so the choice of destination doesn't affect revenue capture.
3. Withdraw vesting (on the reserved pool) is preserved untouched.

## 4. The `deposit_novi` instruction

### 4.1 Wire

Discriminant: next free in the token range (currently 290 → 290 is free per `instruction-map.md`).

```
[0..8]  amount: u64 (little-endian) — NOVI tokens to deposit
```

### 4.2 Accounts

```
0. [writable]  user                       UserAccount PDA
1. [signer]    owner                      Wallet that owns user PDA + source ATA
2. [writable]  source_token_account       Wallet's NOVI ATA (owned by `owner`)
3. [writable]  reserved_token_account     UserAccount PDA-owned reserved ATA
4. []          novi_mint                  NOVI mint (must match NOVI_MINT_ADDRESS)
5. []          token_program              SPL Token program
```

Notes:

- `source_token_account` ownership must validate as the `owner` wallet (not a PDA) — explicitly guard against someone passing a PDA-owned ATA to "self-deposit" without the right authority (see §4.5).
- `reserved_token_account` ownership must validate as the `UserAccount` PDA — same `validate_token_account_owner` used elsewhere.
- No `game_engine` needed unless the fee destination requires it (see §4.4).

### 4.3 Flow

1. Validate signer (`owner`), writability, owner of UserAccount PDA, NOVI mint identity.
2. Validate `source_token_account` owner == `owner.address()` (wallet-owned).
3. Validate `reserved_token_account` owner == `user.address()` (PDA-owned).
4. Parse `amount`; reject zero.
5. Compute split: `fee = ⌊amount · DEPOSIT_FEE_BPS / 10000⌋`; `credited = amount − fee`.
6. Burn `fee` NOVI from `source_token_account` (wallet signs).  *(See §4.4 on burn vs treasury collect.)*
7. Transfer `credited` NOVI from `source_token_account` → `reserved_token_account` (wallet signs).
8. Update state: `user.reserved_novi += credited`, `user.total_reserved_earned += credited`.
9. Emit `NoviDeposited { user, amount, fee, credited, new_reserved, timestamp }`.

### 4.4 Fee mechanism — burn, not collect

Default proposal: **burn the fee** rather than transfer it to a treasury ATA.

- Burning needs no extra account, no treasury NOVI ATA bookkeeping, no later "do we sell the accumulated treasury NOVI on the DEX" decision.
- Burning is value-accretive to remaining holders — directly counter-balances DAO mints for purposes 2/4/6.
- The wallet already signs the deposit, so it can authorize the burn from its own ATA in the same ix.
- The fee never inflates the circulating supply because it never enters game state.

Trade-off: the DAO can't later spend the accumulated fee. But the DAO already controls the mint via `mint_for_prize` purpose 5 (Treasury), so it has a separate, governed channel for NOVI it wants to hold.

Alternative (rejected for v1): transfer the fee to a `treasury_novi_ata` owned by the GameEngine PDA. More complexity, ambiguous spend policy. Open the door later if there's demand.

### 4.5 Vesting timestamp — do not touch `reserved_novi_earned_at`

`mint_for_prize` sets `user.reserved_novi_earned_at = now` on every mint (lines 277–278 of that file) so the 7-day `withdraw_reserved` clock restarts per prize tranche. `deposit_novi` **must not** do the same — it would let a player reset their own vesting by depositing 1 NOVI, griefing themselves out of a withdraw they expected.

Rationale for leaving it alone:

- The depositor already paid market price for the NOVI off-chain. The 7-day vesting exists to prevent flash dumps of *freshly-minted* prize NOVI, not to delay a re-deposit.
- The only path the deposited NOVI flows into spending is `reserved_to_locked`, which has no vesting check — so the timestamp doesn't gate the in-game use anyway.
- If a brand-new user deposits with `earned_at = 0`, they can withdraw immediately. That's fine: they're just round-tripping their own NOVI through the reserved pool, no value extracted. Not an exploit.

If we later split state into `earned_reserved` vs `deposited_reserved` (see §10), the timestamp question becomes per-bucket and this concern goes away.

## 5. Companion fix — `mint_for_prize` cap atomicity (audit M-17)

Lines 50–58 of `mint_for_prize.rs` document the hazard: multiple `mint_for_prize` instructions in one transaction each pass the cap check before either updates the running total, so combined they can exceed the cap. The mitigation today is "DAO frontend issues exactly one mint_for_prize per tx."

Fix: collapse the read-check-write into a single critical section that doesn't release the cap state between read and write. Concretely:

- Acquire `game_engine` data mut once at the top of the cap-check section.
- Compute the new running totals (per-purpose + total).
- Compare against caps using the *new* totals (not the pre-write).
- Write the new totals before releasing.
- The mint CPI happens after the write — if it fails, the caller can revert. The on-chain cap accounting remains consistent.

Already most of the function holds `game_engine_data` as a raw pointer through the mint CPI. The change is to move the cap comparisons to operate on the post-write totals and write them *before* the CPI rather than after.

This is independent of `deposit_novi` but blocks shipping confidence in the deposit/mint loop — a non-atomic cap means the DAO can over-mint by accident or design and there's no protection.

## 6. Optional — stuck-token recovery

Today, NOVI sent to a PDA-owned ATA from outside the program is unrecoverable. Players occasionally do this by mistake. An optional `treasury_sweep_untracked_novi` ix would:

- Read the on-chain ATA balance.
- Compare to `player.locked_novi` (or `user.reserved_novi` for the reserved ATA).
- If ATA > state, transfer the surplus to a treasury ATA. The PDA signs via seeds.
- Permissioned to `game_engine.authority` (DAO).

This is genuinely safe — there's no spendable state credit being created, just recovering accidentally-locked tokens. Optional for v1; flag as a follow-up. Not in scope if we don't add it now, but worth knowing the hole exists.

## 7. Constants — named and tunable

In `processor/economy/deposit_novi.rs`:

```rust
// Fee taken from every deposit, in basis points. Burned from the source ATA.
// Tunable; start at 10% (1000 bps). Range expected to be 0–1000 bps.
const DEPOSIT_FEE_BPS: u16 = 1000;

// Per-wallet, per-rolling-window deposit cap (NOVI). 0 = unlimited. Optional
// rate limiter; off by default but the knob exists if the DAO needs to
// throttle without a redeploy of governance.
const DEPOSIT_DAILY_CAP: u64 = 0;
const DEPOSIT_DAILY_WINDOW_SECS: i64 = 86_400;
```

If `DEPOSIT_DAILY_CAP > 0`, `UserAccount` needs:

- `deposited_in_window: u64` — running count within the current window.
- `deposit_window_start: i64` — start of the current window.

If we ship v1 without the cap, neither field is needed and the state stays unchanged. Recommend shipping **without** the cap; add later if observed leak rate demands.

`forecast.ts` mirror: if the SDK ever computes "how much will I get crediting X NOVI", add `DEPOSIT_FEE_BPS` to `forecast.ts` and a comment that it MUST mirror the program. Likely not needed in v1 — the UI shows `amount → credited` inline using the live constant.

## 8. Errors

New variants in `error.rs`:

- `DepositAmountZero` — `amount == 0`.
- `DepositSourceNotWalletOwned` — `source_token_account` owner ≠ `owner` wallet.
- `DepositReservedAtaMismatch` — `reserved_token_account` owner ≠ `user` PDA.
- `DepositExceedsDailyCap` — only if `DEPOSIT_DAILY_CAP > 0`.

Reuse existing `InvalidMint`, `Unauthorized`, `MathOverflow` for the other failure modes.

## 9. SDK + UI

SDK (`sdks/novus-mundus-ts/src/instructions/economy.ts`):

- `createDepositNoviInstruction({ owner, user, sourceTokenAccount, reservedTokenAccount, noviMint }, { amount })`.
- Export the constant `DEPOSIT_FEE_BPS` so UI can show "you'll receive N credited" inline.

CLI (`sdks/novus-mundus-ts/cli`):

- `novus deposit-novi --amount <N>` for ad-hoc / test use.
- No `init`-time concern.

Web UI:

- Add a Deposit panel in the player's vault/wallet area, paired with the existing Withdraw flow.
- Show fee inline: "Deposit 1,000 NOVI → 970 reserved (3% fee burned)."
- Disable when wallet ATA balance < amount.

## 10. Future — explicit non-decisions for v1

Documenting choices we considered and *defer*:

- **Separate `deposited_reserved` bucket** vs single `reserved_novi`. Would let deposit + prize coexist with different vesting timestamps. Skipped because not needed today; revisit if §4.5's "earned_at stays put" turns out to surprise users.
- **Conversion fee or vesting on `reserved_to_locked`**. Would dampen deposit-to-spend arbitrage. Skipped because the deposit fee already taxes the ingress; double-taxing is harsh.
- **DEX-aware deposit pricing** (e.g. quote-driven). Out of scope; the deposit fee is a flat bps for v1.
- **Treasury NOVI ATA + fee collection** (vs the burn proposed in §4.4). Open if/when there's a clear policy for what the treasury would do with collected NOVI.

## 11. Tests

Program (Rust):

- Happy path: wallet deposits → reserved credited, fee burned, supply decreases by fee.
- Zero amount → rejected.
- Source ATA owned by PDA → rejected (not wallet-owned).
- Reserved ATA owner ≠ user PDA → rejected.
- Insufficient wallet balance → rejected (SPL transfer fails).
- Concurrent deposit + withdraw_reserved interaction — state stays consistent.
- Vesting `earned_at` is *not* updated by deposit (covered by a separate assertion).
- M-17 fix: two `mint_for_prize` ix in one tx no longer combine past the cap.

Integration:

- Full loop: gameplay earn → 7-day vest → withdraw → re-deposit (different wallet) → convert → spend.
- DAO purpose-6 liquidity mint → DEX-style transfer to a buyer wallet → buyer deposits → spends.

SDK (TS):

- `createDepositNoviInstruction` builds the right accounts and data layout.
- Web UI inline-fee math matches the program.

## 12. Rollout

1. Land the program changes (`deposit_novi` + `mint_for_prize` cap fix + error variants).
2. Land SDK + CLI (`novus deposit-novi`, instruction builder).
3. Rebuild + redeploy program to localnet; rebuild SDK `dist/`.
4. Update docs: `instruction-map.md` (new ix + Token-system count), `error-codes.md` (4 new variants), `accounts.md` (no new account, but the reserved ATA gains a documented inbound flow).
5. Verify with the integration test on localnet.
6. Land web UI Deposit panel.
7. Soft launch: DEPOSIT_FEE_BPS = 300, DEPOSIT_DAILY_CAP = 0. Monitor for one full cycle of "earn → withdraw → deposit" behavior.
8. Tune from there.

## 13. Decisions needed before I implement

These are the only things I'd flag back for sign-off before writing the ix:

1. **`DEPOSIT_FEE_BPS` default.** 300 (3%) is my proposal. Acceptable range: 0–1000.
2. **Burn the fee vs collect to treasury.** §4.4 recommends burn for v1. Confirm or override.
3. **Ship with `DEPOSIT_DAILY_CAP = 0`?** Recommend yes (off by default, the constant exists if we need it). Confirm.
4. **Stuck-token sweep ix (§6) — in v1 or follow-up?** Recommend follow-up.
5. **Order of operations on the program redeploy.** This change ships alongside the `collect_resources` curve + the `mint_for_prize` M-17 fix in a single redeploy, or split? Recommend one redeploy (both are touching the economy and benefit from the same test cycle).

Once those five are nailed, the implementation is straightforward: one new processor file, one new error block, one SDK instruction, one CLI subcommand, one web panel, doc updates, redeploy.
