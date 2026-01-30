//! Kingdom Validation Helpers
//!
//! This module provides helper functions for validating kingdom membership
//! and preventing cross-kingdom interactions.

#![allow(dead_code)]

use pinocchio::pubkey::Pubkey;
use pinocchio::program_error::ProgramError;
use crate::error::GameError;

/// Validate that a player belongs to the specified kingdom
///
/// # Arguments
/// * `player_game_engine` - The game_engine pubkey stored in the player account
/// * `expected_game_engine` - The expected kingdom's game_engine pubkey
///
/// # Errors
/// Returns `GameError::KingdomMismatch` if the player is in a different kingdom
#[inline]
pub fn validate_player_kingdom(
    player_game_engine: &Pubkey,
    expected_game_engine: &Pubkey,
) -> Result<(), ProgramError> {
    if player_game_engine != expected_game_engine {
        return Err(GameError::KingdomMismatch.into());
    }
    Ok(())
}

/// Validate that two players are in the same kingdom
///
/// # Arguments
/// * `player1_game_engine` - The game_engine pubkey of the first player
/// * `player2_game_engine` - The game_engine pubkey of the second player
///
/// # Errors
/// Returns `GameError::CrossKingdomNotAllowed` if the players are in different kingdoms
#[inline]
pub fn validate_same_kingdom(
    player1_game_engine: &Pubkey,
    player2_game_engine: &Pubkey,
) -> Result<(), ProgramError> {
    if player1_game_engine != player2_game_engine {
        return Err(GameError::CrossKingdomNotAllowed.into());
    }
    Ok(())
}

/// Validate that an entity belongs to the same kingdom as a player
///
/// Use this for validating that a player can interact with kingdom-scoped entities
/// like rallies, teams, events, castles, etc.
///
/// # Arguments
/// * `player_game_engine` - The game_engine pubkey of the player
/// * `entity_game_engine` - The game_engine pubkey of the entity
///
/// # Errors
/// Returns `GameError::CrossKingdomNotAllowed` if they are in different kingdoms
#[inline]
pub fn validate_entity_kingdom(
    player_game_engine: &Pubkey,
    entity_game_engine: &Pubkey,
) -> Result<(), ProgramError> {
    if player_game_engine != entity_game_engine {
        return Err(GameError::CrossKingdomNotAllowed.into());
    }
    Ok(())
}

/// Validate that a city belongs to a specific kingdom
///
/// # Arguments
/// * `city_game_engine` - The game_engine pubkey of the city
/// * `expected_game_engine` - The expected kingdom's game_engine pubkey
///
/// # Errors
/// Returns `GameError::KingdomMismatch` if the city is in a different kingdom
#[inline]
pub fn validate_city_kingdom(
    city_game_engine: &Pubkey,
    expected_game_engine: &Pubkey,
) -> Result<(), ProgramError> {
    if city_game_engine != expected_game_engine {
        return Err(GameError::KingdomMismatch.into());
    }
    Ok(())
}

/// Validate that a team, rally, or other group entity is in the same kingdom as a player
///
/// # Arguments
/// * `group_game_engine` - The game_engine pubkey of the group entity
/// * `player_game_engine` - The game_engine pubkey of the player
///
/// # Errors
/// Returns `GameError::CrossKingdomNotAllowed` if they are in different kingdoms
#[inline]
pub fn validate_group_membership(
    group_game_engine: &Pubkey,
    player_game_engine: &Pubkey,
) -> Result<(), ProgramError> {
    if group_game_engine != player_game_engine {
        return Err(GameError::CrossKingdomNotAllowed.into());
    }
    Ok(())
}

/// Validate that all provided game_engine pubkeys match
///
/// Useful for validating multi-account interactions where all accounts
/// must be in the same kingdom.
///
/// # Arguments
/// * `game_engines` - Slice of game_engine pubkeys to validate
///
/// # Errors
/// Returns `GameError::CrossKingdomNotAllowed` if any pubkeys differ
pub fn validate_all_same_kingdom(game_engines: &[&Pubkey]) -> Result<(), ProgramError> {
    if game_engines.is_empty() {
        return Ok(());
    }

    let first = game_engines[0];
    for engine in game_engines.iter().skip(1) {
        if *engine != first {
            return Err(GameError::CrossKingdomNotAllowed.into());
        }
    }
    Ok(())
}
