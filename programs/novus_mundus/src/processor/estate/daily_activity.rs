use pinocchio::{
    error::ProgramError,
    sysvars::{clock::Clock, Sysvar},
    AccountView, Address, ProgramResult,
};

use crate::{
    constants::GAME_ENGINE_SEED,
    error::GameError,
    helpers::{
        estate::{academy_daily_time_reduction, has_building},
        mint_tokens, validate_token_account_owner,
    },
    state::{
        BuildingType, EstateAccount, GameEngine, PlayerAccount, ResearchProgress, NULL_PUBKEY,
    },
    validation::{require_signer, require_writable},
};

// Time Window Constants

/// Hours after dawn_timestamp for each window
const DAWN_END_HOURS: i64 = 3;
const MIDDAY_START_HOURS: i64 = 4;
const MIDDAY_END_HOURS: i64 = 8;
const DUSK_START_HOURS: i64 = 9;
const DUSK_END_HOURS: i64 = 16;

const SECONDS_PER_HOUR: i64 = 3600;

/// Time windows for daily activities
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TimeWindow {
    Dawn,
    Midday,
    Dusk,
    Expired,
}

/// Window completion bitflags (0b00000DML)
const WINDOW_DAWN: u8 = 0b001;
const WINDOW_MIDDAY: u8 = 0b010;
const WINDOW_DUSK: u8 = 0b100;

// Building Window Assignments

/// Get which window(s) a building's mini-game can be played in
fn building_allowed_windows(building_type: BuildingType) -> &'static [TimeWindow] {
    match building_type {
        // Dawn only
        BuildingType::Barracks => &[TimeWindow::Dawn],

        // Dawn or Midday
        BuildingType::Workshop => &[TimeWindow::Dawn, TimeWindow::Midday],
        BuildingType::Dock => &[TimeWindow::Dawn, TimeWindow::Midday], // Like Workshop
        BuildingType::Vault => &[TimeWindow::Dawn, TimeWindow::Midday],
        BuildingType::Forge => &[TimeWindow::Dawn, TimeWindow::Midday],

        // Midday only
        BuildingType::Market => &[TimeWindow::Midday],
        BuildingType::Academy => &[TimeWindow::Midday],
        BuildingType::Arena => &[TimeWindow::Midday],

        // Dusk only
        BuildingType::MeditationChamber => &[TimeWindow::Dusk],
        BuildingType::Observatory => &[TimeWindow::Dusk],
        BuildingType::Treasury => &[TimeWindow::Dusk],
        BuildingType::Citadel => &[TimeWindow::Dusk],

        // Expansion buildings
        BuildingType::Camp => &[TimeWindow::Dawn], // Military, like Barracks
        BuildingType::Mine => &[TimeWindow::Dawn, TimeWindow::Midday], // Like Workshop
        BuildingType::Farm => &[TimeWindow::Dawn, TimeWindow::Midday], // Morning chores
        BuildingType::DungeonEntry => &[TimeWindow::Dusk], // Nighttime exploration
        BuildingType::TransportBay => &[TimeWindow::Midday], // Midday travel prep
        BuildingType::Infirmary => &[TimeWindow::Dusk], // Evening care

        // Mansion handled by daily_claim.rs (any time)
        BuildingType::Mansion => &[],
    }
}

/// Get the bitflag for a building type (1 << building_type)
/// Returns 0 for buildings >= 16 (tracked via expansion_daily instead)
fn building_bitflag(building_type: BuildingType) -> u16 {
    let bit = building_type as u8;
    if bit >= 16 {
        0
    } else {
        1u16 << bit
    }
}

/// Get the expansion bitflag for buildings 16+ (bit 0 = type 16, bit 1 = type 17, etc.)
fn expansion_bitflag(building_type: BuildingType) -> u8 {
    let bit = building_type as u8;
    if bit < 16 {
        0
    } else {
        1u8 << (bit - 16)
    }
}

// Daily Activity Processor

