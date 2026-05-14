/// Research events - tech tree progression

use pinocchio::Address;
use super::{Event, PackBytes, discriminator};

/// Emitted when research starts
pub struct ResearchStarted {
    /// Player account pubkey (not wallet)
    pub player: Address,
    /// Player's name (48 bytes UTF-8)
    pub player_name: [u8; 48],
    /// Research ID
    pub research_id: u16,
    /// Target level
    pub level: u8,
    /// Completion timestamp
    pub completes_at: i64,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for ResearchStarted {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:ResearchStarted");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.player.pack(&mut buf[offset..]);
        offset += self.player_name.pack(&mut buf[offset..]);
        offset += self.research_id.pack(&mut buf[offset..]);
        offset += self.level.pack(&mut buf[offset..]);
        offset += self.completes_at.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when research completes
pub struct ResearchCompleted {
    /// Player account pubkey (not wallet)
    pub player: Address,
    /// Player's name (48 bytes UTF-8)
    pub player_name: [u8; 48],
    /// Research ID
    pub research_id: u16,
    /// Level achieved
    pub level: u8,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for ResearchCompleted {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:ResearchCompleted");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.player.pack(&mut buf[offset..]);
        offset += self.player_name.pack(&mut buf[offset..]);
        offset += self.research_id.pack(&mut buf[offset..]);
        offset += self.level.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when research is cancelled
pub struct ResearchCancelled {
    /// Player account pubkey (not wallet)
    pub player: Address,
    /// Player's name (48 bytes UTF-8)
    pub player_name: [u8; 48],
    /// Research ID that was cancelled
    pub research_id: u16,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for ResearchCancelled {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:ResearchCancelled");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.player.pack(&mut buf[offset..]);
        offset += self.player_name.pack(&mut buf[offset..]);
        offset += self.research_id.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when research is sped up using gems
pub struct ResearchSpeedup {
    /// Player account pubkey (not wallet)
    pub player: Address,
    /// Player's name (48 bytes UTF-8)
    pub player_name: [u8; 48],
    /// Research ID being sped up
    pub research_id: u16,
    /// Speedup seconds
    pub speedup_seconds: i64,
    /// Gems spent
    pub gems_spent: u64,
    /// New ETA timestamp
    pub new_eta: i64,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for ResearchSpeedup {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:ResearchSpeedup");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.player.pack(&mut buf[offset..]);
        offset += self.player_name.pack(&mut buf[offset..]);
        offset += self.research_id.pack(&mut buf[offset..]);
        offset += self.speedup_seconds.pack(&mut buf[offset..]);
        offset += self.gems_spent.pack(&mut buf[offset..]);
        offset += self.new_eta.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when a research node is ascended
pub struct ResearchAscended {
    /// Player account pubkey (not wallet)
    pub player: Address,
    /// Player's name (48 bytes UTF-8)
    pub player_name: [u8; 48],
    /// Research tree (research ID)
    pub research_tree: u16,
    /// New ascension level
    pub new_ascension_level: u8,
    /// Mastery cost
    pub mastery_cost: u16,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for ResearchAscended {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:ResearchAscended");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.player.pack(&mut buf[offset..]);
        offset += self.player_name.pack(&mut buf[offset..]);
        offset += self.research_tree.pack(&mut buf[offset..]);
        offset += self.new_ascension_level.pack(&mut buf[offset..]);
        offset += self.mastery_cost.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when a player ascends
pub struct PlayerAscended {
    /// Player account pubkey (not wallet)
    pub player: Address,
    /// Player's name (48 bytes UTF-8)
    pub player_name: [u8; 48],
    /// New ascension level
    pub ascension_level: u8,
    /// Mastery points gained
    pub mastery_gained: u16,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for PlayerAscended {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:PlayerAscended");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.player.pack(&mut buf[offset..]);
        offset += self.player_name.pack(&mut buf[offset..]);
        offset += self.ascension_level.pack(&mut buf[offset..]);
        offset += self.mastery_gained.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}
