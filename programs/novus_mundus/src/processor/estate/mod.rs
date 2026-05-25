pub mod build;
pub mod buy_plot;
pub mod complete;
pub mod convert_materials;
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
pub mod daily_activity;
pub mod daily_claim;
pub mod initialize_building_template;
pub mod recover_troops;
pub mod speedup;
pub mod update_building_template;
pub mod upgrade;