/// Complete Building Mini-Game
///
/// Records completion of a building's daily mini-game activity.
/// Game server must co-sign to validate the score.
///
/// # Time Windows (relative to first activity of day)
/// - Dawn: Hours 0-3
/// - Midday: Hours 4-8
/// - Dusk: Hours 9-16
/// - Expired: After hour 16
///
/// # Building → Window Mapping
/// - Dawn: Barracks
/// - Dawn/Midday: Workshop, Vault, Forge
/// - Midday: Market, Academy, Arena
/// - Dusk: Sanctuary, Observatory, Treasury, Citadel
///
/// # Accounts
/// - [signer] owner: Player's wallet
/// - [signer] game_authority: Game server (validates score)
/// - [writable] player_account: PlayerAccount PDA
/// - [writable] estate_account: EstateAccount PDA
/// - [] game_engine: GameEngine (for game_authority validation + mint authority)
/// - [] hero_mint: Hero NFT mint to bless (required for Sanctuary, pass NULL_PUBKEY otherwise)
/// - [writable] player_token_account: (Optional) Player's NOVI token account (required for Treasury)
/// - [writable] novi_mint: (Optional) NOVI token mint (required for Treasury)
/// - [writable] research_progress: (Optional) ResearchProgress PDA (required for Academy)
///
/// # Instruction Data
/// - building_type: u8 (1 byte) - BuildingType enum
/// - score: u8 (1 byte) - Score 0-100 from mini-game
pub fn process(
    program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Accounts (6 required, 3 optional)
    crate::extract_accounts!(
        accounts,
        [
            owner,
            game_authority,
            player_account,
            estate_account,
            game_engine_account,
            hero_mint, // Required for Sanctuary, otherwise NULL_PUBKEY
        ]
    );

    // Optional accounts
    let player_token_account = accounts.get(6); // For Treasury minting
    let novi_mint = accounts.get(7); // For Treasury minting
    let research_progress = accounts.get(8); // For Academy time reduction

    // 2. Validate Accounts
    require_signer(owner)?;
    require_signer(game_authority)?;
    require_writable(player_account)?;
    require_writable(estate_account)?;

    // 3. Parse Instruction Data
    if instruction_data.len() < 2 {
        return Err(ProgramError::InvalidInstructionData);
    }
    let building_type =
        BuildingType::from_u8(instruction_data[0]).ok_or(ProgramError::InvalidInstructionData)?;
    let score = instruction_data[1].min(100); // Cap at 100

    // 4. Validate game_authority against GameEngine
    // Validate game_engine account (ownership + PDA + discriminator + bump)
    let game_engine = GameEngine::load_checked_by_key(game_engine_account, program_id)?;

    if game_authority.address() != &game_engine.game_authority {
        return Err(GameError::Unauthorized.into());
    }

    // 5. Load Accounts
    let mut player_data_ref = player_account.try_borrow_mut()?;
    let player_data = unsafe { PlayerAccount::load_mut(&mut player_data_ref) };

    let mut estate_data_ref = estate_account.try_borrow_mut()?;
    let estate_data = unsafe { EstateAccount::load_mut(&mut estate_data_ref) };

    // 6. Verify ownership
    if &player_data.owner != owner.address() {
        return Err(GameError::Unauthorized.into());
    }
    if &estate_data.owner != owner.address() {
        return Err(GameError::Unauthorized.into());
    }

    // 7. HARD GATE: Require the building exists and is active
    if !has_building(estate_data, building_type) {
        return Err(GameError::BuildingRequired.into());
    }

    // 8. Get current time and check/update daily state
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;
    let current_day = (now / 86400) as u16;

    // If it's a new day, reset daily tracking
    if current_day != estate_data.daily_date {
        estate_data.daily_date = current_day;
        estate_data.dawn_timestamp = now; // First activity sets dawn
        estate_data.windows_completed = 0;
        estate_data.dawn_buildings = 0;
        estate_data.midday_buildings = 0;
        estate_data.dusk_buildings = 0;
        // Reset daily buffs (estate)
        estate_data.unit_effectiveness_bps = 0;
        estate_data.mastery_bonus_bps = 0;
        estate_data.arena_damage_bps = 0;
        estate_data.daily_loot_bonus_bps = 0;
        estate_data.market_discount_bps = 0;
        estate_data.blessed_hero = Address::default();
        estate_data.citadel_stance = 0;
        estate_data.camp_discount_bps = 0;
        estate_data.stables_speed_bps = 0;
        estate_data.infirmary_recovery_daily_bps = 0;
        estate_data.expansion_daily = 0;
        // Reset daily buffs (player)
        player_data.set_blessed_hero_bonus_bps(0);
    }

    // 9. Determine current window
    let hours_since_dawn = (now - estate_data.dawn_timestamp) / SECONDS_PER_HOUR;
    let current_window = get_current_window(hours_since_dawn);

    if current_window == TimeWindow::Expired {
        return Err(GameError::DailyWindowExpired.into());
    }

    // 10. Check if building can be played in current window
    let allowed_windows = building_allowed_windows(building_type);
    if !allowed_windows.contains(&current_window) {
        return Err(GameError::WrongTimeWindow.into());
    }

    // 11. Check if building already completed in this window
    let building_bit = building_bitflag(building_type);
    let expansion_bit = expansion_bitflag(building_type);
    let already_completed = if expansion_bit != 0 {
        // Buildings 16+: tracked in expansion_daily (window-agnostic, once per day)
        (estate_data.expansion_daily & expansion_bit) != 0
    } else {
        match current_window {
            TimeWindow::Dawn => (estate_data.dawn_buildings & building_bit) != 0,
            TimeWindow::Midday => (estate_data.midday_buildings & building_bit) != 0,
            TimeWindow::Dusk => (estate_data.dusk_buildings & building_bit) != 0,
            TimeWindow::Expired => true,
        }
    };

    if already_completed {
        return Err(GameError::AlreadyClaimedToday.into());
    }

    // 12. Grant rewards based on building and score
    grant_building_rewards(
        player_data,
        estate_data,
        building_type,
        score,
        hero_mint,
        player_account,
        game_engine_account,
        player_token_account,
        novi_mint,
        research_progress,
        program_id,
    )?;

    // 13. Mark building as completed for this window
    if expansion_bit != 0 {
        // Buildings 16+: tracked in expansion_daily
        estate_data.expansion_daily |= expansion_bit;
    } else {
        match current_window {
            TimeWindow::Dawn => estate_data.dawn_buildings |= building_bit,
            TimeWindow::Midday => estate_data.midday_buildings |= building_bit,
            TimeWindow::Dusk => estate_data.dusk_buildings |= building_bit,
            TimeWindow::Expired => {}
        }
    }

    // 14. Check for window completion bonus
    check_window_completion(estate_data, current_window);

    // 15. Update activity timestamp
    estate_data.last_activity = now;

    Ok(())
}

