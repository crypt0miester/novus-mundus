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
/// ### Accounts (official MPL Core layout):
///   0. `[WRITE]` The asset to transfer
///   1. `[OPTIONAL]` The collection to which the asset belongs
///   2. `[WRITE, SIGNER]` The payer
///   3. `[SIGNER, OPTIONAL]` The authority (owner or delegate)
///   4. `[]` The new owner to transfer to
///   5. `[OPTIONAL]` The system program
///   6. `[OPTIONAL]` The SPL Noop Program (log wrapper)
pub struct TransferV1<'a> {
    /// The asset to transfer
    pub asset: &'a AccountInfo,
    /// The collection to which the asset belongs (use program_id for None)
    pub collection: &'a AccountInfo,
    /// The account paying for any fees
    pub payer: &'a AccountInfo,
    /// The authority (owner or delegate) signing the transfer
    pub authority: &'a AccountInfo,
    /// The new owner to transfer to
    pub new_owner: &'a AccountInfo,
    /// The system program
    pub system_program: &'a AccountInfo,
    /// The SPL Noop Program (pass p_core program ID for None)
    pub log_wrapper: &'a AccountInfo,
}

impl TransferV1<'_> {
    #[inline(always)]
    pub fn invoke(&self) -> ProgramResult {
        self.invoke_signed(&[])
    }

    #[inline(always)]
    pub fn invoke_signed(&self, signers: &[Signer]) -> ProgramResult {
        // Build account metas matching official MPL Core TransferV1 layout
        // log_wrapper (index 6) is optional — pass system_program as placeholder
        let account_metas = [
            AccountMeta::writable(self.asset.key()),            // 0: asset
            AccountMeta::readonly(self.collection.key()),        // 1: collection
            AccountMeta::writable_signer(self.payer.key()),      // 2: payer
            AccountMeta::readonly_signer(self.authority.key()),  // 3: authority
            AccountMeta::readonly(self.new_owner.key()),         // 4: newOwner
            AccountMeta::readonly(self.system_program.key()),    // 5: systemProgram
            AccountMeta::readonly(self.log_wrapper.key()),        // 6: logWrapper
        ];

        let mut instruction_data = [UNINIT_BYTE; 2];
        let mut offset = 0;

        // Discriminator (14 for TransferV1)
        write_bytes(&mut instruction_data[offset..offset+1], &[14]);
        offset += 1;

        // No compression proof
        write_bytes(&mut instruction_data[offset..offset+1], &[0]);
        offset += 1;

        let instruction = Instruction {
            program_id: &crate::ID,
            accounts: &account_metas,
            data: unsafe { from_raw_parts(instruction_data.as_ptr() as _, offset) },
        };

        let account_infos = [
            self.asset,
            self.collection,
            self.payer,
            self.authority,
            self.new_owner,
            self.system_program,
            self.log_wrapper,
        ];

        invoke_signed(&instruction, &account_infos, signers)
    }
}
