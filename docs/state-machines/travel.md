# Travel System State Machine

## Overview

The Travel system manages player movement within and between cities. Movement uses a coordinate-based system where travel time is calculated from real distance and player speed.

---

## 1. Travel Lifecycle

### States

| State | Value | Description |
|-------|-------|-------------|
| `Stationary` | 0 | Not traveling |
| `Intracity` | 1 | Moving within same city |
| `Intercity` | 2 | Moving between cities |

### State Diagram

```
                    ┌─────────────────────────────────────────┐
                    │                                         │
                    ▼                                         │
┌────────────────┐  intracity_start   ┌────────────────┐     │
│                │ ─────────────────> │                │     │
│   Stationary   │                    │   Intracity    │     │
│  (travel_type  │ <───────────────── │  (travel_type  │     │
│     = 0)       │  intracity_complete│     = 1)       │     │
└───────┬────────┘  or cancel         └────────────────┘     │
        │                                                     │
        │ intercity_start                                     │
        ▼                                                     │
┌────────────────┐                                           │
│                │                                           │
│   Intercity    │ ───────────────────────────────────────────┘
│  (travel_type  │  intercity_complete or cancel
│     = 2)       │
└────────────────┘
```

---

## 2. Intracity Travel

### Transitions

#### `Stationary` → `Intracity`
```
Trigger: intracity_start
Guards:
  - Player not traveling
  - Target coordinates within current city bounds
  - Target != current position
Actions:
  - Calculate distance using Haversine formula
  - Calculate travel time: distance / INTRACITY_WALKING_SPEED_KMH
  - Apply hero travel speed bonus
  - Set player.traveling_to_lat = target_lat
  - Set player.traveling_to_long = target_long
  - Set player.travel_type = 1
  - Set player.arrival_time = now + travel_duration
  - Emit IntracityTravelStarted
```

#### `Intracity` → `Stationary`
```
Trigger: intracity_complete
Guards:
  - player.travel_type == 1
  - now >= player.arrival_time
Actions:
  - Set player.current_lat = player.traveling_to_lat
  - Set player.current_long = player.traveling_to_long
  - Set player.travel_type = 0
  - Set player.arrival_time = 0
  - Emit IntracityTravelCompleted
```

#### `Intracity` → `Stationary` (Cancel)
```
Trigger: intracity_cancel
Guards:
  - player.travel_type == 1
  - now < player.arrival_time
Actions:
  - Calculate progress ratio = elapsed / total_duration
  - Interpolate current position
  - Set player.current_lat = interpolated_lat
  - Set player.current_long = interpolated_long
  - Set player.travel_type = 0
  - Set player.arrival_time = 0
  - Emit IntracityTravelCancelled
```

---

## 3. Intercity Travel

### Transitions

#### `Stationary` → `Intercity`
```
Trigger: intercity_start
Guards:
  - Player not traveling
  - Target city exists and is accessible
  - Target city != current city
  - Sufficient stamina (if required)
Actions:
  - Calculate distance between cities
  - Calculate travel time: distance / INTERCITY_TRAVEL_SPEED_KMH
  - Apply hero travel speed bonus
  - Set player.traveling_to_city = target_city_id
  - Set player.traveling_to_lat = city_center_lat
  - Set player.traveling_to_long = city_center_long
  - Set player.travel_type = 2
  - Set player.arrival_time = now + travel_duration
  - Deduct stamina if applicable
  - Emit IntercityTravelStarted
```

#### `Intercity` → `Stationary`
```
Trigger: intercity_complete
Guards:
  - player.travel_type == 2
  - now >= player.arrival_time
Actions:
  - Set player.current_city = player.traveling_to_city
  - Set player.current_lat = player.traveling_to_lat
  - Set player.current_long = player.traveling_to_long
  - Set player.travel_type = 0
  - Set player.arrival_time = 0
  - Clear traveling_to fields
  - Emit IntercityTravelCompleted
```

