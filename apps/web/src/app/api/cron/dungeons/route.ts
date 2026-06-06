import "server-only";
import {
  currentDungeonWeek,
  deriveDungeonLeaderboardPda,
  createCreateLeaderboardInstruction,
} from "novus-mundus-sdk";
import { runCrank, type CrankItem } from "@/lib/server/cron";

export const runtime = "nodejs";

/** Create this week's leaderboard for each dungeon if missing (Ix 260). */
const handle = (req: Request) =>
  runCrank(req, "dungeons", async ({ connection, client, gameEngine, authority, nowSec }) => {
    const weekNumber = currentDungeonWeek(nowSec);
    const templates = await client.fetchAllDungeonTemplates();
    const items: CrankItem[] = [];
    for (const { account: t } of templates) {
      const [leaderboardPda] = await deriveDungeonLeaderboardPda(gameEngine, t.dungeonId, weekNumber);
      const info = await connection.getAccountInfo(leaderboardPda);
      if (info) continue; // already exists this week
      items.push({
        ix: await createCreateLeaderboardInstruction(
          { payer: authority.publicKey, daoAuthority: authority.publicKey, gameEngine },
          { templateId: t.dungeonId, weekNumber, prizePool: 0 },
        ),
        label: `${t.name} week ${weekNumber}`,
      });
    }
    return items;
  });

export const GET = handle;
export const POST = handle;
