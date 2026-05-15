# Refactor worklist: `extract_accounts!` + `read_*` helper adoption

Audit of `programs/novus_mundus/src/processor/**` for two heavily under-used
helpers. Catalogued for a future refactor session — **nothing here is done yet**
except where marked DONE.

## The problem

| Helper | Defined in | Current adoption |
|--------|-----------|------------------|
| `extract_accounts!` macro | `src/macros.rs:68` | **0 files** — zero adoption |
| `read_*` helpers | `src/utils/io.rs` | 5 files only |

Across the processor tree:
- **~58 files** use raw `&accounts[N]` indexing — can panic if a separate
  `accounts.len() < N` guard is ever miscounted or dropped.
- **~109 files** use `let [a, b, ...] = accounts else { return Err(...) }` —
  safe (no panic) but every short-account error is the same generic
  `NotEnoughAccountKeys` with no indication of *which* account is missing.
- **~89 files** hand-roll `u64::from_le_bytes([data[1], data[2], ...])` or raw
  scalar `instruction_data[N]` reads, usually paired with a manual
  `if instruction_data.len() < N` guard.

## The helpers

### `extract_accounts!` — `src/macros.rs:68`

Destructures `&[AccountView]` into named bindings; on a short list it logs
`missing account <name> at index <i> (got <n> accounts)` and returns
`NotEnoughAccountKeys`.

```rust
// Lenient — extra trailing accounts allowed:
extract_accounts!(accounts, [buyer, player, game_engine, treasury]);

// Lenient + bind the variadic tail:
extract_accounts!(accounts, [castle, attacker, game_engine], rest = garrison_accounts);

// Exact — rejects extras with `unexpected extra accounts: expected N, got M`:
extract_accounts!(accounts, exact [authority, game_engine, allowed_token]);
```

Replaces: `let x = &accounts[0];`, `if accounts.len() < N { return Err(...) }`,
and `let [a, b, ...] = accounts else { return Err(...) };`.

### `read_*` — `src/utils/io.rs`

Each bounds-checks its own slice and logs `<label>: data too short at offset N
(need M, have K)` on failure. Re-exported from `crate::utils`.

```rust
read_u8(data, offset, label)      -> Result<u8,  ProgramError>
read_u16(data, offset, label)     -> Result<u16, ProgramError>
read_u32(data, offset, label)     -> Result<u32, ProgramError>
read_u64(data, offset, label)     -> Result<u64, ProgramError>
read_i64(data, offset, label)     -> Result<i64, ProgramError>
read_bytes32(data, offset, label) -> Result<[u8; 32], ProgramError>
read_len_prefixed(data, offset, label)  // length-prefixed slice
```

Replaces `u64::from_le_bytes([...])`, `u32::from_le_bytes(d[o..o+4].try_into().unwrap())`,
raw scalar `data[N]` reads, and `<[u8;32]>::try_from(&d[o..o+32])`.

## Refactor recipes

**Account extraction — raw indexing → macro:**
```rust
// BEFORE
if accounts.len() < 6 { return Err(ProgramError::NotEnoughAccountKeys); }
let king_wallet      = &accounts[0];
let king_account     = &accounts[1];
let castle_account   = &accounts[2];
// ...

// AFTER
extract_accounts!(accounts, [king_wallet, king_account, castle_account, /* ... */]);
```

**Account extraction — let-else → macro** (gains per-account labeled errors):
```rust
// BEFORE
let [player, owner, game_engine] = accounts else {
    return Err(ProgramError::NotEnoughAccountKeys);
};
// AFTER
extract_accounts!(accounts, exact [player, owner, game_engine]);
```

**Byte reading — `from_le_bytes` → `read_*`:**
```rust
// BEFORE
if instruction_data.len() < 49 { return Err(ProgramError::InvalidInstructionData); }
castle.king_novi_per_day = u64::from_le_bytes([
    instruction_data[1], instruction_data[2], /* ...6 more... */
]);
// AFTER  (read_u64 bounds-checks per field — the upfront len guard is now redundant)
castle.king_novi_per_day = read_u64(instruction_data, 1, "king_novi")?;
```

A worked example landed this session in `castle/update_castle_config.rs`
(`CONFIG_REWARD_RATES` / `CONFIG_TIER_MULTIPLIER` / `CONFIG_TREASURY_LEVEL`).

## Gotchas

- **`read_*` makes the upfront `if data.len() < N` guard redundant** — each read
  bounds-checks. Delete the guard; the per-read error is strictly more precise.
- **Partial writes are safe.** If a mid-function `read_*?` fails after earlier
  fields were already written to an account, the whole transaction fails and
  rolls back — no partial state persists.
