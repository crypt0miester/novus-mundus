/// Loot events - rewards from encounters and activities

use pinocchio::Address;
use super::{Event, PackBytes, discriminator};

/// Emitted when loot is claimed from an encounter
pub struct LootClaimed {
    /// Player account pubkey (not wallet)
    pub player: Address,
    /// Player's name (48 bytes UTF-8)
    pub player_name: [u8; 48],
    /// Cash earned
    pub cash: u64,
    /// Items received (encoded as item_id << 8 | quantity for up to 4 items)
    pub items: [u16; 4],
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for LootClaimed {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:LootClaimed");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.player.pack(&mut buf[offset..]);
        offset += self.player_name.pack(&mut buf[offset..]);
        offset += self.cash.pack(&mut buf[offset..]);
        // Pack items array
        for item in &self.items {
            buf[offset..offset + 2].copy_from_slice(&item.to_le_bytes());
            offset += 2;
        }
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when encounter spawns (for indexers to track)
pub struct EncounterSpawned {
    /// Encounter account pubkey
    pub encounter: Address,
    /// City where spawned
    pub city: Address,
    /// Encounter type
    pub encounter_type: u8,
    /// Difficulty/level
    pub level: u8,
    /// X coordinate
    pub x: i32,
    /// Y coordinate
    pub y: i32,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for EncounterSpawned {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:EncounterSpawned");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.encounter.pack(&mut buf[offset..]);
        offset += self.city.pack(&mut buf[offset..]);
        offset += self.encounter_type.pack(&mut buf[offset..]);
        offset += self.level.pack(&mut buf[offset..]);
        offset += self.x.pack(&mut buf[offset..]);
        offset += self.y.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}
