use pinocchio::Address;
use pinocchio::error::ProgramError;
use pinocchio::AccountView;
use crate::constants::{TEAM_SEED, TEAM_SLOT_SEED, TEAM_INVITE_SEED};
use crate::error::GameError;

// TEAM ACCOUNT (272 bytes)

/// Team account - stores team metadata and configuration.
/// Members are stored in separate TeamMemberSlot PDAs.
/// KINGDOM-SCOPED: Teams exist within a single kingdom
#[repr(C)]
#[derive(Copy, Clone)]
pub struct TeamAccount {
    /// Account discriminator (AccountKey::Team)
    pub account_key: u8,

    // === KINGDOM & IDENTITY (80 bytes) ===
    pub game_engine: Address,        // 32 - Kingdom this team belongs to
    pub id: u64,                    // 8 - Unique team ID (for PDA derivation)
    pub leader: Address,             // 32 - Team leader's player account pubkey
    pub bump: u8,                   // 1 - PDA bump seed
    pub disbanded: bool,            // 1 - True if team has been disbanded
    pub _padding0: [u8; 6],         // 6 - Alignment to 8 bytes

    // === NAME (40 bytes) ===
    pub name: [u8; 32],             // 32 - Team name (UTF-8)
    pub name_len: u8,               // 1 - Actual name length
    pub _padding1: [u8; 7],         // 7 - Alignment to 8 bytes

    // === MEMBERSHIP (8 bytes) ===
    pub member_count: u16,          // 2 - Current member count
    pub max_members: u16,           // 2 - Max members (tier-based, can be upgraded)
    pub _padding2: [u8; 4],         // 4 - Alignment to 8 bytes

    // === TIMESTAMPS (16 bytes) ===
    pub created_at: i64,            // 8 - Team creation timestamp
    pub last_activity: i64,         // 8 - Last activity (for inactive team cleanup)

    // === TREASURY (8 bytes) ===
    pub treasury: u64,              // 8 - Current treasury balance

    // === SETTINGS & PERMISSIONS (8 bytes) ===
    pub settings: u8,               // 1 - Bitfield: public, auto_accept, etc.
    pub min_level_to_join: u8,      // 1 - Minimum player level to join
    pub role_permissions: [u8; 5],  // 5 - Permission bitfield per rank (index = rank 0-4)
    pub _padding3: u8,              // 1 - Alignment to 8 bytes

    // === MOTD (40 bytes) ===
    pub motd: [u8; 32],             // 32 - Message of the day (reduced for alignment)
    pub motd_len: u8,               // 1 - MOTD length
    pub _padding4: [u8; 7],         // 7 - Alignment to 8 bytes

    // === TREASURY SECURITY (72 bytes) ===
    // Index 0=Rank1, 1=Rank2, 2=Rank3, 3=Rank4. Rank 0 (leader) always has unlimited access.
    pub treasury_instant_limit: [u64; 4],  // 32 - Max per-tx instant withdrawal per rank
    pub treasury_daily_cap: [u64; 4],      // 32 - Max daily instant withdrawal per rank
    pub treasury_cooldown_hours: u8,       // 1  - Hours before large request executable (1-72)
    pub _treasury_reserved: [u8; 7],       // 7  - Alignment to 8 bytes
}

// Settings bitfield constants
impl TeamAccount {
    pub const SETTING_PUBLIC: u8 = 1 << 0;        // Anyone can join (no invite needed)
    pub const SETTING_AUTO_ACCEPT: u8 = 1 << 1;   // Auto-accept join requests

    // Permission bits (stored per-rank in role_permissions array)
    pub const PERM_INVITE: u8 = 1 << 0;      // Can invite new members
    pub const PERM_KICK: u8 = 1 << 1;        // Can kick lower-ranked members
    pub const PERM_MOTD: u8 = 1 << 2;        // Can set message of the day
    pub const PERM_PROMOTE: u8 = 1 << 3;     // Can promote members below their rank
    pub const PERM_TREASURY: u8 = 1 << 4;    // Can withdraw from treasury
    pub const PERM_SETTINGS: u8 = 1 << 5;    // Can change team settings

