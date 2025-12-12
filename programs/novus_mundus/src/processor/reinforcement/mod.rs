/// Reinforcement System Processors
///
/// Allows teammates to send defensive units to help defend each other.
///
/// # Lifecycle
/// 1. `send` - Sender commits defensive units to teammate
/// 2. `process_arrival` - Crank: Mark as Active when travel completes
/// 3. Active Defense - Units contribute to receiver's defense in attack_player
/// 4. `recall` OR `relieve` - Initiate return journey
/// 5. `process_return` - Crank: Return units to sender, close account
///
/// # Key Rules
/// - Only teammates can reinforce each other
/// - Only defensive units can be sent
/// - Sender pays account rent (refunded on close)
/// - Receiver has capacity limits (hero_unit_capacity_bps)
/// - Casualties are tracked per reinforcement

pub mod send;
pub mod process_arrival;
pub mod recall;
pub mod relieve;
pub mod process_return;
pub mod speedup;
