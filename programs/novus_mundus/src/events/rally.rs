/// Rally events - group combat coordination

use pinocchio::Address;
use super::{Event, PackBytes, discriminator};

/// Emitted when a rally is created
pub struct RallyCreated {
    /// Rally account pubkey
    pub rally: Address,
    /// Team account pubkey
    pub team: Address,
    /// Team name (32 bytes UTF-8)
    pub team_name: [u8; 32],
    /// Rally leader's player account (not wallet)
    pub leader: Address,
    /// Target player account pubkey
    pub target: Address,
    /// Gather deadline timestamp
    pub gather_at: i64,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for RallyCreated {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:RallyCreated");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.rally.pack(&mut buf[offset..]);
        offset += self.team.pack(&mut buf[offset..]);
        offset += self.team_name.pack(&mut buf[offset..]);
        offset += self.leader.pack(&mut buf[offset..]);
        offset += self.target.pack(&mut buf[offset..]);
        offset += self.gather_at.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when a player joins a rally
pub struct RallyJoined {
    /// Rally account pubkey
    pub rally: Address,
    /// Team name (32 bytes UTF-8)
    pub team_name: [u8; 32],
    /// Player account who joined (not wallet)
    pub player: Address,
    /// Units committed (defensive_1, defensive_2, defensive_3)
    pub units: [u64; 3],
    /// Current participant count
    pub participant_count: u8,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for RallyJoined {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:RallyJoined");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.rally.pack(&mut buf[offset..]);
        offset += self.team_name.pack(&mut buf[offset..]);
        offset += self.player.pack(&mut buf[offset..]);
        offset += self.units[0].pack(&mut buf[offset..]);
        offset += self.units[1].pack(&mut buf[offset..]);
        offset += self.units[2].pack(&mut buf[offset..]);
        offset += self.participant_count.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when a rally is executed (combat resolved)
pub struct RallyExecuted {
    /// Rally account pubkey
    pub rally: Address,
    /// Team name (32 bytes UTF-8)
    pub team_name: [u8; 32],
    /// Target player account
    pub target: Address,
    /// Total damage dealt to target
    pub damage_dealt: u64,
    /// Total damage received
    pub damage_received: u64,
    /// Total loot captured
    pub loot_captured: u64,
    /// Participant count
    pub participant_count: u8,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for RallyExecuted {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:RallyExecuted");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.rally.pack(&mut buf[offset..]);
        offset += self.team_name.pack(&mut buf[offset..]);
        offset += self.target.pack(&mut buf[offset..]);
        offset += self.damage_dealt.pack(&mut buf[offset..]);
        offset += self.damage_received.pack(&mut buf[offset..]);
        offset += self.loot_captured.pack(&mut buf[offset..]);
        offset += self.participant_count.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when a rally is cancelled
pub struct RallyCancelled {
    /// Rally account pubkey
    pub rally: Address,
    /// Team name (32 bytes UTF-8)
    pub team_name: [u8; 32],
    /// Player account who cancelled (leader) (not wallet)
    pub cancelled_by: Address,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for RallyCancelled {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:RallyCancelled");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.rally.pack(&mut buf[offset..]);
        offset += self.team_name.pack(&mut buf[offset..]);
        offset += self.cancelled_by.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when a player leaves a rally during gathering
pub struct RallyLeft {
    /// Rally account pubkey
    pub rally: Address,
    /// Team name (32 bytes UTF-8)
    pub team_name: [u8; 32],
    /// Player account who left (not wallet)
    pub player: Address,
    /// Units refunded to return journey
    pub units: [u64; 3],
    /// Remaining participant count
    pub participant_count: u8,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for RallyLeft {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:RallyLeft");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.rally.pack(&mut buf[offset..]);
        offset += self.team_name.pack(&mut buf[offset..]);
        offset += self.player.pack(&mut buf[offset..]);
        offset += self.units[0].pack(&mut buf[offset..]);
        offset += self.units[1].pack(&mut buf[offset..]);
        offset += self.units[2].pack(&mut buf[offset..]);
        offset += self.participant_count.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when a rally account is closed and rent refunded
pub struct RallyClosed {
    /// Rally account pubkey
    pub rally: Address,
    /// Rally ID
    pub rally_id: u64,
    /// Team name (32 bytes UTF-8)
    pub team_name: [u8; 32],
    /// Leader's player account who received rent (not wallet)
    pub leader: Address,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for RallyClosed {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:RallyClosed");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.rally.pack(&mut buf[offset..]);
        offset += self.rally_id.pack(&mut buf[offset..]);
        offset += self.team_name.pack(&mut buf[offset..]);
        offset += self.leader.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when rally travel is sped up
pub struct RallySpeedup {
    /// Rally account pubkey
    pub rally: Address,
    /// Team name (32 bytes UTF-8)
    pub team_name: [u8; 32],
    /// Player account who paid for speedup (not wallet)
    pub payer: Address,
    /// Speedup type (0=Gather, 1=March, 2=Return)
    pub speedup_type: u8,
    /// Gems spent
    pub gems_spent: u64,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for RallySpeedup {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:RallySpeedup");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.rally.pack(&mut buf[offset..]);
        offset += self.team_name.pack(&mut buf[offset..]);
        offset += self.payer.pack(&mut buf[offset..]);
        offset += self.speedup_type.pack(&mut buf[offset..]);
        offset += self.gems_spent.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when a participant returns from a rally
pub struct RallyParticipantReturned {
    /// Rally account pubkey
    pub rally: Address,
    /// Team name (32 bytes UTF-8)
    pub team_name: [u8; 32],
    /// Player account who returned (not wallet)
    pub player: Address,
    /// Whether they participated in combat
    pub participated_in_combat: bool,
    /// Units returned
    pub units_returned: [u64; 3],
    /// Loot received (cash + produce + vehicles)
    pub loot_received: u64,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for RallyParticipantReturned {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:RallyParticipantReturned");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.rally.pack(&mut buf[offset..]);
        offset += self.team_name.pack(&mut buf[offset..]);
        offset += self.player.pack(&mut buf[offset..]);
        offset += self.participated_in_combat.pack(&mut buf[offset..]);
        offset += self.units_returned[0].pack(&mut buf[offset..]);
        offset += self.units_returned[1].pack(&mut buf[offset..]);
        offset += self.units_returned[2].pack(&mut buf[offset..]);
        offset += self.loot_received.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}
