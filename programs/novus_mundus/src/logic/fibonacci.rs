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

/// Calculate integer square root using Newton's method
fn integer_sqrt(n: u128) -> u128 {
    if n < 2 {
        return n;
    }

    // Seed at 2^ceil(bits/2) >= sqrt(n); Newton then converges monotonically
    // down to floor(sqrt(n)) in ~6 iterations (vs ~128 for binary search).
    let bits = 128 - n.leading_zeros();
    let mut x = 1u128 << ((bits + 1) / 2);
    loop {
        let y = (x + n / x) / 2;
        if y >= x {
            break;
        }
        x = y;
    }
    x
}
