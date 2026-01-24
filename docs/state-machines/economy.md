# Economy System State Machine

## Overview

The Economy system manages all resource flows including NOVI tokens, cash, materials, and shop purchases. It handles resource generation, transfers, and the subscription/shop systems.

---

## 1. Token States

### NOVI Token States (per player)

| State | Description |
|-------|-------------|
| `Locked` | In-game NOVI, non-transferable |
| `Reserved` | Locked but earmarked for withdrawal |
| `Onchain` | SPL token in wallet |

### Flow Diagram

```
┌────────────────┐  earn_novi     ┌────────────────┐
│                │ ─────────────> │                │
│   (External)   │                │    Locked      │
│                │ <───────────── │                │
└────────────────┘  game actions  └───────┬────────┘
                                          │
                   ┌──────────────────────┼──────────────────────┐
                   │                      │                      │
                   ▼                      ▼                      ▼
           ┌──────────────┐     ┌──────────────┐      ┌──────────────┐
           │   Spend      │     │   Reserve    │      │   Transfer   │
           │  (in-game)   │     │  (withdraw)  │      │  (to player) │
           └──────────────┘     └──────┬───────┘      └──────────────┘
                                       │
                                       ▼
                               ┌──────────────┐
                               │   Reserved   │
                               └──────┬───────┘
                                      │ withdraw_reserved
                                      ▼
                               ┌──────────────┐
                               │   Onchain    │
                               │  (SPL token) │
                               └──────────────┘
```

---

## 2. Locked NOVI Operations

### Earning NOVI
```
Sources:
- Dungeon completion rewards
- Expedition yields
- Rally loot (from encounters)
- Daily login rewards
- Event prizes
- Arena rewards
- Quest completion
```

### Spending NOVI
```
Sinks:
- Building construction/upgrade
- Research costs
- Crafting materials
- Equipment purchases
- Expedition fees
- Subscription fees
- Team creation
- Plot purchases
```

### Transfer (Player to Player)
```
Trigger: transfer_cash
Guards:
  - Sender has sufficient locked_novi
  - Recipient is valid player
  - Daily transfer limit not exceeded
  - Transfer cooldown elapsed
Actions:
  - Deduct from sender.locked_novi
  - Add to recipient.locked_novi
  - Update sender.daily_transfer_count
  - Update sender.daily_transferred
  - Apply transfer fee (burnt)
  - Emit CashTransferred
```

---

## 3. Withdrawal System

### States

| State | Description |
|-------|-------------|
| `Locked` | Normal in-game NOVI |
| `Reserved` | Earmarked for withdrawal |
| `Withdrawn` | Converted to SPL token |

### Transitions

#### Reserve for Withdrawal
```
Trigger: update_locked_novi (negative delta)
Guards:
  - amount <= locked_novi
  - Withdrawal enabled for account
Actions:
  - Deduct from locked_novi
  - Add to reserved_novi
  - Emit NoviReserved
```

#### Execute Withdrawal
```
Trigger: withdraw_reserved
Guards:
  - reserved_novi > 0
  - Withdrawal cooldown elapsed
  - Account not flagged
Actions:
  - Mint SPL tokens to player wallet
  - Clear reserved_novi
  - Emit NoviWithdrawn
```

---

## 4. Cash System

### Cash States

| Location | Description |
|----------|-------------|
| `OnHand` | Available for spending/stealing |
| `InVault` | Protected from theft |

### Vault Operations

#### Deposit to Vault
```
Trigger: vault_transfer (to vault)
Guards:
  - amount <= cash_on_hand
Actions:
  - Deduct from cash_on_hand
  - Add to cash_in_vault
  - Emit VaultDeposit
```

#### Withdraw from Vault
```
Trigger: vault_transfer (from vault)
Guards:
  - amount <= cash_in_vault
Actions:
  - Deduct from cash_in_vault
  - Add to cash_on_hand
  - Emit VaultWithdraw
```

### Cash Generation
```
Trigger: collect_resources (periodic)
Guards:
  - Collection cooldown elapsed
Actions:
  - Calculate base generation from buildings
  - Apply research bonuses
  - Apply hero bonuses
  - Apply subscription multiplier
  - Add to cash_on_hand
  - Emit ResourcesCollected
```

---

## 5. Material System

### Material Tiers

| Tier | Name | Drop Source |
|------|------|-------------|
| 0 | Common | Basic encounters |
| 1 | Uncommon | Mid-tier encounters |
| 2 | Rare | Boss encounters |
| 3 | Epic | Dungeons |
| 4 | Legendary | High-tier dungeons |

