/// Location and travel mechanics (pure logic)
///
/// All functions in this module are framework-agnostic and operate
/// on primitives only. No AccountView references.

/// Earth radius in kilometers for Haversine formula
pub const EARTH_RADIUS_KM: f64 = 6371.0;

/// Calculate distance between two coordinates using Haversine formula
///
/// # Arguments
/// * `current_lat` - Current latitude (-90 to 90 degrees)
/// * `current_long` - Current longitude (-180 to 180 degrees)
/// * `destination_lat` - Destination latitude
/// * `destination_long` - Destination longitude
///
/// # Returns
/// Distance in kilometers
///
/// # Formula
/// The Haversine formula calculates the great-circle distance between
/// two points on a sphere given their longitudes and latitudes.
///
/// ```text
/// a = sin²(Δφ/2) + cos φ1 ⋅ cos φ2 ⋅ sin²(Δλ/2)
/// c = 2 ⋅ atan2(√a, √(1−a))
/// d = R ⋅ c
/// ```
///
/// Where:
/// - φ is latitude in radians
/// - λ is longitude in radians
/// - R is earth's radius (6371 km)
///
/// # Examples
/// ```ignore
/// let distance = calculate_distance(40.7128, -74.0060, 51.5074, -0.1278);
/// // distance ≈ 5570 km (NYC to London)
/// ```
pub fn calculate_distance(
    current_lat: f64,
    current_long: f64,
    destination_lat: f64,
    destination_long: f64,
) -> f64 {
    // Convert to radians
    let lat1 = current_lat.to_radians();
    let lat2 = destination_lat.to_radians();
    let delta_lat = (destination_lat - current_lat).to_radians();
    let delta_long = (destination_long - current_long).to_radians();

    // Haversine formula
    let sin_dlat_half = libm::sin(delta_lat / 2.0);
    let sin_dlong_half = libm::sin(delta_long / 2.0);
    let a = sin_dlat_half * sin_dlat_half
        + libm::cos(lat1) * libm::cos(lat2) * sin_dlong_half * sin_dlong_half;

    let c = 2.0 * libm::asin(libm::sqrt(a));

    // Distance in kilometers
    EARTH_RADIUS_KM * c
}

/// Calculate distance in METERS (for encounter attack range checks)
///
/// Uses the same Haversine formula as calculate_distance(), but returns meters.
///
/// # Arguments
/// * `lat1` - First latitude
/// * `long1` - First longitude
/// * `lat2` - Second latitude
/// * `long2` - Second longitude
///
/// # Returns
/// Distance in meters
///
/// # Examples
/// ```ignore
/// let distance = calculate_distance_meters(40.7128, -74.0060, 40.7129, -74.0060);
/// // distance ≈ 111 meters (1 degree latitude ≈ 111 km)
/// ```
#[inline]
pub fn calculate_distance_meters(lat1: f64, long1: f64, lat2: f64, long2: f64) -> f64 {
    let distance_km = calculate_distance(lat1, long1, lat2, long2);
    distance_km * 1000.0 // Convert to meters
}

/// Validate latitude is within valid range
///
/// # Arguments
/// * `latitude` - Latitude to validate
///
/// # Returns
/// `true` if latitude is valid (-90 to 90)
pub fn is_valid_latitude(latitude: f64) -> bool {
    latitude >= -90.0 && latitude <= 90.0
}

/// Validate longitude is within valid range
///
/// # Arguments
/// * `longitude` - Longitude to validate
///
/// # Returns
/// `true` if longitude is valid (-180 to 180)
pub fn is_valid_longitude(longitude: f64) -> bool {
    longitude >= -180.0 && longitude <= 180.0
}

/// AABB bounds check on a centred square plot.
///
/// `ox` / `oy` are grid offsets from the city centre (the same shape
/// `terrain::city_offset` returns). `width_grid` / `height_grid` are
/// the city's square dimensions in grid units. Replaces the circular
/// `is_within_city_bounds` after the flat-strategy cut — one
/// comparison per axis, no sqrt, no cos. The Haversine helpers above
/// keep their callers (intercity / intracity travel-time math).
///
/// # Examples
/// ```ignore
/// is_within_city_grid(0, 0, 200, 200)      // true (centre)
/// is_within_city_grid(100, 100, 200, 200)  // true (corner, inclusive)
/// is_within_city_grid(101, 0, 200, 200)    // false (just past east edge)
/// ```
#[inline]
pub fn is_within_city_grid(ox: i32, oy: i32, width_grid: u16, height_grid: u16) -> bool {
    // unsigned_abs avoids the i32::MIN.abs() wrap-to-i32::MIN footgun:
    // under release overflow-checks=off, the signed abs of i32::MIN
    // returns i32::MIN (still negative) and slips through the bounds
    // comparison as 'in range'. half_w/half_h are non-negative so a u32
    // compare is the correct domain.
    let half_w = (width_grid as u32) / 2;
    let half_h = (height_grid as u32) / 2;
    ox.unsigned_abs() <= half_w && oy.unsigned_abs() <= half_h
}

