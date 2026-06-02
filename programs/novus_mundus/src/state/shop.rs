use crate::constants::{
    ALLOWED_TOKEN_SEED, BUNDLE_SEED, DAILY_DEAL_SEED, DAO_PROMOTION_SEED, FLASH_SALE_SEED,
    PLAYER_PURCHASE_SEED, SEASONAL_SALE_SEED, SHOP_CONFIG_SEED, SHOP_ITEM_SEED, WEEKLY_SALE_SEED,
};
use pinocchio::AccountView;
use pinocchio::{error::ProgramError, Address};

// SHOP CONFIG ACCOUNT (Global Settings)

// PDA: ["shop_config", game_engine]
// Lifecycle: PERSISTENT (never closed)

#[repr(C)]
#[derive(Copy, Clone)]
pub struct ShopConfigAccount {
    /// Account discriminator (AccountKey::ShopConfig)
    pub account_key: u8,
    // Discount Caps (8 bytes) - basis points
    pub max_base_discount_bps: u16,   // Layer 1 cap (6000 = 60%)
    pub max_bundle_discount_bps: u16, // Layer 2 cap (3500 = 35%)
    pub max_fib_discount_bps: u16,    // Layer 3 cap (2000 = 20%)
    pub max_total_discount_bps: u16,  // Combined cap (7500 = 75%)

    // Sale Limits (8 bytes)
    pub max_flash_sales_per_day: u8,
    pub max_daily_deals: u8,
    pub flash_sale_min_duration_secs: u16,
    pub flash_sale_max_duration_secs: u16,
    pub _padding1: [u8; 2],

    // Milestone Thresholds (40 bytes) - in lamports
    pub bronze_threshold: u64,
    pub silver_threshold: u64,
    pub gold_threshold: u64,
    pub platinum_threshold: u64,
    pub diamond_threshold: u64,

    // Milestone Discount Rates (10 bytes) - basis points
    pub bronze_discount_bps: u16,   // 200 = 2%
    pub silver_discount_bps: u16,   // 400 = 4%
    pub gold_discount_bps: u16,     // 600 = 6%
    pub platinum_discount_bps: u16, // 800 = 8%
    pub diamond_discount_bps: u16,  // 1000 = 10%

    // Loyalty Streak Discounts (8 bytes)
    pub streak_day_2_bps: u16,
    pub streak_day_3_bps: u16,
    pub streak_day_5_bps: u16,
    pub streak_day_7_bps: u16,

    // Global Stats (16 bytes)
    pub total_sol_collected: u64,
    pub total_novi_burned: u64,

    // State (8 bytes)
    pub next_flash_sale_id: u64, // Incrementing ID for flash sales

    // SOL Oracle Configuration (100 bytes)
    // Used for token payments: convert token USD price to SOL amount
    pub sol_pyth_feed: Address, // Pyth SOL/USD *feed ID* — 32-byte Pyth feed identifier, NOT an account
    pub sol_switchboard_feed: Address, // Switchboard SOL/USD *feed ID* — 32-byte OracleQuote feed id (NOT an account)
    /// Switchboard On-Demand queue account pubkey. Pins the `queue` account
    /// passed to `QuoteVerifier` and seeds the oracle-quote PDA
    /// (`["oracle_quote", switchboard_queue]`). All-zero = not configured.
    pub switchboard_queue: Address,
    pub sol_max_staleness_slots: u16, // Max price age — SECONDS for Pyth, SLOTS (quote max_age) for Switchboard
    pub sol_confidence_threshold_bps: u16, // Max confidence interval, bps — Pyth only (Switchboard confidence is enforced inside the verified quote)

    // Reserved (8 bytes)
    pub _reserved: [u8; 8],

    // Alignment padding (3 bytes)
    pub _padding2: [u8; 3],

    pub bump: u8,
}

impl ShopConfigAccount {
    pub const LEN: usize = core::mem::size_of::<Self>();

    pub unsafe fn load(data: &[u8]) -> &Self {
        &*(data.as_ptr() as *const Self)
    }

    pub unsafe fn load_mut(data: &mut [u8]) -> &mut Self {
        &mut *(data.as_mut_ptr() as *mut Self)
    }

    pub fn derive_pda(game_engine: &Address) -> (Address, u8) {
        pinocchio::Address::find_program_address(
            &[SHOP_CONFIG_SEED, game_engine.as_ref()],
            &crate::ID,
        )
    }

