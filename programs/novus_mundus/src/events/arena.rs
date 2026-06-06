use super::{discriminator, Event, PackBytes};
/// Arena events - PvP arena battles, season participation, and reward claims
use pinocchio::Address;

/// Emitted when an arena battle is resolved (challenge_player)
pub struct ArenaBattleResolved {
    /// Season identifier within the kingdom
    pub season_id: u32,
    /// Battle sequence id (season.total_battles after increment)
    pub battle_id: u64,
    /// Challenger's player account pubkey (not wallet)
    pub challenger: Address,
    /// Defender's player account pubkey (not wallet)
    pub defender: Address,
    /// Challenger's computed arena power
    pub challenger_power: u64,
    /// Defender's computed arena power
    pub defender_power: u64,
    /// Whether the challenger won
    pub challenger_won: bool,
    /// Points awarded to the challenger this battle
    pub challenger_points: u64,
    /// Points awarded to the defender this battle
    pub defender_points: u64,
    /// Challenger's new ELO rating after the battle
    pub new_challenger_elo: u32,
    /// Defender's new ELO rating after the battle
    pub new_defender_elo: u32,
    /// Unix timestamp
    pub timestamp: i64,
    /// Slot the battle was resolved at
    pub slot: u64,
}

impl Event for ArenaBattleResolved {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:ArenaBattleResolved");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.season_id.pack(&mut buf[offset..]);
        offset += self.battle_id.pack(&mut buf[offset..]);
        offset += self.challenger.pack(&mut buf[offset..]);
        offset += self.defender.pack(&mut buf[offset..]);
        offset += self.challenger_power.pack(&mut buf[offset..]);
        offset += self.defender_power.pack(&mut buf[offset..]);
        offset += self.challenger_won.pack(&mut buf[offset..]);
        offset += self.challenger_points.pack(&mut buf[offset..]);
        offset += self.defender_points.pack(&mut buf[offset..]);
        offset += self.new_challenger_elo.pack(&mut buf[offset..]);
        offset += self.new_defender_elo.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset += self.slot.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when a player joins an arena season (join_season)
pub struct ArenaPlayerJoined {
    /// Season identifier within the kingdom
    pub season_id: u32,
    /// Player account pubkey (not wallet)
    pub player: Address,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for ArenaPlayerJoined {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:ArenaPlayerJoined");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.season_id.pack(&mut buf[offset..]);
        offset += self.player.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when a daily arena reward is claimed (claim_daily_reward)
pub struct ArenaDailyRewardClaimed {
    /// Season identifier within the kingdom
    pub season_id: u32,
    /// Player account pubkey (not wallet)
    pub player: Address,
    /// NOVI amount paid for the daily reward
    pub amount: u64,
    /// Battles fought in the rolling 24h window
    pub battles_fought: u8,
    /// Unique opponents fought in the rolling 24h window
    pub unique_opponents: u8,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for ArenaDailyRewardClaimed {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:ArenaDailyRewardClaimed");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.season_id.pack(&mut buf[offset..]);
        offset += self.player.pack(&mut buf[offset..]);
        offset += self.amount.pack(&mut buf[offset..]);
        offset += self.battles_fought.pack(&mut buf[offset..]);
        offset += self.unique_opponents.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when a master (leaderboard) arena reward is claimed (claim_master_reward)
pub struct ArenaMasterRewardClaimed {
    /// Season identifier within the kingdom
    pub season_id: u32,
    /// Player account pubkey (not wallet)
    pub player: Address,
    /// 1-based leaderboard rank
    pub rank: u8,
    /// NOVI amount paid for the master reward
    pub amount: u64,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for ArenaMasterRewardClaimed {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:ArenaMasterRewardClaimed");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.season_id.pack(&mut buf[offset..]);
        offset += self.player.pack(&mut buf[offset..]);
        offset += self.rank.pack(&mut buf[offset..]);
        offset += self.amount.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when an arena season transitions to Finalized (lazy auto-finalize)
pub struct ArenaSeasonFinalized {
    /// Season identifier within the kingdom
    pub season_id: u32,
    /// Total battles fought across the season
    pub total_battles: u64,
    /// Number of populated leaderboard entries
    pub leaderboard_count: u8,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for ArenaSeasonFinalized {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:ArenaSeasonFinalized");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.season_id.pack(&mut buf[offset..]);
        offset += self.total_battles.pack(&mut buf[offset..]);
        offset += self.leaderboard_count.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}
