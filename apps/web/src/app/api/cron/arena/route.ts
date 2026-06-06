import "server-only";
import {
  PROGRAM_ID,
  ARENA_SEASON_ACCOUNT_SIZE,
  parseArenaSeason,
  createCloseSeasonInstruction,
} from "novus-mundus-sdk";
import { runCrank, type CrankItem } from "@/lib/server/cron";

export const runtime = "nodejs";

/** Close arena seasons past their claim deadline (Ix 236). */
const handle = (req: Request) =>
  runCrank(req, "arena", async ({ connection, gameEngine, nowSec }) => {
    const accounts = await connection.getProgramAccounts(PROGRAM_ID, {
      commitment: "confirmed",
      filters: [{ dataSize: ARENA_SEASON_ACCOUNT_SIZE }],
    });
    const items: CrankItem[] = [];
    for (const { account } of accounts) {
      const s = parseArenaSeason(account);
      if (!s || Number(s.claimDeadline) > nowSec) continue;
      items.push({
        ix: await createCloseSeasonInstruction({
          seasonAuthority: s.authority,
          gameEngine,
          seasonId: s.seasonId,
          cityId: s.cityId,
        }),
        label: `season ${s.seasonId} (city ${s.cityId})`,
      });
    }
    return items;
  });

export const GET = handle;
export const POST = handle;
