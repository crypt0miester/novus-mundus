# AllowedToken System with Oracle Integration

## Overview

Replace the fake "gems" currency with a flexible token payment system using **dual oracle redundancy** (Pyth + Switchboard). If one oracle is down, client switches to the other.

**Applies to:**
- `purchase_item.rs`
- `purchase_bundle.rs`
- `purchase_flash_sale.rs`

**SDKs:**
- `p-pyth` - Minimal pinocchio-compatible Pyth price reader (sdks/p-pyth)
- `switchboard-on-demand` - Official Switchboard SDK with pinocchio feature

---

## Account Structure

### AllowedTokenAccount

```
PDA: ["allowed_token", game_engine, token_mint]
Lifecycle: CLOSABLE (DAO controls token support)
```

```rust
#[repr(C)]
pub struct AllowedTokenAccount {
    // ===== Token Identity (32 bytes) =====
    pub mint: Pubkey,

    // ===== Dual Oracle Configuration (64 bytes) =====
    pub pyth_feed: Pubkey,                 // Pyth TOKEN/USD price account
    pub switchboard_feed: Pubkey,          // Switchboard TOKEN/USD quote account

    // ===== Pricing Parameters (8 bytes) =====
    pub max_staleness_slots: u16,          // Max age in SLOTS before rejection
    pub confidence_threshold_bps: u16,     // Max confidence interval (Pyth only)
    pub discount_bps: u16,                 // Discount for using this token
    pub _padding: [u8; 2],

    // ===== Reserved + Bump (16 bytes) =====
    pub _reserved: [u8; 15],
    pub bump: u8,
}
// Total: 120 bytes
```

### ShopConfigAccount Addition

```rust
pub struct ShopConfigAccount {
    // ... existing fields ...

    // ===== SOL Oracle (64 bytes) =====
    pub sol_pyth_feed: Pubkey,             // Pyth SOL/USD feed
    pub sol_switchboard_feed: Pubkey,      // Switchboard SOL/USD feed
}
```

### Treasury ATA (Computed)

No storage needed. Derived at runtime:

```rust
fn get_treasury_token_ata(treasury_wallet: &Pubkey, mint: &Pubkey) -> Pubkey {
    get_associated_token_address(treasury_wallet, mint)
}
```

All token payments go to the treasury's ATA for that mint.

---

## Oracle Implementations

### Pyth (via p-pyth crate)

**Key characteristics:**
- Staleness is **SLOT-BASED** (not seconds)
- Has confidence interval (`conf`) for price uncertainty
- Simple account structure - just load and validate

**PythPriceAccount structure (240 bytes header):**
```rust
// From p-pyth crate
pub struct PythPriceAccount {
    pub magic: u32,           // 0xa1b2c3d4
    pub ver: u32,             // Must be 2
    pub atype: u32,           // 3 = Price account
    // ... header fields ...
    pub expo: i32,            // Price exponent
    pub timestamp: i64,       // Unix timestamp
    pub prev_slot: u64,       // Previous valid slot
    pub prev_price: i64,      // Previous price
    pub prev_conf: u64,       // Previous confidence
    pub prev_timestamp: i64,  // Previous timestamp
    pub agg: PriceInfo,       // Current aggregate
}

pub struct PriceInfo {
    pub price: i64,           // The price
    pub conf: u64,            // Confidence interval
    pub status: u8,           // 1 = Trading
    pub pub_slot: u64,        // Slot when published
}
```

**Usage:**
```rust
use p_pyth::{PythPriceAccount, OraclePrice};

fn get_pyth_price(
    pyth_account: &AccountInfo,
    current_slot: u64,
    max_staleness_slots: u64,
    max_confidence_bps: u16,
) -> Result<OraclePrice, ProgramError> {
    let data = pyth_account.try_borrow_data()?;
    let price_account = unsafe { PythPriceAccount::load(&data)? };

    let price = price_account
        .get_price_no_older_than(current_slot, max_staleness_slots)
        .ok_or(GameError::OraclePriceStale)?;

    // Check confidence
    if !price.is_confidence_acceptable(max_confidence_bps) {
        return Err(GameError::OracleConfidenceTooWide.into());
    }

    Ok(price)
}
```

