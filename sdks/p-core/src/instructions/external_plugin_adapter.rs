//! External Plugin Adapter instructions for MPL Core.
//!
//! The init_info, key, and update_info types are deeply nested Borsh enums
//! (`ExternalPluginAdapterInitInfo`, `ExternalPluginAdapterKey`,
//! `ExternalPluginAdapterUpdateInfo`). To keep the CPI wrapper lean,
//! callers pass pre-serialized Borsh bytes for these fields.
//!
//! Helper functions for building those Borsh bytes are provided in the
//! `external_plugin_adapter_keys` module.

use core::slice::from_raw_parts;

use pinocchio::{
    cpi::{invoke_signed, Signer},
    instruction::{InstructionAccount, InstructionView},
    AccountView, ProgramResult,
};

use crate::{write_bytes, UNINIT_BYTE};

// ---------------------------------------------------------------------------
// ExternalPluginAdapterKey helpers
// ---------------------------------------------------------------------------

use core::mem::MaybeUninit;

/// Borsh `ExternalPluginAdapterKey` enum discriminants.
#[repr(u8)]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum ExternalPluginAdapterType {
    LifecycleHook = 0,
    Oracle = 1,
    AppData = 2,
    LinkedLifecycleHook = 3,
    LinkedAppData = 4,
    DataSection = 5,
}

/// Write a Borsh `ExternalPluginAdapterKey::LifecycleHook(Pubkey)` into `buf`.
pub fn write_key_lifecycle_hook(buf: &mut [MaybeUninit<u8>], mut offset: usize, hooked_program: &[u8; 32]) -> usize {
    write_bytes(&mut buf[offset..offset+1], &[0]); offset += 1;
    write_bytes(&mut buf[offset..offset+32], hooked_program); offset += 32;
    offset
}

/// Write a Borsh `ExternalPluginAdapterKey::Oracle(Pubkey)` into `buf`.
pub fn write_key_oracle(buf: &mut [MaybeUninit<u8>], mut offset: usize, base_address: &[u8; 32]) -> usize {
    write_bytes(&mut buf[offset..offset+1], &[1]); offset += 1;
    write_bytes(&mut buf[offset..offset+32], base_address); offset += 32;
    offset
}

/// Write a Borsh `ExternalPluginAdapterKey::AppData(Authority)` into `buf`.
pub fn write_key_app_data(buf: &mut [MaybeUninit<u8>], mut offset: usize, authority: &crate::plugins::PluginAuthority) -> usize {
    write_bytes(&mut buf[offset..offset+1], &[2]); offset += 1;
    offset = super::add_plugin_v1::write_authority(buf, offset, authority);
    offset
}

/// Write a Borsh `ExternalPluginAdapterKey::LinkedLifecycleHook(Pubkey)` into `buf`.
pub fn write_key_linked_lifecycle_hook(buf: &mut [MaybeUninit<u8>], mut offset: usize, hooked_program: &[u8; 32]) -> usize {
    write_bytes(&mut buf[offset..offset+1], &[3]); offset += 1;
    write_bytes(&mut buf[offset..offset+32], hooked_program); offset += 32;
    offset
}

/// Write a Borsh `ExternalPluginAdapterKey::LinkedAppData(Authority)` into `buf`.
pub fn write_key_linked_app_data(buf: &mut [MaybeUninit<u8>], mut offset: usize, authority: &crate::plugins::PluginAuthority) -> usize {
    write_bytes(&mut buf[offset..offset+1], &[4]); offset += 1;
    offset = super::add_plugin_v1::write_authority(buf, offset, authority);
    offset
}

// ---------------------------------------------------------------------------
// AddExternalPluginAdapterV1 (discriminator 22)
// ---------------------------------------------------------------------------

