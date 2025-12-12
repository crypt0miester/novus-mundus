/// Economy events - resources, transfers, purchases

use pinocchio::pubkey::Pubkey;
use super::{Event, PackBytes, discriminator};

/// Emitted when a player collects resources (cash/mining/fishing)
pub struct ResourcesCollected {
    /// Player account pubkey
    pub player: Pubkey,
    /// Collection type (0=cash, 1=mining, 2=fishing)
    pub collection_type: u8,
    /// NOVI consumed for collection
    pub novi_consumed: u64,
    /// Base output before bonuses
    pub base_output: u64,
    /// Final output after all bonuses
    pub final_output: u64,
    /// Gems earned (mining only)
    pub gems_earned: u64,
    /// Fragments earned (if unlocked)
    pub fragments_earned: u64,
    /// XP gained
    pub xp_gained: u64,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for ResourcesCollected {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:ResourcesCollected");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.player.pack(&mut buf[offset..]);
        offset += self.collection_type.pack(&mut buf[offset..]);
        offset += self.novi_consumed.pack(&mut buf[offset..]);
        offset += self.base_output.pack(&mut buf[offset..]);
        offset += self.final_output.pack(&mut buf[offset..]);
        offset += self.gems_earned.pack(&mut buf[offset..]);
        offset += self.fragments_earned.pack(&mut buf[offset..]);
        offset += self.xp_gained.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when a player hires units
pub struct UnitsHired {
    /// Player account pubkey
    pub player: Pubkey,
    /// Unit type (0=melee, 1=ranged, 2=siege)
    pub unit_type: u8,
    /// Base quantity before bonuses
    pub base_quantity: u64,
    /// Final quantity after time bonus
    pub final_quantity: u64,
    /// NOVI burned for hiring
    pub novi_burned: u64,
    /// Time of day bonus applied (basis points)
    pub time_bonus_bps: u16,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for UnitsHired {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:UnitsHired");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.player.pack(&mut buf[offset..]);
        offset += self.unit_type.pack(&mut buf[offset..]);
        offset += self.base_quantity.pack(&mut buf[offset..]);
        offset += self.final_quantity.pack(&mut buf[offset..]);
        offset += self.novi_burned.pack(&mut buf[offset..]);
        offset += self.time_bonus_bps.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when cash is transferred between players
pub struct CashTransferred {
    /// Sender player pubkey
    pub from: Pubkey,
    /// Receiver player pubkey
    pub to: Pubkey,
    /// Amount transferred
    pub amount: u64,
    /// Fee charged (if any)
    pub fee: u64,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for CashTransferred {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:CashTransferred");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.from.pack(&mut buf[offset..]);
        offset += self.to.pack(&mut buf[offset..]);
        offset += self.amount.pack(&mut buf[offset..]);
        offset += self.fee.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when NOVI is locked/staked
pub struct NoviLocked {
    /// Player account pubkey
    pub player: Pubkey,
    /// Amount locked
    pub amount: u64,
    /// New total locked balance
    pub total_locked: u64,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for NoviLocked {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:NoviLocked");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.player.pack(&mut buf[offset..]);
        offset += self.amount.pack(&mut buf[offset..]);
        offset += self.total_locked.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when equipment is purchased
pub struct EquipmentPurchased {
    /// Player account pubkey
    pub player: Pubkey,
    /// Equipment slot
    pub slot: u8,
    /// Equipment tier/level
    pub tier: u8,
    /// NOVI burned
    pub novi_burned: u64,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for EquipmentPurchased {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:EquipmentPurchased");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.player.pack(&mut buf[offset..]);
        offset += self.slot.pack(&mut buf[offset..]);
        offset += self.tier.pack(&mut buf[offset..]);
        offset += self.novi_burned.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when stamina is purchased
pub struct StaminaPurchased {
    /// Player account pubkey
    pub player: Pubkey,
    /// Stamina amount purchased
    pub stamina: u64,
    /// Gems spent
    pub gems_spent: u64,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for StaminaPurchased {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:StaminaPurchased");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.player.pack(&mut buf[offset..]);
        offset += self.stamina.pack(&mut buf[offset..]);
        offset += self.gems_spent.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when vault transfer occurs
pub struct VaultTransfer {
    /// Player account pubkey
    pub player: Pubkey,
    /// Amount transferred
    pub amount: u64,
    /// Direction (true = to vault, false = from vault)
    pub to_vault: bool,
    /// New vault balance
    pub vault_balance: u64,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for VaultTransfer {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:VaultTransfer");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.player.pack(&mut buf[offset..]);
        offset += self.amount.pack(&mut buf[offset..]);
        offset += self.to_vault.pack(&mut buf[offset..]);
        offset += self.vault_balance.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}