/// Get current time window based on hours since dawn
fn get_current_window(hours: i64) -> TimeWindow {
    if hours < 0 {
        TimeWindow::Dawn // Before dawn = still dawn
    } else if hours < DAWN_END_HOURS {
        TimeWindow::Dawn
    } else if hours >= MIDDAY_START_HOURS && hours < MIDDAY_END_HOURS {
        TimeWindow::Midday
    } else if hours >= DUSK_START_HOURS && hours < DUSK_END_HOURS {
        TimeWindow::Dusk
    } else if hours >= DAWN_END_HOURS && hours < MIDDAY_START_HOURS {
        // Gap between Dawn and Midday - still allow Dawn buildings
        TimeWindow::Dawn
    } else if hours >= MIDDAY_END_HOURS && hours < DUSK_START_HOURS {
        // Gap between Midday and Dusk - still allow Midday buildings
        TimeWindow::Midday
    } else {
        TimeWindow::Expired
    }
}

/// Grant rewards based on building type and score
fn grant_building_rewards(
    player: &mut PlayerAccount,
    estate: &mut EstateAccount,
    building_type: BuildingType,
    score: u8,
    hero_mint: &AccountView,
    player_account: &AccountView,
    game_engine_account: &AccountView,
    player_token_account: Option<&AccountView>,
    novi_mint: Option<&AccountView>,
    research_progress: Option<&AccountView>,
    program_id: &Address,
) -> Result<(), ProgramError> {
    // Score scaling: 0-100 maps to reward range
    // Perfect score (100) = max reward, score 0 = minimum reward
    let score_multiplier = score as u64;

    match building_type {
        BuildingType::Barracks => {
            // Unit effectiveness buff: 5-15% based on score
            // score 0 = 500 bps (5%), score 100 = 1500 bps (15%)
            let buff = 500 + (score_multiplier * 10) as u16;
            estate.unit_effectiveness_bps = buff;
        }

        BuildingType::Workshop => {
            // Materials: 10-65 common materials based on score
            let materials = 10 + (score_multiplier * 55 / 100);
            player.set_common_materials(player.common_materials().saturating_add(materials));
        }

        BuildingType::Dock => {
            // Produce: 10-65 produce based on score (parallel to Workshop)
            let produce = 10 + (score_multiplier * 55 / 100);
            player.produce = player.produce.saturating_add(produce);
        }

        BuildingType::Vault => {
            // Materials: 50-200 common materials based on score
            let materials = 50 + (score_multiplier * 150 / 100);
            player.set_common_materials(player.common_materials().saturating_add(materials));
        }

        BuildingType::Forge => {
            // Mastery XP bonus: 25-100% based on score
            // score 0 = 2500 bps (25%), score 100 = 10000 bps (100%)
            let buff = 2500 + (score_multiplier * 75) as u16;
            estate.mastery_bonus_bps = buff;
        }

        BuildingType::Market => {
            // Shop discount: 5-20% based on score
            // score 0 = 500 bps (5%), score 100 = 2000 bps (20%)
            let buff = 500 + (score_multiplier * 15) as u16;
            estate.market_discount_bps = buff;
        }

        BuildingType::Academy => {
            // Academy daily activity: Reduce active research time + award mastery XP
            //
            // Time reduction formula: score × (10 + mastery / 10) × building_level / 2
            // Also awards mastery XP to the Academy building

            // Get Academy building info
            let (academy_level, academy_mastery) =
                if let Some(academy) = estate.find_building(BuildingType::Academy) {
                    (academy.level, academy.mastery_level)
                } else {
                    (1, 0)
                };

            // Calculate time reduction
            let time_reduction =
                academy_daily_time_reduction(score, academy_mastery, academy_level);

            // Apply to active research if research_progress account provided
            if let Some(research_account) = research_progress {
                let mut research_data = research_account.try_borrow_mut()?;
                let research = unsafe { ResearchProgress::load_mut(&mut research_data) };

                // Only reduce if actively researching and owned by this player
                if research.is_researching() && research.player == player.owner {
                    // Reduce completion time (but never below current time + 60s minimum)
                    let clock = Clock::get()?;
                    let now = clock.unix_timestamp;
                    let min_complete = now + 60; // Minimum 60 seconds remaining

                    research.completes_at = research
                        .completes_at
                        .saturating_sub(time_reduction)
                        .max(min_complete);
                }
            }

            // Award mastery XP to Academy building (10-50 based on score)
            // This builds up mastery for research bonuses and ascension
            let mastery_xp = 10 + (score_multiplier * 40 / 100) as u32;
            if let Some(academy) = estate.find_building_mut(BuildingType::Academy) {
                academy.mastery_xp = academy.mastery_xp.saturating_add(mastery_xp);

                // Check for mastery level up (XP = 100 × level²)
                let xp_needed = academy.mastery_xp_for_next_level();
                if academy.mastery_xp >= xp_needed && academy.mastery_level < 100 {
                    academy.mastery_xp = academy.mastery_xp.saturating_sub(xp_needed);
                    academy.mastery_level = academy.mastery_level.saturating_add(1);
                }
            }
        }

        BuildingType::Arena => {
            // Arena damage buff: 5-15% based on score
            // score 0 = 500 bps (5%), score 100 = 1500 bps (15%)
            let buff = 500 + (score_multiplier * 10) as u16;
            estate.arena_damage_bps = buff;
        }

        BuildingType::MeditationChamber => {
            // Hero blessing: Player selects a hero to bless for the day
            // All locked heroes get +25% effectiveness bonus
            if hero_mint.address() == &NULL_PUBKEY {
                return Err(GameError::MissingRequiredAccount.into());
            }

            // NFT-Only System: hero_mint IS the hero's identity
            // Verify hero is locked to this player (in active_heroes)
            let is_locked = player
                .active_heroes_arr()
                .iter()
                .any(|&mint| &mint == hero_mint.address());
            if !is_locked {
                return Err(GameError::Unauthorized.into());
            }

            // Verify NFT is actually owned by player's PlayerAccount PDA
            // This prevents passing arbitrary pubkeys that happen to be in active_heroes
            let asset_data = hero_mint.try_borrow()?;
            let asset = p_core::state::AssetV1::from_borsh(&asset_data);
            if &asset.owner != player_account.address().as_array() {
                return Err(GameError::Unauthorized.into());
            }
            drop(asset_data);

            // Grant +25% hero effectiveness bonus for the day
            // This applies as a multiplier to all hero buffs in combat
            player.set_blessed_hero_bonus_bps(2500); // +25%

            // Also store which hero was blessed (for UI/reference)
            // NFT-Only: Store the hero_mint key directly
            estate.blessed_hero = *hero_mint.address();
        }

        BuildingType::Observatory => {
            // Loot bonus: 5-25% based on score
            // score 0 = 500 bps (5%), score 100 = 2500 bps (25%)
            let buff = 500 + (score_multiplier * 20) as u16;
            estate.daily_loot_bonus_bps = buff;
        }

        BuildingType::Treasury => {
            // NOVI reward: 100-900 based on score
            // Actually MINT tokens instead of just updating soft balance
            let novi = 100 + (score_multiplier * 8);

            // Require token accounts for Treasury
            let token_account = player_token_account.ok_or(GameError::MissingRequiredAccount)?;
            let mint = novi_mint.ok_or(GameError::MissingRequiredAccount)?;
            crate::require_keys_eq!(
                mint.address().as_array(),
                &crate::constants::NOVI_MINT_ADDRESS,
                "daily_activity.novi_mint",
                GameError::InvalidMint,
            );

            // Verify token account belongs to the PlayerAccount PDA
            validate_token_account_owner(token_account, player_account.address())?;

            let game_engine = GameEngine::load_checked_by_key(game_engine_account, program_id)?;

            // Create PDA signer for GameEngine (mint authority)
            let kingdom_id_bytes = game_engine.kingdom_id.to_le_bytes();
            let bump_seed = [game_engine.bump];
            let seeds = crate::seeds!(GAME_ENGINE_SEED, &kingdom_id_bytes, &bump_seed);
            let signer = pinocchio::cpi::Signer::from(&seeds);

            // Mint NOVI tokens to player's token account
            mint_tokens(mint, token_account, game_engine_account, novi, &[signer])?;

            // Also update soft balance tracker for consistency
            player.locked_novi = player.locked_novi.saturating_add(novi);
        }

        BuildingType::Citadel => {
            // Defense stance: score determines stance (0-2)
            // 0-33: Defensive, 34-66: Balanced, 67-100: Aggressive
            estate.citadel_stance = if score < 34 {
                0 // Defensive
            } else if score < 67 {
                1 // Balanced
            } else {
                2 // Aggressive
            };
        }

        BuildingType::Camp => {
            // Operative cost reduction: 3-12% based on score
            // score 0 = 300 bps (3%), score 100 = 1200 bps (12%)
            let buff = 300 + (score_multiplier * 9) as u16;
            estate.camp_discount_bps = buff;
        }

        BuildingType::Mine => {
            // Gems: 5-30 based on score
            let gems = 5 + (score_multiplier * 25 / 100);
            player.gems = player.gems.saturating_add(gems);
        }

        BuildingType::Farm => {
            // Produce: 10-65 based on score (parallel to Dock)
            let produce = 10 + (score_multiplier * 55 / 100);
            player.produce = player.produce.saturating_add(produce);
        }

        BuildingType::DungeonEntry => {
            // Fragments: 1-5 based on score
            let fragments = 1 + (score_multiplier * 4 / 100);
            player.fragments = player.fragments.saturating_add(fragments);
        }

        BuildingType::TransportBay => {
            // Travel speed bonus: 5-20% based on score
            // score 0 = 500 bps (5%), score 100 = 2000 bps (20%)
            let buff = 500 + (score_multiplier * 15) as u16;
            estate.stables_speed_bps = buff;
        }

        BuildingType::Infirmary => {
            // Unit recovery: 2-8% based on score
            // score 0 = 200 bps (2%), score 100 = 800 bps (8%)
            let buff = 200 + (score_multiplier * 6) as u16;
            estate.infirmary_recovery_daily_bps = buff;
        }

        BuildingType::Mansion => {
            // Mansion handled by daily_claim.rs
        }
    }

    Ok(())
}