    pub fn create_pda(game_engine: &Address, bump: u8) -> Result<Address, ProgramError> {
        let bump_seed = [bump];
        pinocchio::Address::create_program_address(
            &[SHOP_CONFIG_SEED, game_engine.as_ref(), &bump_seed],
            &crate::ID,
        )
        .map_err(|e| e.into())
    }

    /// Load and verify a ShopConfigAccount: program ownership + discriminator +
    /// canonical PDA for `game_engine`.
    pub fn load_checked<'a>(
        account: &'a AccountView,
        game_engine: &Address,
        program_id: &Address,
    ) -> Result<&'a Self, ProgramError> {
        crate::validation::require_owner(account, program_id)?;

        let (expected_pda, bump) = Self::derive_pda(game_engine);
        crate::validation::require_pda_eq(account, &expected_pda, "ShopConfigAccount")?;

        let loaded = unsafe {
            super::AccountKey::cast::<Self>(
                account,
                super::AccountKey::ShopConfig,
                "ShopConfigAccount",
            )?
        };
        crate::validation::require_bump_eq(loaded.bump, bump, "ShopConfigAccount", account)?;
        Ok(loaded)
    }
}

// SHOP ITEM ACCOUNT (Individual Item Definition)

// PDA: ["shop_item", game_engine, item_id.to_le_bytes()]
// Lifecycle: PERSISTENT (admin can close if delisted)

#[repr(C)]
#[derive(Copy, Clone)]
pub struct ShopItemAccount {
    /// Account discriminator (AccountKey::ShopItem)
    pub account_key: u8,
    // Item Info (8 bytes)
    pub item_type: u16,             // Maps to ItemType enum
    pub category: u8,               // 0=Equipment, 1=Consumable, 2=Material, 3=Cosmetic
    pub rarity: u8,                 // 0=Common...4=Legendary
    pub quantity_per_purchase: u16, // Units received per purchase
    pub base_stats_bps: u16,        // Bonus stats in basis points

    // Pricing (16 bytes)
    pub price_sol_lamports: u64,  // 0 = not sold for SOL
    pub _reserved_price: [u8; 8], // Previously price_gems, now reserved

    // Availability (16 bytes)
    pub available_from: i64,  // 0 = always available
    pub available_until: i64, // 0 = no end

    // Stock (16 bytes)
    pub max_global_stock: u64, // 0 = unlimited
    pub current_global_stock: u64,

    // Limits (8 bytes)
    pub max_per_player: u32, // 0 = unlimited
    pub max_per_day: u16,    // 0 = unlimited
    pub _padding: [u8; 2],

    // State (2 bytes)
    pub is_active: bool,
    pub is_featured: bool,

    // Reserved (8 bytes)
    pub _reserved: [u8; 8],

    // Alignment (5 bytes)
    pub _padding2: [u8; 5],

    pub bump: u8,
}

impl ShopItemAccount {
    pub const LEN: usize = core::mem::size_of::<Self>();

    pub unsafe fn load(data: &[u8]) -> &Self {
        &*(data.as_ptr() as *const Self)
    }

    pub unsafe fn load_mut(data: &mut [u8]) -> &mut Self {
        &mut *(data.as_mut_ptr() as *mut Self)
    }

    pub fn derive_pda(game_engine: &Address, item_id: u32) -> (Address, u8) {
        let item_id_bytes = item_id.to_le_bytes();
        pinocchio::Address::find_program_address(
            &[SHOP_ITEM_SEED, game_engine.as_ref(), &item_id_bytes],
            &crate::ID,
        )
    }

    pub fn create_pda(
        game_engine: &Address,
        item_id: u32,
        bump: u8,
    ) -> Result<Address, ProgramError> {
        let item_id_bytes = item_id.to_le_bytes();
        let bump_seed = [bump];
        pinocchio::Address::create_program_address(
            &[
                SHOP_ITEM_SEED,
                game_engine.as_ref(),
                &item_id_bytes,
                &bump_seed,
            ],
            &crate::ID,
        )
        .map_err(|e| e.into())
    }

    /// Load and verify a ShopItemAccount mutably: program ownership +
    /// discriminator + canonical PDA for `(game_engine, item_id)`.
    pub fn load_checked_mut<'a>(
        account: &'a AccountView,
        game_engine: &Address,
        item_id: u32,
        program_id: &Address,
    ) -> Result<&'a mut Self, ProgramError> {
        crate::validation::require_owner(account, program_id)?;

        let (expected_pda, bump) = Self::derive_pda(game_engine, item_id);
        crate::validation::require_pda_eq(account, &expected_pda, "ShopItemAccount")?;

        let loaded = unsafe {
            super::AccountKey::cast_mut::<Self>(account, super::AccountKey::ShopItem, "ShopItemAccount")?
        };
        crate::validation::require_bump_eq(loaded.bump, bump, "ShopItemAccount", account)?;
        Ok(loaded)
    }
}