**Accounts needed (Pyth):**
- Pyth price feed account
- Clock sysvar (for current_slot)

---

### Switchboard (via switchboard-on-demand crate)

**Key characteristics:**
- Staleness is **SLOT-BASED** (`max_age` parameter)
- Uses `QuoteVerifier` builder pattern for validation
- Requires additional sysvars for verification
- No confidence interval (different trust model)

**Usage:**
```rust
use switchboard_on_demand::{QuoteVerifier, get_slot};

fn get_switchboard_price(
    quote_account: &AccountInfo,
    queue_account: &AccountInfo,
    slothashes_sysvar: &AccountInfo,
    instructions_sysvar: &AccountInfo,
    clock_sysvar: &AccountInfo,
    max_staleness_slots: u64,
) -> Result<i128, ProgramError> {
    let slot = get_slot(clock_sysvar);

    let quote_data = QuoteVerifier::new()
        .slothash_sysvar(slothashes_sysvar)
        .ix_sysvar(instructions_sysvar)
        .clock_slot(slot)
        .queue(queue_account)
        .max_age(max_staleness_slots as u32)
        .verify_account(quote_account)
        .map_err(|_| GameError::OracleUnavailable)?;

    // Get first feed's value
    let feed = quote_data.feeds().first()
        .ok_or(GameError::OracleUnavailable)?;

    Ok(feed.value())
}
```

**Accounts needed (Switchboard):**
- Switchboard quote account
- Switchboard queue account
- SlotHashes sysvar
- Instructions sysvar
- Clock sysvar

---

## Oracle Redundancy Strategy

### Per-Transaction Choice

Each `AllowedTokenAccount` stores **both** Pyth and Switchboard feed addresses, but only **one oracle system** is used per transaction. The client chooses which oracle to use based on availability.

**Why this approach:**
- Simpler account layout (fewer accounts per tx)
- Lower compute units
- Client can switch oracles if one is down
- Both feeds stored so switching doesn't require on-chain update

### Detection Logic

The program detects which oracle is being used based on account structure:

```rust
enum OracleType {
    Pyth,
    Switchboard,
}

fn detect_oracle_type(oracle_account: &AccountInfo) -> Result<OracleType, ProgramError> {
    let data = oracle_account.try_borrow_data()?;

    // Pyth accounts start with magic number 0xa1b2c3d4
    if data.len() >= 4 {
        let magic = u32::from_le_bytes([data[0], data[1], data[2], data[3]]);
        if magic == 0xa1b2c3d4 {
            return Ok(OracleType::Pyth);
        }
    }

    // Otherwise assume Switchboard
    Ok(OracleType::Switchboard)
}
```

### Client Fallback

When Pyth is down, client switches to Switchboard accounts:

```
Pyth available?     Client action
─────────────────────────────────────────────────────
Yes                 Pass Pyth feed accounts
No                  Pass Switchboard feed accounts
```

If the chosen oracle fails validation (stale price, etc.), the transaction is rejected. The client should then retry with the other oracle.

---

## Price Normalization

Both oracles return prices with exponents. We need to normalize for calculation.

### Pyth Price Format

```
price: i64, expo: i32
Real price = price × 10^expo

Example: price = 15023, expo = -2
Real price = 15023 × 10^(-2) = $150.23
```

### Switchboard Price Format

```
value: i128 (already scaled, typically 10^9 precision)
Check feed documentation for exact scaling
```

### Normalized Output

```rust
pub struct OraclePrice {
    pub price: i64,        // Raw price
    pub conf: u64,         // Confidence (0 for Switchboard)
    pub expo: i32,         // Exponent
    pub publish_time: i64, // Unix timestamp
}
```

