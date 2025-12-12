/// Name service events - player and team name operations

use pinocchio::pubkey::Pubkey;
use super::{Event, PackBytes, discriminator};

/// Emitted when a player name is set
pub struct PlayerNameSet {
    /// Player account pubkey
    pub player: Pubkey,
    /// Domain hash (for lookup)
    pub domain_hash: [u8; 32],
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for PlayerNameSet {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:PlayerNameSet");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.player.pack(&mut buf[offset..]);
        buf[offset..offset + 32].copy_from_slice(&self.domain_hash);
        offset += 32;
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when a player name is removed
pub struct PlayerNameRemoved {
    /// Player account pubkey
    pub player: Pubkey,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for PlayerNameRemoved {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:PlayerNameRemoved");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.player.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when a player name is updated (changed)
pub struct PlayerNameUpdated {
    /// Player account pubkey
    pub player: Pubkey,
    /// New domain hash
    pub new_domain_hash: [u8; 32],
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for PlayerNameUpdated {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:PlayerNameUpdated");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.player.pack(&mut buf[offset..]);
        buf[offset..offset + 32].copy_from_slice(&self.new_domain_hash);
        offset += 32;
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when a team name is set
pub struct TeamNameSet {
    /// Team account pubkey
    pub team: Pubkey,
    /// Domain hash (for lookup)
    pub domain_hash: [u8; 32],
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for TeamNameSet {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:TeamNameSet");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.team.pack(&mut buf[offset..]);
        buf[offset..offset + 32].copy_from_slice(&self.domain_hash);
        offset += 32;
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when a team name is removed
pub struct TeamNameRemoved {
    /// Team account pubkey
    pub team: Pubkey,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for TeamNameRemoved {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:TeamNameRemoved");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.team.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when a team name is updated (changed)
pub struct TeamNameUpdated {
    /// Team account pubkey
    pub team: Pubkey,
    /// New domain hash
    pub new_domain_hash: [u8; 32],
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for TeamNameUpdated {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:TeamNameUpdated");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.team.pack(&mut buf[offset..]);
        buf[offset..offset + 32].copy_from_slice(&self.new_domain_hash);
        offset += 32;
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}
