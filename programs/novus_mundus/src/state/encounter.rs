use crate::constants::ENCOUNTER_SEED;
use pinocchio::error::ProgramError;
use pinocchio::Address;

/// Encounter account with dynamic attacker list
/// KINGDOM-SCOPED: Encounters exist within a kingdom
///
/// Memory layout:
/// - Fixed header (EncounterAccount struct)
/// - Variable-size attacker list: [Address; attacker_count] stored inline after header
///
/// This allows the account to grow dynamically as attackers join, saving rent costs.
///
/// # Level System
/// - Each encounter has a level (1-100)
/// - Level determines rewards (exponential scaling)
/// - Level determines stats (HP, defense)
/// - Players can only attack encounters ±10 levels from their own
#[repr(C)]
#[derive(Copy, Clone)]
pub struct EncounterAccount {
    /// Account discriminator (AccountKey::Encounter)
    pub account_key: u8, // 1 byte

    pub game_engine: Address, // 32 bytes - Kingdom this encounter belongs to
    pub id: u64,              // 8 bytes
    pub city_id: u16,         // 2 bytes - Which city the encounter is in
    pub level: u8,            // 1 byte - Encounter level (1-100)
    pub rarity: u8,           // 1 byte (0=common, 1=uncommon, 2=rare, etc)
    pub _padding0: [u8; 4],   // 4 bytes (alignment)
    pub location_lat: f64,    // 8 bytes - Random position within city
    pub location_long: f64,   // 8 bytes - Random position within city
    pub spawned_at: i64,      // 8 bytes
    pub despawn_at: i64,      // 8 bytes
    pub health: u64,          // 8 bytes
    pub max_health: u64,      // 8 bytes
    pub defense: u32,         // 4 bytes - Damage reduction (basis points: 10000 = 100%)
    pub _padding1: [u8; 4],   // 4 bytes (alignment)

    pub attacker_count: u8, // 1 byte (actual count)
    pub bump: u8,           // 1 byte - PDA bump seed
    pub _padding2: [u8; 6], // 6 bytes (reduced from 7)

                            // NO FIXED ARRAY - attackers stored dynamically after this struct
}

impl EncounterAccount {
    /// Size of just the fixed header (without any attackers)
    pub const BASE_LEN: usize = core::mem::size_of::<Self>();

    /// Calculate total account size for N attackers
    pub const fn calculate_len(attacker_count: u8) -> usize {
        Self::BASE_LEN + (attacker_count as usize * 32)
    }

    /// UNSAFE: Load header from raw account data
    pub unsafe fn load(data: &[u8]) -> &Self {
        &*(data.as_ptr() as *const Self)
    }

    /// UNSAFE: Load mutable header from raw account data
    pub unsafe fn load_mut(data: &mut [u8]) -> &mut Self {
        &mut *(data.as_mut_ptr() as *mut Self)
    }

    /// Derive PDA for an encounter account
    /// Seeds: [ENCOUNTER_SEED, game_engine, city_id, encounter_id]
    pub fn derive_pda(game_engine: &Address, city_id: u16, encounter_id: u64) -> (Address, u8) {
        let city_id_bytes = city_id.to_le_bytes();
        let encounter_id_bytes = encounter_id.to_le_bytes();
        pinocchio::Address::find_program_address(
            &[
                ENCOUNTER_SEED,
                game_engine.as_ref(),
                &city_id_bytes,
                &encounter_id_bytes,
            ],
            &crate::ID,
        )
    }

    /// Create PDA from known bump
    pub fn create_pda(
        game_engine: &Address,
        city_id: u16,
        encounter_id: u64,
        bump: u8,
    ) -> Result<Address, ProgramError> {
        let city_id_bytes = city_id.to_le_bytes();
        let encounter_id_bytes = encounter_id.to_le_bytes();
        let bump_seed = [bump];
        pinocchio::Address::create_program_address(
            &[
                ENCOUNTER_SEED,
                game_engine.as_ref(),
                &city_id_bytes,
                &encounter_id_bytes,
                &bump_seed,
            ],
            &crate::ID,
        )
        .map_err(|e| e.into())
    }