---

## Price Calculation Flow

### Step 1: Get SOL/USD Price (Pyth path)

```rust
let sol_price = get_pyth_price(
    sol_pyth_feed,
    current_slot,
    shop_config.sol_max_staleness_slots as u64,
    100, // 1% confidence for SOL
)?;
```

### Step 1: Get SOL/USD Price (Switchboard path)

```rust
let sol_price = get_switchboard_price(
    sol_sb_quote,
    switchboard_queue,
    slothashes_sysvar,
    instructions_sysvar,
    clock_sysvar,
    shop_config.sol_max_staleness_slots as u64,
)?;
```

### Step 2: Get TOKEN/USD Price (Pyth path)

```rust
let token_price = get_pyth_price(
    token_pyth_feed,
    current_slot,
    allowed_token.max_staleness_slots as u64,
    allowed_token.confidence_threshold_bps,
)?;
```

### Step 2: Get TOKEN/USD Price (Switchboard path)

```rust
let token_price = get_switchboard_price(
    token_sb_quote,
    switchboard_queue,  // Same queue as SOL
    slothashes_sysvar,
    instructions_sysvar,
    clock_sysvar,
    allowed_token.max_staleness_slots as u64,
)?;
```

### Step 3: Read Token Decimals

```rust
let mint_data = token_mint.try_borrow_data()?;
let token_decimals = mint_data[44]; // Mint decimals at offset 44
```

### Step 4: Calculate Token Amount

```rust
// Normalize prices to same exponent
let sol_usd = normalize_price(&sol_price, -9)?;   // To lamport precision
let token_usd = normalize_price(&token_price, -9)?;

// token_amount = (item_sol_price * sol_usd) / token_usd
// Adjusted for token decimals
let token_amount = calculate_token_amount(
    item_price_lamports,
    sol_usd,
    token_usd,
    token_decimals,
)?;
```

### Step 5: Apply Token Discount

```rust
let discounted_amount = apply_bp_penalty(token_amount, allowed_token.discount_bps)?;
```

### Step 6: Transfer to Treasury

```rust
let treasury_ata = get_associated_token_address(
    &game_engine.treasury_wallet,
    &allowed_token.mint,
);

spl_token_transfer(
    buyer_token_ata,
    treasury_ata,
    discounted_amount,
    buyer,
    token_program,
)?;
```

---

## Account Layouts

### purchase_item

#### SOL Payment (existing)

```
[0]  buyer                 (signer, writable)
[1]  player                (writable)
[2]  game_engine           ()
[3]  shop_config           ()
[4]  shop_item             (writable)
[5]  player_purchase       (writable, optional)
[6]  sol_treasury          (writable)
[7]  system_program        ()
[8]  inventory             (writable)
[9]  estate                ()
```

#### Token Payment with Pyth Oracle

```
[10] allowed_token          () - AllowedTokenAccount PDA
[11] token_mint             () - For decimals
[12] buyer_token_ata        (writable)
[13] treasury_token_ata     (writable)
[14] token_program          ()
[15] clock_sysvar           () - For current slot
[16] sol_pyth_feed          () - SOL/USD Pyth price account
[17] token_pyth_feed        () - TOKEN/USD Pyth price account
```

#### Token Payment with Switchboard Oracle

```
[10] allowed_token          () - AllowedTokenAccount PDA
[11] token_mint             () - For decimals
[12] buyer_token_ata        (writable)
[13] treasury_token_ata     (writable)
[14] token_program          ()
[15] clock_sysvar           () - For current slot
[16] sol_sb_quote           () - SOL/USD Switchboard quote
[17] token_sb_quote         () - TOKEN/USD Switchboard quote
[18] switchboard_queue      () - Switchboard queue account
[19] slothashes_sysvar      () - For Switchboard verification
[20] instructions_sysvar    () - For Switchboard verification
```

---

### purchase_bundle

#### SOL Payment (existing)

