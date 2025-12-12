# Cities

The 24 major cities in Novus Mundus. Cities are fixed locations where players gather, battle, and trade.

---

## Quick Reference

### City Types

| Type | ID | Focus | Bonuses |
|------|-----|-------|---------|
| **Capital** | 0 | Balanced hub | +5% all stats |
| **Resource** | 1 | Collection | +15% resource generation |
| **Combat** | 2 | Warfare | +10% attack/defense |
| **Trade** | 3 | Economy | +15% cash collection |

### Encounter Level Tiers

| Tier | Level Range | Description |
|------|-------------|-------------|
| Beginner | 1-20 | New player friendly |
| Intermediate | 15-40 | Mid-game content |
| Advanced | 35-60 | Experienced players |
| Expert | 50-80 | High-level content |
| Endgame | 70-100 | Max level challenges |

---

## City Registry

### Summary Table

| ID | City | Region | Type | Levels | Lat | Long |
|----|------|--------|------|--------|-----|------|
| 1 | London | Europe | Capital | 1-40 | 51.51 | -0.13 |
| 2 | Paris | Europe | Capital | 1-40 | 48.86 | 2.35 |
| 3 | Rome | Europe | Capital | 15-60 | 41.90 | 12.50 |
| 4 | Athens | Europe | Combat | 25-70 | 37.98 | 23.73 |
| 5 | Berlin | Europe | Trade | 20-55 | 52.52 | 13.41 |
| 6 | Moscow | Europe | Combat | 35-80 | 55.76 | 37.62 |
| 7 | Istanbul | Europe | Trade | 30-70 | 41.01 | 28.98 |
| 8 | Cairo | Africa | Resource | 25-65 | 30.04 | 31.24 |
| 9 | Tokyo | Asia | Capital | 1-50 | 35.68 | 139.69 |
| 10 | Beijing | Asia | Capital | 20-60 | 39.90 | 116.41 |
| 11 | Shanghai | Asia | Trade | 15-50 | 31.23 | 121.47 |
| 12 | Seoul | Asia | Capital | 20-55 | 37.57 | 126.98 |
| 13 | Singapore | Asia | Trade | 1-35 | 1.35 | 103.82 |
| 14 | Mumbai | Asia | Trade | 15-50 | 19.08 | 72.88 |
| 15 | Dubai | Middle East | Trade | 25-60 | 25.20 | 55.27 |
| 16 | Baghdad | Middle East | Combat | 40-85 | 33.31 | 44.37 |
| 17 | New York | Americas | Trade | 1-45 | 40.71 | -74.01 |
| 18 | Los Angeles | Americas | Capital | 1-40 | 34.05 | -118.24 |
| 19 | Mexico City | Americas | Resource | 20-55 | 19.43 | -99.13 |
| 20 | Sao Paulo | Americas | Trade | 25-60 | -23.55 | -46.63 |
| 21 | Sydney | Oceania | Capital | 1-40 | -33.87 | 151.21 |
| 22 | Lagos | Africa | Resource | 30-70 | 6.52 | 3.38 |
| 23 | Johannesburg | Africa | Resource | 35-75 | -26.20 | 28.04 |
| 24 | Rio de Janeiro | Americas | Capital | 15-50 | -22.91 | -43.17 |

---

## Detailed City Data

### 1. London

| Property | Value |
|----------|-------|
| **City ID** | 1 |
| **Region** | Europe |
| **Type** | Capital (0) |
| **Coordinates** | 51.5074, -0.1278 |
| **Radius** | 35 km |
| **Encounter Levels** | 1-40 |

```rust
CityAccount {
    city_id: 1,
    name: *b"London\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0",
    latitude: 51.5074,
    longitude: -0.1278,
    radius_km: 35.0,
    city_type: 0, // Capital
    players_present: 0,
    active_encounters: 0,
    total_encounters_spawned: 0,
    founded_at: 0,
    min_encounter_level: 1,
    max_encounter_level: 40,
    bump: 0,
    _padding: [0; 5],
}
```

---

### 2. Paris

| Property | Value |
|----------|-------|
| **City ID** | 2 |
| **Region** | Europe |
| **Type** | Capital (0) |
| **Coordinates** | 48.8566, 2.3522 |
| **Radius** | 30 km |
| **Encounter Levels** | 1-40 |

