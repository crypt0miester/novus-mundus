use std::time::{SystemTime, UNIX_EPOCH};

use fastrand;

#[derive(Copy, Clone, Debug)]
pub struct Player {
    pub tokens: u64,
    pub defensive_unit_1: u64,
    pub defensive_unit_2: u64,
    pub defensive_unit_3: u64,
    pub operative_unit_1: u64,
    pub operative_unit_2: u64,
    pub operative_unit_3: u64,
    pub happiness_du: f32,
    pub happiness_ops: f32,
    pub weapon: u64,
    pub produce: u64,
    pub vehicles: u64,
    pub cash_on_hand: u64,
    pub cash_in_vault: u64,
    pub networth: u64,
    pub last_updated_tokens_at: u64,
}
#[derive(Copy, Clone, Debug)]
pub struct User {
    pub reserved_novi: u64,
    pub subscription_interval: u64,
    pub subscription_end: u64,
}

impl Player {
    pub fn abandon(self, is_defensive_units: bool) -> u64 {
        let rand = fastrand::u64(900..1100);
        let sum_of_units: u64;
        let happiness;
        if is_defensive_units {
            sum_of_units = self.sum_of_def_units();
            happiness = self.happiness_du;
        } else {
            sum_of_units = self.sum_of_ops_units();
            happiness = self.happiness_ops;
        }
        if (0.75..1.0).contains(&happiness) {
            let abandoning = sum_of_units as f64 * 0.05 * (rand as f64 / 1000.0);
            abandoning as u64
        } else if (0.5..=0.75).contains(&happiness) {
            let abandoning = sum_of_units as f64 * 0.075 * (rand as f64 / 1000.0);
            abandoning as u64
        } else if (0.25..=0.5).contains(&happiness) {
            let abandoning = sum_of_units as f64 * 0.08 * (rand as f64 / 1000.0);
            abandoning as u64
        } else if happiness < 0.25 {
            let abandoning = sum_of_units as f64 * 0.1 * (rand as f64 / 1000.0);
            abandoning as u64
        } else {
            0
        }
    }

    pub fn update_happiness(&mut self, is_defensive_units: bool) {
        let sum_of_units: u64;
        if is_defensive_units {
            sum_of_units = self.sum_of_def_units();
        } else {
            sum_of_units = self.sum_of_ops_units();
        }

        if is_defensive_units {
            let weapon_coeff = ((self.weapon) / sum_of_units) as f32;
            let food_coeff = ((self.produce) / sum_of_units) as f32;
            let total_coeff = weapon_coeff * food_coeff;
            self.happiness_du = f32::min(1.0, total_coeff.round())
        } else {
            let food_coeff = (self.produce / sum_of_units) as f64;
            self.happiness_ops = f32::min(1.0, food_coeff.round() as f32);
        }
    }

    pub fn consume_produce(&mut self, is_defensive_units: bool) {
        let sum_of_unit: u64;
        if is_defensive_units {
            sum_of_unit = self.sum_of_def_units();
        } else {
            sum_of_unit = self.sum_of_ops_units();
        }
        let consumed = (sum_of_unit / self.produce) * self.produce;
        self.produce = self.produce.saturating_sub(consumed);
    }

    pub fn damage_total(&self, drive_by: bool) -> u64 {
        let sum_of_unit = self.sum_of_def_units();
        let weapon_coeff = f64::min(1.0, self.weapon as f64 / sum_of_unit as f64);
        let coeff: f64 = if drive_by && sum_of_unit >= 10000 {
            let rand = fastrand::u64(800..999);
            1.25 - (rand as f64 / 1000.0) as f64
        } else {
            let rand = fastrand::u64(800..999);
            1.0 - ((rand as f64 / 1000.0) as f64)
        };
        (weapon_coeff * sum_of_unit as f64 * coeff).round() as u64
    }

    pub fn sum_of_def_units(&self) -> u64 {
        self.defensive_unit_1 + self.defensive_unit_2 + self.defensive_unit_3
    }

    pub fn sum_of_ops_units(&self) -> u64 {
        self.operative_unit_1 + self.operative_unit_2 + self.operative_unit_3
    }

    pub fn total_unit_with_weaponon(&self) -> (u64, u64) {
        let sum_of_unit = self.sum_of_def_units();
        if self.weapon >= sum_of_unit {
            (sum_of_unit, sum_of_unit)
        } else {
            let weapon_coeff = f64::min(1.0, self.weapon as f64 / sum_of_unit as f64);
            let tot_with_weapon = (sum_of_unit as f64 * weapon_coeff).round() as u64;
            (tot_with_weapon, self.weapon)
        }
    }

