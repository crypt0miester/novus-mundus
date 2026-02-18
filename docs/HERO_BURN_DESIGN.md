# Hero Supply, Mint Limits & Burn Mechanic

## 1. Tier Simplification

Remove the unused Uncommon tier. Renumber from 6 tiers (0-5 with gap at 1) to 5 clean tiers (0-4).

### Current `tier_from_mint_cost` (6 tiers, gap at 1)

```
0 = Common    (< 0.15 SOL, currently 0.10 SOL)
1 = Uncommon  (0.15 SOL)   ← NO HEROES EXIST AT THIS TIER
2 = Rare      (0.25 SOL)
3 = Epic      (1.0 SOL)
4 = Legendary (5.0 SOL)
5 = Mythic    (10.0 SOL)
```

### New `tier_from_mint_cost` (5 tiers, no gaps)

```rust
pub const fn tier_from_mint_cost(mint_cost_lamports: u64) -> u8 {
    if mint_cost_lamports >= 10_000_000_000 { 4 }      // Mythic    (10+ SOL)
    else if mint_cost_lamports >= 5_000_000_000 { 3 }   // Legendary (5+ SOL)
    else if mint_cost_lamports >= 1_000_000_000 { 2 }   // Epic      (1+ SOL)
    else if mint_cost_lamports >= 250_000_000 { 1 }     // Rare      (0.25+ SOL)
    else { 0 }                                          // Common    (< 0.25 SOL)
}
```

| Tier ID | Name | Mint Cost | Heroes |
|---------|------|-----------|--------|
| 0 | Common | 0.10 SOL | 4 |
| 1 | Rare | 0.25 SOL | 23 |
| 2 | Epic | 1.0 SOL | 36 |
| 3 | Legendary | 5.0 SOL | 8 |
| 4 | Mythic | 10.0+ SOL | 5 |

All references to tier IDs across the codebase must be updated (hero lock location bonuses, fragment bonuses, expedition bonuses, etc.).

---

## 2. Supply Cap Changes

Initial caps are conservative. DAO can increase them over time as demand grows (see section 2.1).

| Tier | Heroes | Current Cap | Initial Cap | Total Supply | Rationale |
|------|--------|-------------|-------------|-------------|-----------|
| Common | 4 | Unlimited | 4,000 | 16,000 | Start small, DAO expands as demand grows. |
| Rare | 23 | 10,000 | 1,000 | 23,000 | 10x reduction. Actually feels rare. |
| Epic | 36 | 1,000 | 500 | 18,000 | Slight reduction. Premium scarcity. |
| Legendary | 8 | 100 | 100 | 800 | Keep as-is. |
| Mythic | 5 | 10-50 | 10-50 | 221 | Keep as-is. |

**Initial capped supply: ~58,000** (down from ~267,000)

**Initial max revenue (if all sell out):**

| Tier | Supply x Cost | Revenue |
|------|--------------|---------|
| Common | 16,000 x 0.10 | 1,600 SOL |
| Rare | 23,000 x 0.25 | 5,750 SOL |
| Epic | 18,000 x 1.0 | 18,000 SOL |
| Legendary | 800 x 5.0 | 4,000 SOL |
| Mythic | 221 x ~10.0 | 2,044 SOL |
| **Total** | | **~31,394 SOL** |

With recyclable supply (burn -> re-mint) and DAO cap increases, lifetime revenue can far exceed this.

### 2.1 DAO Supply Cap Increase (`update_supply_cap`)

New DAO-only instruction to increase the `supply_cap` on a HeroTemplate. The cap can only go **up**, never down (to avoid invalidating existing mints).

**Instruction: 311 (`update supply cap`)**

**Accounts (3):**

| # | Account | Flags | Description |
|---|---------|-------|-------------|
| 0 | dao_authority | signer | DAO authority (must match `game_engine.authority`) |
| 1 | hero_template | writable | HeroTemplate PDA (update supply_cap) |
| 2 | game_engine | | GameEngine PDA (to verify authority) |

**Instruction data:** `[0..2] template_id: u16, [2..6] new_supply_cap: u32`

**Processing Steps:**