```rust
CityAccount {
    city_id: 2,
    name: *b"Paris\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0",
    latitude: 48.8566,
    longitude: 2.3522,
    radius_km: 30.0,
    city_type: 0, // Capital
    players_present: 0,
    active_encounters: 0,
    total_encounters_spawned: 0,
    founded_at: 0,
    min_encounter_level: 1,
    max_encounter_level: 40,
    bump: 0,
    _padding: [0; 5],
}
```

---

### 3. Rome

| Property | Value |
|----------|-------|
| **City ID** | 3 |
| **Region** | Europe |
| **Type** | Capital (0) |
| **Coordinates** | 41.9028, 12.4964 |
| **Radius** | 25 km |
| **Encounter Levels** | 15-60 |

```rust
CityAccount {
    city_id: 3,
    name: *b"Rome\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0",
    latitude: 41.9028,
    longitude: 12.4964,
    radius_km: 25.0,
    city_type: 0, // Capital
    players_present: 0,
    active_encounters: 0,
    total_encounters_spawned: 0,
    founded_at: 0,
    min_encounter_level: 15,
    max_encounter_level: 60,
    bump: 0,
    _padding: [0; 5],
}
```

---

### 4. Athens

| Property | Value |
|----------|-------|
| **City ID** | 4 |
| **Region** | Europe |
| **Type** | Combat (2) |
| **Coordinates** | 37.9838, 23.7275 |
| **Radius** | 20 km |
| **Encounter Levels** | 25-70 |

```rust
CityAccount {
    city_id: 4,
    name: *b"Athens\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0",
    latitude: 37.9838,
    longitude: 23.7275,
    radius_km: 20.0,
    city_type: 2, // Combat
    players_present: 0,
    active_encounters: 0,
    total_encounters_spawned: 0,
    founded_at: 0,
    min_encounter_level: 25,
    max_encounter_level: 70,
    bump: 0,
    _padding: [0; 5],
}
```

---

### 5. Berlin

| Property | Value |
|----------|-------|
| **City ID** | 5 |
| **Region** | Europe |
| **Type** | Trade (3) |
| **Coordinates** | 52.5200, 13.4050 |
| **Radius** | 30 km |
| **Encounter Levels** | 20-55 |

```rust
CityAccount {
    city_id: 5,
    name: *b"Berlin\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0",
    latitude: 52.5200,
    longitude: 13.4050,
    radius_km: 30.0,
    city_type: 3, // Trade
    players_present: 0,
    active_encounters: 0,
    total_encounters_spawned: 0,
    founded_at: 0,
    min_encounter_level: 20,
    max_encounter_level: 55,
    bump: 0,
    _padding: [0; 5],
}
```

---

### 6. Moscow

| Property | Value |
|----------|-------|
| **City ID** | 6 |
| **Region** | Europe |
| **Type** | Combat (2) |
| **Coordinates** | 55.7558, 37.6173 |
| **Radius** | 40 km |
| **Encounter Levels** | 35-80 |

```rust
CityAccount {
    city_id: 6,
    name: *b"Moscow\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0",
    latitude: 55.7558,
    longitude: 37.6173,
    radius_km: 40.0,
    city_type: 2, // Combat
    players_present: 0,
    active_encounters: 0,
    total_encounters_spawned: 0,
    founded_at: 0,
    min_encounter_level: 35,
    max_encounter_level: 80,
    bump: 0,
    _padding: [0; 5],
}
```

---

### 7. Istanbul

| Property | Value |
|----------|-------|
| **City ID** | 7 |
| **Region** | Europe/Asia |
| **Type** | Trade (3) |
| **Coordinates** | 41.0082, 28.9784 |
| **Radius** | 35 km |
| **Encounter Levels** | 30-70 |

```rust
CityAccount {
    city_id: 7,
    name: *b"Istanbul\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0",
    latitude: 41.0082,
    longitude: 28.9784,
    radius_km: 35.0,
    city_type: 3, // Trade
    players_present: 0,
    active_encounters: 0,
    total_encounters_spawned: 0,
    founded_at: 0,
    min_encounter_level: 30,
    max_encounter_level: 70,
    bump: 0,
    _padding: [0; 5],
}
```

---

### 8. Cairo

| Property | Value |
|----------|-------|
| **City ID** | 8 |
| **Region** | Africa |
| **Type** | Resource (1) |
| **Coordinates** | 30.0444, 31.2357 |
| **Radius** | 30 km |
| **Encounter Levels** | 25-65 |

