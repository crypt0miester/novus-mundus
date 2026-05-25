pub mod arena;
pub mod castle;
pub mod combat;
pub mod dungeon;
pub mod economy;
pub mod encounter;
pub mod estate;
pub mod event;
pub mod expedition;
pub mod forge;
pub mod hero;
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
pub mod loot;
pub mod name;
pub mod oracle;
pub mod progression;
pub mod rally;
pub mod reinforcement;
pub mod research;
pub mod sanctuary;
pub mod shop;
pub mod subscription;
pub mod team;
pub mod token;
pub mod travel;
