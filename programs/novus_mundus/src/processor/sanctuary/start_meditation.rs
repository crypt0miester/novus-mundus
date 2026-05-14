use pinocchio::{
    AccountView,
    error::ProgramError,
    Address,
    sysvars::{Sysvar, clock::Clock},
    ProgramResult,
};

use crate::{
    error::GameError,
    state::{PlayerAccount, HeroTemplate, NULL_PUBKEY},
    helpers::{
        parse_hero_nft,
        estate::{
            can_meditate, load_estate_for_player, get_sanctuary_level,
            meditation_level_cap, sanctuary_meditation_max_seconds,
        },
    },
    constants::HERO_TEMPLATE_SEED,
    validation::{require_signer, require_writable, require_owner},
    emit,
    events::MeditationStarted,
};

/// Start hero meditation at the Sanctuary
///
/// Meditation is Phase 1 of hero leveling - extremely slow but free.
/// XP accumulates over time and converts to levels at 5000 XP/level.
///
/// Once hero.level >= meditation_cap (φ-based on Sanctuary level),
/// meditation can no longer grant levels - must use fragments (level_up.rs).
///
/// While meditating, the hero is excluded from combat buff calculations.
///
/// # Requirements
/// - Sanctuary building at level 1+
/// - Hero must be locked (in active_heroes slot)
/// - No hero currently meditating
/// - Hero level must be below meditation cap for this Sanctuary
/// - If hero requires specific city (meditation_city_id != 0), player must be there
///
/// # State Changes
/// - Sets player.meditating_hero_slot to the hero's slot index
/// - Sets player.meditation_started_at to current timestamp
///
/// # Accounts
/// - [signer] owner: Player's wallet
/// - [writable] player_account: PlayerAccount PDA
/// - [] hero_mint: Hero NFT mint account (to check level vs cap)
/// - [] hero_template: HeroTemplate PDA (for city requirement)
/// - [] estate_account: EstateAccount PDA (for Sanctuary check)
///
/// # Instruction Data
/// - [0] hero_slot: u8 (0-2, which active_heroes slot)
pub fn process(
    program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Accounts
    let [owner, player_account, hero_mint, hero_template, estate_account] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // 2. Validate Accounts
    require_signer(owner)?;
    require_writable(player_account)?;
    require_owner(player_account, program_id)?;
    require_owner(hero_template, program_id)?;

    // 3. Parse Instruction Data
    if instruction_data.is_empty() {
        return Err(ProgramError::InvalidInstructionData);
    }
    let hero_slot = instruction_data[0];

    if hero_slot >= 3 {
        return Err(GameError::InvalidParameter.into());
    }

    // 4. Get current timestamp
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    // 5. Load Player Account
    let mut player_data = player_account.try_borrow_mut()?;
    let player = unsafe { PlayerAccount::load_mut(&mut player_data) };

    // Verify ownership
    if !player.is_owner(owner.address()) {
        return Err(GameError::Unauthorized.into());
    }

    // 6. Check no hero is already meditating
    if player.is_hero_meditating() {
        return Err(GameError::HeroAlreadyMeditating.into());
    }

    // 7. Verify hero exists in the specified slot
    let slot_hero_mint = player.active_heroes[hero_slot as usize];
    if slot_hero_mint == NULL_PUBKEY {
        return Err(GameError::HeroNotInSlot.into());
    }

    // 8. Verify the passed hero_mint matches the slot
    if hero_mint.address() != &slot_hero_mint {
        return Err(GameError::HeroMismatch.into());
    }

    // 9. Parse hero data from NFT
    // NFT-Only System: All hero state is stored in NFT attributes
    let nft_data = hero_mint.try_borrow()?;
    let parsed_hero = parse_hero_nft(&nft_data)
        .ok_or(GameError::InvalidParameter)?;
    drop(nft_data);

    // 10. Load Hero Template and verify city requirement
    let template_data = hero_template.try_borrow()?;
    let template = unsafe { HeroTemplate::load(&template_data) };

    // Verify template matches hero
    if template.template_id != parsed_hero.template_id {
        return Err(GameError::InvalidParameter.into());
    }

    // Verify template PDA
    let template_id_bytes = parsed_hero.template_id.to_le_bytes();
    let (expected_template_pda, _) = pinocchio::Address::find_program_address(
        &[HERO_TEMPLATE_SEED, &template_id_bytes],
        program_id,
    );
    if hero_template.address() != &expected_template_pda {
        return Err(GameError::InvalidPDA.into());
    }

    // 11. Check city requirement for meditation
    // If meditation_city_id != 0, player MUST be in that specific city
    if template.meditation_city_id != 0 {
        if player.current_city != template.meditation_city_id {
            return Err(GameError::WrongCityForMeditation.into());
        }
    }

    // Save template name for event emission
    let hero_name = template.name;

    drop(template_data);

    // 12. Load Estate and verify MeditationChamber
    let estate = load_estate_for_player(estate_account, player, program_id)?;

    if !can_meditate(estate) {
        return Err(GameError::MeditationChamberRequired.into());
    }

    let sanctuary_level = get_sanctuary_level(estate);

    // 13. Check hero hasn't reached meditation cap
    // Once at cap, must use fragments (level_up.rs) for further leveling
    let cap = meditation_level_cap(sanctuary_level);
    if parsed_hero.level >= cap {
        return Err(GameError::HeroAtMeditationCap.into());
    }

    // 12. Start meditation
    player.meditating_hero_slot = hero_slot;
    player.meditation_started_at = now;

    // 13. Calculate completion time
    let max_duration = sanctuary_meditation_max_seconds(sanctuary_level);
    let completes_at = now.saturating_add(max_duration);
    let duration_hours = (max_duration / 3600) as u8;

    // 14. Emit event
    emit!(MeditationStarted {
        player: *player_account.address(),
        player_name: player.name,
        hero_mint: *hero_mint.address(),
        hero_name,
        duration_hours,
        completes_at,
        timestamp: now,
    });

    Ok(())
}
