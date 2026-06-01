//! Claim Expedition Processor
//!
//! Claims rewards from a completed expedition and closes the ExpeditionAccount
//! (refunding rent to the player).
//!
//! # Reward Calculation
//!
//! ## Base Yield
//! - Mining: `gems = operatives × hours × gems_per_op_hour[tier]`
//! - Fishing: `produce = operatives × hours × produce_per_op_hour[tier]`
//!
//! ## Bonuses Applied (multiplicative)
//! 1. Time-of-day bonus (from existing logic module)
//! 2. Research collection bonus (research_collection_bonus_bps)
//! 3. Hero buffs (hero_collection_rate_bps for mining, hero_produce_generation_bps for fishing)
//! 4. Observatory building bonus (for rare find chance)
//! 5. Strike score bonus (Phase 2 - avg score 80+ = +25%)
//! 6. Expedition hero affinity bonus (MiningAffinity or FishingAffinity from NFT attributes)
//!
//! ## Rare Finds
//! Deterministic based on tier + observatory bonus:
//! - Check if (start_time / 3600) % 100 < rare_chance_bps / 100
//! - If rare: 5x multiplier on base yield
//!
//! ## Fragments
//! Guaranteed fragment bonus per expedition (scales with tier)
//!
//! ## Hero Return
//! If a hero was sent with the expedition, it is returned to owner's wallet on claim.

use pinocchio::{
    sysvars::{clock::Clock, Sysvar},
    AccountView, Address, ProgramResult,
};

use crate::{
    constants::{
        EXPEDITION_MINING, EXPEDITION_SEED, FISHING_DURATION_HOURS, FISHING_FRAGMENT_BONUS,
        FISHING_RARE_CHANCE_BPS, MINING_DURATION_HOURS, MINING_FRAGMENT_BONUS,
        MINING_RARE_CHANCE_BPS, OPERATIVE_TIER_1_MULTIPLIER_BPS, OPERATIVE_TIER_2_MULTIPLIER_BPS,
        OPERATIVE_TIER_3_MULTIPLIER_BPS, PERFECT_EXPEDITION_BONUS_BPS, PERFECT_SCORE_THRESHOLD,
        RARE_FIND_MULTIPLIER,
    },
    emit,
    error::GameError,
    events::ExpeditionClaimed,
    helpers::{
        close_account,
        estate::{load_estate_for_player, observatory_loot_bonus_bps},
        parse_hero_nft,
    },
    logic::{apply_time_multiplier, get_time_of_day, safe_math::isqrt, ActivityType},
    state::{is_hero_at_home, ExpeditionAccount, GameEngine, PlayerAccount, NULL_PUBKEY},
    validation::{require_initialized, require_owner, require_signer, require_writable},
};

/// Bonus yield when hero's origin city matches expedition location AND has affinity
/// +25% extra yield on top of affinity bonus
pub const ORIGIN_CITY_BONUS_BPS: u64 = 2500;

