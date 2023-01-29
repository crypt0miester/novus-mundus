use fastrand;

fn consume_turns(turns: u64, luck: f32) -> u64 {
    let rand_1 = fastrand::u64(1000_u64..1750_u64);
    let rand_2 = fastrand::u64(1000_u64..1500_u64);
    let consuming =
        ((rand_1 as f32 / 100.0) * turns as f32 * luck * (rand_2 as f32 / 1000.0)).round() as u64;

    let rand_fib = fastrand::u64(1200_u64..1500_u64);
    if is_fib(turns) {
        println!("is_fib {}", consuming);
        consuming * rand_fib
    } else {
        println!("not fib {}", consuming);
        consuming
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

fn is_fib(n: u64) -> bool {
    let _ = n == 0 && return false;
    let n_squared = n.pow(2);
    let coefficient = 5_u64.checked_mul(n_squared).unwrap();
    let x = coefficient.checked_add(4).unwrap() as usize;
    let y = coefficient.checked_sub(4).unwrap() as usize;
    is_perfect_square(x) || is_perfect_square(y)
}

fn main() {
    consume_turns(987_u64, 1.0);
}
