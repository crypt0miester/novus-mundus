/// Dungeon system events - The Catacombs roguelike PvE

use pinocchio::Address;
use super::{Event, PackBytes, discriminator};

/// Emitted when a player enters a dungeon
pub struct DungeonEntered {
    /// Player account pubkey (not wallet)
    pub player: Address,
    /// Player's name (48 bytes UTF-8)
    pub player_name: [u8; 48],
    /// Dungeon template ID
    pub dungeon_id: u16,
    /// Hero NFT mint locked in dungeon
    pub hero_mint: Address,
    /// Hero name (32 bytes UTF-8)
    pub hero_name: [u8; 32],
    /// Stamina spent to enter
    pub stamina_spent: u16,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for DungeonEntered {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:DungeonEntered");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.player.pack(&mut buf[offset..]);
        offset += self.player_name.pack(&mut buf[offset..]);
        offset += self.dungeon_id.pack(&mut buf[offset..]);
        offset += self.hero_mint.pack(&mut buf[offset..]);
        offset += self.hero_name.pack(&mut buf[offset..]);
        offset += self.stamina_spent.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when a room is cleared (combat or interaction)
pub struct DungeonRoomCleared {
    /// Player account pubkey (not wallet)
    pub player: Address,
    /// Player's name (48 bytes UTF-8)
    pub player_name: [u8; 48],
    /// Dungeon template ID
    pub dungeon_id: u16,
    /// Current floor (1-indexed)
    pub floor: u8,
    /// Current room (1-indexed)
    pub room: u8,
    /// XP gained from this room
    pub xp_gained: u64,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for DungeonRoomCleared {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:DungeonRoomCleared");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.player.pack(&mut buf[offset..]);
        offset += self.player_name.pack(&mut buf[offset..]);
        offset += self.dungeon_id.pack(&mut buf[offset..]);
        offset += self.floor.pack(&mut buf[offset..]);
        offset += self.room.pack(&mut buf[offset..]);
        offset += self.xp_gained.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when a floor is completed
pub struct DungeonFloorCompleted {
    /// Player account pubkey (not wallet)
    pub player: Address,
    /// Player's name (48 bytes UTF-8)
    pub player_name: [u8; 48],
    /// Dungeon template ID
    pub dungeon_id: u16,
    /// Floor just completed (1-indexed)
    pub floor: u8,
    /// NOVI gained for this floor
    pub novi_gained: u64,
    /// Whether this floor is a checkpoint
    pub is_checkpoint: bool,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for DungeonFloorCompleted {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:DungeonFloorCompleted");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.player.pack(&mut buf[offset..]);
        offset += self.player_name.pack(&mut buf[offset..]);
        offset += self.dungeon_id.pack(&mut buf[offset..]);
        offset += self.floor.pack(&mut buf[offset..]);
        offset += self.novi_gained.pack(&mut buf[offset..]);
        offset += self.is_checkpoint.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when a relic is chosen between floors
pub struct DungeonRelicChosen {
    /// Player account pubkey (not wallet)
    pub player: Address,
    /// Player's name (48 bytes UTF-8)
    pub player_name: [u8; 48],
    /// Dungeon template ID
    pub dungeon_id: u16,
    /// Floor just completed (before advancing)
    pub floor: u8,
    /// Relic ID chosen (0-19)
    pub relic_id: u8,
    /// Total relics now owned
    pub total_relics: u8,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for DungeonRelicChosen {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:DungeonRelicChosen");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.player.pack(&mut buf[offset..]);
        offset += self.player_name.pack(&mut buf[offset..]);
        offset += self.dungeon_id.pack(&mut buf[offset..]);
        offset += self.floor.pack(&mut buf[offset..]);
        offset += self.relic_id.pack(&mut buf[offset..]);
        offset += self.total_relics.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when boss fight begins (final floor)
pub struct DungeonBossFight {
    /// Player account pubkey (not wallet)
    pub player: Address,
    /// Player's name (48 bytes UTF-8)
    pub player_name: [u8; 48],
    /// Dungeon template ID
    pub dungeon_id: u16,
    /// Floor number (final floor)
    pub floor: u8,
    /// Boss power level
    pub boss_power: u32,
    /// Boss starting health
    pub boss_health: u64,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for DungeonBossFight {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:DungeonBossFight");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.player.pack(&mut buf[offset..]);
        offset += self.player_name.pack(&mut buf[offset..]);
        offset += self.dungeon_id.pack(&mut buf[offset..]);
        offset += self.floor.pack(&mut buf[offset..]);
        offset += self.boss_power.pack(&mut buf[offset..]);
        offset += self.boss_health.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when a dungeon run fails (units wiped)
pub struct DungeonFailed {
    /// Player account pubkey (not wallet)
    pub player: Address,
    /// Player's name (48 bytes UTF-8)
    pub player_name: [u8; 48],
    /// Dungeon template ID
    pub dungeon_id: u16,
    /// Floor where failure occurred
    pub floor: u8,
    /// Room where failure occurred
    pub room: u8,
    /// Total enemies killed before failure
    pub enemies_killed: u16,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for DungeonFailed {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:DungeonFailed");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.player.pack(&mut buf[offset..]);
        offset += self.player_name.pack(&mut buf[offset..]);
        offset += self.dungeon_id.pack(&mut buf[offset..]);
        offset += self.floor.pack(&mut buf[offset..]);
        offset += self.room.pack(&mut buf[offset..]);
        offset += self.enemies_killed.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when player flees dungeon early
pub struct DungeonFled {
    /// Player account pubkey (not wallet)
    pub player: Address,
    /// Player's name (48 bytes UTF-8)
    pub player_name: [u8; 48],
    /// Dungeon template ID
    pub dungeon_id: u16,
    /// Floor when fleeing
    pub floor: u8,
    /// Total enemies killed
    pub enemies_killed: u16,
    /// XP gained (after flee penalty)
    pub xp_gained: u64,
    /// NOVI gained (after flee penalty)
    pub novi_gained: u64,
    /// Gems gained (after flee penalty)
    pub gems_gained: u64,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for DungeonFled {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:DungeonFled");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.player.pack(&mut buf[offset..]);
        offset += self.player_name.pack(&mut buf[offset..]);
        offset += self.dungeon_id.pack(&mut buf[offset..]);
        offset += self.floor.pack(&mut buf[offset..]);
        offset += self.enemies_killed.pack(&mut buf[offset..]);
        offset += self.xp_gained.pack(&mut buf[offset..]);
        offset += self.novi_gained.pack(&mut buf[offset..]);
        offset += self.gems_gained.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when dungeon run is completed and rewards claimed
pub struct DungeonCompleted {
    /// Player account pubkey (not wallet)
    pub player: Address,
    /// Player's name (48 bytes UTF-8)
    pub player_name: [u8; 48],
    /// Dungeon template ID
    pub dungeon_id: u16,
    /// Whether the run was a victory (vs failure/checkpoint claim)
    pub victory: bool,
    /// Final floor reached
    pub final_floor: u8,
    /// Total enemies killed
    pub enemies_killed: u16,
    /// Total rooms cleared
    pub rooms_cleared: u8,
    /// Total relics collected
    pub relics_collected: u8,
    /// XP gained
    pub xp_gained: u64,
    /// NOVI gained
    pub novi_gained: u64,
    /// Gems gained
    pub gems_gained: u64,
    /// Materials gained
    pub materials_gained: u32,
    /// Total damage dealt during run
    pub total_damage_dealt: u64,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for DungeonCompleted {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:DungeonCompleted");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.player.pack(&mut buf[offset..]);
        offset += self.player_name.pack(&mut buf[offset..]);
        offset += self.dungeon_id.pack(&mut buf[offset..]);
        offset += self.victory.pack(&mut buf[offset..]);
        offset += self.final_floor.pack(&mut buf[offset..]);
        offset += self.enemies_killed.pack(&mut buf[offset..]);
        offset += self.rooms_cleared.pack(&mut buf[offset..]);
        offset += self.relics_collected.pack(&mut buf[offset..]);
        offset += self.xp_gained.pack(&mut buf[offset..]);
        offset += self.novi_gained.pack(&mut buf[offset..]);
        offset += self.gems_gained.pack(&mut buf[offset..]);
        offset += self.materials_gained.pack(&mut buf[offset..]);
        offset += self.total_damage_dealt.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when player resumes from checkpoint after failure
pub struct DungeonResumed {
    /// Player account pubkey (not wallet)
    pub player: Address,
    /// Player's name (48 bytes UTF-8)
    pub player_name: [u8; 48],
    /// Dungeon template ID
    pub dungeon_id: u16,
    /// Checkpoint floor resumed from
    pub checkpoint_floor: u8,
    /// Floor now starting (checkpoint + 1)
    pub resume_floor: u8,
    /// Gems spent to resume
    pub gem_cost: u64,
    /// Number of times resumed this run
    pub resume_count: u8,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for DungeonResumed {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:DungeonResumed");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.player.pack(&mut buf[offset..]);
        offset += self.player_name.pack(&mut buf[offset..]);
        offset += self.dungeon_id.pack(&mut buf[offset..]);
        offset += self.checkpoint_floor.pack(&mut buf[offset..]);
        offset += self.resume_floor.pack(&mut buf[offset..]);
        offset += self.gem_cost.pack(&mut buf[offset..]);
        offset += self.resume_count.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when player claims their weekly leaderboard prize
pub struct DungeonLeaderboardPrizeClaimed {
    /// Player account pubkey (not wallet)
    pub player: Address,
    /// Player's name (48 bytes UTF-8)
    pub player_name: [u8; 48],
    /// Dungeon template ID
    pub dungeon_id: u16,
    /// Week number of the leaderboard
    pub week_number: u16,
    /// Player's rank (0-indexed, 0 = first place)
    pub rank: u8,
    /// Score achieved
    pub score: u64,
    /// NOVI prize amount claimed
    pub prize_amount: u64,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for DungeonLeaderboardPrizeClaimed {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:DungeonLeaderboardPrizeClaimed");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.player.pack(&mut buf[offset..]);
        offset += self.player_name.pack(&mut buf[offset..]);
        offset += self.dungeon_id.pack(&mut buf[offset..]);
        offset += self.week_number.pack(&mut buf[offset..]);
        offset += self.rank.pack(&mut buf[offset..]);
        offset += self.score.pack(&mut buf[offset..]);
        offset += self.prize_amount.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}