1. Validate signer matches `game_engine.authority` (DAO only)
2. Verify template PDA derivation
3. Load template, verify `template.template_id` matches instruction data
4. Verify `new_supply_cap > template.supply_cap` -- can only increase, never decrease
5. Verify `new_supply_cap >= template.minted_count` -- cannot set below already minted
6. Update `template.supply_cap = new_supply_cap`
7. Emit `SupplyCapUpdated` event

```rust
pub struct SupplyCapUpdated {
    pub template_id: u16,
    pub old_cap: u32,
    pub new_cap: u32,
    pub current_minted: u32,
    pub timestamp: i64,
}
```

**Use case:** When a Common hero's 4,000 supply is approaching sell-out, DAO votes to increase to 6,000, then 8,000, etc. This creates FOMO (limited supply) while preserving the ability to expand. Can also be used for any tier -- e.g., increasing a popular Legendary from 100 to 150.

---

## 3. Per-Player Mint Limit (1 Per Template)

### Approach: Zero-Byte Mint Receipt PDA

A 0-data-byte PDA. Its existence on-chain is the proof. No struct, no data — just seeds.

```
Seeds: [b"hero_mint_receipt", player_account.key(), template_id.to_le_bytes()]
```

- **On mint:** Create 0-byte account at PDA. If it already exists -> `HeroAlreadyMintedByPlayer`.
- **On burn:** Close account (transfer rent lamports back to owner).
- **Rent cost:** 0-byte account = 890,880 lamports (~0.00089 SOL). Refunded on burn.

### Existence Check

```rust
// If account has lamports > 0, it exists (player already minted this template)
if mint_receipt.lamports() > 0 {
    return Err(GameError::HeroAlreadyMintedByPlayer.into());
}
```

### Changes to `mint.rs`

- Add account #10: `mint_receipt` (writable, PDA to create)
- Verify PDA derivation matches seeds
- Verify account does not already exist
- After NFT creation: `create_account` with 0 bytes, owner = program_id

### No Migration Needed

Program is not yet deployed on-chain. No existing heroes to grandfather.

---

## 4. Sanctuary Mint Bonus

When minting a hero, players with Sanctuary level 5+ receive locked NOVI as a reward. Treasury still receives full SOL payment -- this is a pure bonus to incentivize investment in the Sanctuary building.

### Bonus Tiers

| Sanctuary Level | Bonus % of mint cost (in NOVI) |
|----------------|-------------------------------|
| 0-4 | 0% (no bonus) |
| 5-9 | 5% |
| 10-14 | 10% |
| 15-19 | 15% |
| 20 | 20% (max) |

### Conversion

Mint cost is in SOL. Convert to NOVI at the fixed shop rate of 10,000 NOVI per SOL, then apply the bonus percentage.

```
bonus_novi = (mint_cost_sol * 10_000) * bonus_pct / 100
```

### Concrete Reward Table (locked NOVI)

| Hero Tier | Mint Cost | Sanc 5 (5%) | Sanc 10 (10%) | Sanc 15 (15%) | Sanc 20 (20%) |
|-----------|-----------|------------|--------------|--------------|--------------|
| Common | 0.10 SOL | 50 | 100 | 150 | 200 |
| Rare | 0.25 SOL | 125 | 250 | 375 | 500 |
| Epic | 1.0 SOL | 500 | 1,000 | 1,500 | 2,000 |
| Legendary | 5.0 SOL | 2,500 | 5,000 | 7,500 | 10,000 |
| Mythic | 10.0 SOL | 5,000 | 10,000 | 15,000 | 20,000 |

### When Players Reach Each Tier

| Sanctuary Level | Cumulative NOVI Cost | Typical Timeline |
|----------------|---------------------|-----------------|
| 5 | ~3.8M | 1-2 weeks |
| 10 | ~467M | 1-3 months |
| 15 | ~55B | 3-6 months |
| 20 | ~39.5T | 6+ months |

The bonus rewards long-term players. A Sanctuary 20 player has invested trillions of NOVI into their estate -- getting 20% of a mint back as locked NOVI is a small thank-you for that commitment.

### Implementation in `mint.rs`

After SOL payment and NFT creation:
1. Load estate account, find Sanctuary building, get its level
2. If level >= 5, calculate bonus NOVI
3. Credit `player.locked_novi += bonus_novi` (soft balance update, no SPL mint needed)

