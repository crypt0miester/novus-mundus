pub mod intercity_cancel;
pub mod intercity_complete;
/// Travel processors - intercity and intracity movement
///
/// Intercity travel:
/// - intercity_start: Begin travel between cities (slow, theme-dependent speed)
/// - intercity_complete: Arrive at destination city
/// - intercity_cancel: Cancel travel (must travel back from current position)
/// - intercity_teleport: Instant travel for Locked Novi cost
///
/// Intracity travel:
/// - intracity_start: Begin movement within same city (fast, walking speed)
/// - intracity_complete: Arrive at coordinates within city
/// - intracity_cancel: Cancel travel and return to origin
///
/// Speed-up:
/// - speedup: Spend gems to reduce remaining travel time (tiered: 50%, 75%, 87.5% reduction)
pub mod intercity_start;
pub mod intercity_teleport;
pub mod intracity_cancel;
pub mod intracity_complete;
pub mod intracity_start;
pub mod speedup;
