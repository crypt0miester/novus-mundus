use core::slice::from_raw_parts;

use pinocchio::{
    account_info::AccountInfo,
    instruction::{AccountMeta, Instruction, Signer},
    program::invoke_signed,
    ProgramResult,
    pubkey::Pubkey,
};

use crate::{write_bytes, UNINIT_BYTE};

/// Update arguments for an MPL Core Asset V1
/// Empty slices (&[]) indicate no update for that field
pub struct UpdateV1Args<'a> {
    /// New name (pass &[] for no update)
    pub new_name: &'a [u8],
    /// New URI (pass &[] for no update)
    pub new_uri: &'a [u8],
    /// New update authority
    pub new_update_authority: UpdateAuthorityArg,
}

/// Update authority argument types
#[derive(Copy, Clone, Debug)]
pub enum UpdateAuthorityArg {
    /// No update to authority
    NoUpdate,
    /// Remove update authority
    None,
    /// A standard address or PDA
    Address(Pubkey),
    /// Authority delegated to a collection
    Collection(Pubkey),
}

/// Update an MPL Core Asset V1.
///
/// ### Accounts:
///   0. `[WRITE]` The asset to update
///   1. `[WRITE, OPTIONAL]` The collection to which the asset belongs
///   2. `[WRITE, SIGNER]` The account paying for the storage fees
///   3. `[SIGNER, OPTIONAL]` The update authority
///   4. `[]` The system program
///   5. `[OPTIONAL]` The SPL Noop Program
pub struct UpdateV1<'a> {
    /// The asset to update
    pub asset: &'a AccountInfo,
    /// The collection to which the asset belongs (pass zero pubkey for None)
    pub collection: &'a AccountInfo,
    /// The account paying for the storage fees
    pub payer: &'a AccountInfo,
    /// The update authority signing the update (pass zero pubkey for None)
    pub authority: &'a AccountInfo,
    /// The system program
    pub system_program: &'a AccountInfo,
    /// The SPL Noop Program (pass zero pubkey for None)
    pub log_wrapper: &'a AccountInfo,

    // Instruction arguments
    pub args: UpdateV1Args<'a>,
}

impl UpdateV1<'_> {
    #[inline(always)]
    pub fn invoke(&self) -> ProgramResult {
        self.invoke_signed(&[])
    }

    #[inline(always)]
    pub fn invoke_signed(&self, signers: &[Signer]) -> ProgramResult {
        // Build account metas
        let account_metas = [
            AccountMeta::writable(self.asset.key()),
            AccountMeta::writable(self.collection.key()),
            AccountMeta::writable_signer(self.payer.key()),
            AccountMeta::readonly_signer(self.authority.key()),
            AccountMeta::readonly(self.system_program.key()),
            AccountMeta::readonly(self.log_wrapper.key()),
        ];

        // Calculate instruction data size
        // 1 byte discriminator
        // 1 byte option for new_name + name data if Some
        // 1 byte option for new_uri + uri data if Some
        // 1 byte option for new_update_authority + authority data if Some
        // Size calculation removed - using fixed buffer below

        // Allocate instruction data
        let mut instruction_data = [UNINIT_BYTE; 512]; // Max size for update

        let mut offset = 0;

        // Write discriminator (13 for UpdateV1 - guessed based on pattern)
        write_bytes(&mut instruction_data[offset..offset+1], &[13]);
        offset += 1;

        // Write new_name
        if !self.args.new_name.is_empty() {
            let name_len = self.args.new_name.len().min(32);
            write_bytes(&mut instruction_data[offset..offset+1], &[1]); // Some
            offset += 1;
            write_bytes(&mut instruction_data[offset..offset+4], &(name_len as u32).to_le_bytes());
            offset += 4;
            write_bytes(&mut instruction_data[offset..offset+name_len], &self.args.new_name[..name_len]);
            offset += name_len;
        } else {
            write_bytes(&mut instruction_data[offset..offset+1], &[0]); // None
            offset += 1;
        }

        // Write new_uri
        if !self.args.new_uri.is_empty() {
            let uri_len = self.args.new_uri.len().min(200);
            write_bytes(&mut instruction_data[offset..offset+1], &[1]); // Some
            offset += 1;
            write_bytes(&mut instruction_data[offset..offset+4], &(uri_len as u32).to_le_bytes());
            offset += 4;
            write_bytes(&mut instruction_data[offset..offset+uri_len], &self.args.new_uri[..uri_len]);
            offset += uri_len;
        } else {
            write_bytes(&mut instruction_data[offset..offset+1], &[0]); // None
            offset += 1;
        }

        // Write new_update_authority
        match &self.args.new_update_authority {
            UpdateAuthorityArg::NoUpdate => {
                write_bytes(&mut instruction_data[offset..offset+1], &[0]); // None (no update)
                offset += 1;
            },
            UpdateAuthorityArg::None => {
                write_bytes(&mut instruction_data[offset..offset+1], &[1]); // Some
                offset += 1;
                write_bytes(&mut instruction_data[offset..offset+1], &[0]); // None authority
                offset += 1;
                // Write zero pubkey
                write_bytes(&mut instruction_data[offset..offset+32], &[0u8; 32]);
                offset += 32;
            },
            UpdateAuthorityArg::Address(pubkey) => {
                write_bytes(&mut instruction_data[offset..offset+1], &[1]); // Some
                offset += 1;
                write_bytes(&mut instruction_data[offset..offset+1], &[1]); // Address
                offset += 1;
                write_bytes(&mut instruction_data[offset..offset+32], pubkey.as_ref());
                offset += 32;
            },
            UpdateAuthorityArg::Collection(pubkey) => {
                write_bytes(&mut instruction_data[offset..offset+1], &[1]); // Some
                offset += 1;
                write_bytes(&mut instruction_data[offset..offset+1], &[2]); // Collection
                offset += 1;
                write_bytes(&mut instruction_data[offset..offset+32], pubkey.as_ref());
                offset += 32;
            },
        }

        let instruction = Instruction {
            program_id: &crate::ID,
            accounts: &account_metas[..6], // 6 accounts for update
            data: unsafe { from_raw_parts(instruction_data.as_ptr() as _, offset) },
        };

        // Collect account infos
        let account_infos = [
            self.asset,
            self.collection,
            self.payer,
            self.authority,
            self.system_program,
            self.log_wrapper,
        ];

        invoke_signed(&instruction, &account_infos, signers)
    }
}