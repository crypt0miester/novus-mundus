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
pub mod token_ops;
pub mod event_scoring;
pub mod hero;
pub mod inventory;
pub mod name_service;
pub mod estate;
pub mod nft_parser;

// Re-export commonly used functions
pub use account::close_account;
pub use token_ops::{burn_tokens, mint_tokens, transfer_tokens};

// Hero helpers (NFT-Only System)
pub use hero::{
    // Buff operations with location synergy
    add_hero_buffs_to_player_with_location,
    subtract_hero_buffs_from_player_with_location,
    clear_hero_buffs,
    // Buff delta for level-up (efficient single-hero updates)
    add_buff_delta_to_player,
    // NFT attribute building
    HeroNftContext,
    HeroNftBuffers,
    build_hero_nft_attributes,
};

// NFT attribute parsing (NFT-Only System - all hero state from NFT)
pub use nft_parser::parse_hero_nft;

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

// Estate building requirement helpers
pub use estate::{
    // Core requirement validation
    require_building,
    has_building,
    has_building_at_level,
    // Specific building requirements
    require_mansion,
    require_barracks,
    require_workshop,
    require_vault,
    require_dock,
    require_forge,
    require_market,
    require_academy,
    require_arena,
    require_sanctuary,
    require_observatory,
    require_treasury,
    require_citadel,
    // Unit/research requirements
    required_barracks_level_for_unit,
    required_academy_level_for_research,
    // Hero management
    max_locked_heroes_for_sanctuary_level,
    can_lock_hero,
    max_hero_level_for_sanctuary,
    hero_level_cap,
    // Building bonuses
    vault_novi_cap_bonus_bps,
    vault_transfer_bonus_bps,
    market_discount_bps,
    forge_success_bonus_bps,
    can_craft_quality_tier,
    arena_pvp_damage_bps,
    treasury_prize_bonus_bps,
    citadel_rally_capacity_bps,
    citadel_rally_damage_bps,
    observatory_loot_bonus_bps,
    academy_research_speed_bps,
    // Academy mastery system (φ-based formulas)
    get_academy_levels,
    get_academy_mastery,
    academy_mastery_speed_bonus_bps,
    academy_mastery_cost_discount_bps,
    academy_daily_time_reduction,
    ascension_mastery_cost,
    // Sanctuary meditation system (φ-based formulas)
    meditation_xp_for_level,
    sanctuary_meditation_max_hours,
    sanctuary_meditation_max_seconds,
    sanctuary_meditation_xp_per_hour,
    sanctuary_meditation_total_xp,
    meditation_level_cap,
    meditation_levels_from_xp,
    can_gain_meditation_levels,
    get_sanctuary_level,
    can_meditate,
};

