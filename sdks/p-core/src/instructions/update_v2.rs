use core::slice::from_raw_parts;

use pinocchio::{
    cpi::{invoke_signed, Signer},
    instruction::{InstructionAccount, InstructionView},
    AccountView, ProgramResult,
};

use crate::{write_bytes, UNINIT_BYTE};
use super::update_v1::UpdateAuthorityArg;

/// Update an MPL Core Asset V2 (supports new_collection changes).
///
/// ### Accounts:
///   0. `[WRITE]` The asset to update
///   1. `[WRITE, OPTIONAL]` The collection
///   2. `[WRITE, SIGNER]` The payer
///   3. `[SIGNER, OPTIONAL]` The update authority
///   4. `[WRITE, OPTIONAL]` The new collection (if changing collections)
///   5. `[]` The system program
///   6. `[OPTIONAL]` The SPL Noop Program
pub struct UpdateV2<'a> {
    pub asset: &'a AccountView,
    pub collection: &'a AccountView,
    pub payer: &'a AccountView,
    pub authority: &'a AccountView,
    pub new_collection: &'a AccountView,
    pub system_program: &'a AccountView,
    pub log_wrapper: &'a AccountView,
    pub new_name: &'a [u8],
    pub new_uri: &'a [u8],
    pub new_update_authority: UpdateAuthorityArg,
}

impl UpdateV2<'_> {
    #[inline(always)]
    pub fn invoke(&self) -> ProgramResult {
        self.invoke_signed(&[])
    }

    #[inline(always)]
    pub fn invoke_signed(&self, signers: &[Signer]) -> ProgramResult {
        let account_metas = [
            InstructionAccount::writable(self.asset.address()),
            InstructionAccount::writable(self.collection.address()),
            InstructionAccount::writable_signer(self.payer.address()),
            InstructionAccount::readonly_signer(self.authority.address()),
            InstructionAccount::writable(self.new_collection.address()),
            InstructionAccount::readonly(self.system_program.address()),
            InstructionAccount::readonly(self.log_wrapper.address()),
        ];

        let mut instruction_data = [UNINIT_BYTE; 512];
        let mut offset = 0;

        // Discriminator (30 for UpdateV2)
        write_bytes(&mut instruction_data[offset..offset+1], &[30]);
        offset += 1;

        // new_name: Option<String>
        if !self.new_name.is_empty() {
            let name_len = self.new_name.len().min(32);
            write_bytes(&mut instruction_data[offset..offset+1], &[1]); // Some
            offset += 1;
            write_bytes(&mut instruction_data[offset..offset+4], &(name_len as u32).to_le_bytes());
            offset += 4;
            write_bytes(&mut instruction_data[offset..offset+name_len], &self.new_name[..name_len]);
            offset += name_len;
        } else {
            write_bytes(&mut instruction_data[offset..offset+1], &[0]); // None
            offset += 1;
        }

        // new_uri: Option<String>
        if !self.new_uri.is_empty() {
            let uri_len = self.new_uri.len().min(200);
            write_bytes(&mut instruction_data[offset..offset+1], &[1]); // Some
            offset += 1;
            write_bytes(&mut instruction_data[offset..offset+4], &(uri_len as u32).to_le_bytes());
            offset += 4;
            write_bytes(&mut instruction_data[offset..offset+uri_len], &self.new_uri[..uri_len]);
            offset += uri_len;
        } else {
            write_bytes(&mut instruction_data[offset..offset+1], &[0]); // None
            offset += 1;
        }

        // new_update_authority: Option<UpdateAuthority>
        match &self.new_update_authority {
            UpdateAuthorityArg::NoUpdate => {
                write_bytes(&mut instruction_data[offset..offset+1], &[0]); // None
                offset += 1;
            },
            UpdateAuthorityArg::None => {
                write_bytes(&mut instruction_data[offset..offset+1], &[1]); // Some
                offset += 1;
                write_bytes(&mut instruction_data[offset..offset+1], &[0]); // None authority
                offset += 1;
                write_bytes(&mut instruction_data[offset..offset+32], &[0u8; 32]);
                offset += 32;
            },
            UpdateAuthorityArg::Address(pubkey) => {
                write_bytes(&mut instruction_data[offset..offset+1], &[1]); // Some
                offset += 1;
                write_bytes(&mut instruction_data[offset..offset+1], &[1]); // Address
                offset += 1;
                write_bytes(&mut instruction_data[offset..offset+32], pubkey);
                offset += 32;
            },
            UpdateAuthorityArg::Collection(pubkey) => {
                write_bytes(&mut instruction_data[offset..offset+1], &[1]); // Some
                offset += 1;
                write_bytes(&mut instruction_data[offset..offset+1], &[2]); // Collection
                offset += 1;
                write_bytes(&mut instruction_data[offset..offset+32], pubkey);
                offset += 32;
            },
        }

        let instruction = InstructionView {
            program_id: &crate::ID,
            accounts: &account_metas,
            data: unsafe { from_raw_parts(instruction_data.as_ptr() as _, offset) },
        };

        invoke_signed(
            &instruction,
            &[self.asset, self.collection, self.payer, self.authority, self.new_collection, self.system_program, self.log_wrapper],
            signers,
        )
    }
}