// BUNDLE ITEM (embedded in BundleAccount)

#[repr(C)]
#[derive(Copy, Clone, Default)]
pub struct BundleItem {
    pub item_id: u32,  // References ShopItemAccount
    pub quantity: u32, // Amount of this item
}

// BUNDLE ACCOUNT (Pre-Built Bundle)

// PDA: ["bundle", game_engine, bundle_id.to_le_bytes()]
// Lifecycle: PERSISTENT (admin can close if delisted)

pub const MAX_BUNDLE_ITEMS: usize = 10;

#[repr(C)]
#[derive(Copy, Clone)]
pub struct BundleAccount {
    /// Account discriminator (AccountKey::ShopBundle)
    pub account_key: u8,
    // Bundle Info (8 bytes)
    pub tier: u8,                  // 0=Starter...4=Supreme
    pub category: u8,              // 0=Equipment...3=Mixed
    pub item_count: u8,            // 2-10 items
    pub requires_subscription: u8, // 0=None, 1=Rookie+...4=Legendary
    pub savings_bps: u16,          // Advertised savings
    pub is_active: bool,
    pub _padding: u8,

    // Items (80 bytes) - up to 10 items
    pub items: [BundleItem; MAX_BUNDLE_ITEMS], // 10 * 8 = 80 bytes

    // Pricing (8 bytes)
    pub price_sol_lamports: u64,

    // Availability (16 bytes)
    pub available_from: i64,
    pub available_until: i64,

    // Stats (16 bytes)
    pub total_purchases: u64,
    pub total_revenue_lamports: u64,

    // Reserved (8 bytes)
    pub _reserved: [u8; 8],

    // Alignment (7 bytes)
    pub _padding2: [u8; 7],

    pub bump: u8,
}

impl BundleAccount {
    pub const LEN: usize = core::mem::size_of::<Self>();

    pub unsafe fn load(data: &[u8]) -> &Self {
        &*(data.as_ptr() as *const Self)
    }

    pub unsafe fn load_mut(data: &mut [u8]) -> &mut Self {
        &mut *(data.as_mut_ptr() as *mut Self)
    }

    pub fn derive_pda(game_engine: &Address, bundle_id: u32) -> (Address, u8) {
        let bundle_id_bytes = bundle_id.to_le_bytes();
        pinocchio::Address::find_program_address(
            &[BUNDLE_SEED, game_engine.as_ref(), &bundle_id_bytes],
            &crate::ID,
        )
    }

    pub fn create_pda(
        game_engine: &Address,
        bundle_id: u32,
        bump: u8,
    ) -> Result<Address, ProgramError> {
        let bundle_id_bytes = bundle_id.to_le_bytes();
        let bump_seed = [bump];
        pinocchio::Address::create_program_address(
            &[
                BUNDLE_SEED,
                game_engine.as_ref(),
                &bundle_id_bytes,
                &bump_seed,
            ],
            &crate::ID,
        )
        .map_err(|e| e.into())
    }
}

// DAILY DEAL ACCOUNT (Rotating Daily Deals)

// PDA: ["daily_deal", game_engine, slot_index]
// Lifecycle: PERSISTENT (updated in place daily)

#[repr(C)]
#[derive(Copy, Clone)]
pub struct DailyDealAccount {
    /// Account discriminator (AccountKey::DailyDeal)
    pub account_key: u8,
    // Current Deal (16 bytes)
    pub item_id: u32,      // Current item on deal
    pub discount_bps: u16, // 1500-4000 (15-40%)
    pub _padding1: [u8; 2],
    pub started_at: i64, // When this deal became active

    // Next Deal - pre-computed (8 bytes)
    pub next_item_id: u32,
    pub next_discount_bps: u16,
    pub _padding2: [u8; 2],

    // Stats (16 bytes)
    pub purchases_today: u64,
    pub revenue_today_lamports: u64,

    // Reserved (8 bytes)
    pub _reserved: [u8; 8],

    pub bump: u8,
}

impl DailyDealAccount {
    pub const LEN: usize = core::mem::size_of::<Self>();

    pub unsafe fn load(data: &[u8]) -> &Self {
        &*(data.as_ptr() as *const Self)
    }

