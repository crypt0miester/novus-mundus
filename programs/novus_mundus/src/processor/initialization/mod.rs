pub mod batch_cities;
pub mod city;
pub mod close_registration;
/// Initialization processors
///
/// These processors set up the global game state, user accounts, player accounts, and cities.
/// Should only be called once per entity.
pub mod game_engine;
pub mod player;
pub mod update_game_config;
pub mod user;
