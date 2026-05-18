use pinocchio::{
    AccountView,
    Address,
    error::ProgramError,
};
use crate::constants::BUILDING_TEMPLATE_SEED;
use crate::error::GameError;
use crate::logic::safe_math::exp_growth;
use crate::state::AccountKey;

/// Building Template — DAO-controlled cost/time configuration for one
/// `BuildingType`. One PDA per building type (seed `building_template` + the
/// type byte). The build/upgrade processors read this instead of hardcoded
/// per-tier values, so costs are tunable without a program redeploy.
#[repr(C)]
#[derive(Copy, Clone)]
pub struct BuildingTemplate {
    /// Account discriminator (AccountKey::BuildingTemplate)
    pub account_key: u8,
    /// BuildingType discriminant (0-18)
    pub building_type: u8,
    /// Tier 1-3 (informational; cost/time come from the fields below)
    pub tier: u8,
    /// Max upgrade level
    pub max_level: u8,
    /// Base construction time in seconds (a level-0 build)
    pub base_time_seconds: u32,
    /// Base NOVI cost (a level-0 build)
    pub base_novi_cost: u64,
    /// Per-level cost growth, in bps of 10_000 (26_180 = x2.618)
    pub cost_growth_bps: u16,
    /// Per-(level/5) time growth, in bps of 10_000 (26_180 = x2.618)
    pub time_growth_bps: u16,
    /// DAO can disable a building entirely
    pub is_active: bool,
    /// PDA bump
    pub bump: u8,
    pub _padding: [u8; 10],
}

impl BuildingTemplate {
    pub const LEN: usize = core::mem::size_of::<Self>();

    /// UNSAFE: Load from raw account data
    pub unsafe fn load(data: &[u8]) -> &Self {
        &*(data.as_ptr() as *const Self)
    }

    /// UNSAFE: Load mutable from raw account data
    pub unsafe fn load_mut(data: &mut [u8]) -> &mut Self {
        &mut *(data.as_mut_ptr() as *mut Self)
    }

    /// Derive the PDA for a building template account
    pub fn derive_pda(building_type: u8) -> (Address, u8) {
        pinocchio::Address::find_program_address(
            &[BUILDING_TEMPLATE_SEED, &[building_type]],
            &crate::ID,
        )
    }

    /// Create PDA from a known bump
    pub fn create_pda(building_type: u8, bump: u8) -> Result<Address, ProgramError> {
        let bump_seed = [bump];
        pinocchio::Address::create_program_address(
            &[BUILDING_TEMPLATE_SEED, &[building_type], &bump_seed],
            &crate::ID,
        ).map_err(|e| e.into())
    }

    /// NOVI cost of an action performed at `level`.
    ///
    /// `level = 0` → base cost (a new build). An upgrade from level L pays
    /// `base x (cost_growth_bps/10_000)^L`, per-step integer floor — exactly
    /// the previous `cost x 2618 / 1000` per-level loop (26_180/10_000 == 2618/1000).
    pub fn calculate_construction_cost(&self, level: u8) -> u64 {
        exp_growth(self.base_novi_cost, self.cost_growth_bps as u64, 10_000, level as u32)
            .unwrap_or(u64::MAX)
    }

    /// Construction time in seconds for an action performed at `level`.
    ///
    /// `level = 0` → base time. Time scales once per 5 levels (slower than cost),
    /// matching the previous `time x 2618 / 1000` per `level/5` loop.
    pub fn calculate_construction_time(&self, level: u8) -> i64 {
        let time = exp_growth(
            self.base_time_seconds as u64,
            self.time_growth_bps as u64,
            10_000,
            (level / 5) as u32,
        ).unwrap_or(i64::MAX as u64);
        time.min(i64::MAX as u64) as i64
    }

    /// Borrow, validate, and resolve the cost/time of an action at `level`.
    ///
    /// Confirms the account is a BuildingTemplate at the canonical PDA for
    /// `building_type` (via the stored bump — no `find_program_address`) and is
    /// active. The caller is expected to have already checked program ownership.
    /// Returns `(novi_cost, time_seconds, max_level)`.
    pub fn resolve(
        account: &AccountView,
        building_type: u8,
        level: u8,
    ) -> Result<(u64, i64, u8), ProgramError> {
        let data = account.try_borrow()?;
        AccountKey::validate(&data, AccountKey::BuildingTemplate)?;
        let template = unsafe { Self::load(&data) };
        let expected = Self::create_pda(building_type, template.bump)?;
        if account.address() != &expected {
            return Err(ProgramError::InvalidSeeds);
        }
        if !template.is_active {
            return Err(GameError::InvalidParameter.into());
        }
        Ok((
            template.calculate_construction_cost(level),
            template.calculate_construction_time(level),
            template.max_level,
        ))
    }
}

// Compile-time guarantee the zero-copy layout is exactly 32 bytes with no
// hidden padding — the SDK deserializer reads the fields sequentially.
const _: () = assert!(BuildingTemplate::LEN == 32);
