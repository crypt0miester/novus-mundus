//! Claim Castle Rewards - Claim daily rewards from castle
//!
//! Instruction 280
//!
//! King, court members, and team members can claim daily rewards
//! based on their role and the castle's tier/treasury level.
//!
//! Token Distribution by Castle Tier:
//! - Outpost, Keep, Stronghold: Mint to locked_novi (not withdrawable)
//! - Fortress, Citadel: Mint to unlocked/reserved_novi (withdrawable)

use pinocchio::{
    AccountView,
    error::ProgramError,
    Address,
    ProgramResult,
    sysvars::{clock::Clock, Sysvar},
};
use pinocchio_system::instructions::CreateAccount;

use crate::{
    emit,
    error::GameError,
    events::CastleRewardsClaimed,
    state::{
        CastleAccount, CastleTier, CourtPositionAccount, TeamCastleRewardAccount,
        PlayerAccount, UserAccount, GameEngine,
        calculate_reward, player::NULL_PUBKEY,
    },
    constants::{TEAM_CASTLE_REWARD_SEED, SECONDS_PER_DAY, GAME_ENGINE_SEED},
    helpers::{mint_tokens, validate_token_account_owner},
    validation::require_owner,
};

/// Role constants for event
const ROLE_KING: u8 = 0;
const ROLE_COURT: u8 = 1;
const ROLE_MEMBER: u8 = 2;

/// Claim Castle Rewards instruction data
/// - city_id: u16 (bytes 2-3)
/// - castle_id: u16 (bytes 4-5)

/// Accounts:
/// 0. [signer] Player wallet
/// 1. [writable] Player account
/// 2. [] Castle account
/// 3. [writable] Team castle reward account (created if doesn't exist)
/// 4. [] System program
/// 5. [optional] Court position account (if claiming as court member)
///
/// For token minting (required):
/// 6. [] Game engine account
/// 7. [writable] NOVI mint
/// 8. [] Token program
/// 9. [writable] Locked token account (owned by PlayerAccount PDA) - for lower tiers
/// 10. [writable] User account - for Fortress/Citadel tiers
/// 11. [writable] Reserved token account (owned by UserAccount PDA) - for Fortress/Citadel tiers

