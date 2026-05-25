use crate::constants::{RALLY_PARTICIPANT_SEED, RALLY_SEED};
use pinocchio::{error::ProgramError, Address};

// Rally Status

/// Rally status enum (stored as u8)
#[repr(u8)]
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum RallyStatus {
    /// Participants traveling to rally point
    Gathering = 0,
    /// Army marching to target
    Marching = 1,
    /// Combat being resolved
    Combat = 2,
    /// Participants returning home
    Returning = 3,
    /// Rally completed, accounts can be closed
    Completed = 4,
    /// Rally cancelled, all returning
    Cancelled = 5,
}

impl RallyStatus {
    pub fn from_u8(val: u8) -> Self {
        match val {
            0 => Self::Gathering,
            1 => Self::Marching,
            2 => Self::Combat,
            3 => Self::Returning,
            4 => Self::Completed,
            5 => Self::Cancelled,
            _ => Self::Gathering,
        }
    }
}

// Rally Account (Strategic Combat System)

/// Rally Account - Coordinates team attacks across cities
/// KINGDOM-SCOPED: Rallies exist within a kingdom
///
/// # Lifecycle
/// 1. CreateRally - Leader creates, pays rent, auto-joins
/// 2. JoinRally - Teammates join, commit units + weapons
/// 3. Gathering - Joiners travel to rally point (can be sped up)
/// 4. StartMarch - After gather_at, army marches to target
/// 5. ExecuteRally - Combat resolution, weapon mechanics applied
/// 6. Returning - Each participant returns to OWN home city
/// 7. ProcessReturn - Return surviving units/weapons + loot
/// 8. CloseRally - After all returned, leader gets rent back
#[repr(C)]
#[derive(Copy, Clone)]
pub struct RallyAccount {
    /// Account discriminator (AccountKey::Rally)
    pub account_key: u8,

    // Kingdom Reference (32 bytes)
    pub game_engine: Address, // Kingdom this rally belongs to

    // Identity (48 bytes)
    pub id: u64,          // Unique rally ID
    pub creator: Address, // Rally leader (created it)
    pub team: Address,    // Team this rally belongs to

    // Location (8 bytes)
    pub rally_city: u16,  // City where rally gathers
    pub target_city: u16, // City where target is
    pub target_type: u8,  // 0 = player, 1 = encounter
    pub _padding1: [u8; 3],

    // Target (32 bytes)
    pub target: Address, // Target player or encounter

    // Timing (48 bytes)
    pub created_at: i64,       // When rally was created
    pub gather_at: i64,        // Deadline to arrive at rally point
    pub execute_at: i64,       // Legacy: when rally executes (= gather_at for compatibility)
    pub march_started_at: i64, // When march began (0 if not started)
    pub arrive_at: i64,        // When army arrives at target
    pub march_duration: i32,   // March duration in seconds
    pub _padding2: [u8; 4],

    // Leader's buffs - apply to entire rally damage (16 bytes)
    pub leader_research_attack_bps: u16,
    pub leader_research_crit_chance_bps: u16,
    pub leader_research_crit_damage_bps: u16,
    pub leader_hero_attack_bps: u16,
    pub leader_hero_weapon_efficiency_bps: u16,
    pub leader_hero_crit_chance_bps: u16,
    pub leader_equipped_weapon_bonus_bps: u16,
    pub _padding3: [u8; 2],

    // Participants (8 bytes)
    pub min_participants: u8,  // Minimum required to start
    pub max_participants: u8,  // Maximum allowed
    pub participant_count: u8, // Current joined count
    pub arrived_count: u8,     // How many arrived at rally point
    pub marched_count: u8,     // How many included in march
    pub returned_count: u8,    // How many have returned home
    pub _padding4: [u8; 2],

    // Aggregated totals (40 bytes)
    pub total_units: u64,          // Sum of all committed units
    pub total_melee_weapons: u64,  // Sum of all committed melee
    pub total_ranged_weapons: u64, // Sum of all committed ranged
    pub total_siege_weapons: u64,  // Sum of all committed siege
    pub total_power: u64,          // Calculated attack power

    // Combat results (24 bytes)
    pub total_casualties: u64,        // Total units lost
    pub attack_damage_dealt: u64,     // Damage dealt to target
    pub defense_damage_received: u64, // Damage received from target

