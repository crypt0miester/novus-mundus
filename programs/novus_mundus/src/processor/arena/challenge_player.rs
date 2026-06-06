//! Challenge Player (Instruction 234)
//!
//! Main arena battle instruction. Requires game_authority signature for matchmaking
//! validation. Combat is resolved in a single transaction - no battle account stored.
//!
//! # Accounts
//! 0. `[SIGNER]` challenger_authority: Challenger's wallet
//! 1. `[SIGNER]` game_authority: GameEngine's game_authority (validates matchmaking)
//! 2. `[]` game_engine: GameEngine PDA
//! 3. `[]` challenger_player: Challenger's PlayerAccount
//! 4. `[WRITE]` challenger_participant: Challenger's ArenaParticipantAccount
//! 5. `[]` challenger_loadout: Challenger's ArenaLoadoutAccount
//! 6. `[]` challenger_hero: Challenger's Hero NFT (optional)
//! 7. `[]` challenger_estate: Challenger's EstateAccount (optional)
//! 8. `[]` defender_player: Defender's PlayerAccount
//! 9. `[WRITE]` defender_participant: Defender's ArenaParticipantAccount
//! 10. `[]` defender_loadout: Defender's ArenaLoadoutAccount
//! 11. `[]` defender_hero: Defender's Hero NFT (optional)
//! 12. `[]` defender_estate: Defender's EstateAccount (optional)
//! 13. `[WRITE]` arena_season: ArenaSeasonAccount

use pinocchio::{
    sysvars::{clock::Clock, Sysvar},
    AccountView, Address, ProgramResult,
};

use crate::{
    constants::{
        ARENA_ARMOR_POWER, ARENA_BASE_LOSS_POINTS, ARENA_BASE_WIN_POINTS, ARENA_DRAW_POINTS,
        ARENA_ELO_K_FACTOR, ARENA_MATCH_EXPIRY_SECONDS, ARENA_MAX_BATTLES_PER_OPPONENT,
        ARENA_MAX_DAILY_BATTLES, ARENA_MELEE_WEAPON_POWER, ARENA_RANGED_WEAPON_POWER,
        ARENA_SIEGE_WEAPON_POWER, ARENA_UNDERDOG_BONUS_BPS, DEFENSIVE_UNIT_1_POWER,
        DEFENSIVE_UNIT_2_POWER, DEFENSIVE_UNIT_3_POWER, SECONDS_PER_DAY,
    },
    emit,
    error::GameError,
    events::ArenaBattleResolved,
    helpers::parse_hero_nft,
    state::{
        ArenaLoadoutAccount, ArenaParticipantAccount, ArenaSeasonAccount, ArenaStatus, BuffStat,
        EstateAccount, GameEngine, PlayerAccount,
    },
    utils::{read_i64, read_u32, read_u64},
    validation::{require_data_len, require_owner, require_signer},
};

