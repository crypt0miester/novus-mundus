use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
    ProgramResult,
    sysvars::{Sysvar, rent::Rent},
};
use pinocchio_system::instructions::CreateAccount;

use crate::{
    state::{PlayerAccount, ResearchProgress, unlock_extension_if_eligible, EXT_RESEARCH},
    validation::{
        require_signer,
        require_writable,
        require_key_match,
    },
    constants::RESEARCH_SEED,
};

/// Create research progress account for a player
///
/// Creates a ResearchProgress PDA to track the player's research state.
/// This account stores completed research levels and economy buffs.
/// **This unlocks the EXT_RESEARCH extension on the player account.**
///
/// # Accounts
/// - [signer] player_owner: Player's wallet
/// - [writable] research_progress: ResearchProgress PDA to create
/// - [writable] player_account: PlayerAccount PDA (verify ownership, unlock extension)
/// - [writable] payer: Pays rent (can be same as player_owner)
/// - [] system_program
///
/// # Instruction Data
/// None
pub fn process(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    _instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse accounts
    let [player_owner, research_progress, player_account, payer, system_program] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // 2. Validate accounts
    require_signer(player_owner)?;
    require_signer(payer)?;
    require_writable(research_progress)?;
    require_writable(player_account)?;
    require_writable(payer)?;
    require_key_match(system_program, &pinocchio_system::ID)?;

    // 3. Verify player account ownership (scoped borrow)
    {
        let player_data = player_account.try_borrow_data()?;
        let player = unsafe { PlayerAccount::load(&player_data) };

        if !player.is_owner(player_owner.key()) {
            return Err(ProgramError::IllegalOwner);
        }
    }

    // 4. Derive and verify Research Progress PDA
    let (expected_progress, bump) = ResearchProgress::derive_pda(player_owner.key());

    if research_progress.key() != &expected_progress {
        return Err(ProgramError::InvalidSeeds);
    }

    // 5. Create ResearchProgress account
    let lamports = Rent::get()?.minimum_balance(ResearchProgress::LEN);

    let bump_seed = [bump];
    let seeds = pinocchio::seeds!(RESEARCH_SEED, player_owner.key().as_ref(), &bump_seed);
    let signer = pinocchio::instruction::Signer::from(&seeds);

    CreateAccount {
        from: payer,
        to: research_progress,
        lamports,
        space: ResearchProgress::LEN as u64,
        owner: program_id,
    }.invoke_signed(&[signer])?;

    // 6. Initialize research progress
    let mut progress_data = research_progress.try_borrow_mut_data()?;
    let progress = unsafe { ResearchProgress::load_mut(&mut progress_data) };

    *progress = ResearchProgress::init(*player_owner.key(), bump);

    // 7. Unlock EXT_RESEARCH extension on player account
    // This is the first step in the user journey - no prerequisites
    {
        let mut player_data = player_account.try_borrow_mut_data()?;
        let player = unsafe { PlayerAccount::load_mut(&mut player_data) };
        unlock_extension_if_eligible(player_account, payer, player, EXT_RESEARCH)?;
    }

    Ok(())
}