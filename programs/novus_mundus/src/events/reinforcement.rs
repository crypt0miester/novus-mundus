/// Reinforcement events - sending troops to allies

use pinocchio::pubkey::Pubkey;
use super::{Event, PackBytes, discriminator};

/// Emitted when reinforcements are sent
pub struct ReinforcementSent {
    /// Sender player pubkey
    pub sender: Pubkey,
    /// Receiver player pubkey
    pub receiver: Pubkey,
    /// Units sent (melee, ranged, siege)
    pub units: [u64; 3],
    /// Estimated arrival timestamp
    pub arrives_at: i64,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for ReinforcementSent {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:ReinforcementSent");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.sender.pack(&mut buf[offset..]);
        offset += self.receiver.pack(&mut buf[offset..]);
        offset += self.units[0].pack(&mut buf[offset..]);
        offset += self.units[1].pack(&mut buf[offset..]);
        offset += self.units[2].pack(&mut buf[offset..]);
        offset += self.arrives_at.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when reinforcements arrive at destination
pub struct ReinforcementArrived {
    /// Reinforcement account pubkey
    pub reinforcement: Pubkey,
    /// Sender player pubkey
    pub sender: Pubkey,
    /// Receiver player pubkey
    pub receiver: Pubkey,
    /// Units that arrived
    pub units: [u64; 3],
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for ReinforcementArrived {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:ReinforcementArrived");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.reinforcement.pack(&mut buf[offset..]);
        offset += self.sender.pack(&mut buf[offset..]);
        offset += self.receiver.pack(&mut buf[offset..]);
        offset += self.units[0].pack(&mut buf[offset..]);
        offset += self.units[1].pack(&mut buf[offset..]);
        offset += self.units[2].pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when reinforcements are recalled by sender
pub struct ReinforcementRecalled {
    /// Reinforcement account pubkey
    pub reinforcement: Pubkey,
    /// Sender who recalled
    pub sender: Pubkey,
    /// Receiver who was being helped
    pub receiver: Pubkey,
    /// Units being recalled
    pub units: [u64; 3],
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for ReinforcementRecalled {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:ReinforcementRecalled");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.reinforcement.pack(&mut buf[offset..]);
        offset += self.sender.pack(&mut buf[offset..]);
        offset += self.receiver.pack(&mut buf[offset..]);
        offset += self.units[0].pack(&mut buf[offset..]);
        offset += self.units[1].pack(&mut buf[offset..]);
        offset += self.units[2].pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when reinforcements are relieved by destination owner
pub struct ReinforcementRelieved {
    /// Reinforcement account pubkey
    pub reinforcement: Pubkey,
    /// Sender who sent the reinforcement
    pub sender: Pubkey,
    /// Receiver who relieved the reinforcement
    pub receiver: Pubkey,
    /// Units being sent back
    pub units: [u64; 3],
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for ReinforcementRelieved {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:ReinforcementRelieved");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.reinforcement.pack(&mut buf[offset..]);
        offset += self.sender.pack(&mut buf[offset..]);
        offset += self.receiver.pack(&mut buf[offset..]);
        offset += self.units[0].pack(&mut buf[offset..]);
        offset += self.units[1].pack(&mut buf[offset..]);
        offset += self.units[2].pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when reinforcements return home
pub struct ReinforcementReturned {
    /// Sender player pubkey (troops returning to)
    pub sender: Pubkey,
    /// Units that returned
    pub units: [u64; 3],
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for ReinforcementReturned {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:ReinforcementReturned");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.sender.pack(&mut buf[offset..]);
        offset += self.units[0].pack(&mut buf[offset..]);
        offset += self.units[1].pack(&mut buf[offset..]);
        offset += self.units[2].pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when reinforcement travel is sped up with gems
pub struct ReinforcementSpeedup {
    /// Reinforcement account pubkey
    pub reinforcement: Pubkey,
    /// Sender who paid for speedup
    pub sender: Pubkey,
    /// Receiver destination
    pub receiver: Pubkey,
    /// Speedup type (1=Traveling, 2=Returning)
    pub speedup_type: u8,
    /// Gems spent
    pub gems_spent: u64,
    /// New estimated arrival time
    pub new_eta: i64,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for ReinforcementSpeedup {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:ReinforcementSpeedup");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.reinforcement.pack(&mut buf[offset..]);
        offset += self.sender.pack(&mut buf[offset..]);
        offset += self.receiver.pack(&mut buf[offset..]);
        offset += self.speedup_type.pack(&mut buf[offset..]);
        offset += self.gems_spent.pack(&mut buf[offset..]);
        offset += self.new_eta.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}
