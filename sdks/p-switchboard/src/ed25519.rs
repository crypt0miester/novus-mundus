//! Zero-copy parser for the Solana ed25519 precompile instruction that carries
//! a Switchboard oracle quote.
//!
//! Ported from `switchboard-on-demand` 0.12.1 `src/sysvar/ed25519_sysvar.rs`.
//! The parsing logic is a faithful 1:1 copy; only the error type
//! (`anyhow` → [`SbError`]) and `std`→`core` differ. The borsh / anchor impls
//! on `Ed25519SignatureOffsets` are dropped.

use core::marker::PhantomData;

use crate::feed_info::{PackedFeedInfo, PackedQuoteHeader};
use crate::SbError;

/// Parsed-instruction tuple: `(signatures, sig_count, oracle_idxs, recent_slot, version)`.
pub type ParsedInstructionResult<'a> =
    Result<([ParsedEd25519SignatureDataRef<'a>; 8], u8, &'a [u8], u64, u8), SbError>;

/// Size of a serialized ED25519 public key, in bytes.
pub const ED25519_PUBKEY_SERIALIZED_SIZE: usize = 32;
/// Size of a serialized ED25519 signature, in bytes.
pub const ED25519_SIGNATURE_SERIALIZED_SIZE: usize = 64;
/// Size of an `Ed25519SignatureOffsets` structure, in bytes (7 × u16).
pub const ED25519_SIGNATURE_OFFSETS_SERIALIZED_SIZE: usize = 14;

/// Header of the ed25519 instruction data: signature count + padding byte.
#[repr(C)]
#[derive(Debug, Copy, Clone)]
pub struct Ed25519SignatureHeader {
    /// Number of signatures in the instruction.
    pub num_signatures: u8,
    /// Padding byte for alignment.
    pub padding: u8,
}

/// ED25519 signature-data offsets within the instruction data.
#[repr(C)]
#[derive(Debug, Copy, Clone, PartialEq, Eq)]
pub struct Ed25519SignatureOffsets {
    /// Offset to the signature data.
    pub signature_offset: u16,
    /// Instruction index containing the signature.
    pub signature_instruction_index: u16,
    /// Offset to the public-key data.
    pub public_key_offset: u16,
    /// Instruction index containing the public key.
    pub public_key_instruction_index: u16,
    /// Offset to the message data.
    pub message_data_offset: u16,
    /// Size of the message data, in bytes.
    pub message_data_size: u16,
    /// Instruction index containing the message.
    pub message_instruction_index: u16,
}

/// Parsed ED25519 signature data with lifetime-bound zero-copy references.
#[derive(Debug, Copy, Clone)]
pub struct ParsedEd25519SignatureDataRef<'a> {
    /// Signature-data offsets.
    pub offsets: Ed25519SignatureOffsets,
    /// Pointer to the public-key data.
    pub pubkey: *const [u8; ED25519_PUBKEY_SERIALIZED_SIZE],
    /// Pointer to the signature data.
    pub signature: *const [u8; ED25519_SIGNATURE_SERIALIZED_SIZE],
    /// Pointer to the message data.
    pub message: *const u8,
    /// Length of the message data.
    pub message_len: usize,
    /// Pointer to the packed quote header.
    pub bundle_header: *const PackedQuoteHeader,
    /// Pointer to the feed-information array.
    pub feed_infos: *const PackedFeedInfo,
    /// Number of feeds in the feed-information array.
    pub feed_count: usize,
    _phantom: PhantomData<&'a ()>,
}

impl<'a> ParsedEd25519SignatureDataRef<'a> {
    /// Creates an empty value with all-null pointers.
    #[inline(always)]
    pub fn default_empty() -> Self {
        unsafe { core::mem::zeroed() }
    }

    /// Returns true if the signature data has a non-null pubkey pointer.
    #[inline(always)]
    pub fn is_valid(&self) -> bool {
        !self.pubkey.is_null()
    }