    // Default permissions by rank (index = rank, lower rank = more power)
    // Rank 0 (Leader): All permissions
    // Rank 1: All except reserved bits
    // Rank 2: Invite, Kick, MOTD
    // Rank 3: None
    // Rank 4: None
    pub const DEFAULT_ROLE_PERMISSIONS: [u8; 5] = [
        0xFF,   // Rank 0 (Leader) - all permissions
        0x3F,   // Rank 1 - all standard permissions
        0x07,   // Rank 2 - invite, kick, motd
        0x00,   // Rank 3 - none
        0x00,   // Rank 4 - none
    ];

    // Treasury security constants
    pub const MIN_COOLDOWN_HOURS: u8 = 1;         // Minimum 1 hour cooldown
    pub const MAX_COOLDOWN_HOURS: u8 = 72;        // Maximum 72 hours (3 days)
    pub const DEFAULT_COOLDOWN_HOURS: u8 = 8;     // Default 8 hours

    // Default treasury limits per rank (index 0=Rank1, 1=Rank2, 2=Rank3, 3=Rank4)
    // Rank 0 (leader) always has unlimited access - not in array
    // Leader can modify these to give any rank treasury access
    pub const DEFAULT_INSTANT_LIMIT: [u64; 4] = [1000, 100, 0, 0];   // Per-tx limit
    pub const DEFAULT_DAILY_CAP: [u64; 4] = [5000, 500, 0, 0];       // Daily cap

    /// Get permissions for a specific rank
    pub fn get_rank_permissions(&self, rank: u8) -> u8 {
        if rank < 5 {
            self.role_permissions[rank as usize]
        } else {
            0
        }
    }

    /// Check if a rank has specific permission
    pub fn rank_has_permission(&self, rank: u8, perm: u8) -> bool {
        self.get_rank_permissions(rank) & perm != 0
    }

    /// Check if actor_rank can kick target_rank (must have KICK perm AND outrank target)
    pub fn can_kick(&self, actor_rank: u8, target_rank: u8) -> bool {
        self.rank_has_permission(actor_rank, Self::PERM_KICK) && actor_rank < target_rank
    }

    /// Check if actor_rank can promote to target_rank (must have PROMOTE perm AND outrank target)
    pub fn can_promote_to(&self, actor_rank: u8, target_rank: u8) -> bool {
        self.rank_has_permission(actor_rank, Self::PERM_PROMOTE) && actor_rank < target_rank
    }

    // === Treasury Security Methods ===

    /// Get instant withdrawal limit for a rank
    /// Rank 0 (leader) = unlimited, Ranks 1-4 use configurable array
    pub fn get_instant_limit(&self, rank: u8) -> u64 {
        match rank {
            0 => u64::MAX,  // Leader has unlimited instant access
            1..=4 => self.treasury_instant_limit[(rank - 1) as usize],
            _ => 0,
        }
    }

    /// Get daily withdrawal cap for a rank
    /// Rank 0 (leader) = unlimited, Ranks 1-4 use configurable array
    pub fn get_daily_cap(&self, rank: u8) -> u64 {
        match rank {
            0 => u64::MAX,  // Leader has unlimited daily access
            1..=4 => self.treasury_daily_cap[(rank - 1) as usize],
            _ => 0,
        }
    }

    /// Get cooldown in seconds (clamped to valid range)
    pub fn get_cooldown_seconds(&self) -> i64 {
        let hours = self.treasury_cooldown_hours
            .max(Self::MIN_COOLDOWN_HOURS)
            .min(Self::MAX_COOLDOWN_HOURS);
        (hours as i64) * 3600
    }

    /// Check if rank has any treasury access (has permission AND has non-zero limits)
    pub fn has_treasury_access(&self, rank: u8) -> bool {
        if !self.rank_has_permission(rank, Self::PERM_TREASURY) {
            return false;
        }
        // Rank 0 always has access, others need non-zero limits
        rank == 0 || self.get_instant_limit(rank) > 0 || self.get_daily_cap(rank) > 0
    }

