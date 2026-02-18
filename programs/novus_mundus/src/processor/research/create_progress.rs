use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
    ProgramResult,
    sysvars::{Sysvar, rent::Rent},
};
use pinocchio_system::instructions::CreateAccount;

use crate::{
    state::{PlayerAccount, ResearchProgress, EXT_RESEARCH},
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

    // 4. Derive and verify Research Progress PDA (scoped to player PDA for multi-kingdom)
    let (expected_progress, bump) = ResearchProgress::derive_pda(player_account.key());

    if research_progress.key() != &expected_progress {
        return Err(ProgramError::InvalidSeeds);
    }

    // 5. Create ResearchProgress account
    let lamports = Rent::get()?.minimum_balance(ResearchProgress::LEN);

    let bump_seed = [bump];
    let seeds = pinocchio::seeds!(RESEARCH_SEED, player_account.key().as_ref(), &bump_seed);
    let signer = pinocchio::instruction::Signer::from(&seeds);

    CreateAccount {
        from: payer,
        to: research_progress,
        lamports,
        space: ResearchProgress::LEN as u64,
        owner: program_id,
    }.invoke_signed(&[signer])?;

    // 6. Initialize research progress (scoped to drop borrow before CPI/resize)
    {
        let mut progress_data = research_progress.try_borrow_mut_data()?;
        let progress = unsafe { ResearchProgress::load_mut(&mut progress_data) };
        *progress = ResearchProgress::init(*player_owner.key(), bump);
    }

    // 7. Unlock EXT_RESEARCH extension on player account
    // This is the first step in the user journey - no prerequisites
    // Must check extensions, drop borrow, resize via CPI, re-borrow, then update flag
    let needs_unlock = {
        let player_data = player_account.try_borrow_data()?;
        let player = unsafe { PlayerAccount::load(&player_data) };
        player.extensions & EXT_RESEARCH == 0
    };

    if needs_unlock {
        use crate::state::size_for_extensions;

        // Calculate new size needed
        let new_extensions = {
            let player_data = player_account.try_borrow_data()?;
            let player = unsafe { PlayerAccount::load(&player_data) };
            player.extensions | EXT_RESEARCH
        };
        let new_size = size_for_extensions(new_extensions);
        let current_size = player_account.data_len();

        if new_size > current_size {
            // Transfer lamports for rent via system program CPI (payer is external wallet)
            let rent = Rent::get()?;
            let required_lamports = rent.minimum_balance(new_size);
            let lamports_needed = required_lamports.saturating_sub(player_account.lamports());

            if lamports_needed > 0 {
                pinocchio_system::instructions::Transfer {
                    from: payer,
                    to: player_account,
                    lamports: lamports_needed,
                }.invoke()?;
            }

            // Resize the account data
            player_account.resize(new_size)?;
        }

        // Re-borrow and set the extension flag
        let mut player_data = player_account.try_borrow_mut_data()?;
        let player = unsafe { PlayerAccount::load_mut(&mut player_data) };
        player.extensions = new_extensions;
    }

    Ok(())
}