use core::slice::from_raw_parts;

use pinocchio::{
    cpi::{invoke_signed, Signer},
    instruction::{InstructionAccount, InstructionView},
    AccountView, ProgramResult,
};

use crate::{write_bytes, UNINIT_BYTE};
use super::update_plugin_v1::PluginUpdateData;

/// Update a plugin on an MPL Core Collection V1.
///
/// ### Accounts:
///   0. `[WRITE]` The collection
///   1. `[WRITE, SIGNER]` The payer
///   2. `[SIGNER, OPTIONAL]` The authority
///   3. `[]` The system program
///   4. `[OPTIONAL]` The SPL Noop Program
pub struct UpdateCollectionPluginV1<'a> {
    pub collection: &'a AccountView,
    pub payer: &'a AccountView,
    pub authority: &'a AccountView,
    pub system_program: &'a AccountView,
    pub log_wrapper: &'a AccountView,
    pub update: PluginUpdateData<'a>,
}

impl UpdateCollectionPluginV1<'_> {
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

        let mut instruction_data = [UNINIT_BYTE; 1024];
        let mut offset = 0;

        // Discriminator (7 for UpdateCollectionPluginV1)
        write_bytes(&mut instruction_data[offset..offset+1], &[7]);
        offset += 1;

        offset = super::update_plugin_v1::write_plugin_update_data(&mut instruction_data, offset, &self.update);

        let instruction = InstructionView {
            program_id: &crate::ID,
            accounts: &account_metas,
            data: unsafe { from_raw_parts(instruction_data.as_ptr() as _, offset) },
        };

        invoke_signed(
            &instruction,
            &[self.collection, self.payer, self.authority, self.system_program, self.log_wrapper],
            signers,
        )
    }
}