    pub fn consume_novi(&mut self, novi: u64) -> u64 {
        let rand_1 = fastrand::u64(1000_u64..1750_u64);
        let rand_2 = fastrand::u64(1000_u64..1500_u64);
        let consuming =
            ((rand_1 as f64 / 100.0) * novi as f64 * (rand_2 as f64 / 1000.0)).round() as u64;

        let rand_fib = fastrand::u64(1200_u64..1500_u64);
        let consumed = if is_fib(novi) {
            println!("is_fib {}", consuming);
            (consuming as f64 * (rand_fib as f64 / 1000.0)) as u64
        } else {
            println!("not fib {}", consuming);
            consuming
        };
        self.tokens = self.tokens.saturating_sub(consumed);
        consumed
    }

    pub fn collecting(&mut self, novi: u64, industrial: bool, office: bool) {
        let consumed_novi = self.consume_novi(novi);
        self.consume_produce(false);
        self.update_happiness(false);
        // need to add abondenment based on happiness while collecting.

        let cash_received: u64;
        if industrial {
            cash_received = ((consumed_novi as f64 * 1.5 * self.happiness_ops as f64)
                * self.operative_unit_1 as f64)
                .round() as u64;
        } else if office {
            cash_received = ((consumed_novi as f64 * 1.3 * self.happiness_ops as f64)
                * self.operative_unit_2 as f64)
                .round() as u64;
        } else {
            cash_received = ((consumed_novi as f64 * 1.1 * self.happiness_ops as f64)
                * self.operative_unit_3 as f64)
                .round() as u64;
        }
        self.cash_on_hand += cash_received
    }

    // fn unit_in_vehicle(&self, vehicles: u64) -> (u64, u64, u64) {
    //     let total_unit = self.sum_of_def_units();
    //     let total_unit_in_vehicle = 5 * vehicles;
    //     let in_vehicle_1: u64;
    //     let in_vehicle_2: u64;
    //     let in_vehicle_3: u64;
    //     if total_unit_in_vehicle >= total_unit {
    //         (
    //             self.defensive_unit_1,
    //             self.defensive_unit_2,
    //             self.defensive_unit_3,
    //         )
    //     } else {
    //         let defensive_unit_3_left = self.defensive_unit_3.saturating_sub(total_unit_in_vehicle);
    //         if defensive_unit_3_left == 0 {
    //             in_vehicle_3 = self.defensive_unit_3;
    //         } else {
    //             in_vehicle_3 = self.defensive_unit_3.saturating_sub(defensive_unit_3_left);
    //         }
    //         println!("{:?}", in_vehicle_3);
    //         let remaining_capacity = total_unit_in_vehicle.saturating_sub(in_vehicle_3);
    //         println!("{:?}", remaining_capacity);

    //         let defensive_unit_2_left = self.defensive_unit_2.saturating_sub(remaining_capacity);
    //         if defensive_unit_2_left == 0 {
    //             in_vehicle_2 = self.defensive_unit_2;
    //         } else {
    //             in_vehicle_2 = self.defensive_unit_2.saturating_sub(defensive_unit_2_left);
    //         }
    //         println!("{:?}", in_vehicle_2);

    //         let final_remaining_capacity =
    //             total_unit_in_vehicle.saturating_sub(in_vehicle_3 + in_vehicle_2);
    //         println!("{:?}", final_remaining_capacity);

    //         let defensive_unit_1_left = self
    //             .defensive_unit_1
    //             .saturating_sub(final_remaining_capacity);
    //         in_vehicle_1 = self.defensive_unit_1.saturating_sub(defensive_unit_1_left);
    //         (in_vehicle_1, in_vehicle_2, in_vehicle_3)
    //     }
    // }
    pub fn unit_in_vehicle(&self, vehicles: u64) -> (u64, u64, u64) {
        let total_unit = self.sum_of_def_units();
        let total_unit_in_vehicle = 5 * vehicles;

        if total_unit_in_vehicle >= total_unit {
            return (
                self.defensive_unit_1,
                self.defensive_unit_2,
                self.defensive_unit_3,
            );
        }
        let mut in_vehicle_1 = 0;
        let mut in_vehicle_2 = 0;
        let mut in_vehicle_3 = 0;

        let mut remaining_capacity = total_unit_in_vehicle;

        if remaining_capacity >= self.defensive_unit_3 {
            in_vehicle_3 = self.defensive_unit_3;
            remaining_capacity -= self.defensive_unit_3;
        } else {
            in_vehicle_3 = remaining_capacity;
            remaining_capacity = 0;
        }

        if remaining_capacity >= self.defensive_unit_2 {
            in_vehicle_2 = self.defensive_unit_2;
            remaining_capacity -= self.defensive_unit_2;
        } else {
            in_vehicle_2 = remaining_capacity;
            remaining_capacity = 0;
        }

        in_vehicle_1 = remaining_capacity;

        (in_vehicle_1, in_vehicle_2, in_vehicle_3)
    }

