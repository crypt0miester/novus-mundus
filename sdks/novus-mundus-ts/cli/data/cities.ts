/**
 * City Data — the 24 canonical Novus Mundus settlements.
 *
 * Each settlement sits on the ruins of an old-world city; the real-world city
 * (the lore "Old Name") supplies the coordinates.
 *
 * LEGACY_CITIES preserves the previous placeholder set (real-world names) so
 * nothing that still references it breaks.
 */

/**
 * City type classification — values MUST match the on-chain `CityType` enum in
 * programs/novus_mundus/src/state/city.rs.
 */
export enum CityType {
	Capital = 0,
	Resource = 1,
	Combat = 2,
	Trade = 3,
}

export interface CityData {
	id: number;
	name: string;
	lat: number;
	lon: number;
	radiusKm: number;
	type: CityType;
	/**
	 * Filename (without extension) in `terrain-builder/data/` that supplies the
	 * anchor preset for this city. Most map 1:1 to the real-world `Old: X`
	 * placeholder. Omit or `null` means no preset exists yet — the terrain init
	 * phase skips the city with a warning.
	 */
	terrainPreset?: string | null;
}

export const CITIES: CityData[] = [
	// Ashenmere — the central heartland
	{
		id: 0,
		name: "Valdenmoor",
		lat: 51.5074,
		lon: -0.1278,
		radiusKm: 52,
		type: CityType.Capital,
		terrainPreset: "london",
	}, // Old: London
	{
		id: 1,
		name: "Coranthas",
		lat: 48.8566,
		lon: 2.3522,
		radiusKm: 45,
		type: CityType.Capital,
		terrainPreset: "paris",
	}, // Old: Paris
	{
		id: 2,
		name: "Solterrae",
		lat: 41.9028,
		lon: 12.4964,
		radiusKm: 40,
		type: CityType.Capital,
		terrainPreset: "rome",
	}, // Old: Rome
	{
		id: 3,
		name: "Kael Mora",
		lat: 37.9838,
		lon: 23.7275,
		radiusKm: 35,
		type: CityType.Combat,
		terrainPreset: "athens",
	}, // Old: Athens
	{
		id: 4,
		name: "Thornmark",
		lat: 52.52,
		lon: 13.405,
		radiusKm: 40,
		type: CityType.Trade,
		terrainPreset: "berlin",
	}, // Old: Berlin

	// Duskfeld — the cold north
	{
		id: 5,
		name: "Vraenholdt",
		lat: 55.7558,
		lon: 37.6173,
		radiusKm: 50,
		type: CityType.Combat,
		terrainPreset: "moscow",
	}, // Old: Moscow
	{
		id: 6,
		name: "Kaelindra",
		lat: 41.0082,
		lon: 28.9784,
		radiusKm: 45,
		type: CityType.Trade,
		terrainPreset: "istanbul",
	}, // Old: Istanbul

	// Sunward Reach — the arid south and east
	{
		id: 7,
		name: "Auren Khet",
		lat: 30.0444,
		lon: 31.2357,
		radiusKm: 50,
		type: CityType.Resource,
		terrainPreset: "cairo",
	}, // Old: Cairo
	{
		id: 8,
		name: "Solvaran",
		lat: 25.2048,
		lon: 55.2708,
		radiusKm: 45,
		type: CityType.Trade,
		terrainPreset: "dubai",
	}, // Old: Dubai
	// Korthain (Baghdad) has no matching preset — `jerusalem` is the nearest in
	// both latitude and climate, so it stands in until a bespoke build is shipped.
	{
		id: 9,
		name: "Korthain",
		lat: 33.3152,
		lon: 44.3661,
		radiusKm: 40,
		type: CityType.Combat,
		terrainPreset: "jerusalem",
	}, // Old: Baghdad → jerusalem
	{
		id: 10,
		name: "Duskara",
		lat: 6.5244,
		lon: 3.3792,
		radiusKm: 45,
		type: CityType.Resource,
		terrainPreset: "lagos",
	}, // Old: Lagos

	// Stormbreak Isles — eastern archipelago
	{
		id: 11,
		name: "Shirevane",
		lat: 35.6762,
		lon: 139.6503,
		radiusKm: 55,
		type: CityType.Capital,
		terrainPreset: "tokyo",
	}, // Old: Tokyo
	{
		id: 12,
		name: "Drenmire",
		lat: 39.9042,
		lon: 116.4074,
		radiusKm: 50,
		type: CityType.Capital,
		terrainPreset: "beijing",
	}, // Old: Beijing
	{
		id: 13,
		name: "Pelagora",
		lat: 31.2304,
		lon: 121.4737,
		radiusKm: 48,
		type: CityType.Trade,
		terrainPreset: "shanghai",
	}, // Old: Shanghai
	{
		id: 14,
		name: "Aelthis",
		lat: 37.5665,
		lon: 126.978,
		radiusKm: 45,
		type: CityType.Capital,
		terrainPreset: "seoul",
	}, // Old: Seoul

	// Jade Straits — tropical trade corridor
	{
		id: 15,
		name: "Lyssandor",
		lat: 1.3521,
		lon: 103.8198,
		radiusKm: 35,
		type: CityType.Trade,
		terrainPreset: "singapore",
	}, // Old: Singapore
	{
		id: 16,
		name: "Maravhen",
		lat: 19.076,
		lon: 72.8777,
		radiusKm: 50,
		type: CityType.Trade,
		terrainPreset: "mumbai",
	}, // Old: Mumbai

	// Ironmarch — the western continent
	{
		id: 17,
		name: "Ashenveil",
		lat: 40.7128,
		lon: -74.006,
		radiusKm: 50,
		type: CityType.Trade,
		terrainPreset: "new-york",
	}, // Old: New York
	{
		id: 18,
		name: "Eldrath",
		lat: 34.0522,
		lon: -118.2437,
		radiusKm: 55,
		type: CityType.Capital,
		terrainPreset: "los-angeles",
	}, // Old: Los Angeles
	{
		id: 19,
		name: "Tonalca",
		lat: 19.4326,
		lon: -99.1332,
		radiusKm: 50,
		type: CityType.Resource,
		terrainPreset: "mexico-city",
	}, // Old: Mexico City

	// Greenvast — the southern reaches
	{
		id: 20,
		name: "Verador",
		lat: -23.5505,
		lon: -46.6333,
		radiusKm: 50,
		type: CityType.Trade,
		terrainPreset: "sao-paulo",
	}, // Old: Sao Paulo
	{
		id: 21,
		name: "Mirethane",
		lat: -33.8688,
		lon: 151.2093,
		radiusKm: 45,
		type: CityType.Capital,
		terrainPreset: "sydney",
	}, // Old: Sydney
	{
		id: 22,
		name: "Grimhollow",
		lat: -26.2041,
		lon: 28.0473,
		radiusKm: 45,
		type: CityType.Resource,
		terrainPreset: "johannesburg",
	}, // Old: Johannesburg
	{
		id: 23,
		name: "Seralune",
		lat: -22.9068,
		lon: -43.1729,
		radiusKm: 42,
		type: CityType.Capital,
		terrainPreset: "rio-de-janeiro",
	}, // Old: Rio de Janeiro
];