- **Variadic / optional tails** → use the lenient form with `rest = name`.
  Files with `&accounts[N..]` slices or `accounts.get(N)` optionals
  (combat, rally/execute, travel, expedition, shop `purchase_*`) need the tail
  logic kept *after* the `extract_accounts!` call.
- **`combat/attack_encounter.rs`** dispatches on `match accounts.len()` across
  4 arms (6/8/9/11 accounts) — refactor carefully; the macro handles the fixed
  prefix, the arms handle the optional groups.
- **`initialization/batch_cities.rs`** has a true variadic `&accounts[2..2+count]`
  slice plus a trailing account — `extract_accounts!(..., rest = tail)` then
  split `tail`.
- **Partly DONE files** (byte reading migrated, account extraction still raw):
  `shop/purchase_novi.rs`, `shop/create_allowed_token.rs`,
  `shop/update_allowed_token.rs`, `shop/update_config.rs`,
  `castle/update_castle_config.rs`. `shop/common.rs` has no `process` — N/A.

## Priority legend

- **HIGH** — raw `&accounts[N]` indexing (panic risk). ~58 files.
- **MEDIUM** — `let [...] = accounts else` destructure (safe, unlabeled), or
  a handful of manual byte reads.
- **LOW** — only a couple of byte reads, clean account handling.
- **DONE** — already using the helper.

---

## Worklist by subsystem

### arena/ (7 files)
| File | Account extraction | Byte reading | Priority |
|------|--------------------|--------------|----------|
| challenge_player.rs | raw `&accounts[0..13]` (14), manual len guard | 3× from_le_bytes (u64,i64,u32) | HIGH |
| claim_daily_reward.rs | `let [...] else` (8) | 1× from_le_bytes (u32) | MEDIUM |
| claim_master_reward.rs | `let [...] else` (8) | 1× from_le_bytes (u32) | MEDIUM |
| close_season.rs | `let [...] else` (3) | 2× from_le_bytes (u32,u16) | MEDIUM |
| create_season.rs | `let [...] else` (4) | 4× from_le_bytes + raw u8 | MEDIUM |
| join_season.rs | `let [...] else` (6) | 1× from_le_bytes (u32) | MEDIUM |
| update_loadout.rs | `let [...] else` (2) | 6× from_le_bytes (u64) + 32B copy | MEDIUM |

### castle/ (22 files) — highest-impact directory
20 files use raw `&accounts[N]` indexing with separate len guards → all HIGH.
| File | Notes |
|------|-------|
| appoint_court.rs | raw `&accounts[0..5]`; raw `instruction_data[0]` u8 |
| attack_castle.rs | raw `&accounts[0..3]` + `&accounts[4..]` rest tail; raw u8 |
| cancel_upgrade.rs | raw `&accounts[0..6]` |
| claim_castle_rewards.rs | raw `&accounts[0..9]` + optional `[5]/[10]/[11]` |
| claim_garrison_loot.rs | raw `&accounts[0..3]` |
| claim_vacant_castle.rs | raw `&accounts[0..3]`; 2× from_le_bytes (u16) |
| complete_upgrade.rs | raw `&accounts[0..1]` |
| court_cleanup.rs | raw `&accounts[0..4]`; raw u8 |
| create_castle.rs | raw `&accounts[0..4]`; 5× from_le_bytes + raw u8s |
| dismiss_court.rs | raw `&accounts[0..5]`; raw u8 |
| finalize_transition.rs | raw `&accounts[0..3]` + optional `[4]`; 2× from_le_bytes (u16) |
| force_remove_king.rs | raw `&accounts[0..4]`; 2× from_le_bytes (u16) |
| garrison_cleanup.rs | raw `&accounts[0..4]` + optional `[5..9]` |
| initiate_upgrade.rs | raw `&accounts[0..5]`; raw u8 |
| join_garrison.rs | raw `&accounts[0..4]` + optional `[5..8]`; 6× from_le_bytes (u64) |
| leave_garrison.rs | raw `&accounts[0..4]` + optional `[5..9]` |
| relieve_garrison.rs | raw `&accounts[0..5]` + optional `[6..10]` |
| resign_court.rs | raw `&accounts[0..4]` |
| rewards_cleanup.rs | raw `&accounts[0..4]` |
| update_castle_status.rs | raw `&accounts[0..1]` |
| update_castle_config.rs | **byte reads DONE**; account extraction still raw `&accounts[0..2]`; `config_type` + `CONFIG_NAME` guard still manual — MEDIUM |

