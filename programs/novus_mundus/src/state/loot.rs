use pinocchio::{
    pubkey::Pubkey,
    program_error::ProgramError,
};

/// Loot account - Physical rewards from encounters/PvP/rallies
///
/// # Design Philosophy
/// - Only physical items (cash, novi, weapons, produce, vehicles)
/// - NO units, XP, or reputation (those are granted instantly during combat)
/// - Reward types determined by level thresholds (DETERMINISTIC - no randomness!)
/// - Novi awarded above level+rarity thresholds (Level 21+/41+/61+ with rarity requirements)
///
/// # Security Features
/// - `claimed` flag prevents double-claim
/// - Monotonic `loot_id` prevents PDA collisions
/// - 30-day expiration with cleanup incentive
/// - Rent refund to creator (fair cost distribution)
/// - Full account closure on claim (rent reclamation)
#[repr(C)]
#[derive(Copy, Clone)]
pub struct LootAccount {
    /// Account discriminator (AccountKey::Loot)
    pub account_key: u8,

    // Identity & Security (80 bytes)
    pub owner: Pubkey,                      // 32 - Who can claim this loot
    pub creator: Pubkey,                    // 32 - Who paid rent (gets refund on claim)
    pub loot_id: u64,                       // 8  - Monotonic counter per player
    pub bump: u8,                           // 1  - PDA bump
    pub source_type: u8,                    // 1  - 0=Encounter, 1=PvP, 2=Rally
    pub claimed: bool,                      // 1  - Prevent double-claim (CRITICAL!)
    pub _padding1: [u8; 5],                 // 5  - Alignment

    // Timestamps (16 bytes)
    pub created_at: i64,                    // 8  - When loot was created
    pub expires_at: i64,                    // 8  - Auto-expire after 30 days

    // Source metadata (24 bytes)
    pub source_id: u64,                     // 8  - encounter_id/defender_id/rally_id
    pub contribution: u64,                  // 8  - Player's damage contribution
    pub source_level: u8,                   // 1  - Level of encounter/player
    pub source_rarity: u8,                  // 1  - Rarity (if encounter)
    pub _padding2: [u8; 6],                 // 6  - Alignment

    // Physical rewards (72 bytes)
    // NOTE: Not all fields will have values - determined by level thresholds (DETERMINISTIC)
    pub cash: u64,                          // 8  - Cash (always awarded)
    pub reserved_novi: u64,                 // 8  - Reserved NOVI (occasional, rare)
    pub melee_weapons: u64,                 // 8  - Melee weapons (level 5+)
    pub ranged_weapons: u64,                // 8  - Ranged weapons (level 5+)
    pub siege_weapons: u64,                 // 8  - Siege weapons (level 10+)
    pub produce: u64,                       // 8  - Produce (level 3+)
    pub vehicles: u64,                      // 8  - Vehicles (level 20+)
    pub fragments: u64,                     // 8  - Fragments (for heroes, research unlocked)
    pub gems: u64,                          // 8  - Gems (speed-up currency, research unlocked)
}

impl LootAccount {
    pub const LEN: usize = core::mem::size_of::<Self>(); // With account_key discriminator
    pub const EXPIRATION_DURATION: i64 = 30 * 86400; // 30 days in seconds

    /// Derive PDA: [b"loot", player, loot_id]
    ///
    /// Uses player PDA + monotonic loot_id for uniqueness.
    /// Player-specific so only the player account owner can claim.
    pub fn derive_pda(player: &Pubkey, loot_id: u64) -> (Pubkey, u8) {
        pinocchio::pubkey::find_program_address(
            &[b"loot", player.as_ref(), &loot_id.to_le_bytes()],
            &crate::ID,
        )
    }

    /// Create PDA from known bump (fast validation)
    pub fn create_pda(player: &Pubkey, loot_id: u64, bump: u8) -> Result<Pubkey, ProgramError> {
        let bump_seed = [bump];
        pinocchio::pubkey::create_program_address(
            &[b"loot", player.as_ref(), &loot_id.to_le_bytes(), &bump_seed],
            &crate::ID,
        )
    }

    /// UNSAFE: Load from raw account data
    pub unsafe fn load(data: &[u8]) -> &Self {
        &*(data.as_ptr() as *const Self)
    }

    /// UNSAFE: Load mutable from raw account data
    pub unsafe fn load_mut(data: &mut [u8]) -> &mut Self {
        &mut *(data.as_mut_ptr() as *mut Self)
    }

    /// Check if loot has any rewards
    pub fn has_rewards(&self) -> bool {
        self.cash > 0
            || self.reserved_novi > 0
            || self.melee_weapons > 0
            || self.ranged_weapons > 0
            || self.siege_weapons > 0
            || self.produce > 0
            || self.vehicles > 0
            || self.fragments > 0
            || self.gems > 0
    }

    /// Count number of reward types (for UI display)
    pub fn reward_type_count(&self) -> u8 {
        let mut count = 0;
        if self.cash > 0 { count += 1; }
        if self.reserved_novi > 0 { count += 1; }
        if self.melee_weapons > 0 { count += 1; }
        if self.ranged_weapons > 0 { count += 1; }
        if self.siege_weapons > 0 { count += 1; }
        if self.produce > 0 { count += 1; }
        if self.vehicles > 0 { count += 1; }
        if self.fragments > 0 { count += 1; }
        if self.gems > 0 { count += 1; }
        count
    }

    /// Get total weapons (all types combined)
    pub fn total_weapons(&self) -> u64 {
        self.melee_weapons
            .saturating_add(self.ranged_weapons)
            .saturating_add(self.siege_weapons)
    }
}

/// Loot source types
#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum LootSourceType {
    Encounter = 0,
    PvP = 1,
    Rally = 2,
}

impl From<LootSourceType> for u8 {
    fn from(t: LootSourceType) -> u8 {
        t as u8
    }
}
