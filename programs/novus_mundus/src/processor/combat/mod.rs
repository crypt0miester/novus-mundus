/// Combat processors - PvP and PvE
///
/// All combat uses the same damage calculation logic but with different targets:
/// - PvP: attack_player (location-based, mutual damage, loot stealing)
/// - PvE: attack_encounter (cooperative, instant + ranking rewards)

pub mod attack_player;
pub mod attack_encounter;
