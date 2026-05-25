use super::{discriminator, Event, PackBytes};
/// Sanctuary events - meditation and hero training
use pinocchio::Address;

/// Emitted when a hero starts meditating
pub struct MeditationStarted {
    /// Player account pubkey (not wallet)
    pub player: Address,
    /// Player's name (48 bytes UTF-8)
    pub player_name: [u8; 48],
    /// Hero NFT mint pubkey
    pub hero_mint: Address,
    /// Hero name (32 bytes UTF-8)
    pub hero_name: [u8; 32],
    /// Duration in hours
    pub duration_hours: u8,
    /// Completion timestamp
    pub completes_at: i64,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for MeditationStarted {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:MeditationStarted");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.player.pack(&mut buf[offset..]);
        offset += self.player_name.pack(&mut buf[offset..]);
        offset += self.hero_mint.pack(&mut buf[offset..]);
        offset += self.hero_name.pack(&mut buf[offset..]);
        offset += self.duration_hours.pack(&mut buf[offset..]);
        offset += self.completes_at.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when meditation is sped up with gems
pub struct MeditationSpeedup {
    /// Player account pubkey (not wallet)
    pub player: Address,
    /// Player's name (48 bytes UTF-8)
    pub player_name: [u8; 48],
    /// Seconds of meditation time added
    pub speedup_seconds: u64,
    /// Gems spent
    pub gems_spent: u64,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for MeditationSpeedup {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:MeditationSpeedup");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.player.pack(&mut buf[offset..]);
        offset += self.player_name.pack(&mut buf[offset..]);
        offset += self.speedup_seconds.pack(&mut buf[offset..]);
        offset += self.gems_spent.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when meditation rewards are claimed
pub struct MeditationClaimed {
    /// Player account pubkey (not wallet)
    pub player: Address,
    /// Player's name (48 bytes UTF-8)
    pub player_name: [u8; 48],
    /// Hero NFT mint pubkey
    pub hero_mint: Address,
    /// Hero name (32 bytes UTF-8)
    pub hero_name: [u8; 32],
    /// XP earned from meditation
    pub xp_earned: u32,
    /// Levels gained (if any)
    pub levels_gained: u8,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for MeditationClaimed {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:MeditationClaimed");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.player.pack(&mut buf[offset..]);
        offset += self.player_name.pack(&mut buf[offset..]);
        offset += self.hero_mint.pack(&mut buf[offset..]);
        offset += self.hero_name.pack(&mut buf[offset..]);
        offset += self.xp_earned.pack(&mut buf[offset..]);
        offset += self.levels_gained.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}