/// Instruction data for challenge_player
/// - match_id: u64 (8 bytes) - Unique match ID from matchmaker
/// - match_timestamp: i64 (8 bytes) - When match was assigned
/// - season_id: u32 (4 bytes) - Season ID for PDA derivation
/// Total: 20 bytes
pub fn process(
    program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Accounts (14 required)
    crate::extract_accounts!(
        accounts,
        [
            challenger_authority,
            game_authority,
            game_engine,
            challenger_player,
            challenger_participant,
            challenger_loadout,
            challenger_hero,
            challenger_estate,
            defender_player,
            defender_participant,
            defender_loadout,
            defender_hero,
            defender_estate,
            arena_season,
        ]
    );

    // 2. Validate Signers
    require_signer(challenger_authority)?;
    require_signer(game_authority)?;

    // 3. Parse Instruction Data (20 bytes minimum)
    let match_id = read_u64(instruction_data, 0, "challenge_player.match_id")?;

    let match_timestamp = read_i64(instruction_data, 8, "challenge_player.match_timestamp")?;

    let season_id = read_u32(instruction_data, 16, "challenge_player.season_id")?;

    // 4. Load Clock
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    // 5. Validate GameEngine and game_authority (kingdom-scoped)
    let ge_data = GameEngine::load_checked_by_key(game_engine, program_id)?;
    if game_authority.address() != &ge_data.game_authority {
        return Err(GameError::Unauthorized.into());
    }

    // 6. Load Arena Season and validate
    require_owner(arena_season, program_id)?;
    require_data_len(arena_season, ArenaSeasonAccount::LEN)?;
    let mut season_data = arena_season.try_borrow_mut()?;
    let season = unsafe { &mut *(season_data.as_mut_ptr() as *mut ArenaSeasonAccount) };

    // Verify season_id
    if season.season_id != season_id {
        return Err(GameError::InvalidParameter.into());
    }

    // Season must be active
    if season.status != ArenaStatus::Active as u8 {
        return Err(GameError::ArenaSeasonNotActive.into());
    }

    // Season must not have ended
    if now >= season.end_time {
        return Err(GameError::ArenaSeasonExpired.into());
    }

    let _season_authority = season.authority;

    // 7. Load Players (kingdom-scoped)
    let challenger_player_data = PlayerAccount::load_checked(
        challenger_player,
        game_engine.address(),
        challenger_authority.address(),
        program_id,
    )?;

    // Get defender authority from their player account
    require_owner(defender_player, program_id)?;
    require_data_len(defender_player, crate::state::CORE_SIZE)?;
    let defender_player_raw = defender_player.try_borrow()?;
    let defender_player_data = unsafe { &*(defender_player_raw.as_ptr() as *const PlayerAccount) };
    let defender_authority_key = defender_player_data.owner;
    drop(defender_player_raw);

    // 8. Load Participants (kingdom-scoped, keyed by player PDA)
    let challenger_part = ArenaParticipantAccount::load_checked_mut(
        challenger_participant,
        game_engine.address(),
        season_id,
        challenger_player.address(),
        program_id,
    )?;

    let defender_part = ArenaParticipantAccount::load_checked_mut(
        defender_participant,
        game_engine.address(),
        season_id,
        defender_player.address(),
        program_id,
    )?;

    // 9. Load Loadouts (kingdom-scoped, keyed by player PDA)
    let challenger_loadout_data = ArenaLoadoutAccount::load_checked(
        challenger_loadout,
        game_engine.address(),
        challenger_player.address(),
        program_id,
    )?;

    let defender_loadout_data = ArenaLoadoutAccount::load_checked(
        defender_loadout,
        game_engine.address(),
        defender_player.address(),
        program_id,
    )?;

    // VALIDATION

    // Prevent match replay - match_id must be greater than last used
    if match_id <= challenger_part.last_match_id {
        return Err(GameError::ArenaMatchAlreadyUsed.into());
    }

    // Match assignment must be fresh (5 minute window)
    // Reject future-dated timestamps first so the freshness subtraction can't underflow.
    if match_timestamp > now {
        return Err(GameError::ArenaMatchTimestampInvalid.into());
    }
    if now.saturating_sub(match_timestamp) > ARENA_MATCH_EXPIRY_SECONDS {
        return Err(GameError::ArenaMatchExpired.into());
    }

    // Cannot challenge self
    if challenger_authority.address() == &defender_authority_key {
        return Err(GameError::ArenaCannotChallengeYourself.into());
    }

    // NOTE: No loadout validation - arena is non-lethal, loadout values are trusted.
    // Power calculation uses loadout directly. If a player's loadout exceeds their
    // actual assets, that's their responsibility to update via update_loadout.

    // Rolling 24-hour battle limit (10 battles per 24 hours)
    let battles_in_window = challenger_part.count_battles_in_window(now, SECONDS_PER_DAY);
    if battles_in_window >= ARENA_MAX_DAILY_BATTLES {
        return Err(GameError::ArenaDailyBattleLimitReached.into());
    }

    // Opponent cooldown - max 2 battles vs same opponent per 24h window
    let battles_vs_opponent =
        challenger_part.count_opponent_in_window(&defender_part.player, now, SECONDS_PER_DAY);
    if battles_vs_opponent >= ARENA_MAX_BATTLES_PER_OPPONENT {
        return Err(GameError::ArenaOpponentCooldownActive.into());
    }

    // Validate hero NFTs if loadouts have heroes set
    // Heroes are Metaplex Core NFTs - we verify the account key matches the loadout
    if challenger_loadout_data.arena_hero != Address::default() {
        // Verify hero NFT key matches loadout
        if challenger_hero.address() != &challenger_loadout_data.arena_hero {
            return Err(GameError::ArenaHeroMismatch.into());
        }
        // Verify it's a valid hero NFT
        let nft_data = challenger_hero.try_borrow()?;
        if parse_hero_nft(&nft_data).is_none() {
            return Err(GameError::ArenaHeroAccountRequired.into());
        }
    }

    if defender_loadout_data.arena_hero != Address::default() {
        // Verify hero NFT key matches loadout
        if defender_hero.address() != &defender_loadout_data.arena_hero {
            return Err(GameError::ArenaHeroMismatch.into());
        }
        // Verify it's a valid hero NFT
        let nft_data = defender_hero.try_borrow()?;
        if parse_hero_nft(&nft_data).is_none() {
            return Err(GameError::ArenaHeroAccountRequired.into());
        }
    }

    // COMBAT RESOLUTION

    // Calculate arena power for challenger
    let challenger_power = calculate_arena_power(
        &challenger_loadout_data,
        &challenger_player_data,
        challenger_hero,
        challenger_estate,
        program_id,
    );

    // Calculate arena power for defender
    // Re-borrow defender player data
    let defender_player_raw2 = defender_player.try_borrow()?;
    let defender_player_data2 =
        unsafe { &*(defender_player_raw2.as_ptr() as *const PlayerAccount) };

    let defender_power = calculate_arena_power(
        &defender_loadout_data,
        defender_player_data2,
        defender_hero,
        defender_estate,
        program_id,
    );

    drop(defender_player_raw2);

    // Determine winner (simple power comparison)
    let challenger_won = challenger_power > defender_power;
    let is_draw = challenger_power == defender_power;

    // Calculate points for both players
    let (challenger_points, defender_points) =
        calculate_battle_points(challenger_won, is_draw, challenger_power, defender_power);

    // Update ELO ratings
    let (new_challenger_elo, new_defender_elo) = update_elo(
        challenger_part.elo_rating,
        defender_part.elo_rating,
        challenger_won,
        is_draw,
    );

    // UPDATE STATE

    // Update challenger
    challenger_part.last_match_id = match_id;
    challenger_part.total_points = challenger_part
        .total_points
        .saturating_add(challenger_points);
    challenger_part.elo_rating = new_challenger_elo;
    if challenger_won {
        challenger_part.wins = challenger_part.wins.saturating_add(1);
    } else if !is_draw {
        challenger_part.losses = challenger_part.losses.saturating_add(1);
    }
    challenger_part.record_battle(defender_part.player, now);

    // Update defender
    defender_part.total_points = defender_part.total_points.saturating_add(defender_points);
    defender_part.elo_rating = new_defender_elo;
    if !challenger_won && !is_draw {
        defender_part.wins = defender_part.wins.saturating_add(1);
    } else if challenger_won {
        defender_part.losses = defender_part.losses.saturating_add(1);
    }
    defender_part.record_battle(challenger_part.player, now);

    // Update season
    season.total_battles = season.total_battles.saturating_add(1);

    // Update leaderboard for both players
    let challenger_player_key = challenger_part.player;
    let challenger_total_points = challenger_part.total_points;
    let defender_player_key = defender_part.player;
    let defender_total_points = defender_part.total_points;

    season.update_leaderboard(challenger_player_key, challenger_total_points);
    season.update_leaderboard(defender_player_key, defender_total_points);

    // Emit battle resolution event (additive). battle_id is the post-increment
    // season.total_battles. Slot is fetched once here for the event only.
    let slot = Clock::get()?.slot;
    emit!(ArenaBattleResolved {
        season_id,
        battle_id: season.total_battles,
        challenger: challenger_player_key,
        defender: defender_player_key,
        challenger_power,
        defender_power,
        challenger_won,
        challenger_points,
        defender_points,
        new_challenger_elo,
        new_defender_elo,
        timestamp: now,
        slot,
    });

    Ok(())
}