/// Add an external plugin adapter to an MPL Core Asset.
///
/// ### Accounts:
///   0. `[WRITE]` The asset
///   1. `[WRITE, OPTIONAL]` The collection
///   2. `[WRITE, SIGNER]` The payer
///   3. `[SIGNER, OPTIONAL]` The authority
///   4. `[]` The system program
///   5. `[OPTIONAL]` The SPL Noop Program
pub struct AddExternalPluginAdapterV1<'a> {
    pub asset: &'a AccountView,
    pub collection: &'a AccountView,
    pub payer: &'a AccountView,
    pub authority: &'a AccountView,
    pub system_program: &'a AccountView,
    pub log_wrapper: &'a AccountView,
    /// Pre-serialized Borsh `ExternalPluginAdapterInitInfo`.
    pub init_info: &'a [u8],
}

impl AddExternalPluginAdapterV1<'_> {
    #[inline(always)]
    pub fn invoke(&self) -> ProgramResult { self.invoke_signed(&[]) }

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
        let len = 1 + self.init_info.len();
        let mut data = [UNINIT_BYTE; 2048];
        write_bytes(&mut data[0..1], &[22]);
        write_bytes(&mut data[1..len], self.init_info);
        let ix = InstructionView {
            program_id: &crate::ID,
            accounts: &account_metas,
            data: unsafe { from_raw_parts(data.as_ptr() as _, len) },
        };
        invoke_signed(&ix, &[self.asset, self.collection, self.payer, self.authority, self.system_program, self.log_wrapper], signers)
    }
}

// ---------------------------------------------------------------------------
// AddCollectionExternalPluginAdapterV1 (discriminator 23)
// ---------------------------------------------------------------------------

/// Add an external plugin adapter to an MPL Core Collection.
///
/// ### Accounts:
///   0. `[WRITE]` The collection
///   1. `[WRITE, SIGNER]` The payer
///   2. `[SIGNER, OPTIONAL]` The authority
///   3. `[]` The system program
///   4. `[OPTIONAL]` The SPL Noop Program
pub struct AddCollectionExternalPluginAdapterV1<'a> {
    pub collection: &'a AccountView,
    pub payer: &'a AccountView,
    pub authority: &'a AccountView,
    pub system_program: &'a AccountView,
    pub log_wrapper: &'a AccountView,
    /// Pre-serialized Borsh `ExternalPluginAdapterInitInfo`.
    pub init_info: &'a [u8],
}

impl AddCollectionExternalPluginAdapterV1<'_> {
    #[inline(always)]
    pub fn invoke(&self) -> ProgramResult { self.invoke_signed(&[]) }

    #[inline(always)]
    pub fn invoke_signed(&self, signers: &[Signer]) -> ProgramResult {
        let account_metas = [
            InstructionAccount::writable(self.collection.address()),
            InstructionAccount::writable_signer(self.payer.address()),
            InstructionAccount::readonly_signer(self.authority.address()),
            InstructionAccount::readonly(self.system_program.address()),
            InstructionAccount::readonly(self.log_wrapper.address()),
        ];
        let len = 1 + self.init_info.len();
        let mut data = [UNINIT_BYTE; 2048];
        write_bytes(&mut data[0..1], &[23]);
        write_bytes(&mut data[1..len], self.init_info);
        let ix = InstructionView {
            program_id: &crate::ID,
            accounts: &account_metas,
            data: unsafe { from_raw_parts(data.as_ptr() as _, len) },
        };
        invoke_signed(&ix, &[self.collection, self.payer, self.authority, self.system_program, self.log_wrapper], signers)
    }
}

// ---------------------------------------------------------------------------
// RemoveExternalPluginAdapterV1 (discriminator 24)
// ---------------------------------------------------------------------------

/// Remove an external plugin adapter from an MPL Core Asset.
///
/// ### Accounts:
///   0. `[WRITE]` The asset
///   1. `[WRITE, OPTIONAL]` The collection
///   2. `[WRITE, SIGNER]` The payer
///   3. `[SIGNER, OPTIONAL]` The authority
///   4. `[]` The system program
///   5. `[OPTIONAL]` The SPL Noop Program
pub struct RemoveExternalPluginAdapterV1<'a> {
    pub asset: &'a AccountView,
    pub collection: &'a AccountView,
    pub payer: &'a AccountView,
    pub authority: &'a AccountView,
    pub system_program: &'a AccountView,
    pub log_wrapper: &'a AccountView,
    /// Pre-serialized Borsh `ExternalPluginAdapterKey`.
    pub key: &'a [u8],
}

