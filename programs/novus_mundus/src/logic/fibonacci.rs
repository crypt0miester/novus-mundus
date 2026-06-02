/// Check if a number is in the Fibonacci sequence.
///
/// Generates Fibonacci numbers in u64 and compares against `n`. There are only
/// ~93 Fibonacci numbers below `u64::MAX`, so this is a short, overflow-safe
/// loop (it stops as soon as a generated value reaches `n`, or `checked_add`
/// overflows past the largest representable Fibonacci number).
///
/// The closed-form test (one of `5·n²±4` is a perfect square) is mathematically
/// equivalent but forces u128 arithmetic plus an integer square root — both
/// division-heavy and costly in SBF compute units, since the 64-bit VM lowers
/// 128-bit multiply/divide to compiler-rt helper calls.
pub fn is_fibonacci(n: u64) -> bool {
    if n == 0 {
        return true;
    }

    // (a, b) are consecutive Fibonacci numbers; we test `b` against `n`.
    let mut a = 0u64;
    let mut b = 1u64;
    loop {
        if b == n {
            return true;
        }
        if b > n {
            return false;
        }
        match b.checked_add(a) {
            Some(next) => {
                a = b;
                b = next;
            }
            // Next Fibonacci number overflows u64 and we still have b < n, so n
            // is larger than every Fibonacci number representable in u64.
            None => return false,
        }
    }
}
