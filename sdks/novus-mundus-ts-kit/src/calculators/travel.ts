/**
 * Travel Calculators
 *
 * Distance and travel time calculations using Haversine formula.
 */

import { EARTH_RADIUS_KM } from './constants';

// Distance Calculations

/**
 * Calculate distance between two coordinates using Haversine formula.
 *
 * @param lat1 - First latitude in degrees
 * @param long1 - First longitude in degrees
 * @param lat2 - Second latitude in degrees
 * @param long2 - Second longitude in degrees
 * @returns Distance in kilometers
 *
 * @example
 * ```ts
 * const distance = calculateDistance(40.7128, -74.0060, 51.5074, -0.1278);
 * // distance ≈ 5570 km (NYC to London)
 * ```
 */
export function calculateDistance(
  lat1: number,
  long1: number,
  lat2: number,
  long2: number
): number {
  // Convert to radians
  const lat1Rad = (lat1 * Math.PI) / 180;
  const lat2Rad = (lat2 * Math.PI) / 180;
  const deltaLat = ((lat2 - lat1) * Math.PI) / 180;
  const deltaLong = ((long2 - long1) * Math.PI) / 180;

  // Haversine formula
  const sinDlatHalf = Math.sin(deltaLat / 2);
  const sinDlongHalf = Math.sin(deltaLong / 2);
  const a =
    sinDlatHalf * sinDlatHalf +
    Math.cos(lat1Rad) * Math.cos(lat2Rad) * sinDlongHalf * sinDlongHalf;

  const c = 2 * Math.asin(Math.sqrt(a));

  return EARTH_RADIUS_KM * c;
}

/**
 * Calculate distance in meters.
 *
 * @param lat1 - First latitude in degrees
 * @param long1 - First longitude in degrees
 * @param lat2 - Second latitude in degrees
 * @param long2 - Second longitude in degrees
 * @returns Distance in meters
 */
export function calculateDistanceMeters(
  lat1: number,
  long1: number,
  lat2: number,
  long2: number
): number {
  return calculateDistance(lat1, long1, lat2, long2) * 1000;
}

// Travel Time Calculations

/**
 * Calculate travel time in seconds.
 *
 * @param distanceKm - Distance in kilometers
 * @param speedKmh - Speed in km/h
 * @returns Travel time in seconds
 */
export function calculateTravelTime(distanceKm: number, speedKmh: number): number {
  if (speedKmh <= 0) return 0;
  return Math.ceil((distanceKm / speedKmh) * 3600);
}

/**
 * Calculate travel time between two coordinates.
 *
 * @param lat1 - Start latitude
 * @param long1 - Start longitude
 * @param lat2 - End latitude
 * @param long2 - End longitude
 * @param speedKmh - Travel speed in km/h
 * @returns Travel time in seconds
 */
export function calculateTravelTimeBetween(
  lat1: number,
  long1: number,
  lat2: number,
  long2: number,
  speedKmh: number
): number {
  const distance = calculateDistance(lat1, long1, lat2, long2);
  return calculateTravelTime(distance, speedKmh);
}

/**
 * Calculate intercity travel time.
 *
 * @param distanceKm - Distance in kilometers
 * @param themeSpeedKmh - Base speed for the theme
 * @param speedBonusBps - Speed bonus in basis points (from subscription, etc.)
 * @returns Travel time in seconds
 */
export function calculateIntercityTravelTime(
  distanceKm: number,
  themeSpeedKmh: number,
  speedBonusBps: number = 0
): number {
  const effectiveSpeed = themeSpeedKmh * (1 + speedBonusBps / 10000);
  return calculateTravelTime(distanceKm, effectiveSpeed);
}

/**
 * Calculate intracity travel time (walking within a city).
 *
 * @param distanceMeters - Distance in meters
 * @param intracitySpeedKmh - Intracity walking speed in km/h (default ~5 km/h)
 * @returns Travel time in seconds
 */
