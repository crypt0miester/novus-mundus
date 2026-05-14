use core::mem::MaybeUninit;
use core::slice::from_raw_parts;

use pinocchio::{
    cpi::{invoke_signed, Signer},
    instruction::{InstructionAccount, InstructionView},
    AccountView, ProgramResult,
};

use crate::{write_bytes, UNINIT_BYTE, plugins::PluginAuthority};

/// Plugin data for adding to an asset or collection.
///
/// Each variant serializes to the Borsh `Plugin` enum (discriminant + struct fields),
/// followed by `Option<Authority>` for `init_authority`.
pub enum PluginData<'a> {
    Royalties {
        authority: PluginAuthority,
        basis_points: u16,
        /// Each creator: (address, percentage)
        creators: &'a [(&'a [u8; 32], u8)],
        rule_set: RuleSetData<'a>,
    },
    FreezeDelegate {
        authority: PluginAuthority,
        frozen: bool,
    },
    BurnDelegate {
        authority: PluginAuthority,
    },
    TransferDelegate {
        authority: PluginAuthority,
    },
    UpdateDelegate {
        authority: PluginAuthority,
        additional_delegates: &'a [[u8; 32]],
    },
    PermanentFreezeDelegate {
        authority: PluginAuthority,
        frozen: bool,
    },
    Attributes {
        authority: PluginAuthority,
        /// Each attribute: (key, value) as byte slices (Borsh String pairs)
        attributes: &'a [(&'a [u8], &'a [u8])],
    },
    PermanentTransferDelegate {
        authority: PluginAuthority,
    },
    PermanentBurnDelegate {
        authority: PluginAuthority,
    },
    Edition {
        authority: PluginAuthority,
        number: u32,
    },
    MasterEdition {
        authority: PluginAuthority,
        max_supply: Option<u32>,
        name: &'a [u8],
        uri: &'a [u8],
    },
    AddBlocker {
        authority: PluginAuthority,
    },
    ImmutableMetadata {
        authority: PluginAuthority,
    },
    VerifiedCreators {
        authority: PluginAuthority,
        /// Each signature: (address, verified)
        signatures: &'a [(&'a [u8; 32], bool)],
    },
    Autograph {
        authority: PluginAuthority,
        /// Each signature: (address, message)
        signatures: &'a [(&'a [u8; 32], &'a [u8])],
    },
    BubblegumV2 {
        authority: PluginAuthority,
    },
    FreezeExecute {
        authority: PluginAuthority,
        frozen: bool,
    },
    PermanentFreezeExecute {
        authority: PluginAuthority,
        frozen: bool,
    },
}

/// Rule set for Royalties plugin (Borsh `RuleSet` enum).
#[derive(Copy, Clone, Debug)]
pub enum RuleSetData<'a> {
    /// No rule set
    None,
    /// Only these programs can transfer
    ProgramAllowList(&'a [&'a [u8; 32]]),
    /// These programs cannot transfer
    ProgramDenyList(&'a [&'a [u8; 32]]),
}

