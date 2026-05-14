use pinocchio::{
    AccountView,
    error::ProgramError,
    Address,
    sysvars::{clock::Clock, Sysvar},
};
use solana_sha256_hasher::hashv as sha256_hashv;

use alt_name_service::state::{get_name_bytes, NameRecordHeader};

use crate::NULL_PUBKEY;

/// Hash prefix used by Alt Name Service for deriving PDAs
/// Hash = SHA256("ALT Name Service" + name_string)
pub const HASH_PREFIX: &[u8] = b"ALT Name Service";

/// Computes SHA256 hash of multiple byte slices concatenated.
/// Uses the sol_sha256 syscall.
#[inline]
pub fn hashv(vals: &[&[u8]]) -> [u8; 32] {
    sha256_hashv(vals).to_bytes()
}

/// Computes the name hash for Alt Name Service PDA derivation.
/// hash = SHA256(HASH_PREFIX + name)
#[inline]
pub fn compute_name_hash(name: &[u8]) -> [u8; 32] {
    hashv(&[HASH_PREFIX, name])
}

/// TLD House Program ID: TLDHkysf5pCnKsVA4gXpNvmy7psXLPEu4LAdDJthT9S
pub const TLD_HOUSE_PROGRAM_ID: Address = Address::new_from_array(
    five8_const::decode_32_const("TLDHkysf5pCnKsVA4gXpNvmy7psXLPEu4LAdDJthT9S"),
);

/// TldHouse account layout (Anchor):
/// - 8 bytes: discriminator
/// - 32 bytes: treasury_manager
/// - 32 bytes: authority
/// - 32 bytes: tld_registry_pubkey
/// - String: tld (4 bytes length + data, e.g., ".sol")
const TLDHOUSE_TLD_OFFSET: usize = 8 + 32 + 32 + 32; // 104

/// Extracts the TLD string from a TldHouse account (e.g., ".sol").
/// Returns the TLD bytes trimmed of trailing zeros.
pub fn get_tld_from_tld_house(tld_house: &AccountView) -> Result<&[u8], ProgramError> {
    let data = tld_house.try_borrow()?;

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
/// - `reverse_acc_hashed_name`: Pre-computed hash = SHA256("ALT Name Service" + name_account.address().to_base58())
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
    name_account: &AccountView,
    reverse_name_account: &'a AccountView,
    name_parent: &AccountView,
    tld_house: &AccountView,
    owner: &Address,
    reverse_acc_hashed_name: &[u8; 32],
) -> Result<&'a [u8], ProgramError> {
    // === 1. Validate tld_house is owned by TLD House program ===
    if unsafe { tld_house.owner() } != &TLD_HOUSE_PROGRAM_ID {
        return Err(ProgramError::IncorrectProgramId);
    }

    // === 2. Validate name_parent (TLD account) ===
    let parent_data = name_parent.try_borrow()?;
    if parent_data.len() < NameRecordHeader::LEN {
        return Err(ProgramError::InvalidAccountData);
    }
    let parent_header = unsafe { NameRecordHeader::load(&parent_data) };

    if !parent_header.is_valid() {
        return Err(ProgramError::InvalidAccountData);
    }

    if !parent_header.is_owner(tld_house.address()) {
        return Err(ProgramError::IllegalOwner);
    }
    drop(parent_data);

    // === 3. Validate name_account (forward domain) ===
    let name_data = name_account.try_borrow()?;
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

    if &name_header.nclass != NULL_PUBKEY.as_array() {
        return Err(ProgramError::InvalidAccountData);
    }

    let clock = Clock::get()?;
    if name_header.is_expired(clock.unix_timestamp) {
        return Err(ProgramError::InvalidAccountData);
    }

    if &name_header.parent_name != name_parent.address().as_array() {
        return Err(ProgramError::InvalidAccountData);
    }
    drop(name_data);

    // === 4. Validate reverse_name_account header ===
    let reverse_data = reverse_name_account.try_borrow()?;
    if reverse_data.len() < NameRecordHeader::LEN {
        return Err(ProgramError::InvalidAccountData);
    }
    let reverse_header = unsafe { NameRecordHeader::load(&reverse_data) };

    if !reverse_header.is_valid() {
        return Err(ProgramError::InvalidAccountData);
    }

    if &reverse_header.nclass != tld_house.address().as_array() {
        return Err(ProgramError::InvalidAccountData);
    }

    if &reverse_header.parent_name != NULL_PUBKEY.as_array() {
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
    // reverse_acc_hashed_name = SHA256("ALT Name Service" + name_account.address().to_base58())
    // PDA seeds: [hash, tld_house.address(), NULL_PUBKEY]
    let reverse_seeds: &[&[u8]] = &[
        reverse_acc_hashed_name.as_ref(),
        tld_house.address().as_ref(),
        NULL_PUBKEY.as_ref(),
    ];

    let (derived_reverse_pda, _) =
        pinocchio::Address::find_program_address(reverse_seeds, &alt_name_service::ID);

    if derived_reverse_pda != *reverse_name_account.address() {
        return Err(ProgramError::InvalidAccountData);
    }

    // === 6. Verify forward name account PDA ===
    // Forward PDA seeds: [hash(domain_name), NULL_PUBKEY, name_parent.address()]
    let hashed_name = compute_name_hash(domain_name);

    let forward_seeds: &[&[u8]] = &[
        hashed_name.as_ref(),
        NULL_PUBKEY.as_ref(),
        name_parent.address().as_ref(),
    ];

    let (derived_forward_pda, _) =
        pinocchio::Address::find_program_address(forward_seeds, &alt_name_service::ID);

    if derived_forward_pda != *name_account.address() {
        return Err(ProgramError::InvalidAccountData);
    }

    Ok(domain_name)
}