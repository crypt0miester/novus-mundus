//! `QuoteVerifier` — the oracle-quote verification core.
//!
//! Ported from `switchboard-on-demand` 0.12.1
//! `src/on_demand/oracle_quote/quote_verifier.rs` — only the
//! `#[cfg(feature = "pinocchio")]` builder/impl is kept; the non-pinocchio
//! twin, the anchor wrappers and the `parse_unverified*` (no-verification)
//! helpers are dropped.
//!
//! The verification logic is a faithful 1:1 copy of upstream `verify`:
//! 1. parse the ed25519 instruction (signatures + feeds + recent slot);
//! 2. require the quote be no older than `max_age` slots;
//! 3. confirm the quote's signed slot hash is in the SlotHashes sysvar;
//! 4. confirm every signer is an authorized oracle in the queue.
//!
//! Steps 3 and 4 use upstream's `assert!` — a forged quote fails the assert
//! and aborts the transaction (fail-closed under `panic = abort`).

use core::ptr::read_unaligned;

use pinocchio::AccountView;

use crate::ed25519::Ed25519Sysvar;
use crate::ix_sysvar::Instructions;
use crate::queue::QueueAccountData;
use crate::quote::{OracleQuote, QUOTE_DISCRIMINATOR_U64_LE};
use crate::{check_p64_eq, check_pubkey_eq, SbError, SlotHash, SLOT_HASHES_SYSVAR_ID};

/// Number of slots stored in the SlotHashes sysvar.
const SYSVAR_SLOT_LEN: u64 = 512;

/// Builder for configuring and performing oracle-quote verification.
///
/// All of `queue`, `slothash_sysvar`, `ix_sysvar` (for `verify_instruction_at`)
/// and `clock_slot` must be set before a verification call.
#[derive(Clone)]
pub struct QuoteVerifier<'a> {
    queue: Option<&'a AccountView>,
    slothash_sysvar: Option<&'a AccountView>,
    ix_sysvar: Option<&'a AccountView>,
    clock_slot: Option<u64>,
    max_age: u64,
}

impl<'a> Default for QuoteVerifier<'a> {
    fn default() -> Self {
        Self::new()
    }
}

impl<'a> QuoteVerifier<'a> {
    /// Creates a new verifier with a default `max_age` of 30 slots.
    #[inline(always)]
    pub fn new() -> Self {
        Self {
            queue: None,
            slothash_sysvar: None,
            ix_sysvar: None,
            clock_slot: None,
            max_age: 30,
        }
    }

    /// Sets the Switchboard oracle queue account (authorized signing keys).
    #[inline(always)]
    pub fn queue(&mut self, account: &'a AccountView) -> &mut Self {
        self.queue = Some(account);
        self
    }

    /// Sets the SlotHashes sysvar account.
    #[inline(always)]
    pub fn slothash_sysvar(&mut self, sysvar: &'a AccountView) -> &mut Self {
        self.slothash_sysvar = Some(sysvar);
        self
    }

    /// Sets the Instructions sysvar account (for `verify_instruction_at`).
    #[inline(always)]
    pub fn ix_sysvar(&mut self, sysvar: &'a AccountView) -> &mut Self {
        self.ix_sysvar = Some(sysvar);
        self
    }

    /// Sets the current clock slot for freshness validation.
    #[inline(always)]
    pub fn clock_slot(&mut self, clock_slot: u64) -> &mut Self {
        self.clock_slot = Some(clock_slot);
        self
    }

    /// Sets the maximum quote age, in slots.
    #[inline(always)]
    pub fn max_age(&mut self, max_age: u64) -> &mut Self {
        self.max_age = max_age;
        self
    }