    /// Returns the ED25519 public key.
    ///
    /// # Safety
    /// Assumes the signature data is properly formatted and aligned.
    #[inline(always)]
    pub unsafe fn pubkey(&self) -> &'a [u8; ED25519_PUBKEY_SERIALIZED_SIZE] {
        &*self.pubkey
    }

    /// Returns the ED25519 signature bytes.
    ///
    /// # Safety
    /// Assumes the signature data is properly formatted and aligned.
    #[inline(always)]
    pub unsafe fn signature(&self) -> &'a [u8; ED25519_SIGNATURE_SERIALIZED_SIZE] {
        &*self.signature
    }

    /// Returns the signed message.
    ///
    /// # Safety
    /// Assumes the message data is properly formatted.
    #[inline(always)]
    pub unsafe fn message(&self) -> &'a [u8] {
        core::slice::from_raw_parts(self.message, self.message_len)
    }

    /// Returns the oracle quote header from the message.
    ///
    /// # Safety
    /// Assumes the message contains a valid `PackedQuoteHeader`.
    #[inline(always)]
    pub unsafe fn quote_header(&self) -> &'a PackedQuoteHeader {
        &*self.bundle_header
    }

    /// Returns the array of feed information from the oracle quote.
    ///
    /// # Safety
    /// Assumes the message contains valid `PackedFeedInfo` data.
    #[inline(always)]
    pub unsafe fn feed_infos(&self) -> &'a [PackedFeedInfo] {
        core::slice::from_raw_parts(self.feed_infos, self.feed_count)
    }
}

/// Parser for ed25519 signature-verification instruction data.
pub struct Ed25519Sysvar;

impl Ed25519Sysvar {
    /// Zero-copy parse of an ed25519 instruction carrying an oracle quote.
    ///
    /// Returns `(signatures, sig_count, oracle_idxs, recent_slot, version)`.
    #[inline(always)]
    pub fn parse_instruction(data: &[u8]) -> ParsedInstructionResult<'_> {
        let data_len = data.len();
        // Validate minimum size for header before unsafe cast.
        if data_len < core::mem::size_of::<Ed25519SignatureHeader>() {
            return Err(SbError::MalformedInstruction);
        }

        // Parse the header (num_signatures + padding byte).
        let header: &Ed25519SignatureHeader = unsafe { core::mem::transmute(&data[0]) };
        let num_signatures = header.num_signatures as usize;
        if num_signatures > 8 {
            return Err(SbError::MalformedInstruction);
        }
        if num_signatures == 0 {
            return Err(SbError::MalformedInstruction);
        }

        // Extract recent_slot and version from the end of instruction data.
        // Check for underflow before subtraction.
        if data_len < 13 + num_signatures {
            return Err(SbError::MalformedInstruction);
        }
        // Discriminator length is 4, slot is 8, version is 1.
        let end_of_message = data_len - num_signatures - 13;
        let suffix = &data[end_of_message..];
        let oracle_idxs: &[u8] = unsafe { suffix.get_unchecked(..num_signatures) };
        let suffix = unsafe { suffix.get_unchecked(num_signatures..) };
        let slot: u64 = unsafe {
            // Direct u64 read - data already little-endian.
            core::ptr::read_unaligned(&suffix[0] as *const u8 as *const u64)
        };
        let version: u8 = unsafe { *suffix.get_unchecked(8) };

        let message_data = &data[..end_of_message];
        let message_data_ptr = message_data.as_ptr();

        // Use zeroed array to avoid unnecessary initialization.
        let mut parsed_sigs_array =
            unsafe { core::mem::zeroed::<[ParsedEd25519SignatureDataRef; 8]>() };
        let parsed_sigs_ptr = parsed_sigs_array.as_mut_ptr();

