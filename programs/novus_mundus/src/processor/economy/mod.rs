/// Economy processors - token flow and resource management
///
/// Core economic loop:
/// 1. update_locked_novi: Time-based generation → Locked NOVI (subscription-based)
/// 2. hire_units: Locked NOVI → Units (BURNS tokens)
/// 3. collect_resources: Locked NOVI → Cash (BURNS tokens)
/// 4. purchase_equipment: Cash/Locked NOVI → Equipment
/// 5. transfer_cash: Cash → Teammate (tier-gated, anti-Sybil tracked)

pub mod update_locked_novi;
pub mod hire_units;
pub mod collect_resources;
pub mod purchase_equipment;
pub mod mint_for_prize;
pub mod purchase_stamina;
pub mod transfer_cash;
pub mod vault_transfer;
pub mod deposit_novi;
pub mod treasury_sweep_untracked_novi;
