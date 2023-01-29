use chrono::{Local, TimeZone};
use std::f64::consts::PI;
use std::f64::consts::PI;

fn oscillate_position(time: f64, frequency: f64, amplitude: f64) -> f64 {
    let oscillation = (time * frequency * 2.0 * PI).sin() * amplitude;
    oscillation
}

fn main() {
    let time = 0.0; // initial time
    let frequency = 1.0; // oscillation frequency (in Hz)
    let amplitude = 1.0; // oscillation amplitude
    let position = oscillate_position(time, frequency, amplitude);
    println!("The position at time {} is: {}", time, position);
}

/// OR

fn main() {
    let current_time = Local::now();
    let seconds = current_time.timestamp() as f64;
    let result = (seconds * PI / 43200.0).sin();
    let output = (result + 1.0) / 4.0;
    let u64_output = output.round() as u64;
    println!("The result is: {}", u64_output);
}
