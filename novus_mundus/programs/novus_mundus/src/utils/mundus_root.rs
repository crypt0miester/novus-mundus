use std::cmp::Ordering;

struct Node {
    key: Vec<u8>,
    left: Option<Box<Node>>,
    right: Option<Box<Node>>,
}

impl Node {
    fn new(key: Vec<u8>) -> Self {
        Self {
            key,
            left: None,
            right: None,
        }
    }
}

struct MundusRoot {
    root: Option<Box<Node>>,
}

impl MundusRoot {
    // ...

    pub fn remove(&mut self, key: &[u8]) -> Option<Vec<u8>> {
        let mut current_node = &mut self.root;
        while current_node.is_some() {
            let current_key = &current_node.as_ref().unwrap().key;
            match key.cmp(current_key) {
                Ordering::Less => {
                    current_node = &mut current_node.as_mut().unwrap().left;
                }
                Ordering::Greater => {
                    current_node = &mut current_node.as_mut().unwrap().right;
                }
                Ordering::Equal => {
                    let node = current_node.take().unwrap();
                    let left = node.left;
                    let right = node.right;
                    let key = node.key;
                    if left.is_none() && right.is_none() {
                        // The node is a leaf node, so we can just remove it
                        return Some(key);
                    } else if left.is_none() {
                        // The node has only a right child, so we can replace it with its right child
                        *current_node = right;
                        return Some(key);
                    } else if right.is_none() {
                        // The node has only a left child, so we can replace it with its left child
                        *current_node = left;
                        return Some(key);
                    } else {
                        // The node has two children, so we find the smallest node in its right subtree
                        // and replace the node with it
                        let mut smallest_node = &mut right;
                        while smallest_node.as_ref().unwrap().left.is_some() {
                            smallest_node = &mut smallest_node.as_mut().unwrap().left;
                        }
                        let smallest_key = smallest_node.as_mut().unwrap().key.clone();
                        smallest_node.take();
                        current_node.as_mut().unwrap().key = smallest_key;
                        return Some(key);
                    }
                }
            }
        }
        None
    }
}
