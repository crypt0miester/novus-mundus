/// Shop events - purchases and transactions

use pinocchio::Address;
use super::{Event, PackBytes, discriminator};

/// Emitted when a shop item is purchased
pub struct ItemPurchased {
    /// Player account pubkey (not wallet)
    pub player: Address,
    /// Player's name (48 bytes UTF-8)
    pub player_name: [u8; 48],
    /// Item ID
    pub item_id: u32,
    /// Quantity purchased
    pub quantity: u16,
    /// Price paid (in specified currency)
    pub price: u64,
    /// Currency type (0=cash, 1=gems, 2=novi)
    pub currency: u8,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for ItemPurchased {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:ItemPurchased");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.player.pack(&mut buf[offset..]);
        offset += self.player_name.pack(&mut buf[offset..]);
        offset += self.item_id.pack(&mut buf[offset..]);
        offset += self.quantity.pack(&mut buf[offset..]);
        offset += self.price.pack(&mut buf[offset..]);
        offset += self.currency.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when a bundle is purchased
pub struct BundlePurchased {
    /// Player account pubkey (not wallet)
    pub player: Address,
    /// Player's name (48 bytes UTF-8)
    pub player_name: [u8; 48],
    /// Bundle ID
    pub bundle_id: u32,
    /// Price paid
    pub price: u64,
    /// Currency type
    pub currency: u8,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for BundlePurchased {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:BundlePurchased");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.player.pack(&mut buf[offset..]);
        offset += self.player_name.pack(&mut buf[offset..]);
        offset += self.bundle_id.pack(&mut buf[offset..]);
        offset += self.price.pack(&mut buf[offset..]);
        offset += self.currency.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when a flash sale item is purchased
pub struct FlashSalePurchased {
    /// Player account pubkey (not wallet)
    pub player: Address,
    /// Player's name (48 bytes UTF-8)
    pub player_name: [u8; 48],
    /// Sale ID
    pub sale_id: u64,
    /// Original price
    pub original_price: u64,
    /// Discounted price paid
    pub price_paid: u64,
    /// Currency type
    pub currency: u8,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for FlashSalePurchased {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:FlashSalePurchased");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.player.pack(&mut buf[offset..]);
        offset += self.player_name.pack(&mut buf[offset..]);
        offset += self.sale_id.pack(&mut buf[offset..]);
        offset += self.original_price.pack(&mut buf[offset..]);
        offset += self.price_paid.pack(&mut buf[offset..]);
        offset += self.currency.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when NOVI is purchased from the shop
pub struct NoviPurchased {
    /// Buyer wallet pubkey
    pub buyer: Address,
    /// User account pubkey
    pub user: Address,
    /// Package index purchased (0-4)
    pub package_index: u8,
    /// Base NOVI amount (before bonuses, with 1 decimal)
    pub base_amount: u64,
    /// Bonus NOVI received (with 1 decimal)
    pub bonus_amount: u64,
    /// Total NOVI received (base + bonus, with 1 decimal)
    pub total_received: u64,
    /// SOL cost paid (in lamports)
    pub cost_lamports: u64,
    /// Current streak day (1-7+)
    pub streak_day: u16,
    /// Buyer's subscription tier (0-3)
    pub subscription_tier: u8,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for NoviPurchased {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:NoviPurchased");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.buyer.pack(&mut buf[offset..]);
        offset += self.user.pack(&mut buf[offset..]);
        offset += self.package_index.pack(&mut buf[offset..]);
        offset += self.base_amount.pack(&mut buf[offset..]);
        offset += self.bonus_amount.pack(&mut buf[offset..]);
        offset += self.total_received.pack(&mut buf[offset..]);
        offset += self.cost_lamports.pack(&mut buf[offset..]);
        offset += self.streak_day.pack(&mut buf[offset..]);
        offset += self.subscription_tier.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}
