use super::{discriminator, Event, PackBytes};
/// Game event events - event creation, participation, finalization
use pinocchio::Address;

/// Emitted when a game event is created
pub struct GameEventCreated {
    /// Event account pubkey
    pub event: Address,
    /// Event type (0=pvp, 1=boss, 2=territory, etc.)
    pub event_type: u8,
    /// Start timestamp
    pub start_time: i64,
    /// End timestamp
    pub end_time: i64,
    /// Prize pool (NOVI)
    pub prize_pool: u64,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for GameEventCreated {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:GameEventCreated");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.event.pack(&mut buf[offset..]);
        offset += self.event_type.pack(&mut buf[offset..]);
        offset += self.start_time.pack(&mut buf[offset..]);
        offset += self.end_time.pack(&mut buf[offset..]);
        offset += self.prize_pool.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when a player joins a game event
pub struct GameEventJoined {
    /// Event account pubkey
    pub event: Address,
    /// Player account pubkey (not wallet)
    pub player: Address,
    /// Player's name (48 bytes UTF-8)
    pub player_name: [u8; 48],
    /// Entry fee paid (if any)
    pub entry_fee: u64,
    /// Total participants after joining
    pub participant_count: u32,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for GameEventJoined {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:GameEventJoined");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.event.pack(&mut buf[offset..]);
        offset += self.player.pack(&mut buf[offset..]);
        offset += self.player_name.pack(&mut buf[offset..]);
        offset += self.entry_fee.pack(&mut buf[offset..]);
        offset += self.participant_count.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when a player leaves a game event (after it finalizes or cancels)
pub struct GameEventLeft {
    /// Event account pubkey
    pub event: Address,
    /// Player account pubkey (not wallet)
    pub player: Address,
    /// Player's name (48 bytes UTF-8)
    pub player_name: [u8; 48],
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for GameEventLeft {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:GameEventLeft");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.event.pack(&mut buf[offset..]);
        offset += self.player.pack(&mut buf[offset..]);
        offset += self.player_name.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when a game event is finalized
pub struct GameEventFinalized {
    /// Event account pubkey
    pub event: Address,
    /// Total participants
    pub total_participants: u32,
    /// Total prize pool distributed
    pub total_prizes: u64,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for GameEventFinalized {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:GameEventFinalized");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.event.pack(&mut buf[offset..]);
        offset += self.total_participants.pack(&mut buf[offset..]);
        offset += self.total_prizes.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when a player's score is updated in an event
pub struct EventScoreUpdated {
    /// Event account pubkey
    pub event: Address,
    /// Player account pubkey (not wallet)
    pub player: Address,
    /// Player's name (48 bytes UTF-8)
    pub player_name: [u8; 48],
    /// Score delta (positive = increase)
    pub score_delta: i64,
    /// New total score
    pub new_score: u64,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for EventScoreUpdated {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:EventScoreUpdated");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.event.pack(&mut buf[offset..]);
        offset += self.player.pack(&mut buf[offset..]);
        offset += self.player_name.pack(&mut buf[offset..]);
        offset += self.score_delta.pack(&mut buf[offset..]);
        offset += self.new_score.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}
