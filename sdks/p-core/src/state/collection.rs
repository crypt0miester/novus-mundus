use super::{Key, UpdateAuthority, MAX_NAME_LEN, MAX_URI_LEN};

/// The Core Collection structure for grouping assets.
#[repr(C)]
#[derive(Copy, Clone, Debug)]
pub struct CollectionV1 {
    /// The account discriminator.
    pub key: Key,
    /// The update authority of the collection.
    pub update_authority: UpdateAuthority,
    /// The name of the collection.
    pub name: [u8; MAX_NAME_LEN],
    /// Actual length of the name.
    pub name_len: u32,
    /// The URI of the collection that points to the off-chain data.
    pub uri: [u8; MAX_URI_LEN],
    /// Actual length of the URI.
    pub uri_len: u32,
    /// The current number of assets in the collection.
    pub num_minted: u32,
    /// The maximum number of assets that can be minted in the collection (0 = unlimited).
    pub current_size: u32,
}

impl CollectionV1 {
    /// The fixed size of a CollectionV1 account in bytes
    pub const LEN: usize = 1 // Key discriminator
        + 33 // UpdateAuthority (1 byte discriminator + 32 bytes pubkey)
        + MAX_NAME_LEN // Name array
        + 4 // Name length
        + MAX_URI_LEN // URI array
        + 4 // URI length
        + 4 // num_minted
        + 4; // current_size

    /// Load a CollectionV1 from account data
    pub unsafe fn load(data: &[u8]) -> &Self {
        &*(data.as_ptr() as *const Self)
    }

    /// Load a mutable CollectionV1 from account data
    pub unsafe fn load_mut(data: &mut [u8]) -> &mut Self {
        &mut *(data.as_mut_ptr() as *mut Self)
    }

    /// Create a new CollectionV1
    pub fn new(
        update_authority: UpdateAuthority,
        name: &[u8],
        uri: &[u8],
        current_size: u32,
    ) -> Self {
        let mut collection = Self {
            key: Key::CollectionV1,
            update_authority,
            name: [0u8; MAX_NAME_LEN],
            name_len: 0,
            uri: [0u8; MAX_URI_LEN],
            uri_len: 0,
            num_minted: 0,
            current_size,
        };

        // Copy name
        let name_len = name.len().min(MAX_NAME_LEN);
        collection.name[..name_len].copy_from_slice(&name[..name_len]);
        collection.name_len = name_len as u32;

        // Copy URI
        let uri_len = uri.len().min(MAX_URI_LEN);
        collection.uri[..uri_len].copy_from_slice(&uri[..uri_len]);
        collection.uri_len = uri_len as u32;

        collection
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

    /// Check if this is a valid CollectionV1 account
    pub fn is_valid(&self) -> bool {
        self.key == Key::CollectionV1
    }

    /// Check if the collection has reached its size limit
    pub fn is_full(&self) -> bool {
        self.current_size > 0 && self.num_minted >= self.current_size
    }

    /// Increment the number of minted assets
    pub fn increment_num_minted(&mut self) -> bool {
        if !self.is_full() {
            self.num_minted = self.num_minted.saturating_add(1);
            true
        } else {
            false
        }
    }
}