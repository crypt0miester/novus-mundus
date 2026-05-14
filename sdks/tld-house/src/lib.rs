#![no_std]

pub mod instructions;

// TLD House Program ID: TLDHkysf5pCnKsVA4gXpNvmy7psXLPEu4LAdDJthT9S
pinocchio::address::declare_id!("TLDHkysf5pCnKsVA4gXpNvmy7psXLPEu4LAdDJthT9S");

/// Alt Name Service Program ID
pub const ALT_NAME_SERVICE_ID: [u8; 32] = [
    0x0c, 0x21, 0x83, 0x01, 0x88, 0x9a, 0x93, 0x75,
    0x1c, 0xa0, 0x31, 0x9a, 0x02, 0x0e, 0x01, 0x81,
    0x9e, 0x5a, 0x9b, 0x5f, 0x02, 0x9f, 0x46, 0x74,
    0x00, 0xab, 0x18, 0x40, 0x6e, 0x15, 0x51, 0x65,
];

/// PDA seed constants
pub const PREFIX: &[u8] = b"tld_house";
pub const PDA_SEED: &[u8] = b"tld_pda";
pub const MAIN_DOMAIN_PREFIX: &[u8] = b"main_domain";

/// Anchor instruction discriminator for set_main_domain
/// From TLD House IDL: [135, 132, 229, 79, 45, 195, 204, 248]
pub const SET_MAIN_DOMAIN_DISCRIMINATOR: [u8; 8] = [0x87, 0x84, 0xe5, 0x4f, 0x2d, 0xc3, 0xcc, 0xf8];
