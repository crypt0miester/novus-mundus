import "server-only";
import { timingSafeEqual } from "node:crypto";
import {
  ComputeBudgetProgram,
  type Connection,
  type Keypair,
  type PublicKey,
  Transaction,
  type TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  createSpawnEncounterInstruction,
  deriveCityPda,
  deserializeCity,
  EncounterRarity,
  buildEncounterCleanupIx,
  isEncounterCleanable,
} from "novus-mundus-sdk";

import { biomeAt, biomeKnobsFromCity, isPassableBiome, type BiomeKnobs } from "@/lib/world/biome";
import { gameAuthorityKeypair, serverClient, serverConnection } from "@/lib/server/game-authority";
import { gameEnginePda } from "@/lib/server/chain";

export const runtime = "nodejs";

/**
 * GET/POST /api/cron/encounters
 *
 * Single-pass encounter lifecycle: per city, top up active encounters to a
 * target count (`TARGET_PER_CITY`), then clean up any encounter whose
 * `despawn_at + 1h` grace has elapsed.
 *
 * Auth: `Authorization: Bearer ${CRON_SECRET}` — Vercel Cron sets this
 * header automatically when the route is configured in `vercel.json`. Vercel
 * Cron uses GET; we also accept POST so a manual `curl -X POST` works.
 * Any non-development environment without a configured secret is rejected
 * (500) so a misconfigured preview deploy can't be drained by anyone with
 * the URL. The Bearer compare is timing-safe.
 *
 * Authorization on chain: post-deploy the `auto_spawn` branch in
 * `spawn.rs` accepts `signer == game_engine.game_authority`, so the
 * `gameAuthorityKeypair()` here is the canonical signer (no DAO key on
 * the web server). Cleanup is permissionless so any payer works; we use
 * the same keypair for simplicity.
 *
 * Idempotent: chain rejects double-spawns at the same index + cell, and
 * cleanup is a no-op for encounters still inside the grace window. A
 * missed run is recovered by the next one.
 */

/* Per-city target counts of alive encounters. Common dominates; rarer
 * tiers are sparse so the disc feels challenging without flooding it.
 * Tunable here without redeploying the chain. */
const TARGET_PER_CITY: Record<EncounterRarity, number> = {
  [EncounterRarity.Common]: 8,
  [EncounterRarity.Uncommon]: 3,
  [EncounterRarity.Rare]: 2,
  [EncounterRarity.Epic]: 1,
  [EncounterRarity.Legendary]: 0,
};

const RARITIES_TO_SPAWN: EncounterRarity[] = [
  EncounterRarity.Common,
  EncounterRarity.Uncommon,
  EncounterRarity.Rare,
  EncounterRarity.Epic,
];

/* Kingdom-aware encounter level ceiling. Auto-spawned encounters used to
 * spread uniformly across each city's full level band (often 1-100), so a
 * kingdom of low-level players faced encounters far above their level. We
 * sample the live player population, take a high-percentile level (so stronger
 * players still get a challenge) plus a little headroom, and pass that to the
 * chain as a hard ceiling. The chain's low-biased distribution then clusters
 * most spawns near each city's floor under this cap. A fresh/empty kingdom
 * falls back to MIN so it isn't seeded with max-level monsters. */
const KINGDOM_LEVEL_PERCENTILE = 0.75;
const KINGDOM_LEVEL_HEADROOM = 5;
const MIN_KINGDOM_LEVEL_CAP = 10;
const MAX_KINGDOM_LEVEL_CAP = 100;

const GRID_PRECISION = 10000;
/* Chain error codes we treat as "the cell is no good — try a different
 * one". Anything else (city encounter-limit hit, wrong time of day) is
 * terminal for this rarity's queue. InvalidPDA (6010) is handled
 * specially: it usually means a concurrent run bumped the city's
 * `totalEncountersSpawned` past our cached startIndex, so we refetch
 * the counter and retry rather than treat it as terminal. */
const RETRYABLE_SPAWN_ERRORS = new Set<number>([
  6411, // OUT_OF_RANGE
  6413, // CELL_OCCUPIED
  6430, // TERRAIN_IMPASSABLE
]);
const ERR_INVALID_PDA = 6010;

