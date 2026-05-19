//! Reader for the Solana Instructions sysvar.
//!
//! Ported from `switchboard-on-demand` 0.12.1 `src/sysvar/ix_sysvar.rs`.
//! Only the checked `extract_ix_data` is kept (the `_unchecked` variant and the
//! `parse_ix_data_unverified` helper are dropped). The extraction logic is a
//! faithful 1:1 copy; the `assert!`s are upstream's — they fail closed under
//! `panic = abort`.

use core::ptr::read_unaligned;

use pinocchio::AccountView;

use crate::{check_pubkey_eq, ED25519_PROGRAM_ID, INSTRUCTIONS_SYSVAR_ID};

/// Accessor for instruction data inside the Instructions sysvar.
pub struct Instructions;

impl Instructions {
    /// Extracts the instruction data at `idx` from the Instructions sysvar,
    /// asserting it is an ed25519-program instruction whose signature offsets
    /// all reference instruction index `idx`.
    ///
    /// Returns a zero-copy reference into the sysvar account data.
    #[inline(always)]
    pub fn extract_ix_data<'a>(ix_sysvar: &'a AccountView, idx: usize) -> &'a [u8] {
        assert!(check_pubkey_eq(ix_sysvar.address(), INSTRUCTIONS_SYSVAR_ID));
        unsafe {
            let data = ix_sysvar.borrow_unchecked();
            let base = data.as_ptr();

            // num_instructions is the leading u16.
            let num_instructions = read_unaligned(base as *const u16) as usize;

            assert!(
                idx < num_instructions,
                "Instruction index out of bounds"
            );

            // Instruction offset from the offset table at (2 + idx * 2).
            let start_offset = read_unaligned(base.add(2 + (idx << 1)) as *const u16) as usize;

            let mut p = base.add(start_offset);

            let num_accounts = read_unaligned(p as *const u16) as usize;

            // Skip account metas (1 meta byte + 32 pubkey bytes each).
            p = p.add(2 + num_accounts * 33);

            // program_id (32 bytes), then data length (u16).
            let program_id = &*(p as *const [u8; 32]);
            let instruction_data_len = read_unaligned(p.add(32) as *const u16) as usize;

            let ix_data_ptr = p.add(34);
            let instruction_data = core::slice::from_raw_parts(ix_data_ptr, instruction_data_len);

            // Must be an ed25519-program instruction with a parseable header.
            assert!(check_pubkey_eq(program_id, ED25519_PROGRAM_ID));
            assert!(instruction_data_len >= 16);

            // The first Ed25519SignatureOffsets sits after the 2-byte header.
            // All of its instruction indexes MUST equal `idx`; `verify` then
            // confirms the remaining signatures match this first header.
            let signature_instruction_index =
                read_unaligned(ix_data_ptr.add(4) as *const u16) as usize;
            let public_key_instruction_index =
                read_unaligned(ix_data_ptr.add(8) as *const u16) as usize;
            let message_instruction_index =
                read_unaligned(ix_data_ptr.add(14) as *const u16) as usize;

            assert!(
                signature_instruction_index == idx,
                "Signature instruction index mismatch"
            );
            assert!(
                public_key_instruction_index == idx,
                "Public key instruction index mismatch"
            );
            assert!(
                message_instruction_index == idx,
                "Message instruction index mismatch"
            );

            instruction_data
        }
    }
}
