pub mod remove_player;
pub mod remove_team;
/// Name Service Integration Processors
///
/// Handles domain name assignment for players and teams.
///
/// Operations:
/// - set_player: Transfer domain from user → player, set as player name
/// - set_team: Transfer domain from user → team, set as team name (leader only)
/// - remove_player: Remove player name, transfer domain back to user
/// - remove_team: Remove team name, transfer domain back to user (leader only)
/// - update_player: Swap player name (old → user, new → player)
/// - update_team: Swap team name (old → user, new → player) (leader only)
pub mod set_player;
pub mod set_team;
pub mod update_player;
pub mod update_team;