### Additional Account for `mint.rs`

Add account #11: `estate` (readable, EstateAccount PDA) -- needed to check Sanctuary level. Only read if it exists; if player has no estate, bonus is 0.

### On-chain Calculation

```rust
fn calculate_mint_bonus(mint_cost_lamports: u64, sanctuary_level: u8) -> Result<u64, ProgramError> {
    let bonus_pct: u64 = match sanctuary_level {
        0..=4 => 0,
        5..=9 => 5,
        10..=14 => 10,
        15..=19 => 15,
        20.. => 20,
    };
    if bonus_pct == 0 { return Ok(0); }

    // Convert lamports to NOVI: 1 SOL = 10,000 NOVI
    // mint_cost_lamports / 1_000_000_000 * 10_000 = mint_cost_lamports / 100_000
    let novi_equivalent = mint_cost_lamports / 100_000;
    novi_equivalent.checked_mul(bonus_pct)
        .and_then(|v| v.checked_div(100))
        .ok_or(GameError::MathOverflow.into())
}
```

---

## 5. Hero Burn Mechanic

### Instruction: 310 (`burn hero`)

**Accounts (8):**

| # | Account | Flags | Description |
|---|---------|-------|-------------|
| 0 | owner | signer, writable | Player wallet |
| 1 | player_account | writable | PlayerAccount PDA (receives locked NOVI) |
| 2 | hero_asset | writable | Hero NFT (destroyed) |
| 3 | hero_template | writable | HeroTemplate PDA (decrement minted_count) |
| 4 | hero_collection | writable | Hero collection PDA |
| 5 | mint_receipt | writable | 0-byte PDA (closed, rent refunded) |
| 6 | system_program | | System program |
| 7 | p_core_program | | MPL Core program |

**Instruction data:** `[0..2] template_id: u16`

### Processing Steps

1. Validate signer, load PlayerAccount, verify ownership
2. Parse hero NFT via `parse_hero_nft()` -> get level, template_id
3. Verify NFT owner field == `owner.key()` (hero is in wallet, not locked)
4. Verify hero is NOT in `player.active_heroes[0..3]` -> else `HeroIsLocked`
5. Verify `parsed_hero.template_id` matches instruction data and template account
6. Verify template PDA derivation
7. Load template, derive tier via `tier_from_mint_cost(template.mint_cost_sol)`
8. Calculate NOVI reward: `tier_base x level^2`
9. Burn NFT via `p_core::instructions::BurnV1` (owner signs directly)
10. Credit locked NOVI: `player.locked_novi += novi_reward` (non-withdrawable gameplay fuel)
11. Decrement `template.minted_count` via `saturating_sub(1)`
12. Close mint receipt PDA -> transfer rent lamports to owner, zero data, assign to system program
13. Emit `HeroBurned` event

---

## 6. NOVI Burn Reward Formula

```
burn_novi = tier_base x level^2
```

Reward is **locked NOVI** -- non-withdrawable, gameplay fuel only. Cannot be cashed out.

### Tier Base Values

| Tier | ID | Base NOVI | Mint Cost (SOL) | NOVI equiv of mint cost* | Level 1 return |
|------|----|----------|-----------------|------------------------|----------------|
| Common | 0 | 50 | 0.10 | ~1,000 | 5% -- net loss |
| Rare | 1 | 500 | 0.25 | ~2,500 | 20% -- net loss |
| Epic | 2 | 2,000 | 1.0 | ~10,000 | 20% -- net loss |
| Legendary | 3 | 10,000 | 5.0 | ~50,000 | 20% -- net loss |
| Mythic | 4 | 25,000 | 10.0 | ~100,000 | 25% -- net loss |

*At shop rate of ~0.0001 SOL per NOVI (10,000 NOVI/SOL).

### Break-Even Level (burn NOVI >= NOVI equivalent of mint cost)

| Tier | Break-even level^2 | Break-even level |
|------|--------------------|-----------------|
| Common | 1,000 / 50 = 20 | ~5 |
| Rare | 2,500 / 500 = 5 | ~3 |
| Epic | 10,000 / 2,000 = 5 | ~3 |
| Legendary | 50,000 / 10,000 = 5 | ~3 |
| Mythic | 100,000 / 25,000 = 4 | 2 |