    /// Check if amount qualifies for instant withdrawal (within both limits)
    pub fn can_withdraw_instant(&self, rank: u8, amount: u64, already_withdrawn_today: u64) -> bool {
        if !self.has_treasury_access(rank) {
            return false;
        }
        let instant_limit = self.get_instant_limit(rank);
        let daily_cap = self.get_daily_cap(rank);
        let remaining_daily = daily_cap.saturating_sub(already_withdrawn_today);

        amount <= instant_limit && amount <= remaining_daily
    }
}

impl TeamAccount {
    pub const LEN: usize = core::mem::size_of::<Self>();
    pub const MAX_NAME_LEN: usize = 32;
    pub const MAX_MOTD_LEN: usize = 32;

    pub unsafe fn load(data: &[u8]) -> &Self {
        &*(data.as_ptr() as *const Self)
    }

    pub unsafe fn load_mut(data: &mut [u8]) -> &mut Self {
        &mut *(data.as_mut_ptr() as *mut Self)
    }

    /// Derive PDA for a team account
    /// Seeds: [TEAM_SEED, game_engine, team_id]
    pub fn derive_pda(game_engine: &Address, team_id: u64) -> (Address, u8) {
        let team_id_bytes = team_id.to_le_bytes();
        pinocchio::Address::find_program_address(
            &[TEAM_SEED, game_engine.as_ref(), &team_id_bytes],
            &crate::ID,
        )
    }

    /// Create PDA from known bump
    pub fn create_pda(game_engine: &Address, team_id: u64, bump: u8) -> Result<Address, ProgramError> {
        let team_id_bytes = team_id.to_le_bytes();
        let bump_seed = [bump];
        pinocchio::Address::create_program_address(
            &[TEAM_SEED, game_engine.as_ref(), &team_id_bytes, &bump_seed],
            &crate::ID,
        ).map_err(|e| e.into())
    }