/* Compute unit budgets. Spawn is ~20k CU on chain (per the SDK
 * comment in `instructions/encounter.ts`); cleanup is ~5k CU. Headroom
 * accounts for the variable-cost paths inside (NOVI burn, ATA create,
 * Location PDA close). Explicit limits stop the runtime from giving us
 * the conservative 200k default and let us pack more cleanups per tx. */
const CU_LIMIT_SPAWN = 50_000;
const CU_LIMIT_PER_CLEANUP = 30_000;

/* Max cleanups per transaction. Each adds 5 account refs + ~30k CU.
 * 8 keeps us well under the 1232-byte tx size cap AND the 1.4M CU
 * cap (8 * 30k = 240k, plus the priority-fee + limit ixs). */
const CLEANUPS_PER_TX = 8;

/* Max spawn ixs per transaction. Each adds 10 account refs (~320 bytes)
 * + 9 bytes data + alignment ≈ 350 bytes; tx size cap is 1232 bytes,
 * minus signatures + header + CU budget ixs ≈ 1080 bytes available.
 * 1080 / 350 ≈ 3 spawn ixs per tx safely. At 50k CU each that's 150k —
 * well under the 1.4M cap. */
const SPAWNS_PER_TX = 3;

/* Per-cell biome filter retries before giving up on a placement slot.
 * Cheap (pure compute via `biomeAt`) so we can afford a generous
 * budget — most water/peak cells get rejected in microseconds without
 * an RPC roundtrip. The simulation step below still catches the
 * remaining failure modes (cell already occupied, out-of-range corner
 * cases) at ~50ms each. */
const MAX_BIOME_RETRIES = 200;

/* Priority fee in micro-lamports per CU. 0 on localnet (no congestion)
 * — production should read from env so the operator can bump in a
 * congestion spike without redeploying. */
const CU_PRICE_MICROLAMPORTS = Number(process.env.CRON_CU_PRICE_MICROLAMPORTS ?? "0");

interface CitySummary {
  cityId: number;
  spawned: number;
  cleaned: number;
  pending: number;
  errors: number;
}

async function handle(req: Request): Promise<Response> {
  const authResult = checkAuth(req);
  if (authResult) return authResult;

  const connection = serverConnection();
  const client = serverClient();
  const ge = gameEnginePda();
  const authority = await gameAuthorityKeypair();

  let cities: Awaited<ReturnType<typeof client.fetchAllCities>>;
  try {
    cities = await client.fetchAllCities();
  } catch (err) {
    return Response.json(
      { ok: false, error: "fetchAllCities failed", detail: String(err) },
      { status: 502 },
    );
  }
  const startedAt = Date.now();

  /* Kingdom-aware level ceiling, computed once per run from the live player
   * population and applied to every auto-spawn this run. */
  const kingdomLevelCap = await computeKingdomLevelCap(client);

  /* All cities run in parallel — they don't share state on chain, and
   * `Promise.allSettled` here cuts the wall time from 23×latency to just
   * the single slowest city while keeping one failing city from poisoning
   * the whole response. Each city's spawn loop still runs SEQUENTIAL
   * within the city because successive spawns share an incrementing
   * `encounterIndex` (parallel-within-city would collide on the same
   * encounter PDA). */
  const settled = await Promise.allSettled(
    cities.map(({ account: city }) =>
      processCity({ city, connection, authority, gameEngine: ge, client, kingdomLevelCap }),
    ),
  );
  const summaries: CitySummary[] = settled.map((s, i) => {
    if (s.status === "fulfilled") return s.value;
    const cityId = cities[i]?.account.cityId ?? -1;
    console.error(`[cron/encounters] city ${cityId} crashed:`, s.reason);
    return { cityId, spawned: 0, cleaned: 0, pending: 0, errors: 1 };
  });

  const totals = summaries.reduce(
    (acc, s) => ({
      spawned: acc.spawned + s.spawned,
      cleaned: acc.cleaned + s.cleaned,
      pending: acc.pending + s.pending,
      errors: acc.errors + s.errors,
    }),
    { spawned: 0, cleaned: 0, pending: 0, errors: 0 },
  );

  return Response.json({
    ok: true,
    durationMs: Date.now() - startedAt,
    kingdomLevelCap,
    totals,
    cities: summaries,
  });
}

export const GET = handle;
export const POST = handle;

