#[derive(Debug)]
struct MondusTree<T: Ord> {
    values: Vec<T>,
}

impl<T: Ord + std::fmt::Display> MondusTree<T> {
    pub fn new() -> Self {
        MondusTree { values: Vec::new() }
    }

    pub fn insert(&mut self, value: T)
    where
        T: Ord + Copy,
    {
        let mut i = self.values.len();
        self.values.push(value);
        while i > 0 {
            let parent = (i - 1) / 2;
            if self.values[parent] <= value {
                break;
            }
            self.values.swap(i, parent);
            i = parent;
        }
        self.values.sort();
    }

    pub fn remove_smallest(&mut self) -> T {
        let mut i = 0;
        let result = self.values.swap_remove(i);
        if self.values.is_empty() {
            return result;
        }
        while i < self.values.len() {
            let left = 2 * i + 1;
            let right = 2 * i + 2;
            let mut smallest = i;
            if left < self.values.len() && self.values[left] < self.values[smallest] {
                smallest = left;
            }
            if right < self.values.len() && self.values[right] < self.values[smallest] {
                smallest = right;
            }
            if smallest == i {
                break;
            }
            self.values.swap(i, smallest);
            i = smallest;
        }
        result
    }

    pub fn remove(&mut self, value: T) -> bool
    where
        T: Ord + Copy,
    {
        let mut i = 0;
        while i < self.values.len() {
            if self.values[i] == value {
                self.values.swap_remove(i);
                return true;
            }
            if value < self.values[i] {
                i = 2 * i + 1;
            } else {
                i = 2 * i + 2;
            }
        }
        false
    }

    pub fn search(&self, value: T) -> bool
    where
        T: Ord + Copy,
    {
        if self.values.get(0) == Some(&value) {
            return true;
        }
        let mut i = 0;
        while i < self.values.len() {
            let left = i + 1;
            let right = i + 2;
            if left < self.values.len() && self.values[left] == value {
                return true;
            }
            if right < self.values.len() && self.values[right] == value {
                return true;
            }
            if value < self.values[i] {
                i = left;
            } else {
                i = right;
            }
        }
        false
    }
}
