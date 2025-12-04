use core::slice::from_raw_parts;

use pinocchio::{
    account_info::AccountInfo,
    instruction::{AccountMeta, Instruction, Signer},
    program::invoke_signed,
    ProgramResult,
};

use crate::{write_bytes, UNINIT_BYTE};

/// Create a new MPL Core Collection V1.
///
/// ### Accounts:
///   0. `[WRITE, SIGNER]` The address of the new collection
///   1. `[OPTIONAL]` The update authority of the new collection
///   2. `[WRITE, SIGNER]` The account paying for the storage fees
///   3. `[]` The system program
pub struct CreateCollectionV1<'a> {
    /// The address of the new collection
    pub collection: &'a AccountInfo,
    /// The update authority of the new collection (use program_id for None)
    pub update_authority: &'a AccountInfo,
    /// The account paying for the storage fees
    pub payer: &'a AccountInfo,
    /// The system program
    pub system_program: &'a AccountInfo,

    // Instruction arguments
    /// Name of the collection (max 32 bytes)
    pub name: &'a [u8],
    /// URI of the collection (max 200 bytes)
    pub uri: &'a [u8],
    /// Maximum number of items in the collection (0 = unlimited)
    pub max_size: u32,
}

impl CreateCollectionV1<'_> {
    #[inline(always)]
    pub fn invoke(&self) -> ProgramResult {
        self.invoke_signed(&[])
    }

    #[inline(always)]
    pub fn invoke_signed(&self, signers: &[Signer]) -> ProgramResult {
        // Build account metas
        let account_metas = [
            AccountMeta::writable_signer(self.collection.key()),
            AccountMeta::readonly(self.update_authority.key()),
            AccountMeta::writable_signer(self.payer.key()),
            AccountMeta::readonly(self.system_program.key()),
        ];

        // Calculate instruction data size
        // 1 byte discriminator
        // 4 bytes name length
        // name bytes
        // 4 bytes uri length
        // uri bytes
        // 1 byte option discriminator for max_size
        // 4 bytes max_size (if Some)
        // 1 byte (no plugins for now)
        let name_len = self.name.len().min(32);
        let uri_len = self.uri.len().min(200);
        // let _data_len = 1 + 4 + name_len + 4 + uri_len + 1 + 4 + 1; // For reference

        // Allocate instruction data
        let mut instruction_data = [UNINIT_BYTE; 256]; // Max size

        let mut offset = 0;

        // Write discriminator (1 for CreateCollectionV1)
        write_bytes(&mut instruction_data[offset..offset+1], &[1]);
        offset += 1;

        // Write name length and name
        write_bytes(&mut instruction_data[offset..offset+4], &(name_len as u32).to_le_bytes());
        offset += 4;
        write_bytes(&mut instruction_data[offset..offset+name_len], &self.name[..name_len]);
        offset += name_len;

        // Write URI length and URI
        write_bytes(&mut instruction_data[offset..offset+4], &(uri_len as u32).to_le_bytes());
        offset += 4;
        write_bytes(&mut instruction_data[offset..offset+uri_len], &self.uri[..uri_len]);
        offset += uri_len;

        // Write max_size as Option<u32>
        if self.max_size > 0 {
            // Some
            write_bytes(&mut instruction_data[offset..offset+1], &[1]);
            offset += 1;
            write_bytes(&mut instruction_data[offset..offset+4], &self.max_size.to_le_bytes());
            offset += 4;
        } else {
            // None (unlimited)
            write_bytes(&mut instruction_data[offset..offset+1], &[0]);
            offset += 1;
        }

        // Write None for plugins (Option discriminator 0)
        write_bytes(&mut instruction_data[offset..offset+1], &[0]);
        offset += 1;

        let instruction = Instruction {
            program_id: &crate::ID,
            accounts: &account_metas[..4], // Only 4 accounts for collection creation
            data: unsafe { from_raw_parts(instruction_data.as_ptr() as _, offset) },
        };

        // Collect account infos
        let account_infos = [
            self.collection,
            self.update_authority,
            self.payer,
            self.system_program,
        ];

        invoke_signed(&instruction, &account_infos, signers)
    }
}