impl RemoveExternalPluginAdapterV1<'_> {
    #[inline(always)]
    pub fn invoke(&self) -> ProgramResult { self.invoke_signed(&[]) }

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
        let len = 1 + self.key.len();
        let mut data = [UNINIT_BYTE; 128];
        write_bytes(&mut data[0..1], &[24]);
        write_bytes(&mut data[1..len], self.key);
        let ix = InstructionView {
            program_id: &crate::ID,
            accounts: &account_metas,
            data: unsafe { from_raw_parts(data.as_ptr() as _, len) },
        };
        invoke_signed(&ix, &[self.asset, self.collection, self.payer, self.authority, self.system_program, self.log_wrapper], signers)
    }
}

// ---------------------------------------------------------------------------
// RemoveCollectionExternalPluginAdapterV1 (discriminator 25)
// ---------------------------------------------------------------------------

/// Remove an external plugin adapter from an MPL Core Collection.
///
/// ### Accounts:
///   0. `[WRITE]` The collection
///   1. `[WRITE, SIGNER]` The payer
///   2. `[SIGNER, OPTIONAL]` The authority
///   3. `[]` The system program
///   4. `[OPTIONAL]` The SPL Noop Program
pub struct RemoveCollectionExternalPluginAdapterV1<'a> {
    pub collection: &'a AccountView,
    pub payer: &'a AccountView,
    pub authority: &'a AccountView,
    pub system_program: &'a AccountView,
    pub log_wrapper: &'a AccountView,
    /// Pre-serialized Borsh `ExternalPluginAdapterKey`.
    pub key: &'a [u8],
}

impl RemoveCollectionExternalPluginAdapterV1<'_> {
    #[inline(always)]
    pub fn invoke(&self) -> ProgramResult { self.invoke_signed(&[]) }

    #[inline(always)]
    pub fn invoke_signed(&self, signers: &[Signer]) -> ProgramResult {
        let account_metas = [
            InstructionAccount::writable(self.collection.address()),
            InstructionAccount::writable_signer(self.payer.address()),
            InstructionAccount::readonly_signer(self.authority.address()),
            InstructionAccount::readonly(self.system_program.address()),
            InstructionAccount::readonly(self.log_wrapper.address()),
        ];
        let len = 1 + self.key.len();
        let mut data = [UNINIT_BYTE; 128];
        write_bytes(&mut data[0..1], &[25]);
        write_bytes(&mut data[1..len], self.key);
        let ix = InstructionView {
            program_id: &crate::ID,
            accounts: &account_metas,
            data: unsafe { from_raw_parts(data.as_ptr() as _, len) },
        };
        invoke_signed(&ix, &[self.collection, self.payer, self.authority, self.system_program, self.log_wrapper], signers)
    }
}

// ---------------------------------------------------------------------------
// UpdateExternalPluginAdapterV1 (discriminator 26)
// ---------------------------------------------------------------------------

/// Update an external plugin adapter on an MPL Core Asset.
///
/// ### Accounts:
///   0. `[WRITE]` The asset
///   1. `[WRITE, OPTIONAL]` The collection
///   2. `[WRITE, SIGNER]` The payer
///   3. `[SIGNER, OPTIONAL]` The authority
///   4. `[]` The system program
///   5. `[OPTIONAL]` The SPL Noop Program
pub struct UpdateExternalPluginAdapterV1<'a> {
    pub asset: &'a AccountView,
    pub collection: &'a AccountView,
    pub payer: &'a AccountView,
    pub authority: &'a AccountView,
    pub system_program: &'a AccountView,
    pub log_wrapper: &'a AccountView,
    /// Pre-serialized Borsh: `ExternalPluginAdapterKey` ++ `ExternalPluginAdapterUpdateInfo`.
    pub args: &'a [u8],
}

