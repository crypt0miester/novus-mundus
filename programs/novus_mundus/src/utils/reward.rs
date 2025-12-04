const NUM_TIERS: i32 = 4;
const NUM_TOP_PLAYERS: i32 = 10;
const NUM_TOP_TEAMS: i32 = 10;

struct Player {
    rank: i32,
    rewards: i64,
}

struct Team {
    rank: i32,
    rewards: i64,
}

fn calculate_rewards(players: &mut Vec<Player>, teams: &mut Vec<Team>, total_rewards: i64) {
    let total_player_rewards = total_rewards * NUM_TOP_PLAYERS as i64 * NUM_TIERS as i64
        / (NUM_TOP_PLAYERS as i64 * NUM_TIERS as i64 + NUM_TOP_TEAMS as i64);
    let total_team_rewards = total_rewards - total_player_rewards;

    // Sort players by rank
    players.sort_by(|a, b| a.rank.cmp(&b.rank));

    // Distribute rewards to players
    let mut remaining_player_rewards = total_player_rewards;
    for i in 0..NUM_TOP_PLAYERS * NUM_TIERS {
        if i == 0 {
            players[i].rewards = total_player_rewards / 2;
            remaining_player_rewards -= players[i].rewards;
        } else {
            players[i].rewards = remaining_player_rewards
                / libm::ceil(libm::log2((NUM_TOP_PLAYERS * NUM_TIERS - i + 1) as f64)) as i64;
            remaining_player_rewards -= players[i].rewards;
        }
    }

    // Sort teams by rank
    teams.sort_by(|a, b| a.rank.cmp(&b.rank));

    // Distribute rewards to teams
    let mut remaining_team_rewards = total_team_rewards;
    for i in 0..NUM_TOP_TEAMS {
        teams[i].rewards =
            remaining_team_rewards / libm::ceil(libm::log2((NUM_TOP_TEAMS - i + 1) as f64)) as i64;
        remaining_team_rewards -= teams[i].rewards;
    }
}
