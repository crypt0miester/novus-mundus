pub mod assign_defensive;
pub mod burn;
/// Hero system instructions
///
/// This module contains all hero-related instruction processors:
/// - create_collection: Initialize hero NFT collection (DAO only)
/// - create_template: DAO-only template creation
/// - mint: Mint new hero NFTs (SOL payment)
/// - lock: Lock hero to player account
/// - unlock: Unlock hero from player account
/// - level_up: Level up hero with fragments
/// - assign_defensive: Set defensive hero slot
pub mod create_collection;
pub mod create_template;
pub mod level_up;
pub mod lock;
pub mod mint;
pub mod unlock;
pub mod update_supply_cap;
pub mod use_ability;