    pub unsafe fn load_mut(data: &mut [u8]) -> &mut Self {
        &mut *(data.as_mut_ptr() as *mut Self)
    }

    pub fn derive_pda(game_engine: &Address, slot_index: u8) -> (Address, u8) {
        pinocchio::Address::find_program_address(
            &[DAILY_DEAL_SEED, game_engine.as_ref(), &[slot_index]],
            &crate::ID,
        )
    }

    pub fn create_pda(
        game_engine: &Address,
        slot_index: u8,
        bump: u8,
    ) -> Result<Address, ProgramError> {
        let bump_seed = [bump];
        pinocchio::Address::create_program_address(
            &[
                DAILY_DEAL_SEED,
                game_engine.as_ref(),
                &[slot_index],
                &bump_seed,
            ],
            &crate::ID,
        )
        .map_err(|e| e.into())
    }
}

// FLASH SALE ACCOUNT (Time-Limited Flash Sales)

// PDA: ["flash_sale", game_engine, sale_id.to_le_bytes()]
// Lifecycle: CLOSABLE -> rent returns to `payer` after sale ends/sells out

#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum FlashSaleStatus {
    Announced = 0,
    Active = 1,
    Ended = 2,
    SoldOut = 3,
}

impl FlashSaleStatus {
    pub fn from_u8(value: u8) -> Option<Self> {
        match value {
            0 => Some(Self::Announced),
            1 => Some(Self::Active),
            2 => Some(Self::Ended),
            3 => Some(Self::SoldOut),
            _ => None,
        }
    }
}

#[repr(C)]
#[derive(Copy, Clone)]
pub struct FlashSaleAccount {
    /// Account discriminator (AccountKey::FlashSale)
    pub account_key: u8,
    // Payer for rent return (32 bytes)
    pub payer: Address, // Receives rent on close

    // Item (8 bytes)
    pub item_id: u32, // Item or bundle ID
    pub is_bundle: bool,
    pub status: u8,        // FlashSaleStatus
    pub discount_bps: u16, // Up to 5000 (50%)

    // Timing (24 bytes)
    pub announced_at: i64, // 30 min before start
    pub starts_at: i64,
    pub ends_at: i64,

    // Stock (16 bytes)
    pub max_stock: u64,
    pub remaining_stock: u64,

    // Stats (16 bytes)
    pub total_claims: u64,
    pub total_revenue_lamports: u64,

    // Reserved (8 bytes)
    pub _reserved: [u8; 8],

    // Alignment (7 bytes)
    pub _padding: [u8; 7],

    pub bump: u8,
}

impl FlashSaleAccount {
    pub const LEN: usize = core::mem::size_of::<Self>();

    pub unsafe fn load(data: &[u8]) -> &Self {
        &*(data.as_ptr() as *const Self)
    }

    pub unsafe fn load_mut(data: &mut [u8]) -> &mut Self {
        &mut *(data.as_mut_ptr() as *mut Self)
    }

    pub fn derive_pda(game_engine: &Address, sale_id: u64) -> (Address, u8) {
        let sale_id_bytes = sale_id.to_le_bytes();
        pinocchio::Address::find_program_address(
            &[FLASH_SALE_SEED, game_engine.as_ref(), &sale_id_bytes],
            &crate::ID,
        )
    }

    pub fn create_pda(
        game_engine: &Address,
        sale_id: u64,
        bump: u8,
    ) -> Result<Address, ProgramError> {
        let sale_id_bytes = sale_id.to_le_bytes();
        let bump_seed = [bump];
        pinocchio::Address::create_program_address(
            &[
                FLASH_SALE_SEED,
                game_engine.as_ref(),
                &sale_id_bytes,
                &bump_seed,
            ],
            &crate::ID,
        )
        .map_err(|e| e.into())
    }

    /// Check if this sale can be closed (ended or sold out)
    pub fn can_close(&self) -> bool {
        self.status == FlashSaleStatus::Ended as u8 || self.status == FlashSaleStatus::SoldOut as u8
    }
}

// WEEKLY SALE ACCOUNT (Weekly Themed Specials)

// PDA: ["weekly_sale", game_engine, week_number.to_le_bytes()]
// Lifecycle: CLOSABLE -> close after week ends, rent to `payer`

#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum WeeklySaleTheme {
    Combat = 0,
    Defense = 1,
    Resource = 2,
    Growth = 3,
    Expedition = 4,
}

