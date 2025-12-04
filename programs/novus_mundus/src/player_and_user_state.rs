use std::time::{SystemTime, UNIX_EPOCH};

pub fn update_tokens(user: &mut User, player: &mut Player) {
    // constants
    let timestamp_now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs() as u64;
    let time_interval = 5 * 60;

    // subscriptions check
    let sub_end = user.subscription_end;
    let mut subscription_interval = user.subscription_interval;
    if sub_end != 0 && sub_end < timestamp_now {
        subscription_interval = 10;
    }

    let max_player_tokens_generation = subscription_interval * 300;

    if max_player_tokens_generation > player.tokens {
        if timestamp_now + time_interval >= player.last_updated_tokens_at {
            let remaining = timestamp_now.saturating_sub(player.last_updated_tokens_at);
            let interval_to_remaining = remaining.checked_div(time_interval).unwrap();
            let add_tokens = interval_to_remaining * subscription_interval as u64;
            if (player.tokens + add_tokens) >= max_player_tokens_generation {
                player.tokens = max_player_tokens_generation;
            }
            player.tokens += add_tokens;
            player.last_updated_tokens_at = timestamp_now;
        }
    }
}