    pub fn inflict_damage(&mut self, damage: f64, is_defensive_units: bool) {
        let mut damage_1 = 0.0;
        let mut damage_2 = 0.0;
        let mut damage_3 = 0.0;
        let mut unit_1;
        let mut unit_2;
        let mut unit_3;
        if is_defensive_units {
            unit_1 = self.defensive_unit_1;
            unit_2 = self.defensive_unit_3;
            unit_3 = self.defensive_unit_2;
        } else {
            unit_1 = self.operative_unit_1;
            unit_2 = self.operative_unit_3;
            unit_3 = self.operative_unit_2;
        }
        if unit_1 > 0 {
            damage_1 = damage * 0.2;
        }
        if unit_2 > 0 {
            damage_2 = damage * 0.3;
        }
        if unit_3 > 0 {
            damage_3 = damage * 0.5;
        }

        if unit_1 == 0 {
            damage_2 += damage * 0.4;
            damage_3 += damage * 0.6;
        }
        if unit_1 == 0 && unit_2 == 0 {
            damage_3 += damage;
        }
        if unit_2 == 0 && unit_3 == 0 {
            damage_1 += damage;
        }
        if unit_3 == 0 {
            damage_1 += damage * 0.3;
            damage_2 += damage * 0.7;
        }

        unit_3 = unit_3.saturating_sub(damage_3 as u64);
        unit_2 = unit_2.saturating_sub(damage_2 as u64);
        unit_1 = unit_1.saturating_sub(damage_1 as u64);
    }
}

// fn attack_the_player(
//     atk_1: u64,
//     atk_2: u64,
//     atk_3: u64,
//     defensive_unit_1: u64,
//     defensive_unit_2: u64,
//     defensive_unit_3: u64,
//     defensive_unit_weapon: u64,
//     atk_weapon: u64,
//     atk_produce: u64,
//     drive_by: bool,
//     extort: bool,
//     vehicles: u64,
// ) -> (
//     u64,
//     u64,
//     u64,
//     u64,
//     u64,
//     u64,
//     u64,
//     u64,
//     u64,
//     u64,
//     u64,
//     u64,
//     u64,
//     u64,
//     u64,
//     u64,
//     u64,
//     u64,
//     u64,
// ) {
//     let (a_atk_1, a_atk_2, a_atk_3) = if drive_by {
//         unit_in_vehicle(atk_1, atk_2, atk_3, vehicles)
//     } else {
//         (atk_1, atk_2, atk_3)
//     };
//     let sum_of_atk = sum_of_unit(a_atk_1, a_atk_2, a_atk_3);
//     let new_produce = if atk_produce > 0 {
//         consume_produce(atk_produce, sum_of_atk)
//     } else {
//         0
//     };
//     let happiness_perc = happiness(sum_of_atk, atk_weapon, atk_produce);
//     let abandon_total = abandon(happiness_perc, sum_of_atk);
//     // final attack with abandon unitt if not happy else similair values
//     let (f_atk_1, f_atk_2, f_atk_3) = inflict_damage(a_atk_1, a_atk_2, a_atk_3, abandon_total);

//     let (tot_unit_with_weapon_atk, weaponon_used_atk) =
//         total_unit_with_weaponon(f_atk_1, f_atk_2, f_atk_3, atk_weapon);

//     // damage from defending
//     let sum_of_def = sum_of_unit(defensive_unit_1, defensive_unit_2, defensive_unit_3);
//     let assumed_damage_atk = damage_total(a_atk_1, a_atk_2, a_atk_3, atk_weapon, drive_by);

