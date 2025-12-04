use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
    syscalls::sol_sha256,
    sysvars::{clock::Clock, Sysvar},
};

use alt_name_service::state::{get_name_bytes, NameRecordHeader};

use crate::NULL_PUBKEY;

/// Hash prefix used by Alt Name Service for deriving PDAs
/// Hash = SHA256("ALT Name Service" + name_string)
pub const HASH_PREFIX: &[u8] = b"ALT Name Service";

/// Computes SHA256 hash of multiple byte slices concatenated.
/// Uses the sol_sha256 syscall.
#[inline]
pub fn hashv(vals: &[&[u8]]) -> [u8; 32] {
    // Build array of (ptr, len) pairs for the syscall
    // The syscall expects: &[(data_ptr, data_len), ...]
    #[repr(C)]
    struct SliceRef {
        ptr: *const u8,
        len: u64,
    }

    let mut result = [0u8; 32];

    // Stack-allocate for small number of slices (common case: 2)
    if vals.len() <= 4 {
        let mut refs: [SliceRef; 4] = [
            SliceRef {
                ptr: core::ptr::null(),
                len: 0,
            },
            SliceRef {
                ptr: core::ptr::null(),
                len: 0,
            },
            SliceRef {
                ptr: core::ptr::null(),
                len: 0,
            },
            SliceRef {
                ptr: core::ptr::null(),
                len: 0,
            },
        ];
        for (i, val) in vals.iter().enumerate() {
            refs[i] = SliceRef {
                ptr: val.as_ptr(),
                len: val.len() as u64,
            };
        }
        unsafe {
            sol_sha256(
                refs.as_ptr() as *const u8,
                vals.len() as u64,
                result.as_mut_ptr(),
            );
        }
    }

    result
}

/// Computes the name hash for Alt Name Service PDA derivation.
/// hash = SHA256(HASH_PREFIX + name)
#[inline]
pub fn compute_name_hash(name: &[u8]) -> [u8; 32] {
    hashv(&[HASH_PREFIX, name])
}

/// TLD House Program ID: TLDHkysf5pCnKsVA4gXpNvmy7psXLPEu4LAdDJthT9S
pub const TLD_HOUSE_PROGRAM_ID: Pubkey = [
    0x05, 0x1e, 0x88, 0x5b, 0x08, 0x2e, 0x7e, 0x6b,
    0x90, 0x5e, 0x9a, 0x8b, 0x0e, 0x93, 0x5c, 0x7e,
    0x0c, 0xd1, 0x8f, 0x1c, 0x8a, 0x5e, 0x9a, 0x24,
    0x0e, 0x4c, 0x3e, 0x7c, 0x9f, 0x6a, 0x7c, 0x3b,
];

/// TldHouse account layout (Anchor):
/// - 8 bytes: discriminator
/// - 32 bytes: treasury_manager
/// - 32 bytes: authority
/// - 32 bytes: tld_registry_pubkey
/// - String: tld (4 bytes length + data, e.g., ".sol")
const TLDHOUSE_TLD_OFFSET: usize = 8 + 32 + 32 + 32; // 104

/// Extracts the TLD string from a TldHouse account (e.g., ".sol").
/// Returns the TLD bytes trimmed of trailing zeros.
pub fn get_tld_from_tld_house(tld_house: &AccountInfo) -> Result<&[u8], ProgramError> {
    let data = tld_house.try_borrow_data()?;

    // Need at least offset + 4 bytes for string length
    if data.len() < TLDHOUSE_TLD_OFFSET + 4 {
        return Err(ProgramError::InvalidAccountData);
    }

    // Read string length (4 bytes little endian)
    let len_bytes: [u8; 4] = data[TLDHOUSE_TLD_OFFSET..TLDHOUSE_TLD_OFFSET + 4]
        .try_into()
        .map_err(|_| ProgramError::InvalidAccountData)?;
    let tld_len = u32::from_le_bytes(len_bytes) as usize;

    if data.len() < TLDHOUSE_TLD_OFFSET + 4 + tld_len {
        return Err(ProgramError::InvalidAccountData);
    }

    // SAFETY: Account data valid for instruction duration
    let data_ptr = data.as_ptr();
    let data_len = data.len();
    drop(data);

    let full_slice = unsafe { core::slice::from_raw_parts(data_ptr, data_len) };
    let tld_start = TLDHOUSE_TLD_OFFSET + 4;
    let tld = &full_slice[tld_start..tld_start + tld_len];

    // Trim trailing zeros (shouldn't have any but just in case)
    let end = tld.iter().rposition(|&b| b != 0).map(|i| i + 1).unwrap_or(tld_len);

    Ok(&tld[..end])
}

