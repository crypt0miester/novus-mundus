use pinocchio::{
    AccountView,
    instruction::{InstructionAccount, InstructionView}, cpi::Signer,
    cpi::invoke_signed,
    ProgramResult,
};

use crate::DELETE_DISCRIMINATOR;

/// Delete a name record.
///
/// ### Accounts:
///   0. `[SIGNER]` Owner
///   1. `[WRITE]` Name account (PDA)
///   2. `[WRITE]` Refund target
///   3. `[]` Name class account
///   4. `[]` Parent name account
pub struct Delete<'a> {
    pub owner: &'a AccountView,
    pub name_account: &'a AccountView,
    pub refund_target: &'a AccountView,
    pub name_class: &'a AccountView,
    pub parent_name: &'a AccountView,
    pub hashed_name: [u8; 32],
}

impl<'a> Delete<'a> {
    #[inline(always)]
    pub fn invoke(&self) -> ProgramResult {
        self.invoke_signed(&[])
    }

    #[inline(always)]
    pub fn invoke_signed(&self, signers: &[Signer]) -> ProgramResult {
        let account_metas: [InstructionAccount; 5] = [
            InstructionAccount::readonly_signer(self.owner.address()),
            InstructionAccount::writable(self.name_account.address()),
            InstructionAccount::writable(self.refund_target.address()),
            InstructionAccount::readonly(self.name_class.address()),
            InstructionAccount::readonly(self.parent_name.address()),
        ];

        // discriminator (8) + hashed_name (32) = 40
        let mut data = [0u8; 40];
        data[0..8].copy_from_slice(&DELETE_DISCRIMINATOR);
        data[8..40].copy_from_slice(&self.hashed_name);

        let instruction = InstructionView {
            program_id: &crate::ID,
            accounts: &account_metas,
            data: &data,
        };

        invoke_signed(
            &instruction,
            &[
                self.owner,
                self.name_account,
                self.refund_target,
                self.name_class,
                self.parent_name,
            ],
            signers,
        )
    }
}
