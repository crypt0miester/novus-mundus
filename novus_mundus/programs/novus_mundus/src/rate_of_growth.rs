fn grow_population(time: f64, rate: f64, population: f64) -> f64 {
    population * rate.powf(time)
}

fn main() {
    let time = 0.0; // initial time
    let rate = 1.1; // growth rate
    let population = 100.0; // initial population
    let new_population = grow_population(time, rate, population);
    println!("The population at time {} is: {}", time, new_population);
}
