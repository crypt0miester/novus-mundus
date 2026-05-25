/// Token operations processors
///
/// These processors handle direct token operations:
/// - reserved_to_locked: Transfer Reserved Novi → Locked Novi (one-way, permanent)
/// - withdraw_reserved: Withdraw Reserved Novi to wallet (after 7-day vesting)
///
/// Note: burn_for_locked_novi is DEPRECATED per TOKENOMICS_FLOW.md
pub mod reserved_to_locked;
pub mod withdraw_reserved;
