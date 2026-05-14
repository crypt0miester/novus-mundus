use core::slice::from_raw_parts;

use pinocchio::{
    cpi::{invoke_signed, Signer},
    instruction::{InstructionAccount, InstructionView},
    AccountView, ProgramResult,
};

use crate::{write_bytes, UNINIT_BYTE};

/// Burn an MPL Core Collection V1.
///
/// ### Accounts:
///   0. `[WRITE]` The collection to burn
///   1. `[WRITE, SIGNER]` The payer
///   2. `[SIGNER, OPTIONAL]` The authority (owner or delegate)
///   3. `[OPTIONAL]` The SPL Noop Program
pub struct BurnCollectionV1<'a> {
    pub collection: &'a AccountView,
    pub payer: &'a AccountView,
    pub authority: &'a AccountView,
    pub log_wrapper: &'a AccountView,
}

impl BurnCollectionV1<'_> {
    #[inline(always)]
    pub fn invoke(&self) -> ProgramResult {
        self.invoke_signed(&[])
    }

    #[inline(always)]
    pub fn invoke_signed(&self, signers: &[Signer]) -> ProgramResult {
        let account_metas = [
            InstructionAccount::writable(self.collection.address()),
            InstructionAccount::writable_signer(self.payer.address()),
            InstructionAccount::readonly_signer(self.authority.address()),
            InstructionAccount::readonly(self.log_wrapper.address()),
        ];

        let mut instruction_data = [UNINIT_BYTE; 2];
        write_bytes(&mut instruction_data[0..1], &[13]); // BurnCollectionV1 discriminator
        write_bytes(&mut instruction_data[1..2], &[0]);  // No compression proof

        let instruction = InstructionView {
            program_id: &crate::ID,
            accounts: &account_metas,
            data: unsafe { from_raw_parts(instruction_data.as_ptr() as _, 2) },
        };

        invoke_signed(
            &instruction,
            &[self.collection, self.payer, self.authority, self.log_wrapper],
            signers,
        )
    }
}
