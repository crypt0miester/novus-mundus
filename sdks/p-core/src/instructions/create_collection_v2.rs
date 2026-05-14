use core::slice::from_raw_parts;

use pinocchio::{
    cpi::{invoke_signed, Signer},
    instruction::{InstructionAccount, InstructionView},
    AccountView, ProgramResult,
};

use crate::{write_bytes, UNINIT_BYTE};

/// Create a new MPL Core Collection V2 (with external plugin adapter support).
///
/// ### Accounts:
///   0. `[WRITE, SIGNER]` The address of the new collection
///   1. `[OPTIONAL]` The update authority of the new collection
///   2. `[WRITE, SIGNER]` The account paying for the storage fees
///   3. `[]` The system program
///
/// `plugins` is pre-serialized Borsh for `Vec<PluginAuthorityPair>`.
/// `external_plugin_adapters` is pre-serialized Borsh for `Vec<ExternalPluginAdapterInitInfo>`.
/// Pass empty slices for None.
pub struct CreateCollectionV2<'a> {
    pub collection: &'a AccountView,
    pub update_authority: &'a AccountView,
    pub payer: &'a AccountView,
    pub system_program: &'a AccountView,
    pub name: &'a [u8],
    pub uri: &'a [u8],
    /// Pre-serialized Borsh `Vec<PluginAuthorityPair>`. Empty = None.
    pub plugins: &'a [u8],
    /// Pre-serialized Borsh `Vec<ExternalPluginAdapterInitInfo>`. Empty = None.
    pub external_plugin_adapters: &'a [u8],
}

impl CreateCollectionV2<'_> {
    #[inline(always)]
    pub fn invoke(&self) -> ProgramResult {
        self.invoke_signed(&[])
    }

    #[inline(always)]
    pub fn invoke_signed(&self, signers: &[Signer]) -> ProgramResult {
        let account_metas = [
            InstructionAccount::writable_signer(self.collection.address()),
            InstructionAccount::readonly(self.update_authority.address()),
            InstructionAccount::writable_signer(self.payer.address()),
            InstructionAccount::readonly(self.system_program.address()),
        ];

        let name_len = self.name.len().min(32);
        let uri_len = self.uri.len().min(200);

        let mut instruction_data = [UNINIT_BYTE; 2048];
        let mut offset = 0;

        // Discriminator (21 for CreateCollectionV2)
        write_bytes(&mut instruction_data[offset..offset+1], &[21]);
        offset += 1;

        // Name (Borsh string)
        write_bytes(&mut instruction_data[offset..offset+4], &(name_len as u32).to_le_bytes());
        offset += 4;
        write_bytes(&mut instruction_data[offset..offset+name_len], &self.name[..name_len]);
        offset += name_len;

        // URI (Borsh string)
        write_bytes(&mut instruction_data[offset..offset+4], &(uri_len as u32).to_le_bytes());
        offset += 4;
        write_bytes(&mut instruction_data[offset..offset+uri_len], &self.uri[..uri_len]);
        offset += uri_len;

        // Option<Vec<PluginAuthorityPair>>
        if self.plugins.is_empty() {
            write_bytes(&mut instruction_data[offset..offset+1], &[0]);
            offset += 1;
        } else {
            write_bytes(&mut instruction_data[offset..offset+1], &[1]);
            offset += 1;
            write_bytes(&mut instruction_data[offset..offset+self.plugins.len()], self.plugins);
            offset += self.plugins.len();
        }

        // Option<Vec<ExternalPluginAdapterInitInfo>>
        if self.external_plugin_adapters.is_empty() {
            write_bytes(&mut instruction_data[offset..offset+1], &[0]);
            offset += 1;
        } else {
            write_bytes(&mut instruction_data[offset..offset+1], &[1]);
            offset += 1;
            write_bytes(&mut instruction_data[offset..offset+self.external_plugin_adapters.len()], self.external_plugin_adapters);
            offset += self.external_plugin_adapters.len();
        }

        let instruction = InstructionView {
            program_id: &crate::ID,
            accounts: &account_metas,
            data: unsafe { from_raw_parts(instruction_data.as_ptr() as _, offset) },
        };

        invoke_signed(&instruction, &[self.collection, self.update_authority, self.payer, self.system_program], signers)
    }
}