### combat/ (2 files) — both HIGH, structurally involved
| File | Account extraction | Byte reading |
|------|--------------------|--------------|
| attack_encounter.rs | raw indexing via 4-arm `match accounts.len()` (6/8/9/11) | 1× from_le_bytes (u64) |
| attack_player.rs | raw `&accounts[0..7]` + tiered optional `[8..11]` | raw `data[0]` u8 |

### dungeon/ (11 files)
| File | Account extraction | Byte reading | Priority |
|------|--------------------|--------------|----------|
| attack.rs | `let [...] else` (6) | raw `data[0]` + guarded `get` | LOW |
| attack_multi.rs | delegates to attack:: | raw `data[0]` u8 | LOW |
| choose_relic.rs | `let [...] else` (6) | 5× raw u8 + get | MEDIUM |
| claim.rs | raw `&accounts[0..6]` + `get(7)` | none | HIGH |
| claim_leaderboard_prize.rs | `let [...] else` (7) | 2× from_le_bytes (u16) | MEDIUM |
| create_leaderboard.rs | `let [...] else` (5) | 3× from_le_bytes | MEDIUM |
| create_template.rs | `let [...] else` (4) | ~25× from_le_bytes incl. loop | MEDIUM |
| enter.rs | raw `&accounts[0..8]` (9) | 1× from_le_bytes (u16) + raw u8s | HIGH |
| flee.rs | raw `&accounts[0..6]` (7) | none | HIGH |
| interact.rs | `let [...] else` (6) | 1× from_le_bytes + raw u8 | LOW |
| resume.rs | `let [...] else` (4) | raw `data[0]` u8 | LOW |

### economy/ (8 files)
| File | Account extraction | Byte reading | Priority |
|------|--------------------|--------------|----------|
| collect_resources.rs | raw `&accounts[0..9]` via len else-chain | 1× from_le_bytes + raw u8 | HIGH |
| hire_units.rs | raw `&accounts[0..8]` via len else-chain | raw u8 + 1× from_le_bytes (u64) | HIGH |
| purchase_equipment.rs | raw `&accounts[0..5]` via len else-chain | raw u8s + 1× from_le_bytes | HIGH |
| mint_for_prize.rs | `let [...] else` (6) | 1× from_le_bytes + raw u8 | MEDIUM |
| purchase_stamina.rs | `let [...] else` (6) | 1× from_le_bytes (u64) | MEDIUM |
| transfer_cash.rs | `let [...] else` (6) | 2× from_le_bytes (u64) | MEDIUM |
| update_locked_novi.rs | `let [...] else` (8) | none | MEDIUM |
| vault_transfer.rs | `let [...] else` (4) | raw u8 + 1× from_le_bytes (u64) | MEDIUM |

The 3 HIGH files use a `if len >= N { .. } else { .. }` chain to pick optional
event accounts — maps to the lenient form + `rest`.

### encounter/ (1 file)
| File | Account extraction | Byte reading | Priority |
|------|--------------------|--------------|----------|
| spawn.rs | `let [...] else` (10) | 2× from_le_bytes (i32) + raw u8 | MEDIUM |

### estate/ (10 files) — all MEDIUM
build, buy_plot, complete, convert_materials, create, daily_activity, daily_claim,
recover_troops, speedup, upgrade. All `let [...] else` (3–7 accounts);
`daily_activity.rs` additionally has an `accounts.get(6..8)` optional tail.
Most have 1–2 manual byte reads (`read_u8`/`read_u16`/`read_u64`).

### event/ (4 files) — all MEDIUM
| File | Notes |
|------|-------|
| claim_prize.rs | raw `&accounts[0..9]` + optional `[10]` (guarded — not panicking, but move to macro) |
| create.rs | `let [...] else` (5); heaviest byte parsing — 5× from_le_bytes + 5 raw u8 + name |
| finalize.rs | `let [a] else` (1) |
| join.rs | `let [...] else` (6) |

### expedition/ (5 files) — all HIGH
abort, claim, speedup, start, strike. Every file uses raw `&accounts[N]`
indexing behind an upfront len guard; abort/claim/start also have optional
hero-account tails via more raw indexing → textbook `rest =` cases.
`start.rs` also has 3× from_le_bytes (u64) + 2 raw u8.

### forge/ (5 files) — all MEDIUM
abandon_craft, equip, initialize, start_craft, strike. All `let [...] else`
(3–7 accounts). `equip.rs` + `start_craft.rs` have a manual `len()<2` + 2 raw u8.