/* Auth gate. Returns a Response to abort, or null to proceed.
 *
 * Rules:
 * - `CRON_SECRET` unset AND `NODE_ENV !== 'development'` → 500 (refuse to
 *   run with an open auth surface). Empty string counts as unset so a
 *   preview env with `CRON_SECRET=` literal falls into the same trap.
 * - Bearer compared with `timingSafeEqual` to avoid leaking the prefix
 *   length via response-time delta. */
function checkAuth(req: Request): Response | null {
  const auth = req.headers.get("authorization") ?? "";
  const secret = process.env.CRON_SECRET ?? "";
  const isDev = process.env.NODE_ENV === "development";

  if (!secret) {
    if (isDev) return null; // dev convenience
    return new Response("CRON_SECRET not configured", { status: 500 });
  }

  const expected = `Bearer ${secret}`;
  const got = Buffer.from(auth);
  const want = Buffer.from(expected);
  if (got.length !== want.length || !timingSafeEqual(got, want)) {
    return new Response("unauthorized", { status: 401 });
  }
  return null;
}

/* Compute the kingdom-aware encounter level ceiling from the live player
 * population. Fetches every player in the kingdom (one getProgramAccounts
 * call), takes the KINGDOM_LEVEL_PERCENTILE level plus KINGDOM_LEVEL_HEADROOM,
 * and clamps to [MIN, MAX]. Returns MIN on an empty kingdom or a fetch error
 * (fail low so a transient RPC blip can't seed high-level encounters). */
async function computeKingdomLevelCap(client: ReturnType<typeof serverClient>): Promise<number> {
  let players: Awaited<ReturnType<typeof client.fetchAllPlayers>>;
  try {
    players = await client.fetchAllPlayers();
  } catch {
    return MIN_KINGDOM_LEVEL_CAP;
  }

  const levels = players
    .map((p) => p.account.level)
    .filter((l) => l > 0)
    .sort((a, b) => a - b);
  if (levels.length === 0) return MIN_KINGDOM_LEVEL_CAP;

  const idx = Math.min(levels.length - 1, Math.floor(levels.length * KINGDOM_LEVEL_PERCENTILE));
  const cap = levels[idx]! + KINGDOM_LEVEL_HEADROOM;
  return Math.max(MIN_KINGDOM_LEVEL_CAP, Math.min(MAX_KINGDOM_LEVEL_CAP, cap));
}

/* Process a single city: top-up alive encounters per rarity, then
 * clean up expired ones. Two RPC reads up-front (city already in the
 * caller's snapshot, plus `fetchEncountersInCity`), then a mix of
 * cheap simulations (placement scouts) + a few real txs (the
 * successful spawns + batched cleanups). */
