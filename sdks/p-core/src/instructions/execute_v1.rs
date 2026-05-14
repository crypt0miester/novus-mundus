use core::slice::from_raw_parts;

use pinocchio::{
    cpi::{invoke_signed, Signer},
    instruction::{InstructionAccount, InstructionView},
    AccountView, ProgramResult,
};

use crate::{write_bytes, UNINIT_BYTE};

/// Execute an instruction on behalf of an MPL Core Asset (asset-signed CPI).
///
/// The asset acts as a PDA signer, enabling autonomous asset behaviors.
///
/// ### Accounts:
///   0. `[WRITE]` The asset
///   1. `[WRITE, OPTIONAL]` The collection
///   2. `[WRITE, SIGNER]` The payer
///   3. `[SIGNER, OPTIONAL]` The authority (owner or delegate)
///   4. `[]` The system program
///   5. `[OPTIONAL]` The SPL Noop Program
///   6..N `[]` Additional accounts required by the target instruction
pub struct ExecuteV1<'a> {
    pub asset: &'a AccountView,
    pub collection: &'a AccountView,
    pub payer: &'a AccountView,
    pub authority: &'a AccountView,
    pub system_program: &'a AccountView,
    pub log_wrapper: &'a AccountView,
}

impl ExecuteV1<'_> {
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
            InstructionAccount::readonly(self.system_program.address()),
            InstructionAccount::readonly(self.log_wrapper.address()),
        ];

        let mut instruction_data = [UNINIT_BYTE; 1];
        write_bytes(&mut instruction_data[0..1], &[31]); // ExecuteV1 discriminator

        let instruction = InstructionView {
            program_id: &crate::ID,
            accounts: &account_metas,
            data: unsafe { from_raw_parts(instruction_data.as_ptr() as _, 1) },
        };

        invoke_signed(
            &instruction,
            &[self.asset, self.collection, self.payer, self.authority, self.system_program, self.log_wrapper],
            signers,
        )
    }
}
