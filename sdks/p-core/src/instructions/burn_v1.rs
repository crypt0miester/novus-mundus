use core::slice::from_raw_parts;

use pinocchio::{
    account_info::AccountInfo,
    instruction::{AccountMeta, Instruction, Signer},
    program::invoke_signed,
    ProgramResult,
};

use crate::{write_bytes, UNINIT_BYTE};

/// Burn an MPL Core Asset V1.
///
/// ### Accounts:
///   0. `[WRITE]` The asset to burn
///   1. `[WRITE, OPTIONAL]` The collection to which the asset belongs
///   2. `[WRITE, SIGNER]` The account paying for the storage fees
///   3. `[SIGNER, OPTIONAL]` The authority (owner or burn delegate)
///   4. `[]` The system program
///   5. `[OPTIONAL]` The SPL Noop Program
pub struct BurnV1<'a> {
    /// The asset to burn
    pub asset: &'a AccountInfo,
    /// The collection to which the asset belongs (pass zero pubkey for None)
    pub collection: &'a AccountInfo,
    /// The account paying for the storage fees (receives rent back)
    pub payer: &'a AccountInfo,
    /// The authority (owner or burn delegate) signing the burn (pass zero pubkey for None)
    pub authority: &'a AccountInfo,
    /// The system program
    pub system_program: &'a AccountInfo,
    /// The SPL Noop Program (pass zero pubkey for None)
    pub log_wrapper: &'a AccountInfo,
}

impl BurnV1<'_> {
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

        // Allocate instruction data
        // 1 byte discriminator
        // 1 byte option for compression proof (None)
        let mut instruction_data = [UNINIT_BYTE; 2];

        let mut offset = 0;

        // Write discriminator (12 for BurnV1)
        write_bytes(&mut instruction_data[offset..offset+1], &[12]);
        offset += 1;

        // Write None for compression proof (Option discriminator 0)
        write_bytes(&mut instruction_data[offset..offset+1], &[0]);
        offset += 1;

        let instruction = Instruction {
            program_id: &crate::ID,
            accounts: &account_metas[..6], // 6 accounts for burn
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