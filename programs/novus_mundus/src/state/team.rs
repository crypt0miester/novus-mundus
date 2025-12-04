use pinocchio::pubkey::Pubkey;
use crate::constants::MAX_TEAM_MEMBERS;

/// Team account with fixed array for members
#[repr(C)]
#[derive(Copy, Clone)]
pub struct TeamAccount {
    pub id: u64,                                // 8 bytes
    pub leader: Pubkey,                         // 32 bytes
    pub name: [u8; 32],                         // 32 bytes
    pub name_len: u8,                           // 1 byte
    pub disbanded: bool,                        // 1 byte - TRUE if team has been disbanded
    pub _padding1: [u8; 6],                     // 6 bytes

    pub members: [Pubkey; 50],                  // 32 * 50 = 1600 bytes
    pub member_count: u8,                       // 1 byte (actual count 0-50)
    pub _padding2: [u8; 7],                     // 7 bytes

    pub created_at: i64,                        // 8 bytes
    pub treasury: u64,                          // 8 bytes

    // Reserved for future expansion (u128 upgrades, new aggregate fields)
    pub _reserved: [u8; 64],                    // 64 bytes
}

impl TeamAccount {
    pub const LEN: usize = core::mem::size_of::<Self>();
    pub const MAX_MEMBERS: usize = 50;

    pub unsafe fn load(data: &[u8]) -> &Self {
        &*(data.as_ptr() as *const Self)
    }

    pub unsafe fn load_mut(data: &mut [u8]) -> &mut Self {
        &mut *(data.as_mut_ptr() as *mut Self)
    }

    /// Get name as &str
    pub fn name(&self) -> &str {
        core::str::from_utf8(&self.name[0..self.name_len as usize])
            .unwrap_or("")
    }

    /// Get members slice
    pub fn members(&self) -> &[Pubkey] {
        &self.members[0..self.member_count as usize]
    }

    /// Add member
    pub fn add_member(&mut self, pubkey: Pubkey) -> Result<(), crate::error::GameError> {
        if self.member_count >= Self::MAX_MEMBERS as u8 {
            return Err(crate::error::GameError::TeamFull);
        }
        self.members[self.member_count as usize] = pubkey;
        self.member_count += 1;
        Ok(())
    }

    /// Check if team is disbanded
    pub fn is_disbanded(&self) -> bool {
        self.disbanded
    }

    /// Check if team is active (not disbanded and has valid leader)
    pub fn is_active(&self) -> bool {
        !self.disbanded && self.leader != crate::state::player::NULL_PUBKEY
    }
}
