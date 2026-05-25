use pinocchio::{error::ProgramError, AccountView, Address, ProgramResult};

use pinocchio::sysvars::{clock::Clock, Sysvar};

use crate::{
    emit,
    error::GameError,
    events::VaultTransfer,
    helpers::estate::{load_estate_for_player, require_vault},
    state::{GameEngine, PlayerAccount},
    utils::{read_u64, read_u8},
    validation::{require_owner, require_signer, require_writable},
};

/// Transfer cash between hand and vault
///
/// Allows players to deposit cash into their vault for raid protection,
/// or withdraw for spending. Requires Vault building.
///
/// # Safebox System
/// - Up to safebox_protection_percent (75%) of total cash can be stored in vault
/// - At least 25% must remain on hand (lootable during attacks)
/// - If deposit exceeds limit, only the allowed amount is deposited
///
/// # Accounts
/// - [signer] owner: Player's wallet
/// - [writable] player_account: PlayerAccount PDA
/// - [] estate_account: EstateAccount PDA (for Vault requirement)
/// - [] game_engine: GameEngine PDA (for safebox_protection_percent)
///
/// # Instruction Data
/// - [0] direction: u8 (0 = deposit: hand→vault, 1 = withdraw: vault→hand)
/// - [1..9] amount: u64 (little-endian)
pub fn process(
    program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Accounts
    crate::extract_accounts!(accounts, exact [owner, player_account, estate_account, game_engine_account]);

    // 2. Validate Accounts
    require_signer(owner)?;
    require_writable(player_account)?;
    require_owner(player_account, program_id)?;

    // 3. Parse Instruction Data
    let direction = read_u8(instruction_data, 0, "vault_transfer.direction")?;
    let amount = read_u64(instruction_data, 1, "vault_transfer.amount")?;

    if amount == 0 {
        return Err(GameError::InvalidAmount.into());
    }

    // Direction: 0 = deposit (hand→vault), 1 = withdraw (vault→hand)
    if direction > 1 {
        return Err(ProgramError::InvalidInstructionData);
    }

    // 4. Load Player Account
    let mut player_data_ref = player_account.try_borrow_mut()?;
    let player = unsafe { PlayerAccount::load_mut(&mut player_data_ref) };

    // Verify ownership
    if !player.is_owner(owner.address()) {
        return Err(GameError::Unauthorized.into());
    }

    // 5. Load Estate and Validate Vault Requirement
    let estate = load_estate_for_player(estate_account, player, program_id)?;

    // Vault Lv.1+ required for deposit/withdraw
    require_vault(estate, 1)?;

    // Get current timestamp
    let now = Clock::get()?.unix_timestamp;

    // 6. Execute Transfer
    let (actual_amount, to_vault) = if direction == 0 {
        // Deposit: hand → vault

        // Validate game_engine account (ownership + PDA + discriminator + bump)
        let game_engine = GameEngine::load_checked_by_key(game_engine_account, program_id)?;

        // Calculate max allowed in vault (e.g., 75% of total)
        let total_cash = player.cash_on_hand.saturating_add(player.cash_in_vault);
        let base_max_in_vault = total_cash
            .saturating_mul(game_engine.gameplay_config.safebox_protection_percent as u64)
            / 10000;

        // Apply hero resource capacity buff (increases vault storage limit)
        let max_in_vault = if player.hero_resource_capacity_bps() > 0 {
            let multiplier = 10000u64 + player.hero_resource_capacity_bps() as u64;
            base_max_in_vault.saturating_mul(multiplier) / 10000
        } else {
            base_max_in_vault
        };

        // How much room is left in vault?
        let available_space = max_in_vault.saturating_sub(player.cash_in_vault);

        // Cap deposit to available space and what player has on hand
        let actual_deposit = amount.min(available_space).min(player.cash_on_hand);

        if actual_deposit > 0 {
            player.cash_on_hand = player.cash_on_hand.saturating_sub(actual_deposit);
            player.cash_in_vault = player.cash_in_vault.saturating_add(actual_deposit);
        }
        (actual_deposit, true)
    } else {
        // Withdraw: vault → hand (no limit)
        let actual_withdraw = amount.min(player.cash_in_vault);

        if actual_withdraw > 0 {
            player.cash_in_vault = player.cash_in_vault.saturating_sub(actual_withdraw);
            player.cash_on_hand = player.cash_on_hand.saturating_add(actual_withdraw);
        }
        (actual_withdraw, false)
    };

    // Emit VaultTransfer event if actual transfer occurred
    if actual_amount > 0 {
        emit!(VaultTransfer {
            player: *player_account.address(),
            player_name: player.name,
            amount: actual_amount,
            to_vault,
            vault_balance: player.cash_in_vault,
            timestamp: now,
        });
    }

    Ok(())
}
