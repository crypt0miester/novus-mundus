/// Expedition events - mining, fishing, gathering

use pinocchio::pubkey::Pubkey;
use super::{Event, PackBytes, discriminator};

/// Emitted when an expedition starts
pub struct ExpeditionStarted {
    /// Player account pubkey
    pub player: Pubkey,
    /// Expedition type (0=mining, 1=fishing, etc.)
    pub expedition_type: u8,
    /// Location/node ID
    pub node_id: u8,
    /// Duration in seconds
    pub duration: u32,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for ExpeditionStarted {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:ExpeditionStarted");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.player.pack(&mut buf[offset..]);
        offset += self.expedition_type.pack(&mut buf[offset..]);
        offset += self.node_id.pack(&mut buf[offset..]);
        offset += self.duration.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when an expedition action/strike occurs
pub struct ExpeditionStrike {
    /// Player account pubkey
    pub player: Pubkey,
    /// Strike number
    pub strike_num: u8,
    /// Yield from this strike
    pub yield_amount: u64,
    /// Quality/rarity of find
    pub quality: u8,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for ExpeditionStrike {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:ExpeditionStrike");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.player.pack(&mut buf[offset..]);
        offset += self.strike_num.pack(&mut buf[offset..]);
        offset += self.yield_amount.pack(&mut buf[offset..]);
        offset += self.quality.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when expedition rewards are claimed
pub struct ExpeditionClaimed {
    /// Player account pubkey
    pub player: Pubkey,
    /// Expedition type
    pub expedition_type: u8,
    /// Total resources gathered
    pub total_yield: u64,
    /// Bonus resources (from buffs, etc.)
    pub bonus_yield: u64,
    /// XP earned
    pub xp_earned: u64,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for ExpeditionClaimed {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:ExpeditionClaimed");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.player.pack(&mut buf[offset..]);
        offset += self.expedition_type.pack(&mut buf[offset..]);
        offset += self.total_yield.pack(&mut buf[offset..]);
        offset += self.bonus_yield.pack(&mut buf[offset..]);
        offset += self.xp_earned.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when an expedition is aborted early
pub struct ExpeditionAborted {
    /// Player account pubkey
    pub player: Pubkey,
    /// Expedition type
    pub expedition_type: u8,
    /// Partial yield received
    pub partial_yield: u64,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for ExpeditionAborted {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:ExpeditionAborted");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.player.pack(&mut buf[offset..]);
        offset += self.expedition_type.pack(&mut buf[offset..]);
        offset += self.partial_yield.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when an expedition is sped up using gems
pub struct ExpeditionSpeedup {
    /// Player account pubkey
    pub player: Pubkey,
    /// Seconds reduced from remaining time
    pub speedup_seconds: u64,
    /// Gems spent on speedup
    pub gems_spent: u64,
    /// New end time (start_time adjusted by speedup)
    pub new_eta: i64,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for ExpeditionSpeedup {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:ExpeditionSpeedup");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.player.pack(&mut buf[offset..]);
        offset += self.speedup_seconds.pack(&mut buf[offset..]);
        offset += self.gems_spent.pack(&mut buf[offset..]);
        offset += self.new_eta.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}
