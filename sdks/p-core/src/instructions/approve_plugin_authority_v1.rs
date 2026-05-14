use core::slice::from_raw_parts;

use pinocchio::{
    cpi::{invoke_signed, Signer},
    instruction::{InstructionAccount, InstructionView},
    AccountView, ProgramResult,
};

use crate::{write_bytes, UNINIT_BYTE, plugins::{PluginType, PluginAuthority}};

/// Approve a plugin authority on an MPL Core Asset V1.
///
/// ### Accounts:
///   0. `[WRITE]` The asset
///   1. `[WRITE, OPTIONAL]` The collection
///   2. `[WRITE, SIGNER]` The payer
///   3. `[SIGNER, OPTIONAL]` The authority (owner or delegate)
///   4. `[]` The system program
///   5. `[OPTIONAL]` The SPL Noop Program
pub struct ApprovePluginAuthorityV1<'a> {
    pub asset: &'a AccountView,
    pub collection: &'a AccountView,
    pub payer: &'a AccountView,
    pub authority: &'a AccountView,
    pub system_program: &'a AccountView,
    pub log_wrapper: &'a AccountView,
    pub plugin_type: PluginType,
    pub new_authority: PluginAuthority,
}

impl ApprovePluginAuthorityV1<'_> {
    #[inline(always)]
    pub fn invoke(&self) -> ProgramResult {
        self.invoke_signed(&[])
    }

    #[inline(always)]
    pub fn invoke_signed(&self, signers: &[Signer]) -> ProgramResult {
        let account_metas = [
            InstructionAccount::writable(self.asset.address()),
            InstructionAccount::writable(self.collection.address()),
            InstructionAccount::writable_signer(self.payer.address()),
            InstructionAccount::readonly_signer(self.authority.address()),
            InstructionAccount::readonly(self.system_program.address()),
            InstructionAccount::readonly(self.log_wrapper.address()),
        ];

        let mut instruction_data = [UNINIT_BYTE; 36];
        let mut offset = 0;

        // Discriminator (8 for ApprovePluginAuthorityV1)
        write_bytes(&mut instruction_data[offset..offset+1], &[8]);
        offset += 1;

        // PluginType
        write_bytes(&mut instruction_data[offset..offset+1], &[self.plugin_type as u8]);
        offset += 1;

        // NewAuthority (PluginAuthority)
        offset = super::add_plugin_v1::write_authority(&mut instruction_data, offset, &self.new_authority);

        let instruction = InstructionView {
            program_id: &crate::ID,
            accounts: &account_metas,
            data: unsafe { from_raw_parts(instruction_data.as_ptr() as _, offset) },
        };

        invoke_signed(
            &instruction,
            &[self.asset, self.collection, self.payer, self.authority, self.system_program, self.log_wrapper],
            signers,
        )
    }
}