    /// Load and verify a TeamAccount immutably.
    /// Checks: program ownership, PDA derivation, bump field.
    pub fn load_checked<'a>(
        account: &'a AccountView,
        game_engine: &Address,
        team_id: u64,
        program_id: &Address,
    ) -> Result<super::Loaded<'a, Self>, ProgramError> {
        if unsafe { account.owner() } != program_id {
            return Err(ProgramError::IllegalOwner);
        }

        let (expected_pda, bump) = Self::derive_pda(game_engine, team_id);
        if account.address() != &expected_pda {
            return Err(GameError::InvalidPDA.into());
        }

        let data = account.try_borrow()?;
        super::AccountKey::validate(&data, super::AccountKey::Team)?;
        let ptr = data.as_ptr() as *const Self;
        let loaded = unsafe { &*ptr };

        if loaded.bump != bump {
            return Err(ProgramError::InvalidSeeds);
        }

        if &loaded.game_engine != game_engine {
            return Err(GameError::KingdomMismatch.into());
        }

        Ok(unsafe { super::Loaded::new(data, ptr) })
    }

    /// Load and verify a TeamAccount mutably.
    /// Checks: program ownership, PDA derivation, bump field.
    pub fn load_checked_mut<'a>(
        account: &'a AccountView,
        game_engine: &Address,
        team_id: u64,
        program_id: &Address,
    ) -> Result<super::LoadedMut<'a, Self>, ProgramError> {
        if unsafe { account.owner() } != program_id {
            return Err(ProgramError::IllegalOwner);
        }

        let (expected_pda, bump) = Self::derive_pda(game_engine, team_id);
        if account.address() != &expected_pda {
            return Err(GameError::InvalidPDA.into());
        }

        let mut data = account.try_borrow_mut()?;
        super::AccountKey::validate(&data, super::AccountKey::Team)?;
        let ptr = data.as_mut_ptr() as *mut Self;
        let loaded = unsafe { &*ptr };

        if loaded.bump != bump {
            return Err(ProgramError::InvalidSeeds);
        }

        if &loaded.game_engine != game_engine {
            return Err(GameError::KingdomMismatch.into());
        }

        Ok(unsafe { super::LoadedMut::new(data, ptr) })
    }

    /// Load and verify a TeamAccount by key immutably.
    /// Uses stored game_engine to validate PDA derivation.
    /// For use when game_engine is not passed in accounts.
    pub fn load_checked_by_key<'a>(
        account: &'a AccountView,
        program_id: &Address,
    ) -> Result<super::Loaded<'a, Self>, ProgramError> {
        if unsafe { account.owner() } != program_id {
            return Err(ProgramError::IllegalOwner);
        }

        let data = account.try_borrow()?;
        super::AccountKey::validate(&data, super::AccountKey::Team)?;
        let ptr = data.as_ptr() as *const Self;
        let loaded = unsafe { &*ptr };

        // Use stored game_engine and id to re-derive and validate PDA
        let (expected_pda, bump) = Self::derive_pda(&loaded.game_engine, loaded.id);
        if account.address() != &expected_pda {
            return Err(GameError::InvalidPDA.into());
        }

        if loaded.bump != bump {
            return Err(ProgramError::InvalidSeeds);
        }

        Ok(unsafe { super::Loaded::new(data, ptr) })
    }

    /// Load and verify a TeamAccount by key mutably.
    /// Uses stored game_engine to validate PDA derivation.
    /// For use when game_engine is not passed in accounts.
    pub fn load_checked_mut_by_key<'a>(
        account: &'a AccountView,
        program_id: &Address,
    ) -> Result<super::LoadedMut<'a, Self>, ProgramError> {
        if unsafe { account.owner() } != program_id {
            return Err(ProgramError::IllegalOwner);
        }

        let mut data = account.try_borrow_mut()?;
        super::AccountKey::validate(&data, super::AccountKey::Team)?;
        let ptr = data.as_mut_ptr() as *mut Self;
        let loaded = unsafe { &*ptr };

        // Use stored game_engine and id to re-derive and validate PDA
        let (expected_pda, bump) = Self::derive_pda(&loaded.game_engine, loaded.id);
        if account.address() != &expected_pda {
            return Err(GameError::InvalidPDA.into());
        }

        if loaded.bump != bump {
            return Err(ProgramError::InvalidSeeds);
        }

        Ok(unsafe { super::LoadedMut::new(data, ptr) })
    }

    /// Check if team belongs to a specific kingdom
    pub fn is_in_kingdom(&self, game_engine: &Address) -> bool {
        &self.game_engine == game_engine
    }

    /// Get name as &str
    pub fn name(&self) -> &str {
        core::str::from_utf8(&self.name[0..self.name_len as usize])
            .unwrap_or("")
    }

    /// Get MOTD as &str
    pub fn motd(&self) -> &str {
        core::str::from_utf8(&self.motd[0..self.motd_len as usize])
            .unwrap_or("")
    }

    /// Check if team is disbanded
    pub fn is_disbanded(&self) -> bool {
        self.disbanded
    }

    /// Check if team is active (not disbanded and has valid leader)
    pub fn is_active(&self) -> bool {
        !self.disbanded && self.leader != crate::state::player::NULL_PUBKEY
    }

    /// Check if team is public (anyone can join without invite)
    pub fn is_public(&self) -> bool {
        self.settings & Self::SETTING_PUBLIC != 0
    }

    /// Check if team is full
    pub fn is_full(&self) -> bool {
        self.member_count >= self.max_members
    }

    /// Initialize a new team
    pub fn init(
        game_engine: Address,
        id: u64,
        leader: Address,
        bump: u8,
        name: &[u8],
        max_members: u16,
        created_at: i64,
    ) -> Self {
        let mut team = Self {
            account_key: crate::state::AccountKey::Team as u8,
            game_engine,
            id,
            leader,
            bump,
            disbanded: false,
            _padding0: [0; 6],
            name: [0u8; 32],
            name_len: 0,
            _padding1: [0; 7],
            member_count: 1, // Leader is first member
            max_members,
            _padding2: [0; 4],
            created_at,
            last_activity: created_at,
            treasury: 0,
            settings: 0,
            min_level_to_join: 1,
            role_permissions: Self::DEFAULT_ROLE_PERMISSIONS,
            _padding3: 0,
            motd: [0u8; 32],
            motd_len: 0,
            _padding4: [0; 7],
            // Treasury security defaults
            treasury_instant_limit: Self::DEFAULT_INSTANT_LIMIT,
            treasury_daily_cap: Self::DEFAULT_DAILY_CAP,
            treasury_cooldown_hours: Self::DEFAULT_COOLDOWN_HOURS,
            _treasury_reserved: [0; 7],
        };

        let name_len = name.len().min(Self::MAX_NAME_LEN);
        team.name[..name_len].copy_from_slice(&name[..name_len]);
        team.name_len = name_len as u8;

        team
    }
}

