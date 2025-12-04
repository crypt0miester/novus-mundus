use pinocchio::pubkey::Pubkey;

/// Progression tracking (placeholder - implement as needed)
#[repr(C)]
#[derive(Copy, Clone)]
pub struct ProgressionAccount {
    pub player: Pubkey,                         // 32 bytes
    pub level: u8,                              // 1 byte
    pub xp: u64,                                // 8 bytes
    pub _padding: [u8; 7],                      // 7 bytes
}

impl ProgressionAccount {
    pub const LEN: usize = core::mem::size_of::<Self>();

    pub unsafe fn load(data: &[u8]) -> &Self {
        &*(data.as_ptr() as *const Self)
    }

    pub unsafe fn load_mut(data: &mut [u8]) -> &mut Self {
        &mut *(data.as_mut_ptr() as *mut Self)
    }
}