/// Calculate arena power from loadout + player buffs
fn calculate_arena_power(
    loadout: &ArenaLoadoutAccount,
    player: &PlayerAccount,
    hero_account: &AccountView,
    estate_account: &AccountView,
    program_id: &Address,
) -> u64 {
    // Clamp every loadout field to the assets the player actually owns. An
    // inflated loadout therefore cannot manufacture power it cannot back
    // (phantom army), while a stale loadout never fails the battle - it just
    // contributes the units still on hand.
    let units_0 = loadout.defensive_units[0].min(player.defensive_unit_1);
    let units_1 = loadout.defensive_units[1].min(player.defensive_unit_2);
    let units_2 = loadout.defensive_units[2].min(player.defensive_unit_3);

    // Base power from defensive units
    let unit_power = units_0
        .saturating_mul(DEFENSIVE_UNIT_1_POWER)
        .saturating_add(units_1.saturating_mul(DEFENSIVE_UNIT_2_POWER))
        .saturating_add(units_2.saturating_mul(DEFENSIVE_UNIT_3_POWER));

    // Equipment power (also clamped to owned)
    let melee = loadout.melee_weapons.min(player.melee_weapons);
    let ranged = loadout.ranged_weapons.min(player.ranged_weapons);
    let siege = loadout.siege_weapons.min(player.siege_weapons);
    let armor = loadout.armor_pieces.min(player.armor_pieces);
    let equipment_power = melee
        .saturating_mul(ARENA_MELEE_WEAPON_POWER)
        .saturating_add(ranged.saturating_mul(ARENA_RANGED_WEAPON_POWER))
        .saturating_add(siege.saturating_mul(ARENA_SIEGE_WEAPON_POWER))
        .saturating_add(armor.saturating_mul(ARENA_ARMOR_POWER));

    let base_power = unit_power.saturating_add(equipment_power);

    // Research buffs (from PlayerCore)
    let research_bonus_bps =
        (player.research_attack_bps() as u64).saturating_add(player.research_defense_bps() as u64);

    // Hero buffs (cached on PlayerCore from active heroes)
    let hero_bonus_bps = (player.hero_attack_bps() as u64)
        .saturating_add(player.hero_defense_bps() as u64)
        .saturating_add(player.hero_weapon_efficiency_bps() as u64)
        .saturating_add(player.hero_armor_efficiency_bps() as u64);

    // Location synergy (heroes at home city get bonus)
    let location_bonus_bps = (player.slot_location_bonus_at(0 as usize) as u64)
        .saturating_add(player.slot_location_bonus_at(1 as usize) as u64)
        .saturating_add(player.slot_location_bonus_at(2 as usize) as u64);

    // Blessed hero bonus (from Sanctuary meditation)
    let blessed_bonus_bps = player.blessed_hero_bonus_bps() as u64;

    // Equipped item bonuses (from Forge crafted equipment)
    let equipped_bonus_bps = (player.equipped_weapon_bonus_bps() as u64)
        .saturating_add(player.equipped_armor_bonus_bps() as u64);

    // Arena-specific hero bonus (if loadout specifies a hero)
    // Heroes are Metaplex Core NFTs - parse buff data from NFT attributes
    let arena_hero_bonus_bps = if loadout.arena_hero != Address::default() {
        if let Ok(nft_data) = hero_account.try_borrow() {
            if let Some(parsed_hero) = parse_hero_nft(&nft_data) {
                // Sum AttackPower(1) + DefensePower(2) buffs
                let mut bonus: u64 = 0;
                for i in 0..(parsed_hero.buff_count as usize) {
                    let buff = &parsed_hero.buffs[i];
                    if buff.stat == BuffStat::AttackPower as u8
                        || buff.stat == BuffStat::DefensePower as u8
                    {
                        // Buff values are stored directly (not per-level) in NFT
                        bonus = bonus.saturating_add(buff.value as u64);
                    }
                }
                bonus
            } else {
                0
            }
        } else {
            0
        }
    } else {
        0
    };

    // Estate buffs
    let estate_bonus_bps = if unsafe { estate_account.owner() } == program_id {
        if let Ok(estate_data) = estate_account.try_borrow() {
            if estate_data.len() >= EstateAccount::LEN {
                let estate = unsafe { &*(estate_data.as_ptr() as *const EstateAccount) };
                (estate.attack_bps as u64)
                    .saturating_add(estate.defense_bps as u64)
                    .saturating_add(estate.pvp_damage_bps as u64)
                    .saturating_add(estate.unit_effectiveness_bps as u64)
                    .saturating_add(estate.arena_damage_bps as u64)
            } else {
                0
            }
        } else {
            0
        }
    } else {
        0
    };

    // Total bonus
    let total_bonus_bps = research_bonus_bps
        .saturating_add(hero_bonus_bps)
        .saturating_add(location_bonus_bps)
        .saturating_add(blessed_bonus_bps)
        .saturating_add(equipped_bonus_bps)
        .saturating_add(arena_hero_bonus_bps)
        .saturating_add(estate_bonus_bps);

    // Apply: base_power × (1 + total_bonus_bps / 10000)
    let multiplier = 10000u64.saturating_add(total_bonus_bps);
    base_power.saturating_mul(multiplier) / 10000
}

