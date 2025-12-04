use pinocchio::{
    account_info::AccountInfo,
    pubkey::Pubkey,
    ProgramResult,
};

use crate::{
    error::GameError,
    state::{EventAccount, EventParticipation, LeaderboardEntry},
    types::EventType,
};

/// Update event score from game actions
///
/// This is the central entry point for all event scoring.
/// Called by processors (attack, collect, etc.) with optional event accounts.
///
/// Validates:
/// - Event is active (auto-activates if needed)
/// - Time window is valid
/// - Event type matches action
/// - Player participation is valid
///
/// Updates:
/// - EventParticipation score (accumulative or snapshot)
/// - EventAccount leaderboard (maintains top 10, sorted)
pub fn update_event_score(
    event_participation_account: &AccountInfo,
    event_account: &AccountInfo,
    player_key: &Pubkey,
    action_type: EventType,
    score_value: u64,
    now: i64,
) -> ProgramResult {
    // 1. Load Accounts
    let mut event_participation_account_ref = event_participation_account.try_borrow_mut_data()?;
    let mut event_account_ref = event_account.try_borrow_mut_data()?;
    let participation = unsafe { EventParticipation::load_mut(&mut event_participation_account_ref) };
    let event = unsafe { EventAccount::load_mut(&mut event_account_ref) };

    // 2. Validate Ownership

    if &participation.player != player_key {
        return Err(GameError::Unauthorized.into());
    }

    if participation.event_id != event.id {
        return Err(GameError::InvalidParameter.into());
    }

    // 3. Ensure Event is Active (with auto-activation)

    ensure_event_active(event, now)?;

    // 4. Check Event Type Matches Action

    if event.event_type != action_type as u8 {
        return Ok(()); // Wrong type, skip silently
    }

    // 5. Check Time Window

    if now < event.start_time || now >= event.end_time {
        return Ok(()); // Outside window, skip
    }

    // 6. Update Score Based on Type

    let event_type = EventType::from_u8(event.event_type)
        .ok_or(GameError::InvalidParameter)?;

    if event_type.is_accumulative() {
        // Accumulative: add to score
        participation.score = participation.score.saturating_add(score_value);
    } else {
        // Snapshot: replace if higher
        if score_value > participation.score {
            participation.score = score_value;
        }
    }

    participation.last_update = now;

    // 7. Update Leaderboard (top 10, sorted descending)

    update_leaderboard(
        &mut event.leaderboard,
        &mut event.leaderboard_count,
        player_key,
        participation.score,
    );

    Ok(())
}

/// Ensure event is active, auto-activating if needed
fn ensure_event_active(event: &mut EventAccount, now: i64) -> Result<(), GameError> {
    match event.status {
        0 => { // pending
            if now >= event.start_time && now < event.end_time && event.auto_activate {
                event.status = 1; // activate
                Ok(())
            } else if now < event.start_time {
                Err(GameError::EventNotStarted)
            } else {
                Err(GameError::EventEnded)
            }
        },
        1 => { // active
            if now >= event.end_time {
                Err(GameError::EventEnded)
            } else {
                Ok(())
            }
        },
        2 => Err(GameError::EventNotCompleted), // finalized, can't score
        3 => Err(GameError::EventCancelled),
        _ => Err(GameError::InvalidParameter),
    }
}