export function calculateIntracityTravelTime(
  distanceMeters: number,
  intracitySpeedKmh: number = 5.0
): number {
  const distanceKm = distanceMeters / 1000;
  return calculateTravelTime(distanceKm, intracitySpeedKmh);
}

/**
 * Apply stables travel time reduction.
 *
 * Stables building reduces travel time by 50 bps per level.
 *
 * @param travelTimeSeconds - Base travel time in seconds
 * @param stablesReductionBps - Stables reduction in basis points (50 per level)
 * @returns Reduced travel time in seconds
 */
export function applyStablesTravelReduction(
  travelTimeSeconds: number,
  stablesReductionBps: number
): number {
  if (stablesReductionBps <= 0) return travelTimeSeconds;
  const reduction = Math.floor((travelTimeSeconds * stablesReductionBps) / 10000);
  return Math.max(1, travelTimeSeconds - reduction);
}

// Teleport Cost Calculations

/**
 * Calculate teleport cost in NOVI.
 *
 * @param distanceKm - Distance in kilometers
 * @param baseCost - Base teleport cost
 * @param costPer100km - Additional cost per 100km
 * @returns Total teleport cost
 */
export function calculateTeleportCost(
  distanceKm: number,
  baseCost: number,
  costPer100km: number
): number {
  const distanceBlocks = Math.ceil(distanceKm / 100);
  return baseCost + distanceBlocks * costPer100km;
}

// Speedup Calculations

/**
 * Calculate speedup cost in gems.
 *
 * @param remainingSeconds - Remaining travel time in seconds
 * @param gemCostPerMinute - Gem cost per minute speedup
 * @returns Total gem cost to instant complete
 */
export function calculateSpeedupCost(
  remainingSeconds: number,
  gemCostPerMinute: number
): number {
  const remainingMinutes = Math.ceil(remainingSeconds / 60);
  return remainingMinutes * gemCostPerMinute;
}

/**
 * Calculate time reduced by spending gems.
 *
 * @param gemsSpent - Number of gems to spend
 * @param gemCostPerMinute - Gem cost per minute speedup
 * @returns Time reduced in seconds
 */
export function calculateTimeReduced(
  gemsSpent: number,
  gemCostPerMinute: number
): number {
  if (gemCostPerMinute <= 0) return 0;
  const minutesReduced = Math.floor(gemsSpent / gemCostPerMinute);
  return minutesReduced * 60;
}

// Validation Functions

/**
 * Check if latitude is valid (-90 to 90).
 */
export function isValidLatitude(latitude: number): boolean {
  return latitude >= -90 && latitude <= 90;
}

/**
 * Check if longitude is valid (-180 to 180).
 */
export function isValidLongitude(longitude: number): boolean {
  return longitude >= -180 && longitude <= 180;
}

/**
 * Check if coordinates are within city bounds.
 *
 * @param lat - Player latitude
 * @param long - Player longitude
 * @param cityLat - City center latitude
 * @param cityLong - City center longitude
 * @param cityRadiusKm - City radius in kilometers
 * @returns true if within bounds
 */
export function isWithinCityBounds(
  lat: number,
  long: number,
  cityLat: number,
  cityLong: number,
  cityRadiusKm: number
): boolean {
  const distance = calculateDistance(lat, long, cityLat, cityLong);
  return distance <= cityRadiusKm;
}

/**
 * Convert fixed-point coordinates to float.
 * Coordinates are stored as i32 × 1,000,000 in the on-chain state.
 *
 * @param fixedPoint - Fixed-point coordinate value
 * @returns Float coordinate value
 */
export function fixedPointToFloat(fixedPoint: number): number {
  return fixedPoint / 1_000_000;
}

/**
 * Convert float coordinates to fixed-point.
 *
 * @param floatValue - Float coordinate value
 * @returns Fixed-point coordinate value
 */
export function floatToFixedPoint(floatValue: number): number {
  return Math.round(floatValue * 1_000_000);
}