```
[0]  buyer                 (signer, writable)
[1]  player                (writable)
[2]  game_engine           ()
[3]  shop_config           ()
[4]  shop_bundle           (writable)
[5]  player_purchase       (writable, optional)
[6]  sol_treasury          (writable)
[7]  system_program        ()
[8]  inventory             (writable)
[9]  estate                ()
```

#### Token Payment with Pyth Oracle

```
[10] allowed_token          () - AllowedTokenAccount PDA
[11] token_mint             () - For decimals
[12] buyer_token_ata        (writable)
[13] treasury_token_ata     (writable)
[14] token_program          ()
[15] clock_sysvar           () - For current slot
[16] sol_pyth_feed          () - SOL/USD Pyth price account
[17] token_pyth_feed        () - TOKEN/USD Pyth price account
```

#### Token Payment with Switchboard Oracle

```
[10] allowed_token          () - AllowedTokenAccount PDA
[11] token_mint             () - For decimals
[12] buyer_token_ata        (writable)
[13] treasury_token_ata     (writable)
[14] token_program          ()
[15] clock_sysvar           () - For current slot
[16] sol_sb_quote           () - SOL/USD Switchboard quote
[17] token_sb_quote         () - TOKEN/USD Switchboard quote
[18] switchboard_queue      () - Switchboard queue account
[19] slothashes_sysvar      () - For Switchboard verification
[20] instructions_sysvar    () - For Switchboard verification
```

---

### purchase_flash_sale

#### SOL Payment (existing)

```
[0]  buyer                 (signer, writable)
[1]  player                (writable)
[2]  game_engine           ()
[3]  shop_config           ()
[4]  flash_sale            (writable)
[5]  player_purchase       (writable, optional)
[6]  sol_treasury          (writable)
[7]  system_program        ()
[8]  inventory             (writable)
[9]  estate                ()
```

#### Token Payment with Pyth Oracle

```
[10] allowed_token          () - AllowedTokenAccount PDA
[11] token_mint             () - For decimals
[12] buyer_token_ata        (writable)
[13] treasury_token_ata     (writable)
[14] token_program          ()
[15] clock_sysvar           () - For current slot
[16] sol_pyth_feed          () - SOL/USD Pyth price account
[17] token_pyth_feed        () - TOKEN/USD Pyth price account
```

#### Token Payment with Switchboard Oracle

```
[10] allowed_token          () - AllowedTokenAccount PDA
[11] token_mint             () - For decimals
[12] buyer_token_ata        (writable)
[13] treasury_token_ata     (writable)
[14] token_program          ()
[15] clock_sysvar           () - For current slot
[16] sol_sb_quote           () - SOL/USD Switchboard quote
[17] token_sb_quote         () - TOKEN/USD Switchboard quote
[18] switchboard_queue      () - Switchboard queue account
[19] slothashes_sysvar      () - For Switchboard verification
[20] instructions_sysvar    () - For Switchboard verification
```

### Payment Detection Logic

Payment type is determined by whether `token_mint` account is passed:

```rust
// Check if token payment is requested (token_mint passed)
let is_token_payment = token_mint.key() != &system_program::ID
    && token_mint.data_len() > 0;

if is_token_payment {
    // Token payment requested - allowed_token MUST exist
    if allowed_token.data_len() == 0 || allowed_token.owner() != program_id {
        return Err(GameError::TokenNotAllowed.into());
    }

    // Token Payment - detect oracle type from sol_oracle account
    let sol_oracle = &accounts[16];
    match detect_oracle_type(sol_oracle)? {
        OracleType::Pyth => {
            process_token_payment_pyth(
                allowed_token,
                token_mint,
                buyer_token_ata,
                treasury_token_ata,
                token_program,
                clock_sysvar,
                sol_pyth_feed,      // [16]
                token_pyth_feed,    // [17]
                ...
            )?;
        }
        OracleType::Switchboard => {
            process_token_payment_switchboard(
                allowed_token,
                token_mint,
                buyer_token_ata,
                treasury_token_ata,
                token_program,
                clock_sysvar,
                sol_sb_quote,       // [16]
                token_sb_quote,     // [17]
                switchboard_queue,  // [18]
                slothashes_sysvar,  // [19]
                instructions_sysvar,// [20]
                ...
            )?;
        }
    }
} else {
    // SOL Payment - use existing flow
    process_sol_payment(buyer, sol_treasury, final_price)?;
}
```

