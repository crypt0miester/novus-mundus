use crate::utils::fibonacci::*;
use fastrand;

pub fn consume_turns(turns: u64, luck: f32) -> u64 {
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
