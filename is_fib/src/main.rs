use std::time::Instant;

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

fn get_range_0_1(n: u64) -> f64 {
    (n as f64).cos()
}
fn get_distance_between_to_locations() {
    let earth_radius_kilometer = 6371.0_f64;
    let (paris_latitude_degrees, paris_longitude_degrees) = (48.85341_f64, -2.34880_f64);
    let (london_latitude_degrees, london_longitude_degrees) = (51.50853_f64, -0.12574_f64);

    let paris_latitude = paris_latitude_degrees.to_radians();
    let london_latitude = london_latitude_degrees.to_radians();

    let delta_latitude = (paris_latitude_degrees - london_latitude_degrees).to_radians();
    let delta_longitude = (paris_longitude_degrees - london_longitude_degrees).to_radians();

    let central_angle_inner = (delta_latitude / 2.0).sin().powi(2)
        + paris_latitude.cos() * london_latitude.cos() * (delta_longitude / 2.0).sin().powi(2);
    let central_angle = 2.0 * central_angle_inner.sqrt().asin();

    let distance = earth_radius_kilometer * central_angle;

    println!(
        "Distance between Paris and London on the surface of Earth is {:.1} kilometers",
        distance
    );
}

pub fn fast_sum(values: &[u64]) -> u64 {
    const LANES: usize = 8;
    let chunks = values.chunks_exact(LANES);
    let remainder = chunks.remainder();

    let sum = chunks.fold([0_u64; LANES], |mut acc, chunk| {
        let chunk: [u64; LANES] = chunk.try_into().unwrap();
        for i in 0..LANES {
            acc[i] += chunk[i];
        }
        acc
    });

    let remainder: u64 = remainder.iter().copied().sum();

    let mut reduced = 0u64;
    for i in 0..LANES {
        reduced += sum[i];
    }
    reduced + remainder
}

fn main() {
    // println!("Hello, world!");

    let start2 = Instant::now();
    let n: u64 = 1346269;
    println!("is_fib, {:?}", is_fib(n));
    let elapsed2 = start2.elapsed();
    println!("Debug: {:?}", elapsed2);

    let start2 = Instant::now();
    println!("fastrand, {:?}", fastrand::u64(1000..1750));

    let elapsed2 = start2.elapsed();
    println!("Debug: {:?}", elapsed2);

    let start2 = Instant::now();
    for n in 0..31 {
        println!("{:?}, ", get_fib((n).try_into().unwrap()));
    }
    let elapsed2 = start2.elapsed();
    println!("Debug: {:?}", elapsed2);

    let start2 = Instant::now();
    let z: [u64; 31] = [
        1, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233, 377, 610, 987, 1597, 2584, 4181, 6765,
        10946, 17711, 28657, 46368, 75025, 121393, 196418, 317811, 514229, 832040, 1346269,
    ];
    println!("{:?}", z.iter().sum::<u64>());
    let elapsed2 = start2.elapsed();
    // Debug format
    println!("Debug: {:?}", elapsed2);
}
