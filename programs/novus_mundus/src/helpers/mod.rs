/// Helper modules for common operations
///
/// This module contains reusable helper functions for:
/// - Account operations (close accounts, refund rent)
/// - Token operations (burn, mint, transfer)
/// - Event scoring (leaderboard updates)
/// - Hero buff calculation and leveling
/// - NFT attribute building
/// - Estate building requirements
/// - Kingdom validation (cross-kingdom checks)
pub mod account;
pub mod dungeon;
pub mod estate;
pub mod event_scoring;
pub mod hero;
pub mod inventory;
pub mod kingdom;
pub mod name_service;
pub mod nft_parser;
pub mod token_ops;

// Re-export commonly used functions
pub use account::close_account;
pub use token_ops::{
    burn_tokens, mint_tokens, process_token_payment_flow, transfer_tokens,
    validate_token_account_owner,
    // Oracle helpers
    detect_oracle_type, read_pyth_price, read_token_decimals, require_pyth_feed_configured,
    sb_feed_value, scale_ratio, verify_switchboard_quote,
    OracleType, ZERO_PUBKEY,
};

// Hero helpers (NFT-Only System)
pub use hero::{
    // Buff delta for level-up (efficient single-hero updates)
    add_buff_delta_to_player,
    // Buff operations with location synergy
    add_hero_buffs_to_player_with_location,
    build_hero_nft_attributes,
    clear_hero_buffs,
    subtract_hero_buffs_from_player_with_location,
    HeroNftBuffers,
    // NFT attribute building
    HeroNftContext,
};

// NFT attribute parsing (NFT-Only System - all hero state from NFT)
pub use nft_parser::parse_hero_nft;

// Inventory helpers (auto-create and expand)
pub use inventory::{add_to_inventory, is_inventory_item_type};

// Name service validation
pub use name_service::{compute_name_hash, get_tld_from_tld_house, validate_and_get_domain_name};

// Kingdom validation helpers (will be used in integration tests and future cross-entity validation)
#[allow(unused_imports)]
pub use kingdom::{
    validate_player_kingdom,
    validate_same_kingdom,
    validate_entity_kingdom,
    validate_city_kingdom,
    validate_group_membership,
    validate_all_same_kingdom,
};
