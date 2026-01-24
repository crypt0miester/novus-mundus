//! Dungeon System Processors - The Catacombs Roguelike PvE
//!
//! Instructions:
//! - 250: enter_dungeon - Start a dungeon run, transfer champion hero to escrow
//! - 251: attack_room - Deal damage once (auto-advances on kill)
//! - 252: attack_room_multi - Deal 1-5 attacks in single tx (auto-advances on kill)
//! - 253: interact_room - Interact with non-combat rooms (treasure, camp, rest)
//! - 254: choose_relic - Select relic between floors
//! - 255: flee_dungeon - Exit early with partial rewards
//! - 256: claim_rewards - Finish run and collect rewards
//! - 257: resume_from_checkpoint - Continue from last checkpoint after failure
//! - 258: create_template - DAO instruction to create dungeon templates
//! - 259: claim_leaderboard_prize - Claim weekly leaderboard prize
//! - 260: create_leaderboard - Create weekly leaderboard (permissionless crank)

pub mod enter;
pub mod attack;
pub mod attack_multi;
pub mod interact;
pub mod choose_relic;
pub mod flee;
pub mod claim;
pub mod resume;
pub mod create_template;
pub mod claim_leaderboard_prize;
pub mod create_leaderboard;
