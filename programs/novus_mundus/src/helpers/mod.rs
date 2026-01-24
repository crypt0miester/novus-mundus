/// Helper modules for common operations
///
/// This module contains reusable helper functions for:
/// - Account operations (close accounts, refund rent)
/// - Token operations (burn, mint, transfer)
/// - Event scoring (leaderboard updates)
/// - Hero buff calculation and leveling
/// - NFT attribute building
/// - Estate building requirements
pub mod account;
pub mod dungeon;
pub mod estate;
pub mod event_scoring;
pub mod hero;
pub mod inventory;
pub mod name_service;
pub mod nft_parser;
pub mod token_ops;

// Re-export commonly used functions
pub use account::close_account;
pub use token_ops::{
    burn_tokens, mint_tokens, process_token_payment_flow, transfer_tokens,
    validate_token_account_owner,
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
pub use inventory::add_to_inventory;

// Name service validation
pub use name_service::{compute_name_hash, get_tld_from_tld_house, validate_and_get_domain_name};
