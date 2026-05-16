import "server-only";
import { NextResponse } from "next/server";
import type { PublicKey } from "@solana/web3.js";
import { createChooseRelicInstruction, DungeonStatus } from "novus-mundus-sdk";
import { gameAuthorityKeypair } from "@/lib/server/game-authority";
import {
  gameEnginePda,
  getDungeonRun,
  getDungeonTemplate,
} from "@/lib/server/chain";
import { rateLimited } from "@/lib/server/rate-limit";
import { rollRelicOffer } from "@/lib/server/dungeon-logic";
import {
  coSignResponse,
  fail,
  parseOwner,
  parseSessionBody,
} from "@/lib/server/route-helpers";

export const runtime = "nodejs";

/** Resolve the run + the deterministic relic offer, or an error response. */
async function loadOffer(owner: PublicKey) {
  const run = await getDungeonRun(owner);
  if (!run) return { error: fail("no active dungeon run", 409) } as const;
  if (run.status !== DungeonStatus.AwaitingRelic) {
    return { error: fail("the run is not awaiting a relic choice", 409) } as const;
  }

  const template = await getDungeonTemplate(run.dungeonId);
  if (!template) return { error: fail("dungeon template not found", 500) } as const;

  return { run, offer: rollRelicOffer(run, template) } as const;
}

/** GET /api/cosign/dungeon/choose-relic?owner=… — preview the offered relics. */
export async function GET(req: Request) {
  const owner = parseOwner(new URL(req.url).searchParams.get("owner"));
  if ("error" in owner) return owner.error;
  const res = await loadOffer(owner.owner);
  if ("error" in res) return res.error;
  return NextResponse.json({
    relicOptions: res.offer.relicOptions,
    firstRoomType: res.offer.firstRoomType,
  });
}

/** POST /api/cosign/dungeon/choose-relic — co-sign the chosen relic. */
export async function POST(req: Request) {
  const limited = rateLimited(req);
  if (limited) return limited;

  const parsed = await parseSessionBody<{ relicId?: number }>(req);
  if ("error" in parsed) return parsed.error;
  const { owner, body } = parsed;

  const res = await loadOffer(owner);
  if ("error" in res) return res.error;
  const { run, offer } = res;

  const relicId = Number(body.relicId);
  if (!Number.isInteger(relicId) || !offer.relicOptions.includes(relicId)) {
    return fail("'relicId' must be one of the offered options");
  }

  const ix = createChooseRelicInstruction(
    {
      owner,
      gameEngine: gameEnginePda(),
      gameAuthority: gameAuthorityKeypair().publicKey,
    },
    {
      templateId: run.dungeonId,
      relicId,
      firstRoomType: offer.firstRoomType,
      relicOptions: offer.relicOptions,
    },
  );

  return coSignResponse([ix], owner);
}