/**
 * LEGACY placeholder cities — real-world names, kept for reference and any
 * tooling that still expects the old set. Do NOT use for new seeding.
 *
 * Note: the `type` values below were authored before the CityType enum was
 * corrected, so they now reflect each city's intended classification rather
 * than the (buggy) bytes that may have been written on-chain previously.
 */
export const LEGACY_CITIES: CityData[] = [
	// City 0: Default spawn city
	{
		id: 0,
		name: "New York",
		lat: 40.7128,
		lon: -74.006,
		radiusKm: 50,
		type: CityType.Capital,
	},

	// North America
	{
		id: 1,
		name: "Los Angeles",
		lat: 34.0522,
		lon: -118.2437,
		radiusKm: 50,
		type: CityType.Trade,
	},
	{
		id: 2,
		name: "Chicago",
		lat: 41.8781,
		lon: -87.6298,
		radiusKm: 45,
		type: CityType.Combat,
	},
	{
		id: 3,
		name: "Mexico City",
		lat: 19.4326,
		lon: -99.1332,
		radiusKm: 55,
		type: CityType.Capital,
	},
	{
		id: 4,
		name: "Miami",
		lat: 25.7617,
		lon: -80.1918,
		radiusKm: 35,
		type: CityType.Resource,
	},
	{
		id: 5,
		name: "Houston",
		lat: 29.7604,
		lon: -95.3698,
		radiusKm: 45,
		type: CityType.Resource,
	},

	// South America
	{
		id: 6,
		name: "Buenos Aires",
		lat: -34.6037,
		lon: -58.3816,
		radiusKm: 45,
		type: CityType.Capital,
	},
	{
		id: 7,
		name: "Rio de Janeiro",
		lat: -22.9068,
		lon: -43.1729,
		radiusKm: 40,
		type: CityType.Combat,
	},
	{
		id: 8,
		name: "Bogotá",
		lat: 4.711,
		lon: -74.0721,
		radiusKm: 40,
		type: CityType.Resource,
	},

	// Europe
	{
		id: 9,
		name: "Paris",
		lat: 48.8566,
		lon: 2.3522,
		radiusKm: 45,
		type: CityType.Capital,
	},
	{
		id: 10,
		name: "Berlin",
		lat: 52.52,
		lon: 13.405,
		radiusKm: 40,
		type: CityType.Combat,
	},
	{
		id: 11,
		name: "Rome",
		lat: 41.9028,
		lon: 12.4964,
		radiusKm: 38,
		type: CityType.Resource,
	},
	{
		id: 12,
		name: "Amsterdam",
		lat: 52.3676,
		lon: 4.9041,
		radiusKm: 35,
		type: CityType.Trade,
	},
	{
		id: 13,
		name: "Moscow",
		lat: 55.7558,
		lon: 37.6173,
		radiusKm: 50,
		type: CityType.Capital,
	},
	{
		id: 14,
		name: "Istanbul",
		lat: 41.0082,
		lon: 28.9784,
		radiusKm: 45,
		type: CityType.Trade,
	},
	{
		id: 15,
		name: "Athens",
		lat: 37.9838,
		lon: 23.7275,
		radiusKm: 35,
		type: CityType.Resource,
	},

	// Africa
	{
		id: 16,
		name: "Cairo",
		lat: 30.0444,
		lon: 31.2357,
		radiusKm: 50,
		type: CityType.Capital,
	},
	{
		id: 17,
		name: "Lagos",
		lat: 6.5244,
		lon: 3.3792,
		radiusKm: 45,
		type: CityType.Trade,
	},
	{
		id: 18,
		name: "Johannesburg",
		lat: -26.2041,
		lon: 28.0473,
		radiusKm: 45,
		type: CityType.Combat,
	},
	{
		id: 19,
		name: "Nairobi",
		lat: -1.2921,
		lon: 36.8219,
		radiusKm: 40,
		type: CityType.Resource,
	},
	{
		id: 20,
		name: "Casablanca",
		lat: 33.5731,
		lon: -7.5898,
		radiusKm: 38,
		type: CityType.Trade,
	},

	// Middle East
	{
		id: 21,
		name: "Dubai",
		lat: 25.2048,
		lon: 55.2708,
		radiusKm: 45,
		type: CityType.Trade,
	},
	{
		id: 22,
		name: "Jerusalem",
		lat: 31.7683,
		lon: 35.2137,
		radiusKm: 35,
		type: CityType.Combat,
	},
	{
		id: 23,
		name: "Riyadh",
		lat: 24.7136,
		lon: 46.6753,
		radiusKm: 40,
		type: CityType.Resource,
	},

	// Asia - East
	{
		id: 24,
		name: "Tokyo",
		lat: 35.6762,
		lon: 139.6503,
		radiusKm: 55,
		type: CityType.Capital,
	},
	{
		id: 25,
		name: "Beijing",
		lat: 39.9042,
		lon: 116.4074,
		radiusKm: 50,
		type: CityType.Capital,
	},
	{
		id: 26,
		name: "Hong Kong",
		lat: 22.3193,
		lon: 114.1694,
		radiusKm: 40,
		type: CityType.Trade,
	},

	// Asia - South & Southeast
	{
		id: 27,
		name: "Singapore",
		lat: 1.3521,
		lon: 103.8198,
		radiusKm: 35,
		type: CityType.Trade,
	},
	{
		id: 28,
		name: "Delhi",
		lat: 28.7041,
		lon: 77.1025,
		radiusKm: 50,
		type: CityType.Capital,
	},
	{
		id: 29,
		name: "Jakarta",
		lat: -6.2088,
		lon: 106.8456,
		radiusKm: 50,
		type: CityType.Resource,
	},
	{
		id: 30,
		name: "Manila",
		lat: 14.5995,
		lon: 120.9842,
		radiusKm: 45,
		type: CityType.Combat,
	},

	// Oceania
	{
		id: 31,
		name: "Sydney",
		lat: -33.8688,
		lon: 151.2093,
		radiusKm: 45,
		type: CityType.Capital,
	},
];
