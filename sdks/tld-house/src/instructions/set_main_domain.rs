use pinocchio::{
    account_info::AccountInfo,
    instruction::{AccountMeta, Instruction, Signer},
    program::invoke_signed,
    pubkey::Pubkey,
    ProgramResult,
};

use crate::SET_MAIN_DOMAIN_DISCRIMINATOR;

/// Set main domain for an account.
///
/// Creates or updates a MainDomain account that links the payer to their primary domain.
///
/// ### Accounts:
///   0. `[SIGNER, WRITE]` Payer (domain owner)
///   1. `[]` TldState account
///   2. `[]` TldHouse account
///   3. `[WRITE]` MainDomain account (PDA: ["main_domain", payer.key()])
///   4. `[]` Name class account (usually Pubkey::default())
///   5. `[]` Name account (the domain)
///   6. `[]` Name parent (TLD account)
///   7. `[]` Reverse name account
///   8. `[]` System program
///   9. `[]` Alt Name Service program
pub struct SetMainDomain<'a> {
    pub payer: &'a AccountInfo,
    pub tld_state: &'a AccountInfo,
    pub tld_house: &'a AccountInfo,
    pub main_domain: &'a AccountInfo,
    pub name_class: &'a AccountInfo,
    pub name_account: &'a AccountInfo,
    pub name_parent: &'a AccountInfo,
    pub reverse_name_account: &'a AccountInfo,
    pub system_program: &'a AccountInfo,
    pub name_service_program: &'a AccountInfo,
    /// Domain name without TLD (e.g., "mydomain")
    pub name: &'a [u8],
    /// SHA256("ALT Name Service" + name)
    pub hashed_name: [u8; 32],
    /// TLD string including dot (e.g., ".alldomains")
    pub tld: &'a [u8],
    /// SHA256("ALT Name Service" + name_account.key().to_base58())
    pub reverse_acc_hashed_name: [u8; 32],
}

impl<'a> SetMainDomain<'a> {
    #[inline(always)]
    pub fn invoke(&self) -> ProgramResult {
        self.invoke_signed(&[])
    }

    #[inline(always)]
    pub fn invoke_signed(&self, signers: &[Signer]) -> ProgramResult {
        let account_metas: [AccountMeta; 10] = [
            AccountMeta::writable_signer(self.payer.key()),
            AccountMeta::readonly(self.tld_state.key()),
            AccountMeta::readonly(self.tld_house.key()),
            AccountMeta::writable(self.main_domain.key()),
            AccountMeta::readonly(self.name_class.key()),
            AccountMeta::readonly(self.name_account.key()),
            AccountMeta::readonly(self.name_parent.key()),
            AccountMeta::readonly(self.reverse_name_account.key()),
            AccountMeta::readonly(self.system_program.key()),
            AccountMeta::readonly(self.name_service_program.key()),
        ];

        // Build instruction data with Anchor encoding:
        // - discriminator (8 bytes)
        // - name: String (4 bytes len + data)
        // - hashed_name: Vec<u8> (4 bytes len + 32 bytes data)
        // - tld: String (4 bytes len + data)
        // - reverse_acc_hashed_name: Vec<u8> (4 bytes len + 32 bytes data)

        // Calculate total size
        let data_size = 8 // discriminator
            + 4 + self.name.len() // name string
            + 4 + 32 // hashed_name vec
            + 4 + self.tld.len() // tld string
            + 4 + 32; // reverse_acc_hashed_name vec

        // Max reasonable size: 8 + 4 + 48 + 4 + 32 + 4 + 16 + 4 + 32 = 152 bytes
        // Use stack allocation for efficiency
        let mut data = [0u8; 160];
        let mut offset = 0;

        // Discriminator
        data[offset..offset + 8].copy_from_slice(&SET_MAIN_DOMAIN_DISCRIMINATOR);
        offset += 8;

        // name: String (4 bytes len + data)
        let name_len = self.name.len() as u32;
        data[offset..offset + 4].copy_from_slice(&name_len.to_le_bytes());
        offset += 4;
        data[offset..offset + self.name.len()].copy_from_slice(self.name);
        offset += self.name.len();

        // hashed_name: Vec<u8> (4 bytes len + 32 bytes)
        data[offset..offset + 4].copy_from_slice(&32u32.to_le_bytes());
        offset += 4;
        data[offset..offset + 32].copy_from_slice(&self.hashed_name);
        offset += 32;

        // tld: String (4 bytes len + data)
        let tld_len = self.tld.len() as u32;
        data[offset..offset + 4].copy_from_slice(&tld_len.to_le_bytes());
        offset += 4;
        data[offset..offset + self.tld.len()].copy_from_slice(self.tld);
        offset += self.tld.len();

        // reverse_acc_hashed_name: Vec<u8> (4 bytes len + 32 bytes)
        data[offset..offset + 4].copy_from_slice(&32u32.to_le_bytes());
        offset += 4;
        data[offset..offset + 32].copy_from_slice(&self.reverse_acc_hashed_name);
        offset += 32;

        let instruction = Instruction {
            program_id: &crate::ID,
            accounts: &account_metas,
            data: &data[..data_size],
        };

        invoke_signed(
            &instruction,
            &[
                self.payer,
                self.tld_state,
                self.tld_house,
                self.main_domain,
                self.name_class,
                self.name_account,
                self.name_parent,
                self.reverse_name_account,
                self.system_program,
                self.name_service_program,
            ],
            signers,
        )
    }
}

/// Derive the MainDomain PDA for a given owner.
/// Seeds: ["main_domain", owner.key()]
#[inline]
pub fn derive_main_domain_pda(owner: &Pubkey, tld_house_program_id: &Pubkey) -> (Pubkey, u8) {
    pinocchio::pubkey::find_program_address(
        &[crate::MAIN_DOMAIN_PREFIX, owner.as_ref()],
        tld_house_program_id,
    )
}

/// Derive the TldState PDA.
/// Seeds: ["tld_pda"]
#[inline]
pub fn derive_tld_state_pda(tld_house_program_id: &Pubkey) -> (Pubkey, u8) {
    pinocchio::pubkey::find_program_address(
        &[crate::PDA_SEED],
        tld_house_program_id,
    )
}

/// Derive the TldHouse PDA for a given TLD.
/// Seeds: ["tld_house", tld_lowercase]
#[inline]
pub fn derive_tld_house_pda(tld_lowercase: &[u8], tld_house_program_id: &Pubkey) -> (Pubkey, u8) {
    pinocchio::pubkey::find_program_address(
        &[crate::PREFIX, tld_lowercase],
        tld_house_program_id,
    )
}
