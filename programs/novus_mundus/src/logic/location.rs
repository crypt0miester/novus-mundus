/// Location and travel mechanics (pure logic)
///
/// All functions in this module are framework-agnostic and operate
/// on primitives only. No AccountInfo references.

/// Earth radius in kilometers for Haversine formula
pub const EARTH_RADIUS_KM: f64 = 6371.0;

/// Base travel speed in km/h
pub const TRAVEL_SPEED_KMH: f64 = 100.0;

/// Base teleport cost (Novi per 100km)
pub const TELEPORT_COST_PER_100KM: u64 = 1000;

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
pub fn calculate_distance_meters(
    lat1: f64,
    long1: f64,
    lat2: f64,
    long2: f64,
) -> f64 {
    let distance_km = calculate_distance(lat1, long1, lat2, long2);
    distance_km * 1000.0  // Convert to meters
}

/// Calculate travel time in seconds based on distance
///
/// # Arguments
/// * `distance_km` - Distance in kilometers
///
/// # Returns
/// Travel time in seconds
///
/// # Formula
/// ```text
/// travel_time_seconds = (distance_km / TRAVEL_SPEED_KMH) * 3600
/// ```
///
/// # Examples
/// ```ignore
/// let time = calculate_travel_time(500.0);
/// // time = 18000 seconds (5 hours)
/// ```
pub fn calculate_travel_time(distance_km: f64) -> i64 {
    let travel_hours = distance_km / TRAVEL_SPEED_KMH;
    (travel_hours * 3600.0) as i64
}

/// Calculate teleport cost in Novi based on distance
///
/// # Arguments
/// * `distance_km` - Distance in kilometers
///
/// # Returns
/// Novi cost for instant teleport
///
/// # Formula
/// ```text
/// cost = TELEPORT_COST_PER_100KM * ceil(distance_km / 100)
/// ```
///
/// # Examples
/// ```ignore
/// calculate_teleport_cost(250.0)  // Returns 3000 (3 × 1000)
/// calculate_teleport_cost(500.0)  // Returns 5000 (5 × 1000)
/// calculate_teleport_cost(99.0)   // Returns 1000 (1 × 1000)
/// ```
pub fn calculate_teleport_cost(distance_km: f64) -> u64 {
    let segments = libm::ceil(distance_km / 100.0) as u64;
    TELEPORT_COST_PER_100KM * segments
}

