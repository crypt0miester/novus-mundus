/// Progression system processors
///
/// Player advancement and rewards:
/// - claim_daily_reward: Claim daily login rewards (cash, produce, XP)
///
/// Note: XP is granted automatically by other actions (combat, travel, etc.)
/// using logic functions from logic::progression module
pub mod claim_daily_reward;
