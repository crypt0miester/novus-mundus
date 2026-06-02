use pinocchio::{
    AccountView,
    instruction::{InstructionAccount, InstructionView}, cpi::Signer,
    cpi::invoke_signed,
    Address,
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
    pub owner: &'a AccountView,
    pub name_account: &'a AccountView,
    pub name_class: &'a AccountView,
    pub parent_name: &'a AccountView,
    pub hashed_name: [u8; 32],
    /// Canonical bump of the name_account PDA. Anchor verifies its
    /// `seeds=[hashed_name, name_class, parent_name], bump=name_account_bump`
    /// constraint against this exact value, so it must be the canonical bump.
    pub name_account_bump: u8,
    pub new_owner: &'a Address,
}

impl<'a> Transfer<'a> {
    #[inline(always)]
    pub fn invoke(&self) -> ProgramResult {
        self.invoke_signed(&[])
    }

    #[inline(always)]
    pub fn invoke_signed(&self, signers: &[Signer]) -> ProgramResult {
        // ANS `transfer` declares `#[account(mut)] owner: Signer`, so the owner
        // meta must be a writable signer (the program is the fee payer there).
        let account_metas: [InstructionAccount; 4] = [
            InstructionAccount::writable_signer(self.owner.address()),
            InstructionAccount::writable(self.name_account.address()),
            InstructionAccount::readonly(self.name_class.address()),
            InstructionAccount::readonly(self.parent_name.address()),
        ];

        // Anchor `transfer(_hashed_name: Vec<u8>, _name_account_bump: u8, new_owner: Pubkey)`:
        // disc(8) + borsh Vec<u8> [len:u32(4) + 32 bytes] + bump(1) + new_owner(32) = 77.
        // The Vec<u8> length prefix is mandatory — without it Anchor reads the first
        // four hash bytes as the length and tries a multi-GB allocation (OOM panic).
        let mut data = [0u8; 77];
        data[0..8].copy_from_slice(&TRANSFER_DISCRIMINATOR);
        data[8..12].copy_from_slice(&32u32.to_le_bytes());
        data[12..44].copy_from_slice(&self.hashed_name);
        data[44] = self.name_account_bump;
        data[45..77].copy_from_slice(self.new_owner.as_ref());

        let instruction = InstructionView {
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