/// Claim Expedition Rewards
///
/// Calculates and grants rewards from a completed expedition, then closes
/// the ExpeditionAccount PDA (refunding rent to the owner).
///
/// **IMPORTANT:** Operatives that were LOCKED during start_expedition are
/// RETURNED to the player when claiming.
///
/// **HERO RETURN:** If a hero was sent with the expedition, it is transferred
/// back to the owner's wallet. The hero's affinity buff is applied to yield.
///
/// # Accounts
/// 0. `[signer]` owner - Player's wallet (receives rent refund)
/// 1. `[writable]` player_account - PlayerAccount PDA
/// 2. `[writable]` expedition_account - ExpeditionAccount PDA (to be closed)
/// 3. `[]` estate_account - EstateAccount PDA (for Observatory bonus)
/// 4. `[]` game_engine - GameEngine PDA (for expedition config)
///
/// ## Optional Hero Accounts (if hero was on expedition):
/// 5. `[writable]` hero_mint - Hero NFT (MPL Core asset)
/// 6. `[]` hero_collection - Hero collection (MPL Core)
/// 7. `[]` system_program - System program (for transfer)
/// 8. `[]` p_core_program - MPL Core program
///
/// # Instruction Data
/// None required
pub fn process(
    program_id: &Address,
    accounts: &[AccountView],
    _instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Accounts (minimum 5, up to 9 with hero)
    crate::extract_accounts!(
        accounts,
        [
            owner,
            player_account,
            expedition_account,
            estate_account,
            game_engine_account,
        ],
        rest = hero_accounts
    );

    // 2. Validate Accounts
    require_signer(owner)?;
    require_writable(player_account)?;
    require_writable(expedition_account)?;
    require_owner(player_account, program_id)?;
    require_owner(expedition_account, program_id)?;

    // 3. Validate ExpeditionAccount PDA
    let (expected_expedition_pda, _) = pinocchio::Address::find_program_address(
        &[EXPEDITION_SEED, player_account.address().as_ref()],
        program_id,
    );

    if expedition_account.address() != &expected_expedition_pda {
        return Err(GameError::InvalidPDA.into());
    }

    // 4. Check expedition exists
    require_initialized(expedition_account).map_err(|_| GameError::NoExpeditionInProgress)?;

    // 5. Load Expedition Data (before closing)
    let (
        expedition_type,
        tier,
        strikes,
        score,
        start_time,
        op_unit_1,
        op_unit_2,
        op_unit_3,
        hero_mint_key,
        expedition_city,
    ) = {
        let expedition_data = expedition_account.try_borrow()?;
        let expedition = unsafe { ExpeditionAccount::load(&expedition_data) };

        // Verify expedition belongs to this player
        if &expedition.player != owner.address() {
            return Err(GameError::Unauthorized.into());
        }

        (
            expedition.expedition_type,
            expedition.tier,
            expedition.strikes,
            expedition.score,
            expedition.start_time,
            expedition.operative_unit_1,
            expedition.operative_unit_2,
            expedition.operative_unit_3,
            expedition.hero_mint,
            expedition.city_id,
        )
    };

    // Check if expedition had a hero
    let has_hero = hero_mint_key != NULL_PUBKEY;

    // 6. Load GameEngine for expedition config (kingdom-scoped)
    let game_engine = GameEngine::load_checked_by_key(game_engine_account, program_id)?;
    let max_ops = game_engine.economic_config.max_operatives_per_expedition;
    let mining_rates = game_engine.economic_config.mining_gems_per_op_hour;
    let fishing_rates = game_engine.economic_config.fishing_produce_per_op_hour;

    // Calculate weighted operatives for reward calculation
    // Higher-tier operatives provide better yields:
    // Tier 1: 1.0x (10000 bps), Tier 2: 1.5x (15000 bps), Tier 3: 2.0x (20000 bps)
    let raw_weighted_operatives = op_unit_1
        .saturating_mul(OPERATIVE_TIER_1_MULTIPLIER_BPS)
        .saturating_add(op_unit_2.saturating_mul(OPERATIVE_TIER_2_MULTIPLIER_BPS))
        .saturating_add(op_unit_3.saturating_mul(OPERATIVE_TIER_3_MULTIPLIER_BPS))
        / 10000; // Convert from basis points to actual multiplier

    // Apply diminishing returns after max_operatives cap
    // effective = min(ops, cap) + sqrt(max(0, ops - cap))
    let weighted_operatives = if raw_weighted_operatives <= max_ops {
        raw_weighted_operatives
    } else {
        let excess = raw_weighted_operatives.saturating_sub(max_ops);
        let sqrt_excess = isqrt(excess);
        max_ops.saturating_add(sqrt_excess)
    };

    // 7. Load Player Data
    let mut player_data_ref = player_account.try_borrow_mut()?;
    let player_data = unsafe { PlayerAccount::load_mut(&mut player_data_ref) };

    // 7. Verify ownership
    if !player_data.is_owner(owner.address()) {
        return Err(GameError::Unauthorized.into());
    }

    // Lucky Streak research (buff_type 26, stored as the synchrony bonus) widens
    // the expedition rare-find roll. Captured here while the player is loaded.
    let lucky_bps = player_data.research_synchrony_bonus_bps();

    // 8. Get current time and verify expedition complete
    let now = Clock::get()?.unix_timestamp;

    let duration_hours = if expedition_type == EXPEDITION_MINING {
        MINING_DURATION_HOURS
            .get(tier as usize)
            .copied()
            .unwrap_or(1)
    } else {
        FISHING_DURATION_HOURS
            .get(tier as usize)
            .copied()
            .unwrap_or(1)
    };

    let duration_seconds = duration_hours as i64 * 3600;
    let end_time = start_time.saturating_add(duration_seconds);

    if now < end_time {
        return Err(GameError::ExpeditionNotComplete.into());
    }

    // 10. Calculate base yield (based on weighted operatives with diminishing returns)
    // Rates are stored as value × 100 (e.g., 10 = 0.10 gems/op/hour)
    // Formula: operatives × hours × rate / 100
    let base_yield = if expedition_type == EXPEDITION_MINING {
        let rate = mining_rates.get(tier as usize).copied().unwrap_or(10) as u64;
        weighted_operatives
            .saturating_mul(duration_hours as u64)
            .saturating_mul(rate)
            / 100
    } else {
        let rate = fishing_rates.get(tier as usize).copied().unwrap_or(15) as u64;
        weighted_operatives
            .saturating_mul(duration_hours as u64)
            .saturating_mul(rate)
            / 100
    };

    // 10. Apply time-of-day bonus (based on claim time)
    let time_of_day = get_time_of_day(now, player_data.current_long);
    let activity_type = if expedition_type == EXPEDITION_MINING {
        ActivityType::Mining
    } else {
        ActivityType::Fishing
    };
    let time_adjusted = apply_time_multiplier(base_yield, time_of_day, activity_type);

    // 11. Apply research collection bonus
    let research_adjusted = if player_data.research_collection_bonus_bps() > 0 {
        let multiplier = 10000u64 + player_data.research_collection_bonus_bps() as u64;
        time_adjusted.saturating_mul(multiplier) / 10000
    } else {
        time_adjusted
    };

    // 12. Apply hero buffs
    let hero_adjusted = if expedition_type == EXPEDITION_MINING {
        // Mining uses hero_collection_rate_bps
        if player_data.hero_collection_rate_bps() > 0 {
            let multiplier = 10000u64 + player_data.hero_collection_rate_bps() as u64;
            research_adjusted.saturating_mul(multiplier) / 10000
        } else {
            research_adjusted
        }
    } else {
        // Fishing uses hero_produce_generation_bps
        if player_data.hero_produce_generation_bps() > 0 {
            let multiplier = 10000u64 + player_data.hero_produce_generation_bps() as u64;
            research_adjusted.saturating_mul(multiplier) / 10000
        } else {
            research_adjusted
        }
    };

    // 13. Apply strike score bonus (Phase 2)
    let strike_adjusted = if strikes > 0 {
        let avg_score = (score / strikes as u16).min(100) as u8;
        if avg_score >= PERFECT_SCORE_THRESHOLD {
            // Perfect expedition: +25% bonus
            let multiplier = 10000u64 + PERFECT_EXPEDITION_BONUS_BPS as u64;
            hero_adjusted.saturating_mul(multiplier) / 10000
        } else {
            // Partial bonus based on score: (score / 100) * 25%
            let partial_bonus = (avg_score as u64 * PERFECT_EXPEDITION_BONUS_BPS as u64) / 100;
            let multiplier = 10000u64 + partial_bonus;
            hero_adjusted.saturating_mul(multiplier) / 10000
        }
    } else {
        hero_adjusted
    };

    // 13a. Apply expedition hero affinity bonus AND origin city bonus (if hero was sent)
    // User requirement: "extra yield must be if matches expedition location AND has the affinity"
    // hero_mint is `accounts[5]`, NOT `accounts[4]`. accounts[4] is
    // `game_engine` per the doc-comment above. Reading the wrong index would
    // cause every claim with an attached hero to abort (game_engine bytes parsed
    // as None by parse_hero_nft + key mismatch), soft-locking the hero in escrow.
    let affinity_adjusted = if has_hero && accounts.len() >= 9 {
        let hero_mint = &hero_accounts[0];

        // Verify hero mint matches what was stored in expedition
        if hero_mint.address() != &hero_mint_key {
            return Err(GameError::InvalidParameter.into());
        }

        // Parse hero NFT for affinity buff and origin_city
        let nft_data = hero_mint.try_borrow()?;
        let (affinity_bonus, origin_matches) = if let Some(parsed_hero) = parse_hero_nft(&nft_data)
        {
            // Look for MiningAffinity (17) or FishingAffinity (18) in hero's buffs
            let target_stat = if expedition_type == EXPEDITION_MINING {
                17u8
            } else {
                18u8
            };
            let mut bonus_bps: u16 = 0;
            for i in 0..(parsed_hero.buff_count as usize).min(4) {
                if parsed_hero.buffs[i].stat == target_stat {
                    bonus_bps = parsed_hero.buffs[i].value;
                    break;
                }
            }
            // Check if hero's origin city matches expedition location
            let at_home = is_hero_at_home(parsed_hero.origin_city, expedition_city);
            (bonus_bps, at_home)
        } else {
            (0, false)
        };
        drop(nft_data);

        // Apply affinity bonus (if hero has the relevant affinity)
        let mut adjusted = if affinity_bonus > 0 {
            let multiplier = 10000u64 + affinity_bonus as u64;
            strike_adjusted.saturating_mul(multiplier) / 10000
        } else {
            strike_adjusted
        };

        // Apply origin city bonus ONLY if origin matches AND has affinity
        // This is the user's explicit requirement
        if origin_matches && affinity_bonus > 0 {
            let origin_multiplier = 10000u64 + ORIGIN_CITY_BONUS_BPS;
            adjusted = adjusted.saturating_mul(origin_multiplier) / 10000;
        }

        adjusted
    } else {
        strike_adjusted
    };

    // 14. Check for rare find (deterministic based on start_time)
    // Load estate for Observatory bonus
    let observatory_bonus =
        if let Ok(estate) = load_estate_for_player(estate_account, player_data, program_id) {
            observatory_loot_bonus_bps(estate)
        } else {
            0
        };

    let rare_chance_bps = if expedition_type == EXPEDITION_MINING {
        MINING_RARE_CHANCE_BPS
            .get(tier as usize)
            .copied()
            .unwrap_or(100)
    } else {
        FISHING_RARE_CHANCE_BPS
            .get(tier as usize)
            .copied()
            .unwrap_or(100)
    };

    // Add observatory + Lucky Streak research to the rare-find chance.
    let total_rare_chance = rare_chance_bps
        .saturating_add(observatory_bonus)
        .saturating_add(lucky_bps);

    // Deterministic rare check: (start_time / 3600) % 10000 < total_rare_chance
    let rare_seed = ((start_time / 3600) % 10000) as u16;
    let is_rare_find = rare_seed < total_rare_chance;

    let final_yield = if is_rare_find {
        affinity_adjusted.saturating_mul(RARE_FIND_MULTIPLIER)
    } else {
        affinity_adjusted
    };

    // 15. Grant rewards
    let _fragment_bonus = if expedition_type == EXPEDITION_MINING {
        player_data.gems = player_data
            .gems
            .checked_add(final_yield)
            .ok_or(GameError::MathOverflow)?;

        // Guaranteed fragment bonus
        let fragments = MINING_FRAGMENT_BONUS
            .get(tier as usize)
            .copied()
            .unwrap_or(1);
        player_data.fragments = player_data
            .fragments
            .checked_add(fragments)
            .ok_or(GameError::MathOverflow)?;
        fragments
    } else {
        player_data.produce = player_data
            .produce
            .checked_add(final_yield)
            .ok_or(GameError::MathOverflow)?;

        // Guaranteed fragment bonus (fishing gives fewer)
        let fragments = FISHING_FRAGMENT_BONUS
            .get(tier as usize)
            .copied()
            .unwrap_or(1);
        player_data.fragments = player_data
            .fragments
            .checked_add(fragments)
            .ok_or(GameError::MathOverflow)?;
        fragments
    };

    // 16. RETURN LOCKED OPERATIVES to player
    player_data.operative_unit_1 = player_data
        .operative_unit_1
        .checked_add(op_unit_1)
        .ok_or(GameError::MathOverflow)?;
    player_data.operative_unit_2 = player_data
        .operative_unit_2
        .checked_add(op_unit_2)
        .ok_or(GameError::MathOverflow)?;
    player_data.operative_unit_3 = player_data
        .operative_unit_3
        .checked_add(op_unit_3)
        .ok_or(GameError::MathOverflow)?;

    // 17. Return hero NFT to owner (if hero was on expedition)
    // Drop player_data borrow before transfer
    drop(player_data_ref);

    // Hero accounts start at index 5, not 4 (accounts[4] is game_engine).
    if has_hero && accounts.len() >= 9 {
        let hero_mint = &hero_accounts[0];
        let hero_collection = &hero_accounts[1];
        let system_program = &hero_accounts[2];
        let p_core_program = &hero_accounts[3];

        // Verify hero mint matches what was stored
        if hero_mint.address() != &hero_mint_key {
            return Err(GameError::InvalidParameter.into());
        }

        // Derive expedition PDA signer
        let (_, expedition_bump) = pinocchio::Address::find_program_address(
            &[EXPEDITION_SEED, player_account.address().as_ref()],
            program_id,
        );
        let bump_seed = [expedition_bump];
        let expedition_seeds = crate::seeds!(EXPEDITION_SEED, player_account.address(), &bump_seed);
        let expedition_signer = pinocchio::cpi::Signer::from(&expedition_seeds);

        // Transfer hero NFT from expedition back to owner
        p_core::instructions::TransferV1 {
            asset: hero_mint,
            collection: hero_collection,
            new_owner: owner,
            payer: owner,
            authority: expedition_account,
            system_program,
            log_wrapper: p_core_program,
        }
        .invoke_signed(&[expedition_signer])?;
    }

    // 18. Close expedition account (refund rent to owner)
    close_account(expedition_account, owner)?;

    // 19. Emit event
    // Re-borrow player_data to access name field
    let player_data_ref = player_account.try_borrow()?;
    let player_data = unsafe { PlayerAccount::load(&player_data_ref) };

    emit!(ExpeditionClaimed {
        player: *player_account.address(),
        player_name: player_data.name,
        expedition_type,
        total_yield: final_yield,
        bonus_yield: affinity_adjusted.saturating_sub(base_yield),
        xp_earned: 0, // XP is not currently granted for expeditions
        timestamp: now,
    });

    Ok(())
}
