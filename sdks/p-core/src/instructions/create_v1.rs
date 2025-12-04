use core::slice::from_raw_parts;

use pinocchio::{
    account_info::AccountInfo,
    instruction::{AccountMeta, Instruction, Signer},
    program::invoke_signed,
    ProgramResult,
};

use crate::{write_bytes, UNINIT_BYTE};

/// Data state for asset creation
#[repr(u8)]
#[derive(Copy, Clone, Debug)]
pub enum DataState {
    /// The data is stored in account state.
    AccountState = 0,
    /// The data is stored in the ledger history (compressed).
    LedgerState = 1,
}

/// Create a new MPL Core Asset V1.
///
/// ### Accounts:
///   0. `[WRITE, SIGNER]` The address of the new asset
///   1. `[WRITE, OPTIONAL]` The collection to which the asset belongs
///   2. `[SIGNER, OPTIONAL]` The authority signing for creation
///   3. `[WRITE, SIGNER]` The account paying for the storage fees
///   4. `[OPTIONAL]` The owner of the new asset. Defaults to the authority if not present.
///   5. `[OPTIONAL]` The authority on the new asset
///   6. `[]` The system program
///   7. `[OPTIONAL]` The SPL Noop Program
pub struct CreateV1<'a> {
    /// The address of the new asset
    pub asset: &'a AccountInfo,
    /// The collection to which the asset belongs (pass zero pubkey for None)
    pub collection: &'a AccountInfo,
    /// The authority signing for creation (pass zero pubkey for None)
    pub authority: &'a AccountInfo,
    /// The account paying for the storage fees
    pub payer: &'a AccountInfo,
    /// The owner of the new asset (pass zero pubkey for None)
    pub owner: &'a AccountInfo,
    /// The update authority on the new asset (pass zero pubkey for None)
    pub update_authority: &'a AccountInfo,
    /// The system program
    pub system_program: &'a AccountInfo,

    // Instruction arguments
    /// Data state (account state or ledger state for compression)
    pub data_state: DataState,
    /// Name of the asset (max 32 bytes)
    pub name: &'a [u8],
    /// URI of the asset (max 200 bytes)
    pub uri: &'a [u8],
}

impl CreateV1<'_> {
    #[inline(always)]
    pub fn invoke(&self) -> ProgramResult {
        self.invoke_signed(&[])
    }

    #[inline(always)]
    pub fn invoke_signed(&self, signers: &[Signer]) -> ProgramResult {
        // Build account metas
        let account_metas = [
            AccountMeta::writable_signer(self.asset.key()),
            AccountMeta::writable(self.collection.key()),
            AccountMeta::readonly_signer(self.authority.key()),
            AccountMeta::writable_signer(self.payer.key()),
            AccountMeta::readonly(self.owner.key()),
            AccountMeta::readonly(self.update_authority.key()),
            AccountMeta::readonly(self.system_program.key()),
        ];

        // Calculate instruction data size
        // 1 byte discriminator
        // 1 byte data_state
        // 4 bytes name length
        // name bytes
        // 4 bytes uri length
        // uri bytes
        // 1 byte (no plugins for now)
        let name_len = self.name.len().min(32);
        let uri_len = self.uri.len().min(200);

        // Allocate instruction data
        let mut instruction_data = [UNINIT_BYTE; 256]; // Max size

        let mut offset = 0;

        // Write discriminator (0 for CreateV1)
        write_bytes(&mut instruction_data[offset..offset+1], &[0]);
        offset += 1;

        // Write data_state
        write_bytes(&mut instruction_data[offset..offset+1], &[self.data_state as u8]);
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

        // Write None for plugins (discriminator 0)
        write_bytes(&mut instruction_data[offset..offset+1], &[0]);
        offset += 1;

        let instruction = Instruction {
            program_id: &crate::ID,
            accounts: &account_metas,
            data: unsafe { from_raw_parts(instruction_data.as_ptr() as _, offset) },
        };

        // Collect account infos
        let account_infos = [
            self.asset,
            self.collection,
            self.authority,
            self.payer,
            self.owner,
            self.update_authority,
            self.system_program,
        ];

        invoke_signed(&instruction, &account_infos, signers)
    }
}