Break-even is level 2-4 in NOVI terms. This is acceptable because:
- Player paid **SOL** (real money) and gets back **locked NOVI** (non-withdrawable game currency)
- These are fundamentally different -- you can never convert locked NOVI back to SOL
- The real gate is the SOL cost to mint, not the NOVI return
- Low-level burns still destroy the hero, freeing supply for others and costing another mint fee

### Reward Table (NOVI returned at key levels)

| Level | Common | Rare | Epic | Legendary | Mythic |
|-------|--------|------|------|-----------|--------|
| 1 | 50 | 500 | 2,000 | 10,000 | 25,000 |
| 5 | 1,250 | 12,500 | 50,000 | 250,000 | 625,000 |
| 10 | 5,000 | 50,000 | 200,000 | 1,000,000 | 2,500,000 |
| 25 | 31,250 | 312,500 | 1,250,000 | 6,250,000 | 15,625,000 |
| 50 | 125,000 | 1,250,000 | 5,000,000 | 25,000,000 | 62,500,000 |
| 100 | 500,000 | 5,000,000 | 20,000,000 | 100,000,000 | 250,000,000 |

### On-chain Implementation

```rust
fn calculate_burn_reward(level: u32, tier: u8) -> Result<u64, ProgramError> {
    let tier_base: u64 = match tier {
        0 => 500,       // Common: 50 NOVI (x10 for decimals)
        1 => 5_000,     // Rare: 500 NOVI
        2 => 20_000,    // Epic: 2,000 NOVI
        3 => 100_000,   // Legendary: 10,000 NOVI
        4 => 250_000,   // Mythic: 25,000 NOVI
        _ => 500,       // Default to Common
    };
    let lvl = level.max(1) as u64;
    let level_squared = lvl.checked_mul(lvl).ok_or(GameError::MathOverflow)?;
    tier_base.checked_mul(level_squared).ok_or(GameError::MathOverflow.into())
}
```

Max case: Mythic level 100 = 250,000 x 10,000 = 2,500,000,000 -- fits in u64.

### Design Rationale

- **Quadratic scaling** rewards investment heavily. Level 50 returns 2,500x what level 1 returns.
- **Level 1 burn is always a loss** (10-25% in NOVI terms, 100% in SOL terms). No mint-and-burn farming.
- **High-level burns are meaningful.** Level 25 Legendary = 6.25M locked NOVI for the fragments invested.
- **Locked NOVI only.** Cannot withdraw or sell. Players burn heroes to fuel gameplay, not to cash out.

---

## 7. New Event & Errors

### HeroBurned Event

```rust
pub struct HeroBurned {
    pub hero_mint: Pubkey,
    pub player: Pubkey,
    pub player_name: [u8; 48],
    pub template_id: u16,
    pub hero_level: u32,
    pub tier: u8,
    pub novi_reward: u64,
    pub new_minted_count: u32,
    pub timestamp: i64,
}
```

### New Error Codes

- `HeroAlreadyMintedByPlayer` -- receipt PDA already exists for this player + template
- `HeroIsLocked` -- cannot burn a hero that is locked in an active slot
- `HeroNotOwnedByCaller` -- NFT owner != signer
- `SupplyCapCannotDecrease` -- new supply cap must be greater than current cap

---

## 8. Safety Considerations

**Anti-farming:** Level 1 burn returns 10-25% of mint cost in locked NOVI. SOL is spent, locked NOVI is returned. Always a net loss in real value.

**Locked hero guard:** Burn checks `active_heroes[0..3]`. Prevents phantom buffs remaining on player after hero is destroyed.

**Supply underflow:** `saturating_sub(1)` on `minted_count`. Cannot go below 0.

**Recyclable supply:** Burn decrements `minted_count` -> frees a slot for someone else to mint. Treasury gets another mint fee on re-mint.

**NOVI inflation check:** Worst case Mythic level 100 = 250M locked NOVI. But:
- Fragment cost to reach level 100 is ~5.7 x 10^17 fragments (`10 x 1.5^100`)
- Locked NOVI can only be spent in-game, not withdrawn
- Practical max level is ~50 (Sanctuary level 15+ required for cap of 100)