        unsafe {
            let mut offset = 2usize; // Skip padding byte after count byte.

            // Parse the first signature to get the shared message structure.
            let offset_ptr = message_data_ptr.add(offset);
            let first_offsets = *(offset_ptr as *const Ed25519SignatureOffsets);
            let first_message_offset = first_offsets.message_data_offset as usize;
            let first_message_size = first_offsets.message_data_size as usize;

            // Parse message structure once for all signatures.
            let message = core::slice::from_raw_parts(
                message_data_ptr.add(first_message_offset),
                first_message_size,
            );

            if first_message_size < core::mem::size_of::<PackedQuoteHeader>() {
                return Err(SbError::MalformedInstruction);
            }
            let shared_header: &PackedQuoteHeader = core::mem::transmute(&message[0]);

            const HEADER_SIZE: usize = core::mem::size_of::<PackedQuoteHeader>();
            const FEED_INFO_SIZE: usize = core::mem::size_of::<PackedFeedInfo>();
            let remaining_bytes = first_message_size - HEADER_SIZE;

            if remaining_bytes % FEED_INFO_SIZE != 0 {
                return Err(SbError::MalformedInstruction);
            }

            let shared_feed_count = remaining_bytes / FEED_INFO_SIZE;
            if shared_feed_count > 8 {
                return Err(SbError::MalformedInstruction);
            }

            let shared_feed_infos = core::slice::from_raw_parts(
                message.as_ptr().add(HEADER_SIZE) as *const PackedFeedInfo,
                shared_feed_count,
            );

            // Process the first signature (i = 0) outside the loop.
            let first_signature_offset = first_offsets.signature_offset as usize;
            let first_pubkey_offset = first_offsets.public_key_offset as usize;
            let first_message_instruction_index = first_offsets.message_instruction_index;

            let first_pubkey = &*(message_data_ptr.add(first_pubkey_offset)
                as *const [u8; ED25519_PUBKEY_SERIALIZED_SIZE]);
            let first_signature = &*(message_data_ptr.add(first_signature_offset)
                as *const [u8; ED25519_SIGNATURE_SERIALIZED_SIZE]);

            parsed_sigs_ptr.write(ParsedEd25519SignatureDataRef {
                offsets: first_offsets,
                pubkey: first_pubkey as *const _,
                signature: first_signature as *const _,
                message: message_data_ptr.add(first_message_offset),
                message_len: first_message_size,
                bundle_header: shared_header as *const _,
                feed_infos: shared_feed_infos.as_ptr(),
                feed_count: shared_feed_count,
                _phantom: PhantomData,
            });

            offset += ED25519_SIGNATURE_OFFSETS_SERIALIZED_SIZE;

            // Process the remaining signatures (i = 1 .. num_signatures).
            for i in 1..num_signatures {
                let offset_ptr = message_data_ptr.add(offset);
                let offsets = *(offset_ptr as *const Ed25519SignatureOffsets);

                let signature_offset = offsets.signature_offset as usize;
                let pubkey_offset = offsets.public_key_offset as usize;
                let message_offset = offsets.message_data_offset as usize;
                let message_size = offsets.message_data_size as usize;

                // Verify all messages are identical.
                if message_offset != first_message_offset || message_size != first_message_size {
                    return Err(SbError::MalformedInstruction);
                }

                // Validate all instruction indexes match the first signature's.
                if offsets.signature_instruction_index != first_message_instruction_index {
                    return Err(SbError::MalformedInstruction);
                }
                if offsets.public_key_instruction_index != first_message_instruction_index {
                    return Err(SbError::MalformedInstruction);
                }
                if offsets.message_instruction_index != first_message_instruction_index {
                    return Err(SbError::MalformedInstruction);
                }

                let pubkey = &*(message_data_ptr.add(pubkey_offset)
                    as *const [u8; ED25519_PUBKEY_SERIALIZED_SIZE]);
                let signature = &*(message_data_ptr.add(signature_offset)
                    as *const [u8; ED25519_SIGNATURE_SERIALIZED_SIZE]);

                parsed_sigs_ptr.add(i).write(ParsedEd25519SignatureDataRef {
                    offsets,
                    pubkey: pubkey as *const _,
                    signature: signature as *const _,
                    message: message_data_ptr.add(message_offset),
                    message_len: message_size,
                    bundle_header: shared_header as *const _,
                    feed_infos: shared_feed_infos.as_ptr(),
                    feed_count: shared_feed_count,
                    _phantom: PhantomData,
                });

                offset += ED25519_SIGNATURE_OFFSETS_SERIALIZED_SIZE;
            }

            Ok((
                parsed_sigs_array,
                num_signatures as u8,
                oracle_idxs,
                slot,
                version,
            ))
        }
    }
}