//     let (f_defensive_unit_1, f_defensive_unit_2, f_defensive_unit_3) = inflict_damage(defensive_unit_1, defensive_unit_2, defensive_unit_3, assumed_damage_atk);
//     let (assumed_damage_def, tot_unit_with_weapon_def, weaponon_used_def) = if extort {
//         (0, 0, 0)
//     } else {
//         let assumed_damage_def = damage_total(defensive_unit_1, defensive_unit_2, defensive_unit_3, defensive_unit_weapon, false);
//         let (tot_unit_with_weapon_def, weaponon_used_def) =
//             total_unit_with_weaponon(defensive_unit_1, defensive_unit_2, defensive_unit_3, defensive_unit_weapon);
//         (assumed_damage_def, tot_unit_with_weapon_def, weaponon_used_def)
//     };
//     (
//         f_atk_1,
//         f_atk_2,
//         f_atk_3,
//         assumed_damage_def,
//         f_defensive_unit_1,
//         f_defensive_unit_2,
//         f_defensive_unit_3,
//         assumed_damage_atk,
//         abandon_total,
//         new_produce,
//         a_atk_1,
//         a_atk_2,
//         a_atk_3,
//         sum_of_atk,
//         sum_of_def,
//         tot_unit_with_weapon_atk,
//         weaponon_used_atk,
//         tot_unit_with_weapon_def,
//         weaponon_used_def,
//     )
// }

pub fn update_networth(player: &mut Player) {
    // Calculate total networth and update networth for current player and player information
    let total_networth = (player.defensive_unit_1 * 100)
        + (player.defensive_unit_2 * 80)
        + (player.defensive_unit_3 * 50)
        + (player.operative_unit_1 * 100)
        + (player.operative_unit_2 * 80)
        + (player.operative_unit_3 * 50)
        + (player.weapon * 5000)
        + (player.produce * 20)
        + (player.vehicles * 10000)
        + player.cash_on_hand
        + player.cash_in_vault;
    player.networth = total_networth;
}

pub fn update_tokens(user: &mut User, player: &mut Player) {
    // constants
    let timestamp_now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs() as u64;
    let time_interval = 5 * 60;

    // subscriptions check
    let sub_end = user.subscription_end;
    let mut subscription_interval = user.subscription_interval;
    if sub_end != 0 && sub_end < timestamp_now {
        subscription_interval = 10;
    }

    let max_player_tokens_generation = subscription_interval * 300;

    if max_player_tokens_generation > player.tokens {
        if timestamp_now + time_interval >= player.last_updated_tokens_at {
            let remaining = timestamp_now.saturating_sub(player.last_updated_tokens_at);
            let interval_to_remaining = remaining.checked_div(time_interval).unwrap();
            let add_tokens = interval_to_remaining * subscription_interval as u64;
            if (player.tokens + add_tokens) >= max_player_tokens_generation {
                player.tokens = max_player_tokens_generation;
            }
            player.tokens += add_tokens;
            player.last_updated_tokens_at = timestamp_now;
        }
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

pub fn is_perfect_square(n: usize) -> bool {
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

pub fn is_fib(n: u64) -> bool {
    let _ = n == 0 && return false;
    let n_squared = n.pow(2);
    let coefficient = 5_u64.checked_mul(n_squared).unwrap();
    let x = coefficient.checked_add(4).unwrap() as usize;
    let y = coefficient.checked_sub(4).unwrap() as usize;
    is_perfect_square(x) || is_perfect_square(y)
}

fn main() {
    // let mut units_a = Player {
    //     defensive_unit_1: 10000,
    //     defensive_unit_2: 0,
    //     defensive_unit_3: 0,
    //     operative_unit_1: 10000,
    //     operative_unit_2: 0,
    //     operative_unit_3: 0,
    //     happiness: 0.0,
    //     produce: 2000,
    //     weapon: 2000,
    // };
    // let mut units_b = Player {
    //     defensive_unit_1: 2000,
    //     defensive_unit_2: 2000,
    //     defensive_unit_3: 2000,
    //     operative_unit_1: 10000,
    //     operative_unit_2: 0,
    //     operative_unit_3: 0,
    //     happiness: 0.0,
    //     produce: 2000,
    //     weapon: 2000,
    // };
    // let damage = units_a.damage_total(false);
    // println!("{:?}", damage);
    // units_b.inflict_damage(damage as f64);
    // println!("{:?}", units_b);
    // let damage = units_a.damage_total(false);
    // units_b.inflict_damage(damage as f64);
    // println!("{:?}", units_b);
    // let damage = units_a.damage_total(false);
    // units_b.inflict_damage(damage as f64);
    // println!("{:?}", units_b);
    // let damage = units_a.damage_total(false);
    // units_b.inflict_damage(damage as f64);
    // println!("{:?}", units_b)
    // let (attacker_units, defender_units) = fight("a", &mut units_a, "c", &mut units_b);
    // The final strength values of both the attacker and the defender will be random,
    // based on the random values generated using the sin function.
    // The base damage for the attack will depend on the relative strength of the attacker and the defender.
    // The attacker will lose more units if they have lower units than the defender.
    // println!("{:?}", attacker_units);
    // println!("{:?}", defender_units)
}