    // Resource loot (16 bytes)
    pub total_loot_cash: u64,        // Cash looted from target
    pub total_loot_locked_novi: u64, // Locked NOVI looted

    // Weapon loot (24 bytes)
    pub total_loot_melee: u64,  // Melee weapons looted
    pub total_loot_ranged: u64, // Ranged weapons looted
    pub total_loot_siege: u64,  // Siege weapons looted/captured

    // Other loot (32 bytes)
    pub total_loot_produce: u64,
    pub total_loot_vehicles: u64,
    pub total_loot_fragments: u64,
    pub total_loot_gems: u64,

    // Status (8 bytes)
    pub status: u8,               // RallyStatus enum
    pub fallback_triggered: bool, // True if target had no garrison
    pub attacker_won: bool,       // True if rally won the battle
    pub bump: u8,
    pub _padding5: [u8; 4],
}

impl RallyAccount {
    pub const LEN: usize = core::mem::size_of::<Self>();

    /// UNSAFE: Load from raw account data
    pub unsafe fn load(data: &[u8]) -> &Self {
        &*(data.as_ptr() as *const Self)
    }

    /// UNSAFE: Load mutable from raw account data
    pub unsafe fn load_mut(data: &mut [u8]) -> &mut Self {
        &mut *(data.as_mut_ptr() as *mut Self)
    }

    /// Check if rally is in gathering phase
    pub fn is_gathering(&self) -> bool {
        self.status == RallyStatus::Gathering as u8
    }

    /// Check if rally is in marching phase
    pub fn is_marching(&self) -> bool {
        self.status == RallyStatus::Marching as u8
    }

    /// Check if rally is returning
    pub fn is_returning(&self) -> bool {
        self.status == RallyStatus::Returning as u8
    }

    /// Check if rally is completed
    pub fn is_completed(&self) -> bool {
        self.status == RallyStatus::Completed as u8
    }

    /// Check if all participants have returned
    /// Note: leave.rs decrements participant_count, so this only tracks remaining participants
    pub fn all_returned(&self) -> bool {
        self.returned_count >= self.participant_count
    }

    /// Check if rally can be closed
    pub fn can_close(&self) -> bool {
        (self.status == RallyStatus::Completed as u8 || self.status == RallyStatus::Cancelled as u8)
            && self.all_returned()
    }

    /// Get status as enum
    pub fn get_status(&self) -> RallyStatus {
        RallyStatus::from_u8(self.status)
    }

    /// Get total weapons committed
    pub fn total_weapons(&self) -> u64 {
        self.total_melee_weapons
            .saturating_add(self.total_ranged_weapons)
            .saturating_add(self.total_siege_weapons)
    }

    /// Get total weapon loot
    pub fn total_weapon_loot(&self) -> u64 {
        self.total_loot_melee
            .saturating_add(self.total_loot_ranged)
            .saturating_add(self.total_loot_siege)
    }

    /// Derive the PDA for a rally account
    /// Seeds: [RALLY_SEED, game_engine, creator, rally_id]
    pub fn derive_pda(game_engine: &Address, creator: &Address, rally_id: u64) -> (Address, u8) {
        pinocchio::Address::find_program_address(
            &[
                RALLY_SEED,
                game_engine.as_ref(),
                creator.as_ref(),
                &rally_id.to_le_bytes(),
            ],
            &crate::ID,
        )
    }

    /// Create PDA from known bump
    pub fn create_pda(
        game_engine: &Address,
        creator: &Address,
        rally_id: u64,
        bump: u8,
    ) -> Result<Address, ProgramError> {
        let rally_id_bytes = rally_id.to_le_bytes();
        let bump_seed = [bump];
        pinocchio::Address::create_program_address(
            &[
                RALLY_SEED,
                game_engine.as_ref(),
                creator.as_ref(),
                &rally_id_bytes,
                &bump_seed,
            ],
            &crate::ID,
        )
        .map_err(|e| e.into())
    }

