use pinocchio::{
    account_info::AccountInfo,
    instruction::{AccountMeta, Instruction, Signer},
    program::invoke_signed,
    ProgramResult,
};

use crate::CREATE_DISCRIMINATOR;

/// Create a new name record.
///
/// ### Accounts:
///   0. `[WRITE, SIGNER]` Payer
///   1. `[]` Name owner
///   2. `[WRITE]` Name account (PDA)
///   3. `[]` Name class account
///   4. `[]` Parent name account
///   5. `[SIGNER]` Parent name owner (if parent exists)
///   6. `[]` System program
pub struct Create<'a> {
    pub payer: &'a AccountInfo,
    pub name_owner: &'a AccountInfo,
    pub name_account: &'a AccountInfo,
    pub name_class: &'a AccountInfo,
    pub parent_name: &'a AccountInfo,
    pub parent_name_owner: &'a AccountInfo,
    pub system_program: &'a AccountInfo,
    pub hashed_name: [u8; 32],
    pub space: u32,
    pub expires_at: u64,
}

impl<'a> Create<'a> {
    #[inline(always)]
    pub fn invoke(&self) -> ProgramResult {
        self.invoke_signed(&[])
    }

    #[inline(always)]
    pub fn invoke_signed(&self, signers: &[Signer]) -> ProgramResult {
        let account_metas: [AccountMeta; 7] = [
            AccountMeta::writable_signer(self.payer.key()),
            AccountMeta::readonly(self.name_owner.key()),
            AccountMeta::writable(self.name_account.key()),
            AccountMeta::readonly(self.name_class.key()),
            AccountMeta::readonly(self.parent_name.key()),
            AccountMeta::readonly_signer(self.parent_name_owner.key()),
            AccountMeta::readonly(self.system_program.key()),
        ];

        // discriminator (8) + hashed_name (32) + space (4) + expires_at (8) = 52
        let mut data = [0u8; 52];
        data[0..8].copy_from_slice(&CREATE_DISCRIMINATOR);
        data[8..40].copy_from_slice(&self.hashed_name);
        data[40..44].copy_from_slice(&self.space.to_le_bytes());
        data[44..52].copy_from_slice(&self.expires_at.to_le_bytes());

        let instruction = Instruction {
            program_id: &crate::ID,
            accounts: &account_metas,
            data: &data,
        };

        invoke_signed(
            &instruction,
            &[
                self.payer,
                self.name_owner,
                self.name_account,
                self.name_class,
                self.parent_name,
                self.parent_name_owner,
                self.system_program,
            ],
            signers,
        )
    }
}
