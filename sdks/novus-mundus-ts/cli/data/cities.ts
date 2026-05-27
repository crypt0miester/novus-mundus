/**
 * City Data — the 24 canonical Novus Mundus settlements.
 *
 * Each settlement sits on the ruins of an old-world city; the real-world
 * city (the lore "Old Name") supplies the coordinates. `radiusKm` is the
 * SOURCE-OF-TRUTH sizing parameter — `dimsFromRadius` converts it to the
 * chain-side `widthGrid` / `heightGrid` square plot at use time. Biome
 * layout is derived deterministically from `seedForCity(id)` and the
 * chain noise function, biased by per-city `BiomeKnobs` that tilt the
 * climate (temp / moisture), water level, and landform (coastal gradient
 * along a bearing or organic landmass mask). All-zero knobs reproduce
 * the pre-knobs procedural sampler bit-for-bit. No per-cell biome data
 * is stored anywhere.
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

/**
 * Per-city biome knob preset. Five bytes that bias the procedural
 * sampler — see `BiomeKnobs` in `sdks/novus-mundus-ts/src/calculators/biome.ts`
 * and the Rust mirror in `programs/novus_mundus/src/logic/biome.rs`.
 * Required for every city. Cities without a strong identity use
 * `BIOME_PROCEDURAL` (all zeros) — explicit, never inferred via `??`.
 */
export interface CityBiomePreset {
	waterLevelDelta: number;
	tempBias: number;
	moistureBias: number;
	/** 0 = none, 1..=8 = N/NE/E/SE/S/SW/W/NW (direction sea lies in). */
	coast: number;
	/** 0 = no mask, >0 carves organic islands / archipelagos. */
	landmassSeed: number;
}

/** Identity-free baseline. Reproduces the pre-knobs procedural sampler
 * bit-for-bit. Cities without strong climate / landform identity use
 * this; new cities should override the fields they care about and
 * leave the rest at 0. */
export const BIOME_PROCEDURAL: CityBiomePreset = {
	waterLevelDelta: 0,
	tempBias: 0,
	moistureBias: 0,
	coast: 0,
	landmassSeed: 0,
};

export interface CityData {
	id: number;
	name: string;
	lat: number;
	lon: number;
	radiusKm: number;
	type: CityType;
	/** Biome knob preset — required. Use BIOME_PROCEDURAL for no override. */
	biome: CityBiomePreset;
}

/**
 * Square plot extent in grid units, preserving the visible area of the
 * legacy circular plot of radius `radiusKm` km. Matches the §9 cutover
 * conversion: `width = height ≈ radius_km × √π / 0.011`.
 */
export function dimsFromRadius(radiusKm: number): number {
	const SQRT_PI = 1.7724539;
	const KM_PER_DEG = 111;
	const GRID_PRECISION = 10_000;
	return Math.round(((radiusKm * SQRT_PI) / KM_PER_DEG) * GRID_PRECISION);
}

/**
 * Deterministic biome seed per city. `0xCAFE0000 | id` so a city's biome
 * layout is reproducible across redeploys. Override here (e.g. with an
 * `if (id === N) return CUSTOM_SEED`) to pin a different layout for a
 * specific city; the value is written to chain on first init and never
 * re-read, so post-init changes need a close + reinit (DAO-signed).
 */
export function seedForCity(id: number): number {
	return (0xcafe0000 | id) >>> 0;
}


// Climate / landform presets. Spell out the design choice next to the
// city it applies to — these are the "this is what Cairo should feel
// like" decisions, kept in one place. Knob semantics:
//   waterLevelDelta: +127 ~ no water; -96 ~ all water; 0 = baseline.
//   tempBias / moistureBias: ±64 ≈ one Whittaker bucket shift.
//   coast: 1..=8 (N/NE/E/SE/S/SW/W/NW = direction the sea lies in).
//   landmassSeed: 0 = no mask; pick any nonzero value to carve islands.
//
// Water budget — stacking water-pushing knobs floods the plot:
//   * landmassSeed != 0 alone forces ~50% water (mask threshold 128/255).
//   * Negative waterLevelDelta lowers the procedural water threshold
//     (default 96), adding water everywhere the mask isn't already sea.
//   * coast adds a smooth gradient of up to ±128 along the bearing.
// When using landmassSeed, set waterLevelDelta to a POSITIVE value
// (~+30..+60) to suppress the procedural water layer — otherwise the
// city ends up almost entirely water. For coastal cities, use `coast`
// alone and leave waterLevelDelta near 0.