/// Serialize plugin data (Borsh `Plugin` enum + `Option<Authority>`) into buffer.
/// Returns new offset.
pub fn write_plugin_data(buf: &mut [MaybeUninit<u8>], mut offset: usize, plugin: &PluginData) -> usize {
    match plugin {
        // Borsh Plugin variant 0: Royalties { basis_points: u16, creators: Vec<Creator>, rule_set: RuleSet }
        PluginData::Royalties { authority, basis_points, creators, rule_set } => {
            write_bytes(&mut buf[offset..offset+1], &[0]);
            offset += 1;
            write_bytes(&mut buf[offset..offset+2], &basis_points.to_le_bytes());
            offset += 2;
            let count = creators.len() as u32;
            write_bytes(&mut buf[offset..offset+4], &count.to_le_bytes());
            offset += 4;
            for (address, percentage) in *creators {
                write_bytes(&mut buf[offset..offset+32], *address);
                offset += 32;
                write_bytes(&mut buf[offset..offset+1], &[*percentage]);
                offset += 1;
            }
            offset = write_rule_set(buf, offset, rule_set);
            offset = write_option_authority(buf, offset, authority);
        },
        // Borsh Plugin variant 1: FreezeDelegate { frozen: bool }
        PluginData::FreezeDelegate { authority, frozen } => {
            write_bytes(&mut buf[offset..offset+1], &[1]);
            offset += 1;
            write_bytes(&mut buf[offset..offset+1], &[*frozen as u8]);
            offset += 1;
            offset = write_option_authority(buf, offset, authority);
        },
        // Borsh Plugin variant 2: BurnDelegate {} (empty struct)
        PluginData::BurnDelegate { authority } => {
            write_bytes(&mut buf[offset..offset+1], &[2]);
            offset += 1;
            offset = write_option_authority(buf, offset, authority);
        },
        // Borsh Plugin variant 3: TransferDelegate {} (empty struct)
        PluginData::TransferDelegate { authority } => {
            write_bytes(&mut buf[offset..offset+1], &[3]);
            offset += 1;
            offset = write_option_authority(buf, offset, authority);
        },
        // Borsh Plugin variant 4: UpdateDelegate { additional_delegates: Vec<Pubkey> }
        PluginData::UpdateDelegate { authority, additional_delegates } => {
            write_bytes(&mut buf[offset..offset+1], &[4]);
            offset += 1;
            let count = additional_delegates.len() as u32;
            write_bytes(&mut buf[offset..offset+4], &count.to_le_bytes());
            offset += 4;
            for delegate in *additional_delegates {
                write_bytes(&mut buf[offset..offset+32], delegate);
                offset += 32;
            }
            offset = write_option_authority(buf, offset, authority);
        },
        // Borsh Plugin variant 5: PermanentFreezeDelegate { frozen: bool }
        PluginData::PermanentFreezeDelegate { authority, frozen } => {
            write_bytes(&mut buf[offset..offset+1], &[5]);
            offset += 1;
            write_bytes(&mut buf[offset..offset+1], &[*frozen as u8]);
            offset += 1;
            offset = write_option_authority(buf, offset, authority);
        },
        // Borsh Plugin variant 6: Attributes { attribute_list: Vec<Attribute> }
        // Attribute = { key: String, value: String }
        PluginData::Attributes { authority, attributes } => {
            write_bytes(&mut buf[offset..offset+1], &[6]);
            offset += 1;
            let attr_count = attributes.len() as u32;
            write_bytes(&mut buf[offset..offset+4], &attr_count.to_le_bytes());
            offset += 4;
            for (key, value) in *attributes {
                let key_len = key.len() as u32;
                write_bytes(&mut buf[offset..offset+4], &key_len.to_le_bytes());
                offset += 4;
                write_bytes(&mut buf[offset..offset+(key_len as usize)], key);
                offset += key_len as usize;
                let val_len = value.len() as u32;
                write_bytes(&mut buf[offset..offset+4], &val_len.to_le_bytes());
                offset += 4;
                write_bytes(&mut buf[offset..offset+(val_len as usize)], value);
                offset += val_len as usize;
            }
            offset = write_option_authority(buf, offset, authority);
        },
        // Borsh Plugin variant 7: PermanentTransferDelegate {} (empty struct)
        PluginData::PermanentTransferDelegate { authority } => {
            write_bytes(&mut buf[offset..offset+1], &[7]);
            offset += 1;
            offset = write_option_authority(buf, offset, authority);
        },
        // Borsh Plugin variant 8: PermanentBurnDelegate {} (empty struct)
        PluginData::PermanentBurnDelegate { authority } => {
            write_bytes(&mut buf[offset..offset+1], &[8]);
            offset += 1;
            offset = write_option_authority(buf, offset, authority);
        },
        // Borsh Plugin variant 9: Edition { number: u32 }
        PluginData::Edition { authority, number } => {
            write_bytes(&mut buf[offset..offset+1], &[9]);
            offset += 1;
            write_bytes(&mut buf[offset..offset+4], &number.to_le_bytes());
            offset += 4;
            offset = write_option_authority(buf, offset, authority);
        },
        // Borsh Plugin variant 10: MasterEdition { max_supply: Option<u32>, name: Option<String>, uri: Option<String> }
        PluginData::MasterEdition { authority, max_supply, name, uri } => {
            write_bytes(&mut buf[offset..offset+1], &[10]);
            offset += 1;
            match max_supply {
                Some(s) => {
                    write_bytes(&mut buf[offset..offset+1], &[1]);
                    offset += 1;
                    write_bytes(&mut buf[offset..offset+4], &s.to_le_bytes());
                    offset += 4;
                },
                None => {
                    write_bytes(&mut buf[offset..offset+1], &[0]);
                    offset += 1;
                },
            }
            offset = write_option_string(buf, offset, name);
            offset = write_option_string(buf, offset, uri);
            offset = write_option_authority(buf, offset, authority);
        },
        // Borsh Plugin variant 11: AddBlocker {} (empty struct)
        PluginData::AddBlocker { authority } => {
            write_bytes(&mut buf[offset..offset+1], &[11]);
            offset += 1;
            offset = write_option_authority(buf, offset, authority);
        },
        // Borsh Plugin variant 12: ImmutableMetadata {} (empty struct)
        PluginData::ImmutableMetadata { authority } => {
            write_bytes(&mut buf[offset..offset+1], &[12]);
            offset += 1;
            offset = write_option_authority(buf, offset, authority);
        },
        // Borsh Plugin variant 13: VerifiedCreators { signatures: Vec<VerifiedCreatorsSignature> }
        // VerifiedCreatorsSignature = { address: Pubkey, verified: bool }
        PluginData::VerifiedCreators { authority, signatures } => {
            write_bytes(&mut buf[offset..offset+1], &[13]);
            offset += 1;
            let count = signatures.len() as u32;
            write_bytes(&mut buf[offset..offset+4], &count.to_le_bytes());
            offset += 4;
            for (address, verified) in *signatures {
                write_bytes(&mut buf[offset..offset+32], *address);
                offset += 32;
                write_bytes(&mut buf[offset..offset+1], &[*verified as u8]);
                offset += 1;
            }
            offset = write_option_authority(buf, offset, authority);
        },
        // Borsh Plugin variant 14: Autograph { signatures: Vec<AutographSignature> }
        // AutographSignature = { address: Pubkey, message: String }
        PluginData::Autograph { authority, signatures } => {
            write_bytes(&mut buf[offset..offset+1], &[14]);
            offset += 1;
            let count = signatures.len() as u32;
            write_bytes(&mut buf[offset..offset+4], &count.to_le_bytes());
            offset += 4;
            for (address, message) in *signatures {
                write_bytes(&mut buf[offset..offset+32], *address);
                offset += 32;
                let msg_len = message.len() as u32;
                write_bytes(&mut buf[offset..offset+4], &msg_len.to_le_bytes());
                offset += 4;
                write_bytes(&mut buf[offset..offset+message.len()], message);
                offset += message.len();
            }
            offset = write_option_authority(buf, offset, authority);
        },
        // Borsh Plugin variant 15: BubblegumV2 {} (empty struct)
        PluginData::BubblegumV2 { authority } => {
            write_bytes(&mut buf[offset..offset+1], &[15]);
            offset += 1;
            offset = write_option_authority(buf, offset, authority);
        },
        // Borsh Plugin variant 16: FreezeExecute { frozen: bool }
        PluginData::FreezeExecute { authority, frozen } => {
            write_bytes(&mut buf[offset..offset+1], &[16]);
            offset += 1;
            write_bytes(&mut buf[offset..offset+1], &[*frozen as u8]);
            offset += 1;
            offset = write_option_authority(buf, offset, authority);
        },
        // Borsh Plugin variant 17: PermanentFreezeExecute { frozen: bool }
        PluginData::PermanentFreezeExecute { authority, frozen } => {
            write_bytes(&mut buf[offset..offset+1], &[17]);
            offset += 1;
            write_bytes(&mut buf[offset..offset+1], &[*frozen as u8]);
            offset += 1;
            offset = write_option_authority(buf, offset, authority);
        },
    }
    offset
}

