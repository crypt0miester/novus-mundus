/// Castle system events - King's Castle territorial control

use pinocchio::Address;
use super::{Event, PackBytes, discriminator};

/// Emitted when a new castle is created by DAO
pub struct CastleCreated {
    /// Castle account pubkey
    pub castle: Address,
    /// Castle name (32 bytes UTF-8)
    pub castle_name: [u8; 32],
    /// City where castle is located
    pub city_id: u16,
    /// Castle ID within the city
    pub castle_id: u16,
    /// Castle tier (0=Outpost, 1=Keep, 2=Stronghold, 3=Fortress, 4=Citadel)
    pub tier: u8,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for CastleCreated {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:CastleCreated");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.castle.pack(&mut buf[offset..]);
        buf[offset..offset + 32].copy_from_slice(&self.castle_name);
        offset += 32;
        offset += self.city_id.pack(&mut buf[offset..]);
        offset += self.castle_id.pack(&mut buf[offset..]);
        offset += self.tier.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when a player claims a vacant castle
pub struct CastleClaimed {
    /// Castle account pubkey
    pub castle: Address,
    /// Castle name (32 bytes UTF-8)
    pub castle_name: [u8; 32],
    /// New king (player account pubkey)
    pub king: Address,
    /// Player's name (48 bytes UTF-8)
    pub king_name: [u8; 48],
    /// King's team
    pub team: Address,
    /// Castle tier
    pub tier: u8,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for CastleClaimed {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:CastleClaimed");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.castle.pack(&mut buf[offset..]);
        buf[offset..offset + 32].copy_from_slice(&self.castle_name);
        offset += 32;
        offset += self.king.pack(&mut buf[offset..]);
        buf[offset..offset + 48].copy_from_slice(&self.king_name);
        offset += 48;
        offset += self.team.pack(&mut buf[offset..]);
        offset += self.tier.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when castle control changes hands (via rally attack)
pub struct CastleConquered {
    /// Castle account pubkey
    pub castle: Address,
    /// Castle name (32 bytes UTF-8)
    pub castle_name: [u8; 32],
    /// Previous king
    pub previous_king: Address,
    /// New king
    pub new_king: Address,
    /// New king's name (48 bytes UTF-8)
    pub new_king_name: [u8; 48],
    /// New team
    pub new_team: Address,
    /// Rally ID that conquered
    pub rally_id: u64,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for CastleConquered {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:CastleConquered");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.castle.pack(&mut buf[offset..]);
        buf[offset..offset + 32].copy_from_slice(&self.castle_name);
        offset += 32;
        offset += self.previous_king.pack(&mut buf[offset..]);
        offset += self.new_king.pack(&mut buf[offset..]);
        buf[offset..offset + 48].copy_from_slice(&self.new_king_name);
        offset += 48;
        offset += self.new_team.pack(&mut buf[offset..]);
        offset += self.rally_id.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when a castle defense succeeds
pub struct CastleDefended {
    /// Castle account pubkey
    pub castle: Address,
    /// Castle name (32 bytes UTF-8)
    pub castle_name: [u8; 32],
    /// Defending king
    pub king: Address,
    /// Rally ID that was repelled
    pub rally_id: u64,
    /// Damage dealt by garrison
    pub damage_dealt: u64,
    /// Weapons captured from attackers
    pub weapons_captured: u64,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for CastleDefended {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:CastleDefended");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.castle.pack(&mut buf[offset..]);
        buf[offset..offset + 32].copy_from_slice(&self.castle_name);
        offset += 32;
        offset += self.king.pack(&mut buf[offset..]);
        offset += self.rally_id.pack(&mut buf[offset..]);
        offset += self.damage_dealt.pack(&mut buf[offset..]);
        offset += self.weapons_captured.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when a court member is appointed
pub struct CourtAppointed {
    /// Castle account pubkey
    pub castle: Address,
    /// Castle name (32 bytes UTF-8)
    pub castle_name: [u8; 32],
    /// Player appointed
    pub appointee: Address,
    /// Appointee's name (48 bytes UTF-8)
    pub appointee_name: [u8; 48],
    /// Position type (0=Advisor, 1=Scholar, 2=Guardian, 3=Treasurer, 4=Marshal)
    pub position_type: u8,
    /// King who appointed
    pub appointed_by: Address,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for CourtAppointed {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:CourtAppointed");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.castle.pack(&mut buf[offset..]);
        buf[offset..offset + 32].copy_from_slice(&self.castle_name);
        offset += 32;
        offset += self.appointee.pack(&mut buf[offset..]);
        buf[offset..offset + 48].copy_from_slice(&self.appointee_name);
        offset += 48;
        offset += self.position_type.pack(&mut buf[offset..]);
        offset += self.appointed_by.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when a court member is dismissed
pub struct CourtDismissed {
    /// Castle account pubkey
    pub castle: Address,
    /// Castle name (32 bytes UTF-8)
    pub castle_name: [u8; 32],
    /// Player dismissed
    pub dismissed: Address,
    /// Dismissed player's name (48 bytes UTF-8)
    pub dismissed_name: [u8; 48],
    /// Position type
    pub position_type: u8,
    /// King who dismissed (or NULL if resigned)
    pub dismissed_by: Address,
    /// True if player resigned, false if dismissed by king
    pub resigned: bool,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for CourtDismissed {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:CourtDismissed");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.castle.pack(&mut buf[offset..]);
        buf[offset..offset + 32].copy_from_slice(&self.castle_name);
        offset += 32;
        offset += self.dismissed.pack(&mut buf[offset..]);
        buf[offset..offset + 48].copy_from_slice(&self.dismissed_name);
        offset += 48;
        offset += self.position_type.pack(&mut buf[offset..]);
        offset += self.dismissed_by.pack(&mut buf[offset..]);
        offset += self.resigned.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when a player joins the garrison
pub struct GarrisonJoined {
    /// Castle account pubkey
    pub castle: Address,
    /// Castle name (32 bytes UTF-8)
    pub castle_name: [u8; 32],
    /// Player joining
    pub contributor: Address,
    /// Contributor's name (48 bytes UTF-8)
    pub contributor_name: [u8; 48],
    /// Units committed (tier 1)
    pub units_1: u64,
    /// Units committed (tier 2)
    pub units_2: u64,
    /// Units committed (tier 3)
    pub units_3: u64,
    /// Total weapons committed
    pub weapons: u64,
    /// Hero mint (or NULL if no hero)
    pub hero_mint: Address,
    /// Current garrison count
    pub garrison_count: u8,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for GarrisonJoined {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:GarrisonJoined");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.castle.pack(&mut buf[offset..]);
        buf[offset..offset + 32].copy_from_slice(&self.castle_name);
        offset += 32;
        offset += self.contributor.pack(&mut buf[offset..]);
        buf[offset..offset + 48].copy_from_slice(&self.contributor_name);
        offset += 48;
        offset += self.units_1.pack(&mut buf[offset..]);
        offset += self.units_2.pack(&mut buf[offset..]);
        offset += self.units_3.pack(&mut buf[offset..]);
        offset += self.weapons.pack(&mut buf[offset..]);
        offset += self.hero_mint.pack(&mut buf[offset..]);
        offset += self.garrison_count.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when a player leaves the garrison
pub struct GarrisonLeft {
    /// Castle account pubkey
    pub castle: Address,
    /// Castle name (32 bytes UTF-8)
    pub castle_name: [u8; 32],
    /// Player leaving
    pub contributor: Address,
    /// Contributor's name (48 bytes UTF-8)
    pub contributor_name: [u8; 48],
    /// Units returned (tier 1)
    pub units_1: u64,
    /// Units returned (tier 2)
    pub units_2: u64,
    /// Units returned (tier 3)
    pub units_3: u64,
    /// Total weapons returned
    pub weapons: u64,
    /// Hero mint returned (or NULL if no hero)
    pub hero_mint: Address,
    /// True if relieved by king, false if voluntary
    pub relieved: bool,
    /// Current garrison count
    pub garrison_count: u8,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for GarrisonLeft {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:GarrisonLeft");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.castle.pack(&mut buf[offset..]);
        buf[offset..offset + 32].copy_from_slice(&self.castle_name);
        offset += 32;
        offset += self.contributor.pack(&mut buf[offset..]);
        buf[offset..offset + 48].copy_from_slice(&self.contributor_name);
        offset += 48;
        offset += self.units_1.pack(&mut buf[offset..]);
        offset += self.units_2.pack(&mut buf[offset..]);
        offset += self.units_3.pack(&mut buf[offset..]);
        offset += self.weapons.pack(&mut buf[offset..]);
        offset += self.hero_mint.pack(&mut buf[offset..]);
        offset += self.relieved.pack(&mut buf[offset..]);
        offset += self.garrison_count.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when garrison loot is claimed
pub struct GarrisonLootClaimed {
    /// Castle account pubkey
    pub castle: Address,
    /// Castle name (32 bytes UTF-8)
    pub castle_name: [u8; 32],
    /// Player claiming
    pub claimer: Address,
    /// Claimer's name (48 bytes UTF-8)
    pub claimer_name: [u8; 48],
    /// Melee weapons claimed
    pub melee: u64,
    /// Ranged weapons claimed
    pub ranged: u64,
    /// Siege weapons claimed
    pub siege: u64,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for GarrisonLootClaimed {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:GarrisonLootClaimed");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.castle.pack(&mut buf[offset..]);
        buf[offset..offset + 32].copy_from_slice(&self.castle_name);
        offset += 32;
        offset += self.claimer.pack(&mut buf[offset..]);
        buf[offset..offset + 48].copy_from_slice(&self.claimer_name);
        offset += 48;
        offset += self.melee.pack(&mut buf[offset..]);
        offset += self.ranged.pack(&mut buf[offset..]);
        offset += self.siege.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when castle upgrade is initiated
pub struct CastleUpgradeStarted {
    /// Castle account pubkey
    pub castle: Address,
    /// Castle name (32 bytes UTF-8)
    pub castle_name: [u8; 32],
    /// King initiating upgrade
    pub king: Address,
    /// Upgrade type (1=Fort, 2=Treasury, 3=Chambers, 4=Watchtower, 5=Armory)
    pub upgrade_type: u8,
    /// Current level
    pub current_level: u8,
    /// Target level
    pub target_level: u8,
    /// NOVI cost
    pub novi_cost: u64,
    /// Completion timestamp
    pub completes_at: i64,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for CastleUpgradeStarted {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:CastleUpgradeStarted");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.castle.pack(&mut buf[offset..]);
        buf[offset..offset + 32].copy_from_slice(&self.castle_name);
        offset += 32;
        offset += self.king.pack(&mut buf[offset..]);
        offset += self.upgrade_type.pack(&mut buf[offset..]);
        offset += self.current_level.pack(&mut buf[offset..]);
        offset += self.target_level.pack(&mut buf[offset..]);
        offset += self.novi_cost.pack(&mut buf[offset..]);
        offset += self.completes_at.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when castle upgrade completes
pub struct CastleUpgradeCompleted {
    /// Castle account pubkey
    pub castle: Address,
    /// Castle name (32 bytes UTF-8)
    pub castle_name: [u8; 32],
    /// Upgrade type
    pub upgrade_type: u8,
    /// New level achieved
    pub new_level: u8,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for CastleUpgradeCompleted {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:CastleUpgradeCompleted");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.castle.pack(&mut buf[offset..]);
        buf[offset..offset + 32].copy_from_slice(&self.castle_name);
        offset += 32;
        offset += self.upgrade_type.pack(&mut buf[offset..]);
        offset += self.new_level.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when castle upgrade is cancelled
pub struct CastleUpgradeCancelled {
    /// Castle account pubkey
    pub castle: Address,
    /// Castle name (32 bytes UTF-8)
    pub castle_name: [u8; 32],
    /// Upgrade type that was cancelled
    pub upgrade_type: u8,
    /// NOVI refunded
    pub novi_refunded: u64,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for CastleUpgradeCancelled {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:CastleUpgradeCancelled");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.castle.pack(&mut buf[offset..]);
        buf[offset..offset + 32].copy_from_slice(&self.castle_name);
        offset += 32;
        offset += self.upgrade_type.pack(&mut buf[offset..]);
        offset += self.novi_refunded.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when castle rewards are claimed
pub struct CastleRewardsClaimed {
    /// Castle account pubkey
    pub castle: Address,
    /// Castle name (32 bytes UTF-8)
    pub castle_name: [u8; 32],
    /// Player claiming
    pub claimer: Address,
    /// Claimer's name (48 bytes UTF-8)
    pub claimer_name: [u8; 48],
    /// Role: 0=King, 1=Court, 2=TeamMember
    pub role: u8,
    /// Days worth of rewards
    pub days: u8,
    /// NOVI claimed
    pub novi: u64,
    /// Cash claimed
    pub cash: u64,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for CastleRewardsClaimed {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:CastleRewardsClaimed");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.castle.pack(&mut buf[offset..]);
        buf[offset..offset + 32].copy_from_slice(&self.castle_name);
        offset += 32;
        offset += self.claimer.pack(&mut buf[offset..]);
        buf[offset..offset + 48].copy_from_slice(&self.claimer_name);
        offset += 48;
        offset += self.role.pack(&mut buf[offset..]);
        offset += self.days.pack(&mut buf[offset..]);
        offset += self.novi.pack(&mut buf[offset..]);
        offset += self.cash.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when protection period ends
pub struct CastleProtectionExpired {
    /// Castle account pubkey
    pub castle: Address,
    /// Castle name (32 bytes UTF-8)
    pub castle_name: [u8; 32],
    /// King whose protection expired
    pub king: Address,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for CastleProtectionExpired {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:CastleProtectionExpired");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.castle.pack(&mut buf[offset..]);
        buf[offset..offset + 32].copy_from_slice(&self.castle_name);
        offset += 32;
        offset += self.king.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when a king is forcefully removed by DAO
pub struct KingForceRemoved {
    /// Castle account pubkey
    pub castle: Address,
    /// Castle name (32 bytes UTF-8)
    pub castle_name: [u8; 32],
    /// King who was removed
    pub removed_king: Address,
    /// Removed king's name (48 bytes UTF-8)
    pub removed_king_name: [u8; 48],
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for KingForceRemoved {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:KingForceRemoved");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.castle.pack(&mut buf[offset..]);
        buf[offset..offset + 32].copy_from_slice(&self.castle_name);
        offset += 32;
        offset += self.removed_king.pack(&mut buf[offset..]);
        buf[offset..offset + 48].copy_from_slice(&self.removed_king_name);
        offset += 48;
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when transition phase progresses
pub struct CastleTransitionProgress {
    /// Castle account pubkey
    pub castle: Address,
    /// Phase: "garrison", "court", "rewards", "finalize"
    pub phase: u8,
    /// Items cleaned in this phase
    pub cleaned_count: u8,
    /// Total items to clean
    pub total_count: u8,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for CastleTransitionProgress {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:CastleTransitionProgress");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.castle.pack(&mut buf[offset..]);
        offset += self.phase.pack(&mut buf[offset..]);
        offset += self.cleaned_count.pack(&mut buf[offset..]);
        offset += self.total_count.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when castle status changes via permissionless update
pub struct CastleStatusChanged {
    /// Castle account pubkey
    pub castle: Address,
    /// Castle name (32 bytes UTF-8)
    pub castle_name: [u8; 32],
    /// Previous status
    pub old_status: u8,
    /// New status
    pub new_status: u8,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for CastleStatusChanged {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:CastleStatusChanged");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.castle.pack(&mut buf[offset..]);
        buf[offset..offset + 32].copy_from_slice(&self.castle_name);
        offset += 32;
        offset += self.old_status.pack(&mut buf[offset..]);
        offset += self.new_status.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when a castle is attacked (solo attack, not rally)
pub struct CastleAttacked {
    /// Castle account pubkey
    pub castle: Address,
    /// Castle name (32 bytes UTF-8)
    pub castle_name: [u8; 32],
    /// Attacker player
    pub attacker: Address,
    /// Attacker name (48 bytes UTF-8)
    pub attacker_name: [u8; 48],
    /// Defending king
    pub king: Address,
    /// Damage dealt to garrison
    pub damage_dealt: u64,
    /// Damage received by attacker
    pub damage_received: u64,
    /// Attacker casualties
    pub attacker_casualties: u64,
    /// Garrison casualties
    pub garrison_casualties: u64,
    /// Whether attacker won (conquered castle)
    pub attacker_won: bool,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for CastleAttacked {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:CastleAttacked");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.castle.pack(&mut buf[offset..]);
        buf[offset..offset + 32].copy_from_slice(&self.castle_name);
        offset += 32;
        offset += self.attacker.pack(&mut buf[offset..]);
        buf[offset..offset + 48].copy_from_slice(&self.attacker_name);
        offset += 48;
        offset += self.king.pack(&mut buf[offset..]);
        offset += self.damage_dealt.pack(&mut buf[offset..]);
        offset += self.damage_received.pack(&mut buf[offset..]);
        offset += self.attacker_casualties.pack(&mut buf[offset..]);
        offset += self.garrison_casualties.pack(&mut buf[offset..]);
        offset += self.attacker_won.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}
