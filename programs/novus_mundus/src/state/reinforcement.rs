use pinocchio::{
    pubkey::Pubkey,
    program_error::ProgramError,
};
use crate::constants::REINFORCEMENT_SEED;

// ============================================================
// Reinforcement Status
// ============================================================

/// Reinforcement status enum (stored as u8)
#[repr(u8)]
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum ReinforcementStatus {
    /// Units traveling to receiver's city
    Traveling = 0,
    /// Units actively defending receiver
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

// ============================================================
// Reinforcement Account
// ============================================================

/// Reinforcement Account - Tracks defensive units sent to teammates
///
/// # Lifecycle
/// 1. SendReinforcement - Sender creates, pays rent, units deducted
/// 2. ProcessReinforcementArrival - Mark as arrived (crank)
/// 3. Active Defense - Units contribute to receiver's defense
/// 4. RecallReinforcement OR RelieveReinforcement - Initiate return
/// 5. ProcessReinforcementReturn - Return units to sender, close account
///
/// # Key Design Decisions
/// - Sender pays rent (gets refund on close)
/// - Units belong to sender, defend receiver
/// - Can be recalled by sender OR relieved by receiver
/// - If all units die, account auto-closes (rent to sender)
#[repr(C)]
#[derive(Copy, Clone)]
pub struct ReinforcementAccount {
    // Identity (72 bytes)
    pub sender: Pubkey,                     // Who sent the reinforcement
    pub receiver: Pubkey,                   // Who is being reinforced
    pub id: u64,                            // Unique ID (for multiple reinforcements)

    // Location (4 bytes)
    pub sender_city: u16,                   // Sender's home city (for return)
    pub receiver_city: u16,                 // Where reinforcement is deployed

    // Units (24 bytes) - Only defensive units can reinforce
    pub units_def_1: u64,
    pub units_def_2: u64,
    pub units_def_3: u64,

    // Overflow (border reserve queue) (24 bytes)
    pub overflow_def_1: u64,                // Units in border reserve
    pub overflow_def_2: u64,
    pub overflow_def_3: u64,

    // Hero (40 bytes)
    pub hero: Pubkey,                       // Committed hero (NULL_PUBKEY if none)
    pub hero_power_contribution: u64,       // Hero's power contribution

    // Travel timing (24 bytes)
    pub sent_at: i64,                       // When reinforcement was sent
    pub travel_duration: i32,               // Travel time to receiver
    pub _padding1: [u8; 4],
    pub arrives_at: i64,                    // When units arrive

    // Return timing (16 bytes)
    pub return_started_at: i64,             // When return journey started (0 if not returning)
    pub return_duration: i32,               // Return travel time
    pub _padding2: [u8; 4],

    // Status (8 bytes)
    pub status: u8,                         // ReinforcementStatus enum
    pub in_border_reserve: bool,            // Any units in overflow/border reserve?
    pub recall_initiated_by_receiver: bool, // True if receiver relieved (vs sender recalled)
    pub bump: u8,
    pub _padding3: [u8; 4],

    // Combat stats (16 bytes)
    pub total_casualties: u64,              // Units lost in defense
    pub combats_participated: u32,          // Number of defenses participated
    pub _padding4: [u8; 4],
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

    /// Get total active units (not including overflow)
    pub fn total_active_units(&self) -> u64 {
        self.units_def_1
            .saturating_add(self.units_def_2)
            .saturating_add(self.units_def_3)
    }

    /// Get total overflow units (border reserve)
    pub fn total_overflow_units(&self) -> u64 {
        self.overflow_def_1
            .saturating_add(self.overflow_def_2)
            .saturating_add(self.overflow_def_3)
    }

    /// Get total units (active + overflow)
    pub fn total_units(&self) -> u64 {
        self.total_active_units().saturating_add(self.total_overflow_units())
    }

    /// Check if all units are dead
    pub fn all_units_dead(&self) -> bool {
        self.total_units() == 0
    }

    /// Check if reinforcement is active
    pub fn is_active(&self) -> bool {
        self.status == ReinforcementStatus::Active as u8
    }

    /// Check if reinforcement is traveling to receiver
    pub fn is_traveling(&self) -> bool {
        self.status == ReinforcementStatus::Traveling as u8
    }

    /// Check if reinforcement is returning
    pub fn is_returning(&self) -> bool {
        self.status == ReinforcementStatus::Returning as u8
    }

    /// Check if reinforcement has arrived at receiver
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

    /// Get status as enum
    pub fn get_status(&self) -> ReinforcementStatus {
        ReinforcementStatus::from_u8(self.status)
    }

    /// Move units from overflow to active (border reserve auto-fill)
    /// Called when active units die and there's room
    pub fn auto_fill_from_overflow(&mut self, casualties: u64) -> u64 {
        if self.total_overflow_units() == 0 {
            return 0;
        }

        let mut remaining = casualties;
        let mut filled = 0u64;

        // Fill def_1 first
        if remaining > 0 && self.overflow_def_1 > 0 {
            let fill = remaining.min(self.overflow_def_1);
            self.units_def_1 = self.units_def_1.saturating_add(fill);
            self.overflow_def_1 = self.overflow_def_1.saturating_sub(fill);
            remaining = remaining.saturating_sub(fill);
            filled = filled.saturating_add(fill);
        }

        // Fill def_2
        if remaining > 0 && self.overflow_def_2 > 0 {
            let fill = remaining.min(self.overflow_def_2);
            self.units_def_2 = self.units_def_2.saturating_add(fill);
            self.overflow_def_2 = self.overflow_def_2.saturating_sub(fill);
            remaining = remaining.saturating_sub(fill);
            filled = filled.saturating_add(fill);
        }

        // Fill def_3
        if remaining > 0 && self.overflow_def_3 > 0 {
            let fill = remaining.min(self.overflow_def_3);
            self.units_def_3 = self.units_def_3.saturating_add(fill);
            self.overflow_def_3 = self.overflow_def_3.saturating_sub(fill);
            filled = filled.saturating_add(fill);
        }

        // Update border reserve flag
        self.in_border_reserve = self.total_overflow_units() > 0;

        filled
    }

    /// Derive the PDA for a reinforcement account
    pub fn derive_pda(sender: &Pubkey, receiver: &Pubkey, id: u64) -> (Pubkey, u8) {
        pinocchio::pubkey::find_program_address(
            &[
                REINFORCEMENT_SEED,
                sender.as_ref(),
                receiver.as_ref(),
                &id.to_le_bytes(),
            ],
            &crate::ID,
        )
    }

    /// Create PDA from known bump
    pub fn create_pda(
        sender: &Pubkey,
        receiver: &Pubkey,
        id: u64,
        bump: u8,
    ) -> Result<Pubkey, ProgramError> {
        let id_bytes = id.to_le_bytes();
        let bump_seed = [bump];
        pinocchio::pubkey::create_program_address(
            &[
                REINFORCEMENT_SEED,
                sender.as_ref(),
                receiver.as_ref(),
                &id_bytes,
                &bump_seed,
            ],
            &crate::ID,
        )
    }
}

// Size is computed at compile time via core::mem::size_of::<Self>()