/// Write `Option<Authority>` as `Some(authority)`.
pub fn write_option_authority(buf: &mut [MaybeUninit<u8>], mut offset: usize, authority: &PluginAuthority) -> usize {
    write_bytes(&mut buf[offset..offset+1], &[1]); // Some
    offset += 1;
    write_authority(buf, offset, authority)
}

/// Write Borsh `Authority` enum.
pub fn write_authority(buf: &mut [MaybeUninit<u8>], mut offset: usize, authority: &PluginAuthority) -> usize {
    match authority {
        PluginAuthority::None => {
            write_bytes(&mut buf[offset..offset+1], &[0]);
            offset += 1;
        }
        PluginAuthority::Owner => {
            write_bytes(&mut buf[offset..offset+1], &[1]);
            offset += 1;
        }
        PluginAuthority::UpdateAuthority => {
            write_bytes(&mut buf[offset..offset+1], &[2]);
            offset += 1;
        }
        PluginAuthority::Address(pubkey) => {
            write_bytes(&mut buf[offset..offset+1], &[3]);
            offset += 1;
            write_bytes(&mut buf[offset..offset+32], pubkey);
            offset += 32;
        }
    }
    offset
}

/// Write Borsh `Option<String>`. Empty slice = None.
fn write_option_string(buf: &mut [MaybeUninit<u8>], mut offset: usize, s: &[u8]) -> usize {
    if !s.is_empty() {
        write_bytes(&mut buf[offset..offset+1], &[1]); // Some
        offset += 1;
        let len = s.len() as u32;
        write_bytes(&mut buf[offset..offset+4], &len.to_le_bytes());
        offset += 4;
        write_bytes(&mut buf[offset..offset+s.len()], s);
        offset += s.len();
    } else {
        write_bytes(&mut buf[offset..offset+1], &[0]); // None
        offset += 1;
    }
    offset
}