### hero/ (9 files) — all MEDIUM
assign_defensive, burn, create_collection, create_template, level_up, lock,
mint, unlock, update_supply_cap. All `let [...] else` (2–12 accounts — large
lists suit `exact`). `create_template.rs` has the heaviest byte parsing
(73-byte layout, ~7× from_le_bytes incl. a loop).

### initialization/ (9 files)
| File | Account extraction | Priority |
|------|--------------------|----------|
| append_terrain.rs | raw `&accounts[0..2]` | HIGH |
| set_terrain.rs | raw `&accounts[0..2]` | HIGH |
| batch_cities.rs | raw `&accounts[0/1]` + variadic `&accounts[2..2+count]` + trailing | HIGH |
| city.rs | `let [...] else` (4); heavy f64/i64 from_le_bytes | MEDIUM |
| close_registration.rs | `let [...] else` (2) | MEDIUM |
| game_engine.rs | `let [...] else` (8); 3× from_le_bytes | MEDIUM |
| player.rs | `let [...] else` (11); 3× from_le_bytes | MEDIUM |
| update_game_config.rs | `let [...] else` (2); 1× from_le_bytes (u16) | MEDIUM |
| user.rs | `let [...] else` (8) | MEDIUM |

### loot/ (1 file)
| File | Account extraction | Priority |
|------|--------------------|----------|
| claim.rs | `let [...] else` (6) | MEDIUM |

### name/ (6 files) — easiest uniform batch
remove_player, remove_team, set_player, set_team, update_player, update_team.
Every file: `let [...] else` (8–15 accounts) + manual `data.len()<32/64` check
feeding raw `data[..N].try_into()` → `extract_accounts! exact` + `read_bytes32`.
Identical substitution across all 6.

### progression/ (1 file)
| File | Account extraction | Priority |
|------|--------------------|----------|
| claim_daily_reward.rs | `let [...] else` (3) | MEDIUM |

### rally/ (8 files)
| File | Account extraction | Byte reading | Priority |
|------|--------------------|--------------|----------|
| create.rs | raw `&accounts[0..8]` + optional `[9],[10]` | 8× from_le_bytes + 32B copy + 2 raw u8 | HIGH |
| execute.rs | raw `&accounts[0..4]` + variadic + garrison tail | none | HIGH |
| join.rs | raw `&accounts[0..7]` + optional `[8],[9]` | 7× from_le_bytes (u64) + raw u8 | HIGH |
| process_return.rs | raw `&accounts[0..8]` + optional `[8..11]` | none | HIGH |
| cancel.rs | `let [...] else` (5) | none | MEDIUM |
| close_rally.rs | `let [...] else` (2) | none | MEDIUM |
| leave.rs | `let [...] else` (7) | none | MEDIUM |
| speedup.rs | `let [...] else` (5) | 2× raw u8 | MEDIUM |

### reinforcement/ (6 files)
| File | Account extraction | Byte reading | Priority |
|------|--------------------|--------------|----------|
| send.rs | raw `&accounts[0..8]` + `get(9)` | 7× from_le_bytes (u64) + raw u8 | HIGH |
| process_return.rs | raw `&accounts[0..4]` | none | HIGH |
| process_arrival.rs | `let [...] else` (2) | none | MEDIUM |
| recall.rs | `let [...] else` (6) | none | MEDIUM |
| relieve.rs | `let [...] else` (6) | none | MEDIUM |
| speedup.rs | `let [...] else` (4) | raw u8 | MEDIUM |

### research/ (8 files)
| File | Account extraction | Byte reading | Priority |
|------|--------------------|--------------|----------|
| ascend.rs | `let [...] else` (5) | raw u8 | MEDIUM |
| cancel_research.rs | `let [...] else` (4) | none | MEDIUM |
| complete_research.rs | `let [...] else` (4) | none | MEDIUM |
| create_progress.rs | `let [...] else` (5) | none | MEDIUM |
| initialize_template.rs | `let [...] else` (4) | 4× from_le_bytes + 6 raw u8 | MEDIUM |
| speed_up_research.rs | `let [...] else` (4) | 1× from_le_bytes (u64) | LOW |
| start_research.rs | `let [...] else` (9) | raw u8 | MEDIUM |
| update_template.rs | `let [...] else` (3) | 4× from_le_bytes + 5 raw u8 | MEDIUM |

### sanctuary/ (3 files) — all MEDIUM
claim_meditation (9 accts), speedup_meditation (2), start_meditation (5).
All `let [...] else`; the latter two have a single raw `instruction_data[0]` u8.

