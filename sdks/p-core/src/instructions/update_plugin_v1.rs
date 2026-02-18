use core::slice::from_raw_parts;

use pinocchio::{
    account_info::AccountInfo,
    instruction::{AccountMeta, Instruction, Signer},
    program::invoke_signed,
    ProgramResult,
};

use crate::{write_bytes, UNINIT_BYTE};

/// Plugin update data
pub enum PluginUpdateData<'a> {
    /// Set/update all attributes (replaces entire attribute list)
    AttributesSet {
        /// Full attribute list (key, value pairs)
        attributes: &'a [(&'a [u8], &'a [u8])],
    },
    /// Update freeze state
    FreezeDelegateState {
        /// New frozen state
        frozen: bool,
    },
}

/// Update a plugin on an MPL Core Asset V1.
///
/// Borsh-serialized as UpdatePluginV1Args { plugin: Plugin }
///
/// ### Accounts:
///   0. `[WRITE]` The asset to update the plugin on
///   1. `[WRITE, OPTIONAL]` The collection to which the asset belongs
///   2. `[WRITE, SIGNER]` The account paying for the storage fees
///   3. `[SIGNER, OPTIONAL]` The authority (owner or delegate)
///   4. `[]` The system program
///   5. `[OPTIONAL]` The SPL Noop Program
pub struct UpdatePluginV1<'a> {
    /// The asset to update the plugin on
    pub asset: &'a AccountInfo,
    /// The collection to which the asset belongs (pass zero pubkey for None)
    pub collection: &'a AccountInfo,
    /// The account paying for the storage fees
    pub payer: &'a AccountInfo,
    /// The authority (owner or delegate) signing (pass zero pubkey for None)
    pub authority: &'a AccountInfo,
    /// The system program
    pub system_program: &'a AccountInfo,
    /// The SPL Noop Program (pass zero pubkey for None)
    pub log_wrapper: &'a AccountInfo,

    // Instruction arguments
    /// Plugin update data
    pub update: PluginUpdateData<'a>,
}

impl UpdatePluginV1<'_> {
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
            AccountMeta::readonly(self.log_wrapper.key()),
        ];

        // Allocate instruction data - must be large enough for attributes
        let mut instruction_data = [UNINIT_BYTE; 1024];

        let mut offset = 0;

        // Write discriminator (6 for UpdatePluginV1)
        write_bytes(&mut instruction_data[offset..offset+1], &[6]);
        offset += 1;

        // Serialize UpdatePluginV1Args { plugin: Plugin }
        // using Borsh format - just the Plugin enum, no authority
        match &self.update {
            PluginUpdateData::AttributesSet { attributes } => {
                // Plugin::Attributes is variant 6 in the Plugin enum
                write_bytes(&mut instruction_data[offset..offset+1], &[6]);
                offset += 1;

                // Attributes { attribute_list: Vec<Attribute> }
                // Borsh Vec: 4-byte u32 LE length + elements
                let attr_count = attributes.len().min(10) as u32;
                write_bytes(&mut instruction_data[offset..offset+4], &attr_count.to_le_bytes());
                offset += 4;

                // Each Attribute { key: String, value: String }
                // Borsh String: 4-byte u32 LE length + UTF-8 bytes
                for (key, value) in attributes.iter().take(10) {
                    let key_len = key.len() as u32;
                    write_bytes(&mut instruction_data[offset..offset+4], &key_len.to_le_bytes());
                    offset += 4;
                    write_bytes(&mut instruction_data[offset..offset+(key_len as usize)], key);
                    offset += key_len as usize;

                    let val_len = value.len() as u32;
                    write_bytes(&mut instruction_data[offset..offset+4], &val_len.to_le_bytes());
                    offset += 4;
                    write_bytes(&mut instruction_data[offset..offset+(val_len as usize)], value);
                    offset += val_len as usize;
                }
            },
            PluginUpdateData::FreezeDelegateState { frozen } => {
                // Plugin::FreezeDelegate is variant 1 in the Plugin enum
                write_bytes(&mut instruction_data[offset..offset+1], &[1]);
                offset += 1;

                // FreezeDelegate { frozen: bool }
                write_bytes(&mut instruction_data[offset..offset+1], &[*frozen as u8]);
                offset += 1;
            },
        }

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
            self.log_wrapper,
        ];

        invoke_signed(&instruction, &account_infos, signers)
    }
}