// Compile-time size assertion
const _: [(); 280] = [(); core::mem::size_of::<TeamAccount>()];

// TEAM MEMBER SLOT (96 bytes)

/// Individual team member slot PDA.
/// Seeds: [TEAM_SLOT_SEED, team_pubkey, slot_index]
/// Account existence = slot is occupied.
/// When member leaves, account is closed (rent returned).
#[repr(C)]
#[derive(Copy, Clone)]
pub struct TeamMemberSlot {
    /// Account discriminator (AccountKey::TeamMemberSlot)
    pub account_key: u8,

    // === REFERENCES (64 bytes) ===
    pub team: Address,               // 32 - Team account pubkey
    pub player: Address,             // 32 - Player account pubkey (not wallet!)

    // === TIMESTAMPS (8 bytes) ===
    pub joined_at: i64,             // 8 - When member joined

    // === METADATA (8 bytes) ===
    pub slot_index: u16,            // 2 - Slot index (0 to max_members-1)
    pub bump: u8,                   // 1 - PDA bump seed
    pub rank: u8,                   // 1 - Rank level (0=highest to 4=lowest)
    pub _reserved: [u8; 4],         // 4 - Future use

    // === TREASURY TRACKING (16 bytes) ===
    pub treasury_withdrawn_today: u64,  // 8 - Amount withdrawn via instant today
    pub last_treasury_day: u16,         // 2 - Day number (unix_ts / 86400) for reset
    pub _treasury_padding: [u8; 6],     // 6 - Alignment to 8 bytes
}

// Team ranks (5-level hierarchy, lower number = more power)
impl TeamMemberSlot {
    pub const RANK_0: u8 = 0;    // Leader - full control, cannot be kicked
    pub const RANK_1: u8 = 1;    // High rank - nearly all permissions
    pub const RANK_2: u8 = 2;    // Mid rank - moderate permissions
    pub const RANK_3: u8 = 3;    // Low rank - basic permissions
    pub const RANK_4: u8 = 4;    // Lowest rank - minimal permissions
}

impl TeamMemberSlot {
    pub const LEN: usize = core::mem::size_of::<Self>();

    pub unsafe fn load(data: &[u8]) -> &Self {
        &*(data.as_ptr() as *const Self)
    }

    pub unsafe fn load_mut(data: &mut [u8]) -> &mut Self {
        &mut *(data.as_mut_ptr() as *mut Self)
    }

    /// Derive PDA for a team member slot
    /// Seeds: [TEAM_SLOT_SEED, team_pubkey, slot_index]
    pub fn derive_pda(team: &Address, slot_index: u16) -> (Address, u8) {
        pinocchio::Address::find_program_address(
            &[TEAM_SLOT_SEED, team.as_ref(), &slot_index.to_le_bytes()],
            &crate::ID,
        )
    }

