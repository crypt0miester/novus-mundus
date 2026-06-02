use super::{discriminator, Event, PackBytes};
/// Name service events - player name operations
use pinocchio::Address;

/// Emitted when a player name is set
pub struct PlayerNameSet {
    /// Player account pubkey (not wallet)
    pub player: Address,
    /// Player's name (48 bytes UTF-8)
    pub player_name: [u8; 48],
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
        offset += self.player_name.pack(&mut buf[offset..]);
        buf[offset..offset + 32].copy_from_slice(&self.domain_hash);
        offset += 32;
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when a player name is removed
pub struct PlayerNameRemoved {
    /// Player account pubkey (not wallet)
    pub player: Address,
    /// Player's name (48 bytes UTF-8) - the old name being removed
    pub player_name: [u8; 48],
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for PlayerNameRemoved {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:PlayerNameRemoved");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.player.pack(&mut buf[offset..]);
        offset += self.player_name.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when a player name is updated (changed)
pub struct PlayerNameUpdated {
    /// Player account pubkey (not wallet)
    pub player: Address,
    /// Old player name (48 bytes UTF-8)
    pub old_name: [u8; 48],
    /// New player name (48 bytes UTF-8)
    pub new_name: [u8; 48],
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
        offset += self.old_name.pack(&mut buf[offset..]);
        offset += self.new_name.pack(&mut buf[offset..]);
        buf[offset..offset + 32].copy_from_slice(&self.new_domain_hash);
        offset += 32;
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

