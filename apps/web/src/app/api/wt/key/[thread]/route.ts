import "server-only";
import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import {
  WtScope,
  derivePlayerPda,
  deriveTeamSlotPda,
  deriveRallyParticipantPda,
  deriveGarrisonPda,
  deriveDmThreadPda,
  parsePlayer,
  parseTeam,
  parseTeamMemberSlot,
  parseRally,
  parseRallyParticipant,
  parseCastle,
  parseGarrisonContribution,
} from "novus-mundus-sdk";
import { rateLimited } from "@/lib/server/rate-limit";
import { fail, requireSession } from "@/lib/server/route-helpers";
import { serverClient, serverConnection } from "@/lib/server/game-authority";
import { deriveThreadKey } from "@/lib/server/war-table";

export const runtime = "nodejs";

/**
 * GET /api/wt/key/<threadBase58>?scope=<0..5>&from_version=<n>&peer=<playerPdaBase58?>
 *
 * Serves the war-table thread keys a SIWS-authenticated caller is entitled to.
 * The master secret stays server-side; this route derives per-version keys and
 * hands back only the versions the caller can legitimately read.
 *
 * Join-gate (BC4): the caller's `joined_at_epoch` is read from the correct
 * per-scope membership account, all of which are derivable server-side from
 * `thread` + the session wallet (and `peer` for DM). The client-supplied
 * `from_version` can only RAISE the floor, never lower it below joinedAtEpoch,
 * so a caller can never obtain a key for an epoch in which they were not a
 * member. `current_version` is read from the thread header, never from input.
 *
 * Response: { current_version: number, keys: [{ version: number, k_base64: string }] }
 */

interface KeyEntry {
  version: number;
  k_base64: string;
}

interface KeyResponse {
  current_version: number;
  keys: KeyEntry[];
}

// A served range that never exceeds the chain-derived [joinedAtEpoch..currentEpoch]
// window. from_version can only raise the floor.
function serveRange(
  threadPda: PublicKey,
  joinedAtEpoch: number,
  currentEpoch: number,
  fromVersion: number,
): KeyResponse {
  const pdaBytes = threadPda.toBytes();
  const floor = Math.max(fromVersion, joinedAtEpoch);
  const keys: KeyEntry[] = [];
  for (let v = floor; v <= currentEpoch; v += 1) {
    const k = deriveThreadKey(pdaBytes, v);
    keys.push({ version: v, k_base64: Buffer.from(k).toString("base64") });
  }
  return { current_version: currentEpoch, keys };
}

function parsePubkey(raw: string | null): PublicKey | null {
  if (!raw) return null;
  try {
    return new PublicKey(raw);
  } catch {
    return null;
  }
}

function parseNonNegativeInt(raw: string | null): number | null {
  if (raw === null || raw === "") return 0;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) return null;
  return n;
}

