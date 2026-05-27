// Pure business logic - framework agnostic
// These functions contain NO AccountView references
// Can be tested independently and reused across frameworks

pub mod biome;
pub mod calculations;
pub mod combat;
pub mod consume;
pub mod eligibility;
pub mod fibonacci;
pub mod golden_math;
pub mod location;
pub mod progression;
pub mod rewards;
pub mod safe_math;
pub mod stamina;
pub mod terrain;
pub mod time_cycle;

// Re-export all logic modules for convenience
// Some may not be used directly in on-chain code but are part of the public API
#[allow(unused_imports)]
pub use biome::*;
pub use calculations::*;
pub use combat::*;
pub use consume::*;
#[allow(unused_imports)]
pub use eligibility::*;
pub use fibonacci::*;
pub use golden_math::*;
pub use location::*;
pub use progression::*;
pub use rewards::*;
#[allow(unused_imports)]
pub use safe_math::*;
pub use stamina::*;
#[allow(unused_imports)]
pub use terrain::*;
pub use time_cycle::*;
