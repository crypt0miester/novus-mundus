use core::slice::from_raw_parts;

use pinocchio::{
    account_info::AccountInfo,
    instruction::{AccountMeta, Instruction, Signer},
    program::invoke_signed,
    ProgramResult,
};

use crate::{write_bytes, UNINIT_BYTE, plugins::{PluginType, PluginAuthority}};

/// Plugin update data
pub enum PluginUpdateData<'a> {
    /// Set/update attributes only
    AttributesSet {
        /// Attributes to set/update (key, value pairs)
        attributes: &'a [(&'a [u8], &'a [u8])],
    },
    /// Remove attributes only
    AttributesRemove {
        /// Keys of attributes to remove
        keys: &'a [&'a [u8]],
    },
    /// Update attributes authority only
    AttributesAuthority {
        /// New authority
        new_authority: PluginAuthority,
    },
    /// Set attributes and update authority
    AttributesSetWithAuthority {
        /// Attributes to set/update
        attributes: &'a [(&'a [u8], &'a [u8])],
        /// New authority
        new_authority: PluginAuthority,
    },
    /// Update freeze state
    FreezeDelegateState {
        /// New frozen state
        frozen: bool,
    },
    /// Update freeze delegate authority
    FreezeDelegateAuthority {
        /// New authority
        new_authority: PluginAuthority,
    },
    /// Update freeze state and authority
    FreezeDelegateStateAndAuthority {
        /// New frozen state
        frozen: bool,
        /// New authority
        new_authority: PluginAuthority,
    },
    /// Update any delegate authority
    DelegateAuthority {
        /// Plugin type to update
        plugin_type: PluginType,
        /// New authority
        new_authority: PluginAuthority,
    },
}