#[repr(C)]
#[derive(Copy, Clone)]
pub struct WeeklySaleAccount {
    /// Account discriminator (AccountKey::WeeklySale)
    pub account_key: u8,
    // Payer for rent return (32 bytes)
    pub payer: Address,

    // Theme (8 bytes)
    pub theme: u8,            // WeeklySaleTheme
    pub bonus_type: u8,       // What bonus applies
    pub bonus_value_bps: u16, // 1000 = 10%
    pub _padding1: [u8; 4],

    // Category Discounts (8 bytes)
    pub category_discounts: [u16; 4], // Per category discount

    // Timing (16 bytes)
    pub starts_at: i64,
    pub ends_at: i64,

    // Stats (16 bytes)
    pub total_purchases: u64,
    pub total_revenue_lamports: u64,

    // Reserved (8 bytes)
    pub _reserved: [u8; 8],

    // Alignment (7 bytes)
    pub _padding2: [u8; 7],

    pub bump: u8,
}

impl WeeklySaleAccount {
    pub const LEN: usize = core::mem::size_of::<Self>();

    pub unsafe fn load(data: &[u8]) -> &Self {
        &*(data.as_ptr() as *const Self)
    }

    pub unsafe fn load_mut(data: &mut [u8]) -> &mut Self {
        &mut *(data.as_mut_ptr() as *mut Self)
    }

    pub fn derive_pda(game_engine: &Address, week_number: u64) -> (Address, u8) {
        let week_bytes = week_number.to_le_bytes();
        pinocchio::Address::find_program_address(
            &[WEEKLY_SALE_SEED, game_engine.as_ref(), &week_bytes],
            &crate::ID,
        )
    }

    pub fn create_pda(
        game_engine: &Address,
        week_number: u64,
        bump: u8,
    ) -> Result<Address, ProgramError> {
        let week_bytes = week_number.to_le_bytes();
        let bump_seed = [bump];
        pinocchio::Address::create_program_address(
            &[
                WEEKLY_SALE_SEED,
                game_engine.as_ref(),
                &week_bytes,
                &bump_seed,
            ],
            &crate::ID,
        )
        .map_err(|e| e.into())
    }

    /// Check if this sale can be closed (week has ended)
    pub fn can_close(&self, current_time: i64) -> bool {
        current_time > self.ends_at
    }
}

// SEASONAL SALE ACCOUNT (Event-Tied Sales)

// PDA: ["seasonal_sale", game_engine, event_pubkey]
// Lifecycle: CLOSABLE -> close after event ends, rent to `payer`

pub const MAX_FEATURED_ITEMS: usize = 10;

#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum SeasonalSaleStatus {
    Scheduled = 0,
    Active = 1,
    Ended = 2,
}

#[repr(C)]
#[derive(Copy, Clone)]
pub struct SeasonalSaleAccount {
    /// Account discriminator (AccountKey::SeasonalSale)
    pub account_key: u8,
    // Payer for rent return (32 bytes)
    pub payer: Address,

    // Sale Info (32 bytes)
    pub name: [u8; 32], // "Summer Combat Festival"

    // Featured Items (60 bytes) - up to 10 items
    pub featured_item_ids: [u32; MAX_FEATURED_ITEMS], // 40 bytes
    pub featured_discounts_bps: [u16; MAX_FEATURED_ITEMS], // 20 bytes

    // Config (8 bytes)
    pub featured_count: u8,
    pub status: u8, // SeasonalSaleStatus
    pub global_discount_bps: u16,
    pub _padding1: [u8; 4],

    // Timing (16 bytes)
    pub starts_at: i64,
    pub ends_at: i64,

    // Exclusive Rewards (16 bytes)
    pub spend_threshold: u64,
    pub exclusive_cosmetic_id: u32,
    pub exclusive_claims: u32,

    // Stats (16 bytes)
    pub total_purchases: u64,
    pub total_revenue_lamports: u64,

    // Reserved (8 bytes)
    pub _reserved: [u8; 8],

    // Alignment (7 bytes)
    pub _padding2: [u8; 7],

    pub bump: u8,
}

impl SeasonalSaleAccount {
    pub const LEN: usize = core::mem::size_of::<Self>();

    pub unsafe fn load(data: &[u8]) -> &Self {
        &*(data.as_ptr() as *const Self)
    }

    pub unsafe fn load_mut(data: &mut [u8]) -> &mut Self {
        &mut *(data.as_mut_ptr() as *mut Self)
    }

