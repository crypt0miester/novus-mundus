use pinocchio::{
    Address,
    error::ProgramError,
};
use crate::constants::{REINFORCEMENT_SEED, GARRISON_SEED};

// Reinforcement Target (Player vs Castle)

/// Destination type for reinforcement
#[repr(u8)]
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum ReinforcementTarget {
    /// Reinforcing a teammate's PlayerAccount
    Player = 0,
    /// Garrisoning a team's CastleAccount
    Castle = 1,
}

impl ReinforcementTarget {
    pub fn from_u8(val: u8) -> Self {
        match val {
            0 => Self::Player,
            1 => Self::Castle,
            _ => Self::Player,
        }
    }
}

// Reinforcement Status

/// Reinforcement status enum (stored as u8)
#[repr(u8)]
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum ReinforcementStatus {
    /// Units traveling to destination
    Traveling = 0,
    /// Units actively defending destination
    Active = 1,
    /// Units returning to sender
    Returning = 2,
    /// Completed (ready for account closure)
    Completed = 3,
}

impl ReinforcementStatus {
    pub fn from_u8(val: u8) -> Self {
        match val {
            0 => Self::Traveling,
            1 => Self::Active,
            2 => Self::Returning,
            3 => Self::Completed,
            _ => Self::Traveling,
        }
    }
}

// Reinforcement Account (Unified: Player + Castle)

/// Unified Reinforcement Account - Tracks units/weapons/hero sent to defend
/// KINGDOM-SCOPED: Reinforcements exist within a kingdom
///
/// Works for both:
/// - Player reinforcement (teammate → teammate)
/// - Castle garrison (team member → castle)
///
/// # Lifecycle
/// 1. Send - Sender creates account, units/weapons deducted, hero locked
/// 2. ProcessArrival - Crank: add to destination aggregates, mark Active
/// 3. Active Defense - Contributes to destination's defense calculations
/// 4. Recall OR Relieve - Sender or destination owner initiates return
/// 5. ProcessReturn - Calculate proportional survival, return to sender, close
///
/// # Key Design
/// - Units/weapons stored here are the ORIGINAL amounts sent
/// - Current counts are tracked in destination aggregates
/// - Survival ratio = destination_current / destination_original
/// - Return amounts = original_sent × survival_ratio
#[repr(C)]
#[derive(Copy, Clone)]
pub struct ReinforcementAccount {
    /// Account discriminator (AccountKey::Reinforcement)
    pub account_key: u8,

    // Kingdom Reference (32 bytes)
    /// Kingdom this reinforcement belongs to
    pub game_engine: Address,

    // Identity (64 bytes)
    /// Who sent the reinforcement (wallet pubkey)
    pub sender: Address,
    /// Destination: PlayerAccount OR CastleAccount pubkey
    pub destination: Address,

    // Type & Location (8 bytes)
    /// Destination type (0=Player, 1=Castle)
    pub destination_type: u8,
    /// PDA bump seed
    pub bump: u8,
    /// Sender's home city (for return travel time)
    pub sender_city: u16,
    /// Destination city
    pub destination_city: u16,
    /// Padding for alignment
    pub _padding_loc: [u8; 2],

    // Units - Original amounts sent (24 bytes)
    pub units_def_1: u64,
    pub units_def_2: u64,
    pub units_def_3: u64,

    // Weapons - Original amounts sent (24 bytes)
    pub melee_weapons: u64,
    pub ranged_weapons: u64,
    pub siege_weapons: u64,

    // Hero (40 bytes)
    /// Committed hero (NULL_PUBKEY if none)
    pub hero: Address,
    /// Hero's defense buff snapshot (bps)
    pub hero_defense_bps: u16,
    /// Hero's weapon efficiency buff snapshot (bps)
    pub hero_weapon_eff_bps: u16,
    /// Hero's armor efficiency buff snapshot (bps)
    pub hero_armor_eff_bps: u16,
    /// Padding
    pub _padding_hero: [u8; 2],

    // Travel Timing (24 bytes)
    /// When reinforcement was sent (unix timestamp)
    pub sent_at: i64,
    /// Travel time to destination (seconds)
    pub travel_duration: i32,
    /// Wounded units tier 1 (set during recall, returned to estate on process_return)
    pub wounded_def_1: u32,
    /// When units arrive at destination
    pub arrives_at: i64,

    // Return Timing (16 bytes)
    /// When return journey started (0 if not returning)
    pub return_started_at: i64,
    /// Return travel time (seconds)
    pub return_duration: i32,
    /// Wounded units tier 2 (set during recall)
    pub wounded_def_2: u32,

    // Status (8 bytes)
    /// Current status (ReinforcementStatus enum)
    pub status: u8,
    /// True if return was initiated by destination owner (relieve vs recall)
    pub relieved_by_destination: bool,
    /// Padding
    pub _padding_status: [u8; 2],
    /// Wounded units tier 3 (set during recall)
    pub wounded_def_3: u32,