/// Check if a window is fully completed and grant bonus
fn check_window_completion(estate: &mut EstateAccount, window: TimeWindow) {
    // Buildings that can be completed in each window
    // Note: Only buildings 0-15 fit in u16 bitflags. Buildings 16+ (Farm, Stables,
    // Infirmary) are tracked separately via expansion_daily and don't participate
    // in window completion bonuses.
    const DAWN_BUILDINGS: u16 = (1 << BuildingType::Barracks as u8)
        | (1 << BuildingType::Workshop as u8)
        | (1 << BuildingType::Dock as u8)
        | (1 << BuildingType::Vault as u8)
        | (1 << BuildingType::Forge as u8)
        | (1 << BuildingType::Camp as u8)
        | (1 << BuildingType::Mine as u8);

    const MIDDAY_BUILDINGS: u16 = (1 << BuildingType::Workshop as u8)
        | (1 << BuildingType::Dock as u8)
        | (1 << BuildingType::Vault as u8)
        | (1 << BuildingType::Forge as u8)
        | (1 << BuildingType::Market as u8)
        | (1 << BuildingType::Academy as u8)
        | (1 << BuildingType::Arena as u8)
        | (1 << BuildingType::Mine as u8);

    const DUSK_BUILDINGS: u16 = (1 << BuildingType::MeditationChamber as u8)
        | (1 << BuildingType::Observatory as u8)
        | (1 << BuildingType::Treasury as u8)
        | (1 << BuildingType::Citadel as u8)
        | (1 << BuildingType::DungeonEntry as u8);

    // Check which buildings the player actually has
    let owned_buildings = get_owned_buildings_mask(estate);

    match window {
        TimeWindow::Dawn => {
            let required = DAWN_BUILDINGS & owned_buildings;
            if required != 0 && (estate.dawn_buildings & required) == required {
                estate.windows_completed |= WINDOW_DAWN;
            }
        }
        TimeWindow::Midday => {
            let required = MIDDAY_BUILDINGS & owned_buildings;
            if required != 0 && (estate.midday_buildings & required) == required {
                estate.windows_completed |= WINDOW_MIDDAY;
            }
        }
        TimeWindow::Dusk => {
            let required = DUSK_BUILDINGS & owned_buildings;
            if required != 0 && (estate.dusk_buildings & required) == required {
                estate.windows_completed |= WINDOW_DUSK;
            }
        }
        TimeWindow::Expired => {}
    }
}

/// Get bitmask of buildings the player owns (buildings 0-15 only, u16)
fn get_owned_buildings_mask(estate: &EstateAccount) -> u16 {
    let mut mask: u16 = 0;
    for i in 0..estate.usable_slots() {
        let building = &estate.buildings[i];
        if !building.is_empty() && building.is_active() && building.building_type < 16 {
            mask |= 1u16 << building.building_type;
        }
    }
    mask
}
