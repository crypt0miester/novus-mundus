/// Token events - NOVI operations (withdraw, reserved to claimed)

use pinocchio::pubkey::Pubkey;
use super::{Event, PackBytes, discriminator};

/// Emitted when reserved NOVI is moved to locked
pub struct NoviReservedToLocked {
    /// Player account pubkey (not wallet)
    pub player: Pubkey,
    /// Player's name (48 bytes UTF-8)
    pub player_name: [u8; 48],
    /// Amount moved
    pub amount: u64,
    /// New locked balance
    pub new_locked: u64,
    /// Remaining reserved balance
    pub remaining_reserved: u64,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for NoviReservedToLocked {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:NoviReservedToLocked");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.player.pack(&mut buf[offset..]);
        offset += self.player_name.pack(&mut buf[offset..]);
        offset += self.amount.pack(&mut buf[offset..]);
        offset += self.new_locked.pack(&mut buf[offset..]);
        offset += self.remaining_reserved.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when reserved NOVI is withdrawn (claimed)
pub struct NoviWithdrawn {
    /// Player account pubkey (not wallet)
    pub player: Pubkey,
    /// Player's name (48 bytes UTF-8)
    pub player_name: [u8; 48],
    /// Amount withdrawn
    pub amount: u64,
    /// Remaining reserved balance
    pub remaining_reserved: u64,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for NoviWithdrawn {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:NoviWithdrawn");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.player.pack(&mut buf[offset..]);
        offset += self.player_name.pack(&mut buf[offset..]);
        offset += self.amount.pack(&mut buf[offset..]);
        offset += self.remaining_reserved.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}