**Key behaviors:**
- If `token_mint` is passed but `allowed_token` doesn't exist → **REJECT** with `TokenNotAllowed`
- If `token_mint` is not passed → SOL payment
- If `token_mint` is passed and `allowed_token` exists → Token payment via oracle

---

## Staleness Configuration

**IMPORTANT: Both oracles use SLOT-BASED staleness, not seconds!**

1 slot ≈ 400ms, so:
- 30 slots ≈ 12 seconds
- 75 slots ≈ 30 seconds
- 150 slots ≈ 60 seconds

### Recommended Values

| Token Type | max_staleness_slots | confidence_threshold_bps |
|------------|---------------------|--------------------------|
| SOL        | 75 (30 sec)         | 100 (1%)                 |
| Stablecoins| 150 (60 sec)        | 50 (0.5%)                |
| Major tokens| 75 (30 sec)        | 200 (2%)                 |
| Minor tokens| 150 (60 sec)       | 500 (5%)                 |

---

## Example Configurations

### USDC

```rust
AllowedTokenAccount {
    mint: USDC_MINT,
    pyth_feed: USDC_USD_PYTH,
    switchboard_feed: USDC_USD_SWITCHBOARD,
    max_staleness_slots: 150,              // 60 seconds
    confidence_threshold_bps: 50,          // 0.5% - tight for stablecoin
    discount_bps: 0,                       // No discount
}
```

### BONK

```rust
AllowedTokenAccount {
    mint: BONK_MINT,
    pyth_feed: BONK_USD_PYTH,
    switchboard_feed: BONK_USD_SWITCHBOARD,
    max_staleness_slots: 75,               // 30 seconds
    confidence_threshold_bps: 300,         // 3% - volatile token
    discount_bps: 500,                     // 5% off for BONK users
}
```

### Partner Token

```rust
AllowedTokenAccount {
    mint: PARTNER_MINT,
    pyth_feed: PARTNER_USD_PYTH,
    switchboard_feed: PARTNER_USD_SWITCHBOARD,
    max_staleness_slots: 150,
    confidence_threshold_bps: 500,
    discount_bps: 2000,                    // 20% partner discount!
}
```

---

## New Processors

All allowed_token processors require `game_engine.authority` (DAO) as signer.

---

### create_allowed_token.rs

**Purpose:** DAO creates a new AllowedTokenAccount to whitelist a token for payment.

**Accounts:**

```
[0]  authority              (signer, writable) - game_engine.authority (DAO)
[1]  game_engine            () - For authority verification
[2]  allowed_token          (writable) - PDA to create
[3]  token_mint             () - The SPL token mint being allowed
[4]  system_program         ()
```

**Instruction Data:**

```rust
pub struct CreateAllowedTokenData {
    pub pyth_feed: Pubkey,              // Pyth TOKEN/USD price feed
    pub switchboard_feed: Pubkey,       // Switchboard TOKEN/USD quote account
    pub max_staleness_slots: u16,       // Max age in slots
    pub confidence_threshold_bps: u16,  // Pyth confidence threshold
    pub discount_bps: u16,              // Discount for using this token
}
```

**Validation:**

