/// Combat events - PvP and PvE combat outcomes

use pinocchio::Address;
use super::{Event, PackBytes, discriminator};

/// Emitted when a player attacks another player (PvP)
pub struct PlayerAttacked {
    /// Attacker's player account pubkey (not wallet)
    pub attacker: Address,
    /// Attacker's name (48 bytes UTF-8)
    pub attacker_name: [u8; 48],
    /// Defender's player account pubkey (not wallet)
    pub defender: Address,
    /// Defender's name (48 bytes UTF-8)
    pub defender_name: [u8; 48],
    /// Damage dealt to defender
    pub damage_dealt: u64,
    /// Damage received from defender
    pub damage_received: u64,
    /// Cash stolen from defender
    pub cash_stolen: u64,
    /// Armor pieces stolen
    pub armor_stolen: u64,
    /// Produce stolen
    pub produce_stolen: u64,
    /// Vehicles stolen
    pub vehicles_stolen: u64,
    /// Attacker's units lost (defensive_1, defensive_2, defensive_3)
    pub attacker_units_lost: [u64; 3],
    /// Defender's units lost (defensive_1, defensive_2, defensive_3)
    pub defender_units_lost: [u64; 3],
    /// Whether attacker won
    pub attacker_won: bool,
    /// Whether this was a drive-by attack
    pub drive_by: bool,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for PlayerAttacked {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:PlayerAttacked");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.attacker.pack(&mut buf[offset..]);
        offset += self.attacker_name.pack(&mut buf[offset..]);
        offset += self.defender.pack(&mut buf[offset..]);
        offset += self.defender_name.pack(&mut buf[offset..]);
        offset += self.damage_dealt.pack(&mut buf[offset..]);
        offset += self.damage_received.pack(&mut buf[offset..]);
        offset += self.cash_stolen.pack(&mut buf[offset..]);
        offset += self.armor_stolen.pack(&mut buf[offset..]);
        offset += self.produce_stolen.pack(&mut buf[offset..]);
        offset += self.vehicles_stolen.pack(&mut buf[offset..]);
        offset += self.attacker_units_lost[0].pack(&mut buf[offset..]);
        offset += self.attacker_units_lost[1].pack(&mut buf[offset..]);
        offset += self.attacker_units_lost[2].pack(&mut buf[offset..]);
        offset += self.defender_units_lost[0].pack(&mut buf[offset..]);
        offset += self.defender_units_lost[1].pack(&mut buf[offset..]);
        offset += self.defender_units_lost[2].pack(&mut buf[offset..]);
        offset += self.attacker_won.pack(&mut buf[offset..]);
        offset += self.drive_by.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when a player attacks an encounter (PvE) - fires on each attack
pub struct EncounterAttacked {
    /// Player account who attacked (not wallet)
    pub player: Address,
    /// Player's name (48 bytes UTF-8)
    pub player_name: [u8; 48],
    /// Encounter account pubkey
    pub encounter: Address,
    /// Damage dealt this attack
    pub damage_dealt: u64,
    /// Encounter's remaining health after attack
    pub health_remaining: u64,
    /// Stamina consumed
    pub stamina_consumed: u16,
    /// NOVI consumed for this attack
    pub novi_consumed: u64,
    /// Number of attackers on this encounter
    pub attacker_count: u8,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for EncounterAttacked {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:EncounterAttacked");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.player.pack(&mut buf[offset..]);
        offset += self.player_name.pack(&mut buf[offset..]);
        offset += self.encounter.pack(&mut buf[offset..]);
        offset += self.damage_dealt.pack(&mut buf[offset..]);
        offset += self.health_remaining.pack(&mut buf[offset..]);
        offset += self.stamina_consumed.pack(&mut buf[offset..]);
        offset += self.novi_consumed.pack(&mut buf[offset..]);
        offset += self.attacker_count.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when an encounter is defeated (killed)
pub struct EncounterDefeated {
    /// Encounter account pubkey
    pub encounter: Address,
    /// Encounter type (boss, mob, etc.)
    pub encounter_type: u8,
    /// Encounter level/difficulty
    pub level: u8,
    /// Total attackers who contributed
    pub total_attackers: u8,
    /// Player account who dealt killing blow (not wallet)
    pub killing_blow_by: Address,
    /// Killing blow player's name (48 bytes UTF-8)
    pub killing_blow_name: [u8; 48],
    /// Total loot cash generated
    pub loot_cash: u64,
    /// Total loot NOVI generated
    pub loot_novi: u64,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for EncounterDefeated {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:EncounterDefeated");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.encounter.pack(&mut buf[offset..]);
        offset += self.encounter_type.pack(&mut buf[offset..]);
        offset += self.level.pack(&mut buf[offset..]);
        offset += self.total_attackers.pack(&mut buf[offset..]);
        offset += self.killing_blow_by.pack(&mut buf[offset..]);
        offset += self.killing_blow_name.pack(&mut buf[offset..]);
        offset += self.loot_cash.pack(&mut buf[offset..]);
        offset += self.loot_novi.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when a terminal encounter account is cleaned up (closed + rent reclaimed)
pub struct EncounterCleanedUp {
    /// Encounter account pubkey that was closed
    pub encounter: Address,
    /// City the encounter belonged to
    pub city_id: u16,
    /// Encounter rarity
    pub rarity: u8,
    /// True if the encounter had been killed (health == 0); false if it expired by time only
    pub was_killed: bool,
    /// Account that received the reclaimed rent
    pub rent_recipient: Address,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for EncounterCleanedUp {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:EncounterCleanedUp");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.encounter.pack(&mut buf[offset..]);
        offset += self.city_id.pack(&mut buf[offset..]);
        offset += self.rarity.pack(&mut buf[offset..]);
        offset += self.was_killed.pack(&mut buf[offset..]);
        offset += self.rent_recipient.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}