/// Update a plugin on an MPL Core Asset V1.
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

        // Allocate instruction data
        let mut instruction_data = [UNINIT_BYTE; 512]; // Max size

        let mut offset = 0;

        // Write discriminator (6 for UpdatePluginV1)
        write_bytes(&mut instruction_data[offset..offset+1], &[6]);
        offset += 1;

        // Write plugin update data based on type
        match &self.update {
            PluginUpdateData::AttributesSet { attributes } => {
                // Write plugin type
                write_bytes(&mut instruction_data[offset..offset+1], &[PluginType::Attributes as u8]);
                offset += 1;

                // Write update type (0 = set attributes only)
                write_bytes(&mut instruction_data[offset..offset+1], &[0]);
                offset += 1;

                // Write attribute count
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
            PluginUpdateData::AttributesRemove { keys } => {
                // Write plugin type
                write_bytes(&mut instruction_data[offset..offset+1], &[PluginType::Attributes as u8]);
                offset += 1;

                // Write update type (1 = remove attributes only)
                write_bytes(&mut instruction_data[offset..offset+1], &[1]);
                offset += 1;

                // Write key count
                let key_count = keys.len().min(10) as u8;
                write_bytes(&mut instruction_data[offset..offset+1], &[key_count]);
                offset += 1;

                // Write each key to remove
                for key in keys.iter().take(10) {
                    let key_len = key.len().min(32) as u8;
                    write_bytes(&mut instruction_data[offset..offset+1], &[key_len]);
                    offset += 1;
                    write_bytes(&mut instruction_data[offset..offset+(key_len as usize)], &key[..(key_len as usize)]);
                    offset += key_len as usize;
                }
            },
            PluginUpdateData::AttributesAuthority { new_authority } => {
                // Write plugin type
                write_bytes(&mut instruction_data[offset..offset+1], &[PluginType::Attributes as u8]);
                offset += 1;

                // Write update type (2 = update authority only)
                write_bytes(&mut instruction_data[offset..offset+1], &[2]);
                offset += 1;

                // Write new authority
                write_bytes(&mut instruction_data[offset..offset+1], &[new_authority.discriminator()]);
                offset += 1;

                if let PluginAuthority::Address(pubkey) = new_authority {
                    write_bytes(&mut instruction_data[offset..offset+32], pubkey.as_ref());
                    offset += 32;
                } else {
                    write_bytes(&mut instruction_data[offset..offset+32], &[0u8; 32]);
                    offset += 32;
                }
            },
            PluginUpdateData::AttributesSetWithAuthority { attributes, new_authority } => {
                // Write plugin type
                write_bytes(&mut instruction_data[offset..offset+1], &[PluginType::Attributes as u8]);
                offset += 1;

                // Write update type (3 = set attributes and update authority)
                write_bytes(&mut instruction_data[offset..offset+1], &[3]);
                offset += 1;

                // Write attribute count
                let attr_count = attributes.len().min(10) as u8;
                write_bytes(&mut instruction_data[offset..offset+1], &[attr_count]);
                offset += 1;

                // Write each attribute
                for (key, value) in attributes.iter().take(10) {
                    let key_len = key.len().min(32) as u8;
                    write_bytes(&mut instruction_data[offset..offset+1], &[key_len]);
                    offset += 1;
                    write_bytes(&mut instruction_data[offset..offset+(key_len as usize)], &key[..(key_len as usize)]);
                    offset += key_len as usize;

                    let value_len = value.len().min(64) as u8;
                    write_bytes(&mut instruction_data[offset..offset+1], &[value_len]);
                    offset += 1;
                    write_bytes(&mut instruction_data[offset..offset+(value_len as usize)], &value[..(value_len as usize)]);
                    offset += value_len as usize;
                }

                // Write new authority
                write_bytes(&mut instruction_data[offset..offset+1], &[new_authority.discriminator()]);
                offset += 1;

                if let PluginAuthority::Address(pubkey) = new_authority {
                    write_bytes(&mut instruction_data[offset..offset+32], pubkey.as_ref());
                    offset += 32;
                } else {
                    write_bytes(&mut instruction_data[offset..offset+32], &[0u8; 32]);
                    offset += 32;
                }
            },
            PluginUpdateData::FreezeDelegateState { frozen } => {
                // Write plugin type
                write_bytes(&mut instruction_data[offset..offset+1], &[PluginType::FreezeDelegate as u8]);
                offset += 1;

                // Write update type (0 = state only)
                write_bytes(&mut instruction_data[offset..offset+1], &[0]);
                offset += 1;

                // Write frozen state
                write_bytes(&mut instruction_data[offset..offset+1], &[*frozen as u8]);
                offset += 1;
            },
            PluginUpdateData::FreezeDelegateAuthority { new_authority } => {
                // Write plugin type
                write_bytes(&mut instruction_data[offset..offset+1], &[PluginType::FreezeDelegate as u8]);
                offset += 1;

                // Write update type (1 = authority only)
                write_bytes(&mut instruction_data[offset..offset+1], &[1]);
                offset += 1;

                // Write new authority
                write_bytes(&mut instruction_data[offset..offset+1], &[new_authority.discriminator()]);
                offset += 1;

                if let PluginAuthority::Address(pubkey) = new_authority {
                    write_bytes(&mut instruction_data[offset..offset+32], pubkey.as_ref());
                    offset += 32;
                } else {
                    write_bytes(&mut instruction_data[offset..offset+32], &[0u8; 32]);
                    offset += 32;
                }
            },
            PluginUpdateData::FreezeDelegateStateAndAuthority { frozen, new_authority } => {
                // Write plugin type
                write_bytes(&mut instruction_data[offset..offset+1], &[PluginType::FreezeDelegate as u8]);
                offset += 1;

                // Write update type (2 = both state and authority)
                write_bytes(&mut instruction_data[offset..offset+1], &[2]);
                offset += 1;

                // Write frozen state
                write_bytes(&mut instruction_data[offset..offset+1], &[*frozen as u8]);
                offset += 1;

                // Write new authority
                write_bytes(&mut instruction_data[offset..offset+1], &[new_authority.discriminator()]);
                offset += 1;

                if let PluginAuthority::Address(pubkey) = new_authority {
                    write_bytes(&mut instruction_data[offset..offset+32], pubkey.as_ref());
                    offset += 32;
                } else {
                    write_bytes(&mut instruction_data[offset..offset+32], &[0u8; 32]);
                    offset += 32;
                }
            },
            PluginUpdateData::DelegateAuthority { plugin_type, new_authority } => {
                // Write plugin type
                write_bytes(&mut instruction_data[offset..offset+1], &[*plugin_type as u8]);
                offset += 1;

                // Write update type (3 = authority update for any delegate)
                write_bytes(&mut instruction_data[offset..offset+1], &[3]);
                offset += 1;

                // Write new authority
                write_bytes(&mut instruction_data[offset..offset+1], &[new_authority.discriminator()]);
                offset += 1;

                if let PluginAuthority::Address(pubkey) = new_authority {
                    write_bytes(&mut instruction_data[offset..offset+32], pubkey.as_ref());
                    offset += 32;
                } else {
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