/// Write Borsh `RuleSet` enum.
fn write_rule_set(buf: &mut [MaybeUninit<u8>], mut offset: usize, rule_set: &RuleSetData) -> usize {
    match rule_set {
        RuleSetData::None => {
            write_bytes(&mut buf[offset..offset+1], &[0]);
            offset += 1;
        },
        RuleSetData::ProgramAllowList(programs) => {
            write_bytes(&mut buf[offset..offset+1], &[1]);
            offset += 1;
            let count = programs.len() as u32;
            write_bytes(&mut buf[offset..offset+4], &count.to_le_bytes());
            offset += 4;
            for program in *programs {
                write_bytes(&mut buf[offset..offset+32], *program);
                offset += 32;
            }
        },
        RuleSetData::ProgramDenyList(programs) => {
            write_bytes(&mut buf[offset..offset+1], &[2]);
            offset += 1;
            let count = programs.len() as u32;
            write_bytes(&mut buf[offset..offset+4], &count.to_le_bytes());
            offset += 4;
            for program in *programs {
                write_bytes(&mut buf[offset..offset+32], *program);
                offset += 32;
            }
        },
    }
    offset
}

/// Add a plugin to an MPL Core Asset V1.
///
/// ### Accounts:
///   0. `[WRITE]` The asset
///   1. `[WRITE, OPTIONAL]` The collection
///   2. `[WRITE, SIGNER]` The payer
///   3. `[SIGNER, OPTIONAL]` The authority
///   4. `[]` The system program
///   5. `[OPTIONAL]` The SPL Noop Program
pub struct AddPluginV1<'a> {
    pub asset: &'a AccountView,
    pub collection: &'a AccountView,
    pub payer: &'a AccountView,
    pub authority: &'a AccountView,
    pub system_program: &'a AccountView,
    pub log_wrapper: &'a AccountView,
    pub plugin: PluginData<'a>,
}

impl AddPluginV1<'_> {
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

        let mut instruction_data = [UNINIT_BYTE; 1024];
        let mut offset = 0;

        // Discriminator (2 for AddPluginV1)
        write_bytes(&mut instruction_data[offset..offset+1], &[2]);
        offset += 1;

        offset = write_plugin_data(&mut instruction_data, offset, &self.plugin);

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
