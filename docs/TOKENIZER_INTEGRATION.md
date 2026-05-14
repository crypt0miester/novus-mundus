# Adoption notes: what to bring from `tokenizer/` into `vig-internal/`

Status: **Phases 1, 2, 4, and 5 landed** (pinocchio 0.10 foundation + SDK swaps + Switchboard restoration + macros & labels + polish). Phase 3 (account discriminator) requires an on-chain migration decision and is deferred.
Source: `/Users/k/solana/tokenizer/`
Target: `/Users/k/solana/game/vig-internal/`
Date: 2026-05-14 (Phases 1, 2, 4, and 5 landed)

This is an audit of `tokenizer/` (an RWA fundraising program built with newer
pinocchio + harder defensive patterns) for everything worth migrating into the
Novus Mundus game program. Ordered roughly by ROI: highest first.

---

## Migration status (2026-05-14)

### ✅ Done (Phase 1: pinocchio 0.10 foundation + SDK swaps)

Workspace builds cleanly on both host (`cargo check`) and BPF
(`cargo build-sbf` produces `target/deploy/novus_mundus.so` at 1.28 MB). Went
from 276 compile errors to 0.

**Pinocchio 0.9.2 → 0.10.2 bumped everywhere**:
- workspace + 5 Cargo.tomls (`novus_mundus`, `p-core`, `p-pyth`,
  `alt-name-service`, `tld-house`)
- `pinocchio = { version = "0.10.2", features = ["cpi", "copy"] }` —
  the `copy` feature is enabled to make `Address` `Copy`, so existing
  `#[derive(Copy, Clone)]` state structs with `Address` fields keep compiling
  without a structural refactor
- `pinocchio-token 0.5.0`, `pinocchio-system 0.5.0`,
  `pinocchio-associated-token-account 0.3.0` (all bumped)
- `pinocchio-pubkey 0.3.0` **removed everywhere** — it pins pinocchio 0.9
  and is incompatible with 0.10. `declare_id!` now comes from
  `pinocchio::address::declare_id!` (game program) or
  `solana_address::declare_id!` (SDKs)
- `switchboard-on-demand` **removed** — pinned to pinocchio 0.9 and not
  yet 0.10-compatible. Replaced by vendored `p-switchboard` (see Phase 5
  below) — pull-feed reader matching tokenizer's pattern, no queue /
  slothashes / instructions sysvar accounts required at the call site.

**New direct deps added to `novus_mundus`**:
- `solana-address = { version = "2.2.0", features = ["curve25519", "decode"] }`
  — for `declare_id!`, `Address::find_program_address`, `Address::from_str_const`
- `solana-sha256-hasher = "3.1.0"` (no default features) — for
  cross-target sha256 via `sha256_hashv()` (replaces vig's manual
  sol_sha256 plumbing in `helpers/name_service.rs::hashv`)
- `sha2 = "0.10.8"` (no default features) — for host-side hashing
- `five8 = "0.1"`, `five8_const = "0.1"` — base58 encode/decode at
  compile time
- `const-crypto = "0.3.0"` — for compile-time PDA derivation (used by
  Phase 3 work; available now)

