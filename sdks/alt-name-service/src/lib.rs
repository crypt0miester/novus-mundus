#![no_std]

pub mod instructions;
pub mod state;

pinocchio::address::declare_id!("ALTNSZ46uaAUU7XUV6awvdorLGqAsPwa9shm7h4uP2FK");

/// 8-byte instruction discriminators
pub const CREATE_DISCRIMINATOR: [u8; 8] = [24, 30, 200, 40, 5, 28, 7, 119];
pub const UPDATE_DISCRIMINATOR: [u8; 8] = [219, 200, 88, 176, 158, 63, 253, 127];
pub const TRANSFER_DISCRIMINATOR: [u8; 8] = [163, 52, 200, 231, 140, 3, 69, 186];
pub const DELETE_DISCRIMINATOR: [u8; 8] = [165, 204, 60, 98, 134, 15, 83, 134];
pub const EXTEND_DISCRIMINATOR: [u8; 8] = [228, 127, 0, 1, 227, 154, 54, 168];
pub const IMMUTABLE_OWNER_DISCRIMINATOR: [u8; 8] = [203, 139, 201, 92, 25, 75, 195, 226];
pub const SET_TRANSFERABLE_DISCRIMINATOR: [u8; 8] = [180, 137, 54, 30, 247, 106, 207, 6];
pub const RESIZE_DISCRIMINATOR: [u8; 8] = [74, 27, 74, 155, 56, 134, 175, 125];

/// Account discriminator for NameRecordHeader.
pub const NAME_RECORD_DISCRIMINATOR: [u8; 8] = [0x44, 0x48, 0x58, 0x2c, 0x0f, 0xa7, 0x67, 0xf3];
