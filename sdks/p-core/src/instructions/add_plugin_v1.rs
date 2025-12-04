use core::slice::from_raw_parts;

use pinocchio::{
    account_info::AccountInfo,
    instruction::{AccountMeta, Instruction, Signer},
    program::invoke_signed,
    ProgramResult,
};

use crate::{write_bytes, UNINIT_BYTE, plugins::{PluginType, PluginAuthority}};

/// Plugin data for adding to an asset
pub enum PluginData<'a> {
    /// Attributes plugin with initial data
    Attributes {
        authority: PluginAuthority,
        attributes: &'a [(&'a [u8], &'a [u8])], // (key, value) pairs
    },
    /// Freeze delegate plugin
    FreezeDelegate {
        authority: PluginAuthority,
        frozen: bool,
    },
    /// Burn delegate plugin
    BurnDelegate {
        authority: PluginAuthority,
    },
    /// Transfer delegate plugin
    TransferDelegate {
        authority: PluginAuthority,
    },
}

/// Add a plugin to an MPL Core Asset V1.
///
/// ### Accounts:
///   0. `[WRITE]` The asset to add the plugin to
///   1. `[WRITE, OPTIONAL]` The collection to which the asset belongs
///   2. `[WRITE, SIGNER]` The account paying for the storage fees
///   3. `[SIGNER, OPTIONAL]` The authority (owner or delegate)
///   4. `[]` The system program
///   5. `[OPTIONAL]` The SPL Noop Program
pub struct AddPluginV1<'a> {
    /// The asset to add the plugin to
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
    /// Plugin data to add
    pub plugin: PluginData<'a>,
}

impl AddPluginV1<'_> {
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

        // Allocate instruction data
        let mut instruction_data = [UNINIT_BYTE; 512]; // Max size

        let mut offset = 0;

        // Write discriminator (2 for AddPluginV1)
        write_bytes(&mut instruction_data[offset..offset+1], &[2]);
        offset += 1;

        // Write plugin data based on type
        match &self.plugin {
            PluginData::Attributes { authority, attributes } => {
                // Write plugin type
                write_bytes(&mut instruction_data[offset..offset+1], &[PluginType::Attributes as u8]);
                offset += 1;

                // Write authority discriminator
                write_bytes(&mut instruction_data[offset..offset+1], &[authority.discriminator()]);
                offset += 1;

                // Write authority key if Address type
                if let PluginAuthority::Address(pubkey) = authority {
                    write_bytes(&mut instruction_data[offset..offset+32], pubkey.as_ref());
                    offset += 32;
                } else {
                    // Write empty key
                    write_bytes(&mut instruction_data[offset..offset+32], &[0u8; 32]);
                    offset += 32;
                }

                // Write number of attributes
                let attr_count = attributes.len().min(10) as u8;
                write_bytes(&mut instruction_data[offset..offset+1], &[attr_count]);
                offset += 1;

                // Write each attribute
                for (key, value) in attributes.iter().take(10) {
                    // Write key length and key
                    let key_len = key.len().min(32) as u8;
                    write_bytes(&mut instruction_data[offset..offset+1], &[key_len]);
                    offset += 1;
                    write_bytes(&mut instruction_data[offset..offset+(key_len as usize)], &key[..(key_len as usize)]);
                    offset += key_len as usize;

                    // Write value length and value
                    let value_len = value.len().min(64) as u8;
                    write_bytes(&mut instruction_data[offset..offset+1], &[value_len]);
                    offset += 1;
                    write_bytes(&mut instruction_data[offset..offset+(value_len as usize)], &value[..(value_len as usize)]);
                    offset += value_len as usize;
                }
            },
            PluginData::FreezeDelegate { authority, frozen } => {
                // Write plugin type
                write_bytes(&mut instruction_data[offset..offset+1], &[PluginType::FreezeDelegate as u8]);
                offset += 1;

                // Write frozen state
                write_bytes(&mut instruction_data[offset..offset+1], &[*frozen as u8]);
                offset += 1;

                // Write authority discriminator
                write_bytes(&mut instruction_data[offset..offset+1], &[authority.discriminator()]);
                offset += 1;

                // Write authority key if Address type
                if let PluginAuthority::Address(pubkey) = authority {
                    write_bytes(&mut instruction_data[offset..offset+32], pubkey.as_ref());
                    offset += 32;
                } else {
                    // Write empty key
                    write_bytes(&mut instruction_data[offset..offset+32], &[0u8; 32]);
                    offset += 32;
                }
            },
            PluginData::BurnDelegate { authority } | PluginData::TransferDelegate { authority } => {
                // Write plugin type
                let plugin_type = match &self.plugin {
                    PluginData::BurnDelegate { .. } => PluginType::BurnDelegate,
                    PluginData::TransferDelegate { .. } => PluginType::TransferDelegate,
                    _ => unreachable!(),
                };
                write_bytes(&mut instruction_data[offset..offset+1], &[plugin_type as u8]);
                offset += 1;

                // Write authority discriminator
                write_bytes(&mut instruction_data[offset..offset+1], &[authority.discriminator()]);
                offset += 1;

                // Write authority key if Address type
                if let PluginAuthority::Address(pubkey) = authority {
                    write_bytes(&mut instruction_data[offset..offset+32], pubkey.as_ref());
                    offset += 32;
                } else {
                    // Write empty key
                    write_bytes(&mut instruction_data[offset..offset+32], &[0u8; 32]);
                    offset += 32;
                }
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