    /// Load and verify a TeamMemberSlot immutably.
    pub fn load_checked<'a>(
        account: &'a AccountView,
        team: &Address,
        slot_index: u16,
        program_id: &Address,
    ) -> Result<super::Loaded<'a, Self>, ProgramError> {
        if unsafe { account.owner() } != program_id {
            return Err(ProgramError::IllegalOwner);
        }

        let (expected_pda, bump) = Self::derive_pda(team, slot_index);
        if account.address() != &expected_pda {
            return Err(GameError::InvalidPDA.into());
        }

        let data = account.try_borrow()?;
        super::AccountKey::validate(&data, super::AccountKey::TeamMemberSlot)?;
        let ptr = data.as_ptr() as *const Self;
        let loaded = unsafe { &*ptr };

        if loaded.bump != bump {
            return Err(ProgramError::InvalidSeeds);
        }

        Ok(unsafe { super::Loaded::new(data, ptr) })
    }

    /// Load and verify a TeamMemberSlot mutably.
    pub fn load_checked_mut<'a>(
        account: &'a AccountView,
        team: &Address,
        slot_index: u16,
        program_id: &Address,
    ) -> Result<super::LoadedMut<'a, Self>, ProgramError> {
        if unsafe { account.owner() } != program_id {
            return Err(ProgramError::IllegalOwner);
        }

        let (expected_pda, bump) = Self::derive_pda(team, slot_index);
        if account.address() != &expected_pda {
            return Err(GameError::InvalidPDA.into());
        }

        let mut data = account.try_borrow_mut()?;
        super::AccountKey::validate(&data, super::AccountKey::TeamMemberSlot)?;
        let ptr = data.as_mut_ptr() as *mut Self;
        let loaded = unsafe { &*ptr };

        if loaded.bump != bump {
            return Err(ProgramError::InvalidSeeds);
        }

        Ok(unsafe { super::LoadedMut::new(data, ptr) })
    }

    /// Initialize a new team member slot
    pub fn init(
        team: Address,
        player: Address,
        joined_at: i64,
        slot_index: u16,
        bump: u8,
        rank: u8,
    ) -> Self {
        Self {
            account_key: crate::state::AccountKey::TeamMemberSlot as u8,
            team,
            player,
            joined_at,
            slot_index,
            bump,
            rank,
            _reserved: [0; 4],
            treasury_withdrawn_today: 0,
            last_treasury_day: 0,
            _treasury_padding: [0; 6],
        }
    }

    /// Check if this member is the leader (rank 0)
    pub fn is_leader(&self) -> bool {
        self.rank == Self::RANK_0
    }

    /// Check if this member outranks another (lower number = higher rank)
    pub fn outranks(&self, other_rank: u8) -> bool {
        self.rank < other_rank
    }

    // === Treasury Tracking Methods ===

    /// Seconds per day for day calculation
    const SECONDS_PER_DAY: i64 = 86400;

    /// Get current day number from unix timestamp
    pub fn day_from_timestamp(timestamp: i64) -> u16 {
        (timestamp / Self::SECONDS_PER_DAY) as u16
    }

    /// Reset daily withdrawal counter if it's a new day
    pub fn reset_daily_if_needed(&mut self, current_timestamp: i64) {
        let current_day = Self::day_from_timestamp(current_timestamp);
        if self.last_treasury_day != current_day {
            self.treasury_withdrawn_today = 0;
            self.last_treasury_day = current_day;
        }
    }

    /// Get amount already withdrawn today (auto-resets if new day)
    pub fn get_withdrawn_today(&self, current_timestamp: i64) -> u64 {
        let current_day = Self::day_from_timestamp(current_timestamp);
        if self.last_treasury_day != current_day {
            0  // New day, counter would be reset
        } else {
            self.treasury_withdrawn_today
        }
    }

    /// Record a withdrawal amount (call reset_daily_if_needed first!)
    pub fn record_withdrawal(&mut self, amount: u64) {
        self.treasury_withdrawn_today = self.treasury_withdrawn_today.saturating_add(amount);
    }
}

// Compile-time size assertion
const _: [(); 104] = [(); core::mem::size_of::<TeamMemberSlot>()];

// TEAM INVITE ACCOUNT (128 bytes)

/// Pending team invite PDA.
/// Allows multiple teams to invite the same user.
/// Closed when: user joins, user declines, leader cancels, or expires.
#[repr(C)]
#[derive(Copy, Clone)]
pub struct TeamInviteAccount {
    /// Account discriminator (AccountKey::TeamInvite)
    pub account_key: u8,

