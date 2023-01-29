use std::cmp::Ordering;

struct Leaderboard<T> {
    scores: Vec<Ranking<T>>,
}

struct Ranking<T> {
    score: u128,
    player: T,
}

impl<T: std::cmp::PartialEq> Leaderboard<T> {
    fn new() -> Self {
        Leaderboard { scores: Vec::new() }
    }

    fn add_player(&mut self, player: T, score: u128) {
        let ranking = Ranking { score, player };
        self.scores.push(ranking);
        self.scores.sort_by(|a, b| b.score.cmp(&a.score));
    }

    fn update_score(&mut self, player: T, score: u128) {
        let index = self
            .scores
            .iter()
            .position(|r| r.player == player)
            .expect("player not found");
        self.scores[index].score = score;
        self.scores.sort_by(|a, b| b.score.cmp(&a.score));
    }

    fn remove_player(&mut self, player: T) {
        let index = self
            .scores
            .iter()
            .position(|r| r.player == player)
            .expect("player not found");
        self.scores.remove(index);
    }

    fn top(&self, n: usize) -> Vec<Option<(&T, &u128)>> {
        let mut result = Vec::new();
        for (i, r) in self.scores.iter().enumerate() {
            if i >= n {
                break;
            }
            result.push(Some((&r.player, &r.score)));
        }
        while result.len() < n {
            result.push(None);
        }
        result
    }
    fn ranking(&self, player: T) -> Option<usize> {
        let index = self
            .scores
            .iter()
            .position(|r| r.player == player)
            .map(|i| i + 1);
        if let Some(index) = index {
            if index > self.scores.len() {
                return None;
            }
        }
        index
    }
}

impl<T: Ord> PartialEq for Ranking<T> {
    fn eq(&self, other: &Self) -> bool {
        self.score == other.score
    }
}

impl<T: Ord> Eq for Ranking<T> {}

impl<T: Ord> PartialOrd for Ranking<T> {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        other.score.partial_cmp(&self.score)
    }
}

impl<T: Ord> Ord for Ranking<T> {
    fn cmp(&self, other: &Self) -> Ordering {
        other.score.cmp(&self.score)
    }
}

fn main() {
    let mut leaderboard = Leaderboard::new();

    // Add some players to the leaderboard
    leaderboard.add_player("Alice", 100);
    leaderboard.add_player("Bob", 90);
    leaderboard.add_player("Charlie", 80);
    leaderboard.add_player("Dave", 70);
    leaderboard.add_player("Eve", 60);

    // Print the top 3 players
    println!("Top players: {:?}", leaderboard.top(3));

    // Update the score for Bob
    leaderboard.update_score("Bob", 102);

    // Print the top 3 players again
    println!("Top players: {:?}", leaderboard.top(3));

    // Remove Dave from the leaderboard
    leaderboard.remove_player("Charlie");

    // Print the top 3 players again
    println!("Top players: {:?}", leaderboard.top(8));
}