```rust
CityAccount {
    city_id: 8,
    name: *b"Cairo\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0",
    latitude: 30.0444,
    longitude: 31.2357,
    radius_km: 30.0,
    city_type: 1, // Resource
    players_present: 0,
    active_encounters: 0,
    total_encounters_spawned: 0,
    founded_at: 0,
    min_encounter_level: 25,
    max_encounter_level: 65,
    bump: 0,
    _padding: [0; 5],
}
```

---

### 9. Tokyo

| Property | Value |
|----------|-------|
| **City ID** | 9 |
| **Region** | Asia |
| **Type** | Capital (0) |
| **Coordinates** | 35.6762, 139.6503 |
| **Radius** | 40 km |
| **Encounter Levels** | 1-50 |

```rust
CityAccount {
    city_id: 9,
    name: *b"Tokyo\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0",
    latitude: 35.6762,
    longitude: 139.6503,
    radius_km: 40.0,
    city_type: 0, // Capital
    players_present: 0,
    active_encounters: 0,
    total_encounters_spawned: 0,
    founded_at: 0,
    min_encounter_level: 1,
    max_encounter_level: 50,
    bump: 0,
    _padding: [0; 5],
}
```

---

### 10. Beijing

| Property | Value |
|----------|-------|
| **City ID** | 10 |
| **Region** | Asia |
| **Type** | Capital (0) |
| **Coordinates** | 39.9042, 116.4074 |
| **Radius** | 45 km |
| **Encounter Levels** | 20-60 |

```rust
CityAccount {
    city_id: 10,
    name: *b"Beijing\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0",
    latitude: 39.9042,
    longitude: 116.4074,
    radius_km: 45.0,
    city_type: 0, // Capital
    players_present: 0,
    active_encounters: 0,
    total_encounters_spawned: 0,
    founded_at: 0,
    min_encounter_level: 20,
    max_encounter_level: 60,
    bump: 0,
    _padding: [0; 5],
}
```

---

### 11. Shanghai

| Property | Value |
|----------|-------|
| **City ID** | 11 |
| **Region** | Asia |
| **Type** | Trade (3) |
| **Coordinates** | 31.2304, 121.4737 |
| **Radius** | 40 km |
| **Encounter Levels** | 15-50 |

```rust
CityAccount {
    city_id: 11,
    name: *b"Shanghai\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0",
    latitude: 31.2304,
    longitude: 121.4737,
    radius_km: 40.0,
    city_type: 3, // Trade
    players_present: 0,
    active_encounters: 0,
    total_encounters_spawned: 0,
    founded_at: 0,
    min_encounter_level: 15,
    max_encounter_level: 50,
    bump: 0,
    _padding: [0; 5],
}
```

---

### 12. Seoul

| Property | Value |
|----------|-------|
| **City ID** | 12 |
| **Region** | Asia |
| **Type** | Capital (0) |
| **Coordinates** | 37.5665, 126.9780 |
| **Radius** | 30 km |
| **Encounter Levels** | 20-55 |

```rust
CityAccount {
    city_id: 12,
    name: *b"Seoul\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0",
    latitude: 37.5665,
    longitude: 126.9780,
    radius_km: 30.0,
    city_type: 0, // Capital
    players_present: 0,
    active_encounters: 0,
    total_encounters_spawned: 0,
    founded_at: 0,
    min_encounter_level: 20,
    max_encounter_level: 55,
    bump: 0,
    _padding: [0; 5],
}
```

---

### 13. Singapore

| Property | Value |
|----------|-------|
| **City ID** | 13 |
| **Region** | Asia |
| **Type** | Trade (3) |
| **Coordinates** | 1.3521, 103.8198 |
| **Radius** | 25 km |
| **Encounter Levels** | 1-35 |

```rust
CityAccount {
    city_id: 13,
    name: *b"Singapore\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0",
    latitude: 1.3521,
    longitude: 103.8198,
    radius_km: 25.0,
    city_type: 3, // Trade
    players_present: 0,
    active_encounters: 0,
    total_encounters_spawned: 0,
    founded_at: 0,
    min_encounter_level: 1,
    max_encounter_level: 35,
    bump: 0,
    _padding: [0; 5],
}
```

---

### 14. Mumbai

| Property | Value |
|----------|-------|
| **City ID** | 14 |
| **Region** | Asia |
| **Type** | Trade (3) |
| **Coordinates** | 19.0760, 72.8777 |
| **Radius** | 35 km |
| **Encounter Levels** | 15-50 |