/// Validates name accounts and returns the domain name.
///
/// Single efficient validation function for all name operations.
/// Validates both forward and reverse name accounts.
///
/// Accounts:
/// - `name_account`: The forward name account (domain.tld)
/// - `reverse_name_account`: The reverse lookup account
/// - `name_parent`: The parent TLD account (.tld)
/// - `tld_house`: The TldHouse account that owns the parent TLD
/// - `owner`: Expected owner of the name_account
/// - `reverse_acc_hashed_name`: Pre-computed hash = SHA256("ALT Name Service" + name_account.key().to_base58())
///   (computed off-chain since base58 encoding is expensive on-chain)
///
/// Validates:
/// 1. tld_house: owned by TLD_HOUSE_PROGRAM_ID
/// 2. name_parent: valid header, owned by tld_house
/// 3. name_account: valid header, correct owner, nclass=NULL, not expired, parent matches
/// 4. reverse_name_account: valid header, nclass=tld_house, parent=NULL, PDA matches
/// 5. Forward PDA derivation: domain name in reverse derives to name_account
///
/// Returns the domain name bytes on success.
pub fn validate_and_get_domain_name<'a>(
    name_account: &AccountInfo,
    reverse_name_account: &'a AccountInfo,
    name_parent: &AccountInfo,
    tld_house: &AccountInfo,
    owner: &Pubkey,
    reverse_acc_hashed_name: &[u8; 32],
) -> Result<&'a [u8], ProgramError> {
    // === 1. Validate tld_house is owned by TLD House program ===
    if tld_house.owner() != &TLD_HOUSE_PROGRAM_ID {
        return Err(ProgramError::IncorrectProgramId);
    }

    // === 2. Validate name_parent (TLD account) ===
    let parent_data = name_parent.try_borrow_data()?;
    if parent_data.len() < NameRecordHeader::LEN {
        return Err(ProgramError::InvalidAccountData);
    }
    let parent_header = unsafe { NameRecordHeader::load(&parent_data) };

    if !parent_header.is_valid() {
        return Err(ProgramError::InvalidAccountData);
    }

    if !parent_header.is_owner(tld_house.key()) {
        return Err(ProgramError::IllegalOwner);
    }
    drop(parent_data);

    // === 3. Validate name_account (forward domain) ===
    let name_data = name_account.try_borrow_data()?;
    if name_data.len() < NameRecordHeader::LEN {
        return Err(ProgramError::InvalidAccountData);
    }
    let name_header = unsafe { NameRecordHeader::load(&name_data) };

    if !name_header.is_valid() {
        return Err(ProgramError::InvalidAccountData);
    }

    if !name_header.is_owner(owner) {
        return Err(ProgramError::IllegalOwner);
    }

    if name_header.nclass != NULL_PUBKEY {
        return Err(ProgramError::InvalidAccountData);
    }

    let clock = Clock::get()?;
    if name_header.is_expired(clock.unix_timestamp) {
        return Err(ProgramError::InvalidAccountData);
    }

    if name_header.parent_name != *name_parent.key() {
        return Err(ProgramError::InvalidAccountData);
    }
    drop(name_data);

    // === 4. Validate reverse_name_account header ===
    let reverse_data = reverse_name_account.try_borrow_data()?;
    if reverse_data.len() < NameRecordHeader::LEN {
        return Err(ProgramError::InvalidAccountData);
    }
    let reverse_header = unsafe { NameRecordHeader::load(&reverse_data) };

    if !reverse_header.is_valid() {
        return Err(ProgramError::InvalidAccountData);
    }

    if reverse_header.nclass != *tld_house.key() {
        return Err(ProgramError::InvalidAccountData);
    }

    if reverse_header.parent_name != NULL_PUBKEY {
        return Err(ProgramError::InvalidAccountData);
    }

    // Extract domain name from reverse account data
    let name_bytes = get_name_bytes(&reverse_data);
    let domain_end = name_bytes
        .iter()
        .rposition(|&b| b != 0)
        .map(|i| i + 1)
        .unwrap_or(0);

    if domain_end == 0 {
        return Err(ProgramError::InvalidAccountData);
    }

    // SAFETY: Account data valid for instruction duration
    let data_ptr = reverse_data.as_ptr();
    let data_len = reverse_data.len();
    drop(reverse_data);

    let full_slice = unsafe { core::slice::from_raw_parts(data_ptr, data_len) };
    let domain_name = &full_slice[NameRecordHeader::LEN..NameRecordHeader::LEN + domain_end];

    // === 5. Verify reverse name account PDA ===
    // reverse_acc_hashed_name = SHA256("ALT Name Service" + name_account.key().to_base58())
    // PDA seeds: [hash, tld_house.key(), NULL_PUBKEY]
    let reverse_seeds: &[&[u8]] = &[
        reverse_acc_hashed_name.as_ref(),
        tld_house.key().as_ref(),
        NULL_PUBKEY.as_ref(),
    ];

    let (derived_reverse_pda, _) =
        pinocchio::pubkey::find_program_address(reverse_seeds, &alt_name_service::ID);

    if derived_reverse_pda != *reverse_name_account.key() {
        return Err(ProgramError::InvalidAccountData);
    }

    // === 6. Verify forward name account PDA ===
    // Forward PDA seeds: [hash(domain_name), NULL_PUBKEY, name_parent.key()]
    let hashed_name = compute_name_hash(domain_name);

    let forward_seeds: &[&[u8]] = &[
        hashed_name.as_ref(),
        NULL_PUBKEY.as_ref(),
        name_parent.key().as_ref(),
    ];

    let (derived_forward_pda, _) =
        pinocchio::pubkey::find_program_address(forward_seeds, &alt_name_service::ID);

    if derived_forward_pda != *name_account.key() {
        return Err(ProgramError::InvalidAccountData);
    }

    Ok(domain_name)
}

/// Extracts the domain name from a name account's data region.
///
/// Returns the raw bytes after the 200-byte header, trimmed of trailing zeros.
#[inline]
pub fn get_domain_name(name_account: &AccountInfo) -> Result<&[u8], ProgramError> {
    let data = name_account.try_borrow_data()?;
    if data.len() < NameRecordHeader::LEN {
        return Err(ProgramError::InvalidAccountData);
    }

    // SAFETY: We need to return a reference that outlives the borrow.
    // The account data is valid for the duration of the instruction.
    let data_ptr = data.as_ptr();
    let data_len = data.len();
    drop(data);

    let full_slice = unsafe { core::slice::from_raw_parts(data_ptr, data_len) };
    let name_bytes = get_name_bytes(full_slice);

    // Trim trailing zeros
    let end = name_bytes
        .iter()
        .rposition(|&b| b != 0)
        .map(|i| i + 1)
        .unwrap_or(0);

    Ok(&name_bytes[..end])
}
