# Switchboard `OracleQuote` Migration Plan

Status: **PROPOSAL — for review.** Nothing implemented yet.
Author: Claude · Date: 2026-05-19

---

## 0. TL;DR

Switchboard's newest on-demand product, `OracleQuote`, replaces the old
"pull feed account" model. Instead of reading a persistent, separately-cranked
`PullFeedAccountData` account by hand-rolled byte offsets (what our
`sdks/p-switchboard` crate does today), the new model delivers a **signed price
quote** that is cryptographically verified on-chain by the `switchboard-on-demand`
crate's `QuoteVerifier`.

I recommend we **adopt `OracleQuote` and retire the hand-rolled `p-switchboard`
reader**, keeping Pyth untouched. The recommended consumption model is the
**crank-persisted quote PDA** (the "advanced" example's `crank` + `read` split):
an off-chain cosigner-style crank keeps a quote account fresh, and purchase
instructions just verify that account.

**The one real constraint** (see §3): `switchboard-on-demand`'s `pinocchio`
feature is pinned to `pinocchio ^0.9.2` — confirmed still true on the **latest**
`0.12.1` release (Apr 2026), not just the example's `0.10.3` — while our program
is on `pinocchio 0.10.2`. The recommended answer is **neither** to depend on the
crate **nor** to reinvent verification from scratch, but to **vendor Switchboard's
own verification module and port it to pinocchio 0.10** (§3 Option C). A scoping
spike sizes that port before Phase 1.

---

## 1. Where we are today

The program already has a **dual-oracle** design (Pyth + Switchboard), wired but
not live (oracle config is deliberately deferred — see memory `project_shop_ui`).

On-chain (`programs/novus_mundus`):

- `sdks/p-switchboard` — a hand-rolled, `no_std`, pinocchio-compatible reader for
  Switchboard's `PullFeedAccountData` (v0.11.3 layout), using fixed byte offsets
  (`OFF_RESULT_VALUE = 2264`, etc.). Values are `i128` scaled `10^18`.
- `sdks/p-pyth` — equivalent hand-rolled Pyth reader.
- `helpers/token_ops.rs` — `OracleType { Pyth, Switchboard }`, `detect_oracle_type`
  (by feed-account *owner program*), `validate_oracle_feed_at_config`,
  `pin_oracle_feed`, `read_switchboard_price`, `calculate_token_amount_*`.
- State holds **feed account pubkeys**:
  - `ShopConfigAccount.sol_pyth_feed` / `.sol_switchboard_feed` (+ `sol_max_staleness_slots`,
    `sol_confidence_threshold_bps`).
  - `GameEngineConfig.novi_pyth_feed` / `.novi_switchboard_feed`.
  - `AllowedTokenAccount.pyth_feed` / `.switchboard_feed`.
- Consumers: `purchase_novi`, `purchase_item`, `purchase_bundle`,
  `purchase_flash_sale`, `subscription/purchase`, plus the config writers
  `update_config`, `create_allowed_token`, `update_allowed_token`.
- Today each purchase ix takes **two extra feed accounts** (sol + token/novi),
  `detect_oracle_type` picks Pyth vs Switchboard by owner, both feeds must be the
  same oracle, and feeds are "pinned" to DAO-configured pubkeys.

Off-chain (`sdks/novus-mundus-ts-kit`):

- `src/external/switchboard.ts` — manual `DataView` parsers
  (`parseSwitchboardAggregator`, `parseSwitchboardOnDemand`). These are best-effort
  hand-rolled layouts and would be **superseded** by the official JS SDK.
- No `@switchboard-xyz/*` dependency is installed yet.
- CLI cranks live in `cli/lib/cranks/` (arena, castles, dungeons, events, …) and
  are dispatched by `cli/lib/commands/crank.ts`.

**Key takeaway:** the Switchboard path is fully scaffolded but reads the *old*
account model. Migrating to `OracleQuote` is a contained swap of the Switchboard
half — Pyth can stay exactly as-is.

---

## 2. What `OracleQuote` is, and how the example works

Reference: `sb-on-demand-examples/.../advanced-oracle-example`.

`OracleQuote` is a signed bundle of feed results. It is **not** a long-lived,
network-cranked account. The flow:

1. Off-chain, a client asks the Switchboard gateway/crossbar for a fresh signed
   quote for a set of feed IDs.
2. The transaction includes a **Switchboard verify instruction** carrying that
   signed quote (sits in the instructions sysvar alongside our instruction).
3. On-chain, `QuoteVerifier` cryptographically verifies the quote against the
   Switchboard **queue** account, the **slothashes** sysvar, the **instructions**
   sysvar, and the current **clock** slot, enforcing a `max_age`.

The example exposes two on-chain entry points:

- **`crank`** — `OracleQuote::write_from_ix_unchecked(instructions_sysvar, quote,
  queue.key(), 0)`. Reads the verify instruction from the sysvar and **persists**
  the verified quote into a program-owned `quote` account. Gated by a stored
  authorized signer (`state` account holds an authorized payer pubkey).
- **`read`** — `QuoteVerifier::new().slothash_sysvar(..).ix_sysvar(..).clock_slot(..)
  .queue(..).max_age(30).verify_account(quote)` → iterate `quote_data.feeds()`,
  each feed exposes `hex_id()` (32-byte feed id) and `value()`.

Plus `init_state` / `init_oracle` to create those accounts (`utils.rs`:
`ORACLE_ACCOUNT_SIZE = 8 + 32 + 1024` = discriminator + queue + 1024 data bytes).

So a quote account can hold **multiple feeds at once**, each addressed by feed id
— one account can carry SOL/USD + NOVI/USD + token feeds together.

### Two ways we could consume it

**Model A — bundled quote, single tx (no persisted account).**
Every purchase tx prepends the Switchboard verify ix; our purchase instruction
verifies straight from the instructions sysvar (`verify_instruction`-style).
- + Always fresh; no crank infra; no quote-account rent.
- − Every client building a purchase (frontend included) must call the gateway
  and assemble the verify ix; bigger txs; gateway must be reachable at buy time.

**Model B — crank-persisted quote PDA (the example's `crank` + `read`).** ★ recommended
A cosigner-style crank keeps a program-owned quote PDA fresh; purchase
instructions just pass that PDA + sysvars and call `verify_account` with
`max_age`.
- + Purchase clients never touch the gateway; small purchase txs; reuses the
  crank harness we already run.
- − Extra always-on infra; price is up to `max_age` slots old; quote-account
  rent; if the crank stalls, purchases fail (mitigated by DAO fallback price).

The user explicitly wants a **cosigner-style crank**, which is Model B. That is
the recommendation below. `QuoteVerifier` supports both `verify_account` and
`verify_instruction`, so Model A stays available later without redesign.

---

## 3. The pinocchio-version constraint — and why we vendor, not depend

### The constraint (confirmed against crates.io)

`switchboard-on-demand`'s `pinocchio` feature is locked to **`pinocchio ^0.9.2`**
— and this is still true on the **latest** release, `0.12.1` (Apr 2026), not just
the example's `0.10.3`. Our program is on `pinocchio 0.10.2`, which renamed
`AccountInfo`→`AccountView` and `Pubkey`→`Address`. So there is **no published
version that targets our pinocchio**, and none on the horizon. Three ways forward:

### Option A — depend on the crate, accept pinocchio 0.9.2 transitively
Add `switchboard-on-demand` with `features=["pinocchio"]`. Cargo allows 0.9.2 and
0.10.2 to coexist, but the crate's `QuoteVerifier`/`OracleQuote` API consumes
pinocchio-**0.9** `AccountInfo`s while our entrypoint produces **0.10**
`AccountView`s. Bridging them means transmuting account references across two
crate versions — sound only if the two types are byte-identical, which is
UB-adjacent and exactly the fragility you don't want guarding a treasury.
**Rejected.**

### Option B — hand-roll verification from scratch
This is the tempting reading of "just hand-roll it," but it is **not** the same
kind of task as today's `p-switchboard`. `p-switchboard` hand-rolls *reading a
trusted account* — the security boundary there is one line, `owner == SWITCHBOARD_ID`;
the Switchboard program already did the oracle aggregation and signature checks.

`OracleQuote` has **no trusted account**. The quote arrives as an **ed25519
precompile instruction** in the transaction. The Solana runtime verifies the
*signature* — but it will just as happily verify a precompile instruction signed
by *any* key, including an attacker's. What makes a quote *authentic* is the
program checking that the signer is an **authorized oracle listed in the
Switchboard queue account**. That check, plus the message-format decode and
slot-hash binding, **is the trust boundary.** Switchboard's `QuoteVerifier` is
~1,300 lines doing exactly this, against an internal, **versioned, undocumented**
wire format and a 6,280-byte `QueueAccountData` layout.

Reimplement that from scratch and one wrong offset = an attacker self-signs a
precompile instruction with their own key, our parser fails to reject it, and the
program is fed an arbitrary SOL/NOVI price → treasury drain. The code saved is
modest; the failure mode is catastrophic; the format can change under us silently.
**Strongly rejected.**

### Option C — vendor the verification module, ported to pinocchio 0.10 ★ recommended
`switchboard-on-demand` is MIT-licensed and open source. The verification lives
in a self-contained `on_demand/oracle_quote/` module (~9 files: `quote_verifier.rs`
≈1,300 lines, `quote.rs`, `quote_account.rs`, `feed_info.rs`,
`instruction_parser.rs`, `authority_quote.rs`, `quote_ext.rs`, …) plus the shared
`QueueAccountData` struct and a few `types.rs` / `error.rs` items.

Crucially, the crate **already abstracts the account type**: `AccountInfo` is a
`cfg`-gated alias (pinocchio *or* solana-program), and the verifier only ever
calls `borrow_data_unchecked()` + raw pointer reads. So porting pinocchio 0.9 →
0.10 is **mechanical and compiler-checked**: swap the alias to 0.10
`AccountView`/`Address` and adjust a handful of method names. We **copy
Switchboard's own (presumably audited) verifier** — we do *not* invent one. The
dangerous part of Option B (getting the format and queue parse right) is
eliminated because we reuse their parser verbatim.

Vendor it into `sdks/p-switchboard` — repurpose that crate: drop the obsolete
`PullFeedAccountData` offset-reader, replace it with the ported `oracle_quote`
module. Result: native pinocchio 0.10, **zero pinocchio-0.9 in the dependency
tree**, and we own the code.

Trade-off: when Switchboard revs the quote/queue format we must manually
re-vendor. That is a known, bounded maintenance cost — and we control which
format version we pin, so nothing changes under us unexpectedly.

### Spike (Phase 0) — a scoping/port spike, not a build-compat spike
1. Pull `on_demand/oracle_quote/` + its intra-crate deps (`QueueAccountData`,
   `types.rs`, `error.rs`) from `switchboard-on-demand` 0.12.1 source. Count
   total lines; list every pinocchio-0.9 API call that differs in 0.10.
2. Confirm no hidden heavy deps — the verifier should need only hashing; we
   already have `solana-sha256-hasher`, `sha2`, `const-crypto`. Add a minimal
   `keccak` only if required.
3. Port into `sdks/p-switchboard`; `cargo build-sbf`; one `verify_account` smoke
   test; measure CU + binary-size delta.
4. Pin the upstream version/commit in a header comment for future re-vendoring.

### Phase 0 spike findings — 2026-05-19 (this inverts the recommendation)

Pulled `switchboard-on-demand` 0.12.1 source and traced the `pinocchio`-feature
verification path. The result **flips A vs C**:

**Vendoring (C) is ~5,000–5,500 LOC — not a thin module.** The closure:
- `on_demand/oracle_quote/` ≈ 3,590 LOC (8 files, excl. tests)
- `smallvec.rs` 396 · `sysvar/ed25519_sysvar.rs`+`clock.rs` ≈ 440 ·
  `accounts/queue.rs` 341 (`QueueAccountData`) · `types.rs`+`error.rs` ≈ 240 ·
  `account_info_compat.rs` ≈ 110 · plus the `decimal` module and
  `utils`/`solana_compat` glue.
- Requirements that fight our `no_std` `p-switchboard`: the crate uses **`anyhow`**
  (every `oracle_quote` file), **`std`** (`prelude` does `pub use std::result::Result`),
  **`rust_decimal`**, and `crate::solana_program` items *even on the pinocchio
  path* (`syscalls`, `sol_memcpy_`, `Pubkey`).
- A faithful port therefore means: de-`anyhow` → error enum, resolve `std`/`alloc`,
  vendor `smallvec`/`decimal`/`ed25519_sysvar`/`queue`, add a `solana_program`
  shim, *and* port pinocchio 0.9→0.10 account methods — then re-vendor on every
  upstream format rev. Large, security-critical, ongoing.

**The Option A bridge is small.** pinocchio 0.9.2 `AccountInfo` is a one-field
wrapper over `*mut Account` (the fixed loader-ABI struct); pinocchio 0.10's
`AccountView` (now from the `solana-account-view` crate) wraps the same ABI.
Bridging 0.10→0.9 is a small, isolated, testable adapter — cleanest as a manual
entrypoint that also runs pinocchio-0.9's deserializer over the same input buffer
(genuine 0.9 accounts, no `transmute`). The heavy transitive deps
(`tokio`/`reqwest`/`prost`) sit behind the non-default `client` feature;
`features = ["pinocchio", "solana-v2"]` avoids them. Binary-size/CU still TBD.

The spike data inverts the *effort* comparison: vendoring (C) is ~5k LOC we own
and re-sync; depending on the crate (A) is a contained account-bridge.

**User decision — 2026-05-19: Option C (vendor & port).** Rationale: own the
verifier in-tree and keep pinocchio 0.9.2 (and `solana-program-v2`) out of the
dependency graph entirely, accepting the ~5k-LOC vendor cost and the re-sync
maintenance burden on upstream format revs. The remainder of this plan (Phase 1
onward) proceeds on Option C.

---

## 4. Target architecture (Model B)

```
                    off-chain                          on-chain
  ┌───────────────────────────────┐      ┌──────────────────────────────────┐
  │ crank service (ts-kit CLI)    │      │  novus_mundus program            │
  │  - fetch signed quote from    │      │                                  │
  │    Switchboard gateway        │ tx   │  crank_oracle_quote ix:          │
  │    (cosigner-style)           ├─────►│   OracleQuote::write_from_ix     │
  │  - build tx: [verify ix,      │      │   → persist into quote PDA       │
  │     crank_oracle_quote ix]    │      │                                  │
  └───────────────────────────────┘      │  purchase_* / subscription ix:   │
                                         │   QuoteVerifier::verify_account  │
  ┌───────────────────────────────┐ tx   │   (quote PDA, queue, sysvars,    │
  │ player / frontend             ├─────►│    max_age) → feed value by id   │
  │  - normal purchase tx, NO     │      │                                  │
  │    gateway call needed        │      └──────────────────────────────────┘
  └───────────────────────────────┘
```

- **One global quote PDA** holds SOL/USD + NOVI/USD (the always-needed pair).
  Whitelisted-token feeds: decide between packing into the same PDA vs. a
  per-token quote PDA — see open question Q3.
- The quote PDA is **program-owned**, derived from the Switchboard queue
  (`["oracle_quote", queue]` or similar), sized like the example's
  `ORACLE_ACCOUNT_SIZE` (8 + 32 + data).
- Feeds are identified by **32-byte feed id** (`hex_id()`), not account pubkeys.
- The crank is authorized by a stored signer (mirror the example's `state`
  account, or reuse the existing game/DAO authority).

---

## 5. On-chain changes (`programs/novus_mundus`)

### 5.1 Vendor scope — finalized 2026-05-19 (full source read)

All 11 upstream files (`switchboard-on-demand` 0.12.1) are vendored verbatim into
`sdks/p-switchboard/src/vendor/` (4,564 LOC) — `git diff` against `/tmp/sbod`'s
pristine copy is the audit trail for every change made vs. Switchboard's code.

After reading the whole module, the **on-chain verify + write path is only
~1,600 LOC**; the other ~3,000 LOC is off-chain/anchor/client machinery.

**KEEP & port** (no_std + pinocchio 0.10):
- `quote_verifier.rs` — the `#[cfg(feature="pinocchio")]` `QuoteVerifier` impl
  (`verify`, `verify_account`, `verify_delimited`, `verify_instruction_at`,
  `find_slothash_in_sysvar`). ~350 LOC after dropping the non-pinocchio twin.
- `ed25519_sysvar.rs` — `Ed25519Sysvar::parse_instruction` + the `*Ref` types.
- `feed_info.rs` — `PackedFeedInfo` / `PackedQuoteHeader` structs + `feed_id()`,
  `feed_value()` only.
- `queue.rs` — the `QueueAccountData` `#[repr(C)]` struct layout only.
- `quote.rs` — `OracleQuote` + the write path (`write`, `store_delimited`,
  `validate_slot_progression`, `write_from_ix`).
- `ix_sysvar.rs` — `Instructions::extract_ix_data{,_unchecked}`.
- glue: `check_pubkey_eq`/`check_p64_eq`, the `AccountView` bridge
  (`AsAccountInfo` + `borrow_account_data!`/`get_account_key!` re-pointed at
  pinocchio 0.10), `SlotHash`, discriminator/PID/sysvar-ID constants.

**DROP entirely:** `instruction_parser.rs`, `authority_quote.rs`,
`quote_account.rs` (`SwitchboardQuote`), `smallvec.rs`, `quote_ext.rs`, every
`#[cfg(feature = "anchor"|"client"|"idl-build")]` block, the
`#[cfg(not(feature="pinocchio"))]` twins, all `borsh` impls, `value()` (Decimal)
and `hex_id()` (hex String), and the `Vec`-returning helpers
(`feed_ids`, `find_canonical_address`, …).

**Result:** the ported crate needs **no external deps but `pinocchio` 0.10.2** —
no `anyhow`, `borsh`, `rust_decimal`, `bytemuck`, `serde`, or `alloc` (the verify
path is fully zero-copy over slices). `anyhow::Result`/`bail!` → a `SbError`
enum; the upstream security `assert!`s stay (fail-closed under `panic = abort`).

### 5.2 New state — `state/oracle_quote.rs`
- An account-key discriminant for the program-owned quote account
  (add to the `AccountKey` enum).
- Helpers to derive the quote PDA and to expose the queue it is bound to.
- The 1024-byte data region is written/owned by `OracleQuote::write_from_ix`;
  our struct mostly wraps discriminator + queue + bump.

### 5.3 New processor — `processor/oracle/`
- `init_quote.rs` — create the quote PDA (CreateAccount CPI, rent-exempt,
  sized for the feed set). Mirrors example `init_oracle` / `init_quote_account_if_needed`.
- `crank_quote.rs` — `OracleQuote::write_from_ix(...)` into the quote PDA;
  authorize the caller against a stored crank signer; **propagate errors with
  `?`/`map_err` — never `unwrap()`** (program is `panic = abort`).
- Register `pub mod oracle;` in `processor/mod.rs`; add 2 new instruction
  discriminants in the top-level dispatcher (`lib.rs`).

### 5.4 Read path — rework `helpers/token_ops.rs`
- Replace `read_switchboard_price` with `read_quote_feed(quote_acct, queue,
  feed_id, slothash_sysvar, ix_sysvar, clock_slot, max_age) -> Result<value,…>`
  built on `QuoteVerifier::verify_account` + feed-id match over `feeds()`.
- `OracleType`/`detect_oracle_type`: Switchboard is no longer detected by
  feed-account owner (the quote is *our* PDA). Options: (a) keep `OracleType`,
  detect Pyth by owner and treat "quote PDA present" as Switchboard; (b) make the
  caller pass the oracle choice explicitly. Prefer (b) for clarity.
- `validate_oracle_feed_at_config` / `pin_oracle_feed` / `consume_optional_feed_slot`:
  the Switchboard branch no longer validates an account owner — it validates a
  non-zero **feed id** and that the supplied quote PDA matches the configured
  queue. Pyth branches unchanged.
- `calculate_token_amount_switchboard` / `calculate_lamports_from_switchboard`:
  keep the math but confirm the `OracleQuote` value scale (the old reader assumed
  `10^18`; `feed_info.value()` scale must be re-confirmed from the crate).

### 5.5 State layout changes
Swap "Switchboard feed pubkey" fields for "feed id" fields (both 32 bytes →
**size-neutral**, no realloc), and add the queue:

- `ShopConfigAccount`: `sol_switchboard_feed: Address` → `sol_feed_id: [u8;32]`;
  add `switchboard_queue: Address`; rename `sol_max_staleness_slots` →
  `quote_max_age_slots`. Pyth fields untouched. (Adding the queue consumes
  reserved/padding bytes — `ShopConfigAccount` has `_reserved: [u8;8]` +
  `_padding2: [u8;3]`; a full 32-byte queue needs a small grow or a move to
  `GameEngineConfig` — see Q3.)
- `GameEngineConfig`: `novi_switchboard_feed` → `novi_feed_id: [u8;32]`.
- `AllowedTokenAccount`: `switchboard_feed` → `feed_id: [u8;32]`.
- Config writers (`update_config`, `create_allowed_token`, `update_allowed_token`,
  `initialize_config`) updated accordingly: they now write feed ids (no account
  to owner-check), and the "consume optional feed account slot" logic for the
  Switchboard branch goes away.

### 5.6 Account-list changes on every consumer
Each purchase instruction currently takes 2 feed accounts. New Switchboard path
needs: **quote PDA, queue, slothashes sysvar, instructions sysvar, clock**.
Affected: `purchase_novi`, `purchase_item`, `purchase_bundle`,
`purchase_flash_sale`, `subscription/purchase`. Update each instruction's
account doc-comment and parsing. The Pyth path keeps its 2-feed shape, so the two
paths now differ in account count — document clearly.

---

## 6. Off-chain changes (`sdks/novus-mundus-ts-kit`)

### 6.1 Dependencies
- Add `@switchboard-xyz/on-demand` (the official JS SDK) — confirm it interops
  with `@solana/kit` (the SDK uses `@solana/kit`, not web3.js v1). The Switchboard
  SDK is web3.js-v1-based; a kit↔web3.js adapter or a thin wrapper may be needed.
  Flag for the spike.
- `bun add` (per repo convention — never npm/npx).

### 6.2 New crank — `cli/lib/cranks/oracle.ts` + `commands/crank.ts` wiring
- Fetch a fresh signed quote for the configured feed ids from the Switchboard
  gateway/crossbar.
- Build the tx: `[switchboard verify ix, crank_oracle_quote ix]`, **cosigner
  style** — the crank keypair signs, the oracle signature is embedded in the
  verify ix. (Confirm exact API — `Queue.fetchSignatures` / bundle builder — in
  the spike; do not hard-code an API shape from memory.)
- Run on an interval matching `quote_max_age_slots` with margin.

### 6.3 Instruction builders
- `src/instructions/shop.ts`, `src/instructions/subscription.ts`: add the new
  quote-PDA + sysvar accounts to the purchase builders; add `initOracleQuote` and
  `crankOracleQuote` builders.
- `src/state/shop.ts` / `src/state/game-engine.ts`: update decoders for the
  `feed_id` / `switchboard_queue` field changes.

### 6.4 Retire / replace `src/external/switchboard.ts`
- The hand-rolled `parseSwitchboardAggregator` / `parseSwitchboardOnDemand`
  parsers are obsolete. Replace with thin wrappers over the official SDK (or
  delete if unused off the crank path). Keep `src/external/pyth.ts` as-is.

### 6.5 Scripts / CLI commands touching oracle config
- `commands/update.ts`, `flash-sale.ts`, the shop init scripts, `set-level-gap.ts`
  / debug scripts: anywhere a switchboard feed pubkey is passed, switch to feed id
  + queue.

---

## 7. Migration / rollout

- This is a **breaking on-chain change** (instruction layouts, account layouts,
  new instructions) → **redeploy required**. Acceptable: oracle wiring is
  deliberately deferred and not live (memory `project_shop_ui`), so there is no
  production oracle state to migrate.
- State layout: most changes are 32-byte-for-32-byte swaps (size-neutral). The
  one growth is `switchboard_queue` on `ShopConfigAccount`; resolve via Q3.
- Order: (1) §3 spike → (2) on-chain §5 behind existing "oracle not configured →
  DAO fallback price" guard so nothing breaks pre-config → (3) deploy → (4) crank
  §6.2 → (5) DAO configures feed ids + queue → (6) purchases start using oracle
  pricing.
- The DAO-fallback path (`has_oracle()` false ⇒ fixed price) already exists and
  de-risks the whole rollout: until feed ids are configured, behavior is unchanged.

---

## 8. Open questions for you

- **Q1.** Confirm Model B (crank-persisted quote PDA) over Model A (bundled quote
  per purchase tx). Plan assumes B.
- **Q2.** Crank authorization: a dedicated stored crank-signer pubkey (like the
  example's `state` account), or reuse the existing DAO/game authority?
- **Q3.** Feed packing: one global quote PDA for **all** feeds (SOL + NOVI +
  every whitelisted token), or one quote PDA per whitelisted token + one core PDA
  for SOL/NOVI? Affects PDA seeds, account size, and how many feeds one crank tx
  refreshes. Also: store `switchboard_queue` on `ShopConfigAccount` (needs a few
  bytes of growth) or on `GameEngineConfig`?
- **Q4.** Do we keep Pyth as a parallel oracle, or is the long-term intent
  Switchboard-only? (Plan keeps Pyth; says so.)
- **Q5.** `max_age` target — how stale may a quote be? Drives crank frequency and
  `quote_max_age_slots`. Example uses 30 slots (~12s).
- **Q6.** Devnet vs mainnet: the example enables the `devnet` feature on
  `switchboard-on-demand`. Confirm which we target first (queue pubkey differs).

---

## 9. Phased task breakdown

| Phase | Scope | Gate |
|------|-------|------|
| 0 | §3 scoping spike — vendor & port `oracle_quote/` to pinocchio 0.10, `cargo build-sbf`, CU/size + smoke test | **Blocks everything** |
| 1 | On-chain: `state/oracle_quote.rs`, `processor/oracle/{init_quote,crank_quote}`, dispatcher wiring | Phase 0 ✅ |
| 2 | On-chain: rework `token_ops.rs` read path; state layout swaps; config writers | Phase 1 |
| 3 | On-chain: update all 5 purchase/subscription consumers' account lists | Phase 2 |
| 4 | TS: `@switchboard-xyz/on-demand` dep + kit interop check; instruction builders | Phase 0 (interop spike) |
| 5 | TS: `cranks/oracle.ts` cosigner crank + `crank.ts` wiring | Phase 3 + 4 |
| 6 | TS: retire `external/switchboard.ts`, fix config CLI commands/scripts | Phase 5 |
| 7 | Tests: on-chain verify path, crank, purchase-with-oracle; deploy + DAO config | All |

Each phase is independently buildable; the DAO-fallback guard keeps the program
shippable between phases.

---

## 10. Recommendation

Proceeding via **§3 Option C — vendor & port** (user decision, 2026-05-19).
The migration is well-bounded: the Switchboard half is already isolated behind
`OracleType`, the program is not live with oracle config, and Pyth is untouched.
Option C keeps the verifier in-tree and the dependency graph free of pinocchio
0.9.2. The residual risk is maintenance — manually re-vendoring when Switchboard
revs the quote format — which is bounded and under our control.