```rust
CityAccount {
    city_id: 14,
    name: *b"Mumbai\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0",
    latitude: 19.0760,
    longitude: 72.8777,
    radius_km: 35.0,
    city_type: 3, // Trade
    players_present: 0,
    active_encounters: 0,
    total_encounters_spawned: 0,
    founded_at: 0,
    min_encounter_level: 15,
    max_encounter_level: 50,
    bump: 0,
    _padding: [0; 5],
}
```

---

### 15. Dubai

| Property | Value |
|----------|-------|
| **City ID** | 15 |
| **Region** | Middle East |
| **Type** | Trade (3) |
| **Coordinates** | 25.2048, 55.2708 |
| **Radius** | 30 km |
| **Encounter Levels** | 25-60 |

```rust
CityAccount {
    city_id: 15,
    name: *b"Dubai\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0",
    latitude: 25.2048,
    longitude: 55.2708,
    radius_km: 30.0,
    city_type: 3, // Trade
    players_present: 0,
    active_encounters: 0,
    total_encounters_spawned: 0,
    founded_at: 0,
    min_encounter_level: 25,
    max_encounter_level: 60,
    bump: 0,
    _padding: [0; 5],
}
```

---

### 16. Baghdad

| Property | Value |
|----------|-------|
| **City ID** | 16 |
| **Region** | Middle East |
| **Type** | Combat (2) |
| **Coordinates** | 33.3152, 44.3661 |
| **Radius** | 25 km |
| **Encounter Levels** | 40-85 |

```rust
CityAccount {
    city_id: 16,
    name: *b"Baghdad\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0",
    latitude: 33.3152,
    longitude: 44.3661,
    radius_km: 25.0,
    city_type: 2, // Combat
    players_present: 0,
    active_encounters: 0,
    total_encounters_spawned: 0,
    founded_at: 0,
    min_encounter_level: 40,
    max_encounter_level: 85,
    bump: 0,
    _padding: [0; 5],
}
```

---

### 17. New York

| Property | Value |
|----------|-------|
| **City ID** | 17 |
| **Region** | Americas |
| **Type** | Trade (3) |
| **Coordinates** | 40.7128, -74.0060 |
| **Radius** | 40 km |
| **Encounter Levels** | 1-45 |

```rust
CityAccount {
    city_id: 17,
    name: *b"New York\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0",
    latitude: 40.7128,
    longitude: -74.0060,
    radius_km: 40.0,
    city_type: 3, // Trade
    players_present: 0,
    active_encounters: 0,
    total_encounters_spawned: 0,
    founded_at: 0,
    min_encounter_level: 1,
    max_encounter_level: 45,
    bump: 0,
    _padding: [0; 5],
}
```

---

### 18. Los Angeles

| Property | Value |
|----------|-------|
| **City ID** | 18 |
| **Region** | Americas |
| **Type** | Capital (0) |
| **Coordinates** | 34.0522, -118.2437 |
| **Radius** | 50 km |
| **Encounter Levels** | 1-40 |

```rust
CityAccount {
    city_id: 18,
    name: *b"Los Angeles\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0",
    latitude: 34.0522,
    longitude: -118.2437,
    radius_km: 50.0,
    city_type: 0, // Capital
    players_present: 0,
    active_encounters: 0,
    total_encounters_spawned: 0,
    founded_at: 0,
    min_encounter_level: 1,
    max_encounter_level: 40,
    bump: 0,
    _padding: [0; 5],
}
```

---

### 19. Mexico City

| Property | Value |
|----------|-------|
| **City ID** | 19 |
| **Region** | Americas |
| **Type** | Resource (1) |
| **Coordinates** | 19.4326, -99.1332 |
| **Radius** | 35 km |
| **Encounter Levels** | 20-55 |

```rust
CityAccount {
    city_id: 19,
    name: *b"Mexico City\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0",
    latitude: 19.4326,
    longitude: -99.1332,
    radius_km: 35.0,
    city_type: 1, // Resource
    players_present: 0,
    active_encounters: 0,
    total_encounters_spawned: 0,
    founded_at: 0,
    min_encounter_level: 20,
    max_encounter_level: 55,
    bump: 0,
    _padding: [0; 5],
}
```

---

### 20. Sao Paulo

