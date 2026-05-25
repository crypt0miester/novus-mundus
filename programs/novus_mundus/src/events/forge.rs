use super::{discriminator, Event, PackBytes};
/// Forge events - crafting and equipment
use pinocchio::Address;

/// Emitted when crafting begins
pub struct CraftStarted {
    /// Player account pubkey (not wallet)
    pub player: Address,
    /// Player's name (48 bytes UTF-8)
    pub player_name: [u8; 48],
    /// Item type being crafted
    pub item_type: u8,
    /// Target quality tier
    pub quality_tier: u8,
    /// Materials consumed
    pub materials_used: u64,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for CraftStarted {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:CraftStarted");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.player.pack(&mut buf[offset..]);
        offset += self.player_name.pack(&mut buf[offset..]);
        offset += self.item_type.pack(&mut buf[offset..]);
        offset += self.quality_tier.pack(&mut buf[offset..]);
        offset += self.materials_used.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when a tempering strike is performed
pub struct CraftStrike {
    /// Player account pubkey (not wallet)
    pub player: Address,
    /// Player's name (48 bytes UTF-8)
    pub player_name: [u8; 48],
    /// Current stage
    pub stage: u8,
    /// Strike quality (1-5)
    pub quality: u8,
    /// Cumulative score
    pub score: u16,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for CraftStrike {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:CraftStrike");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.player.pack(&mut buf[offset..]);
        offset += self.player_name.pack(&mut buf[offset..]);
        offset += self.stage.pack(&mut buf[offset..]);
        offset += self.quality.pack(&mut buf[offset..]);
        offset += self.score.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when crafting completes successfully
pub struct CraftCompleted {
    /// Player account pubkey (not wallet)
    pub player: Address,
    /// Player's name (48 bytes UTF-8)
    pub player_name: [u8; 48],
    /// Item type crafted
    pub item_type: u8,
    /// Final quality achieved
    pub quality: u8,
    /// Final score
    pub score: u16,
    /// Inventory slot placed in
    pub inventory_slot: u8,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for CraftCompleted {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:CraftCompleted");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.player.pack(&mut buf[offset..]);
        offset += self.player_name.pack(&mut buf[offset..]);
        offset += self.item_type.pack(&mut buf[offset..]);
        offset += self.quality.pack(&mut buf[offset..]);
        offset += self.score.pack(&mut buf[offset..]);
        offset += self.inventory_slot.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when crafting is abandoned
pub struct CraftAbandoned {
    /// Player account pubkey (not wallet)
    pub player: Address,
    /// Player's name (48 bytes UTF-8)
    pub player_name: [u8; 48],
    /// Item type that was being crafted
    pub item_type: u8,
    /// Stage reached before abandoning
    pub stage_reached: u8,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for CraftAbandoned {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:CraftAbandoned");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.player.pack(&mut buf[offset..]);
        offset += self.player_name.pack(&mut buf[offset..]);
        offset += self.item_type.pack(&mut buf[offset..]);
        offset += self.stage_reached.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when an item is equipped to a hero
pub struct ItemEquipped {
    /// Player account pubkey (not wallet)
    pub player: Address,
    /// Player's name (48 bytes UTF-8)
    pub player_name: [u8; 48],
    /// Hero mint pubkey
    pub hero_mint: Address,
    /// Hero name (32 bytes UTF-8)
    pub hero_name: [u8; 32],
    /// Equipment slot
    pub slot: u8,
    /// Item quality
    pub quality: u8,
    /// Inventory slot item came from
    pub from_inventory: u8,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for ItemEquipped {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:ItemEquipped");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.player.pack(&mut buf[offset..]);
        offset += self.player_name.pack(&mut buf[offset..]);
        offset += self.hero_mint.pack(&mut buf[offset..]);
        offset += self.hero_name.pack(&mut buf[offset..]);
        offset += self.slot.pack(&mut buf[offset..]);
        offset += self.quality.pack(&mut buf[offset..]);
        offset += self.from_inventory.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}
