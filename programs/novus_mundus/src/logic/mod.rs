// Pure business logic - framework agnostic
// These functions contain NO AccountInfo references
// Can be tested independently and reused across frameworks

pub mod safe_math;
pub mod fibonacci;
pub mod golden_math;
pub mod combat;
pub mod consume;
pub mod calculations;
pub mod location;
pub mod eligibility;
pub mod stamina;
pub mod progression;
pub mod rewards;
pub mod time_cycle;
pub mod terrain;

// Re-export all logic modules for convenience
// Some may not be used directly in on-chain code but are part of the public API
#[allow(unused_imports)]
pub use safe_math::*;
pub use fibonacci::*;
pub use golden_math::*;
pub use combat::*;
pub use consume::*;
pub use calculations::*;
pub use location::*;
#[allow(unused_imports)]
pub use eligibility::*;
pub use stamina::*;
pub use progression::*;
pub use rewards::*;
pub use time_cycle::*;
#[allow(unused_imports)]
pub use terrain::*;
