use pinocchio::{
    account_info::AccountInfo,
    instruction::{AccountMeta, Instruction, Signer},
    program::invoke_signed,
    ProgramResult,
};

use crate::UPDATE_DISCRIMINATOR;

/// Update data in a name record.
///
/// ### Accounts:
///   0. `[SIGNER]` Owner
///   1. `[WRITE]` Name account (PDA)
///   2. `[]` Name class account
///   3. `[]` Parent name account
pub struct Update<'a, 'b> {
    pub owner: &'a AccountInfo,
    pub name_account: &'a AccountInfo,
    pub name_class: &'a AccountInfo,
    pub parent_name: &'a AccountInfo,
    pub hashed_name: [u8; 32],
    pub offset: u32,
    pub input_data: &'b [u8],
}

impl<'a, 'b> Update<'a, 'b> {
    #[inline(always)]
    pub fn invoke(&self) -> ProgramResult {
        self.invoke_signed(&[])
    }

    /// Invoke with pre-allocated buffer for instruction data.
    /// Buffer must be at least 48 + input_data.len() bytes.
    pub fn invoke_signed_with_buffer(
        &self,
        signers: &[Signer],
        buffer: &mut [u8],
    ) -> ProgramResult {
        let account_metas: [AccountMeta; 4] = [
            AccountMeta::readonly_signer(self.owner.key()),
            AccountMeta::writable(self.name_account.key()),
            AccountMeta::readonly(self.name_class.key()),
            AccountMeta::readonly(self.parent_name.key()),
        ];

        // discriminator (8) + hashed_name (32) + offset (4) + data_len (4) + data
        let required_len = 48 + self.input_data.len();
        let instruction_data = &mut buffer[..required_len];

        instruction_data[0..8].copy_from_slice(&UPDATE_DISCRIMINATOR);
        instruction_data[8..40].copy_from_slice(&self.hashed_name);
        instruction_data[40..44].copy_from_slice(&self.offset.to_le_bytes());
        instruction_data[44..48].copy_from_slice(&(self.input_data.len() as u32).to_le_bytes());
        instruction_data[48..].copy_from_slice(self.input_data);

        let instruction = Instruction {
            program_id: &crate::ID,
            accounts: &account_metas,
            data: instruction_data,
        };

        invoke_signed(
            &instruction,
            &[self.owner, self.name_account, self.name_class, self.parent_name],
            signers,
        )
    }
}

impl<'a> Update<'a, '_> {
    /// Simple invoke without data (just updates hashed_name validation).
    #[inline(always)]
    pub fn invoke_signed(&self, signers: &[Signer]) -> ProgramResult {
        let account_metas: [AccountMeta; 4] = [
            AccountMeta::readonly_signer(self.owner.key()),
            AccountMeta::writable(self.name_account.key()),
            AccountMeta::readonly(self.name_class.key()),
            AccountMeta::readonly(self.parent_name.key()),
        ];

        // discriminator (8) + hashed_name (32) + offset (4) + data_len (4) = 48
        let mut data = [0u8; 48];
        data[0..8].copy_from_slice(&UPDATE_DISCRIMINATOR);
        data[8..40].copy_from_slice(&self.hashed_name);
        data[40..44].copy_from_slice(&self.offset.to_le_bytes());
        // data_len = 0

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
