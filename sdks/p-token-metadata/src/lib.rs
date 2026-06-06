#![no_std]

//! Minimal pinocchio CPI binding for the Metaplex Token Metadata program.
//! Only the instructions this game needs are implemented (CreateMetadataAccountV3),
//! mirroring the hand-rolled style of the sibling `p-core` crate.

pub mod instructions;

pinocchio::address::declare_id!("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");

use core::mem::MaybeUninit;

const UNINIT_BYTE: MaybeUninit<u8> = MaybeUninit::<u8>::uninit();

#[inline(always)]
pub(crate) fn write_bytes(destination: &mut [MaybeUninit<u8>], source: &[u8]) {
    for (d, s) in destination.iter_mut().zip(source.iter()) {
        d.write(*s);
    }
}