/// Update leaderboard with new/updated score
///
/// Maintains sorted order (descending by score).
/// If player already in leaderboard, updates their score and re-sorts.
/// If player not in leaderboard, inserts if score qualifies for top 10.
fn update_leaderboard(
    leaderboard: &mut [LeaderboardEntry; 10],
    count: &mut u8,
    player: &Pubkey,
    new_score: u64,
) {
    let len = *count as usize;

    // 1. Check if Player Already in Leaderboard

    for i in 0..len {
        if &leaderboard[i].player == player {
            if leaderboard[i].score == new_score {
                return; // No change
            }

            let old_score = leaderboard[i].score;
            leaderboard[i].score = new_score;

            // Bubble sort to maintain order
            if new_score > old_score {
                // Move up
                let mut j = i;
                while j > 0 && leaderboard[j].score > leaderboard[j - 1].score {
                    leaderboard.swap(j, j - 1);
                    j -= 1;
                }
            } else {
                // Move down
                let mut j = i;
                while j < len - 1 && leaderboard[j].score < leaderboard[j + 1].score {
                    leaderboard.swap(j, j + 1);
                    j += 1;
                }
            }
            return;
        }
    }

    // 2. Player Not in Leaderboard - Try to Insert

    // Check if score qualifies
    if len >= 10 && new_score <= leaderboard[9].score {
        return; // Score too low
    }

    // Find insertion point
    let mut insert_idx = len.min(10);
    for i in 0..len.min(10) {
        if new_score > leaderboard[i].score {
            insert_idx = i;
            break;
        }
    }

    // Shift entries down
    for i in (insert_idx + 1..=len.min(9)).rev() {
        leaderboard[i] = leaderboard[i - 1];
    }

    // Insert new entry
    leaderboard[insert_idx] = LeaderboardEntry {
        player: *player,
        score: new_score,
    };

    if len < 10 {
        *count += 1;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::player::NULL_PUBKEY;

    #[test]
    fn test_leaderboard_insert_empty() {
        let mut leaderboard = [LeaderboardEntry { player: NULL_PUBKEY, score: 0 }; 10];
        let mut count = 0u8;
        let player1 = Pubkey::from([1u8; 32]);

        update_leaderboard(&mut leaderboard, &mut count, &player1, 100);

        assert_eq!(count, 1);
        assert_eq!(leaderboard[0].score, 100);
        assert_eq!(leaderboard[0].player, player1);
    }

    #[test]
    fn test_leaderboard_maintains_order() {
        let mut leaderboard = [LeaderboardEntry { player: NULL_PUBKEY, score: 0 }; 10];
        let mut count = 0u8;
        let player1 = Pubkey::from([1u8; 32]);
        let player2 = Pubkey::from([2u8; 32]);
        let player3 = Pubkey::from([3u8; 32]);

        update_leaderboard(&mut leaderboard, &mut count, &player1, 100);
        update_leaderboard(&mut leaderboard, &mut count, &player2, 200);
        update_leaderboard(&mut leaderboard, &mut count, &player3, 150);

        assert_eq!(count, 3);
        assert_eq!(leaderboard[0].score, 200); // player2
        assert_eq!(leaderboard[1].score, 150); // player3
        assert_eq!(leaderboard[2].score, 100); // player1
    }

    #[test]
    fn test_leaderboard_update_existing() {
        let mut leaderboard = [LeaderboardEntry { player: NULL_PUBKEY, score: 0 }; 10];
        let mut count = 0u8;
        let player1 = Pubkey::from([1u8; 32]);

        update_leaderboard(&mut leaderboard, &mut count, &player1, 100);
        update_leaderboard(&mut leaderboard, &mut count, &player1, 200);

        assert_eq!(count, 1); // Still 1 player
        assert_eq!(leaderboard[0].score, 200); // Updated score
    }

    #[test]
    fn test_leaderboard_max_10() {
        let mut leaderboard = [LeaderboardEntry { player: NULL_PUBKEY, score: 0 }; 10];
        let mut count = 0u8;

        // Add 10 players
        for i in 0..10 {
            let player = Pubkey::from([i as u8; 32]);
            update_leaderboard(&mut leaderboard, &mut count, &player, (i + 1) * 10);
        }

        assert_eq!(count, 10);

        // Try to add 11th player with low score (should not be added)
        let player11 = Pubkey::from([11u8; 32]);
        update_leaderboard(&mut leaderboard, &mut count, &player11, 5);

        assert_eq!(count, 10); // Still 10
        assert_ne!(leaderboard[9].player, player11);

        // Add 11th player with high score (should replace lowest)
        update_leaderboard(&mut leaderboard, &mut count, &player11, 1000);

        assert_eq!(count, 10); // Still 10
        assert_eq!(leaderboard[0].score, 1000); // New top score
    }
}