impl UpdateExternalPluginAdapterV1<'_> {
    #[inline(always)]
    pub fn invoke(&self) -> ProgramResult { self.invoke_signed(&[]) }

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
        let len = 1 + self.args.len();
        let mut data = [UNINIT_BYTE; 2048];
        write_bytes(&mut data[0..1], &[26]);
        write_bytes(&mut data[1..len], self.args);
        let ix = InstructionView {
            program_id: &crate::ID,
            accounts: &account_metas,
            data: unsafe { from_raw_parts(data.as_ptr() as _, len) },
        };
        invoke_signed(&ix, &[self.asset, self.collection, self.payer, self.authority, self.system_program, self.log_wrapper], signers)
    }
}

// ---------------------------------------------------------------------------
// UpdateCollectionExternalPluginAdapterV1 (discriminator 27)
// ---------------------------------------------------------------------------

/// Update an external plugin adapter on an MPL Core Collection.
///
/// ### Accounts:
///   0. `[WRITE]` The collection
///   1. `[WRITE, SIGNER]` The payer
///   2. `[SIGNER, OPTIONAL]` The authority
///   3. `[]` The system program
///   4. `[OPTIONAL]` The SPL Noop Program
pub struct UpdateCollectionExternalPluginAdapterV1<'a> {
    pub collection: &'a AccountView,
    pub payer: &'a AccountView,
    pub authority: &'a AccountView,
    pub system_program: &'a AccountView,
    pub log_wrapper: &'a AccountView,
    /// Pre-serialized Borsh: `ExternalPluginAdapterKey` ++ `ExternalPluginAdapterUpdateInfo`.
    pub args: &'a [u8],
}

impl UpdateCollectionExternalPluginAdapterV1<'_> {
    #[inline(always)]
    pub fn invoke(&self) -> ProgramResult { self.invoke_signed(&[]) }

    #[inline(always)]
    pub fn invoke_signed(&self, signers: &[Signer]) -> ProgramResult {
        let account_metas = [
            InstructionAccount::writable(self.collection.address()),
            InstructionAccount::writable_signer(self.payer.address()),
            InstructionAccount::readonly_signer(self.authority.address()),
            InstructionAccount::readonly(self.system_program.address()),
            InstructionAccount::readonly(self.log_wrapper.address()),
        ];
        let len = 1 + self.args.len();
        let mut data = [UNINIT_BYTE; 2048];
        write_bytes(&mut data[0..1], &[27]);
        write_bytes(&mut data[1..len], self.args);
        let ix = InstructionView {
            program_id: &crate::ID,
            accounts: &account_metas,
            data: unsafe { from_raw_parts(data.as_ptr() as _, len) },
        };
        invoke_signed(&ix, &[self.collection, self.payer, self.authority, self.system_program, self.log_wrapper], signers)
    }
}

// ---------------------------------------------------------------------------
// WriteExternalPluginAdapterDataV1 (discriminator 28)
// ---------------------------------------------------------------------------

/// Write data to an external plugin adapter on an MPL Core Asset.
///
/// ### Accounts:
///   0. `[WRITE]` The asset
///   1. `[WRITE, OPTIONAL]` The collection
///   2. `[WRITE, SIGNER]` The payer
///   3. `[SIGNER, OPTIONAL]` The authority
///   4. `[]` The system program
///   5. `[OPTIONAL]` The SPL Noop Program
pub struct WriteExternalPluginAdapterDataV1<'a> {
    pub asset: &'a AccountView,
    pub collection: &'a AccountView,
    pub payer: &'a AccountView,
    pub authority: &'a AccountView,
    pub system_program: &'a AccountView,
    pub log_wrapper: &'a AccountView,
    /// Pre-serialized Borsh `ExternalPluginAdapterKey`.
    pub key: &'a [u8],
    /// The data to write. `None` clears the data.
    pub data: Option<&'a [u8]>,
}

