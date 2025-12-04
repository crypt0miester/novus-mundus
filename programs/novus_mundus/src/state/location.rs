use pinocchio::pubkey::Pubkey;

use crate::constants::LOCATION_SEED;

/// Occupant type constants
pub const OCCUPANT_NONE: u8 = 0;
pub const OCCUPANT_PLAYER: u8 = 1;
pub const OCCUPANT_ENCOUNTER: u8 = 2;

/// Grid-based location account for cell occupancy
///
/// Each grid cell is approximately 11 meters × 11 meters (0.0001 degrees).
/// Only ONE entity (player or encounter) can occupy a cell at a time.
///
/// - Players cannot travel to player-occupied cells (unless arriving faster)
/// - Players cannot travel to encounter-occupied cells (attack from range)
/// - Encounters cannot spawn on any occupied cell
///
/// Speed-based claiming: If a player would arrive BEFORE the current reservation
/// holder, they can steal the reservation. The original holder's travel is
/// reversed (as if cancelled) and they must run cancel to finalize.
///
/// PDA derivation: [LOCATION_SEED, city_id, grid_lat, grid_long]
#[repr(C)]
#[derive(Copy, Clone)]
pub struct LocationAccount {
    /// Grid latitude (coordinate × 10000, rounded)
    pub grid_lat: i32,              // 4 bytes
    /// Grid longitude (coordinate × 10000, rounded)
    pub grid_long: i32,             // 4 bytes
    /// City this cell belongs to
    pub city_id: u16,               // 2 bytes
    /// PDA bump seed
    pub bump: u8,                   // 1 byte
    /// Type of occupant (0=none, 1=player, 2=encounter)
    pub occupant_type: u8,          // 1 byte
    /// Entity currently occupying this cell (NULL_OCCUPANT if empty)
    pub occupant: Pubkey,           // 32 bytes
    /// Timestamp when occupant arrived/spawned (or will arrive if traveling)
    pub occupied_since: i64,        // 8 bytes
    /// Who created this location (receives rent refund when closed)
    pub location_creator: Pubkey,   // 32 bytes
    /// Expected arrival time for traveling occupants (0 if already arrived)
    /// Used for speed-based reservation stealing
    pub reserved_arrival_time: i64, // 8 bytes
}

impl LocationAccount {
    pub const LEN: usize = core::mem::size_of::<Self>(); // 92 bytes

    /// Grid precision multiplier (4 decimal places ≈ 11 meters)
    pub const GRID_PRECISION: f64 = 10000.0;

    /// Null pubkey for empty cells
    pub const NULL_OCCUPANT: Pubkey = [0u8; 32];

    pub unsafe fn load(data: &[u8]) -> &Self {
        &*(data.as_ptr() as *const Self)
    }

    pub unsafe fn load_mut(data: &mut [u8]) -> &mut Self {
        &mut *(data.as_mut_ptr() as *mut Self)
    }

    /// Convert a coordinate (lat or long) to grid coordinate
    #[inline]
    pub fn to_grid(coord: f64) -> i32 {
        libm::round(coord * Self::GRID_PRECISION) as i32
    }

    /// Convert grid coordinate back to actual coordinate (cell center)
    #[inline]
    pub fn from_grid(grid: i32) -> f64 {
        grid as f64 / Self::GRID_PRECISION
    }

    /// Check if this cell is currently occupied (by anyone)
    #[inline]
    pub fn is_occupied(&self) -> bool {
        self.occupant_type != OCCUPANT_NONE && self.occupant != Self::NULL_OCCUPANT
    }

    /// Check if this cell is occupied by a player
    #[inline]
    pub fn is_player_occupied(&self) -> bool {
        self.occupant_type == OCCUPANT_PLAYER && self.occupant != Self::NULL_OCCUPANT
    }

    /// Check if this cell is occupied by an encounter
    #[inline]
    pub fn is_encounter_occupied(&self) -> bool {
        self.occupant_type == OCCUPANT_ENCOUNTER && self.occupant != Self::NULL_OCCUPANT
    }

    /// Check if this cell is occupied by a specific entity
    #[inline]
    pub fn is_occupied_by(&self, entity: &Pubkey) -> bool {
        self.is_occupied() && &self.occupant == entity
    }

    /// Check if the current occupant is still traveling (hasn't arrived yet)
    #[inline]
    pub fn is_traveling(&self) -> bool {
        self.reserved_arrival_time > 0
    }

    /// Check if a challenger with the given arrival time can steal this reservation
    /// Returns true if:
    /// - Cell is occupied by a traveling player (not encounter)
    /// - Challenger would arrive BEFORE the current reservation holder
    #[inline]
    pub fn can_steal_reservation(&self, challenger_arrival_time: i64) -> bool {
        self.is_player_occupied()
            && self.is_traveling()
            && challenger_arrival_time < self.reserved_arrival_time
    }

    /// Derive the PDA for a location cell
    pub fn derive_pda(
        city_id: u16,
        grid_lat: i32,
        grid_long: i32,
        program_id: &Pubkey,
    ) -> (Pubkey, u8) {
        let city_bytes = city_id.to_le_bytes();
        let lat_bytes = grid_lat.to_le_bytes();
        let long_bytes = grid_long.to_le_bytes();

        pinocchio::pubkey::find_program_address(
            &[LOCATION_SEED, &city_bytes, &lat_bytes, &long_bytes],
            program_id,
        )
    }

    /// Get adjacent grid cells (for finding alternative when occupied)
    /// Returns 8 adjacent cells in order: N, NE, E, SE, S, SW, W, NW
    pub fn adjacent_cells(grid_lat: i32, grid_long: i32) -> [(i32, i32); 8] {
        [
            (grid_lat + 1, grid_long),      // N
            (grid_lat + 1, grid_long + 1),  // NE
            (grid_lat, grid_long + 1),      // E
            (grid_lat - 1, grid_long + 1),  // SE
            (grid_lat - 1, grid_long),      // S
            (grid_lat - 1, grid_long - 1),  // SW
            (grid_lat, grid_long - 1),      // W
            (grid_lat + 1, grid_long - 1),  // NW
        ]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_grid_conversion() {
        // Test positive coordinates
        assert_eq!(LocationAccount::to_grid(40.12345), 401235);
        assert_eq!(LocationAccount::to_grid(40.12344), 401234);

        // Test negative coordinates
        assert_eq!(LocationAccount::to_grid(-74.56789), -745679);

        // Test round-trip
        let original = 40.1235;
        let grid = LocationAccount::to_grid(original);
        let back = LocationAccount::from_grid(grid);
        assert!((original - back).abs() < 0.00005);
    }

    #[test]
    fn test_adjacent_cells() {
        let adjacent = LocationAccount::adjacent_cells(100, 200);
        assert_eq!(adjacent[0], (101, 200)); // N
        assert_eq!(adjacent[1], (101, 201)); // NE
        assert_eq!(adjacent[2], (100, 201)); // E
        assert_eq!(adjacent[3], (99, 201));  // SE
        assert_eq!(adjacent[4], (99, 200));  // S
        assert_eq!(adjacent[5], (99, 199));  // SW
        assert_eq!(adjacent[6], (100, 199)); // W
        assert_eq!(adjacent[7], (101, 199)); // NW
    }
}