**SDK swaps (wholesale, replacing vig's prior copies)**:
- `sdks/p-core` v0.1.0 → tokenizer's v0.2.3:
  - 27 instruction files (vs vig's 8)
  - Adds `CreateV2`, `external_plugin_adapter`, `compress_v1`, `decompress_v1`,
    full plugin authority lifecycle, `BurnCollectionV1`
  - **API shift**: `AssetV1::load(&[u8]) -> &AssetV1` (zero-copy ref,
    `unsafe`) replaced by `AssetV1::from_borsh(&[u8]) -> AssetV1` (owned,
    safe). All 7 call sites in vig updated. Comparisons against
    `*account.address()` rewritten to `&asset.owner != X.address().as_array()`
  - **New required field**: `CreateV1.plugins: &[u8]` — empty slice means no
    inline plugins. Vig's `hero/mint.rs` adds `plugins: &[]` since it adds
    Attributes via a separate `AddPluginV1` call afterward
- `sdks/p-pyth` v0.1.0 → tokenizer's v0.2.0:
  - Same 240-byte `PythPriceAccount` layout
  - Adds `OraclePrice::is_confidence_acceptable(max_bps)` for
    USD→NOVI conversion safety
  - Adds `OraclePrice::get_price_in_target_expo(target_expo)` for
    explicit exponent scaling
  - Adds Pyth fallback chain (current trading → previous trading → stale
    error)

**Local SDKs migrated (`alt-name-service`, `tld-house`)**:
- Pinocchio 0.10 + `solana-address` with `decode + curve25519`
- `Instruction → InstructionView`, `AccountMeta → InstructionAccount`,
  `program::invoke_signed → cpi::invoke_signed`
- State structs (`NameRecordHeader`) changed `pub field: Address` to
  `pub field: [u8; 32]` (matches tokenizer convention for stored bytes)

**Mechanical API renames in `programs/novus_mundus/src/`** (241 files):
- `AccountInfo → AccountView` (and import path `pinocchio::account_info::AccountInfo` → `pinocchio::AccountView`)
- `Pubkey → Address` (import path `pinocchio::pubkey::Pubkey` → `pinocchio::Address`)
- `pinocchio::program_error::ProgramError → pinocchio::error::ProgramError`
- `pinocchio::instruction::{Signer, Seed} → pinocchio::cpi::{Signer, Seed}`
- `pinocchio::pubkey::find_program_address → pinocchio::address::Address::find_program_address`
  (now a method on `Address`, not a free function)
- `pinocchio::pubkey::create_program_address → pinocchio::address::Address::create_program_address`
  — return type changed from `Result<Pubkey, PubkeyError>` to
  `Result<Address, AddressError>`. `From<AddressError> for ProgramError`
  exists, so `.map_err(|e| e.into())` was added to 24 trailing
  `create_pda` calls
- `.key() → .address()`, `try_borrow_data → try_borrow`,
  `try_borrow_mut_data → try_borrow_mut`, `data_is_empty → is_data_empty`
- `account.owner()` is now `unsafe` — wrapped in `unsafe {}` at all 16
  call sites
- `*account.borrow_mut_lamports_unchecked() = X` → `account.set_lamports(X)`
  at all 6 sites (`helpers/account.rs`, `hero/burn.rs`,
  `reinforcement/process_return.rs`)
- `helpers/account.rs::close_account` rewritten to tokenizer pattern:
  move lamports out, then call `account.close()` (which zeros data length,
  lamports, and owner — runtime zero-fills the buffer at instruction end)
- `[u8; 32]` array literals assigned to `Address` consts/fields:
  `BPF_LOADER_UPGRADEABLE_ID`, `TLD_HOUSE_PROGRAM_ID`, `NULL_PUBKEY`,
  `castle.king/team/transition_new_king`, `leaderboard.player`, etc.
  rewritten to use `Address::new_from_array([...])`

**Pinocchio 0.10 macros that vanished — local replacements added**:
- `pinocchio::seeds!(...)` no longer exists in 0.10 (it's in
  `solana_instruction_view` now, not re-exported by pinocchio at a usable
  path)
- `pinocchio::msg!` no longer exists either
- Both replaced by local macros at
  `programs/novus_mundus/src/macros.rs`:
  - `crate::seeds!(s1, s2, ...)` expands to
    `[pinocchio::cpi::Seed::from(<as_ref of each>), ...]` —
    `AsRef::<[u8]>::as_ref($seed)` lets the same macro accept either
    `&[u8]` literals or `&Address` references
  - `crate::msg!(...)` delegates to `pinocchio_log::log!(...)`
- All 103 `pinocchio::seeds!` callsites rewritten to `crate::seeds!`
- All `pinocchio::msg!` and `use pinocchio::msg` sites rewritten

**Entrypoint setup (`programs/novus_mundus/src/lib.rs`)**:
- `entrypoint!(process_instruction)` → `program_entrypoint!()` +
  `no_allocator!()` (no heap — tokenizer pattern) + a manual
  `#[panic_handler]` (workaround: pinocchio's `nostd_panic_handler!()` macro
  emits `#[no_mangle]` on the handler, which current rustc rejects for
  language items)
- `pub const ID: Address = [0xfd, 0x6a, ...]` → `Address::new_from_array([...])`

**`.as_ref()` for seed arrays**:
- pinocchio 0.10's `Address` is a newtype `struct Address([u8; 32])`, not
  a type alias. `&Address` doesn't auto-coerce to `&[u8]` for seed arrays
- Bulk-applied `.as_ref()` to all `account.address()` calls inside `&[...]`
  seed arrays via a `-0777` perl regex with `(?!\.as_ref)` negative
  lookahead for idempotency, plus a `while {}` loop to handle multiple
  conversions per array
- Reverted over-application: removed `.as_ref()` from
  `Self::derive_pda` / `Self::create_pda` / `*::load_checked*` callers
  (those take `&Address`, not `&[u8]`)

**Syscall path changes**:
- `pinocchio::log::sol_log_data` → cfg-gated `pinocchio::syscalls::sol_log_data`
  with manual raw-pointer ABI in `events/mod.rs::emit_event` (on host,
  emit is a no-op)
- `pinocchio::syscalls::sol_sha256` direct usage → `solana_sha256_hasher::hashv`
  in `helpers/name_service.rs::hashv` (cross-target, works on both host
  and BPF)
- `pinocchio::account_info::{Ref, RefMut}` → `pinocchio::account::{Ref, RefMut}`

**Other fixes**:
- `f64::sqrt` (std-only, not on BPF) → `libm::sqrt` in
  `processor/initialization/player.rs::process` (1 site)
- `assert_is_program_authority` signature: `&[u8; 32]` → `&pinocchio::Address`
  (internal helper, only one caller)

### ✅ Done (Phase 5: Switchboard restoration via `p-switchboard`)

The stubbed `get_switchboard_price` / `get_switchboard_price_value` are gone.
Switchboard pricing works again with no extra accounts compared to Pyth.

- **New vendored SDK**: `sdks/p-switchboard/` — copied verbatim from
  `tokenizer/sdks/p-switchboard/`. ~200-line pinocchio-0.10 pull-feed
  reader for `PullFeedAccountData` accounts. Validates the 8-byte Anchor
  discriminator, reads the i128 result (scaled by 10^18) + std_dev +
  result_slot directly from byte offsets, and supports both plain
  staleness checks and confidence-bounded reads.
- **Cargo wire-up**: `programs/novus_mundus/Cargo.toml` now depends on
  `p-switchboard = { path = "../../sdks/p-switchboard", features = ["no-panic-handler"] }`.
- **Owner-based oracle detection**: replaced the data-magic
  `detect_oracle_type(&[u8])` with `detect_oracle_type(&AccountView)`,
  which dispatches on the feed account's owner program (`PYTH_PROGRAM_ID`
  or `SWITCHBOARD_PROGRAM_ID`). Both new constants live in
  `src/constants.rs` (decoded at compile time via
  `five8_const::decode_32_const`). The address-pin against
  shop_config/allowed_token still happens too — owner check is
  defense-in-depth so we don't parse arbitrary bytes as a Pyth or SB feed.
- **Account-count collapse**: the old SB path required 10 accounts (feed,
  queue, slothashes sysvar, instructions sysvar, plus the 7 common
  slots). The new path requires just 7 — same as Pyth. The
  `TOKEN_ACCOUNTS_SWITCHBOARD = 10` constant in
  `helpers/token_ops.rs` was deleted; the remaining `TOKEN_ACCOUNTS_PYTH = 7`
  was renamed to `TOKEN_PAYMENT_ACCOUNTS = 7` to reflect that it covers
  both oracle types. Both feed accounts must come from the same oracle
  program — mixed Pyth + Switchboard is rejected explicitly.
- **`purchase_novi.rs` SB math fix**: the old (stubbed-but-dead) SB code
  in `purchase_novi.rs::get_switchboard_prices` cast an i128 @ 10^18 down
  to i64 via Pyth's `OraclePrice` struct — silently truncating any token
  priced above ~$9. The new `calculate_lamports_from_sb` does direct
  u128 math (same shape as the corresponding `token_ops.rs` path).
- **TS SDK alignment**: `sdks/novus-mundus-ts/src/instructions/shop.ts`
  no longer pushes `switchboardQueue` / `SYSVAR_SLOT_HASHES_PUBKEY` /
  `SYSVAR_INSTRUCTIONS_PUBKEY` on `createPurchaseNoviInstruction`. The
  `PurchaseNoviOracleAccounts` interface dropped `switchboardQueue`. The
  unused web3.js sysvar imports were also removed.

**Verification**: `cargo check --workspace` clean (only pre-existing
deprecation warnings); `cargo test -p novus_mundus --no-run` clean;
TS typecheck same 101 pre-existing errors as baseline (none on the
switchboard / shop / subscription paths).

### ✅ Done (Phase 2: Macros & labels)

Tokenizer's macro toolkit and validation primitives are in place. The
`extract_accounts!` bulk migration of existing processors is **not** done
(~850 `require_*` call sites would need touching); the new macros are
available for new code, and existing call sites already get the labeled-log
upgrade via the validation/mod.rs rewrite.

- **`programs/novus_mundus/src/macros.rs`** — expanded to include
  `extract_accounts!` (exact + lenient forms, with logged
  `missing account <name> at index <i>` errors), `require!`,
  `require_eq!`, `require_keys_eq!`. All use `unlikely` for cold-path
  layout. `seeds!` and `msg!` are still here from Phase 1.
- **`programs/novus_mundus/src/utils/`** (newly wired into `lib.rs` —
  was previously orphan code):
  - `hint.rs` — `cold_path()` + `unlikely(b)` const helpers.
  - `log_format.rs` — `Pk(&pubkey_bytes)` base58 formatter that
    implements `pinocchio_log::logger::Log`, so
    `pinocchio_log::log!("expected {}, got {}", Pk(&a), Pk(&b))`
    prints real base58 addresses in tx logs.
  - `io.rs` — labeled byte readers (`read_u8`, `read_u16`, `read_u32`,
    `read_u64`, `read_i64`, `read_bytes32`, `read_len_prefixed`). On
    short input each logs
    `<label>: data too short at offset N (need M, have K)`.
  - `rent.rs` — `rent_exempt_const(space)` const fn for compile-time
    rent math (skips the `Rent::get()` sysvar read for known-size
    accounts).
  - The pre-existing `utils/leaderboard/`, `utils/misc.rs`, `utils/reward.rs`
    files were orphan code that references `std`/`Vec`. They were never
    reachable from `lib.rs`; the new `utils/mod.rs` deliberately does not
    wire them up. A future no_std cleanup pass can revive them.
- **`programs/novus_mundus/src/validation/mod.rs`** — every `require_*`
  primitive is now wrapped in `unlikely` and logs a base58-formatted
  diagnostic on failure (e.g. `require_owner: expected <A>, got <B>
  (account <C>)`). No call-site changes — every existing call gains the
  better diagnostics for free.
- **`helpers/token_ops.rs` and `processor/shop/purchase_novi.rs`** —
  retrofitted to use `unlikely` on cold paths and `pinocchio_log::log!`
  on the mixed-Pyth-Switchboard rejection. `purchase_novi` now uses
  `read_u8` / `read_u64` for its instruction-data parse, which gives
  the new helpers a real call site and demonstrates the pattern for
  future processors.

### ✅ Done (Phase 4: Polish)

- **`Rent::minimum_balance` → `Rent::try_minimum_balance(...)?`** across
  ~60 call sites in 50+ processor and helper files. Killed every
  deprecation warning. Bulk-applied via
  `perl -i -pe 's/\.minimum_balance\(([^)]+)\)/.try_minimum_balance($1)?/g'`
  — all sites were single-line and inside `ProgramResult`-returning
  functions, so the `?` propagates cleanly. Sites where the space is
  known at compile time can be further migrated to `rent_exempt_const`
  to skip the sysvar read entirely; that is a CU optimization, not a
  warning fix, and is left for a future pass.
- **Hardcoded program IDs → `five8_const::decode_32_const(...)`** for:
  - `helpers/name_service.rs::TLD_HOUSE_PROGRAM_ID` (was a 4-line byte
    array, now a one-line base58 string).
  - `processor/initialization/game_engine.rs::BPF_LOADER_UPGRADEABLE_ID`
    (same).
  The `lib.rs::ID` constant is left as bytes because the program ID is
  built from the deployment keypair and lives next to the
  `program_entrypoint!` invocation.
- **Warning count: 64 → 0** after Phase 2 + Phase 4 work.
- The "every dispatch arm logs `ixn: <name>`" item is already
  effectively done — `lib.rs` uses the local `msg!` macro which
  delegates to `pinocchio_log::log!`.
- `no_allocator!()` was already in place from Phase 1.

### ⏳ Deferred (Phase 3 only)

Phase 3 requires an on-chain migration decision (existing accounts
don't have the `account_key` discriminator byte). It's the only major
remaining work block.

**Phase 3 — Defense-in-depth (§3 below)**:
- Account discriminator pattern (`AccountKey` enum, `account_key: u8` byte 0 on every PDA, `validate_account_key` helper)
- Cached bump byte on every PDA (`bump: u8` at byte 1)
- `require_program_pda` one-shot helper (ownership + discriminator + cached-bump PDA verify in a single call)
- Hash-only PDA verification (`verify_program_address` with direct
  `sol_sha256` syscall, saves ~80–120 CU per call vs `Address::create_program_address`)
- Custom `find_bump_for_address` (saves ~90 CU per attempted bump for known-target searches)
- **Compile-time NOVI mint singleton** (§3.1) — the *only* true singleton in vig; would remove 40 bytes from each `GameEngine` and eliminate the `find_program_address` curve-check loop on init. `const-crypto` dep is already added; not yet wired up
- State struct migration: every PDA gets `account_key: u8 + bump: u8` as its first two fields. Requires either a one-time migration ixn or a feature flag for newly-initialized accounts only. *Touches every state file* — biggest single Phase 3 sub-task

**Phase 4 — Polish**: ✅ done (see the "Done (Phase 4)" section above).
Optional further work: migrate `Rent::try_minimum_balance(SIZE)?` call
sites where `SIZE` is a const to `rent_exempt_const(SIZE)` to skip the
sysvar read. CU-only, not warnings — separate pass.

**Phase 5 — Switchboard restoration**: ✅ done (see the "Done (Phase 5)"
section above). Vendored `p-switchboard`, rewrote both consumer paths,
collapsed SB accounts from 10 to 7 (parity with Pyth).

### Warnings: 0

After Phases 2 and 4, `cargo check -p novus_mundus` is silent — no
deprecation warnings, no unused imports flagged in production code. The
new `utils/` helpers (`read_u16`/`read_u32`/`read_i64`/`read_bytes32`/
`read_len_prefixed`/`rent_exempt_const`/`cold_path`) intentionally have
`#[allow(dead_code)]` since they're library helpers awaiting future call
sites — `read_u8` and `read_u64` already have a real consumer in
`purchase_novi.rs`.

### Build verification

```bash
# Host check (typecheck only)
cargo check --workspace        # 0 errors, 0 warnings on novus_mundus

# BPF build (real target)
cargo build-sbf --manifest-path programs/novus_mundus/Cargo.toml
# Finished `release` profile [optimized] target(s) in 4.33s
# -> target/deploy/novus_mundus.so (1.28 MB)
```

### State struct convention note

Vig currently has a **mix** of `Address` and `[u8; 32]` field types in
state structs:
- Newer fields (touched by the rename): `Address` (e.g.
  `DungeonRun.player`, `GameEngine.authority`)
- Older fields: `[u8; 32]` (e.g. `PlayerCore.owner`,
  `NameRecordHeader.parent_name`)

This works because the `copy` feature on `pinocchio` / `solana-address`
makes `Address` `Copy`, so `#[derive(Copy, Clone)]` still applies. But
it's inconsistent. Tokenizer's convention is `[u8; 32]` everywhere for
stored bytes, `Address` only for live computation.

Recommended cleanup (post Phase 3): convert all state struct fields to
`[u8; 32]`, then drop the `copy` feature from pinocchio deps to shrink
the BPF binary slightly and match tokenizer's pattern.

---

## 0. TL;DR

| Bring | Effort | Why |
|---|---|---|
| **Pinocchio 0.10.2 + AccountView / Address rename** | high | Whole-program API rename. Required to land anything else. |
| **`extract_accounts!` macro** | low | One drop-in macro replaces every "indexed array of slots" parse in your processors. Labeled errors. |
| **`require_*` primitives with labels** | low | Tokenizer's `require_signer("estate")`, `require_owner(_, _, "player")` etc. log expected-vs-got on failure. Game's current versions log nothing — silent failures are murder on devnet. |
| **`require_*` macros (`require!`, `require_eq!`, `require_keys_eq!`)** | low | One-liners with cold-path branch hints. Same shape as Anchor's, no Anchor weight. |
| **Account discriminator + cached bump pattern** | medium | Tokenizer puts `account_key: u8` at byte 0 and `bump: u8` at byte 1 on every PDA, then has a one-shot helper (`require_program_pda`) that validates ownership + discriminator + PDA-with-cached-bump in one pass. Saves the `find_program_address` loop (~1500 CU × ~1-20 iters) on every read after init. |
| **Compile-time singleton PDAs via `const_crypto`** | low | The `ProtocolConfig` PDA address + bump are computed at compile time and hardcoded. Skips the runtime sha256 hash on every config-gated call (~600 CU). Direct applicability: **the NOVI mint** (see §3.1 for why GameEngine doesn't qualify). |
| **Hash-only PDA verify (skip on-curve check)** | medium | `verify_program_address` calls `sol_sha256` directly and compares to the known address. Saves ~80-120 CU vs `create_program_address` per call. Safe whenever the account is already known-program-owned. |
| **`hint::unlikely()` / `cold_path()`** | low | `no_std` analogue of `core::intrinsics::unlikely`. Wrap every `if cond { return Err(...) }` with `unlikely(cond)` — 1-3 CU per call site, multiplied across every `require_*`. |
| **`Pk` base58 pubkey formatter for logs** | low | `pinocchio_log::log!("expected {}, got {}", Pk(&expected), Pk(&got))` actually prints readable addresses in tx logs. Currently impossible in vig-internal. |
| **Compile-time base58 decoder (`five8_const`)** | low | `five8_const::decode_32_const("SomeAddressInBase58")` → `[u8; 32]` at compile time. Replaces ugly hardcoded byte arrays for program IDs. |
| **Byte-read helpers (`read_u16`, `read_u64`, `read_bytes32`)** | low | Each takes a label and logs `data too short at offset N (need M, have K)` on failure. Replaces ad-hoc slicing in every processor. |
| **`p-pyth` (v2)** | medium | Tokenizer's p-pyth is the same shape as yours but with `#[cfg(test)] no_std` toggle, `OraclePrice::is_confidence_acceptable`, target-expo scaling, and proper Pyth fallback (prev_price when current is stale). Bring as a v2 upgrade. |
| **`p-switchboard`** ✅ done | medium | Vendored. ~200-line pull-feed reader at `sdks/p-switchboard/`. Replaced the heavy `switchboard-on-demand` crate and the 10-account quote/queue/sysvar layout. |
| **`rent_exempt_const(space)`** | low | Compile-time rent calculation. Replaces every `Rent::get()?` for known-size accounts (saves the sysvar read). |
| **`no_allocator!` instead of `default_allocator!`** | low | Tokenizer disables the allocator entirely. Smaller .so, no accidental heap allocs. |
| **Discriminator-zero on close + drain lamports pattern** | low | `close_account` zeros byte 0, transfers lamports, then closes. Defensive against reuse. |
| **`require_token_account` (mint + owner + discriminator check)** | low | One-shot validation of an SPL Token account — reads bytes 0..32 for mint and 32..64 for owner, both labeled. Replaces ad-hoc token-account checks scattered through Novus. |

**Bring as a full swap** (replaces vig's existing copies):

- **`p-core`** — strict superset of vig's current API surface. Swap wholesale.
  Details in §6.3.
- **`p-pyth`** — same shape as vig's, but adds confidence checks, target-expo
  scaling, and stale-price fallback. Details in §6.1.

**Don't bring** (game has no need):

- Compliance ticket / nonce gating (securities-specific)
- Vendored brine ed25519 (only useful if you need on-chain signature verification — not relevant for a game)
- Tokenizer's `p-gov` (SPL Governance helpers — irrelevant unless Novus wants on-chain governance)

---

## 1. The pinocchio 0.9.2 → 0.10.2 jump

This is the gating change. Everything else stacks on top of it.

### 1.1 API renames (whole-program rewrite)

| 0.9.2 (current) | 0.10.2 (tokenizer) |
|---|---|
| `AccountInfo` | `AccountView` |
| `Pubkey` | `Address` |
| `account.key()` | `account.address()` |
| `account.owner()` | `unsafe { account.owner() }` (now unsafe — narrower borrow lifetime) |
| `account.try_borrow_data()` | `account.try_borrow()` |
| `account.try_borrow_mut_data()` | `account.try_borrow_mut()` |
| `program_error::ProgramError` | `error::ProgramError` |
| `pinocchio::instruction::Signer` | `pinocchio::cpi::Signer` |
| `pinocchio::instruction::Seed` | `pinocchio::cpi::Seed` |
| `entrypoint!()` | `program_entrypoint!()` (and call panic_handler + allocator macros explicitly) |
| `default_allocator!()` | `no_allocator!()` is now preferred when you don't malloc |

You can `s/AccountInfo/AccountView/g` etc. for most files, but check call sites — there are subtle behavior differences (e.g., `owner()` is unsafe now because the lifetime is bounded to the borrow window).

### 1.2 New macros in 0.10.2 (used by tokenizer's `lib.rs`)

```rust
use pinocchio::{program_entrypoint, nostd_panic_handler, no_allocator};

program_entrypoint!(process_instruction);
nostd_panic_handler!();
no_allocator!();
```

Note: when we tried `nostd_panic_handler!()` on the throwaway `pow_bench` crate
earlier, current rustc rejected its `#[no_mangle]` annotation on language items.
We worked around it with a manual `#[panic_handler]`. If you hit the same on
your local toolchain, do the same — see the pow_bench history for the pattern.

### 1.3 New dependencies (versions)

```toml
pinocchio = { version = "0.10.2", features = ["cpi"] }
pinocchio-system = "0.5.0"
pinocchio-token = "0.5.0"
pinocchio-associated-token-account = "0.3.0"
pinocchio-log = "0.5.1"

# Compile-time helpers
five8 = "0.1"
five8_const = "0.1"
const-crypto = "0.3.0"

# Direct sha256 syscall (lighter than going through pinocchio)
solana-sha256-hasher = { version = "3.1.0", default-features = false }

# Off-chain digest math (no_std)
sha2 = { version = "0.10.8", default-features = false }

# Optional: native Solana types for compile-time PDA derivation
solana-address = { version = "2.2.0", features = ["curve25519"] }
```

---

## 2. Validation primitives — the biggest practical win

Compare vig-internal's `programs/novus_mundus/src/validation/mod.rs` (87 lines,
silent errors) with tokenizer's `programs/tokenizer/src/validation.rs` (~1150
lines, every error logs expected-vs-got with base58 pubkeys).

### 2.1 The `extract_accounts!` macro

Tokenizer's processors start with **one line** that destructures the
`&[AccountView]` slice with labeled errors:

```rust
// Exact form: rejects too-few and too-many.
extract_accounts!(accounts, exact [
    config,
    operator,
    payer,
    system_program,
]);

// Lenient form: trailing extras allowed; optional rest binding.
extract_accounts!(accounts, [
    round_account,
    asset_account,
    collection,
    payer,
], rest = remaining);
```

On a too-short array it logs `missing account <name> at index <i> (got <n>
accounts)` and returns `NotEnoughAccountKeys`. The macro is ~60 lines in
`programs/tokenizer/src/macros.rs`.

**Why it matters for Novus**: most of your processor files start with manual
account-array destructuring like this (from `hire_units.rs`):

```rust
let (player, owner, player_token_account, novi_mint, game_engine, ...) =
    if accounts.len() >= 9 {
        (&accounts[0], &accounts[1], &accounts[2], ...)
    } else if accounts.len() >= 7 { ... }
    else { return Err(ProgramError::NotEnoughAccountKeys); };
```

That pattern is repeated ~40 times across the codebase and silently fails with
no log on a wrong account count. The macro replaces it everywhere with one
labeled line.

### 2.2 The labeled `require_*` family

Tokenizer's version (paraphrased):

```rust
pub fn require_signer(account: &AccountView, label: &str) -> ProgramResult {
    if unlikely(!account.is_signer()) {
        pinocchio_log::log!("{}: not a signer ({})", label, Pk(account.address().as_array()));
        return Err(TokenizerError::MissingRequiredSignature.into());
    }
    Ok(())
}

pub fn require_owner(account: &AccountView, expected: &Address, label: &str) -> ProgramResult {
    let owner = unsafe { account.owner() };
    if unlikely(owner != expected) {
        pinocchio_log::log!(
            "{}: expected owner {}, got {}",
            label, Pk(expected.as_array()), Pk(owner.as_array())
        );
        return Err(TokenizerError::InvalidAccountOwner.into());
    }
    Ok(())
}
```

Vig-internal's current versions:

```rust
pub fn require_signer(account: &AccountInfo) -> Result<(), ProgramError> {
    if !account.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);  // No log. Good luck debugging.
    }
    Ok(())
}
```

**Migration**: add a `label: &str` parameter to each `require_*` function and a
`pinocchio_log::log!` call on the error path. The cost is negligible (the cold
path is laid out cold by `unlikely`), and devnet debugging gets ~10x easier.

### 2.3 The `require!` / `require_eq!` / `require_keys_eq!` macros

```rust
require!(asset.status == AssetStatus::Active as u8, TokenizerError::AssetNotActive);
require_eq!(round.bump, expected_bump, TokenizerError::InvalidPDA);
require_keys_eq!(&account.owner, &expected_owner, "rally.owner", GameError::Unauthorized);
```

All three use `hint::unlikely` to mark the failure path cold. `require_keys_eq!`
auto-logs both sides on mismatch — invaluable for tracking down PDA derivation
bugs.

### 2.4 One-shot ownership + discriminator + PDA helper

```rust
// programs/tokenizer/src/validation.rs:457
pub fn require_program_pda<F>(
    account: &AccountView,
    program_id: &Address,
    expected_key: AccountKey,
    seeds_no_bump: &[&[u8]],
    extract_bump: F,
    label: &str,
) -> Result<u8, ProgramError>
where F: FnOnce(&[u8]) -> u8
```

Validates **owner + discriminator byte + PDA hash with cached bump** in a
single function call, reading `account.address()` / `account.owner()` exactly
once. Returns the cached bump. The closure pulls the bump byte out of the
account data while the borrow is still active.

This is the single biggest defensive primitive in the tokenizer codebase. It
replaces the three-step "validate owner, then check discriminator, then verify
PDA matches seeds" dance that every Novus processor currently does.

---

## 3. Account discriminator + cached bump pattern

Every tokenizer state account starts with:

```rust
#[repr(C)]
pub struct ProtocolConfig {
    pub account_key: u8,   // AccountKey::ProtocolConfig (discriminator)
    pub version: u8,       // or bump cache, depending on account type
    // ... rest of fields
}
```

Combined with the `AccountKey` enum and `validate_account_key(data, expected)`
helper, this gives **type safety on raw byte buffers**: an attacker can't
substitute a different-but-same-size account because the discriminator byte
won't match.

```rust
#[repr(u8)]
pub enum AccountKey {
    Uninitialized = 0,
    ProtocolConfig = 1,
    Organization = 2,
    Asset = 3,
    // ...
}

pub fn validate_account_key(data: &[u8], expected: AccountKey) -> ProgramResult {
    if data.len() < expected.min_data_len() || data[0] != expected as u8 {
        return Err(InvalidAccountKey.into());
    }
    Ok(())
}
```

**Direct applicability to Novus**: every PDA in your game (PlayerAccount,
EstateAccount, GameEngine, EventAccount, RallyAccount, ...) should have a
discriminator byte. Currently Novus relies entirely on `require_owner` +
account size — which means an attacker who finds two accounts of identical
size and same owner can substitute one for the other and your validators won't
notice.

### 3.1 Compile-time singleton PDAs

```rust
// programs/tokenizer/src/state/mod.rs:48-63
pub const TOKENIZER_PROGRAM_ID: [u8; 32] =
    five8_const::decode_32_const("FNDZziaztYptbydC5UpLEaLMyFN4rDmP3G2MN7o6w4ZK");

pub const PROTOCOL_CONFIG_SEED: &[u8] = b"protocol_config";

const PROTOCOL_CONFIG_PDA: ([u8; 32], u8) =
    const_crypto::ed25519::derive_program_address(
        &[PROTOCOL_CONFIG_SEED],
        &TOKENIZER_PROGRAM_ID,
    );
pub const PROTOCOL_CONFIG_ADDRESS: [u8; 32] = PROTOCOL_CONFIG_PDA.0;
pub const PROTOCOL_CONFIG_BUMP: u8 = PROTOCOL_CONFIG_PDA.1;
```

Then `require_protocol_config_address(account)` is just a 32-byte equality
check — no runtime sha256, no `find_program_address` loop.

**Direct applicability to Novus — but only for true singletons.** A PDA is a
compile-time singleton only when its seeds are fully known at build time
(no per-instance parameter like `kingdom_id` or `owner`).

Auditing the Novus seed table:

| PDA | Seeds | Singleton? |
|---|---|---|
| `GameEngine` | `[GAME_ENGINE_SEED, kingdom_id]` | **No** — multi-kingdom |
| `NoviMint` | `[NOVI_MINT_SEED]` | **Yes** — one mint across all kingdoms |
| `PlayerAccount` | `[PLAYER_SEED, game_engine, owner]` | No |
| `EstateAccount` | `[ESTATE_SEED, player]` | No |
| everything else | parameterized | No |

**The NOVI mint is the one true singleton.** Currently:

```rust
// src/processor/initialization/game_engine.rs:94
let (expected_novi_mint, novi_mint_bump) = pinocchio::pubkey::find_program_address(
    &[NOVI_MINT_SEED],
    program_id,
);
```

— a `find_program_address` call (≈ 1,500 CU × 1–20 iters of curve-checked
bumps until off-curve) on **every** GameEngine init. And the GameEngine struct
currently carries the result as cached state:

```rust
// src/state/game_engine.rs:55-58
pub novi_mint: Pubkey,        // 32 bytes
pub novi_mint_bump: u8,       // 1 byte
pub _padding1: [u8; 7],       // 7 bytes alignment
```

— 40 bytes per kingdom held just to avoid re-deriving.

With compile-time derivation:

```rust
pub const NOVI_MINT_SEED: &[u8] = b"novi_mint";

const NOVI_MINT_PDA: ([u8; 32], u8) =
    const_crypto::ed25519::derive_program_address(
        &[NOVI_MINT_SEED],
        &PROGRAM_ID,  // declare_id! const
    );
pub const NOVI_MINT_ADDRESS: [u8; 32] = NOVI_MINT_PDA.0;
pub const NOVI_MINT_BUMP: u8 = NOVI_MINT_PDA.1;
```

Then:

1. **Init**: skip `find_program_address`; sign with `[NOVI_MINT_SEED, &[NOVI_MINT_BUMP]]` directly. Saves a few thousand CU on each kingdom init (one-time).
2. **Every burn / transfer / mint that touches NOVI**: validate via `account.address().as_array() == &NOVI_MINT_ADDRESS` instead of comparing against the cached `game_engine.novi_mint`. Saves the GameEngine account load *if* that was the only reason the handler was loading it.
3. **GameEngine shrinks by 40 bytes** per kingdom — the `novi_mint`, `novi_mint_bump`, and `_padding1` fields all become removable.
4. **Cross-handler consistency**: every NOVI mint check is now against the same compile-time constant, so a mismatch is impossible across handlers.

The per-handler CU savings are modest (~600 CU per `find_program_address`
avoided) but the **structural win** is bigger: NOVI mint identity becomes a
property of the *program binary*, not of GameEngine state. That removes a
whole class of "did someone pass the wrong mint" bugs at the type level.

Lands as part of Phase 3 (Defense-in-depth), bundled with the broader
account-discriminator work. The 40-byte shrink to GameEngine and the
removal of `novi_mint` / `novi_mint_bump` field references throughout the
codebase touches roughly the same files as the discriminator migration, so
doing both in one sweep is cleaner than two adjacent PRs.

---

## 4. CU optimization patterns

Tokenizer is a CU-hyperaware codebase (RWA programs care about every cycle
since each tx pays real money). Several patterns transfer to Novus directly.

### 4.1 Branch prediction hints

```rust
// programs/tokenizer/src/utils.rs
pub mod hint {
    #[cold]
    #[inline(always)]
    pub const fn cold_path() {}

    #[inline(always)]
    pub const fn unlikely(b: bool) -> bool {
        if b { cold_path(); true } else { false }
    }
}
```

Used everywhere:

```rust
if unlikely(account_owner != expected) {
    pinocchio_log::log!("..."); return Err(...);
}
```

Saves 1-3 CU per call site by laying the success path as fall-through.
Multiplied across every `require_*` in every handler, this adds up to
measurable CU savings.

### 4.2 Hash-only PDA verification

```rust
// Direct sol_sha256 syscall, skip on-curve check.
// Safe whenever the account is already known to be program-owned.
pub fn verify_program_address(
    seeds: &[&[u8]],
    program_id: &Address,
    expected: &Address,
) -> bool
```

Saves ~80-120 CU per call vs `Address::create_program_address`. Tokenizer uses
this for "warm-path" PDA validation — after the first ticket-creating
`find_program_address` call, every subsequent check uses the stored bump and
this fast-path verifier.

### 4.3 Custom `find_bump_for_address`

```rust
pub fn find_bump_for_address(
    seeds: &[&[u8]],
    program_id: &Address,
    expected: &Address,
) -> Result<u8, ProgramError>
```

Different from `find_program_address` — instead of testing whether each
candidate bump produces an off-curve address, it tests whether each candidate
produces the **already-known target address**. Saves ~90 CU per attempted
bump (skips curve validation).

This is a niche but very high-value optimization for any PDA that already
exists by the time you need to find its bump (e.g., during init flows where
you don't pass the bump in).

### 4.4 `rent_exempt_const`

```rust
// programs/tokenizer/src/utils.rs:49
pub const fn rent_exempt_const(space: usize) -> u64 {
    2 * (ACCOUNT_STORAGE_OVERHEAD + space as u64) * DEFAULT_LAMPORTS_PER_BYTE
}
```

`const fn` — compile-time. Skips the `Rent::get()` sysvar read for known-size
accounts.

Includes a SIMD-0194 caveat: when the threshold drops from 2.0 to 1.0, this
calculation will over-fund (harmless) until updated. Worth noting in the
ported version.

### 4.5 `no_allocator!()` (zero heap)

Tokenizer never allocates on the heap. Both `program_entrypoint!()` and
`no_allocator!()` are called explicitly at crate root. Slightly smaller `.so`,
no accidental boxed values.

Migration risk for Novus: any `Vec`, `Box`, `String` etc. in your `no_std`
code will fail to compile after this swap. Most game code shouldn't have
them, but check.

---

## 5. Diagnostic logging

This is the single largest quality-of-life upgrade.

### 5.1 The `Pk` base58 formatter

```rust
// programs/tokenizer/src/utils.rs:56-71
pub(crate) struct Pk<'a>(pub &'a [u8; 32]);

unsafe impl Log for Pk<'_> {
    fn write_with_args(&self, buffer: &mut [MaybeUninit<u8>], _args: &[Argument]) -> usize {
        let mut tmp = [0u8; 44];
        let mut len = 0u8;
        five8::encode_32(self.0, Some(&mut len), &mut tmp);
        // ... copy bytes to buffer
    }
}
```

Then:

```rust
pinocchio_log::log!("token mint: expected {}, got {}", Pk(&expected_mint), Pk(&actual_mint));
```

Outputs a real base58 pubkey in the tx log. Currently in Novus you'd see
`Program failed: InvalidArgument` and have no idea which account failed
which check.

### 5.2 Byte-read helpers

```rust
// programs/tokenizer/src/utils.rs:87-129
pub fn read_u8(data: &[u8], offset: usize, label: &str) -> Result<u8, ProgramError>
pub fn read_u16(data: &[u8], offset: usize, label: &str) -> Result<u16, ProgramError>
pub fn read_u32(data: &[u8], offset: usize, label: &str) -> Result<u32, ProgramError>
pub fn read_u64(data: &[u8], offset: usize, label: &str) -> Result<u64, ProgramError>
pub fn read_i64(data: &[u8], offset: usize, label: &str) -> Result<i64, ProgramError>
pub fn read_bytes32(data: &[u8], offset: usize, label: &str) -> Result<[u8; 32], ProgramError>
pub fn read_len_prefixed<'a>(...) -> Result<(&'a [u8], usize), ProgramError>
pub fn read_token_balance(data: &[u8]) -> Result<u64, ProgramError>
```

All take a label. On failure: `<label>: data too short at offset N (need M,
have K)`. Replaces every `u64::from_le_bytes([data[0], data[1], ...])` pattern
in Novus processors with a one-liner that fails loudly.

### 5.3 Compile-time base58 decode

```rust
pub const PYTH_PROGRAM_ID: [u8; 32] =
    five8_const::decode_32_const("pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT");
```

vs vig-internal's current pattern:

```rust
pub const ID: Pubkey = [
    0xfd, 0x6a, 0x11, 0x5a, 0x69, 0xa1, 0x9d, 0x7c, 0x75, 0x54, 0x9e, 0x38,
    // ... 28 more bytes you have to verify by hand
];
```

The `decode_32_const` version is auditable in code review (you can see the
base58 string and know what address it is) and impossible to typo silently.

### 5.4 Instruction-name logging

Tokenizer's entrypoint logs the instruction name on every dispatch:

```rust
match discriminant {
    0 => { pinocchio_log::log!("ixn: initialize protocol"); processor::protocol::initialize::process(...) },
    1 => { pinocchio_log::log!("ixn: update config"); processor::protocol::update_config::process(...) },
    // ...
}
```

One log line per tx, ~10 CU. Lets you grep tx logs by instruction name
without parsing discriminants. Vig-internal already does similar via
`pinocchio` logging but the consistency in tokenizer is higher.

---

## 6. SDKs to swap in

### 6.1 `p-pyth` — full swap to tokenizer's version

Tokenizer ships `p-pyth` matching the pinocchio 0.10 type surface; vig-internal
ships its own at pinocchio 0.9. **Decision: swap to tokenizer's version
wholesale.** Reasons:

1. **Strict superset of the API vig actually uses.** Audit of vig's call sites:

   | Symbol | Used in |
   |---|---|
   | `PYTH_MAGIC` | `helpers/token_ops.rs` |
   | `OraclePrice` | `helpers/token_ops.rs`, `shop/purchase_novi.rs` |
   | `load_pyth_price_with_confidence` | `helpers/token_ops.rs` |

   All three exist in tokenizer's version with identical names.

2. **Adds three real safety primitives** vig doesn't have today:
   - `OraclePrice::is_confidence_acceptable(max_conf_bps: u16)` — rejects
     prices whose confidence interval exceeds N bps of the price. Critical
     for any path that converts USD → NOVI; a wide-confidence Pyth read
     today silently passes through.
   - `OraclePrice::get_price_in_target_expo(target_expo: i32)` — explicit
     exponent scaling instead of ad-hoc decimal math in each consumer.
   - Pyth fallback chain (current trading → previous trading → stale
     error). Today's code returns "no price" when the current aggregate
     is non-trading even though Pyth itself publishes a `prev_price` for
     exactly this case.

3. **Same diff vs. tokenizer is trivial.** The actual file diff between
   the two versions is the pinocchio 0.10 path rename
   (`program_error::ProgramError` → `error::ProgramError`) plus cosmetic
   comment formatting. The struct layouts and constants are identical.

#### Migration steps

1. Delete vig's `sdks/p-pyth/src/lib.rs` body.
2. Copy `tokenizer/sdks/p-pyth/src/lib.rs` verbatim.
3. Update `programs/novus_mundus/Cargo.toml`:
   ```toml
   # Before
   p-pyth = { path = "../../sdks/p-pyth", features = ["no-panic-handler"] }

   # After (tokenizer's p-pyth still has the no-panic-handler feature for
   # standalone builds, but it's no-op when used as a lib by novus_mundus)
   p-pyth = { path = "../../sdks/p-pyth", features = ["no-panic-handler"] }
   ```
   (Dep line is identical; just the underlying crate is replaced.)
4. The pinocchio 0.10 rename pass picks up the call-site updates naturally
   (`AccountInfo` → `AccountView`, `program_error::` → `error::`).

Lands as part of Phase 1, bundled with the pinocchio bump.

### 6.2 `p-switchboard` — replacement for `switchboard-on-demand` ✅ done

Vig used to depend on `switchboard-on-demand = "0.10.0"` (pinocchio 0.9,
incompatible with the 0.10 bump). Tokenizer's
`sdks/p-switchboard/src/lib.rs` (~200 lines) is now vendored at
`sdks/p-switchboard/`. It:

- Reads the result + std_dev + result_slot from a `PullFeedAccountData`
  account at fixed byte offsets (derived from
  `switchboard-on-demand` v0.11.3 source)
- Validates the 8-byte Anchor discriminator
  (`[196, 27, 108, 196, 10, 215, 219, 40]`)
- Returns staleness errors against the result slot
- Offers `get_price_in_decimals(target_decimals)` for u64 scaling and
  `is_confidence_acceptable(max_std_dev_bps)` for bounded reads

Consumer rewrites: both `helpers/token_ops.rs` and
`processor/shop/purchase_novi.rs` were updated. See the
"Done (Phase 5)" section above for the full account-layout and
oracle-detection changes.

### 6.3 `p-core` — full swap to tokenizer's version

Tokenizer ships `p-core` v0.2.3 at pinocchio 0.10.2; vig-internal currently
ships its own `p-core` v0.1.0 at pinocchio 0.9.2. **Decision: swap to
tokenizer's version wholesale.** Reasons:

1. **Strict superset of the API vig actually uses.** Audit of `programs/novus_mundus/src/`
   shows the only types pulled from `p_core::instructions::*` are:

   | Type | Used in |
   |---|---|
   | `CreateV1`, `DataState` | `hero/mint.rs`, `hero/create_collection.rs` |
   | `CreateCollectionV1` | `hero/create_collection.rs` |
   | `TransferV1` | `dungeon/{claim,enter,flee}.rs`, `expedition/{abort,claim,start}.rs`, `hero/{lock,unlock}.rs`, `rally/process_return.rs` |
   | `UpdatePluginV1`, `PluginUpdateData::AttributesSet` | `hero/level_up.rs`, `sanctuary/claim_meditation.rs` |
   | `AddPluginV1`, `PluginData::Attributes` | `hero/mint.rs` |
   | `BurnV1` | `hero/burn.rs` |

   Every one of those exists in tokenizer's p-core with the same name. No
   API gaps to bridge.

2. **Unlocks features vig will likely want.** Tokenizer's p-core adds
   `CreateV2` (better metadata model), `external_plugin_adapter` (oracle
   plugins, lifecycle hooks — useful for trait-gated NFTs), `compress_v1`
   / `decompress_v1` (compressed NFTs for cheap mass-mints — relevant for
   seasonal events or batch hero drops), `BurnCollectionV1`, full
   `approve_*` / `revoke_*` plugin authority lifecycle.

3. **Cleaner panic-handler story.** Vig's p-core declares its own
   `#[panic_handler]` gated behind a `no-panic-handler` feature flag that
   the consumer must remember to enable. Tokenizer's p-core declares **no**
   panic handler at all — the consumer program owns that responsibility
   exclusively. One less foot-gun.

4. **Maintained by the same pattern as the rest of tokenizer.** Same code
   conventions, same dependency hygiene, same testing setup. Keeping vig's
   own p-core in sync with upstream mpl-core fixes is unmaintained labor
   that nobody is doing.

#### What changes for vig consumers

Most call sites will work after the pinocchio 0.10 mechanical rename. Things
to double-check during migration:

- **Account type**: tokenizer's instruction structs take `&AccountView` (not
  `&AccountInfo`). Same rename pass as the rest of Phase 1.
- **Address type**: any field typed `Pubkey` in vig becomes `Address` in
  tokenizer. Vig already stores addresses as `[u8; 32]` in account state,
  so the change is mostly at function-call boundaries.
- **`declare_id!` macro path**: tokenizer uses
  `pinocchio::address::declare_id!(...)` instead of
  `pinocchio_pubkey::declare_id!(...)`. Same program ID
  (`CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d`), different macro path.
- **No `no-panic-handler` feature**: drop the `features = ["no-panic-handler"]`
  from the `Cargo.toml` dep line. The consumer (`novus_mundus`) already owns
  the panic handler.

#### Migration steps

1. Delete vig's `sdks/p-core/` directory entirely.
2. Copy `tokenizer/sdks/p-core/` into `vig-internal/sdks/p-core/` verbatim.
3. Update `programs/novus_mundus/Cargo.toml`:
   ```toml
   # Before
   p-core = { path = "../../sdks/p-core", features = ["no-panic-handler"] }

   # After
   p-core = { path = "../../sdks/p-core" }
   ```
4. The pinocchio 0.10 rename pass in Phase 1 picks up all the call-site
   updates naturally.

Lands as part of Phase 1 (bundled with the broader pinocchio bump), not
its own PR — the dep edge and the rename are inseparable.

### 6.4 `p-gov` — skip

`sdks/p-gov` is SPL Governance helpers. Game doesn't have governance. Don't
bring.

---

## 7. Concrete file mapping

When you do the migration, here's the suggested touch-list:

### 7.1 Drop-in copies (new files in vig-internal)

| Source (tokenizer) | Destination (vig-internal) | Notes |
|---|---|---|
| `programs/tokenizer/src/macros.rs` | `programs/novus_mundus/src/macros.rs` | `extract_accounts!`, `require!`, `require_eq!`, `require_keys_eq!`. Strip references to `TokenizerError`, point at `GameError` instead. |
| `programs/tokenizer/src/utils.rs` (top half) | `programs/novus_mundus/src/utils/mod.rs` or merge into existing | `hint::unlikely`, `Pk`, `read_*` helpers, `rent_exempt_const`. Drop SPL Token, market-pay, mpl-core helpers (tokenizer-specific). |
| `programs/tokenizer/src/state/mod.rs` (lines 1-140) | `programs/novus_mundus/src/state/mod.rs` (extend) | `AccountKey` enum, `validate_account_key`, compile-time PDA derivation helpers. Rename to match Novus's account types. |

### 7.2 Files to rewrite in place

| File | Change |
|---|---|
| `programs/novus_mundus/src/validation/mod.rs` | Rewrite to match tokenizer's `validation.rs` API: add `label: &str` everywhere, add `unlikely`, add log lines, add `require_program_pda`, `require_pda_with_bump`, `require_protocol_config_address`-equivalent for `GameEngine`. |
| `programs/novus_mundus/src/lib.rs` | Bump to pinocchio 0.10 macros: `program_entrypoint!`, `no_allocator!`, manual panic handler. |
| `programs/novus_mundus/Cargo.toml` | Bump all pinocchio deps to 0.10.x; add `five8`, `five8_const`, `const-crypto`, `solana-sha256-hasher`, `sha2`. |
| `programs/novus_mundus/src/state/*.rs` | Add `account_key: u8` and `bump: u8` as the first two fields of every account struct. Update all `Account::load` helpers to skip those bytes when reading fields. |
| `sdks/p-pyth/src/lib.rs` | Replace with tokenizer's version (after pinocchio bump). |
| `sdks/p-switchboard/` (new) | ✅ done — copied from tokenizer. `switchboard-on-demand` is gone. |

### 7.3 Files to update mechanically (pinocchio 0.9 → 0.10)

Everything in `programs/novus_mundus/src/processor/**/*.rs`. The renames are:
- `AccountInfo` → `AccountView`
- `Pubkey` → `Address`
- `.key()` → `.address()`
- `try_borrow_data` → `try_borrow`
- `try_borrow_mut_data` → `try_borrow_mut`
- `program_error::ProgramError` → `error::ProgramError`
- `pinocchio::instruction::Signer` → `pinocchio::cpi::Signer`

This is mostly mechanical but ~70 files. Recommend a single dedicated branch.

---

## 8. Migration plan (phased)

### Phase 1 — Foundation ✅ **LANDED**

See the "Migration status" section at the top of this doc for the full
list of what landed. Originally estimated 1–2 days; took roughly one
working session of focused regex + targeted edits.

1. ~~New branch: `pinocchio-0.10`.~~ Done directly on the working branch
   alongside other in-progress changes.
2. ~~Bump `pinocchio`, `pinocchio-system`, `pinocchio-token`,
   `pinocchio-associated-token-account` in all workspace `Cargo.toml`s.~~ Done.
3. ~~Add `five8`, `five8_const`, `const-crypto`, `solana-sha256-hasher`, `sha2`
   to `programs/novus_mundus/Cargo.toml`.~~ Done.
4. ~~Bump `sdks/p-core` and `sdks/p-pyth` to pinocchio 0.10 (and update their
   own deps).~~ Done (wholesale-swapped to tokenizer's versions).
5. ~~Mechanical rename pass across `programs/novus_mundus/src/`.~~ Done
   (241 files, ~2,889 matches).
6. ~~Get it to build and pass all existing tests.~~ Builds clean
   (`cargo build-sbf` produces `target/deploy/novus_mundus.so`). Tests
   not yet re-run against the migrated binary.

### Phase 2 — Macros & labels ✅ **LANDED**

1. ✅ `extract_accounts!`, `require!`, `require_eq!`, `require_keys_eq!`
   added to `programs/novus_mundus/src/macros.rs`. Available for new
   processors and new code paths.
2. ✅ Existing `require_*` primitives in `validation/mod.rs` did NOT
   gain a `label: &str` parameter (would have required ~850 call-site
   edits); instead, every primitive now logs a base58-formatted
   diagnostic including the offending account address. Every existing
   call site gains the log for free.
3. ✅ `hint::unlikely` and `cold_path` added to `utils/hint.rs`; every
   `validation/mod.rs` primitive wraps its cold branch in `unlikely`.
   Also retrofitted into `helpers/token_ops.rs` and
   `processor/shop/purchase_novi.rs`.
4. ✅ `Pk` base58 formatter added at `utils/log_format.rs`.
5. ✅ `purchase_novi.rs` and `helpers/token_ops.rs` converted as
   demonstration sites (use `read_u8`/`read_u64`, `unlikely`,
   `pinocchio_log::log!` with `Pk`).
6. **Deferred**: bulk converting the remaining ~850
   processor-side `require_*` call sites to use a `label` parameter.
   This is mechanical but high-volume; the diagnostic upgrade in step 2
   gives most of the value without the churn.

### Phase 3 — Defense-in-depth (3-5 days) ⏳ **Not started**

1. Add `AccountKey` enum.
2. Update every PDA state struct to start with `account_key: u8 + bump: u8`
   (+ alignment padding as needed). **This is a migration** — existing
   on-chain accounts won't have the discriminator byte set, so you need
   either a one-time migration ixn or to gate behind a feature flag for
   newly-initialized accounts only.
3. Replace ad-hoc `require_owner + require_pda` patterns with
   `require_program_pda`.
4. **Compile-time NOVI mint singleton** — `const_crypto` is already in
   `Cargo.toml` from Phase 1; just needs to be wired up. See §3.1 for the
   full design. Side benefit: removes 40 bytes per `GameEngine` (the
   `novi_mint` + `novi_mint_bump` + alignment-padding fields).
5. Adopt `verify_program_address` for warm-path PDA checks.

### Phase 4 — Polish ✅ **LANDED**

1. ✅ ~60 `Rent::minimum_balance(...)` sites switched to
   `Rent::try_minimum_balance(...)?`. The remaining "use
   `rent_exempt_const(SIZE)` to skip the sysvar read" optimization is a
   pure CU improvement, not a warning fix — left for a separate pass.
2. ✅ Hardcoded program-ID byte arrays migrated to
   `five8_const::decode_32_const("...")`:
   `helpers/name_service.rs::TLD_HOUSE_PROGRAM_ID`,
   `processor/initialization/game_engine.rs::BPF_LOADER_UPGRADEABLE_ID`.
   `lib.rs::ID` left as bytes (sourced from the deploy keypair).
3. ✅ Effectively done — `lib.rs` already routes its dispatch logs via
   the local `msg!` macro, which delegates to `pinocchio_log::log!`.
4. ✅ Already done in Phase 1 (`no_allocator!()` is in place).
5. **State struct convention cleanup** (added scope): convert all state
   struct fields from `Address` to `[u8; 32]` (matches tokenizer
   convention), then drop the `copy` feature from pinocchio deps. Shrinks
   the BPF binary slightly and removes the implicit-Copy footgun.
   *Still deferred — touches every state struct.*
6. ✅ Warning count went from 64 → 0 after Phases 2 and 4 work. The
   `cargo fix` suggestions were applied via the actual code edits rather
   than the auto-fixer, because most of them were also functional
   migrations (rename + add `?`).

### Phase 5 — Switchboard restoration ✅ **LANDED**

Done. The Pyth and Switchboard paths now share the same 7-account shape;
`helpers/token_ops.rs::get_switchboard_price` and
`processor/shop/purchase_novi.rs::get_switchboard_price_value` are
deleted. Both paths use the vendored `sdks/p-switchboard` reader.

Key shifts vs. the original plan:
- **Vendored, did not pin upstream.** `switchboard-on-demand` still pins
  pinocchio 0.9; `p-switchboard` is the cleaner long-term path anyway.
- **Owner-based oracle detection**, not data-magic.
  `detect_oracle_type(&AccountView)` reads the feed account's owner
  program and dispatches to Pyth or Switchboard. Adds defense-in-depth
  on top of the existing DAO-pubkey pin.
- **No more queue / slothashes / instructions sysvar accounts.**
  `PullFeedAccountData` carries the result + std_dev + result_slot in
  the feed account itself. SB account count went 10 → 7.
- **SB math now u128 end-to-end.** The pre-migration code routed
  Switchboard's i128 @ 10^18 through Pyth's `OraclePrice { price: i64, … }`
  struct, which silently truncated any price > ~$9. The new
  `calculate_lamports_from_sb` / `calculate_token_amount_from_sb_prices`
  paths skip that and do direct u128 arithmetic.

Open follow-ups in this area:
- ✅ Done — DAO-time Pyth/Switchboard feed validation in
  `create_allowed_token`, `update_allowed_token`, and shop
  `update_config`. New helper `helpers::validate_oracle_feed_at_config`
  checks pubkey-match + owner against `PYTH_PROGRAM_ID` /
  `SWITCHBOARD_PROGRAM_ID` + layout (Pyth: `PythPriceAccount::load`;
  SB: `p_switchboard::validate_discriminator`). Caller pushes the
  feed account(s) as trailing slots after the base required accounts.
  TS SDK builders (`createCreateAllowedTokenInstruction`,
  `createUpdateAllowedTokenInstruction`, `createUpdateConfigInstruction`)
  updated to push these slots. As a side effect, `createUpdateConfigInstruction`
  also got fixed — it was previously missing the `update_flags` byte
  and using `u32` instead of `u16` for `solMaxStalenessSlots`, so the
  Rust processor would reject it as `InvalidInstructionData` before
  this pass.
- Integration test on `litesvm` with a synthetic `PullFeedAccountData`
  (use `p-switchboard`'s `make_test_data` helper as a template).
  *Still TODO.*
- The `subscription.ts` TS SDK still does not push the full 7-account
  token-payment flow; this was pre-existing and not part of the SB scope.

### Phase 6 (optional, not in original plan) — Decommission notes

Once all phases land, consider:
- Removing the `copy` feature from pinocchio deps (after Phase 4 state
  struct cleanup makes `Address` no longer appear in `#[derive(Copy)]` state
  structs)
- Deleting `pinocchio-pubkey` reference from any leftover comments/docs
  (the dep itself is already gone)

---

## 9. Things to be careful about

- **Account migration**: adding `account_key + bump` to existing accounts is
  a real on-chain change. Plan a migration path.
- **Pinocchio breaking changes**: 0.9 → 0.10 has subtle behavior diffs (e.g.,
  `owner()` lifetime). Run the full test suite after the mechanical rename.
- **The `nostd_panic_handler!()` macro bug**: as noted in section 1.2, current
  rustc rejects the macro's `#[no_mangle]` on language items. Use a manual
  `#[panic_handler]` (see the deleted `pow_bench` crate history for the
  pattern, or use the one in `sdks/p-core/src/lib.rs` as a model).
- **`no_allocator!()` blast radius**: if any dep allocates, you'll see linker
  errors. Audit before flipping.
- **`five8_const` requires nightly?**: check toolchain. It uses const eval
  features that might not be on your stable channel. (Tokenizer compiles on
  stable; just verify locally.)
- **SIMD-0194**: the rent threshold change. `rent_exempt_const` over-funds
  after activation (harmless but wasteful). Track and update post-activation.
- **`solana-address` overlap with `pinocchio::Address`**: tokenizer imports
  both (`solana-address` for `create_program_address`, pinocchio's `Address`
  for everything else). They're 32-byte arrays and convert easily, but the
  type system will complain if you mix them carelessly.

---

## 10. What about the compliance gate?

Tokenizer's `verify_compliance_ticket` (~150 lines in `validation.rs`) is an
ed25519-signed-message gate with per-(asset, buyer) replay nonces, domain
separation, and ix-discriminant binding. **It is overkill for a game** and
brings in:

- The vendored brine ed25519 (~3 KB of crypto code, separate audit)
- `ComplianceNonce` PDA + state
- ~15 error codes
- ~80 bytes of trailing instruction data per gated call

The only Novus use case I can imagine for this:

- **Anti-cheat**: server signs that a player legitimately completed an
  off-chain action (e.g., "you killed the dragon"), client submits the
  signed ticket on-chain, on-chain verifies the signature and grants loot.
- **Loot drops / promotions**: a publisher key signs grant tickets that
  redeem on-chain.

If you ever want either, the tokenizer code is excellent template — vendor
the ed25519, copy `verify_compliance_ticket`, rename to fit your domain. But
do not bring it speculatively.

---

## 11. Recommended order of operations

If you want to do this in one sweep:

1. Read this doc fully.
2. Spin off `pinocchio-0.10` branch.
3. Do Phase 1 end-to-end (build green, tests green).
4. Squash, merge to main behind a feature branch or release tag.
5. Do Phase 2 in a separate PR (labels & logging — visually largest diff
   but mechanically simple).
6. Do Phase 3 (account discriminators) as its own focused PR with the
   migration ixn included.
7. Phases 4 and 5 can land whenever.

Total estimated time for a single engineer who knows both codebases:
**6-10 working days**. The pinocchio bump (Phase 1) is the longest single
unit because of the mechanical rename across ~70 files.

---

## 12. Quick reference: the highest-ROI files to read in tokenizer

Skim these in this order to see the patterns in action:

1. `programs/tokenizer/src/lib.rs` — entrypoint shape (pinocchio 0.10
   macros, dispatch table)
2. `programs/tokenizer/src/macros.rs` — `extract_accounts!`, `require_*`
3. `programs/tokenizer/src/utils.rs` — hint, Pk, read_*, rent_exempt_const
4. `programs/tokenizer/src/validation.rs` (lines 36-540) — every `require_*`
   primitive and the compile-time PDA helpers
5. `programs/tokenizer/src/state/mod.rs` — `AccountKey` discriminator
   pattern + compile-time PDA derivation
6. `programs/tokenizer/src/processor/protocol/initialize.rs` — a complete,
   small processor that uses every pattern above
7. `sdks/p-pyth/src/lib.rs` — better Pyth reader
8. `sdks/p-switchboard/src/lib.rs` — lean Switchboard reader

After those, the rest of the codebase is variations on the same themes.