/// AABB containment check for a multi-cell castle footprint anchored at
/// `(anchor_ox, anchor_oy)` (centre-relative grid offsets). The N×N
/// footprint extends to `(anchor_ox + N - 1, anchor_oy + N - 1)`; every
/// cell must sit inside the city's plot.
///
/// `footprint_size == 0` rejects (defensive — a zero-cell castle is
/// nonsensical and would always pass a naive check).
#[inline]
pub fn castle_fits_in_city_grid(
    anchor_ox: i32,
    anchor_oy: i32,
    footprint_size: u8,
    width_grid: u16,
    height_grid: u16,
) -> bool {
    if footprint_size == 0 {
        return false;
    }
    let span = (footprint_size as i32).saturating_sub(1);
    let last_ox = anchor_ox.saturating_add(span);
    let last_oy = anchor_oy.saturating_add(span);
    is_within_city_grid(anchor_ox, anchor_oy, width_grid, height_grid)
        && is_within_city_grid(last_ox, last_oy, width_grid, height_grid)
}

/// Calculate travel time with custom speed
///
/// # Arguments
/// * `distance_km` - Distance in kilometers
/// * `speed_kmh` - Travel speed in km/h
///
/// # Returns
/// Travel time in seconds
///
/// # Formula
/// ```text
/// travel_time_seconds = (distance_km / speed_kmh) * 3600
/// ```
///
/// # Examples
/// ```ignore
/// calculate_travel_time_with_speed(100.0, 20.0)  // 18000 seconds (5 hours at 20 km/h)
/// calculate_travel_time_with_speed(100.0, 500.0) // 720 seconds (12 min at 500 km/h)
/// ```
pub fn calculate_travel_time_with_speed(distance_km: f64, speed_kmh: f32) -> i64 {
    let travel_hours = distance_km / speed_kmh as f64;
    (travel_hours * 3600.0) as i64
}

/// Calculate intercity travel time (between cities with theme speed)
///
/// # Arguments
/// * `origin_city_lat` - Origin city latitude
/// * `origin_city_long` - Origin city longitude
/// * `dest_city_lat` - Destination city latitude
/// * `dest_city_long` - Destination city longitude
/// * `theme_speed_kmh` - Travel speed for current theme
///
/// # Returns
/// Travel time in seconds
///
/// # Examples
/// ```ignore
/// // NYC to London at medieval speed (20 km/h)
/// let time = calculate_intercity_travel_time(40.7128, -74.0060, 51.5074, -0.1278, 20.0);
/// // time ≈ 1,002,600 seconds (11.6 days)
///
/// // Same trip at SciFi speed (500 km/h)
/// let time = calculate_intercity_travel_time(40.7128, -74.0060, 51.5074, -0.1278, 500.0);
/// // time ≈ 40,104 seconds (11.1 hours)
/// ```
pub fn calculate_intercity_travel_time(
    origin_city_lat: f64,
    origin_city_long: f64,
    dest_city_lat: f64,
    dest_city_long: f64,
    theme_speed_kmh: f32,
) -> i64 {
    let distance = calculate_distance(
        origin_city_lat,
        origin_city_long,
        dest_city_lat,
        dest_city_long,
    );
    calculate_travel_time_with_speed(distance, theme_speed_kmh)
}

/// Calculate intracity travel time (within same city at walking speed)
///
/// Intracity travel is always at walking speed (~5 km/h), regardless of theme.
///
/// # Arguments
/// * `from_lat` - Current latitude
/// * `from_long` - Current longitude
/// * `to_lat` - Destination latitude
/// * `to_long` - Destination longitude
/// * `walking_speed_kmh` - Walking speed (typically 5 km/h)
///
/// # Returns
/// Travel time in seconds
///
/// # Examples
/// ```ignore
/// // Moving 1 km within a city at 5 km/h
/// let time = calculate_intracity_travel_time(40.7128, -74.0060, 40.7200, -74.0060, 5.0);
/// // time ≈ 720 seconds (12 minutes)
/// ```
pub fn calculate_intracity_travel_time(
    from_lat: f64,
    from_long: f64,
    to_lat: f64,
    to_long: f64,
    walking_speed_kmh: f32,
) -> i64 {
    let distance = calculate_distance(from_lat, from_long, to_lat, to_long);
    calculate_travel_time_with_speed(distance, walking_speed_kmh)
}

