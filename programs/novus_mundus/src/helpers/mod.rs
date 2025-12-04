/// Helper modules for common operations
///
/// This module contains reusable helper functions for:
/// - Account operations (close accounts, refund rent)
/// - Token operations (burn, mint, transfer)
/// - Event scoring (leaderboard updates)
/// - Hero buff calculation and leveling
/// - NFT attribute building

pub mod account;
pub mod token_ops;
pub mod event_scoring;
pub mod hero;
pub mod inventory;
pub mod name_service;

// Re-export commonly used functions
pub use account::close_account;
pub use token_ops::{burn_tokens, mint_tokens, transfer_tokens};

// Hero helpers (Deterministic System)
pub use hero::{
    // Buff delta operations (efficient single-hero updates)
    add_hero_buffs_to_player,
    subtract_hero_buffs_from_player,
    add_buff_delta_to_player,
    // Level-up
    update_hero_power_on_level_up,
    // NFT attribute building
    HeroNftContext,
    HeroNftBuffers,
    build_hero_nft_attributes,
    compute_buff_values,
};

// Inventory helpers (auto-create and expand)
pub use inventory::add_to_inventory;

// Name service validation
pub use name_service::{
    validate_and_get_domain_name,
    get_domain_name,
    get_tld_from_tld_house,
    compute_name_hash,
    hashv,
    TLD_HOUSE_PROGRAM_ID,
    HASH_PREFIX,
};
