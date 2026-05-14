use pinocchio::{
    AccountView,
    instruction::{InstructionAccount, InstructionView}, cpi::Signer,
    cpi::invoke_signed,
    ProgramResult,
};

use crate::IMMUTABLE_OWNER_DISCRIMINATOR;

/// Set a name record as non-transferable (soulbound).
///
/// ### Accounts:
///   0. `[]` Owner
///   1. `[SIGNER]` Parent name owner
///   2. `[WRITE]` Name account (PDA)
///   3. `[]` Name class account
///   4. `[]` Parent name account
pub struct ImmutableOwner<'a> {
    pub owner: &'a AccountView,
    pub parent_name_owner: &'a AccountView,
    pub name_account: &'a AccountView,
    pub name_class: &'a AccountView,
    pub parent_name: &'a AccountView,
    pub hashed_name: [u8; 32],
}

impl<'a> ImmutableOwner<'a> {
    #[inline(always)]
    pub fn invoke(&self) -> ProgramResult {
        self.invoke_signed(&[])
    }

    #[inline(always)]
    pub fn invoke_signed(&self, signers: &[Signer]) -> ProgramResult {
        let account_metas: [InstructionAccount; 5] = [
            InstructionAccount::readonly(self.owner.address()),
            InstructionAccount::readonly_signer(self.parent_name_owner.address()),
            InstructionAccount::writable(self.name_account.address()),
            InstructionAccount::readonly(self.name_class.address()),
            InstructionAccount::readonly(self.parent_name.address()),
        ];

        // discriminator (8) + hashed_name (32) = 40
        let mut data = [0u8; 40];
        data[0..8].copy_from_slice(&IMMUTABLE_OWNER_DISCRIMINATOR);
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
                self.parent_name_owner,
                self.name_account,
                self.name_class,
                self.parent_name,
            ],
            signers,
        )
    }
}