/// Calculate battle points for winner and loser
fn calculate_battle_points(
    challenger_won: bool,
    is_draw: bool,
    challenger_power: u64,
    defender_power: u64,
) -> (u64, u64) {
    if is_draw {
        return (ARENA_DRAW_POINTS, ARENA_DRAW_POINTS);
    }

    let (winner_power, loser_power, winner_base, loser_base) = if challenger_won {
        (
            challenger_power,
            defender_power,
            ARENA_BASE_WIN_POINTS,
            ARENA_BASE_LOSS_POINTS,
        )
    } else {
        (
            defender_power,
            challenger_power,
            ARENA_BASE_WIN_POINTS,
            ARENA_BASE_LOSS_POINTS,
        )
    };

    // Underdog bonus: if winner had less power, they get bonus points
    let winner_points = if winner_power < loser_power {
        // Calculate percentage disadvantage (capped at 50%)
        let disadvantage_bps = if loser_power > 0 {
            // u128 intermediate: loadout-derived powers are attacker-controlled
            // and can exceed u64::MAX/10000, wrapping a plain `* 10000`.
            ((loser_power.saturating_sub(winner_power) as u128 * 10000) / loser_power as u128)
                .min(5000) as u64
        } else {
            0
        };
        // Apply underdog bonus (5% per 10% disadvantage)
        let underdog_bonus = winner_base
            .saturating_mul(disadvantage_bps)
            .saturating_mul(ARENA_UNDERDOG_BONUS_BPS)
            / (10000 * 1000);
        winner_base.saturating_add(underdog_bonus)
    } else {
        winner_base
    };

    if challenger_won {
        (winner_points, loser_base)
    } else {
        (loser_base, winner_points)
    }
}