### Material Flow
```
┌─────────────┐  loot     ┌─────────────┐  craft    ┌─────────────┐
│  Encounters │ ────────> │   Player    │ ────────> │  Equipment  │
│   Dungeons  │           │  Inventory  │           │   Created   │
└─────────────┘           └─────────────┘           └─────────────┘
```

---

## 6. Shop System

### Purchase Types

| Type | Description |
|------|-------------|
| `Item` | Single item purchase |
| `Bundle` | Package of items |
| `FlashSale` | Time-limited offer |

### Shop Purchase
```
Trigger: purchase_item / purchase_bundle / purchase_flash_sale
Guards:
  - Item/bundle available
  - Sufficient currency (gems/NOVI/cash)
  - Purchase limits not exceeded
  - Flash sale: within time window
Actions:
  - Deduct currency
  - Grant items
  - Update purchase tracking
  - Check milestone progress
  - Emit ShopPurchase
```

### Milestone System
```
Milestones based on total_shop_spent:
- 1,000 NOVI: Tier 1 rewards
- 10,000 NOVI: Tier 2 rewards
- 50,000 NOVI: Tier 3 rewards
- 100,000 NOVI: Tier 4 rewards
- 500,000 NOVI: Tier 5 rewards
```

---

## 7. Unit Hiring

### Unit Tiers

| Tier | Name | Cost Multiplier |
|------|------|-----------------|
| 1 | Recruit | 1× |
| 2 | Veteran | 2.5× |
| 3 | Elite | 6× |

### Hire Units
```
Trigger: hire_units
Guards:
  - Barracks building active
  - Sufficient cash
  - Unit type valid
Actions:
  - Calculate cost with Barracks bonus
  - Deduct cash
  - Add units to player
  - Update networth
  - Emit UnitsHired
```

---

## 8. Equipment Purchase

### Purchase Equipment
```
Trigger: purchase_equipment
Guards:
  - Market building active
  - Equipment type valid
  - Sufficient cash
Actions:
  - Calculate cost with Market discount
  - Deduct cash
  - Add equipment to player
  - Update networth
  - Emit EquipmentPurchased
```

---

## 9. Stamina System

### Stamina States

| Resource | Max | Regen Rate |
|----------|-----|------------|
| Encounter Stamina | 100 base | 1 per 6 min |

### Purchase Stamina
```
Trigger: purchase_stamina
Guards:
  - current_stamina < max_stamina
  - Sufficient gems
Actions:
  - Deduct gems
  - Add stamina (capped at max)
  - Emit StaminaPurchased
```

---

## 10. Networth Calculation

### Formula
```
networth =
  locked_novi +
  cash_on_hand + cash_in_vault +
  (defensive_units × unit_values) +
  (operative_units × unit_values) +
  (weapons × weapon_values) +
  (equipment × equipment_values) +
  (buildings × building_values) +
  (materials × material_values)
```

### Recalculation Triggers
- Unit purchase/loss
- Equipment purchase/loss
- Building completion
- NOVI changes
- Material changes

---

## 11. PlayerAccount Economy Fields

```rust
// NOVI
pub locked_novi: u64,
pub reserved_novi: u64,
pub last_updated_tokens_at: i64,

// Cash
pub cash_on_hand: u64,
pub cash_in_vault: u64,

// Transfer tracking
pub daily_transfer_count: u8,
pub daily_transferred: u64,
pub last_transfer_reset: i64,

// Resources
pub gems: u64,
pub fragments: u64,

// Materials
pub material_common: u64,
pub material_uncommon: u64,
pub material_rare: u64,
pub material_epic: u64,
pub material_legendary: u64,

// Consumables
pub stamina_potions: u8,
pub xp_boosters: u8,
pub loot_boosters: u8,
// ... (11 types total)

// Shop tracking
pub total_shop_spent: u64,
pub milestone_tier: u8,

// Networth
pub networth: u64,
```

---

## 12. Invariants

```
1. locked_novi + reserved_novi = total NOVI in game
2. cash_on_hand + cash_in_vault = total cash
3. Daily transfer limits reset at midnight UTC
4. Reserved NOVI cannot be spent in-game
5. Vault protects cash from PvP theft
6. Networth updated on all asset changes
7. Material tiers 0-4 only
8. Subscription multipliers apply to generation rates
9. Shop milestones are permanent unlocks
10. Flash sales have strict time windows
```
