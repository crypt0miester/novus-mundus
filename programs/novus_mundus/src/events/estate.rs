/// Estate events - buildings and plots

use pinocchio::Address;
use super::{Event, PackBytes, discriminator};

/// Emitted when an estate is created for a player
pub struct EstateCreated {
    /// Estate account pubkey
    pub estate: Address,
    /// Player account pubkey (not wallet)
    pub player: Address,
    /// Player's name (48 bytes UTF-8)
    pub player_name: [u8; 48],
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for EstateCreated {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:EstateCreated");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.estate.pack(&mut buf[offset..]);
        offset += self.player.pack(&mut buf[offset..]);
        offset += self.player_name.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when building construction starts
pub struct BuildingStarted {
    /// Player account pubkey (not wallet)
    pub player: Address,
    /// Player's name (48 bytes UTF-8)
    pub player_name: [u8; 48],
    /// Building type
    pub building_type: u8,
    /// Plot index
    pub plot: u8,
    /// Completion timestamp
    pub completes_at: i64,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for BuildingStarted {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:BuildingStarted");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.player.pack(&mut buf[offset..]);
        offset += self.player_name.pack(&mut buf[offset..]);
        offset += self.building_type.pack(&mut buf[offset..]);
        offset += self.plot.pack(&mut buf[offset..]);
        offset += self.completes_at.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when a building is completed
pub struct BuildingCompleted {
    /// Player account pubkey (not wallet)
    pub player: Address,
    /// Player's name (48 bytes UTF-8)
    pub player_name: [u8; 48],
    /// Building type
    pub building_type: u8,
    /// Building level
    pub level: u8,
    /// Plot index
    pub plot: u8,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for BuildingCompleted {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:BuildingCompleted");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.player.pack(&mut buf[offset..]);
        offset += self.player_name.pack(&mut buf[offset..]);
        offset += self.building_type.pack(&mut buf[offset..]);
        offset += self.level.pack(&mut buf[offset..]);
        offset += self.plot.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when a building upgrade starts
pub struct BuildingUpgradeStarted {
    /// Player account pubkey (not wallet)
    pub player: Address,
    /// Player's name (48 bytes UTF-8)
    pub player_name: [u8; 48],
    /// Building type
    pub building_type: u8,
    /// Current level
    pub from_level: u8,
    /// Target level
    pub to_level: u8,
    /// Completion timestamp
    pub completes_at: i64,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for BuildingUpgradeStarted {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:BuildingUpgradeStarted");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.player.pack(&mut buf[offset..]);
        offset += self.player_name.pack(&mut buf[offset..]);
        offset += self.building_type.pack(&mut buf[offset..]);
        offset += self.from_level.pack(&mut buf[offset..]);
        offset += self.to_level.pack(&mut buf[offset..]);
        offset += self.completes_at.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when a plot is purchased
pub struct PlotPurchased {
    /// Player account pubkey (not wallet)
    pub player: Address,
    /// Player's name (48 bytes UTF-8)
    pub player_name: [u8; 48],
    /// Plot index
    pub plot: u8,
    /// Cost paid (cash)
    pub cost: u64,
    /// Total plots owned
    pub total_plots: u8,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for PlotPurchased {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:PlotPurchased");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.player.pack(&mut buf[offset..]);
        offset += self.player_name.pack(&mut buf[offset..]);
        offset += self.plot.pack(&mut buf[offset..]);
        offset += self.cost.pack(&mut buf[offset..]);
        offset += self.total_plots.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when daily estate rewards are claimed
pub struct EstateDailyClaimed {
    /// Player account pubkey (not wallet)
    pub player: Address,
    /// Player's name (48 bytes UTF-8)
    pub player_name: [u8; 48],
    /// Materials earned
    pub materials: u64,
    /// Consecutive days streak
    pub streak: u16,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for EstateDailyClaimed {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:EstateDailyClaimed");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.player.pack(&mut buf[offset..]);
        offset += self.player_name.pack(&mut buf[offset..]);
        offset += self.materials.pack(&mut buf[offset..]);
        offset += self.streak.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when wounded troops are recovered via Infirmary
pub struct TroopsRecovered {
    /// Player account pubkey (not wallet)
    pub player: Address,
    /// Player's name (48 bytes UTF-8)
    pub player_name: [u8; 48],
    /// Unit type recovered (UnitType enum)
    pub unit_type: u8,
    /// Number of units recovered
    pub amount: u64,
    /// NOVI spent on recovery
    pub novi_spent: u64,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for TroopsRecovered {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:TroopsRecovered");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.player.pack(&mut buf[offset..]);
        offset += self.player_name.pack(&mut buf[offset..]);
        offset += self.unit_type.pack(&mut buf[offset..]);
        offset += self.amount.pack(&mut buf[offset..]);
        offset += self.novi_spent.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}