    /// Load and verify a RallyAccount immutably.
    /// Checks: program ownership, PDA derivation, bump field, kingdom membership.
    pub fn load_checked<'a>(
        account: &'a pinocchio::AccountView,
        game_engine: &Address,
        creator: &Address,
        rally_id: u64,
        program_id: &Address,
    ) -> Result<&'a Self, ProgramError> {
        crate::validation::require_owner(account, program_id)?;

        let (expected_pda, bump) = Self::derive_pda(game_engine, creator, rally_id);
        crate::validation::require_pda_eq(account, &expected_pda, "RallyAccount")?;

        let loaded = unsafe {
            super::AccountKey::cast::<Self>(account, super::AccountKey::Rally, "RallyAccount")?
        };
        crate::validation::require_bump_eq(loaded.bump, bump, "RallyAccount", account)?;
        crate::validation::require_stored_game_engine(
            &loaded.game_engine,
            game_engine,
            "RallyAccount",
            account,
        )?;
        Ok(loaded)
    }

    /// Load and verify a RallyAccount mutably.
    /// Checks: program ownership, PDA derivation, bump field, kingdom membership.
    pub fn load_checked_mut<'a>(
        account: &'a pinocchio::AccountView,
        game_engine: &Address,
        creator: &Address,
        rally_id: u64,
        program_id: &Address,
    ) -> Result<&'a mut Self, ProgramError> {
        crate::validation::require_owner(account, program_id)?;

        let (expected_pda, bump) = Self::derive_pda(game_engine, creator, rally_id);
        crate::validation::require_pda_eq(account, &expected_pda, "RallyAccount")?;

        let loaded = unsafe {
            super::AccountKey::cast_mut::<Self>(account, super::AccountKey::Rally, "RallyAccount")?
        };
        crate::validation::require_bump_eq(loaded.bump, bump, "RallyAccount", account)?;
        crate::validation::require_stored_game_engine(
            &loaded.game_engine,
            game_engine,
            "RallyAccount",
            account,
        )?;
        Ok(loaded)
    }

    /// Check if rally belongs to a specific kingdom
    pub fn is_in_kingdom(&self, game_engine: &Address) -> bool {
        &self.game_engine == game_engine
    }
}

// Rally Participant Account

/// Rally Participant - Per-joiner state for a rally
///
/// Each joiner pays rent for their own RallyParticipant account.
/// Rent is refunded when they call ProcessReturn after returning home.
///
/// Units AND weapons are committed at join time and stored here.
/// This prevents gaming (can't sell weapons after joining).
#[repr(C)]
#[derive(Copy, Clone)]
pub struct RallyParticipant {
    /// Account discriminator (AccountKey::RallyParticipant)
    pub account_key: u8,

    // Identity (48 bytes)
    pub rally_id: u64,          // Which rally
    pub rally_creator: Address, // Rally creator (for PDA derivation)
    pub participant: Address,   // This participant's wallet

    // Home location (4 bytes)
    pub home_city: u16, // Where to return after rally
    pub _padding1: [u8; 2],

    // Units COMMITTED - deducted from player at join (24 bytes)
    pub units_committed_1: u64,
    pub units_committed_2: u64,
    pub units_committed_3: u64,

    // Weapons COMMITTED - deducted from player at join (24 bytes)
    pub melee_weapons_committed: u64,
    pub ranged_weapons_committed: u64,
    pub siege_weapons_committed: u64,

    // Buffs SNAPSHOTTED at join (16 bytes)
    pub research_attack_bps: u16,
    pub research_crit_chance_bps: u16,
    pub research_crit_damage_bps: u16,
    pub hero_attack_bps: u16,
    pub hero_weapon_efficiency_bps: u16,
    pub hero_crit_chance_bps: u16,
    pub equipped_weapon_bonus_bps: u16,
    pub _padding2: [u8; 2],

    // Hero (40 bytes)
    pub hero: Address,                // Committed hero (NULL_PUBKEY if none)
    pub hero_power_contribution: u64, // Hero's power contribution

    // Travel to rally point (24 bytes)
    pub travel_started_at: i64, // When started traveling to rally
    pub arrives_at_rally: i64,  // When they'll arrive at rally point
    pub travel_duration: i32,   // Travel duration in seconds
    pub _padding3: [u8; 4],

