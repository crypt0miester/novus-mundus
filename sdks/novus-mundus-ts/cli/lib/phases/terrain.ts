/**
 * Phase 2.5 — Terrain
 *
 * For each city in CITIES with a `terrainPreset`, load the matching JSON from
 * `terrain-builder/data/<preset>.json` and submit a `set_terrain` instruction.
 *
 * Idempotent: skips cities whose on-chain `anchor_count > 0`. Re-running after
 * a city has terrain is a no-op (use `terrain set <city-id> --force` from the
 * standalone command if you need to overwrite).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { Anchor, CityTerrain } from "../../../src/calculators/terrain";
import {
	createSetTerrainInstruction,
	deriveCityPda,
	parseCity,
} from "../../../src/index";
import { CITIES } from "../../data/cities";
import type { CLIContext } from "../context";
import {
	bold,
	dim,
	green,
	red,
	section,
	statusBadge,
	table,
	yellow,
} from "../format";
import {
	accountExists,
	log,
	newStats,
	type PhaseStats,
	sendWithRetry,
} from "../helpers";

const TERRAIN_DATA_DIR = path.resolve(
	__dirname,
	"../../../terrain-builder/data",
);

interface TerrainFile {
	seed: number;
	waterLine: number;
	peakLine: number;
	radiusKm?: number;
	anchorCount: number;
	version?: number;
	anchors: Anchor[];
}

function loadTerrain(preset: string): CityTerrain {
	const file = path.join(TERRAIN_DATA_DIR, `${preset}.json`);
	const raw = fs.readFileSync(file, "utf-8");
	const data = JSON.parse(raw) as TerrainFile;
	return {
		seed: data.seed,
		waterLine: data.waterLine,
		peakLine: data.peakLine,
		anchorCount: data.anchors.length,
		version: data.version ?? 1,
		anchors: data.anchors,
	};
}

export async function initTerrain(ctx: CLIContext): Promise<PhaseStats> {
	const stats = newStats();

	for (const city of CITIES) {
		const [cityPda] = deriveCityPda(ctx.gameEngine, city.id);
		const exists = await accountExists(ctx.connection, cityPda);
		if (!exists) {
			log.info(
				`City ${city.id} (${city.name}) not initialized yet — run 'init cities' first`,
			);
			stats.skipped++;
			continue;
		}

		// Skip cities that already have terrain on chain. parseCity reads the
		// trailing anchor data, so anchorCount > 0 == real terrain has been set.
		const info = await ctx.connection.getAccountInfo(cityPda);
		if (info) {
			const parsed = parseCity(info);
			if (parsed && parsed.anchorCount > 0) {
				log.skip(
					`City ${city.id} (${city.name}) — terrain already set (${parsed.anchorCount} anchors)`,
				);
				stats.skipped++;
				continue;
			}
		}

		if (!city.terrainPreset) {
			log.info(
				`City ${city.id} (${city.name}) — no terrainPreset mapped, skipping`,
			);
			stats.skipped++;
			continue;
		}

		let terrain: CityTerrain;
		try {
			terrain = loadTerrain(city.terrainPreset);
		} catch (e: unknown) {
			const msg = e instanceof Error ? e.message : String(e);
			log.error(
				`City ${city.id} (${city.name}) — failed to load preset '${city.terrainPreset}': ${msg}`,
			);
			continue;
		}

		if (ctx.dryRun) {
			log.dryRun(
				`Would set terrain on city ${city.id} (${city.name}) — preset '${city.terrainPreset}', ${terrain.anchors.length} anchors`,
			);
			stats.created++;
			continue;
		}

		const ix = createSetTerrainInstruction(
			{
				daoAuthority: ctx.daoAuthority.publicKey,
				gameEngine: ctx.gameEngine,
			},
			{
				cityId: city.id,
				terrain,
			},
		);

		try {
			await sendWithRetry(ctx, ix, [ctx.daoAuthority]);
			log.create(
				`Terrain set: city ${city.id} (${city.name}) ← ${city.terrainPreset} [${terrain.anchors.length} anchors]`,
			);
			stats.created++;
		} catch (e: unknown) {
			const msg = e instanceof Error ? e.message : String(e);
			log.error(
				`Failed to set terrain on city ${city.id} (${city.name}): ${msg}`,
			);
		}
	}

	return stats;
}

export async function statusTerrain(ctx: CLIContext): Promise<string> {
	let withTerrain = 0;
	let withoutTerrain = 0;
	for (const city of CITIES) {
		const [pda] = deriveCityPda(ctx.gameEngine, city.id);
		const info = await ctx.connection.getAccountInfo(pda);
		if (!info) continue;
		const parsed = parseCity(info);
		if (parsed && parsed.anchorCount > 0) withTerrain++;
		else withoutTerrain++;
	}
	return `${withTerrain}/${withTerrain + withoutTerrain} cities have terrain`;
}

export async function detailTerrain(ctx: CLIContext): Promise<string> {
	const lines: string[] = [];
	lines.push(section(`Terrain — Kingdom ${ctx.kingdomId}`));

	const rows: string[][] = [];
	for (const city of CITIES) {
		const [pda] = deriveCityPda(ctx.gameEngine, city.id);
		const info = await ctx.connection.getAccountInfo(pda);
		if (!info) {
			rows.push([
				String(city.id),
				city.name,
				dim("--"),
				dim("--"),
				red("NO CITY"),
			]);
			continue;
		}
		const parsed = parseCity(info);
		if (!parsed) {
			rows.push([String(city.id), city.name, dim("--"), dim("--"), red("BAD")]);
			continue;
		}
		const hasTerrain = parsed.anchorCount > 0;
		rows.push([
			String(city.id),
			city.name,
			city.terrainPreset ?? dim("—"),
			String(parsed.anchorCount),
			hasTerrain ? green("on-chain") : yellow("unset"),
		]);
	}

	lines.push(
		table(
			[
				{ header: "ID", align: "right", width: 3 },
				{ header: "Name", width: 14 },
				{ header: "Preset", width: 16 },
				{ header: "Anchors", align: "right" },
				{ header: "Status" },
			],
			rows,
		),
	);

	lines.push("");
	return lines.join("\n");
}

// Silence unused-import warning for `bold` and `statusBadge` — kept for parity
// with sibling phase modules; remove once new sections start using them.
void bold;
void statusBadge;
