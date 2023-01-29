use std::cmp::Ordering;

pub struct Leaderboard<T> {
    pub scores: Vec<Ranking<T>>,
}

pub struct Ranking<T> {
    pub score: u128,
    pub player: T,
}

impl<T: std::cmp::PartialEq> Leaderboard<T> {
    pub fn new() -> Self {
        Leaderboard { scores: Vec::new() }
    }

    pub fn add_player(&mut self, player: T, score: u128) {
        let ranking = Ranking { score, player };
        self.scores.push(ranking);
        self.scores.sort_by(|a, b| b.score.cmp(&a.score));
    }

    pub fn update_score(&mut self, player: T, score: u128) {
        let index = self
            .scores
            .iter()
            .position(|r| r.player == player)
            .expect("player not found");
        self.scores[index].score = score;
        self.scores.sort_by(|a, b| b.score.cmp(&a.score));
    }

    pub fn remove_player(&mut self, player: T) {
        let index = self
            .scores
            .iter()
            .position(|r| r.player == player)
            .expect("player not found");
        self.scores.remove(index);
    }

    pub fn top(&self, n: usize) -> Vec<Option<(&T, &u128)>> {
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
    pub fn ranking(&self, player: T) -> Option<usize> {
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
