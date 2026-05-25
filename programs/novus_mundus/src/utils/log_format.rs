//! Formatters that integrate with `pinocchio_log::log!`.
//!
//! `Pk(&pubkey_bytes)` formats a 32-byte pubkey as base58 in tx logs so
//! mismatch errors print human-readable addresses instead of
//! "Program failed: InvalidArgument".

use core::mem::MaybeUninit;

use pinocchio_log::logger::{Argument, Log};

/// Format a 32-byte public key as base58 for diagnostic logging.
///
/// ```ignore
/// pinocchio_log::log!("expected {}, got {}", Pk(&want), Pk(&got));
/// ```
pub struct Pk<'a>(pub &'a [u8; 32]);

// Safety: five8::encode_32 writes valid ASCII bytes; returned length is exact.
unsafe impl Log for Pk<'_> {
    fn write_with_args(&self, buffer: &mut [MaybeUninit<u8>], _args: &[Argument]) -> usize {
        let mut tmp = [0u8; 44];
        let mut len = 0u8;
        five8::encode_32(self.0, Some(&mut len), &mut tmp);
        let len = len as usize;
        let to_write = if len < buffer.len() {
            len
        } else {
            buffer.len()
        };
        for i in 0..to_write {
            buffer[i] = MaybeUninit::new(tmp[i]);
        }
        to_write
    }
}
