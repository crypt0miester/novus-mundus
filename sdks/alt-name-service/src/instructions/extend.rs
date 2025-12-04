use pinocchio::{
    account_info::AccountInfo,
    instruction::{AccountMeta, Instruction, Signer},
    program::invoke_signed,
    ProgramResult,
};

use crate::EXTEND_DISCRIMINATOR;

/// Extend expiry of a name record.
///
/// ### Accounts:
///   0. `[]` Owner
///   1. `[SIGNER]` Parent name owner
///   2. `[WRITE]` Name account (PDA)
///   3. `[]` Name class account
///   4. `[]` Parent name account
pub struct Extend<'a> {
    pub owner: &'a AccountInfo,
    pub parent_name_owner: &'a AccountInfo,
    pub name_account: &'a AccountInfo,
    pub name_class: &'a AccountInfo,
    pub parent_name: &'a AccountInfo,
    pub hashed_name: [u8; 32],
    pub expires_at: u64,
}

impl<'a> Extend<'a> {
    #[inline(always)]
    pub fn invoke(&self) -> ProgramResult {
        self.invoke_signed(&[])
    }

    #[inline(always)]
    pub fn invoke_signed(&self, signers: &[Signer]) -> ProgramResult {
        let account_metas: [AccountMeta; 5] = [
            AccountMeta::readonly(self.owner.key()),
            AccountMeta::readonly_signer(self.parent_name_owner.key()),
            AccountMeta::writable(self.name_account.key()),
            AccountMeta::readonly(self.name_class.key()),
            AccountMeta::readonly(self.parent_name.key()),
        ];

        // discriminator (8) + hashed_name (32) + expires_at (8) = 48
        let mut data = [0u8; 48];
        data[0..8].copy_from_slice(&EXTEND_DISCRIMINATOR);
        data[8..40].copy_from_slice(&self.hashed_name);
        data[40..48].copy_from_slice(&self.expires_at.to_le_bytes());

        let instruction = Instruction {
            program_id: &crate::ID,
            accounts: &account_metas,
            data: &data,
        };

        invoke_signed(
            &instruction,
            &[
                self.owner,
                self.parent_name_owner,
                self.name_account,
                self.name_class,
                self.parent_name,
            ],
            signers,
        )
    }
}
