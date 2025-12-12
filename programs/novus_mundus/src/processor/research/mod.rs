/// Research System processors
///
/// Manages the tech tree progression system with 30 research nodes
/// providing permanent buffs to players.
///
/// Instructions:
/// - 120: initialize_template - DAO creates research template
/// - 121: create_progress - Player creates research progress account
/// - 122: start_research - Begin researching a node
/// - 123: complete_research - Claim completed research
/// - 124: speed_up_research - Use gems to speed up
/// - 125: cancel_research - Cancel and get partial refund
/// - 126: update_template - DAO updates template
/// - 127: ascend - Ascend a maxed research node (endgame)
/// Note: claim_daily_reward at instruction 90 is updated to check research unlocks

pub mod initialize_template;
pub mod create_progress;
pub mod start_research;
pub mod complete_research;
pub mod speed_up_research;
pub mod cancel_research;
pub mod update_template;
pub mod ascend;