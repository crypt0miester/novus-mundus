/// Check if a number is in the Fibonacci sequence
///
/// Uses the mathematical property that n is Fibonacci if and only if
/// one of (5*n² + 4) or (5*n² - 4) is a perfect square
pub fn is_fibonacci(n: u64) -> bool {
    if n == 0 || n == 1 {
        return true;
    }

    let five_n_squared = match (5u128).checked_mul(n as u128).and_then(|x| x.checked_mul(n as u128)) {
        Some(val) => val,
        None => return false, // Overflow, not a valid Fibonacci number
    };

    is_perfect_square(five_n_squared + 4) || is_perfect_square(five_n_squared - 4)
}

/// Check if a number is a perfect square
fn is_perfect_square(n: u128) -> bool {
    if n == 0 {
        return true;
    }

    let sqrt = integer_sqrt(n);
    sqrt * sqrt == n
}

/// Calculate integer square root using binary search
fn integer_sqrt(n: u128) -> u128 {
    if n == 0 {
        return 0;
    }

    let mut low = 1u128;
    let mut high = n;
    let mut result = 0u128;

    while low <= high {
        let mid = low + (high - low) / 2;
        let mid_squared = mid.saturating_mul(mid);

        if mid_squared == n {
            return mid;
        } else if mid_squared < n {
            low = mid + 1;
            result = mid;
        } else {
            if mid == 0 {
                break;
            }
            high = mid - 1;
        }
    }

    result
}
