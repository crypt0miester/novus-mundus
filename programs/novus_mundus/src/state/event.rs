use pinocchio::pubkey::Pubkey;

use super::player::NULL_PUBKEY;

/// Leaderboard entry (player + score)
#[repr(C)]
#[derive(Copy, Clone)]
pub struct LeaderboardEntry {
    pub player: Pubkey,                         // 32 bytes
    pub score: u64,                             // 8 bytes
}

impl LeaderboardEntry {
    pub const LEN: usize = core::mem::size_of::<Self>();
}

/// Event account with top-10 leaderboard
#[repr(C)]
#[derive(Copy, Clone)]
pub struct EventAccount {
    pub id: u64,                                // 8 bytes
    pub name: [u8; 64],                         // 64 bytes
    pub name_len: u8,                           // 1 byte
    pub _padding1: [u8; 7],                     // 7 bytes

    pub start_time: i64,                        // 8 bytes
    pub end_time: i64,                          // 8 bytes
    pub status: u8,                             // 1 byte (0=pending, 1=active, 2=finalized, 3=cancelled)
    pub auto_activate: bool,                    // 1 byte (if true, auto-activate at start_time)
    pub _padding2: [u8; 6],                     // 6 bytes

    // Event scoring type
    pub event_type: u8,                         // 1 byte (EventType enum)
    pub _padding3: [u8; 7],                     // 7 bytes

    // Participation requirements (all must pass, 0 = no requirement)
    pub min_level: u8,                          // 1 byte
    pub _padding4: [u8; 7],                     // 7 bytes
    pub min_reputation: u64,                    // 8 bytes
    pub required_subscription_tier: u8,         // 1 byte
    pub _padding5: [u8; 7],                     // 7 bytes

    // Leaderboard (top 10, sorted descending by score)
    pub leaderboard: [LeaderboardEntry; 10],    // 40 * 10 = 400 bytes
    pub leaderboard_count: u8,                  // 1 byte (0-10)
    pub _padding6: [u8; 7],                     // 7 bytes

    // Prize pool (supports 4 types)
    pub prize_type: u8,                         // 1 byte (0=LockedNovi, 1=Gems, 2=Cash, 3=SPLToken)
    pub _padding7: [u8; 7],                     // 7 bytes
    pub prize_amount: u64,                      // 8 bytes (total pool)
    pub prize_remaining: u64,                   // 8 bytes (decrements as claimed)
    pub prize_token_mint: Pubkey,               // 32 bytes (only used if prize_type=SPLToken)

    pub participant_count: u32,                 // 4 bytes
    pub _padding8: [u8; 4],                     // 4 bytes
}

impl EventAccount {
    pub const LEN: usize = core::mem::size_of::<Self>();
    pub const MAX_LEADERBOARD: usize = 10;

    pub unsafe fn load(data: &[u8]) -> &Self {
        &*(data.as_ptr() as *const Self)
    }

    pub unsafe fn load_mut(data: &mut [u8]) -> &mut Self {
        &mut *(data.as_mut_ptr() as *mut Self)
    }

    /// Get event name as &str
    pub fn name(&self) -> &str {
        core::str::from_utf8(&self.name[0..self.name_len as usize])
            .unwrap_or("")
    }

    /// Get current leaderboard slice
    pub fn leaderboard(&self) -> &[LeaderboardEntry] {
        &self.leaderboard[0..self.leaderboard_count as usize]
    }

    /// Find player's rank in leaderboard (0-indexed, None if not in top 10)
    pub fn find_rank(&self, player: &Pubkey) -> Option<usize> {
        self.leaderboard()
            .iter()
            .position(|entry| &entry.player == player)
    }
}

/// Event participation tracking (PDA per player per event)
/// PDA: ["event_participation", event_id_bytes, player_owner]
///
/// NOTE: This account is CLOSED after claiming prize (rent refunded to winner)
#[repr(C)]
#[derive(Copy, Clone)]
pub struct EventParticipation {
    pub event_id: u64,                          // 8 bytes
    pub player: Pubkey,                         // 32 bytes
    pub score: u64,                             // 8 bytes
    pub joined_at: i64,                         // 8 bytes
    pub last_update: i64,                       // 8 bytes
    pub _padding: [u8; 8],                      // 8 bytes (increased from 7)
}

impl EventParticipation {
    pub const LEN: usize = core::mem::size_of::<Self>();

    pub unsafe fn load(data: &[u8]) -> &Self {
        &*(data.as_ptr() as *const Self)
    }

    pub unsafe fn load_mut(data: &mut [u8]) -> &mut Self {
        &mut *(data.as_mut_ptr() as *mut Self)
    }

    /// Initialize new participation
    pub fn new(event_id: u64, player: Pubkey, joined_at: i64) -> Self {
        Self {
            event_id,
            player,
            score: 0,
            joined_at,
            last_update: joined_at,
            _padding: [0; 8],
        }
    }
}
