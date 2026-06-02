/// Name Service Integration Processors
///
/// Handles domain name assignment for players.
///
/// Operations:
/// - set_player: Transfer domain from user → player, set as player name
/// - remove_player: Remove player name, transfer domain back to user
/// - update_player: Swap player name (old → user, new → player)
///
/// Domains are held directly by the player PDA; we do not register a TLD-House
/// MainDomain (its `init` funds rent via a System transfer from the payer, which
/// cannot debit a program-owned PDA that carries data).
pub mod remove_player;
pub mod set_player;
pub mod update_player;
