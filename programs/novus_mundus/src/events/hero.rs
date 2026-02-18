/// Hero events - NFT hero operations

use pinocchio::pubkey::Pubkey;
use super::{Event, PackBytes, discriminator};

/// Emitted when a new hero NFT is minted
pub struct HeroMinted {
    /// Hero NFT mint pubkey
    pub hero_mint: Pubkey,
    /// Hero name (32 bytes UTF-8)
    pub hero_name: [u8; 32],
    /// Player account who minted (not wallet)
    pub player: Pubkey,
    /// Player's name (48 bytes UTF-8)
    pub player_name: [u8; 48],
    /// Hero template ID
    pub template_id: u16,
    /// Hero rarity
    pub rarity: u8,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for HeroMinted {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:HeroMinted");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.hero_mint.pack(&mut buf[offset..]);
        offset += self.hero_name.pack(&mut buf[offset..]);
        offset += self.player.pack(&mut buf[offset..]);
        offset += self.player_name.pack(&mut buf[offset..]);
        offset += self.template_id.pack(&mut buf[offset..]);
        offset += self.rarity.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when a hero is locked to a player
pub struct HeroLocked {
    /// Hero NFT mint pubkey
    pub hero_mint: Pubkey,
    /// Hero name (32 bytes UTF-8)
    pub hero_name: [u8; 32],
    /// Player account who locked the hero (not wallet)
    pub player: Pubkey,
    /// Player's name (48 bytes UTF-8)
    pub player_name: [u8; 48],
    /// Hero slot index
    pub slot: u8,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for HeroLocked {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:HeroLocked");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.hero_mint.pack(&mut buf[offset..]);
        offset += self.hero_name.pack(&mut buf[offset..]);
        offset += self.player.pack(&mut buf[offset..]);
        offset += self.player_name.pack(&mut buf[offset..]);
        offset += self.slot.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when a hero is unlocked from a player
pub struct HeroUnlocked {
    /// Hero NFT mint pubkey
    pub hero_mint: Pubkey,
    /// Hero name (32 bytes UTF-8)
    pub hero_name: [u8; 32],
    /// Player account who unlocked (not wallet)
    pub player: Pubkey,
    /// Player's name (48 bytes UTF-8)
    pub player_name: [u8; 48],
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for HeroUnlocked {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:HeroUnlocked");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.hero_mint.pack(&mut buf[offset..]);
        offset += self.hero_name.pack(&mut buf[offset..]);
        offset += self.player.pack(&mut buf[offset..]);
        offset += self.player_name.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when a hero levels up
pub struct HeroLeveledUp {
    /// Hero NFT mint pubkey
    pub hero_mint: Pubkey,
    /// Hero name (32 bytes UTF-8)
    pub hero_name: [u8; 32],
    /// Player account who owns the hero (not wallet)
    pub player: Pubkey,
    /// Player's name (48 bytes UTF-8)
    pub player_name: [u8; 48],
    /// Previous level
    pub old_level: u32,
    /// New level
    pub new_level: u32,
    /// XP spent
    pub xp_spent: u64,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for HeroLeveledUp {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:HeroLeveledUp");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.hero_mint.pack(&mut buf[offset..]);
        offset += self.hero_name.pack(&mut buf[offset..]);
        offset += self.player.pack(&mut buf[offset..]);
        offset += self.player_name.pack(&mut buf[offset..]);
        offset += self.old_level.pack(&mut buf[offset..]);
        offset += self.new_level.pack(&mut buf[offset..]);
        offset += self.xp_spent.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when a hero is assigned to defense
pub struct HeroAssignedDefensive {
    /// Hero NFT mint pubkey
    pub hero_mint: Pubkey,
    /// Hero name (32 bytes UTF-8)
    pub hero_name: [u8; 32],
    /// Player account who assigned (not wallet)
    pub player: Pubkey,
    /// Player's name (48 bytes UTF-8)
    pub player_name: [u8; 48],
    /// Whether assigned (true) or unassigned (false)
    pub assigned: bool,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for HeroAssignedDefensive {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:HeroAssignedDefensive");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.hero_mint.pack(&mut buf[offset..]);
        offset += self.hero_name.pack(&mut buf[offset..]);
        offset += self.player.pack(&mut buf[offset..]);
        offset += self.player_name.pack(&mut buf[offset..]);
        offset += self.assigned.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when a hero NFT is burned
pub struct HeroBurned {
    /// Hero NFT mint pubkey (now destroyed)
    pub hero_mint: Pubkey,
    /// Player account who burned
    pub player: Pubkey,
    /// Player's name (48 bytes UTF-8)
    pub player_name: [u8; 48],
    /// Hero template ID
    pub template_id: u16,
    /// Hero level at time of burn
    pub hero_level: u32,
    /// Hero tier (0-4)
    pub tier: u8,
    /// NOVI reward credited (locked)
    pub novi_reward: u64,
    /// Template minted_count after decrement
    pub new_minted_count: u32,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for HeroBurned {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:HeroBurned");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.hero_mint.pack(&mut buf[offset..]);
        offset += self.player.pack(&mut buf[offset..]);
        offset += self.player_name.pack(&mut buf[offset..]);
        offset += self.template_id.pack(&mut buf[offset..]);
        offset += self.hero_level.pack(&mut buf[offset..]);
        offset += self.tier.pack(&mut buf[offset..]);
        offset += self.novi_reward.pack(&mut buf[offset..]);
        offset += self.new_minted_count.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when a hero template supply cap is updated
pub struct SupplyCapUpdated {
    /// Hero template ID
    pub template_id: u16,
    /// Previous supply cap
    pub old_supply_cap: u32,
    /// New supply cap
    pub new_supply_cap: u32,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for SupplyCapUpdated {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:SupplyCapUpdated");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.template_id.pack(&mut buf[offset..]);
        offset += self.old_supply_cap.pack(&mut buf[offset..]);
        offset += self.new_supply_cap.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}
