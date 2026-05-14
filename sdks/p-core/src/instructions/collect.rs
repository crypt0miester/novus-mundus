use core::slice::from_raw_parts;

use pinocchio::{
    cpi::{invoke_signed, Signer},
    instruction::{InstructionAccount, InstructionView},
    AccountView, ProgramResult,
};

use crate::{write_bytes, UNINIT_BYTE};

/// Collect fees from an MPL Core account.
///
/// ### Accounts:
///   0. `[WRITE]` The account to collect from
///   1. `[WRITE]` The recipient of the collected fees
pub struct Collect<'a> {
    pub account: &'a AccountView,
    pub recipient: &'a AccountView,
}

impl Collect<'_> {
    #[inline(always)]
    pub fn invoke(&self) -> ProgramResult {
        self.invoke_signed(&[])
    }

    #[inline(always)]
    pub fn invoke_signed(&self, signers: &[Signer]) -> ProgramResult {
        let account_metas = [
            InstructionAccount::writable(self.account.address()),
            InstructionAccount::writable(self.recipient.address()),
        ];

        let mut instruction_data = [UNINIT_BYTE; 1];
        write_bytes(&mut instruction_data[0..1], &[19]); // Collect discriminator

        let instruction = InstructionView {
            program_id: &crate::ID,
            accounts: &account_metas,
            data: unsafe { from_raw_parts(instruction_data.as_ptr() as _, 1) },
        };

        invoke_signed(
            &instruction,
            &[self.account, self.recipient],
            signers,
        )
    }
}