    // Stats (8 bytes)
    /// Number of combats this reinforcement participated in
    pub combats_participated: u64,
}

impl ReinforcementAccount {
    pub const LEN: usize = core::mem::size_of::<Self>();

    /// UNSAFE: Load from raw account data
    pub unsafe fn load(data: &[u8]) -> &Self {
        &*(data.as_ptr() as *const Self)
    }

    /// UNSAFE: Load mutable from raw account data
    pub unsafe fn load_mut(data: &mut [u8]) -> &mut Self {
        &mut *(data.as_mut_ptr() as *mut Self)
    }

    // Unit Helpers

    /// Get total units (original amount sent)
    pub fn total_units(&self) -> u64 {
        self.units_def_1
            .saturating_add(self.units_def_2)
            .saturating_add(self.units_def_3)
    }

    /// Get total weapons (original amount sent)
    pub fn total_weapons(&self) -> u64 {
        self.melee_weapons
            .saturating_add(self.ranged_weapons)
            .saturating_add(self.siege_weapons)
    }

    /// Check if a hero was committed
    pub fn has_hero(&self) -> bool {
        self.hero != Address::default()
    }

    // Status Helpers

    /// Get status as enum
    pub fn get_status(&self) -> ReinforcementStatus {
        ReinforcementStatus::from_u8(self.status)
    }

    /// Get destination type as enum
    pub fn get_destination_type(&self) -> ReinforcementTarget {
        ReinforcementTarget::from_u8(self.destination_type)
    }

    /// Check if reinforcement is traveling to destination
    pub fn is_traveling(&self) -> bool {
        self.status == ReinforcementStatus::Traveling as u8
    }

    /// Check if reinforcement is actively defending
    pub fn is_active(&self) -> bool {
        self.status == ReinforcementStatus::Active as u8
    }

    /// Check if reinforcement is returning to sender
    pub fn is_returning(&self) -> bool {
        self.status == ReinforcementStatus::Returning as u8
    }

    /// Check if reinforcement is completed (ready for closure)
    pub fn is_completed(&self) -> bool {
        self.status == ReinforcementStatus::Completed as u8
    }

    // Timing Helpers

    /// Check if reinforcement has arrived at destination
    pub fn has_arrived(&self, now: i64) -> bool {
        now >= self.arrives_at
    }

    /// Check if reinforcement has returned to sender
    pub fn has_returned(&self, now: i64) -> bool {
        if self.return_started_at == 0 {
            return false;
        }
        now >= self.return_started_at + self.return_duration as i64
    }

    /// Get return completion timestamp
    pub fn return_completes_at(&self) -> i64 {
        self.return_started_at + self.return_duration as i64
    }

    // PDA Derivation

    /// Derive PDA for player reinforcement
    /// Seeds: [REINFORCEMENT_SEED, game_engine, sender, destination]
    /// Only one reinforcement per sender→destination pair within a kingdom
    pub fn derive_player_pda(game_engine: &Address, sender: &Address, destination: &Address) -> (Address, u8) {
        pinocchio::Address::find_program_address(
            &[
                REINFORCEMENT_SEED,
                game_engine.as_ref(),
                sender.as_ref(),
                destination.as_ref(),
            ],
            &crate::ID,
        )
    }

    /// Derive PDA for castle garrison
    /// Seeds: [GARRISON_SEED, game_engine, sender, castle]
    /// Only one garrison per sender→castle pair within a kingdom
    pub fn derive_castle_pda(game_engine: &Address, sender: &Address, castle: &Address) -> (Address, u8) {
        pinocchio::Address::find_program_address(
            &[
                GARRISON_SEED,
                game_engine.as_ref(),
                sender.as_ref(),
                castle.as_ref(),
            ],
            &crate::ID,
        )
    }

    /// Create PDA from known bump (player reinforcement)
    pub fn create_player_pda(
        game_engine: &Address,
        sender: &Address,
        destination: &Address,
        bump: u8,
    ) -> Result<Address, ProgramError> {
        let bump_seed = [bump];
        pinocchio::Address::create_program_address(
            &[
                REINFORCEMENT_SEED,
                game_engine.as_ref(),
                sender.as_ref(),
                destination.as_ref(),
                &bump_seed,
            ],
            &crate::ID,
        ).map_err(|e| e.into())
    }

    /// Create PDA from known bump (castle garrison)
    pub fn create_castle_pda(
        game_engine: &Address,
        sender: &Address,
        castle: &Address,
        bump: u8,
    ) -> Result<Address, ProgramError> {
        let bump_seed = [bump];
        pinocchio::Address::create_program_address(
            &[
                GARRISON_SEED,
                game_engine.as_ref(),
                sender.as_ref(),
                castle.as_ref(),
                &bump_seed,
            ],
            &crate::ID,
        ).map_err(|e| e.into())
    }

