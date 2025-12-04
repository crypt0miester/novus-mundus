use pinocchio::{
    account_info::AccountInfo,
    instruction::{AccountMeta, Instruction, Signer},
    program::invoke_signed,
    pubkey::Pubkey,
    ProgramResult,
};

use crate::TRANSFER_DISCRIMINATOR;

/// Transfer ownership of a name record.
///
/// ### Accounts:
///   0. `[SIGNER]` Owner
///   1. `[WRITE]` Name account (PDA)
///   2. `[]` Name class account
///   3. `[]` Parent name account
pub struct Transfer<'a> {
    pub owner: &'a AccountInfo,
    pub name_account: &'a AccountInfo,
    pub name_class: &'a AccountInfo,
    pub parent_name: &'a AccountInfo,
    pub hashed_name: [u8; 32],
    pub new_owner: &'a Pubkey,
}

impl<'a> Transfer<'a> {
    #[inline(always)]
    pub fn invoke(&self) -> ProgramResult {
        self.invoke_signed(&[])
    }

    #[inline(always)]
    pub fn invoke_signed(&self, signers: &[Signer]) -> ProgramResult {
        let account_metas: [AccountMeta; 4] = [
            AccountMeta::readonly_signer(self.owner.key()),
            AccountMeta::writable(self.name_account.key()),
            AccountMeta::readonly(self.name_class.key()),
            AccountMeta::readonly(self.parent_name.key()),
        ];

        // discriminator (8) + hashed_name (32) + new_owner (32) = 72
        let mut data = [0u8; 72];
        data[0..8].copy_from_slice(&TRANSFER_DISCRIMINATOR);
        data[8..40].copy_from_slice(&self.hashed_name);
        data[40..72].copy_from_slice(self.new_owner);

        let instruction = Instruction {
            program_id: &crate::ID,
            accounts: &account_metas,
            data: &data,
        };

        invoke_signed(
            &instruction,
            &[self.owner, self.name_account, self.name_class, self.parent_name],
            signers,
        )
    }
}