    pub fn derive_pda(game_engine: &Address, event: &Address) -> (Address, u8) {
        pinocchio::Address::find_program_address(
            &[SEASONAL_SALE_SEED, game_engine.as_ref(), event.as_ref()],
            &crate::ID,
        )
    }

    pub fn create_pda(
        game_engine: &Address,
        event: &Address,
        bump: u8,
    ) -> Result<Address, ProgramError> {
        let bump_seed = [bump];
        pinocchio::Address::create_program_address(
            &[
                SEASONAL_SALE_SEED,
                game_engine.as_ref(),
                event.as_ref(),
                &bump_seed,
            ],
            &crate::ID,
        )
        .map_err(|e| e.into())
    }

    /// Check if this sale can be closed
    pub fn can_close(&self) -> bool {
        self.status == SeasonalSaleStatus::Ended as u8
    }
}

// DAO PROMOTION ACCOUNT (Community-Voted Promotions)

// PDA: ["dao_promo", game_engine, proposal_id.to_le_bytes()]
// Lifecycle: CLOSABLE -> close after ends or budget exhausted, rent to `payer`

#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum DAOPromotionStatus {
    Approved = 0,
    Active = 1,
    Ended = 2,
    BudgetExhausted = 3,
}

#[repr(C)]
#[derive(Copy, Clone)]
pub struct DAOPromotionAccount {
    /// Account discriminator (AccountKey::DaoPromotion)
    pub account_key: u8,
    // Payer for rent return (32 bytes)
    pub payer: Address,

    // Promotion Info (32 bytes)
    pub title: [u8; 32],

    // Discount Config (16 bytes)
    pub equipment_discount_bps: u16,
    pub consumable_discount_bps: u16,
    pub material_discount_bps: u16,
    pub cosmetic_discount_bps: u16,
    pub global_discount_bps: u16,
    pub max_discount_bps: u16,
    pub status: u8, // DAOPromotionStatus
    pub _padding1: [u8; 3],

    // Timing (24 bytes)
    pub approved_at: i64,
    pub starts_at: i64,
    pub ends_at: i64,

    // Budget (16 bytes)
    pub max_discount_budget_lamports: u64,
    pub used_discount_budget: u64,

    // Stats (24 bytes)
    pub total_purchases: u64,
    pub total_revenue_lamports: u64,
    pub unique_purchasers: u64,

    // Reserved (8 bytes)
    pub _reserved: [u8; 8],

    // Alignment (7 bytes)
    pub _padding2: [u8; 7],

    pub bump: u8,
}

impl DAOPromotionAccount {
    pub const LEN: usize = core::mem::size_of::<Self>();

    pub unsafe fn load(data: &[u8]) -> &Self {
        &*(data.as_ptr() as *const Self)
    }

    pub unsafe fn load_mut(data: &mut [u8]) -> &mut Self {
        &mut *(data.as_mut_ptr() as *mut Self)
    }

    pub fn derive_pda(game_engine: &Address, proposal_id: u64) -> (Address, u8) {
        let proposal_bytes = proposal_id.to_le_bytes();
        pinocchio::Address::find_program_address(
            &[DAO_PROMOTION_SEED, game_engine.as_ref(), &proposal_bytes],
            &crate::ID,
        )
    }

    pub fn create_pda(
        game_engine: &Address,
        proposal_id: u64,
        bump: u8,
    ) -> Result<Address, ProgramError> {
        let proposal_bytes = proposal_id.to_le_bytes();
        let bump_seed = [bump];
        pinocchio::Address::create_program_address(
            &[
                DAO_PROMOTION_SEED,
                game_engine.as_ref(),
                &proposal_bytes,
                &bump_seed,
            ],
            &crate::ID,
        )
        .map_err(|e| e.into())
    }

    /// Check if this promotion can be closed
    pub fn can_close(&self) -> bool {
        self.status == DAOPromotionStatus::Ended as u8
            || self.status == DAOPromotionStatus::BudgetExhausted as u8
    }
}

// PLAYER PURCHASE ACCOUNT (Per-Player Purchase Tracking)

// PDA: ["player_purchase", player, item_id.to_le_bytes()]
// Lifecycle: CLOSABLE -> close when lifetime limit reached OR item delisted

#[repr(C)]
#[derive(Copy, Clone)]
pub struct PlayerPurchaseAccount {
    /// Account discriminator (AccountKey::PlayerPurchase)
    pub account_key: u8,
    // Tracking (24 bytes)
    pub lifetime_purchased: u64, // Total ever purchased
    pub purchased_today: u64,    // Reset daily
    pub last_purchase_day: u64,  // Day number for reset