    /// Load and verify a ReinforcementAccount immutably (player reinforcement).
    pub fn load_checked_player<'a>(
        account: &'a pinocchio::AccountView,
        game_engine: &Address,
        sender: &Address,
        destination: &Address,
        program_id: &Address,
    ) -> Result<super::Loaded<'a, Self>, ProgramError> {
        if unsafe { account.owner() } != program_id {
            return Err(ProgramError::IllegalOwner);
        }

        let (expected_pda, bump) = Self::derive_player_pda(game_engine, sender, destination);
        if account.address() != &expected_pda {
            return Err(crate::error::GameError::InvalidPDA.into());
        }

        let data = account.try_borrow()?;
        super::AccountKey::validate(&data, super::AccountKey::Reinforcement)?;
        let ptr = data.as_ptr() as *const Self;
        let loaded = unsafe { &*ptr };

        if loaded.bump != bump {
            return Err(ProgramError::InvalidSeeds);
        }

        if &loaded.game_engine != game_engine {
            return Err(crate::error::GameError::KingdomMismatch.into());
        }

        Ok(unsafe { super::Loaded::new(data, ptr) })
    }

    /// Load and verify a ReinforcementAccount mutably (player reinforcement).
    pub fn load_checked_player_mut<'a>(
        account: &'a pinocchio::AccountView,
        game_engine: &Address,
        sender: &Address,
        destination: &Address,
        program_id: &Address,
    ) -> Result<super::LoadedMut<'a, Self>, ProgramError> {
        if unsafe { account.owner() } != program_id {
            return Err(ProgramError::IllegalOwner);
        }

        let (expected_pda, bump) = Self::derive_player_pda(game_engine, sender, destination);
        if account.address() != &expected_pda {
            return Err(crate::error::GameError::InvalidPDA.into());
        }

        let mut data = account.try_borrow_mut()?;
        super::AccountKey::validate(&data, super::AccountKey::Reinforcement)?;
        let ptr = data.as_mut_ptr() as *mut Self;
        let loaded = unsafe { &*ptr };

        if loaded.bump != bump {
            return Err(ProgramError::InvalidSeeds);
        }

        if &loaded.game_engine != game_engine {
            return Err(crate::error::GameError::KingdomMismatch.into());
        }

        Ok(unsafe { super::LoadedMut::new(data, ptr) })
    }

    /// Load and verify a ReinforcementAccount immutably (castle garrison).
    pub fn load_checked_castle<'a>(
        account: &'a pinocchio::AccountView,
        game_engine: &Address,
        sender: &Address,
        castle: &Address,
        program_id: &Address,
    ) -> Result<super::Loaded<'a, Self>, ProgramError> {
        if unsafe { account.owner() } != program_id {
            return Err(ProgramError::IllegalOwner);
        }

        let (expected_pda, bump) = Self::derive_castle_pda(game_engine, sender, castle);
        if account.address() != &expected_pda {
            return Err(crate::error::GameError::InvalidPDA.into());
        }

        let data = account.try_borrow()?;
        super::AccountKey::validate(&data, super::AccountKey::Reinforcement)?;
        let ptr = data.as_ptr() as *const Self;
        let loaded = unsafe { &*ptr };

        if loaded.bump != bump {
            return Err(ProgramError::InvalidSeeds);
        }

        if &loaded.game_engine != game_engine {
            return Err(crate::error::GameError::KingdomMismatch.into());
        }

        Ok(unsafe { super::Loaded::new(data, ptr) })
    }

    /// Load and verify a ReinforcementAccount mutably (castle garrison).
    pub fn load_checked_castle_mut<'a>(
        account: &'a pinocchio::AccountView,
        game_engine: &Address,
        sender: &Address,
        castle: &Address,
        program_id: &Address,
    ) -> Result<super::LoadedMut<'a, Self>, ProgramError> {
        if unsafe { account.owner() } != program_id {
            return Err(ProgramError::IllegalOwner);
        }

        let (expected_pda, bump) = Self::derive_castle_pda(game_engine, sender, castle);
        if account.address() != &expected_pda {
            return Err(crate::error::GameError::InvalidPDA.into());
        }

        let mut data = account.try_borrow_mut()?;
        super::AccountKey::validate(&data, super::AccountKey::Reinforcement)?;
        let ptr = data.as_mut_ptr() as *mut Self;
        let loaded = unsafe { &*ptr };

        if loaded.bump != bump {
            return Err(ProgramError::InvalidSeeds);
        }

        if &loaded.game_engine != game_engine {
            return Err(crate::error::GameError::KingdomMismatch.into());
        }

        Ok(unsafe { super::LoadedMut::new(data, ptr) })
    }

    /// Check if reinforcement belongs to a specific kingdom
    pub fn is_in_kingdom(&self, game_engine: &Address) -> bool {
        &self.game_engine == game_engine
    }
}
