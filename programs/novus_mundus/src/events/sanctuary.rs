/// Sanctuary events - meditation and hero training

use pinocchio::pubkey::Pubkey;
use super::{Event, PackBytes, discriminator};

/// Emitted when a hero starts meditating
pub struct MeditationStarted {
    /// Player account pubkey
    pub player: Pubkey,
    /// Hero NFT mint pubkey
    pub hero_mint: Pubkey,
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
        offset += self.hero_mint.pack(&mut buf[offset..]);
        offset += self.duration_hours.pack(&mut buf[offset..]);
        offset += self.completes_at.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when meditation rewards are claimed
pub struct MeditationClaimed {
    /// Player account pubkey
    pub player: Pubkey,
    /// Hero NFT mint pubkey
    pub hero_mint: Pubkey,
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
        offset += self.hero_mint.pack(&mut buf[offset..]);
        offset += self.xp_earned.pack(&mut buf[offset..]);
        offset += self.levels_gained.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}
