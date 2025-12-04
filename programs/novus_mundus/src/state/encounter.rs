use pinocchio::pubkey::Pubkey;

/// Encounter account with dynamic attacker list
///
/// Memory layout:
/// - Fixed header (EncounterAccount struct)
/// - Variable-size attacker list: [Pubkey; attacker_count] stored inline after header
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
    pub id: u64,                                // 8 bytes
    pub city_id: u16,                           // 2 bytes - Which city the encounter is in
    pub level: u8,                              // 1 byte - Encounter level (1-100)
    pub rarity: u8,                             // 1 byte (0=common, 1=uncommon, 2=rare, etc)
    pub _padding0: [u8; 4],                     // 4 bytes (alignment)
    pub location_lat: f64,                      // 8 bytes - Random position within city
    pub location_long: f64,                     // 8 bytes - Random position within city
    pub spawned_at: i64,                        // 8 bytes
    pub despawn_at: i64,                        // 8 bytes
    pub health: u64,                            // 8 bytes
    pub max_health: u64,                        // 8 bytes
    pub defense: u32,                           // 4 bytes - Damage reduction (basis points: 10000 = 100%)
    pub _padding1: [u8; 4],                     // 4 bytes (alignment)

    pub attacker_count: u8,                     // 1 byte (actual count)
    pub _padding2: [u8; 7],                     // 7 bytes

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

    /// Get immutable slice of attackers from account data
    ///
    /// # Safety
    /// Caller must ensure account_data contains valid encounter data with proper size
    pub fn get_attackers<'a>(&self, account_data: &'a [u8]) -> &'a [Pubkey] {
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

        unsafe {
            core::slice::from_raw_parts(
                attacker_bytes.as_ptr() as *const Pubkey,
                count
            )
        }
    }

    /// Get mutable slice of attackers from account data
    ///
    /// # Safety
    /// Caller must ensure account_data contains valid encounter data with proper size
    pub fn get_attackers_mut<'a>(&self, account_data: &'a mut [u8]) -> &'a mut [Pubkey] {
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
            core::slice::from_raw_parts_mut(
                attacker_bytes.as_mut_ptr() as *mut Pubkey,
                count
            )
        }
    }

    /// Check if a player has already attacked this encounter
    pub fn has_attacked(&self, account_data: &[u8], player: &Pubkey) -> bool {
        self.get_attackers(account_data).contains(player)
    }
}
