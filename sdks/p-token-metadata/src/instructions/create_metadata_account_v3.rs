use core::slice::from_raw_parts;

use pinocchio::{
    cpi::{invoke_signed, Signer},
    instruction::{InstructionAccount, InstructionView},
    AccountView, ProgramResult,
};

use crate::{write_bytes, UNINIT_BYTE};

/// Create Metadata Account V3 (Token Metadata instruction #33).
///
/// Creates the on-chain metadata (name / symbol / uri) for an SPL mint. The
/// `mint_authority` must sign — for a PDA-owned mint, pass the PDA signer to
/// `invoke_signed`. Metadata is created mutable with no creators/collection/uses.
///
/// ### Accounts:
///   0. `[WRITE]` Metadata account — PDA `["metadata", token_metadata_program, mint]`
///   1. `[]` Mint
///   2. `[SIGNER]` Mint authority
///   3. `[WRITE, SIGNER]` Payer
///   4. `[]` Update authority
///   5. `[]` System program
pub struct CreateMetadataAccountV3<'a> {
    pub metadata: &'a AccountView,
    pub mint: &'a AccountView,
    pub mint_authority: &'a AccountView,
    pub payer: &'a AccountView,
    pub update_authority: &'a AccountView,
    pub system_program: &'a AccountView,
    pub name: &'a [u8],
    pub symbol: &'a [u8],
    pub uri: &'a [u8],
}

impl CreateMetadataAccountV3<'_> {
    // Deliberately NOT #[inline(always)] (unlike p-core's builders): the 512-byte
    // instruction buffer must live in this function's own stack frame, not be
    // inlined into a large caller like game_engine::process (4KB BPF frame limit).
    #[inline(never)]
    pub fn invoke_signed(&self, signers: &[Signer]) -> ProgramResult {
        let account_metas = [
            InstructionAccount::writable(self.metadata.address()),
            InstructionAccount::readonly(self.mint.address()),
            InstructionAccount::readonly_signer(self.mint_authority.address()),
            InstructionAccount::writable_signer(self.payer.address()),
            InstructionAccount::readonly(self.update_authority.address()),
            InstructionAccount::readonly(self.system_program.address()),
        ];

        // Metaplex caps: name 32, symbol 10, uri 200.
        let name_len = self.name.len().min(32);
        let symbol_len = self.symbol.len().min(10);
        let uri_len = self.uri.len().min(200);

        // 1 (disc) + 3×(4 len) + fields + 2 (sfbp) + 3 (None×3) + 1 (is_mutable)
        // + 1 (collection_details None). 512 is comfortably above the max.
        let mut instruction_data = [UNINIT_BYTE; 512];
        let mut offset = 0;

        // Discriminator: 33 = CreateMetadataAccountV3
        write_bytes(&mut instruction_data[offset..offset + 1], &[33]);
        offset += 1;

        // DataV2.name (Borsh String)
        write_bytes(&mut instruction_data[offset..offset + 4], &(name_len as u32).to_le_bytes());
        offset += 4;
        write_bytes(&mut instruction_data[offset..offset + name_len], &self.name[..name_len]);
        offset += name_len;

        // DataV2.symbol
        write_bytes(&mut instruction_data[offset..offset + 4], &(symbol_len as u32).to_le_bytes());
        offset += 4;
        write_bytes(&mut instruction_data[offset..offset + symbol_len], &self.symbol[..symbol_len]);
        offset += symbol_len;

        // DataV2.uri
        write_bytes(&mut instruction_data[offset..offset + 4], &(uri_len as u32).to_le_bytes());
        offset += 4;
        write_bytes(&mut instruction_data[offset..offset + uri_len], &self.uri[..uri_len]);
        offset += uri_len;

        // DataV2.seller_fee_basis_points: u16 = 0
        write_bytes(&mut instruction_data[offset..offset + 2], &[0, 0]);
        offset += 2;

        // DataV2.creators / collection / uses: Option = None (0) each
        write_bytes(&mut instruction_data[offset..offset + 3], &[0, 0, 0]);
        offset += 3;

        // is_mutable: bool = true
        write_bytes(&mut instruction_data[offset..offset + 1], &[1]);
        offset += 1;

        // collection_details: Option = None (0)
        write_bytes(&mut instruction_data[offset..offset + 1], &[0]);
        offset += 1;

        let instruction = InstructionView {
            program_id: &crate::ID,
            accounts: &account_metas,
            data: unsafe { from_raw_parts(instruction_data.as_ptr() as _, offset) },
        };

        invoke_signed(
            &instruction,
            &[
                self.metadata,
                self.mint,
                self.mint_authority,
                self.payer,
                self.update_authority,
                self.system_program,
            ],
            signers,
        )
    }
}
