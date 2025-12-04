use core::slice::from_raw_parts;

use pinocchio::{
    account_info::AccountInfo,
    instruction::{AccountMeta, Instruction, Signer},
    program::invoke_signed,
    ProgramResult,
};

use crate::{write_bytes, UNINIT_BYTE, plugins::PluginType};

/// Remove a plugin from an MPL Core Asset V1.
///
/// ### Accounts:
///   0. `[WRITE]` The asset to remove the plugin from
///   1. `[WRITE, OPTIONAL]` The collection to which the asset belongs
///   2. `[WRITE, SIGNER]` The account paying for the storage fees (receives rent back)
///   3. `[SIGNER, OPTIONAL]` The authority (owner or delegate)
///   4. `[]` The system program
///   5. `[OPTIONAL]` The SPL Noop Program
pub struct RemovePluginV1<'a> {
    /// The asset to remove the plugin from
    pub asset: &'a AccountInfo,
    /// The collection to which the asset belongs (pass zero pubkey for None)
    pub collection: &'a AccountInfo,
    /// The account paying for the storage fees (receives rent back)
    pub payer: &'a AccountInfo,
    /// The authority (owner or delegate) signing (pass zero pubkey for None)
    pub authority: &'a AccountInfo,
    /// The system program
    pub system_program: &'a AccountInfo,

    // Instruction arguments
    /// Plugin type to remove
    pub plugin_type: PluginType,
}

impl RemovePluginV1<'_> {
    #[inline(always)]
    pub fn invoke(&self) -> ProgramResult {
        self.invoke_signed(&[])
    }

    #[inline(always)]
    pub fn invoke_signed(&self, signers: &[Signer]) -> ProgramResult {
        // Build account metas
        let account_metas = [
            AccountMeta::writable(self.asset.key()),
            AccountMeta::writable(self.collection.key()),
            AccountMeta::writable_signer(self.payer.key()),
            AccountMeta::readonly_signer(self.authority.key()),
            AccountMeta::readonly(self.system_program.key()),
        ];

        // Allocate instruction data
        let mut instruction_data = [UNINIT_BYTE; 2]; // Small size for remove

        let mut offset = 0;

        // Write discriminator (4 for RemovePluginV1)
        write_bytes(&mut instruction_data[offset..offset+1], &[4]);
        offset += 1;

        // Write plugin type to remove
        write_bytes(&mut instruction_data[offset..offset+1], &[self.plugin_type as u8]);
        offset += 1;

        let instruction = Instruction {
            program_id: &crate::ID,
            accounts: &account_metas,
            data: unsafe { from_raw_parts(instruction_data.as_ptr() as _, offset) },
        };

        // Collect account infos
        let account_infos = [
            self.asset,
            self.collection,
            self.payer,
            self.authority,
            self.system_program,
        ];

        invoke_signed(&instruction, &account_infos, signers)
    }
}