/// Apply speed bonuses to base travel speed
///
/// # Arguments
/// * `base_speed_kmh` - Base travel speed (theme speed for intercity, walking speed for intracity)
/// * `subscription_bonus_bps` - Subscription tier speed bonus in basis points (e.g., 1000 = 10%)
/// * `research_bonus_bps` - Research speed bonus in basis points (e.g., 500 = 5%)
///
/// # Returns
/// Effective speed in km/h with bonuses applied
///
/// # Formula
/// ```text
/// effective_speed = base_speed * (1 + (subscription_bps + research_bps) / 10000)
/// ```
///
/// # Examples
/// ```ignore
/// // Base 20 km/h with 10% subscription + 5% research = 23 km/h
/// apply_travel_speed_bonuses(20.0, 1000, 500)  // 23.0
///
/// // Base 5 km/h walking with 50% legendary bonus = 7.5 km/h
/// apply_travel_speed_bonuses(5.0, 5000, 0)  // 7.5
/// ```
pub fn apply_travel_speed_bonuses(
    base_speed_kmh: f32,
    subscription_bonus_bps: u32,
    research_bonus_bps: u32,
) -> f32 {
    let total_bonus_bps = subscription_bonus_bps.saturating_add(research_bonus_bps);
    let multiplier = 1.0 + (total_bonus_bps as f32 / 10000.0);
    base_speed_kmh * multiplier
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_calculate_distance() {
        // NYC to London (approximately 5570 km)
        let distance = calculate_distance(40.7128, -74.0060, 51.5074, -0.1278);
        assert!(distance > 5500.0 && distance < 5600.0);

        // Same location
        let distance = calculate_distance(0.0, 0.0, 0.0, 0.0);
        assert!(distance < 0.1);
    }

    #[test]
    fn test_coordinate_validation() {
        assert!(is_valid_latitude(0.0));
        assert!(is_valid_latitude(90.0));
        assert!(is_valid_latitude(-90.0));
        assert!(!is_valid_latitude(91.0));
        assert!(!is_valid_latitude(-91.0));

        assert!(is_valid_longitude(0.0));
        assert!(is_valid_longitude(180.0));
        assert!(is_valid_longitude(-180.0));
        assert!(!is_valid_longitude(181.0));
        assert!(!is_valid_longitude(-181.0));
    }

    // Equivalence proof for the attack_castle range-gate optimization
    // (processor/castle/attack_castle.rs).
    #[test]
    fn castle_range_clamp_matches_loop_min() {
        use crate::state::LocationAccount as L;
        const RANGE_M: f64 = 50.0; // CASTLE_ATTACK_RANGE_METERS

        // Old behaviour: min Haversine over the whole N×N footprint.
        fn loop_min(at_lat: f64, at_lon: f64, a_lat: i32, a_lon: i32, fp: i32) -> f64 {
            let mut min = f64::MAX;
            for dlat in 0..fp {
                for dlon in 0..fp {
                    let d = calculate_distance_meters(
                        at_lat,
                        at_lon,
                        L::from_grid(a_lat + dlat),
                        L::from_grid(a_lon + dlon),
                    );
                    if d < min {
                        min = d;
                    }
                }
            }
            min
        }

        // New behaviour: clamp into the AABB, one Haversine.
        fn clamp_min(at_lat: f64, at_lon: f64, a_lat: i32, a_lon: i32, fp: i32) -> f64 {
            let last = fp - 1;
            let nlat = L::to_grid(at_lat).clamp(a_lat, a_lat + last);
            let nlon = L::to_grid(at_lon).clamp(a_lon, a_lon + last);
            calculate_distance_meters(at_lat, at_lon, L::from_grid(nlat), L::from_grid(nlon))
        }

        // Anchors in grid units (degrees * 10000); cos(lat) spans ~1 (equator)
        // to ~0.014 (near pole), exercising the term the monotonicity argument
        // treats as negligible.
        let anchors = [
            (515_074i32, -1_278i32), // London
            (407_128, -740_060),     // NYC
            (-338_688, 1_512_093),   // Sydney
            (0, 0),                  // equator / prime meridian
            (896_000, 1_799_000),    // near pole / antimeridian
        ];
        let mut checked = 0u64;
        for &(a_lat, a_lon) in &anchors {
            for fp in 1..=4i32 {
                for olat in -6..=10 {
                    for olon in -6..=10 {
                        for &frac in &[0.0f64, 0.5, 0.25, 0.75] {
                            let at_lat = L::from_grid(a_lat) + (olat as f64 + frac) / 10_000.0;
                            let at_lon = L::from_grid(a_lon) + (olon as f64 + frac) / 10_000.0;
                            let lm = loop_min(at_lat, at_lon, a_lat, a_lon, fp);
                            let cm = clamp_min(at_lat, at_lon, a_lat, a_lon, fp);
                            // The gate decision must always agree.
                            assert_eq!(
                                lm <= RANGE_M,
                                cm <= RANGE_M,
                                "gate mismatch: loop={lm} clamp={cm} anchor=({a_lat},{a_lon}) fp={fp} off=({olat},{olon},{frac})"
                            );
                            // Distance: exact away from ties; at an exact half-grid
                            // latitude tie with a large longitude offset the clamp may
                            // pick the other equidistant-in-lat cell, differing only by
                            // the cos(lat) term (~tens of microns). The 1 cm bound
                            // tolerates that while still catching a gross argmin bug.
                            assert!(
                                (lm - cm).abs() < 1e-2,
                                "distance mismatch: loop={lm} clamp={cm} anchor=({a_lat},{a_lon}) fp={fp} off=({olat},{olon},{frac})"
                            );
                            checked += 1;
                        }
                    }
                }
            }
        }
        assert!(checked > 20_000, "sweep too small: {checked}");
    }
}