/// Update ELO ratings based on match result
fn update_elo(
    challenger_elo: u32,
    defender_elo: u32,
    challenger_won: bool,
    is_draw: bool,
) -> (u32, u32) {
    // ELO calculation using K-factor
    // Expected score = 1 / (1 + 10^((opponent_elo - player_elo) / 400))
    // We use a simplified integer approximation

    let diff = defender_elo as i64 - challenger_elo as i64;

    // Approximate expected score (scaled to 0-100)
    // Using lookup-style approximation for common differences
    let challenger_expected = match diff.abs() {
        0..=50 => 50,
        51..=100 => {
            if diff > 0 {
                36
            } else {
                64
            }
        }
        101..=200 => {
            if diff > 0 {
                24
            } else {
                76
            }
        }
        201..=300 => {
            if diff > 0 {
                15
            } else {
                85
            }
        }
        _ => {
            if diff > 0 {
                9
            } else {
                91
            }
        }
    };

    let defender_expected = 100 - challenger_expected;

    // Actual score (100 for win, 50 for draw, 0 for loss)
    let (challenger_actual, defender_actual) = if is_draw {
        (50i64, 50i64)
    } else if challenger_won {
        (100i64, 0i64)
    } else {
        (0i64, 100i64)
    };

    // New ELO = old + K * (actual - expected) / 100
    let challenger_delta =
        (ARENA_ELO_K_FACTOR as i64 * (challenger_actual - challenger_expected as i64)) / 100;
    let defender_delta =
        (ARENA_ELO_K_FACTOR as i64 * (defender_actual - defender_expected as i64)) / 100;

    let new_challenger = (challenger_elo as i64)
        .saturating_add(challenger_delta)
        .clamp(100, u32::MAX as i64) as u32;
    let new_defender = (defender_elo as i64)
        .saturating_add(defender_delta)
        .clamp(100, u32::MAX as i64) as u32;

    (new_challenger, new_defender)
}