**Zero-byte receipt:** No data to corrupt. Existence = minted. Closed = can re-mint. Simple and tamper-proof.

---

## 9. Economic Cycle

```
Player A mints Rare hero         ->  0.25 SOL to treasury
Player A levels hero to 25       ->  consumes ~168,000 fragments
Player A burns hero              ->  receives 312,500 locked NOVI
                                 ->  template.minted_count decremented
                                 ->  mint receipt closed (rent refunded)

Player B mints same template     ->  0.25 SOL to treasury (again!)
                                 ->  template.minted_count incremented

Net result:
  Treasury: +0.50 SOL (two mints)
  Locked NOVI: +312,500 (will be burned on gameplay actions)
  Hero supply: back to where it started
```

Each hero template can generate revenue multiple times over through the burn-and-remint cycle.

---

## 10. Files to Modify/Create

| File | Change |
|------|--------|
| `programs/novus_mundus/src/constants.rs` | Add `HERO_MINT_RECEIPT_SEED` |
| `programs/novus_mundus/src/state/hero.rs` | Add `calculate_burn_reward()`, update `tier_from_mint_cost()` to 5 tiers |
| `programs/novus_mundus/src/error.rs` | Add 4 new error codes |
| `programs/novus_mundus/src/processor/hero/mint.rs` | Add 0-byte receipt PDA creation + per-player limit check |
| `programs/novus_mundus/src/processor/hero/burn.rs` | **New file** -- burn processor (instruction 310) |
| `programs/novus_mundus/src/processor/hero/update_supply_cap.rs` | **New file** -- DAO supply cap increase (instruction 311) |
| `programs/novus_mundus/src/processor/hero/mod.rs` | Add `pub mod burn;`, `pub mod update_supply_cap;` |
| `programs/novus_mundus/src/lib.rs` | Add instruction 310 + 311 dispatch |
| `programs/novus_mundus/src/events/` | Add `HeroBurned`, `SupplyCapUpdated` events |
| `sdks/novus-mundus-ts/src/instructions/hero.ts` | Add `createBurnHeroInstruction()`, `createUpdateSupplyCapInstruction()`, update mint instruction |
| `sdks/novus-mundus-ts/src/pda.ts` | Add `deriveHeroMintReceiptPda()` |
| `sdks/novus-mundus-ts/src/events/types.ts` | Add `HeroBurned` event type |
| `sdks/novus-mundus-ts/src/types/enums.ts` | Update tier enum to 5 tiers |
| `sdks/novus-mundus-ts/tests/e2e/09-hero.test.ts` | Add burn + mint limit tests |
| All files referencing old tier IDs | Update tier constants (2->1, 3->2, 4->3, 5->4) |

---

## 11. Tests

Tests are in `sdks/novus-mundus-ts/tests/e2e/09-hero.test.ts`.

### Mint Limit Tests

| Test | Description |
|------|-------------|
| `should reject second mint of same template (per-player limit)` | Mints template 1, verifies receipt PDA exists (0-byte), attempts second mint of template 1 -> `HeroAlreadyMintedByPlayer` |
| `should allow minting different templates` | Mints template 1, then template 2 -> both succeed (different receipt PDAs) |

### Burn Tests

| Test | Description |
|------|-------------|
| `should burn hero and receive locked NOVI` | Mints hero, burns it, verifies NFT destroyed and receipt PDA closed |
| `should reject burning locked hero` | Locks hero in active slot, attempts burn -> `HeroIsLocked` |
| `should allow re-mint after burn` | Mints hero, burns it, re-mints same template -> succeeds (receipt was closed) |
| `should reject burn by non-owner` | Player2 attempts to burn Player1's hero -> `HeroNotOwnedByCaller` |

### Supply Cap Tests

| Test | Description |
|------|-------------|
| `should increase supply cap (DAO)` | DAO authority increases supply cap -> succeeds |
| `should reject supply cap decrease` | Attempts to decrease supply cap -> `SupplyCapCannotDecrease` |
| `should reject supply cap update by non-DAO` | Non-DAO player attempts update -> `DaoRequired` |
