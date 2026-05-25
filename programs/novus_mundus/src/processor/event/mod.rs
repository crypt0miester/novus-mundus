pub mod claim_prize;
/// Event management processors
///
/// Skill-based competitions with in-game leaderboards:
/// - create: Create event with scoring type, requirements, prize pool (DAO only)
/// - join: Join event (creates EventParticipation PDA, sets player.current_event)
/// - finalize: Lock leaderboard after end_time (anyone can call)
/// - claim_prize: Winners claim weighted prize share (top 10)
///
/// Event scoring is automatic - processors update scores when actions occur.
/// Players can only participate in ONE event at a time.
pub mod create;
pub mod finalize;
pub mod join;