    // Reserved (8 bytes)
    pub _reserved: [u8; 8],

    pub bump: u8,
}

impl PlayerPurchaseAccount {
    pub const LEN: usize = core::mem::size_of::<Self>();

    pub unsafe fn load(data: &[u8]) -> &Self {
        &*(data.as_ptr() as *const Self)
    }

    pub unsafe fn load_mut(data: &mut [u8]) -> &mut Self {
        &mut *(data.as_mut_ptr() as *mut Self)
    }

    pub fn derive_pda(player: &Address, item_id: u32) -> (Address, u8) {
        let item_id_bytes = item_id.to_le_bytes();
        pinocchio::Address::find_program_address(
            &[PLAYER_PURCHASE_SEED, player.as_ref(), &item_id_bytes],
            &crate::ID,
        )
    }

    pub fn create_pda(player: &Address, item_id: u32, bump: u8) -> Result<Address, ProgramError> {
        let item_id_bytes = item_id.to_le_bytes();
        let bump_seed = [bump];
        pinocchio::Address::create_program_address(
            &[
                PLAYER_PURCHASE_SEED,
                player.as_ref(),
                &item_id_bytes,
                &bump_seed,
            ],
            &crate::ID,
        )
        .map_err(|e| e.into())
    }

    /// Check if this account can be closed
    /// - Item delisted (is_active = false)
    /// - OR lifetime limit reached AND no daily limit
    pub fn can_close(&self, item: &ShopItemAccount) -> bool {
        !item.is_active
            || (item.max_per_player > 0
                && self.lifetime_purchased >= item.max_per_player as u64
                && item.max_per_day == 0)
    }

    /// Get current day number (for daily reset tracking)
    pub fn current_day(timestamp: i64) -> u64 {
        (timestamp / 86400) as u64
    }

    /// Reset daily counter if needed
    pub fn maybe_reset_daily(&mut self, current_timestamp: i64) {
        let today = Self::current_day(current_timestamp);
        if self.last_purchase_day < today {
            self.purchased_today = 0;
            self.last_purchase_day = today;
        }
    }
}

// SHOP CATEGORY ENUM

#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum ShopCategory {
    Equipment = 0,
    Consumable = 1,
    Material = 2,
    Cosmetic = 3,
    Currency = 4,
}

impl ShopCategory {
    pub fn from_u8(value: u8) -> Option<Self> {
        match value {
            0 => Some(Self::Equipment),
            1 => Some(Self::Consumable),
            2 => Some(Self::Material),
            3 => Some(Self::Cosmetic),
            4 => Some(Self::Currency),
            _ => None,
        }
    }
}

// BUNDLE TIER ENUM

#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum BundleTier {
    Starter = 0,  // 2 items, -10%
    Combat = 1,   // 3 items, -15%
    Crafter = 2,  // 4 items, -20%
    Explorer = 3, // 5 items, -25%
    Supreme = 4,  // 6+ items, -35%
}

impl BundleTier {
    pub fn from_u8(value: u8) -> Option<Self> {
        match value {
            0 => Some(Self::Starter),
            1 => Some(Self::Combat),
            2 => Some(Self::Crafter),
            3 => Some(Self::Explorer),
            4 => Some(Self::Supreme),
            _ => None,
        }
    }

    /// Get the base discount for this tier (basis points)
    pub fn base_discount_bps(self) -> u16 {
        match self {
            Self::Starter => 1000,  // 10%
            Self::Combat => 1500,   // 15%
            Self::Crafter => 2000,  // 20%
            Self::Explorer => 2500, // 25%
            Self::Supreme => 3500,  // 35%
        }
    }
}

// ALLOWED TOKEN ACCOUNT (Token Payment Whitelist)

// PDA: ["allowed_token", game_engine, token_mint]
// Lifecycle: CLOSABLE (DAO controls token support)

#[repr(C)]
#[derive(Copy, Clone)]
pub struct AllowedTokenAccount {
    /// Account discriminator (AccountKey::AllowedToken)
    pub account_key: u8,
    // Token Identity (32 bytes)
    pub mint: Address,

    // Dual Oracle Configuration (64 bytes)
    pub pyth_feed: Address, // Pyth TOKEN/USD *feed ID* — 32-byte Pyth feed identifier, NOT an account
    pub switchboard_feed: Address, // Switchboard TOKEN/USD *feed ID* — 32-byte OracleQuote feed id (NOT an account)

