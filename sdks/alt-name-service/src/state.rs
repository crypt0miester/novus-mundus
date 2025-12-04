use pinocchio::pubkey::Pubkey;

use crate::NAME_RECORD_DISCRIMINATOR;

/// Name Record Header - 200 bytes
#[repr(C)]
#[derive(Copy, Clone)]
pub struct NameRecordHeader {
    pub discriminator: [u8; 8],
    pub parent_name: Pubkey,
    pub owner: Pubkey,
    pub nclass: Pubkey,
    pub expires_at: u64,
    pub created_at: u64,
    pub non_transferable: bool,
    pub _reserved: [u8; 79],
}

impl NameRecordHeader {
    pub const LEN: usize = 200;

    #[inline(always)]
    pub unsafe fn load(data: &[u8]) -> &Self {
        &*(data.as_ptr() as *const Self)
    }

    #[inline(always)]
    pub fn is_valid(&self) -> bool {
        self.discriminator == NAME_RECORD_DISCRIMINATOR
    }

    #[inline(always)]
    pub fn is_expired(&self, current_time: i64) -> bool {
        self.expires_at != 0 && (self.expires_at as i64) < current_time
    }

    #[inline(always)]
    pub fn is_owner(&self, owner: &Pubkey) -> bool {
        &self.owner == owner
    }
}

/// Get name bytes from account data (after 200-byte header)
#[inline(always)]
pub fn get_name_bytes(account_data: &[u8]) -> &[u8] {
    if account_data.len() <= NameRecordHeader::LEN {
        return &[];
    }
    &account_data[NameRecordHeader::LEN..]
}

/// Get name length from account data length
#[inline(always)]
pub fn get_name_length(account_data_len: usize) -> usize {
    account_data_len.saturating_sub(NameRecordHeader::LEN)
}
