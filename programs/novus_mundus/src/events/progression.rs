use super::{discriminator, Event, PackBytes};
/// Progression events - daily rewards, subscriptions, achievements
use pinocchio::Address;

/// Emitted when daily reward is claimed
pub struct DailyRewardClaimed {
    /// Player account pubkey (not wallet)
    pub player: Address,
    /// Player's name (48 bytes UTF-8)
    pub player_name: [u8; 48],
    /// Cash rewarded
    pub cash: u64,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for DailyRewardClaimed {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:DailyRewardClaimed");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.player.pack(&mut buf[offset..]);
        offset += self.player_name.pack(&mut buf[offset..]);
        offset += self.cash.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when a subscription is purchased
pub struct SubscriptionPurchased {
    /// Player account pubkey (not wallet)
    pub player: Address,
    /// Player's name (48 bytes UTF-8)
    pub player_name: [u8; 48],
    /// Subscription tier
    pub tier: u8,
    /// Duration in days
    pub duration_days: u16,
    /// NOVI paid
    pub novi_paid: u64,
    /// Expiration timestamp
    pub expires_at: i64,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for SubscriptionPurchased {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:SubscriptionPurchased");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.player.pack(&mut buf[offset..]);
        offset += self.player_name.pack(&mut buf[offset..]);
        offset += self.tier.pack(&mut buf[offset..]);
        offset += self.duration_days.pack(&mut buf[offset..]);
        offset += self.novi_paid.pack(&mut buf[offset..]);
        offset += self.expires_at.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when player gains XP
pub struct XpGained {
    /// Player account pubkey (not wallet)
    pub player: Address,
    /// Player's name (48 bytes UTF-8)
    pub player_name: [u8; 48],
    /// XP amount gained
    pub amount: u64,
    /// Source of XP (0=combat, 1=collection, 2=daily, 3=travel, 4=subscription)
    pub source: u8,
    /// New total XP
    pub total_xp: u64,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for XpGained {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:XpGained");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.player.pack(&mut buf[offset..]);
        offset += self.player_name.pack(&mut buf[offset..]);
        offset += self.amount.pack(&mut buf[offset..]);
        offset += self.source.pack(&mut buf[offset..]);
        offset += self.total_xp.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when player levels up
pub struct PlayerLeveledUp {
    /// Player account pubkey (not wallet)
    pub player: Address,
    /// Player's name (48 bytes UTF-8)
    pub player_name: [u8; 48],
    /// Previous level
    pub old_level: u16,
    /// New level
    pub new_level: u16,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for PlayerLeveledUp {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:PlayerLeveledUp");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.player.pack(&mut buf[offset..]);
        offset += self.player_name.pack(&mut buf[offset..]);
        offset += self.old_level.pack(&mut buf[offset..]);
        offset += self.new_level.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when a game event prize is claimed
pub struct EventPrizeClaimed {
    /// Player account pubkey (not wallet)
    pub player: Address,
    /// Player's name (48 bytes UTF-8)
    pub player_name: [u8; 48],
    /// Event account pubkey
    pub event: Address,
    /// Player's rank in event
    pub rank: u16,
    /// Prize amount (NOVI)
    pub prize_amount: u64,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for EventPrizeClaimed {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:EventPrizeClaimed");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.player.pack(&mut buf[offset..]);
        offset += self.player_name.pack(&mut buf[offset..]);
        offset += self.event.pack(&mut buf[offset..]);
        offset += self.rank.pack(&mut buf[offset..]);
        offset += self.prize_amount.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when a subscription tier is updated (upgraded/extended)
pub struct SubscriptionTierUpdated {
    /// Player account pubkey (not wallet)
    pub player: Address,
    /// Player's name (48 bytes UTF-8)
    pub player_name: [u8; 48],
    /// Previous tier
    pub old_tier: u8,
    /// New tier
    pub new_tier: u8,
    /// New expiration timestamp
    pub expires_at: i64,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for SubscriptionTierUpdated {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:SubscriptionTierUpdated");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.player.pack(&mut buf[offset..]);
        offset += self.player_name.pack(&mut buf[offset..]);
        offset += self.old_tier.pack(&mut buf[offset..]);
        offset += self.new_tier.pack(&mut buf[offset..]);
        offset += self.expires_at.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when a subscription expires and is downgraded
pub struct SubscriptionExpired {
    /// Player account pubkey (not wallet)
    pub player: Address,
    /// Player's name (48 bytes UTF-8)
    pub player_name: [u8; 48],
    /// Previous tier that expired
    pub old_tier: u8,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for SubscriptionExpired {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:SubscriptionExpired");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.player.pack(&mut buf[offset..]);
        offset += self.player_name.pack(&mut buf[offset..]);
        offset += self.old_tier.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}
