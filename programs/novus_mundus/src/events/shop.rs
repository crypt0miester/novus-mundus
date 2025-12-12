/// Shop events - purchases and transactions

use pinocchio::pubkey::Pubkey;
use super::{Event, PackBytes, discriminator};

/// Emitted when a shop item is purchased
pub struct ItemPurchased {
    /// Player account pubkey
    pub player: Pubkey,
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
    /// Player account pubkey
    pub player: Pubkey,
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
        offset += self.bundle_id.pack(&mut buf[offset..]);
        offset += self.price.pack(&mut buf[offset..]);
        offset += self.currency.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when a flash sale item is purchased
pub struct FlashSalePurchased {
    /// Player account pubkey
    pub player: Pubkey,
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
        offset += self.sale_id.pack(&mut buf[offset..]);
        offset += self.original_price.pack(&mut buf[offset..]);
        offset += self.price_paid.pack(&mut buf[offset..]);
        offset += self.currency.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}
