use pinocchio::pubkey::Pubkey;
use super::{Key, UpdateAuthority};

/// Maximum length for asset name
pub const MAX_NAME_LEN: usize = 32;
/// Maximum length for asset URI
pub const MAX_URI_LEN: usize = 200;

/// The Core Asset structure that exists at the beginning of every asset account.
#[repr(C)]
#[derive(Copy, Clone, Debug)]
pub struct AssetV1 {
    /// The account discriminator.
    pub key: Key,
    /// The owner of the asset.
    pub owner: Pubkey,
    /// The update authority of the asset.
    pub update_authority: UpdateAuthority,
    /// The name of the asset (fixed size with actual length).
    pub name: [u8; MAX_NAME_LEN],
    /// Actual length of the name.
    pub name_len: u32,
    /// The URI of the asset that points to the off-chain data.
    pub uri: [u8; MAX_URI_LEN],
    /// Actual length of the URI.
    pub uri_len: u32,
    /// The sequence number used for indexing with compression (u64::MAX = None).
    pub seq: u64,
    /// Whether seq is valid (true if compressed)
    pub has_seq: bool,
    /// Padding for alignment
    pub _padding: [u8; 7],
}

impl AssetV1 {
    /// The fixed size of an AssetV1 account in bytes
    pub const LEN: usize = 1 // Key discriminator
        + 32 // Owner pubkey
        + 33 // UpdateAuthority (1 byte discriminator + 32 bytes pubkey)
        + MAX_NAME_LEN // Name array
        + 4 // Name length
        + MAX_URI_LEN // URI array
        + 4 // URI length
        + 8 // seq u64
        + 1 // has_seq bool
        + 7; // padding

    /// Load an AssetV1 from account data
    pub unsafe fn load(data: &[u8]) -> &Self {
        &*(data.as_ptr() as *const Self)
    }

    /// Load a mutable AssetV1 from account data
    pub unsafe fn load_mut(data: &mut [u8]) -> &mut Self {
        &mut *(data.as_mut_ptr() as *mut Self)
    }

    /// Create a new AssetV1
    pub fn new(
        owner: Pubkey,
        update_authority: UpdateAuthority,
        name: &[u8],
        uri: &[u8],
    ) -> Self {
        let mut asset = Self {
            key: Key::AssetV1,
            owner,
            update_authority,
            name: [0u8; MAX_NAME_LEN],
            name_len: 0,
            uri: [0u8; MAX_URI_LEN],
            uri_len: 0,
            seq: 0,
            has_seq: false,
            _padding: [0u8; 7],
        };

        // Copy name
        let name_len = name.len().min(MAX_NAME_LEN);
        asset.name[..name_len].copy_from_slice(&name[..name_len]);
        asset.name_len = name_len as u32;

        // Copy URI
        let uri_len = uri.len().min(MAX_URI_LEN);
        asset.uri[..uri_len].copy_from_slice(&uri[..uri_len]);
        asset.uri_len = uri_len as u32;

        asset
    }

    /// Get the name as a slice
    pub fn get_name(&self) -> &[u8] {
        let len = (self.name_len as usize).min(MAX_NAME_LEN);
        &self.name[..len]
    }

    /// Get the URI as a slice
    pub fn get_uri(&self) -> &[u8] {
        let len = (self.uri_len as usize).min(MAX_URI_LEN);
        &self.uri[..len]
    }

    /// Check if this is a valid AssetV1 account
    pub fn is_valid(&self) -> bool {
        self.key == Key::AssetV1
    }

    /// Check if the asset is compressed
    pub fn is_compressed(&self) -> bool {
        self.has_seq
    }

    /// Increment sequence number if asset is compressed
    pub fn increment_seq(&mut self) {
        if self.has_seq {
            self.seq = self.seq.saturating_add(1);
        }
    }
}