    // Pricing Parameters (8 bytes)
    pub max_staleness_slots: u16, // Max price age, SECONDS — Pyth only (Switchboard uses the shop-config quote max_age)
    pub confidence_threshold_bps: u16, // Max confidence interval, bps — Pyth only (see sol_confidence_threshold_bps)
    pub discount_bps: u16,             // Discount for using this token
    pub _padding: [u8; 2],

    // Pricing model + Reserved + Bump (16 bytes total)
    /// 0 = oracle path (Pyth/Switchboard); 1 = $1-pegged stablecoin
    /// (USDC/USDT/PYUSD — skips oracle, computes directly from cost_usd_cents).
    /// Existing accounts default to 0 because `_reserved` was zero-initialized.
    pub pegged_to_usd: u8,
    pub _reserved: [u8; 14],
    pub bump: u8,
}

impl AllowedTokenAccount {
    pub const LEN: usize = core::mem::size_of::<Self>();

    /// UNSAFE: Load from raw account data
    pub unsafe fn load(data: &[u8]) -> &Self {
        &*(data.as_ptr() as *const Self)
    }

    /// UNSAFE: Load mutable from raw account data
    pub unsafe fn load_mut(data: &mut [u8]) -> &mut Self {
        &mut *(data.as_mut_ptr() as *mut Self)
    }

    /// Derive the PDA for the allowed token account (finds bump - slower)
    /// Use this only during account creation
    pub fn derive_pda(game_engine: &Address, token_mint: &Address) -> (Address, u8) {
        pinocchio::Address::find_program_address(
            &[
                ALLOWED_TOKEN_SEED,
                game_engine.as_ref(),
                token_mint.as_ref(),
            ],
            &crate::ID,
        )
    }

    /// Create PDA from known bump (fast validation)
    /// Use this for validation when bump is already stored
    pub fn create_pda(
        game_engine: &Address,
        token_mint: &Address,
        bump: u8,
    ) -> Result<Address, ProgramError> {
        let bump_seed = [bump];
        pinocchio::Address::create_program_address(
            &[
                ALLOWED_TOKEN_SEED,
                game_engine.as_ref(),
                token_mint.as_ref(),
                &bump_seed,
            ],
            &crate::ID,
        )
        .map_err(|e| e.into())
    }

    /// Load and verify AllowedTokenAccount immutably.
    /// Checks: program ownership, PDA derivation, bump field.
    pub fn load_checked<'a>(
        account: &'a AccountView,
        game_engine: &Address,
        token_mint: &Address,
        program_id: &Address,
    ) -> Result<&'a Self, ProgramError> {
        crate::validation::require_owner(account, program_id)?;

        let (expected_pda, bump) = Self::derive_pda(game_engine, token_mint);
        crate::validation::require_pda_eq(account, &expected_pda, "AllowedTokenAccount")?;

        let loaded = unsafe {
            super::AccountKey::cast::<Self>(
                account,
                super::AccountKey::AllowedToken,
                "AllowedTokenAccount",
            )?
        };
        crate::validation::require_bump_eq(loaded.bump, bump, "AllowedTokenAccount", account)?;
        Ok(loaded)
    }

    /// Load and verify AllowedTokenAccount mutably.
    /// Checks: program ownership, PDA derivation, bump field.
    pub fn load_checked_mut<'a>(
        account: &'a AccountView,
        game_engine: &Address,
        token_mint: &Address,
        program_id: &Address,
    ) -> Result<&'a mut Self, ProgramError> {
        crate::validation::require_owner(account, program_id)?;

        let (expected_pda, bump) = Self::derive_pda(game_engine, token_mint);
        crate::validation::require_pda_eq(account, &expected_pda, "AllowedTokenAccount")?;

        let loaded = unsafe {
            super::AccountKey::cast_mut::<Self>(
                account,
                super::AccountKey::AllowedToken,
                "AllowedTokenAccount",
            )?
        };
        crate::validation::require_bump_eq(loaded.bump, bump, "AllowedTokenAccount", account)?;
        Ok(loaded)
    }

    /// Validate allowed token account PDA using stored bump (fast)
    pub fn validate_pda(
        account: &AccountView,
        game_engine: &Address,
        token_mint: &Address,
        bump: u8,
    ) -> Result<(), ProgramError> {
        let expected_address = Self::create_pda(game_engine, token_mint, bump)?;
        if account.address() != &expected_address {
            return Err(ProgramError::InvalidSeeds);
        }
        Ok(())
    }
}
