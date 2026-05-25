use pinocchio::{
    error::ProgramError,
    sysvars::{clock::Clock, Sysvar},
    AccountView, Address, ProgramResult,
};

use crate::{
    constants::{PLAYER_SEED, USER_SEED},
    emit,
    error::GameError,
    events::UntrackedNoviSwept,
    state::{PlayerCore, UserAccount},
    validation::{require_owner, require_signer, require_writable},
};

/// Recover NOVI that landed in a program-PDA-owned ATA from outside the
/// program (mis-sends, partner transfers, etc.) and is therefore not
/// backed by any state field.
///
/// # Safety
/// State is the source of truth. The sweep can ONLY remove the difference
/// between the (potentially larger) ATA balance and the (authoritative)
/// state value. If the ATA is under-funded (state > balance), the sweep
/// returns silently — `surplus` clamps to zero. No state writes, no error.
///
/// # Accounts
/// - [signer, writable] owner: Wallet that owns the target PDA + receives the surplus
/// - []          pda_account: PlayerAccount (kind=0) or UserAccount (kind=1) PDA
/// - [writable]  source_ata: PDA-owned NOVI ATA being swept
/// - [writable]  wallet_ata: Owner wallet's NOVI ATA — destination of the surplus
/// - []          novi_mint: NOVI mint
/// - []          token_program: SPL Token program
///
/// # Instruction Data
/// - kind: u8 (1 byte) — 0 = PlayerAccount, 1 = UserAccount
pub fn process(program_id: &Address, accounts: &[AccountView], data: &[u8]) -> ProgramResult {
    // 1. Parse Accounts

    crate::extract_accounts!(accounts, exact [
        owner,
        pda_account,
        source_ata,
        wallet_ata,
        novi_mint,
        _token_program,
    ]);

    // 2. Validate Accounts

    require_signer(owner)?;
    require_writable(source_ata)?;
    require_writable(wallet_ata)?;
    require_owner(pda_account, program_id)?;
    crate::require_keys_eq!(
        novi_mint.address().as_array(),
        &crate::constants::NOVI_MINT_ADDRESS,
        "treasury_sweep_untracked_novi.novi_mint",
        GameError::InvalidMint,
    );

    // 3. Parse kind byte

    if data.len() != 1 {
        return Err(ProgramError::InvalidInstructionData);
    }
    let kind = data[0];

    // 4. Validate ATA ownership (PDA-owned) and read live balance.

    if unsafe { source_ata.owner() } != &pinocchio_token::ID {
        return Err(GameError::InvalidTokenAccount.into());
    }
    let ata_balance: u64;
    {
        let ata_data = source_ata.try_borrow()?;
        if ata_data.len() < 72 {
            return Err(GameError::InvalidTokenAccount.into());
        }
        /* SPL Token Account layout: bytes 32..64 = owner, 64..72 = amount LE. */
        if &ata_data[32..64] != pda_account.address().as_ref() {
            return Err(GameError::InvalidTokenAccount.into());
        }
        ata_balance = u64::from_le_bytes(
            ata_data[64..72]
                .try_into()
                .map_err(|_| GameError::InvalidTokenAccount)?,
        );
    }

    {
        if unsafe { wallet_ata.owner() } != &pinocchio_token::ID {
            return Err(GameError::InvalidTokenAccount.into());
        }
        let wallet_data = wallet_ata.try_borrow()?;
        if wallet_data.len() < 64 {
            return Err(GameError::InvalidTokenAccount.into());
        }
        if &wallet_data[32..64] != owner.address().as_ref() {
            return Err(GameError::InvalidTokenAccount.into());
        }
    }

    // 5. Validate the PDA + auth, resolve tracked state + signer seeds.

    let surplus: u64;
    match kind {
        0 => {
            let bump;
            let owner_addr;
            let ge_addr;
            {
                let player = PlayerCore::load_checked_by_key(pda_account, program_id)?;
                if &player.owner != owner.address() {
                    return Err(GameError::Unauthorized.into());
                }
                if ata_balance <= player.locked_novi {
                    /* No surplus — silent no-op. Borrow drops here. */
                    return Ok(());
                }
                surplus = ata_balance - player.locked_novi;
                bump = player.bump;
                owner_addr = player.owner;
                ge_addr = player.game_engine;
            }
            let bump_seed = [bump];
            let seeds = crate::seeds!(
                PLAYER_SEED,
                ge_addr.as_ref(),
                owner_addr.as_ref(),
                &bump_seed
            );
            let signer = pinocchio::cpi::Signer::from(&seeds);
            crate::helpers::transfer_tokens(
                source_ata,
                wallet_ata,
                pda_account,
                surplus,
                &[signer],
            )?;
        }
        1 => {
            let bump;
            let owner_addr;
            {
                let user_data = UserAccount::load_checked_by_key(pda_account, program_id)?;
                if &user_data.owner != owner.address() {
                    return Err(GameError::Unauthorized.into());
                }
                if ata_balance <= user_data.reserved_novi {
                    return Ok(());
                }
                surplus = ata_balance - user_data.reserved_novi;
                bump = user_data.bump;
                owner_addr = user_data.owner;
            }
            let bump_seed = [bump];
            let seeds = crate::seeds!(USER_SEED, owner_addr.as_ref(), &bump_seed);
            let signer = pinocchio::cpi::Signer::from(&seeds);
            crate::helpers::transfer_tokens(
                source_ata,
                wallet_ata,
                pda_account,
                surplus,
                &[signer],
            )?;
        }
        _ => return Err(GameError::InvalidParameter.into()),
    }

    // 6. Emit Event

    let clock = Clock::get()?;
    emit!(UntrackedNoviSwept {
        source_ata: *source_ata.address(),
        treasury_ata: *wallet_ata.address(),
        amount: surplus,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
