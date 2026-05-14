use core::slice::from_raw_parts;

use pinocchio::{
    cpi::{invoke_signed, Signer},
    instruction::{InstructionAccount, InstructionView},
    AccountView, ProgramResult,
};

use crate::{write_bytes, UNINIT_BYTE, plugins::PluginType};

/// Revoke a plugin authority on an MPL Core Collection V1.
///
/// ### Accounts:
///   0. `[WRITE]` The collection
///   1. `[WRITE, SIGNER]` The payer
///   2. `[SIGNER, OPTIONAL]` The authority
///   3. `[]` The system program
///   4. `[OPTIONAL]` The SPL Noop Program
pub struct RevokeCollectionPluginAuthorityV1<'a> {
    pub collection: &'a AccountView,
    pub payer: &'a AccountView,
    pub authority: &'a AccountView,
    pub system_program: &'a AccountView,
    pub log_wrapper: &'a AccountView,
    pub plugin_type: PluginType,
}

impl RevokeCollectionPluginAuthorityV1<'_> {
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
            InstructionAccount::readonly(self.system_program.address()),
            InstructionAccount::readonly(self.log_wrapper.address()),
        ];

        let mut instruction_data = [UNINIT_BYTE; 2];
        write_bytes(&mut instruction_data[0..1], &[11]); // RevokeCollectionPluginAuthorityV1 discriminator
        write_bytes(&mut instruction_data[1..2], &[self.plugin_type as u8]);

        let instruction = InstructionView {
            program_id: &crate::ID,
            accounts: &account_metas,
            data: unsafe { from_raw_parts(instruction_data.as_ptr() as _, 2) },
        };

        invoke_signed(
            &instruction,
            &[self.collection, self.payer, self.authority, self.system_program, self.log_wrapper],
            signers,
        )
    }
}