#### `Intercity` → `Stationary` (Cancel)
```
Trigger: intercity_cancel
Guards:
  - player.travel_type == 2
  - now < player.arrival_time
Actions:
  - Return to starting city (no partial progress for intercity)
  - Set player.travel_type = 0
  - Set player.arrival_time = 0
  - Clear traveling_to fields
  - Partial stamina refund
  - Emit IntercityTravelCancelled
```

---

## 4. Teleport (Instant Travel)

### Transition

#### `Stationary` → `Stationary` (Teleport)
```
Trigger: intercity_teleport
Guards:
  - Player not traveling
  - Target city exists
  - Sufficient gems for teleport cost
Actions:
  - Deduct gems
  - Set player.current_city = target_city_id
  - Set player.current_lat = city_center_lat
  - Set player.current_long = city_center_long
  - Emit TeleportCompleted
```

---

## 5. Speedup System

### Travel Speedup
```
Trigger: speedup_travel
Guards:
  - Player is traveling
  - Remaining time > 0
  - Sufficient gems
Actions:
  - Calculate time reduction (50% or 75%)
  - Deduct gems
  - Adjust arrival_time backward
  - Emit TravelSpeedup
```

### Gem Cost Formula
```
gems_required = minutes_remaining × GEMS_PER_MINUTE × travel_type_multiplier

travel_type_multiplier:
  - Intracity: 1×
  - Intercity: 2×
```

---

## 6. Distance Calculations

### Haversine Formula
```
a = sin²(Δlat/2) + cos(lat1) × cos(lat2) × sin²(Δlong/2)
c = 2 × atan2(√a, √(1−a))
distance_km = R × c

Where:
  R = 6371 (Earth radius in km)
  lat1, lat2 = latitudes in radians
  Δlat = lat2 - lat1
  Δlong = long2 - long1
```

### Speed Constants
```
INTRACITY_WALKING_SPEED_KMH = 5
INTERCITY_TRAVEL_SPEED_KMH = 50
```

### Speed Bonuses
```
effective_speed = base_speed × (10000 + hero_travel_speed_bps + research_travel_speed_bps) / 10000
```

---

## 7. Travel Restrictions

### Cannot Travel While
- In active rally (participant)
- In active expedition
- In active dungeon run
- Meditating (must claim first)
- Being attacked (combat in progress)

### Intercity-Specific Restrictions
- Must complete any active intracity travel first
- May require minimum level
- May require specific research unlocks

---

## 8. PlayerAccount Travel Fields

```rust
// Current location
pub current_city: u16,
pub current_lat: i32,          // Fixed-point latitude
pub current_long: i32,         // Fixed-point longitude

// Travel destination
pub traveling_to_city: u16,
pub traveling_to_lat: i32,
pub traveling_to_long: i32,

// Travel state
pub travel_type: u8,           // 0=Stationary, 1=Intracity, 2=Intercity
pub arrival_time: i64,         // When travel completes

// Speed bonuses
pub hero_travel_speed_bps: u16,
pub research_travel_speed_bps: u16,
```

---

## 9. City Account Structure

### CityAccount
```rust
pub struct CityAccount {
    pub city_id: u16,
    pub name: [u8; 32],
    pub latitude: i32,         // City center
    pub longitude: i32,
    pub radius: u32,           // City bounds in meters
    pub min_level: u8,         // Required level to enter
    pub is_capital: bool,
    pub population_cap: u32,
    pub current_population: u32,
}
```

---

## 10. Coordinate System

### Fixed-Point Format
```
Latitude:  i32, 6 decimal places (multiply by 1,000,000)
Longitude: i32, 6 decimal places (multiply by 1,000,000)

Example:
  40.7128° N = 40712800
  -74.0060° W = -74006000
```

### Bounds Checking
```
is_within_city(lat, long, city) =
  haversine_distance(lat, long, city.lat, city.long) <= city.radius
```

---

## 11. Invariants

```
1. travel_type ∈ [0, 2]
2. arrival_time > 0 only when traveling
3. traveling_to fields valid only when traveling
4. Cannot start new travel while traveling
5. Intercity cancel returns to origin city (no partial)
6. Intracity cancel interpolates position
7. Coordinates always within valid city bounds
8. Speed bonuses are additive in basis points
```
