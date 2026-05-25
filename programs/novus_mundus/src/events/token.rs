use super::{discriminator, Event, PackBytes};
/// Token events - NOVI operations (withdraw, reserved to claimed)
use pinocchio::Address;

/// Emitted when reserved NOVI is moved to locked
pub struct NoviReservedToLocked {
    /// Player account pubkey (not wallet)
    pub player: Address,
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
    pub player: Address,
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

/// Emitted when NOVI is deposited from a wallet back into reserved.
/// Mirrors NoviWithdrawn's shape so dashboards can pair the two flows.
pub struct NoviDeposited {
    /// UserAccount PDA receiving the deposit (NOT the owner wallet).
    pub user: Address,
    /// Gross amount sent in (fee + credited).
    pub amount: u64,
    /// Fee burned from the source ATA.
    pub fee: u64,
    /// Net amount credited to reserved (amount - fee).
    pub credited: u64,
    /// New reserved_novi balance after the credit.
    pub new_reserved: u64,
    /// Unix timestamp.
    pub timestamp: i64,
}

impl Event for NoviDeposited {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:NoviDeposited");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.user.pack(&mut buf[offset..]);
        offset += self.amount.pack(&mut buf[offset..]);
        offset += self.fee.pack(&mut buf[offset..]);
        offset += self.credited.pack(&mut buf[offset..]);
        offset += self.new_reserved.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when DAO sweeps untracked NOVI surplus from a PDA-owned ATA to the
/// treasury. Recovers tokens that landed in a PDA ATA from outside the program
/// (mis-sends, partner transfers without the matching deposit_novi ix).
pub struct UntrackedNoviSwept {
    /// PDA-owned ATA the surplus was pulled from.
    pub source_ata: Address,
    /// Destination treasury ATA.
    pub treasury_ata: Address,
    /// Amount swept (ata_balance - tracked_state).
    pub amount: u64,
    /// Unix timestamp.
    pub timestamp: i64,
}

impl Event for UntrackedNoviSwept {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:UntrackedNoviSwept");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.source_ata.pack(&mut buf[offset..]);
        offset += self.treasury_ata.pack(&mut buf[offset..]);
        offset += self.amount.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}