async function processCity(args: {
  city: Awaited<ReturnType<ReturnType<typeof serverClient>["fetchAllCities"]>>[number]["account"];
  connection: Connection;
  authority: Keypair;
  gameEngine: PublicKey;
  client: ReturnType<typeof serverClient>;
  kingdomLevelCap: number;
}): Promise<CitySummary> {
  const { city, connection, authority, gameEngine, client, kingdomLevelCap } = args;
  const cityId = city.cityId;
  const summary: CitySummary = {
    cityId,
    spawned: 0,
    cleaned: 0,
    pending: 0,
    errors: 0,
  };

  let encounters: Awaited<ReturnType<typeof client.fetchEncountersInCity>>;
  try {
    encounters = await client.fetchEncountersInCity(cityId);
  } catch {
    summary.errors++;
    return summary;
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const aliveCountsByRarity: Record<number, number> = {};
  for (const { account: e } of encounters) {
    const aliveOnChain = e.health !== 0n && Number(e.despawnAt) > nowSec;
    if (!aliveOnChain) continue;
    aliveCountsByRarity[e.rarity] = (aliveCountsByRarity[e.rarity] ?? 0) + 1;
  }

  let nextIndex = Number(city.totalEncountersSpawned);
  /* baseLat/baseLong are passed to the chain as i32 grid units, NOT
   * degrees. The chain reads grid_lat/long as i32 and divides by
   * GRID_PRECISION (10000) to recover the f64 lat/long. We must scale
   * here so `contains_coord` lands the spawn inside the city's AABB. */
  const baseLat = Math.round(city.latitude * GRID_PRECISION);
  const baseLong = Math.round(city.longitude * GRID_PRECISION);
  /* Biome knobs are constant per city (derived from CityAccount fields
   * that don't change between cron runs). Cache once so `biomeAt` is a
   * pure computation per candidate cell. */
  const knobs = biomeKnobsFromCity(city);
  /* Clamp random placement to the city's actual plot bounds so we
   * don't burn retries on guaranteed `OUT_OF_RANGE` rejections. The
   * chain validates `|ox| ≤ widthGrid/2, |oy| ≤ heightGrid/2`. */
  const plotHalfW = Math.floor(city.widthGrid / 2);
  const plotHalfH = Math.floor(city.heightGrid / 2);

  /* Refresh `nextIndex` from chain when we detect a stale counter (e.g.
   * a concurrent cron run already bumped totalEncountersSpawned past
   * us — chain returns InvalidPDA on the encounter PDA derivation). */
  const refetchNextIndex = async (): Promise<number | null> => {
    try {
      const [cityPda] = await deriveCityPda(gameEngine, cityId);
      const info = await connection.getAccountInfo(cityPda, "confirmed");
      if (!info?.data) return null;
      const fresh = deserializeCity(info.data);
      return Number(fresh.totalEncountersSpawned);
    } catch {
      return null;
    }
  };

  /* Per-rarity spawn loop. Each rarity gets its OWN batches so a terminal
   * failure for one rarity (e.g. Epic during daytime → WrongTimeForEncounter)
   * doesn't kill spawns for the other rarities in the same cron run. */
  for (const rarity of RARITIES_TO_SPAWN) {
    const target = TARGET_PER_CITY[rarity];
    const have = aliveCountsByRarity[rarity] ?? 0;
    let remaining = Math.max(0, target - have);

    while (remaining > 0) {
      const batchSize = Math.min(remaining, SPAWNS_PER_TX);
      const rarities: EncounterRarity[] = Array(batchSize).fill(rarity);
      const result = await trySpawnBatch({
        connection,
        authority,
        gameEngine,
        cityId,
        startIndex: nextIndex,
        baseLat,
        baseLong,
        plotHalfW,
        plotHalfH,
        knobs,
        biomeSeed: city.biomeSeed >>> 0,
        rarities,
        levelCap: kingdomLevelCap,
        refetchStartIndex: refetchNextIndex,
      });
      summary.spawned += result.placed;
      nextIndex = result.nextStartIndex;
      remaining -= result.placed;
      if (result.terminal) break; // skip to next rarity
      if (result.placed === 0) {
        summary.errors++;
        break;
      }
    }
  }

  /* Cleanup phase — collect every expired encounter, route rent
   * recipient correctly, then batch into multi-ix transactions. */
  const pending: TransactionInstruction[] = [];
  for (const { account: enc } of encounters) {
    if (!isEncounterCleanable(enc, nowSec)) {
      if (nowSec >= Number(enc.despawnAt)) summary.pending++;
      continue;
    }
    // Rent routing + ix build are shared with the CLI crank (SDK
    // buildEncounterCleanupIx) so the two implementations can't drift.
    pending.push(
      await buildEncounterCleanupIx(connection, gameEngine, cityId, enc, authority.publicKey),
    );
  }

  /* Send cleanups in batches — one tx per CLEANUPS_PER_TX so we
   * amortise the ~2 sig + base-fee overhead across many cleanups. */
  for (let i = 0; i < pending.length; i += CLEANUPS_PER_TX) {
    const batch = pending.slice(i, i + CLEANUPS_PER_TX);
    const cuLimit = batch.length * CU_LIMIT_PER_CLEANUP + 10_000;
    const ixs = [
      ComputeBudgetProgram.setComputeUnitLimit({ units: cuLimit }),
      ...(CU_PRICE_MICROLAMPORTS > 0
        ? [
            ComputeBudgetProgram.setComputeUnitPrice({
              microLamports: CU_PRICE_MICROLAMPORTS,
            }),
          ]
        : []),
      ...batch,
    ];
    try {
      const tx = new Transaction().add(...ixs);
      await sendAndConfirmTransaction(connection, tx, [authority], {
        commitment: "confirmed",
      });
      summary.cleaned += batch.length;
    } catch {
      summary.errors++;
    }
  }

  return summary;
}

/* Pick a random grid cell inside the city's plot bounds that passes
 * the biome filter — water / peak cells are rejected client-side
 * (pure `biomeAt` computation, no RPC). Returns null if the budget
 * is exhausted (e.g., a city centre that sits on a giant lake).
 *
 * The chain still validates the cell server-side (CELL_OCCUPIED,
 * range edge cases), so this is a pre-filter — not the source of
 * truth — but it eliminates the dominant failure mode (random cell
 * landed on water) without any tx work. */
function pickPassableCell(args: {
  baseLat: number;
  baseLong: number;
  plotHalfW: number;
  plotHalfH: number;
  biomeSeed: number;
  knobs: BiomeKnobs;
}): { gridLat: number; gridLong: number } | null {
  for (let i = 0; i < MAX_BIOME_RETRIES; i++) {
    /* Uniform in ±plotHalf bounds → can't trigger OUT_OF_RANGE. */
    const ox = Math.floor(Math.random() * (args.plotHalfW * 2 + 1)) - args.plotHalfW;
    const oy = Math.floor(Math.random() * (args.plotHalfH * 2 + 1)) - args.plotHalfH;
    const biome = biomeAt(args.biomeSeed, ox, oy, args.knobs);
    if (!isPassableBiome(biome)) continue;
    return {
      gridLat: args.baseLat + oy,
      gridLong: args.baseLong + ox,
    };
  }
  return null;
}

/* Batch spawn — packs up to SPAWNS_PER_TX (3) spawn ixs into a single
 * transaction. For each slot, picks a biome-passable cell client-side
 * (no RPC), then simulates the whole batched tx ONCE; if it passes,
 * sends. If the simulation fails, we re-pick cells and retry the
 * batch a few times — the dominant cause of post-biome simulation
 * failure is CELL_OCCUPIED (another spawner raced us), which a new
 * random cell typically resolves.
 *
 * `refetchStartIndex` is invoked on InvalidPDA, which fires when a
 * concurrent cron run already bumped `totalEncountersSpawned` past
 * our cached value. Returning the next `startIndex` lets the caller
 * keep its counter monotonic across batches without re-reading the
 * whole city object.
 *
 * Returns the count of spawn ixs that successfully landed plus the
 * next index to use. A terminal chain error (city limit, wrong time
 * of day for a rarity) stops the caller's queue for THIS rarity. */
async function trySpawnBatch(args: {
  connection: Connection;
  authority: Keypair;
  gameEngine: PublicKey;
  cityId: number;
  startIndex: number;
  baseLat: number;
  baseLong: number;
  plotHalfW: number;
  plotHalfH: number;
  knobs: BiomeKnobs;
  biomeSeed: number;
  rarities: EncounterRarity[];
  levelCap: number;
  refetchStartIndex: () => Promise<number | null>;
}): Promise<{ placed: number; terminal: boolean; nextStartIndex: number }> {
  if (args.rarities.length === 0) {
    return { placed: 0, terminal: false, nextStartIndex: args.startIndex };
  }

  const cuIxs: TransactionInstruction[] = [
    ComputeBudgetProgram.setComputeUnitLimit({
      units: CU_LIMIT_SPAWN * args.rarities.length + 10_000,
    }),
  ];
  if (CU_PRICE_MICROLAMPORTS > 0) {
    cuIxs.push(
      ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: CU_PRICE_MICROLAMPORTS,
      }),
    );
  }

  /* Re-pick the whole batch up to MAX_BATCH_RETRIES times if simulation
   * fails. The biome filter already eliminates impassable cells; the
   * remaining failure modes are mostly transient (cell occupied), so
   * a fresh pick usually fixes it. */
  const MAX_BATCH_RETRIES = 8;
  let startIndex = args.startIndex;

  for (let attempt = 0; attempt < MAX_BATCH_RETRIES; attempt++) {
    const spawnIxs: TransactionInstruction[] = [];
    let cellPickFailed = false;
    for (let i = 0; i < args.rarities.length; i++) {
      const cell = pickPassableCell({
        baseLat: args.baseLat,
        baseLong: args.baseLong,
        plotHalfW: args.plotHalfW,
        plotHalfH: args.plotHalfH,
        biomeSeed: args.biomeSeed,
        knobs: args.knobs,
      });
      if (!cell) {
        /* City has no passable cells within budget — entire batch
         * unplaceable. Treat as a non-terminal miss; caller may try
         * again next cron run. */
        cellPickFailed = true;
        break;
      }
      spawnIxs.push(
        await createSpawnEncounterInstruction(
          {
            payer: args.authority.publicKey,
            playerOwner: args.authority.publicKey,
            gameEngine: args.gameEngine,
            cityId: args.cityId,
            encounterIndex: startIndex + i,
            gridLat: cell.gridLat,
            gridLong: cell.gridLong,
          },
          { encounterType: args.rarities[i]!, levelCap: args.levelCap },
        ),
      );
    }
    if (cellPickFailed) {
      return { placed: 0, terminal: false, nextStartIndex: startIndex };
    }

    /* Fresh blockhash per attempt — the previous one may have expired
     * during MAX_BIOME_RETRIES cell picks + a chain of failed sims. */
    let blockhash: Awaited<ReturnType<typeof args.connection.getLatestBlockhash>>["blockhash"];
    try {
      ({ blockhash } = await args.connection.getLatestBlockhash());
    } catch {
      /* RPC blip — treat as non-terminal. */
      return { placed: 0, terminal: false, nextStartIndex: startIndex };
    }

    const tx = new Transaction().add(...cuIxs, ...spawnIxs);
    tx.feePayer = args.authority.publicKey;
    tx.recentBlockhash = blockhash;

    let sim: Awaited<ReturnType<typeof args.connection.simulateTransaction>>;
    try {
      sim = await args.connection.simulateTransaction(tx, [args.authority]);
    } catch {
      return { placed: 0, terminal: false, nextStartIndex: startIndex };
    }
    if (sim.value.err) {
      const code = extractCustomErrorCodeFromLogs(sim.value.logs);
      if (code === ERR_INVALID_PDA) {
        /* Concurrent run bumped the on-chain counter past our cached
         * startIndex. Refetch and try again with the new base. */
        const fresh = await args.refetchStartIndex();
        if (fresh != null && fresh > startIndex) {
          startIndex = fresh;
          continue;
        }
        /* Couldn't get a fresher counter — bail rather than spin. */
        return { placed: 0, terminal: false, nextStartIndex: startIndex };
      }
      if (code != null && RETRYABLE_SPAWN_ERRORS.has(code)) {
        /* Some cell in the batch raced or landed on a borderline
         * cell the biome filter missed — re-pick and retry. */
        continue;
      }
      /* Non-spatial error (time-of-day, city limit) — terminal for
       * this rarity's queue. */
      return { placed: 0, terminal: true, nextStartIndex: startIndex };
    }

    /* Simulation passed for ALL ixs — send. Solana runtime processes
     * ixs in order with intra-tx state updates, so the chain sees
     * spawn[0] increment city.totalEncountersSpawned before spawn[1]
     * checks its expected index. */
    try {
      const sendTx = new Transaction().add(...cuIxs, ...spawnIxs);
      await sendAndConfirmTransaction(args.connection, sendTx, [args.authority], {
        commitment: "confirmed",
      });
      return {
        placed: spawnIxs.length,
        terminal: false,
        nextStartIndex: startIndex + spawnIxs.length,
      };
    } catch {
      /* Send failed (race against another spawner, blockhash expired).
       * Whole batch lost — next cron run retries. */
      return { placed: 0, terminal: false, nextStartIndex: startIndex };
    }
  }
  /* Exhausted batch retries — couldn't find a clean set of cells.
   * Non-terminal; next cron picks new cells. */
  return { placed: 0, terminal: false, nextStartIndex: startIndex };
}

/* Pull a Solana custom-error code out of the `logs` field returned by
 * `simulateTransaction`. Programs emit `Program ... failed: custom
 * program error: 0x1908` (hex) on a `ProgramError::Custom(n)` return.
 * Returns the decoded number or null if no match. */
function extractCustomErrorCodeFromLogs(logs: string[] | null | undefined): number | null {
  if (!logs) return null;
  for (const line of logs) {
    const m = line.match(/custom program error: 0x([0-9a-fA-F]+)/i);
    if (m) return parseInt(m[1]!, 16);
  }
  return null;
}
