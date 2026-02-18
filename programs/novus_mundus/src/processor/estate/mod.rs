/// Estate System Processors
///
/// Handles all estate-related operations:
/// - create: Create player's estate PDA
/// - build: Construct a new building
/// - upgrade: Upgrade an existing building
/// - complete: Complete construction/upgrade
/// - buy_plot: Purchase additional land plot
/// - daily_claim: Claim login streak rewards (Mansion)
/// - daily_activity: Complete building mini-games
/// - convert_materials: Convert 100 lower tier → 20 higher tier (Workshop)

pub mod create;
pub mod build;
pub mod upgrade;
pub mod complete;
pub mod buy_plot;
pub mod daily_claim;
pub mod daily_activity;
pub mod convert_materials;
pub mod speedup;
pub mod recover_troops;
