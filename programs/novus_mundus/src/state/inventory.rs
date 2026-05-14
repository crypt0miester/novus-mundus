use pinocchio::Address;
use pinocchio::error::ProgramError;
use crate::constants::INVENTORY_SEED;

/// Inventory item stored in player's inventory account
#[repr(C)]
#[derive(Copy, Clone)]
pub struct InventoryItem {
    pub item_type: u16,         // 2 bytes - ItemType enum value
    pub rarity: u8,             // 1 byte - Rarity (0=Common, 1=Uncommon, 2=Rare, 3=Epic, 4=Legendary)
    pub _pad: u8,               // 1 byte - Padding
    pub quantity: u16,          // 2 bytes - Stack count
    pub bonus_bps: u16,         // 2 bytes - Bonus in basis points
    pub item_id: u32,           // 4 bytes - Specific item ID within type
    pub obtained_at: u32,       // 4 bytes - Unix timestamp (u32 for space)
}

impl InventoryItem {
    pub const LEN: usize = 16;

    pub const fn empty() -> Self {
        Self {
            item_type: 0,
            rarity: 0,
            _pad: 0,
            quantity: 0,
            bonus_bps: 0,
            item_id: 0,
            obtained_at: 0,
        }
    }

    pub fn is_empty(&self) -> bool {
        self.item_type == 0 && self.quantity == 0
    }
}

impl Default for InventoryItem {
    fn default() -> Self {
        Self::empty()
    }
}

/// Player Inventory Account - Separate PDA, dynamically expandable
///
/// PDA: ["inventory", player_pubkey]
///
/// This account is created automatically when needed and expands as items are added.
/// Max size is limited by Solana's account size limit (~10MB).
///
/// Size: HEADER_LEN + (slot_count * 16) bytes
#[repr(C)]
pub struct PlayerInventoryHeader {
    /// Account discriminator
    pub account_key: u8,
    pub owner: Address,          // 32 bytes - Player's wallet
    pub bump: u8,               // 1 byte
    pub _padding: [u8; 3],      // 3 bytes - Alignment
    pub slot_count: u16,        // 2 bytes - Total slots allocated
    pub used_slots: u16,        // 2 bytes - Slots currently in use
}

impl PlayerInventoryHeader {
    pub const LEN: usize = core::mem::size_of::<Self>();

    /// Calculate total account size for given slot count
    pub const fn account_size(slot_count: u16) -> usize {
        Self::LEN + (slot_count as usize * InventoryItem::LEN)
    }

    /// Initial slot count when inventory is first created
    pub const INITIAL_SLOTS: u16 = 16;

    /// Slots added per expansion
    pub const EXPANSION_SLOTS: u16 = 16;

    /// Maximum slots (practical limit based on account size)
    /// 10MB / 16 bytes per item = ~625,000 slots max
    /// But we cap at u16::MAX for simplicity
    pub const MAX_SLOTS: u16 = u16::MAX;

    pub unsafe fn load(data: &[u8]) -> &Self {
        &*(data.as_ptr() as *const Self)
    }

    pub unsafe fn load_mut(data: &mut [u8]) -> &mut Self {
        &mut *(data.as_mut_ptr() as *mut Self)
    }

    /// Derive PDA for player inventory
    /// Seeds: [INVENTORY_SEED, player]
    pub fn derive_pda(player: &Address) -> (Address, u8) {
        pinocchio::Address::find_program_address(
            &[INVENTORY_SEED, player.as_ref()],
            &crate::ID,
        )
    }

    /// Create PDA from known bump
    pub fn create_pda(player: &Address, bump: u8) -> Result<Address, ProgramError> {
        let bump_seed = [bump];
        pinocchio::Address::create_program_address(
            &[INVENTORY_SEED, player.as_ref(), &bump_seed],
            &crate::ID,
        ).map_err(|e| e.into())
    }
}

/// Helper struct for working with inventory data
pub struct PlayerInventory<'a> {
    pub header: &'a mut PlayerInventoryHeader,
    pub items: &'a mut [InventoryItem],
}

impl<'a> PlayerInventory<'a> {
    /// Load inventory from account data
    ///
    /// # Safety
    /// Caller must ensure data is valid and properly sized
    pub unsafe fn load(data: &'a mut [u8]) -> Self {
        let header = &mut *(data.as_mut_ptr() as *mut PlayerInventoryHeader);
        let items_start = PlayerInventoryHeader::LEN;
        let items_count = header.slot_count as usize;
        let items_ptr = data.as_mut_ptr().add(items_start) as *mut InventoryItem;
        let items = core::slice::from_raw_parts_mut(items_ptr, items_count);

        Self { header, items }
    }

    /// Find an empty slot, returns slot index
    pub fn find_empty_slot(&self) -> Option<usize> {
        self.items.iter().position(|item| item.is_empty())
    }

    /// Find item by type for stacking
    pub fn find_item_by_type(&self, item_type: u16) -> Option<usize> {
        self.items.iter().position(|item| {
            item.item_type == item_type && item.quantity > 0
        })
    }

    /// Add item to inventory, returns true if successful
    /// If item type exists and is stackable, adds to existing stack
    /// Otherwise finds empty slot
    pub fn add_item(&mut self, item_type: u16, quantity: u16, rarity: u8, item_id: u32, now: u32) -> bool {
        // Try to stack with existing
        if let Some(idx) = self.find_item_by_type(item_type) {
            self.items[idx].quantity = self.items[idx].quantity.saturating_add(quantity);
            return true;
        }

        // Find empty slot
        if let Some(idx) = self.find_empty_slot() {
            self.items[idx] = InventoryItem {
                item_type,
                rarity,
                _pad: 0,
                quantity,
                bonus_bps: 0,
                item_id,
                obtained_at: now,
            };
            self.header.used_slots = self.header.used_slots.saturating_add(1);
            return true;
        }

        false // No space - need to expand first
    }

    /// Check if inventory needs expansion (no empty slots)
    pub fn needs_expansion(&self) -> bool {
        self.find_empty_slot().is_none()
    }
}