export async function GET(req: Request, ctx: { params: Promise<{ thread: string }> }) {
  const limited = await rateLimited(req);
  if (limited) return limited;

  const session = requireSession(req);
  if ("error" in session) return session.error;
  const wallet = session.owner;

  const { thread } = await ctx.params;
  const threadPda = parsePubkey(thread);
  if (!threadPda) return fail("invalid thread pubkey", 400);

  const url = new URL(req.url);
  const scopeRaw = url.searchParams.get("scope");
  const scopeNum = scopeRaw === null ? NaN : Number(scopeRaw);
  if (
    !Number.isInteger(scopeNum) ||
    scopeNum < WtScope.Team ||
    scopeNum > WtScope.Public
  ) {
    return fail("invalid 'scope' (expected 0..5)", 400);
  }
  const scope = scopeNum as WtScope;

  const fromVersion = parseNonNegativeInt(url.searchParams.get("from_version"));
  if (fromVersion === null) return fail("invalid 'from_version'", 400);

  const peer = parsePubkey(url.searchParams.get("peer"));

  try {
    const conn = serverConnection();
    const gameEngine = serverClient().gameEngine;
    const callerPlayerPda = (await derivePlayerPda(gameEngine, wallet))[0];

    // Encounter and Public are plaintext, membership-free scopes: there is no
    // key to serve.
    if (scope === WtScope.Encounter || scope === WtScope.Public) {
      const body: KeyResponse = { current_version: 0, keys: [] };
      return NextResponse.json(body);
    }

    if (scope === WtScope.Dm) {
      if (!peer) return fail("DM scope requires a 'peer' player pubkey", 400);
      // Re-derive the pair PDA from the caller's playerPda and the peer's
      // playerPda; reject if it does not match the requested thread. This binds
      // the served key to a conversation the caller is genuinely part of.
      let pairPda: PublicKey;
      try {
        pairPda = (await deriveDmThreadPda(callerPlayerPda, peer))[0];
      } catch {
        return fail("DM thread requires two distinct players", 400);
      }
      if (!pairPda.equals(threadPda)) {
        return fail("not a participant of this DM thread", 403);
      }
      // DM key_version is the constant 1 (no epoch). Serve only version 1.
      const k = deriveThreadKey(threadPda.toBytes(), 1);
      const body: KeyResponse = {
        current_version: 1,
        keys: [{ version: 1, k_base64: Buffer.from(k).toString("base64") }],
      };
      return NextResponse.json(body);
    }

    if (scope === WtScope.Team) {
      const teamInfo = await conn.getAccountInfo(threadPda);
      if (!teamInfo) return fail("team thread not found", 404);
      const team = parseTeam(teamInfo);
      if (!team) return fail("team thread not found", 404);

      const playerInfo = await conn.getAccountInfo(callerPlayerPda);
      const player = playerInfo ? parsePlayer(playerInfo) : null;
      if (!player || !player.team.equals(threadPda)) {
        return fail("not a member of this team", 403);
      }

      const slotPda = (await deriveTeamSlotPda(threadPda, player.teamSlotIndex))[0];
      const slotInfo = await conn.getAccountInfo(slotPda);
      const slot = slotInfo ? parseTeamMemberSlot(slotInfo) : null;
      if (!slot) return fail("not a member of this team", 403);

      const body = serveRange(threadPda, slot.joinedAtEpoch, team.membershipEpoch, fromVersion);
      return NextResponse.json(body);
    }

    if (scope === WtScope.Rally) {
      const rallyInfo = await conn.getAccountInfo(threadPda);
      if (!rallyInfo) return fail("rally thread not found", 404);
      const rally = parseRally(rallyInfo);
      if (!rally) return fail("rally thread not found", 404);

      const rallyId = BigInt(rally.id.toString());
      const participantPda = (await deriveRallyParticipantPda(
        gameEngine,
        rally.creator,
        rallyId,
        wallet,
      ))[0];
      const participantInfo = await conn.getAccountInfo(participantPda);
      const participant = participantInfo ? parseRallyParticipant(participantInfo) : null;
      if (!participant) return fail("not a participant of this rally", 403);

      const body = serveRange(
        threadPda,
        participant.joinedAtEpoch,
        rally.membershipEpoch,
        fromVersion,
      );
      return NextResponse.json(body);
    }

    // scope === WtScope.Castle
    const castleInfo = await conn.getAccountInfo(threadPda);
    if (!castleInfo) return fail("castle thread not found", 404);
    const castle = parseCastle(castleInfo);
    if (!castle) return fail("castle thread not found", 404);

    const garrisonPda = (await deriveGarrisonPda(threadPda, callerPlayerPda))[0];
    const garrisonInfo = await conn.getAccountInfo(garrisonPda);
    const garrison = garrisonInfo ? parseGarrisonContribution(garrisonInfo) : null;
    if (garrison) {
      const body = serveRange(
        threadPda,
        garrison.joinedAtEpoch,
        castle.membershipEpoch,
        fromVersion,
      );
      return NextResponse.json(body);
    }

    // King reads full history (joinedAtEpoch = 0). Court access requires a
    // persistent court-position read, which is deferred with the castle web
    // embed (O6); king-only is the v1 castle non-garrison branch.
    if (castle.king.equals(callerPlayerPda)) {
      const body = serveRange(threadPda, 0, castle.membershipEpoch, fromVersion);
      return NextResponse.json(body);
    }

    return fail("not a member of this castle", 403);
  } catch (e) {
    console.error("war-table key fetch failed", e);
    return fail("the war-table key service is unavailable", 503, "SERVICE_DOWN");
  }
}