export const CITIES: CityData[] = [
	// Ashenmere — the central heartland (procedural defaults, no strong identity).
	{
		id: 0,
		name: "Valdenmoor",
		lat: 51.5074,
		lon: -0.1278,
		radiusKm: 52,
		type: CityType.Capital,
		biome: BIOME_PROCEDURAL,
	}, // Old: London
	{
		id: 1,
		name: "Coranthas",
		lat: 48.8566,
		lon: 2.3522,
		radiusKm: 45,
		type: CityType.Capital,
		biome: BIOME_PROCEDURAL,
	}, // Old: Paris
	{
		id: 2,
		name: "Solterrae",
		lat: 41.9028,
		lon: 12.4964,
		radiusKm: 40,
		type: CityType.Capital,
		biome: { ...BIOME_PROCEDURAL, waterLevelDelta: 20, tempBias: 30, moistureBias: -10 },
	}, // Old: Rome — warm/dry Mediterranean inland feel (~15% water)
	{
		id: 3,
		name: "Kael Mora",
		lat: 37.9838,
		lon: 23.7275,
		radiusKm: 35,
		type: CityType.Combat,
		biome: { ...BIOME_PROCEDURAL, tempBias: 30, moistureBias: -20, coast: 4 /* SE */ },
	}, // Old: Athens — Aegean to the SE
	{
		id: 4,
		name: "Thornmark",
		lat: 52.52,
		lon: 13.405,
		radiusKm: 40,
		type: CityType.Trade,
		biome: { ...BIOME_PROCEDURAL, waterLevelDelta: 20, tempBias: -20, moistureBias: 10 },
	}, // Old: Berlin — cool temperate inland (~15% water)

	// Duskfeld — the cold north.
	{
		id: 5,
		name: "Vraenholdt",
		lat: 55.7558,
		lon: 37.6173,
		radiusKm: 50,
		type: CityType.Combat,
		biome: { ...BIOME_PROCEDURAL, waterLevelDelta: 127, tempBias: -100 },
	}, // Old: Moscow — inland, snow + rock mix
	{
		id: 6,
		name: "Kaelindra",
		lat: 41.0082,
		lon: 28.9784,
		radiusKm: 45,
		type: CityType.Trade,
		biome: { ...BIOME_PROCEDURAL, tempBias: 20, moistureBias: 0, coast: 1 /* N */ },
	}, // Old: Istanbul — Bosphorus to the north

	// Sunward Reach — the arid south and east.
	{
		id: 7,
		name: "Auren Khet",
		lat: 30.0444,
		lon: 31.2357,
		radiusKm: 50,
		type: CityType.Resource,
		biome: { ...BIOME_PROCEDURAL, waterLevelDelta: 127, tempBias: 80, moistureBias: -100 },
	}, // Old: Cairo — desert mix (sand + rock + dirt)
	{
		id: 8,
		name: "Solvaran",
		lat: 25.2048,
		lon: 55.2708,
		radiusKm: 45,
		type: CityType.Trade,
		biome: { ...BIOME_PROCEDURAL, waterLevelDelta: 30, tempBias: 100, moistureBias: -100, coast: 1 /* N */ },
	}, // Old: Dubai — desert with Gulf to the north (coast gradient brings water on the north side)
	{
		id: 9,
		name: "Korthain",
		lat: 33.3152,
		lon: 44.3661,
		radiusKm: 40,
		type: CityType.Combat,
		biome: { ...BIOME_PROCEDURAL, waterLevelDelta: 110, tempBias: 70, moistureBias: -90 },
	}, // Old: Baghdad — arid inland
	{
		id: 10,
		name: "Duskara",
		lat: 6.5244,
		lon: 3.3792,
		radiusKm: 45,
		type: CityType.Resource,
		biome: { ...BIOME_PROCEDURAL, waterLevelDelta: 30, tempBias: 80, moistureBias: 60, coast: 5 /* S */ },
	}, // Old: Lagos — tropical coastal, sea to the south

	// Stormbreak Isles — eastern archipelago.
	{
		id: 11,
		name: "Shirevane",
		lat: 35.6762,
		lon: 139.6503,
		radiusKm: 55,
		type: CityType.Capital,
		biome: { ...BIOME_PROCEDURAL, waterLevelDelta: 50, tempBias: 20, moistureBias: 30, landmassSeed: 14 },
	}, // Old: Tokyo — archipelago (~40% water); mask seed picked so the noise carves real seas on this city's seed
	{
		id: 12,
		name: "Drenmire",
		lat: 39.9042,
		lon: 116.4074,
		radiusKm: 50,
		type: CityType.Capital,
		biome: { ...BIOME_PROCEDURAL, tempBias: 10, moistureBias: -30 },
	}, // Old: Beijing — continental temperate, drier
	{
		id: 13,
		name: "Pelagora",
		lat: 31.2304,
		lon: 121.4737,
		radiusKm: 48,
		type: CityType.Trade,
		biome: { ...BIOME_PROCEDURAL, tempBias: 30, moistureBias: 40, coast: 3 /* E */ },
	}, // Old: Shanghai — humid east coast
	{
		id: 14,
		name: "Aelthis",
		lat: 37.5665,
		lon: 126.978,
		radiusKm: 45,
		type: CityType.Capital,
		biome: { ...BIOME_PROCEDURAL, tempBias: -30, moistureBias: 10, coast: 7 /* W */ },
	}, // Old: Seoul — cool with Yellow Sea to the west

	// Jade Straits — tropical trade corridor.
	{
		id: 15,
		name: "Lyssandor",
		lat: 1.3521,
		lon: 103.8198,
		radiusKm: 35,
		type: CityType.Trade,
		biome: { ...BIOME_PROCEDURAL, waterLevelDelta: 30, tempBias: 90, moistureBias: 90, landmassSeed: 27 },
	}, // Old: Singapore — tropical archipelago (~48% water); ls=11 was all-sea on this city's seed
	{
		id: 16,
		name: "Maravhen",
		lat: 19.076,
		lon: 72.8777,
		radiusKm: 50,
		type: CityType.Trade,
		biome: { ...BIOME_PROCEDURAL, tempBias: 70, moistureBias: 50, coast: 7 /* W */ },
	}, // Old: Mumbai — tropical west coast

	// Ironmarch — the western continent.
	{
		id: 17,
		name: "Ashenveil",
		lat: 40.7128,
		lon: -74.006,
		radiusKm: 50,
		type: CityType.Trade,
		biome: { ...BIOME_PROCEDURAL, tempBias: 10, coast: 3 /* E */ },
	}, // Old: New York — east coast (Atlantic). Mask dropped — Manhattan landmass is too small for the mask scale, dominated by sea otherwise.
	{
		id: 18,
		name: "Eldrath",
		lat: 34.0522,
		lon: -118.2437,
		radiusKm: 55,
		type: CityType.Capital,
		biome: { ...BIOME_PROCEDURAL, waterLevelDelta: 30, tempBias: 60, moistureBias: -50, coast: 7 /* W */ },
	}, // Old: Los Angeles — warm/dry with Pacific to the west
	{
		id: 19,
		name: "Tonalca",
		lat: 19.4326,
		lon: -99.1332,
		radiusKm: 50,
		type: CityType.Resource,
		biome: { ...BIOME_PROCEDURAL, waterLevelDelta: 80, tempBias: 50, moistureBias: -20 },
	}, // Old: Mexico City — high inland plateau

	// Greenvast — the southern reaches.
	{
		id: 20,
		name: "Verador",
		lat: -23.5505,
		lon: -46.6333,
		radiusKm: 50,
		type: CityType.Trade,
		biome: { ...BIOME_PROCEDURAL, waterLevelDelta: 20, tempBias: 50, moistureBias: 40 },
	}, // Old: Sao Paulo — humid subtropical, inland (~15% water)
	{
		id: 21,
		name: "Mirethane",
		lat: -33.8688,
		lon: 151.2093,
		radiusKm: 45,
		type: CityType.Capital,
		biome: { ...BIOME_PROCEDURAL, tempBias: 30, coast: 3 /* E */ },
	}, // Old: Sydney — east-facing harbour
	{
		id: 22,
		name: "Grimhollow",
		lat: -26.2041,
		lon: 28.0473,
		radiusKm: 45,
		type: CityType.Resource,
		biome: { ...BIOME_PROCEDURAL, waterLevelDelta: 90, tempBias: 30, moistureBias: -40 },
	}, // Old: Johannesburg — dry highveld inland
	{
		id: 23,
		name: "Seralune",
		lat: -22.9068,
		lon: -43.1729,
		radiusKm: 42,
		type: CityType.Capital,
		biome: { ...BIOME_PROCEDURAL, tempBias: 60, moistureBias: 40, coast: 3 /* E */ },
	}, // Old: Rio de Janeiro — tropical coast, sea to the east
];
