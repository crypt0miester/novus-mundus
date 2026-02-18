/// Initialization processors
///
/// These processors set up the global game state, user accounts, player accounts, and cities.
/// Should only be called once per entity.

pub mod game_engine;
pub mod update_game_config;
pub mod player;
pub mod user;
pub mod city;
pub mod close_registration;
pub mod batch_cities;
pub mod set_terrain;
pub mod append_terrain;
