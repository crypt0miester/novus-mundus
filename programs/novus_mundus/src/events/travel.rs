/// Travel events - intercity and intracity movement

use pinocchio::pubkey::Pubkey;
use super::{Event, PackBytes, discriminator};

/// Emitted when a player starts traveling between cities
pub struct IntercityTravelStarted {
    /// Player account pubkey
    pub player: Pubkey,
    /// Origin city
    pub from_city: Pubkey,
    /// Destination city
    pub to_city: Pubkey,
    /// Estimated arrival timestamp
    pub arrival_at: i64,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for IntercityTravelStarted {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:IntercityTravelStarted");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.player.pack(&mut buf[offset..]);
        offset += self.from_city.pack(&mut buf[offset..]);
        offset += self.to_city.pack(&mut buf[offset..]);
        offset += self.arrival_at.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when a player completes intercity travel
pub struct IntercityTravelCompleted {
    /// Player account pubkey
    pub player: Pubkey,
    /// City arrived at
    pub city: Pubkey,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for IntercityTravelCompleted {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:IntercityTravelCompleted");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.player.pack(&mut buf[offset..]);
        offset += self.city.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when a player teleports instantly
pub struct PlayerTeleported {
    /// Player account pubkey
    pub player: Pubkey,
    /// Origin city
    pub from_city: Pubkey,
    /// Destination city
    pub to_city: Pubkey,
    /// Gems spent on teleport
    pub gems_spent: u64,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for PlayerTeleported {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:PlayerTeleported");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.player.pack(&mut buf[offset..]);
        offset += self.from_city.pack(&mut buf[offset..]);
        offset += self.to_city.pack(&mut buf[offset..]);
        offset += self.gems_spent.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when a player starts moving within a city
pub struct IntracityTravelStarted {
    /// Player account pubkey
    pub player: Pubkey,
    /// City pubkey
    pub city: Pubkey,
    /// Destination X coordinate
    pub dest_x: i32,
    /// Destination Y coordinate
    pub dest_y: i32,
    /// Estimated arrival timestamp
    pub arrival_at: i64,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for IntracityTravelStarted {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:IntracityTravelStarted");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.player.pack(&mut buf[offset..]);
        offset += self.city.pack(&mut buf[offset..]);
        offset += self.dest_x.pack(&mut buf[offset..]);
        offset += self.dest_y.pack(&mut buf[offset..]);
        offset += self.arrival_at.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when intracity travel completes
pub struct IntracityTravelCompleted {
    /// Player account pubkey
    pub player: Pubkey,
    /// Final X coordinate
    pub x: i32,
    /// Final Y coordinate
    pub y: i32,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for IntracityTravelCompleted {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:IntracityTravelCompleted");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.player.pack(&mut buf[offset..]);
        offset += self.x.pack(&mut buf[offset..]);
        offset += self.y.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when travel is cancelled
pub struct TravelCancelled {
    /// Player account pubkey
    pub player: Pubkey,
    /// Whether this was intercity travel
    pub is_intercity: bool,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for TravelCancelled {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:TravelCancelled");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.player.pack(&mut buf[offset..]);
        offset += self.is_intercity.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when a player speeds up travel
pub struct TravelSpeedup {
    /// Player account pubkey
    pub player: Pubkey,
    /// Whether this was intercity travel
    pub is_intercity: bool,
    /// Speedup tier used (1 or 2)
    pub speedup_tier: u8,
    /// Gems spent
    pub gems_spent: u64,
    /// New ETA
    pub new_eta: i64,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for TravelSpeedup {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:TravelSpeedup");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.player.pack(&mut buf[offset..]);
        offset += self.is_intercity.pack(&mut buf[offset..]);
        offset += self.speedup_tier.pack(&mut buf[offset..]);
        offset += self.gems_spent.pack(&mut buf[offset..]);
        offset += self.new_eta.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}