    /// Verifies a stored oracle-quote account.
    ///
    /// The account layout is `[discriminator(8)][queue(32)][len(2)][data]`;
    /// this checks the discriminator, then verifies the delimited data.
    #[inline(always)]
    pub fn verify_account<'data>(
        &self,
        oracle_account: &'data AccountView,
    ) -> Result<OracleQuote<'data>, SbError> {
        let oracle_data: &'data [u8] = unsafe { oracle_account.borrow_unchecked() };

        if oracle_data.len() < 40 {
            return Err(SbError::AccountTooSmall);
        }
        unsafe {
            if read_unaligned(oracle_data.as_ptr() as *const u64) != QUOTE_DISCRIMINATOR_U64_LE {
                return Err(SbError::InvalidDiscriminator);
            }
        }

        self.verify_delimited(&oracle_data[40..])
    }

    /// Verifies length-delimited (`[len(2)][data]`) oracle-quote data.
    #[inline(always)]
    pub fn verify_delimited<'data>(
        &self,
        data: &'data [u8],
    ) -> Result<OracleQuote<'data>, SbError> {
        if data.len() < 2 {
            return Err(SbError::AccountTooSmall);
        }
        let len = unsafe { read_unaligned(data.as_ptr() as *const u16) } as usize;
        if data.len() < len + 2 {
            return Err(SbError::MalformedInstruction);
        }
        self.verify(&data[2..len + 2])
    }

    /// Loads the ed25519 instruction at `instruction_idx` from the Instructions
    /// sysvar and verifies the oracle quote it carries.
    #[inline(always)]
    pub fn verify_instruction_at(
        &self,
        instruction_idx: usize,
    ) -> Result<OracleQuote<'a>, SbError> {
        let ix_sysvar = self.ix_sysvar.ok_or(SbError::MissingAccount)?;
        let data = Instructions::extract_ix_data(ix_sysvar, instruction_idx);
        self.verify(data)
    }

    /// Verifies raw ed25519 oracle-quote instruction data.
    ///
    /// This is the verification core — see the module docs for the four
    /// checks performed.
    pub fn verify<'data>(&self, data: &'data [u8]) -> Result<OracleQuote<'data>, SbError> {
        let (parsed_sigs, sig_count, oracle_idxs, recent_slot, version) =
            Ed25519Sysvar::parse_instruction(data)?;

        let queue = self.queue.ok_or(SbError::MissingAccount)?;
        let slothash_sysvar = self.slothash_sysvar.ok_or(SbError::MissingAccount)?;
        let clock_slot = self.clock_slot.ok_or(SbError::MissingAccount)?;

        // Freshness: the quote must not be ahead of, or older than max_age
        // slots behind, the current clock slot.
        if clock_slot < recent_slot || clock_slot - recent_slot > self.max_age {
            return Err(SbError::QuoteTooOld);
        }

        if sig_count == 0 {
            return Err(SbError::NoSignatures);
        }

        // Queue account holds the authorized oracle signing keys.
        let queue_buf = unsafe { queue.borrow_unchecked() };
        if queue_buf.len() != crate::queue::QUEUE_ACCOUNT_LEN {
            return Err(SbError::QueueWrongSize);
        }
        let queue_data: &QueueAccountData =
            unsafe { &*(queue_buf.as_ptr().add(8) as *const QueueAccountData) };

        // Confirm the quote's signed slot hash exists in the SlotHashes sysvar.
        let reference_sig = &parsed_sigs[0];
        let header = unsafe { reference_sig.quote_header() };
        let target_slothash = &header.signed_slothash as *const _ as *const u64;
        let found = Self::find_slothash_in_sysvar(recent_slot, slothash_sysvar)?;
        let found_slothash = &found as *const _ as *const u64;
        assert!(unsafe { check_p64_eq(found_slothash, target_slothash) });

        // Confirm every signer is the queue's authorized ed25519 oracle key.
        for i in 0..sig_count {
            // Branchless bounds check — 30 is the max oracles in a queue.
            let oracle_idx = (oracle_idxs[i as usize] as usize) % 30;
            let expected_oracle_key = queue_data.ed25519_oracle_signing_keys[oracle_idx];
            let actual_oracle_key = unsafe { parsed_sigs[i as usize].pubkey() };
            assert!(unsafe {
                check_p64_eq(
                    actual_oracle_key as *const _ as *const u64,
                    &expected_oracle_key as *const _ as *const u64,
                )
            });
        }

        let reference_feed_infos = unsafe { reference_sig.feed_infos() };
        let feed_count = reference_feed_infos.len();

        Ok(OracleQuote::new(
            unsafe { reference_sig.quote_header() },
            sig_count,
            reference_feed_infos,
            feed_count as u8,
            oracle_idxs,
            recent_slot,
            version,
            data,
        ))
    }

    /// Finds the 32-byte hash for `target_slot` in the SlotHashes sysvar.
    ///
    /// Searches backwards from an estimated index (the sysvar is slot-ordered).
    fn find_slothash_in_sysvar(
        target_slot: u64,
        slothash_sysvar: &AccountView,
    ) -> Result<[u8; 32], SbError> {
        assert!(check_pubkey_eq(
            slothash_sysvar.address(),
            SLOT_HASHES_SYSVAR_ID
        ));
        let slothash_data = unsafe { slothash_sysvar.borrow_unchecked() };

        // SlotHash is `#[repr(C)]` (u64 + [u8; 32]); the runtime guarantees
        // the sysvar data is aligned. The 8-byte header is skipped first.
        let slot_data: &[SlotHash] = unsafe { core::mem::transmute(&slothash_data[8..]) };

        let mut estimated_idx = ((slot_data[0].slot - target_slot) % SYSVAR_SLOT_LEN) as usize;

        loop {
            let slot_entry = &slot_data[estimated_idx];
            if slot_entry.slot == target_slot {
                return Ok(slot_entry.hash);
            }
            if estimated_idx == 0 {
                break;
            }
            estimated_idx -= 1;
        }
        Err(SbError::SlotHashNotFound)
    }
}
