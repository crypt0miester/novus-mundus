/// Pinocchio processors - organized by functional category
///
/// Architecture:
/// - Processors handle account parsing, validation, and orchestration
/// - Pure business logic lives in the `logic` module
/// - State management lives in the `state` module
///
/// Categories:
/// - initialization: Setup game engine and player accounts
/// - economy: Token flow, units, resources, equipment
/// - combat: PvP and PvE mechanics
/// - travel: Intercity and intracity movement
/// - token: Direct token operations (reserved→locked, withdraw)
/// - subscription: Real-money subscription purchases and tier management

pub mod initialization;
pub mod economy;
pub mod combat;
pub mod travel;
pub mod token;
pub mod encounter;
pub mod team;
pub mod rally;
pub mod event;
pub mod progression;
pub mod subscription;
pub mod loot;
pub mod research;
pub mod hero;
pub mod shop;
pub mod name;
pub mod estate;
pub mod forge;
pub mod sanctuary;
pub mod reinforcement;
pub mod expedition;
pub mod arena;
pub mod dungeon;
pub mod castle;
pub mod oracle;
