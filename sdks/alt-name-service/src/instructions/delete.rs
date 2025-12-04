use pinocchio::{
    account_info::AccountInfo,
    instruction::{AccountMeta, Instruction, Signer},
    program::invoke_signed,
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
    pub owner: &'a AccountInfo,
    pub name_account: &'a AccountInfo,
    pub refund_target: &'a AccountInfo,
    pub name_class: &'a AccountInfo,
    pub parent_name: &'a AccountInfo,
    pub hashed_name: [u8; 32],
}

impl<'a> Delete<'a> {
    #[inline(always)]
    pub fn invoke(&self) -> ProgramResult {
        self.invoke_signed(&[])
    }

    #[inline(always)]
    pub fn invoke_signed(&self, signers: &[Signer]) -> ProgramResult {
        let account_metas: [AccountMeta; 5] = [
            AccountMeta::readonly_signer(self.owner.key()),
            AccountMeta::writable(self.name_account.key()),
            AccountMeta::writable(self.refund_target.key()),
            AccountMeta::readonly(self.name_class.key()),
            AccountMeta::readonly(self.parent_name.key()),
        ];

        // discriminator (8) + hashed_name (32) = 40
        let mut data = [0u8; 40];
        data[0..8].copy_from_slice(&DELETE_DISCRIMINATOR);
        data[8..40].copy_from_slice(&self.hashed_name);

        let instruction = Instruction {
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