    // === IDENTITY (72 bytes - aligned to 8) ===
    pub team: Address,               // 32 - Team account pubkey
    pub invitee: Address,            // 32 - Invitee's player account pubkey
    pub bump: u8,                   // 1 - PDA bump seed
    pub _padding0: [u8; 7],         // 7 - Alignment to 8 bytes

    // === INVITE INFO (48 bytes) ===
    pub inviter: Address,            // 32 - Who sent the invite (for UI display)
    pub created_at: i64,            // 8 - When invite was created
    pub expires_at: i64,            // 8 - When invite expires (0 = never)

    // === RESERVED (8 bytes) ===
    pub _reserved: [u8; 8],         // 8 - Future use (aligned)
}

impl TeamInviteAccount {
    pub const LEN: usize = core::mem::size_of::<Self>();

    pub unsafe fn load(data: &[u8]) -> &Self {
        &*(data.as_ptr() as *const Self)
    }

    pub unsafe fn load_mut(data: &mut [u8]) -> &mut Self {
        &mut *(data.as_mut_ptr() as *mut Self)
    }

    /// Derive PDA for a team invite
    /// Seeds: [TEAM_INVITE_SEED, team_pubkey, invitee_pubkey]
    pub fn derive_pda(team: &Address, invitee: &Address) -> (Address, u8) {
        pinocchio::Address::find_program_address(
            &[TEAM_INVITE_SEED, team.as_ref(), invitee.as_ref()],
            &crate::ID,
        )
    }

    /// Create PDA from known bump
    pub fn create_pda(team: &Address, invitee: &Address, bump: u8) -> Result<Address, ProgramError> {
        let bump_seed = [bump];
        pinocchio::Address::create_program_address(
            &[TEAM_INVITE_SEED, team.as_ref(), invitee.as_ref(), &bump_seed],
            &crate::ID,
        ).map_err(|e| e.into())
    }

    /// Load and verify a TeamInviteAccount immutably.
    pub fn load_checked<'a>(
        account: &'a AccountView,
        team: &Address,
        invitee: &Address,
        program_id: &Address,
    ) -> Result<super::Loaded<'a, Self>, ProgramError> {
        if unsafe { account.owner() } != program_id {
            return Err(ProgramError::IllegalOwner);
        }

        let (expected_pda, bump) = Self::derive_pda(team, invitee);
        if account.address() != &expected_pda {
            return Err(GameError::InvalidPDA.into());
        }

        let data = account.try_borrow()?;
        super::AccountKey::validate(&data, super::AccountKey::TeamInvite)?;
        let ptr = data.as_ptr() as *const Self;
        let loaded = unsafe { &*ptr };

        if loaded.bump != bump {
            return Err(ProgramError::InvalidSeeds);
        }

        Ok(unsafe { super::Loaded::new(data, ptr) })
    }

    /// Load and verify a TeamInviteAccount mutably.
    pub fn load_checked_mut<'a>(
        account: &'a AccountView,
        team: &Address,
        invitee: &Address,
        program_id: &Address,
    ) -> Result<super::LoadedMut<'a, Self>, ProgramError> {
        if unsafe { account.owner() } != program_id {
            return Err(ProgramError::IllegalOwner);
        }

        let (expected_pda, bump) = Self::derive_pda(team, invitee);
        if account.address() != &expected_pda {
            return Err(GameError::InvalidPDA.into());
        }

        let mut data = account.try_borrow_mut()?;
        super::AccountKey::validate(&data, super::AccountKey::TeamInvite)?;
        let ptr = data.as_mut_ptr() as *mut Self;
        let loaded = unsafe { &*ptr };

        if loaded.bump != bump {
            return Err(ProgramError::InvalidSeeds);
        }

        Ok(unsafe { super::LoadedMut::new(data, ptr) })
    }

    /// Check if invite has expired
    pub fn is_expired(&self, now: i64) -> bool {
        self.expires_at > 0 && now >= self.expires_at
    }

    /// Initialize a new team invite
    pub fn init(
        team: Address,
        invitee: Address,
        bump: u8,
        inviter: Address,
        created_at: i64,
        expires_at: i64,
    ) -> Self {
        Self {
            account_key: crate::state::AccountKey::TeamInvite as u8,
            team,
            invitee,
            bump,
            _padding0: [0; 7],
            inviter,
            created_at,
            expires_at,
            _reserved: [0; 8],
        }
    }
}