    // Status flags (8 bytes)
    pub arrived_at_rally: bool,  // Has arrived at rally point?
    pub included_in_march: bool, // Was included in the march?
    pub returned: bool,          // Has returned home?
    pub is_leader: bool,         // Is this the rally leader?
    pub _padding4: [u8; 4],

    // Combat casualties (24 bytes)
    pub casualties_1: u64,
    pub casualties_2: u64,
    pub casualties_3: u64,

    // Resource loot share (16 bytes)
    pub loot_cash: u64,
    pub loot_locked_novi: u64,

    // Weapon loot share (24 bytes)
    pub loot_melee: u64,
    pub loot_ranged: u64,
    pub loot_siege: u64,

    // Other loot share (32 bytes)
    pub loot_produce: u64,
    pub loot_vehicles: u64,
    pub loot_fragments: u64,
    pub loot_gems: u64,

    // Return journey (16 bytes)
    pub return_started_at: i64, // When return journey started
    pub return_duration: i32,   // Return trip duration
    pub _padding5: [u8; 4],

    // Contribution tracking (16 bytes)
    pub contribution_power: u64, // Total power contributed
    pub contribution_bps: u16,   // Percentage of rally power (for loot share)
    pub bump: u8,
    pub _padding6: [u8; 5],
}

impl RallyParticipant {
    pub const LEN: usize = core::mem::size_of::<Self>();

    /// UNSAFE: Load from raw account data
    pub unsafe fn load(data: &[u8]) -> &Self {
        &*(data.as_ptr() as *const Self)
    }

    /// UNSAFE: Load mutable from raw account data
    pub unsafe fn load_mut(data: &mut [u8]) -> &mut Self {
        &mut *(data.as_mut_ptr() as *mut Self)
    }

    /// Get total committed units
    pub fn total_units(&self) -> u64 {
        self.units_committed_1
            .saturating_add(self.units_committed_2)
            .saturating_add(self.units_committed_3)
    }

    /// Get total committed weapons
    pub fn total_weapons(&self) -> u64 {
        self.melee_weapons_committed
            .saturating_add(self.ranged_weapons_committed)
            .saturating_add(self.siege_weapons_committed)
    }

    /// Get total casualties
    pub fn total_casualties(&self) -> u64 {
        self.casualties_1
            .saturating_add(self.casualties_2)
            .saturating_add(self.casualties_3)
    }

    /// Get surviving units after combat
    pub fn surviving_units(&self) -> (u64, u64, u64) {
        (
            self.units_committed_1.saturating_sub(self.casualties_1),
            self.units_committed_2.saturating_sub(self.casualties_2),
            self.units_committed_3.saturating_sub(self.casualties_3),
        )
    }

    /// Get total surviving units
    pub fn total_surviving_units(&self) -> u64 {
        let (s1, s2, s3) = self.surviving_units();
        s1.saturating_add(s2).saturating_add(s3)
    }

    /// Get weapons returned (based on casualty ratio)
    /// If 40% of troops died, 40% of weapons are lost
    pub fn weapons_returned(&self) -> (u64, u64, u64) {
        let total_units = self.total_units();
        if total_units == 0 {
            return (
                self.melee_weapons_committed,
                self.ranged_weapons_committed,
                self.siege_weapons_committed,
            );
        }

        let surviving = self.total_surviving_units();
        let survival_ratio_bps = ((surviving as u128 * 10000) / total_units as u128) as u64;

        // Melee and ranged proportional to survival
        let melee_returned =
            (self.melee_weapons_committed as u128 * survival_ratio_bps as u128 / 10000) as u64;
        let ranged_returned =
            (self.ranged_weapons_committed as u128 * survival_ratio_bps as u128 / 10000) as u64;
        // Siege is consumed during combat - calculated separately
        let siege_returned = 0u64; // Siege consumed in execute

        (melee_returned, ranged_returned, siege_returned)
    }

    /// Get total weapon loot
    pub fn total_weapon_loot(&self) -> u64 {
        self.loot_melee
            .saturating_add(self.loot_ranged)
            .saturating_add(self.loot_siege)
    }

    /// Check if has arrived at rally point
    pub fn has_arrived_at_rally(&self, now: i64) -> bool {
        self.arrived_at_rally || now >= self.arrives_at_rally
    }