    /// Load and verify an EncounterAccount immutably.
    /// Checks: program ownership, PDA derivation, bump field.
    pub fn load_checked<'a>(
        account: &'a pinocchio::AccountView,
        game_engine: &Address,
        city_id: u16,
        encounter_id: u64,
        program_id: &Address,
    ) -> Result<&'a Self, ProgramError> {
        crate::validation::require_owner(account, program_id)?;

        let (expected_pda, bump) = Self::derive_pda(game_engine, city_id, encounter_id);
        crate::validation::require_pda_eq(account, &expected_pda, "EncounterAccount")?;

        let loaded = unsafe {
            super::AccountKey::cast::<Self>(
                account,
                super::AccountKey::Encounter,
                "EncounterAccount",
            )?
        };
        crate::validation::require_bump_eq(loaded.bump, bump, "EncounterAccount", account)?;
        crate::validation::require_stored_game_engine(
            &loaded.game_engine,
            game_engine,
            "EncounterAccount",
            account,
        )?;
        Ok(loaded)
    }

    /// Load and verify an EncounterAccount mutably.
    /// Checks: program ownership, PDA derivation, bump field.
    pub fn load_checked_mut<'a>(
        account: &'a pinocchio::AccountView,
        game_engine: &Address,
        city_id: u16,
        encounter_id: u64,
        program_id: &Address,
    ) -> Result<&'a mut Self, ProgramError> {
        crate::validation::require_owner(account, program_id)?;

        let (expected_pda, bump) = Self::derive_pda(game_engine, city_id, encounter_id);
        crate::validation::require_pda_eq(account, &expected_pda, "EncounterAccount")?;

        let loaded = unsafe {
            super::AccountKey::cast_mut::<Self>(
                account,
                super::AccountKey::Encounter,
                "EncounterAccount",
            )?
        };
        crate::validation::require_bump_eq(loaded.bump, bump, "EncounterAccount", account)?;
        crate::validation::require_stored_game_engine(
            &loaded.game_engine,
            game_engine,
            "EncounterAccount",
            account,
        )?;
        Ok(loaded)
    }

    /// Check if encounter belongs to a specific kingdom
    pub fn is_in_kingdom(&self, game_engine: &Address) -> bool {
        &self.game_engine == game_engine
    }

    /// Get immutable slice of attackers from account data
    ///
    /// # Safety
    /// Caller must ensure account_data contains valid encounter data with proper size
    pub fn get_attackers<'a>(&self, account_data: &'a [u8]) -> &'a [Address] {
        if self.attacker_count == 0 {
            return &[];
        }

        let offset = Self::BASE_LEN;
        let count = self.attacker_count as usize;
        let end = offset + (count * 32);

        // Bounds check
        if end > account_data.len() {
            return &[];
        }

        let attacker_bytes = &account_data[offset..end];

        unsafe { core::slice::from_raw_parts(attacker_bytes.as_ptr() as *const Address, count) }
    }

    /// Get mutable slice of attackers from account data
    ///
    /// # Safety
    /// Caller must ensure account_data contains valid encounter data with proper size
    pub fn get_attackers_mut<'a>(&self, account_data: &'a mut [u8]) -> &'a mut [Address] {
        if self.attacker_count == 0 {
            return &mut [];
        }

        let offset = Self::BASE_LEN;
        let count = self.attacker_count as usize;
        let end = offset + (count * 32);

        // Bounds check
        if end > account_data.len() {
            return &mut [];
        }

        let attacker_bytes = &mut account_data[offset..end];

        unsafe {
            core::slice::from_raw_parts_mut(attacker_bytes.as_mut_ptr() as *mut Address, count)
        }
    }

    /// Check if a player has already attacked this encounter
    pub fn has_attacked(&self, account_data: &[u8], player: &Address) -> bool {
        self.get_attackers(account_data).contains(player)
    }
}