// Compile-time size assertion
const _: [(); 136] = [(); core::mem::size_of::<TeamInviteAccount>()];

// TREASURY REQUEST (104 bytes)

/// Pending treasury withdrawal request PDA.
/// For amounts above instant limit, creates a request with cooldown.
/// Higher rank can approve (immediate execution) or reject.
/// After cooldown, requester can execute if still valid.
/// Seeds: [TREASURY_REQUEST_SEED, team_pubkey, requester_pubkey]
/// Only one pending request per member at a time.
#[repr(C)]
#[derive(Copy, Clone)]
pub struct TreasuryRequest {
    /// Account discriminator (AccountKey::TreasuryRequest)
    pub account_key: u8,

    // === IDENTITY (64 bytes) ===
    pub team: Address,               // 32 - Team account pubkey
    pub requester: Address,          // 32 - Requester's player account pubkey

    // === REQUEST DATA (24 bytes) ===
    pub amount: u64,                // 8 - Amount requested
    pub created_at: i64,            // 8 - When request was created
    pub executable_at: i64,         // 8 - When request becomes executable (created_at + cooldown)

    // === METADATA (16 bytes) ===
    pub bump: u8,                   // 1 - PDA bump seed
    pub _reserved: [u8; 15],        // 15 - Future use + alignment
}

impl TreasuryRequest {
    pub const LEN: usize = core::mem::size_of::<Self>();

    pub unsafe fn load(data: &[u8]) -> &Self {
        &*(data.as_ptr() as *const Self)
    }

    pub unsafe fn load_mut(data: &mut [u8]) -> &mut Self {
        &mut *(data.as_mut_ptr() as *mut Self)
    }

    /// Derive PDA for a treasury request
    /// Seeds: [TREASURY_REQUEST_SEED, team_pubkey, requester_pubkey]
    pub fn derive_pda(team: &Address, requester: &Address) -> (Address, u8) {
        pinocchio::Address::find_program_address(
            &[crate::constants::TREASURY_REQUEST_SEED, team.as_ref(), requester.as_ref()],
            &crate::ID,
        )
    }

    /// Create PDA from known bump
    pub fn create_pda(team: &Address, requester: &Address, bump: u8) -> Result<Address, ProgramError> {
        let bump_seed = [bump];
        pinocchio::Address::create_program_address(
            &[crate::constants::TREASURY_REQUEST_SEED, team.as_ref(), requester.as_ref(), &bump_seed],
            &crate::ID,
        ).map_err(|e| e.into())
    }

    /// Check if request is past cooldown and can be executed
    pub fn is_executable(&self, now: i64) -> bool {
        now >= self.executable_at
    }

    /// Check if request has been pending too long (optional expiry - 7 days)
    pub fn is_expired(&self, now: i64) -> bool {
        const MAX_PENDING_SECONDS: i64 = 7 * 24 * 3600; // 7 days
        now > self.created_at + MAX_PENDING_SECONDS
    }

    /// Initialize a new treasury request
    pub fn init(
        team: Address,
        requester: Address,
        amount: u64,
        created_at: i64,
        cooldown_seconds: i64,
        bump: u8,
    ) -> Self {
        Self {
            account_key: crate::state::AccountKey::TreasuryRequest as u8,
            team,
            requester,
            amount,
            created_at,
            executable_at: created_at + cooldown_seconds,
            bump,
            _reserved: [0; 15],
        }
    }
}

// Compile-time size assertion
const _: [(); 112] = [(); core::mem::size_of::<TreasuryRequest>()];