pub fn process(
    program_id: &Address,
    accounts: &[AccountView],
    _instruction_data: &[u8],
) -> ProgramResult {
    // Parse accounts
    if accounts.len() < 10 {
        return Err(ProgramError::NotEnoughAccountKeys);
    }

    crate::extract_accounts!(accounts, [
        player_wallet,
        player_account,
        castle_account,
        reward_account,
        _system_program,
    ]);
    // accounts[5] is optional court position account
    let game_engine_account = &accounts[6];
    let novi_mint = &accounts[7];
    let _token_program = &accounts[8];
    let locked_token_account = &accounts[9];

    // Verify signer
    if !player_wallet.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }

    // Parse instruction data (only discriminator needed, city_id/castle_id from account)

    // Load player
    require_owner(player_account, program_id)?;
    let mut player_data = player_account.try_borrow_mut()?;
    let player = unsafe { PlayerAccount::load_mut(&mut player_data) };

    if &player.owner != player_wallet.address() {
        return Err(GameError::Unauthorized.into());
    }

    // Load castle (immutable, kingdom-scoped)
    let castle = CastleAccount::load_checked_by_key(castle_account, program_id)?;

    // Get castle tier
    let tier = CastleTier::from_u8(castle.tier).ok_or(GameError::InvalidCastleTier)?;
    let is_high_tier = matches!(tier, CastleTier::Fortress | CastleTier::Citadel);

    // Verify castle has a king (for Citadel) or team (for lower tiers)
    if tier.has_king() && castle.king == NULL_PUBKEY {
        return Err(GameError::CastleNotVacant.into());
    }

    // Determine role and base rewards
    let (role, base_novi, base_cash) = if tier.has_king() && castle.king == *player_account.address() {
        // Player is the king (Citadel only)
        (ROLE_KING, castle.king_novi_per_day, castle.king_cash_per_day)
    } else if player.team_address() == castle.team && castle.team != NULL_PUBKEY {
        // Check if court member (Citadel only)
        let is_court = if tier.has_court() && accounts.len() > 5 {
            let court_account = &accounts[5];
            if unsafe { court_account.owner() } == program_id && court_account.data_len() > 0 {
                let court_data = court_account.try_borrow()?;
                let court = unsafe { CourtPositionAccount::load(&court_data) };
                court.holder == *player_account.address() && court.castle == *castle_account.address()
            } else {
                false
            }
        } else {
            false
        };

        if is_court {
            (ROLE_COURT, castle.court_novi_per_day, castle.court_cash_per_day)
        } else {
            // Regular team member
            (ROLE_MEMBER, castle.member_novi_per_day, castle.member_cash_per_day)
        }
    } else {
        // Not on castle's team
        return Err(GameError::NotOnKingsTeam.into());
    };

    // Get current timestamp
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    // Verify reward PDA
    let (expected_reward_pda, reward_bump) = TeamCastleRewardAccount::derive_pda(
        castle_account.address(),
        player_account.address(),
    );
    if reward_account.address() != &expected_reward_pda {
        return Err(GameError::InvalidPDA.into());
    }

    // Create reward account if doesn't exist
    let was_brand_new = reward_account.data_len() == 0;
    if was_brand_new {
        let lamports = crate::utils::rent_exempt_const(TeamCastleRewardAccount::LEN);

        let bump_seed = [reward_bump];
        let seeds = crate::seeds!(
            TEAM_CASTLE_REWARD_SEED,
            castle_account.address(),
            player_account.address(),
            &bump_seed
        );
        let signer = pinocchio::cpi::Signer::from(&seeds);

        CreateAccount {
            from: player_wallet,
            to: reward_account,
            lamports,
            space: TeamCastleRewardAccount::LEN as u64,
            owner: program_id,
        }.invoke_signed(&[signer])?;

        // Initialize reward account
        let mut reward_data = reward_account.try_borrow_mut()?;
        let reward = unsafe { TeamCastleRewardAccount::load_mut(&mut reward_data) };

        reward.account_key = crate::state::AccountKey::TeamCastleReward as u8;
        reward.castle = *castle_account.address();
        reward.member = *player_account.address();
        reward.bump = reward_bump;
        // Start accruing rewards from max(castle.claimed_at,
        // player_joined_team_at) to prevent late-joining team members from
        // collecting retroactive rewards for time before they were on the team.
        // We use `now` as a conservative proxy: brand-new TeamCastleReward
        // accounts can only have accrued rewards from this moment forward.
        // (player.team_joined_at is not currently tracked granularly; using
        // `now` is safe and prevents the exploit. If a per-team join timestamp
        // is added later, swap to max(castle.claimed_at, player_joined_team_at).)
        reward.last_claim_at = now;
        reward.total_claimed_novi = 0;
    }

    // Load reward account
    let mut reward_data = reward_account.try_borrow_mut()?;
    let reward = unsafe { TeamCastleRewardAccount::load_mut(&mut reward_data) };

    // Calculate elapsed days
    let elapsed_seconds = now.saturating_sub(reward.last_claim_at);
    let elapsed_days = (elapsed_seconds / SECONDS_PER_DAY) as u64;

    if elapsed_days == 0 {
        // First-touch on a brand-new account: persist the init (last_claim_at = now)
        // so the next call ≥ 1 day later actually accrues. Erroring here would
        // roll back the CreateAccount CPI and leave the user with no account at all.
        if was_brand_new {
            return Ok(());
        }
        return Err(GameError::NoRewardsToClaim.into());
    }

    // Cap at 7 days to prevent excessive accumulation
    let days = elapsed_days.min(7);

    // Calculate rewards with tier multiplier and treasury bonus
    let novi_reward = calculate_reward(
        base_novi,
        castle.tier_multiplier_bps,
        castle.treasury_level,
        days,
    );

    let cash_reward = calculate_reward(
        base_cash,
        castle.tier_multiplier_bps,
        castle.treasury_level,
        days,
    );

    // Load game engine for mint authority (kingdom-scoped)
    let game_engine = GameEngine::load_checked_by_key(game_engine_account, program_id)?;

    // Create GameEngine PDA signer for minting
    let ge_bump_seed = [game_engine.bump];
    let kingdom_id_bytes = game_engine.kingdom_id.to_le_bytes();
    let ge_seeds = crate::seeds!(GAME_ENGINE_SEED, &kingdom_id_bytes, &ge_bump_seed);
    let ge_signer = pinocchio::cpi::Signer::from(&ge_seeds);

    // Mint NOVI tokens based on tier
    if novi_reward > 0 {
        crate::require_keys_eq!(
            novi_mint.address().as_array(),
            &crate::constants::NOVI_MINT_ADDRESS,
            "claim_castle_rewards.novi_mint",
            GameError::InvalidMint,
        );
        if is_high_tier {
            // Fortress/Citadel: Mint to reserved (unlocked, withdrawable)
            if accounts.len() < 12 {
                return Err(ProgramError::NotEnoughAccountKeys);
            }
            let user_account = &accounts[10];
            let reserved_token_account = &accounts[11];

            // Verify user account
            require_owner(user_account, program_id)?;
            let mut user_data = user_account.try_borrow_mut()?;
            let user = unsafe { UserAccount::load_mut(&mut user_data) };

            if &user.owner != player_wallet.address() {
                return Err(GameError::Unauthorized.into());
            }

            // Verify reserved token account belongs to the UserAccount PDA
            drop(user_data);
            validate_token_account_owner(reserved_token_account, user_account.address())?;
            // Re-acquire user borrow for the post-mint balance update below
            let mut user_data = user_account.try_borrow_mut()?;
            let user = unsafe { UserAccount::load_mut(&mut user_data) };

            // Mint tokens to reserved token account
            mint_tokens(
                novi_mint,
                reserved_token_account,
                game_engine_account,
                novi_reward,
                &[ge_signer],
            )?;

            // Update cached balance
            user.reserved_novi = user.reserved_novi.saturating_add(novi_reward);
        } else {
            // Lower tiers: Mint to locked (not withdrawable)
            // Verify locked token account belongs to the PlayerAccount PDA
            validate_token_account_owner(locked_token_account, player_account.address())?;
            // Mint tokens to locked token account (owned by PlayerAccount PDA)
            mint_tokens(
                novi_mint,
                locked_token_account,
                game_engine_account,
                novi_reward,
                &[ge_signer],
            )?;

            // Update cached balance
            player.locked_novi = player.locked_novi.saturating_add(novi_reward);
            player.total_locked_novi_acquired = player.total_locked_novi_acquired.saturating_add(novi_reward);
        }
    }

    // Grant cash rewards (always in-game, no token)
    player.cash_on_hand = player.cash_on_hand.saturating_add(cash_reward);

    // Update reward tracking
    reward.last_claim_at = now;
    reward.total_claimed_novi = reward.total_claimed_novi.saturating_add(novi_reward);

    // Copy player name for event
    let mut player_name = [0u8; 48];
    player_name.copy_from_slice(&player.name);

    // Emit event
    emit!(CastleRewardsClaimed {
        castle: *castle_account.address(),
        castle_name: castle.name,
        claimer: *player_account.address(),
        claimer_name: player_name,
        role,
        days: days as u8,
        novi: novi_reward,
        cash: cash_reward,
        timestamp: now,
    });

    Ok(())
}