| Property | Value |
|----------|-------|
| **City ID** | 20 |
| **Region** | Americas |
| **Type** | Trade (3) |
| **Coordinates** | -23.5505, -46.6333 |
| **Radius** | 45 km |
| **Encounter Levels** | 25-60 |

```rust
CityAccount {
    city_id: 20,
    name: *b"Sao Paulo\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0",
    latitude: -23.5505,
    longitude: -46.6333,
    radius_km: 45.0,
    city_type: 3, // Trade
    players_present: 0,
    active_encounters: 0,
    total_encounters_spawned: 0,
    founded_at: 0,
    min_encounter_level: 25,
    max_encounter_level: 60,
    bump: 0,
    _padding: [0; 5],
}
```

---

### 21. Sydney

| Property | Value |
|----------|-------|
| **City ID** | 21 |
| **Region** | Oceania |
| **Type** | Capital (0) |
| **Coordinates** | -33.8688, 151.2093 |
| **Radius** | 40 km |
| **Encounter Levels** | 1-40 |

```rust
CityAccount {
    city_id: 21,
    name: *b"Sydney\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0",
    latitude: -33.8688,
    longitude: 151.2093,
    radius_km: 40.0,
    city_type: 0, // Capital
    players_present: 0,
    active_encounters: 0,
    total_encounters_spawned: 0,
    founded_at: 0,
    min_encounter_level: 1,
    max_encounter_level: 40,
    bump: 0,
    _padding: [0; 5],
}
```

---

### 22. Lagos

| Property | Value |
|----------|-------|
| **City ID** | 22 |
| **Region** | Africa |
| **Type** | Resource (1) |
| **Coordinates** | 6.5244, 3.3792 |
| **Radius** | 30 km |
| **Encounter Levels** | 30-70 |

```rust
CityAccount {
    city_id: 22,
    name: *b"Lagos\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0",
    latitude: 6.5244,
    longitude: 3.3792,
    radius_km: 30.0,
    city_type: 1, // Resource
    players_present: 0,
    active_encounters: 0,
    total_encounters_spawned: 0,
    founded_at: 0,
    min_encounter_level: 30,
    max_encounter_level: 70,
    bump: 0,
    _padding: [0; 5],
}
```

---

### 23. Johannesburg

| Property | Value |
|----------|-------|
| **City ID** | 23 |
| **Region** | Africa |
| **Type** | Resource (1) |
| **Coordinates** | -26.2041, 28.0473 |
| **Radius** | 35 km |
| **Encounter Levels** | 35-75 |

```rust
CityAccount {
    city_id: 23,
    name: *b"Johannesburg\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0",
    latitude: -26.2041,
    longitude: 28.0473,
    radius_km: 35.0,
    city_type: 1, // Resource
    players_present: 0,
    active_encounters: 0,
    total_encounters_spawned: 0,
    founded_at: 0,
    min_encounter_level: 35,
    max_encounter_level: 75,
    bump: 0,
    _padding: [0; 5],
}
```

---

### 24. Rio de Janeiro

| Property | Value |
|----------|-------|
| **City ID** | 24 |
| **Region** | Americas |
| **Type** | Capital (0) |
| **Coordinates** | -22.9068, -43.1729 |
| **Radius** | 35 km |
| **Encounter Levels** | 15-50 |

```rust
CityAccount {
    city_id: 24,
    name: *b"Rio de Janeiro\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0",
    latitude: -22.9068,
    longitude: -43.1729,
    radius_km: 35.0,
    city_type: 0, // Capital
    players_present: 0,
    active_encounters: 0,
    total_encounters_spawned: 0,
    founded_at: 0,
    min_encounter_level: 15,
    max_encounter_level: 50,
    bump: 0,
    _padding: [0; 5],
}
```

---

## Regional Distribution

### Europe (7 cities)
- London, Paris, Rome, Athens, Berlin, Moscow, Istanbul

### Asia (6 cities)
- Tokyo, Beijing, Shanghai, Seoul, Singapore, Mumbai

### Middle East (2 cities)
- Dubai, Baghdad

### Africa (3 cities)
- Cairo, Lagos, Johannesburg

### Americas (5 cities)
- New York, Los Angeles, Mexico City, Sao Paulo, Rio de Janeiro

### Oceania (1 city)
- Sydney

---

## City Type Distribution