```rust
// 1. Verify authority is game_engine.authority
if authority.key() != &game_engine.authority {
    return Err(GameError::UnauthorizedAuthority.into());
}

// 2. Derive and verify PDA
let (expected_pda, bump) = Pubkey::find_program_address(
    &[ALLOWED_TOKEN_SEED, game_engine.key().as_ref(), token_mint.key().as_ref()],
    program_id,
);

// 3. Verify token_mint is a valid SPL mint (check data length)
if token_mint.data_len() != 82 {  // SPL Mint is 82 bytes
    return Err(GameError::InvalidMint.into());
}

// 4. Create account and initialize
```

---

### update_allowed_token.rs

**Purpose:** DAO updates an existing AllowedTokenAccount (feeds, staleness, discount).

**Accounts:**

```
[0]  authority              (signer) - game_engine.authority (DAO)
[1]  game_engine            () - For authority verification
[2]  allowed_token          (writable) - Existing AllowedTokenAccount
```

**Instruction Data:**

```rust
pub struct UpdateAllowedTokenData {
    pub field: AllowedTokenUpdateField,
}

pub enum AllowedTokenUpdateField {
    PythFeed(Pubkey),
    SwitchboardFeed(Pubkey),
    MaxStalenessSlots(u16),
    ConfidenceThresholdBps(u16),
    DiscountBps(u16),
}
```

**Validation:**

```rust
// 1. Verify authority is game_engine.authority
if authority.key() != &game_engine.authority {
    return Err(GameError::UnauthorizedAuthority.into());
}

// 2. Verify allowed_token is owned by program
if allowed_token.owner() != program_id {
    return Err(ProgramError::IllegalOwner);
}

// 3. Update the specified field
```

---

### close_allowed_token.rs

**Purpose:** DAO removes token support, closes account, returns rent to authority.

**Accounts:**

```
[0]  authority              (signer, writable) - game_engine.authority (DAO), receives rent
[1]  game_engine            () - For authority verification
[2]  allowed_token          (writable) - AllowedTokenAccount to close
```

**Instruction Data:** None

**Validation:**

```rust
// 1. Verify authority is game_engine.authority
if authority.key() != &game_engine.authority {
    return Err(GameError::UnauthorizedAuthority.into());
}

// 2. Verify allowed_token is owned by program
if allowed_token.owner() != program_id {
    return Err(ProgramError::IllegalOwner);
}

// 3. Transfer lamports to authority
let lamports = allowed_token.lamports();
**allowed_token.try_borrow_mut_lamports()? = 0;
**authority.try_borrow_mut_lamports()? += lamports;

// 4. Zero out data and assign to system program
allowed_token.assign(&system_program::ID);
```

---

### Processor Summary Table

| File | Signer | Purpose |
|------|--------|---------|
| `create_allowed_token.rs` | `game_engine.authority` | DAO whitelists token with oracle feeds |
| `update_allowed_token.rs` | `game_engine.authority` | DAO updates feeds/staleness/discount |
| `close_allowed_token.rs` | `game_engine.authority` | DAO removes token support, rent returned |

---

## What Gets Removed (Gems)

### ShopItemAccount
- `price_gems` field

### ShopBundleAccount
- `price_gems` field (if exists)

### create_item.rs
- `price_gems` parsing from instruction data

### create_bundle.rs
- `price_gems` parsing from instruction data

### update_item.rs
- `PriceGems` update field

### update_bundle.rs
- `PriceGems` update field

### purchase_item.rs
- Gem payment branch
- All gem deduction logic

### purchase_bundle.rs
- Gem payment branch
- All gem deduction logic

### purchase_flash_sale.rs
- Gem payment branch (if exists)
- All gem deduction logic

---

## Discount Stacking

Token discount becomes **Layer 0** (first applied):

```
Layer 0: Token Discount       (from AllowedTokenAccount.discount_bps)
Layer 1: Base Discount        (daily deal, weekly sale)
Layer 2: Bundle Discount      (n/a for items)
Layer 3: Fib Discount         (multi-purchase same day)
Layer 4: Subscription         (tier-based)
Layer 5: Milestone            (lifetime spending)
Layer 6: Loyalty Streak       (consecutive days)
Layer 7: Market Building      (estate bonus)

Final enforced by: max_total_discount_bps
```

