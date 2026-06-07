import "server-only";
import {
  CastleStatus,
  castleStatusUpdateDue,
  collectCastleCleanups,
  buildCastleFinalize,
  createUpdateCastleStatusInstruction,
} from "novus-mundus-sdk";
import {
  checkAuth,
  simulateAndSend,
} from "@/lib/server/cron";
import { gameAuthorityKeypair, serverClient } from "@/lib/server/game-authority";
import { gameEnginePda } from "@/lib/server/chain";

export const runtime = "nodejs";

/**
 * Castle transition crank — bespoke (not `runCrank`) because it's a sequential
 * pipeline: per TRANSITIONING castle, send the garrison/court/reward cleanups,
 * wait for them to land, THEN finalize. Shares the scan/build logic with the CLI
 * crank via the SDK (`collectCastleCleanups` / `buildCastleFinalize`).
 */
async function handle(req: Request): Promise<Response> {
  const denied = checkAuth(req);
  if (denied) return denied;

  const client = serverClient();
  const gameEngine = gameEnginePda();
  let authority;
  try {
    authority = await gameAuthorityKeypair();
  } catch (err) {
    return Response.json({ ok: false, name: "castles", error: String(err) }, { status: 500 });
  }
  const crank = authority.publicKey;

  let castles;
  try {
    castles = await client.fetchAllCastles();
  } catch (err) {
    return Response.json(
      { ok: false, name: "castles", error: "fetchAllCastles failed", detail: String(err) },
      { status: 502 },
    );
  }

  let sent = 0;
  let failed = 0;
  const errors: string[] = [];
  const record = (r: { ok: boolean; error?: string }, label: string) => {
    if (r.ok) sent++;
    else {
      failed++;
      if (errors.length < 8) errors.push(`${label}: ${r.error}`);
    }
  };

  // Nudge time-based status transitions (CONTEST->PROTECTED->VULNERABLE), but
  // only for castles whose transition is actually due — update_castle_status
  // errors on a no-op, so blindly poking every castle is one wasted RPC each.
  // The due ones are independent, so fire them concurrently.
  const now = (await client.getBlockTime()) ?? 0;
  const dueStatus = castles.filter(({ account }) => castleStatusUpdateDue(account, now));
  await Promise.all(
    dueStatus.map(async ({ account: castle }) =>
      record(
        await simulateAndSend(
          client,
          authority,
          await createUpdateCastleStatusInstruction({
            caller: crank,
            gameEngine,
            cityId: castle.cityId,
            castleId: castle.castleId,
          }),
        ),
        `status ${castle.cityId}/${castle.castleId}`,
      ),
    ),
  );

  // Ownership-transition pipeline: per TRANSITIONING castle, the cleanups must
  // confirm before finalize (it gates on garrison/court counts == 0), so this
  // stays sequential per castle.
  for (const { pubkey: castlePda, account: castle } of castles) {
    if (castle.status !== CastleStatus.Transitioning) continue;

    const cleanups = await collectCastleCleanups(client, crank, castle, castlePda);
    for (const c of cleanups) {
      record(await simulateAndSend(client, authority, c.ix), c.label);
    }

    const fin = await buildCastleFinalize(client, crank, castlePda, now);
    if (fin) record(await simulateAndSend(client, authority, fin.ix), fin.label);
  }

  return Response.json({ ok: true, name: "castles", sent, failed, errors });
}

export const GET = handle;
export const POST = handle;