| Type | Count | Cities |
|------|-------|--------|
| Capital | 10 | London, Paris, Rome, Tokyo, Beijing, Seoul, Los Angeles, Sydney, Rio de Janeiro, Mexico City (Resource) |
| Resource | 4 | Cairo, Mexico City, Lagos, Johannesburg |
| Combat | 3 | Athens, Moscow, Baghdad |
| Trade | 7 | Berlin, Istanbul, Shanghai, Singapore, Mumbai, Dubai, New York, Sao Paulo |

---

## Starter City Recommendations

New players should begin in one of these beginner-friendly cities:

| City | Region | Why |
|------|--------|-----|
| **London** | Europe | Levels 1-40, Capital bonuses |
| **Paris** | Europe | Levels 1-40, Capital bonuses |
| **Tokyo** | Asia | Levels 1-50, Capital bonuses |
| **New York** | Americas | Levels 1-45, Trade bonuses |
| **Singapore** | Asia | Levels 1-35, Trade bonuses |
| **Sydney** | Oceania | Levels 1-40, Capital bonuses |
| **Los Angeles** | Americas | Levels 1-40, Capital bonuses |

---

## Endgame Cities

High-level players seeking challenges:

| City | Levels | Type | Difficulty |
|------|--------|------|------------|
| **Moscow** | 35-80 | Combat | Hard |
| **Baghdad** | 40-85 | Combat | Very Hard |
| **Johannesburg** | 35-75 | Resource | Hard |
| **Athens** | 25-70 | Combat | Medium-Hard |
| **Lagos** | 30-70 | Resource | Medium-Hard |

---

## Hero Meditation City Mapping

Heroes with mythological/historical origins use the nearest modern city for meditation:

| Historical Location | Nearest City | City ID |
|---------------------|--------------|---------|
| Nottingham, Camelot, Avalon | London | 1 |
| Orleans | Paris | 2 |
| Rome | Rome | 3 |
| Sparta, Pella, Delphi, Mount Olympus, Atlantis | Athens | 4 |
| Uppsala, Asgard, Copenhagen | Moscow | 6 |
| Constantinople | Istanbul | 7 |
| Alexandria, Memphis, Heliopolis, Carthage | Cairo | 8 |
| Kyoto | Tokyo | 9 |
| Karakorum, Xi'an, Suzhou | Beijing | 10 |
| Flower Fruit Mountain | Shanghai | 11 |
| Persepolis, Damascus | Baghdad | 16 |

---

## Constants for Implementation

```rust
// City constants
pub const TOTAL_CITIES: u16 = 24;
pub const MAX_CITY_ID: u16 = 24;

// City type bonuses (basis points)
pub const CAPITAL_ALL_STATS_BONUS_BPS: u16 = 500;      // +5%
pub const RESOURCE_GENERATION_BONUS_BPS: u16 = 1500;   // +15%
pub const COMBAT_ATTACK_DEFENSE_BONUS_BPS: u16 = 1000; // +10%
pub const TRADE_CASH_COLLECTION_BONUS_BPS: u16 = 1500; // +15%

// Default radius range (km)
pub const MIN_CITY_RADIUS_KM: f32 = 20.0;
pub const MAX_CITY_RADIUS_KM: f32 = 50.0;
```

---

## Initialization Helper