impl WriteExternalPluginAdapterDataV1<'_> {
    #[inline(always)]
    pub fn invoke(&self) -> ProgramResult { self.invoke_signed(&[]) }

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
        let mut ix_data = [UNINIT_BYTE; 2048];
        let mut offset = 0;
        write_bytes(&mut ix_data[offset..offset+1], &[28]); offset += 1;
        // key
        write_bytes(&mut ix_data[offset..offset+self.key.len()], self.key);
        offset += self.key.len();
        // Option<Vec<u8>> data
        match self.data {
            Some(d) => {
                write_bytes(&mut ix_data[offset..offset+1], &[1]); offset += 1; // Some
                let len = d.len() as u32;
                write_bytes(&mut ix_data[offset..offset+4], &len.to_le_bytes()); offset += 4;
                write_bytes(&mut ix_data[offset..offset+d.len()], d); offset += d.len();
            },
            None => {
                write_bytes(&mut ix_data[offset..offset+1], &[0]); offset += 1; // None
            },
        }
        let ix = InstructionView {
            program_id: &crate::ID,
            accounts: &account_metas,
            data: unsafe { from_raw_parts(ix_data.as_ptr() as _, offset) },
        };
        invoke_signed(&ix, &[self.asset, self.collection, self.payer, self.authority, self.system_program, self.log_wrapper], signers)
    }
}

// ---------------------------------------------------------------------------
// WriteCollectionExternalPluginAdapterDataV1 (discriminator 29)
// ---------------------------------------------------------------------------

/// Write data to an external plugin adapter on an MPL Core Collection.
///
/// ### Accounts:
///   0. `[WRITE]` The collection
///   1. `[WRITE, SIGNER]` The payer
///   2. `[SIGNER, OPTIONAL]` The authority
///   3. `[]` The system program
///   4. `[OPTIONAL]` The SPL Noop Program
pub struct WriteCollectionExternalPluginAdapterDataV1<'a> {
    pub collection: &'a AccountView,
    pub payer: &'a AccountView,
    pub authority: &'a AccountView,
    pub system_program: &'a AccountView,
    pub log_wrapper: &'a AccountView,
    /// Pre-serialized Borsh `ExternalPluginAdapterKey`.
    pub key: &'a [u8],
    /// The data to write. `None` clears the data.
    pub data: Option<&'a [u8]>,
}

impl WriteCollectionExternalPluginAdapterDataV1<'_> {
    #[inline(always)]
    pub fn invoke(&self) -> ProgramResult { self.invoke_signed(&[]) }

    #[inline(always)]
    pub fn invoke_signed(&self, signers: &[Signer]) -> ProgramResult {
        let account_metas = [
            InstructionAccount::writable(self.collection.address()),
            InstructionAccount::writable_signer(self.payer.address()),
            InstructionAccount::readonly_signer(self.authority.address()),
            InstructionAccount::readonly(self.system_program.address()),
            InstructionAccount::readonly(self.log_wrapper.address()),
        ];
        let mut ix_data = [UNINIT_BYTE; 2048];
        let mut offset = 0;
        write_bytes(&mut ix_data[offset..offset+1], &[29]); offset += 1;
        // key
        write_bytes(&mut ix_data[offset..offset+self.key.len()], self.key);
        offset += self.key.len();
        // Option<Vec<u8>> data
        match self.data {
            Some(d) => {
                write_bytes(&mut ix_data[offset..offset+1], &[1]); offset += 1;
                let len = d.len() as u32;
                write_bytes(&mut ix_data[offset..offset+4], &len.to_le_bytes()); offset += 4;
                write_bytes(&mut ix_data[offset..offset+d.len()], d); offset += d.len();
            },
            None => {
                write_bytes(&mut ix_data[offset..offset+1], &[0]); offset += 1;
            },
        }
        let ix = InstructionView {
            program_id: &crate::ID,
            accounts: &account_metas,
            data: unsafe { from_raw_parts(ix_data.as_ptr() as _, offset) },
        };
        invoke_signed(&ix, &[self.collection, self.payer, self.authority, self.system_program, self.log_wrapper], signers)
    }
}
