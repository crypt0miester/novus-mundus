pub mod cancel;
pub mod close_rally;
/// Rally management processors (Strategic Combat System)
///
/// Rally Lifecycle:
/// 1. create: Leader creates rally, sets gather_at deadline
/// 2. join: Teammates join, commit units + weapons, travel to rally point
/// 3. speedup: Speed up gather/march/return (gems)
/// 4. execute: Combat resolution at target (weapon mechanics)
/// 5. process_return: Return home with surviving units/weapons + loot
/// 6. leave/cancel: Exit rally early (returns full units/weapons)
///
/// Speedup Types (in speedup.rs):
/// - Gather (0): Speed up travel to rally point (payer: participant OR leader)
/// - March (1): Speed up army march to target (payer: leader only)
/// - Return (2): Speed up return journey (payer: participant only)
pub mod create;
pub mod execute;
pub mod join;
pub mod leave;
pub mod process_return;
pub mod speedup;
