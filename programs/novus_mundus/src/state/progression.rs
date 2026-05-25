use crate::constants::PROGRESSION_SEED;
use pinocchio::error::ProgramError;
use pinocchio::Address;

/// Progression tracking (placeholder - implement as needed)
#[repr(C)]
#[derive(Copy, Clone)]
pub struct ProgressionAccount {
    /// Account discriminator
    pub account_key: u8,
    pub player: Address,   // 32 bytes
    pub level: u8,         // 1 byte
    pub xp: u64,           // 8 bytes
    pub bump: u8,          // 1 byte - PDA bump seed
    pub _padding: [u8; 6], // 6 bytes
}

impl ProgressionAccount {
    pub const LEN: usize = core::mem::size_of::<Self>();

    pub unsafe fn load(data: &[u8]) -> &Self {
        &*(data.as_ptr() as *const Self)
    }

    pub unsafe fn load_mut(data: &mut [u8]) -> &mut Self {
        &mut *(data.as_mut_ptr() as *mut Self)
    }

    /// Derive PDA for a progression account
    /// Seeds: [PROGRESSION_SEED, player]
    pub fn derive_pda(player: &Address) -> (Address, u8) {
        pinocchio::Address::find_program_address(&[PROGRESSION_SEED, player.as_ref()], &crate::ID)
    }

    /// Create PDA from known bump
    pub fn create_pda(player: &Address, bump: u8) -> Result<Address, ProgramError> {
        let bump_seed = [bump];
        pinocchio::Address::create_program_address(
            &[PROGRESSION_SEED, player.as_ref(), &bump_seed],
            &crate::ID,
        )
        .map_err(|e| e.into())
    }
}