    /// Check if has returned home
    pub fn has_returned(&self, now: i64) -> bool {
        if self.return_started_at == 0 {
            return false;
        }
        now >= self.return_started_at + self.return_duration as i64
    }

    /// Check if was a late joiner (didn't make it in time)
    pub fn is_late_joiner(&self) -> bool {
        !self.included_in_march && !self.arrived_at_rally
    }

    /// Derive the PDA for a rally participant account
    /// Seeds: [RALLY_PARTICIPANT_SEED, game_engine, rally_creator, rally_id, participant]
    pub fn derive_pda(
        game_engine: &Address,
        rally_creator: &Address,
        rally_id: u64,
        participant: &Address,
    ) -> (Address, u8) {
        pinocchio::Address::find_program_address(
            &[
                RALLY_PARTICIPANT_SEED,
                game_engine.as_ref(),
                rally_creator.as_ref(),
                &rally_id.to_le_bytes(),
                participant.as_ref(),
            ],
            &crate::ID,
        )
    }

    /// Create PDA from known bump
    pub fn create_pda(
        game_engine: &Address,
        rally_creator: &Address,
        rally_id: u64,
        participant: &Address,
        bump: u8,
    ) -> Result<Address, ProgramError> {
        let rally_id_bytes = rally_id.to_le_bytes();
        let bump_seed = [bump];
        pinocchio::Address::create_program_address(
            &[
                RALLY_PARTICIPANT_SEED,
                game_engine.as_ref(),
                rally_creator.as_ref(),
                &rally_id_bytes,
                participant.as_ref(),
                &bump_seed,
            ],
            &crate::ID,
        )
        .map_err(|e| e.into())
    }

    /// Load and verify a RallyParticipant immutably.
    pub fn load_checked<'a>(
        account: &'a pinocchio::AccountView,
        game_engine: &Address,
        rally_creator: &Address,
        rally_id: u64,
        participant: &Address,
        program_id: &Address,
    ) -> Result<&'a Self, ProgramError> {
        crate::validation::require_owner(account, program_id)?;

        let (expected_pda, bump) =
            Self::derive_pda(game_engine, rally_creator, rally_id, participant);
        crate::validation::require_pda_eq(account, &expected_pda, "RallyParticipant")?;

        let loaded = unsafe {
            super::AccountKey::cast::<Self>(
                account,
                super::AccountKey::RallyParticipant,
                "RallyParticipant",
            )?
        };
        crate::validation::require_bump_eq(loaded.bump, bump, "RallyParticipant", account)?;
        Ok(loaded)
    }

    /// Load and verify a RallyParticipant mutably.
    pub fn load_checked_mut<'a>(
        account: &'a pinocchio::AccountView,
        game_engine: &Address,
        rally_creator: &Address,
        rally_id: u64,
        participant: &Address,
        program_id: &Address,
    ) -> Result<&'a mut Self, ProgramError> {
        crate::validation::require_owner(account, program_id)?;

        let (expected_pda, bump) =
            Self::derive_pda(game_engine, rally_creator, rally_id, participant);
        crate::validation::require_pda_eq(account, &expected_pda, "RallyParticipant")?;

        let loaded = unsafe {
            super::AccountKey::cast_mut::<Self>(
                account,
                super::AccountKey::RallyParticipant,
                "RallyParticipant",
            )?
        };
        crate::validation::require_bump_eq(loaded.bump, bump, "RallyParticipant", account)?;
        Ok(loaded)
    }
}

// Legacy Compatibility (for existing processors)

impl RallyAccount {
    /// Base size for rent calculation
    pub const BASE_LEN: usize = Self::LEN;

    /// Calculate length (for compatibility - no dynamic sizing in new design)
    pub const fn calculate_len(_participant_count: u8) -> usize {
        Self::LEN
    }

    /// Get participants (legacy - returns empty in new design)
    /// New design uses separate RallyParticipant accounts
    pub fn participants<'a>(&self, _data: &'a [u8]) -> &'a [pinocchio::Address] {
        &[]
    }

    /// Check if participant exists (legacy compatibility)
    /// New design uses separate RallyParticipant accounts
    pub fn has_participant(&self, _data: &[u8], _pubkey: &Address) -> bool {
        false // Always false - use RallyParticipant accounts
    }
}