---

## Constants

```rust
// Seeds
pub const ALLOWED_TOKEN_SEED: &[u8] = b"allowed_token";

// Pyth constants (from p-pyth crate)
pub const PYTH_MAGIC: u32 = 0xa1b2c3d4;
pub const PYTH_VERSION: u32 = 2;
pub const PYTH_PRICE_ACCOUNT_TYPE: u32 = 3;
pub const PRICE_STATUS_TRADING: u8 = 1;

// Well-known SOL/USD feeds (mainnet)
// Pyth SOL/USD: H6ARHf6YXhGYeQfUzQNGk6rDNnLBQKrenN712K4AQJEG
// Switchboard SOL/USD: GvDMxPzN1sCj7L26YDK2HnMRXEQmQ2aemov8YBtPS7vR
```

---

## Visual Flow

Applies to: `purchase_item`, `purchase_bundle`, `purchase_flash_sale`

```
┌──────────────────────────────────────────────────────────────────┐
│                        PURCHASE FLOW                             │
└──────────────────────────────────────────────────────────────────┘

  ┌─────────┐     ┌──────────────────┐     ┌─────────────────────┐
  │  Buyer  │────▶│  purchase_*      │────▶│  token_mint passed? │
  └─────────┘     └──────────────────┘     └──────────┬──────────┘
                                                      │
                         ┌────────────────────────────┴────────────┐
                         │ NO                                      │ YES
                         ▼                                         ▼
              ┌──────────────────┐                      ┌──────────────────┐
              │   SOL Payment    │                      │  allowed_token   │
              │   Direct Transfer│                      │  exists?         │
              └────────┬─────────┘                      └────────┬─────────┘
                       │                                         │
                       │                       ┌─────────────────┴─────────────────┐
                       │                       │ NO                                │ YES
                       │                       ▼                                   ▼
                       │            ┌──────────────────┐             ┌──────────────────┐
                       │            │  REJECT TX       │             │  Detect Oracle   │
                       │            │  TokenNotAllowed │             │  (Pyth or SB)    │
                       │            └──────────────────┘             └────────┬─────────┘
                       │                                                      │
                       │                                                      ▼
                       │                                           ┌──────────────────┐
                       │                                           │  Get SOL/USD     │
                       │                                           │  Get TOKEN/USD   │
                       │                                           └────────┬─────────┘
                       │                                                    │
                       │                                                    ▼
                       │                                           ┌──────────────────┐
                       │                                           │  Read Decimals   │
                       │                                           │  from Mint       │
                       │                                           └────────┬─────────┘
                       │                                                    │
                       │                                                    ▼
                       │                                           ┌──────────────────┐
                       │                                           │ Calculate Amount │
                       │                                           │ SOL_USD/TKN_USD  │
                       │                                           └────────┬─────────┘
                       │                                                    │
                       │                                                    ▼
                       │                                           ┌──────────────────┐
                       │                                           │  Apply Discount  │
                       │                                           │  (Layer 0)       │
                       │                                           └────────┬─────────┘
                       │                                                    │
                       │                                                    ▼
                       │                                           ┌──────────────────┐
                       │                                           │ Transfer Tokens  │
                       │                                           │ → Treasury ATA   │
                       │                                           └────────┬─────────┘
                       │                                                    │
                       └────────────────────┬───────────────────────────────┘
                                            │
                                            ▼
                                 ┌──────────────────┐
                                 │  Fulfill Items   │
                                 │  Update Player   │
                                 │  Emit Event      │
                                 └──────────────────┘
```

---

## Dependencies

Add to `programs/novus_mundus/Cargo.toml`:

```toml
[dependencies]
p-pyth = { path = "../../sdks/p-pyth", features = ["no-panic-handler"] }
switchboard-on-demand = { version = "0.10.0", features = ["pinocchio", "devnet"] }
```
