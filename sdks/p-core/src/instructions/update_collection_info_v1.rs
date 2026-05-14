use core::slice::from_raw_parts;

use pinocchio::{
    cpi::{invoke_signed, Signer},
    instruction::{InstructionAccount, InstructionView},
    AccountView, ProgramResult,
};

use crate::{write_bytes, UNINIT_BYTE};

/// Update collection info on an MPL Core Collection V1 (Bubblegum integration).
///
/// ### Accounts:
///   0. `[WRITE]` The collection
///   1. `[WRITE, SIGNER]` The payer
///   2. `[SIGNER, OPTIONAL]` The authority (Bubblegum program)
///   3. `[OPTIONAL]` The new update authority
///   4. `[]` The system program
///   5. `[OPTIONAL]` The SPL Noop Program
pub struct UpdateCollectionInfoV1<'a> {
    pub collection: &'a AccountView,
    pub payer: &'a AccountView,
    pub authority: &'a AccountView,
    pub new_update_authority: &'a AccountView,
    pub system_program: &'a AccountView,
    pub log_wrapper: &'a AccountView,
    /// Pre-serialized Borsh args for `UpdateCollectionInfoV1Args`.
    pub args: &'a [u8],
}

impl UpdateCollectionInfoV1<'_> {
    #[inline(always)]
    pub fn invoke(&self) -> ProgramResult {
        self.invoke_signed(&[])
    }

    #[inline(always)]
    pub fn invoke_signed(&self, signers: &[Signer]) -> ProgramResult {
        let account_metas = [
            InstructionAccount::writable(self.collection.address()),
            InstructionAccount::writable_signer(self.payer.address()),
            InstructionAccount::readonly_signer(self.authority.address()),
            InstructionAccount::readonly(self.new_update_authority.address()),
            InstructionAccount::readonly(self.system_program.address()),
            InstructionAccount::readonly(self.log_wrapper.address()),
        ];

        let len = 1 + self.args.len();
        let mut instruction_data = [UNINIT_BYTE; 512];
        write_bytes(&mut instruction_data[0..1], &[32]); // UpdateCollectionInfoV1 discriminator
        write_bytes(&mut instruction_data[1..len], self.args);

        let instruction = InstructionView {
            program_id: &crate::ID,
            accounts: &account_metas,
            data: unsafe { from_raw_parts(instruction_data.as_ptr() as _, len) },
        };

        invoke_signed(
            &instruction,
            &[self.collection, self.payer, self.authority, self.new_update_authority, self.system_program, self.log_wrapper],
            signers,
        )
    }
}