/// Check if two locations are within tolerance (same location)
///
/// # Arguments
/// * `lat1` - First latitude
/// * `long1` - First longitude
/// * `lat2` - Second latitude
/// * `long2` - Second longitude
/// * `tolerance` - Maximum difference (default: 0.0001 degrees ≈ 11 meters)
///
/// # Returns
/// `true` if locations are considered the same
///
/// # Examples
/// ```ignore
/// is_same_location(40.7128, -74.0060, 40.7128, -74.0060, 0.0001)  // true
/// is_same_location(40.7128, -74.0060, 40.8000, -74.0060, 0.0001)  // false
/// ```
pub fn is_same_location(
    lat1: f64,
    long1: f64,
    lat2: f64,
    long2: f64,
    tolerance: f64,
) -> bool {
    libm::fabs(lat1 - lat2) < tolerance && libm::fabs(long1 - long2) < tolerance
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

/// Convert coordinates to i64 for deterministic PDA derivation
///
/// Uses 6 decimal precision (1 meter accuracy)
///
/// # Arguments
/// * `coordinate` - Latitude or longitude
///
/// # Returns
/// Integer representation with 6 decimal precision
///
/// # Examples
/// ```ignore
/// coordinate_to_i64(40.712800)  // Returns 40712800
/// coordinate_to_i64(-74.006000) // Returns -74006000
/// ```
pub fn coordinate_to_i64(coordinate: f64) -> i64 {
    (coordinate * 1_000_000.0) as i64
}

/// Convert i64 back to f64 coordinate
///
/// # Arguments
/// * `coordinate_i64` - Integer coordinate (6 decimal precision)
///
/// # Returns
/// Float coordinate
///
/// # Examples
/// ```ignore
/// i64_to_coordinate(40712800)  // Returns 40.712800
/// i64_to_coordinate(-74006000) // Returns -74.006000
/// ```
pub fn i64_to_coordinate(coordinate_i64: i64) -> f64 {
    coordinate_i64 as f64 / 1_000_000.0
}

/// Check if coordinates are within city bounds
///
/// # Arguments
/// * `lat` - Player's latitude
/// * `long` - Player's longitude
/// * `city_lat` - City center latitude
/// * `city_long` - City center longitude
/// * `city_radius_km` - City radius in kilometers
///
/// # Returns
/// `true` if coordinates are within the city's circular boundary
///
/// # Examples
/// ```ignore
/// // Player at NYC coordinates, NYC city center
/// is_within_city_bounds(40.7128, -74.0060, 40.7128, -74.0060, 50.0)  // true (at center)
/// is_within_city_bounds(40.7128, -74.0060, 40.7128, -74.0060, 0.1)   // true (within 100m)
/// is_within_city_bounds(51.5074, -0.1278, 40.7128, -74.0060, 50.0)   // false (London coords, NYC city)
/// ```
pub fn is_within_city_bounds(
    lat: f64,
    long: f64,
    city_lat: f64,
    city_long: f64,
    city_radius_km: f32,
) -> bool {
    let distance = calculate_distance(lat, long, city_lat, city_long);
    distance <= city_radius_km as f64
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
    let distance = calculate_distance(origin_city_lat, origin_city_long, dest_city_lat, dest_city_long);
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

/// Get research travel speed bonus from player's research section
///
/// # Arguments
/// * `research_levels` - Array of research levels (0-30 for each research type)
/// * `travel_speed_buff_per_level_bps` - Basis points per research level (from ResearchTemplate)
///
/// # Returns
/// Total travel speed bonus in basis points
///
/// # Examples
/// ```ignore
/// // Level 5 TravelSpeed research with 200 bps per level = 1000 bps (10%)
/// get_research_travel_bonus(&levels, 200)  // 1000
/// ```
pub fn get_research_travel_bonus(
    research_levels: &[u8],
    travel_speed_buff_per_level_bps: u16,
) -> u32 {
    // TravelSpeed is research type 30
    const TRAVEL_SPEED_RESEARCH_TYPE: usize = 30;

    if research_levels.len() > TRAVEL_SPEED_RESEARCH_TYPE {
        let level = research_levels[TRAVEL_SPEED_RESEARCH_TYPE] as u32;
        level * travel_speed_buff_per_level_bps as u32
    } else {
        0
    }
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
    fn test_calculate_travel_time() {
        // 500 km = 5 hours = 18000 seconds
        assert_eq!(calculate_travel_time(500.0), 18000);

        // 100 km = 1 hour = 3600 seconds
        assert_eq!(calculate_travel_time(100.0), 3600);
    }

    #[test]
    fn test_calculate_teleport_cost() {
        assert_eq!(calculate_teleport_cost(99.0), 1000);    // 1 segment
        assert_eq!(calculate_teleport_cost(100.0), 1000);   // 1 segment
        assert_eq!(calculate_teleport_cost(101.0), 2000);   // 2 segments
        assert_eq!(calculate_teleport_cost(500.0), 5000);   // 5 segments
    }

    #[test]
    fn test_is_same_location() {
        assert!(is_same_location(40.7128, -74.0060, 40.7128, -74.0060, 0.0001));
        assert!(is_same_location(40.7128, -74.0060, 40.71281, -74.00601, 0.0001));
        assert!(!is_same_location(40.7128, -74.0060, 40.8000, -74.0060, 0.0001));
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

    #[test]
    fn test_coordinate_conversion() {
        assert_eq!(coordinate_to_i64(40.712800), 40712800);
        assert_eq!(coordinate_to_i64(-74.006000), -74006000);

        assert!((i64_to_coordinate(40712800) - 40.712800).abs() < 0.000001);
        assert!((i64_to_coordinate(-74006000) - (-74.006000)).abs() < 0.000001);
    }
}