```rust
/// Initialize all 24 cities
/// Call once during game engine initialization
pub fn initialize_cities() -> [CityInitData; 24] {
    [
        CityInitData { id: 1,  name: "London",         lat: 51.5074,  lng: -0.1278,   radius: 35.0, city_type: 0, min_lvl: 1,  max_lvl: 40 },
        CityInitData { id: 2,  name: "Paris",          lat: 48.8566,  lng: 2.3522,    radius: 30.0, city_type: 0, min_lvl: 1,  max_lvl: 40 },
        CityInitData { id: 3,  name: "Rome",           lat: 41.9028,  lng: 12.4964,   radius: 25.0, city_type: 0, min_lvl: 15, max_lvl: 60 },
        CityInitData { id: 4,  name: "Athens",         lat: 37.9838,  lng: 23.7275,   radius: 20.0, city_type: 2, min_lvl: 25, max_lvl: 70 },
        CityInitData { id: 5,  name: "Berlin",         lat: 52.5200,  lng: 13.4050,   radius: 30.0, city_type: 3, min_lvl: 20, max_lvl: 55 },
        CityInitData { id: 6,  name: "Moscow",         lat: 55.7558,  lng: 37.6173,   radius: 40.0, city_type: 2, min_lvl: 35, max_lvl: 80 },
        CityInitData { id: 7,  name: "Istanbul",       lat: 41.0082,  lng: 28.9784,   radius: 35.0, city_type: 3, min_lvl: 30, max_lvl: 70 },
        CityInitData { id: 8,  name: "Cairo",          lat: 30.0444,  lng: 31.2357,   radius: 30.0, city_type: 1, min_lvl: 25, max_lvl: 65 },
        CityInitData { id: 9,  name: "Tokyo",          lat: 35.6762,  lng: 139.6503,  radius: 40.0, city_type: 0, min_lvl: 1,  max_lvl: 50 },
        CityInitData { id: 10, name: "Beijing",        lat: 39.9042,  lng: 116.4074,  radius: 45.0, city_type: 0, min_lvl: 20, max_lvl: 60 },
        CityInitData { id: 11, name: "Shanghai",       lat: 31.2304,  lng: 121.4737,  radius: 40.0, city_type: 3, min_lvl: 15, max_lvl: 50 },
        CityInitData { id: 12, name: "Seoul",          lat: 37.5665,  lng: 126.9780,  radius: 30.0, city_type: 0, min_lvl: 20, max_lvl: 55 },
        CityInitData { id: 13, name: "Singapore",      lat: 1.3521,   lng: 103.8198,  radius: 25.0, city_type: 3, min_lvl: 1,  max_lvl: 35 },
        CityInitData { id: 14, name: "Mumbai",         lat: 19.0760,  lng: 72.8777,   radius: 35.0, city_type: 3, min_lvl: 15, max_lvl: 50 },
        CityInitData { id: 15, name: "Dubai",          lat: 25.2048,  lng: 55.2708,   radius: 30.0, city_type: 3, min_lvl: 25, max_lvl: 60 },
        CityInitData { id: 16, name: "Baghdad",        lat: 33.3152,  lng: 44.3661,   radius: 25.0, city_type: 2, min_lvl: 40, max_lvl: 85 },
        CityInitData { id: 17, name: "New York",       lat: 40.7128,  lng: -74.0060,  radius: 40.0, city_type: 3, min_lvl: 1,  max_lvl: 45 },
        CityInitData { id: 18, name: "Los Angeles",    lat: 34.0522,  lng: -118.2437, radius: 50.0, city_type: 0, min_lvl: 1,  max_lvl: 40 },
        CityInitData { id: 19, name: "Mexico City",    lat: 19.4326,  lng: -99.1332,  radius: 35.0, city_type: 1, min_lvl: 20, max_lvl: 55 },
        CityInitData { id: 20, name: "Sao Paulo",      lat: -23.5505, lng: -46.6333,  radius: 45.0, city_type: 3, min_lvl: 25, max_lvl: 60 },
        CityInitData { id: 21, name: "Sydney",         lat: -33.8688, lng: 151.2093,  radius: 40.0, city_type: 0, min_lvl: 1,  max_lvl: 40 },
        CityInitData { id: 22, name: "Lagos",          lat: 6.5244,   lng: 3.3792,    radius: 30.0, city_type: 1, min_lvl: 30, max_lvl: 70 },
        CityInitData { id: 23, name: "Johannesburg",   lat: -26.2041, lng: 28.0473,   radius: 35.0, city_type: 1, min_lvl: 35, max_lvl: 75 },
        CityInitData { id: 24, name: "Rio de Janeiro", lat: -22.9068, lng: -43.1729,  radius: 35.0, city_type: 0, min_lvl: 15, max_lvl: 50 },
    ]
}

pub struct CityInitData {
    pub id: u16,
    pub name: &'static str,
    pub lat: f64,
    pub lng: f64,
    pub radius: f32,
    pub city_type: u8,
    pub min_lvl: u8,
    pub max_lvl: u8,
}
```

---

## Future Expansion

When adding more cities (25+), consider:

1. **Historical cities** for hero meditation (Constantinople → Istanbul already covered)
2. **Regional gaps** - more Southeast Asia, Central/South America, Central Africa
3. **Themed cities** - mythological locations (Atlantis, Olympus) as special endgame zones

Potential expansion candidates:
- Bangkok (25)
- Hong Kong (26)
- Delhi (27)
- Jakarta (28)
- Buenos Aires (29)
- Nairobi (30)
- Madrid (31)
- Vienna (32)
