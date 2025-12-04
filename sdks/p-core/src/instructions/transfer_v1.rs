use core::slice::from_raw_parts;

use pinocchio::{
    account_info::AccountInfo,
    instruction::{AccountMeta, Instruction, Signer},
    program::invoke_signed,
    ProgramResult,
};

use crate::{write_bytes, UNINIT_BYTE};

/// Transfer an MPL Core Asset V1.
///
/// ### Accounts:
///   0. `[WRITE]` The asset to transfer
///   1. `[WRITE, OPTIONAL]` The collection to which the asset belongs
///   2. `[WRITE]` The current owner of the asset
///   3. `[WRITE]` The new owner to transfer to
///   4. `[WRITE, SIGNER]` The account paying for the storage fees
///   5. `[SIGNER, OPTIONAL]` The authority (owner or delegate)
///   6. `[]` The system program
///   7. `[OPTIONAL]` The SPL Noop Program
pub struct TransferV1<'a> {
    /// The asset to transfer
    pub asset: &'a AccountInfo,
    /// The collection to which the asset belongs (use program_id for None)
    pub collection: &'a AccountInfo,
    /// The current owner of the asset
    pub current_owner: &'a AccountInfo,
    /// The new owner to transfer to
    pub new_owner: &'a AccountInfo,
    /// The account paying for any fees
    pub payer: &'a AccountInfo,
    /// The authority (owner or delegate) signing the transfer (use program_id for None)
    pub authority: &'a AccountInfo,
    /// The system program
    pub system_program: &'a AccountInfo,
}

impl TransferV1<'_> {
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
            AccountMeta::writable(self.current_owner.key()),
            AccountMeta::writable(self.new_owner.key()),
            AccountMeta::writable_signer(self.payer.key()),
            AccountMeta::readonly_signer(self.authority.key()),
            AccountMeta::readonly(self.system_program.key()),
        ];

        // Allocate instruction data
        // 1 byte discriminator
        // 1 byte for compression proof flag (0 = None)
        let mut instruction_data = [UNINIT_BYTE; 2];

        let mut offset = 0;

        // Write discriminator (14 for TransferV1)
        write_bytes(&mut instruction_data[offset..offset+1], &[14]);
        offset += 1;

        // Write 0 for no compression proof
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
            self.current_owner,
            self.new_owner,
            self.payer,
            self.authority,
            self.system_program,
        ];

        invoke_signed(&instruction, &account_infos, signers)
    }
}