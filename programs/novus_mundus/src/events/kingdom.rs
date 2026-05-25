//! Kingdom Events
//!
//! Events related to kingdom lifecycle and player membership

use crate::events::{discriminator, Event, Name32, PackBytes};
use pinocchio::Address;

/// Emitted when a new kingdom is created
pub struct KingdomCreated {
    /// Kingdom ID (0, 1, 2, ...)
    pub kingdom_id: u16,
    /// Kingdom name (e.g., "Genesis", "Vanguard")
    pub kingdom_name: [u8; 32],
    /// Theme (0=Medieval, 1=Cyberpunk, etc.)
    pub theme: u8,
    /// When the kingdom opens for play
    pub start_time: i64,
    /// Registration deadline (0 = no deadline)
    pub registration_closes_at: i64,
    /// Who created the kingdom (DAO authority)
    pub created_by: Address,
    /// When the kingdom was created
    pub created_at: i64,
}

impl Event for KingdomCreated {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:KingdomCreated");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.kingdom_id.pack(&mut buf[offset..]);
        offset += Name32(self.kingdom_name).pack(&mut buf[offset..]);
        offset += self.theme.pack(&mut buf[offset..]);
        offset += self.start_time.pack(&mut buf[offset..]);
        offset += self.registration_closes_at.pack(&mut buf[offset..]);
        offset += self.created_by.pack(&mut buf[offset..]);
        offset += self.created_at.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when kingdom registration closes
pub struct KingdomRegistrationClosed {
    /// Kingdom ID
    pub kingdom_id: u16,
    /// GameEngine pubkey for this kingdom
    pub game_engine: Address,
    /// Total players registered before close
    pub total_players: u64,
    /// When registration was closed
    pub closed_at: i64,
}

impl Event for KingdomRegistrationClosed {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:KingdomRegistrationClosed");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.kingdom_id.pack(&mut buf[offset..]);
        offset += self.game_engine.pack(&mut buf[offset..]);
        offset += self.total_players.pack(&mut buf[offset..]);
        offset += self.closed_at.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when a player joins a kingdom
pub struct PlayerJoinedKingdom {
    /// Kingdom ID
    pub kingdom_id: u16,
    /// GameEngine pubkey for this kingdom
    pub game_engine: Address,
    /// Player account pubkey
    pub player: Address,
    /// Player's wallet owner
    pub owner: Address,
    /// When the player joined
    pub joined_at: i64,
}

impl Event for PlayerJoinedKingdom {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:PlayerJoinedKingdom");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.kingdom_id.pack(&mut buf[offset..]);
        offset += self.game_engine.pack(&mut buf[offset..]);
        offset += self.player.pack(&mut buf[offset..]);
        offset += self.owner.pack(&mut buf[offset..]);
        offset += self.joined_at.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when a kingdom event is created
pub struct KingdomEventCreated {
    /// Kingdom ID
    pub kingdom_id: u16,
    /// GameEngine pubkey
    pub game_engine: Address,
    /// Event ID within kingdom
    pub event_id: u64,
    /// Event type (0=Combat, 1=Economy, etc.)
    pub event_type: u8,
    /// When event starts
    pub start_time: i64,
    /// When event ends
    pub end_time: i64,
    /// Total prize pool in lamports
    pub prize_pool: u64,
}

impl Event for KingdomEventCreated {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:KingdomEventCreated");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.kingdom_id.pack(&mut buf[offset..]);
        offset += self.game_engine.pack(&mut buf[offset..]);
        offset += self.event_id.pack(&mut buf[offset..]);
        offset += self.event_type.pack(&mut buf[offset..]);
        offset += self.start_time.pack(&mut buf[offset..]);
        offset += self.end_time.pack(&mut buf[offset..]);
        offset += self.prize_pool.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when arena season starts in a kingdom
pub struct KingdomArenaSeasonStarted {
    /// Kingdom ID
    pub kingdom_id: u16,
    /// GameEngine pubkey
    pub game_engine: Address,
    /// Season number
    pub season_id: u32,
    /// When season starts
    pub start_time: i64,
    /// When season ends
    pub end_time: i64,
    /// Total prize pool in lamports
    pub prize_pool: u64,
}

impl Event for KingdomArenaSeasonStarted {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:KingdomArenaSeasonStarted");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.kingdom_id.pack(&mut buf[offset..]);
        offset += self.game_engine.pack(&mut buf[offset..]);
        offset += self.season_id.pack(&mut buf[offset..]);
        offset += self.start_time.pack(&mut buf[offset..]);
        offset += self.end_time.pack(&mut buf[offset..]);
        offset += self.prize_pool.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when dungeon leaderboard is created for a kingdom
pub struct KingdomDungeonLeaderboardCreated {
    /// Kingdom ID
    pub kingdom_id: u16,
    /// GameEngine pubkey
    pub game_engine: Address,
    /// Dungeon template ID
    pub dungeon_id: u16,
    /// Week number
    pub week_number: u16,
    /// Prize pool in lamports
    pub prize_pool: u64,
}

impl Event for KingdomDungeonLeaderboardCreated {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:KingdomDungeonLeaderboardCreated");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.kingdom_id.pack(&mut buf[offset..]);
        offset += self.game_engine.pack(&mut buf[offset..]);
        offset += self.dungeon_id.pack(&mut buf[offset..]);
        offset += self.week_number.pack(&mut buf[offset..]);
        offset += self.prize_pool.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when cities are initialized for a kingdom
pub struct KingdomCitiesInitialized {
    /// Kingdom ID
    pub kingdom_id: u16,
    /// GameEngine pubkey
    pub game_engine: Address,
    /// Starting city ID of batch
    pub start_city_id: u16,
    /// Number of cities initialized
    pub cities_count: u8,
    /// When cities were initialized
    pub initialized_at: i64,
}

impl Event for KingdomCitiesInitialized {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:KingdomCitiesInitialized");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.kingdom_id.pack(&mut buf[offset..]);
        offset += self.game_engine.pack(&mut buf[offset..]);
        offset += self.start_city_id.pack(&mut buf[offset..]);
        offset += self.cities_count.pack(&mut buf[offset..]);
        offset += self.initialized_at.pack(&mut buf[offset..]);
        offset
    }
}
