/// Hero events - NFT hero operations

use pinocchio::pubkey::Pubkey;
use super::{Event, PackBytes, discriminator};

/// Emitted when a new hero NFT is minted
pub struct HeroMinted {
    /// Hero NFT mint pubkey
    pub hero_mint: Pubkey,
    /// Player who minted
    pub player: Pubkey,
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
        offset += self.player.pack(&mut buf[offset..]);
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
    /// Player who locked the hero
    pub player: Pubkey,
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
        offset += self.player.pack(&mut buf[offset..]);
        offset += self.slot.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when a hero is unlocked from a player
pub struct HeroUnlocked {
    /// Hero NFT mint pubkey
    pub hero_mint: Pubkey,
    /// Player who unlocked
    pub player: Pubkey,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for HeroUnlocked {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:HeroUnlocked");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.hero_mint.pack(&mut buf[offset..]);
        offset += self.player.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when a hero levels up
pub struct HeroLeveledUp {
    /// Hero NFT mint pubkey
    pub hero_mint: Pubkey,
    /// Player who owns the hero
    pub player: Pubkey,
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
        offset += self.player.pack(&mut buf[offset..]);
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
    /// Player who assigned
    pub player: Pubkey,
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
        offset += self.player.pack(&mut buf[offset..]);
        offset += self.assigned.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}
