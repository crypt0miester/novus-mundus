fn is_perfect_square(n: usize) -> bool {
    match n & 0xf {
        0 | 1 | 4 | 9 => {
            let t = isqrt(n);
            if t * t == n {
                true
            } else {
                false
            }
        }
        _ => false,
    }
}

fn isqrt(n: usize) -> usize {
    let mut s = (n as f64).sqrt() as usize;
    s = (s + n / s) >> 1;
    if s * s > n {
        s - 1
    } else {
        s
    }
}

pub fn get_fib(n: usize) -> usize {
    let mut a = 1;
    let mut b = 1;

    for _ in 1..n {
        let old = a;
        a = b;
        b += old;
    }

    b
}

fn is_fib(n: u64) -> bool {
    let _ = n == 0 && return false;
    let n_squared = n.pow(2);
    let coefficient = 5_u64.checked_mul(n_squared).unwrap();
    let x = coefficient.checked_add(4).unwrap() as usize;
    let y = coefficient.checked_sub(4).unwrap() as usize;
    is_perfect_square(x) || is_perfect_square(y)
}