### shop/ (21 files)
| File | Account extraction | Priority |
|------|--------------------|----------|
| close_sale.rs | raw `&accounts[0..3]` + `[4]` | HIGH |
| purchase_bundle.rs | raw `&accounts[0..8]` + rest tail `[9..]` | HIGH |
| purchase_flash_sale.rs | raw `&accounts[0..9]` + token tail | HIGH |
| purchase_item.rs | raw `&accounts[0..9]` + tails + `.get()` optionals | HIGH |
| purchase_novi.rs | raw `&accounts[0..8]` + oracle tail (**bytes DONE**) | HIGH (accts only) |
| create_allowed_token.rs | raw `&accounts[0..4]` + feed tail (**bytes DONE**) | MEDIUM |
| update_allowed_token.rs | raw `&accounts[0..3]` + feed slot (**bytes DONE**) | MEDIUM |
| update_config.rs | raw `&accounts[0..2]` + feed slots (**bytes DONE**) | MEDIUM |
| activate_sale.rs | `let [...] else` (3); raw u8 + from_le_bytes | MEDIUM |
| close_allowed_token.rs | `let [...] else` (4) | MEDIUM |
| create_bundle / create_daily_deal / create_dao_promotion / create_flash_sale / create_item / create_seasonal_sale / create_weekly_sale / initialize_config / rotate_daily_deal / update_bundle / update_item | `let [...] else`; byte-heavy `create_*` only | LOW |
| common.rs | no `process` | DONE (N/A) |

### subscription/ (3 files)
| File | Account extraction | Priority |
|------|--------------------|----------|
| purchase.rs | `let [...] else` (10) + raw `&accounts[10]`/`[11..]` token tail | HIGH |
| downgrade_expired.rs | `let [a] else` (1) | MEDIUM |
| update_tier.rs | `let [...] else` (2); raw u8 | MEDIUM |

### team/ (22 files) — most uniform; single highest-volume win
accept_invite, cancel_invite, create, decline_invite, demote_member,
deposit_treasury, disband, invite, join, kick_member, leave, promote_member,
set_motd, transfer_leadership, treasury_approve_request, treasury_cancel_request,
treasury_execute_request, treasury_reject_request, treasury_request_withdraw,
update_settings, update_treasury_settings, withdraw_treasury.
**Every file**: `let [...] else` (3–9 accounts) + the standard `team_id` (u64) +
`slot_index` (u16) header via `from_le_bytes`. All MEDIUM, all the same shape —
`extract_accounts! exact` + `read_u64`/`read_u16`. Do as one batch.

### token/ (2 files) — both MEDIUM
reserved_to_locked, withdraw_reserved. Each `let [...] else` (7–8 accounts) +
one `amount` u64 read via an explicit 8-element byte array → `read_u64`.

### travel/ (8 files)
| File | Account extraction | Priority |
|------|--------------------|----------|
| intercity_complete.rs | raw `&accounts[0..4]` + hero-pair tail | HIGH |
| intercity_start.rs | raw `&accounts[0..9]` + `get(10)` | HIGH |
| intercity_teleport.rs | raw `&accounts[0..8]` + hero-pair tail | HIGH |
| intracity_start.rs | raw `&accounts[0..8]` + `get(9)` | HIGH |
| intercity_cancel / intracity_cancel / intracity_complete / speedup | `let [...] else` | MEDIUM |

---

## Suggested execution order

1. **HIGH tier, simple** — castle/ (20 files, repetitive raw-index pattern),
   expedition/ (5), the HIGH dungeon/economy/reinforcement files. Removes the
   panic-risk surface fastest.
2. **HIGH tier, variadic** — combat/ (2, the `match accounts.len()` one needs
   care), rally/{create,execute,join,process_return}, shop/purchase_*,
   travel/*_start, initialization/batch_cities. Keep the tail logic after the
   macro call.
3. **Uniform batches** — name/ (6 identical), team/ (22 identical). High volume,
   lowest risk, mechanical.
4. **MEDIUM let-else** — everything else; convert to `extract_accounts! exact`.
5. **Byte-only LOW** — shop `create_*`/`update_*`, research templates.

After each subdir: `cargo check -p novus_mundus`, then `cargo build-sbf` and run
the e2e suite (`bun test tests/e2e/`) before moving on — the macro changes error
codes from generic `NotEnoughAccountKeys` to the same code with a log line, and
`read_*` changes short-buffer errors to `InvalidInstructionData` (usually
identical to what the manual guard returned — verify any `expectTransactionToFail`
tests that assert specific error codes).

## Aggregate

~58 HIGH (raw `&accounts[N]`), ~109 MEDIUM (`let [...] else`), ~6 LOW.
5 files have byte reading already DONE. `extract_accounts!` adoption: 0 files —
the entire processor tree is a candidate.
