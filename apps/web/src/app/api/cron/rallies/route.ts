import "server-only";
import {
  PROGRAM_ID,
  RALLY_ACCOUNT_SIZE,
  deserializeRally,
  createRallyCloseInstruction,
  RallyStatus,
} from "novus-mundus-sdk";
import { runCrank, type CrankItem } from "@/lib/server/cron";

export const runtime = "nodejs";

/** Close completed/cancelled rallies once everyone is home (Ix 67). */
const handle = (req: Request) =>
  runCrank(req, "rallies", async ({ connection }) => {
    const accounts = await connection.getProgramAccounts(PROGRAM_ID, {
      commitment: "confirmed",
      filters: [{ dataSize: RALLY_ACCOUNT_SIZE }],
    });
    const items: CrankItem[] = [];
    for (const { account, pubkey } of accounts) {
      let rally;
      try {
        rally = deserializeRally(account.data);
      } catch {
        continue;
      }
      const closeable =
        (rally.status === RallyStatus.Completed || rally.status === RallyStatus.Cancelled) &&
        rally.returnedCount >= rally.participantCount;
      if (!closeable) continue;
      items.push({
        ix: await createRallyCloseInstruction({ rally: pubkey, leaderOwner: rally.creator }),
        label: `rally ${pubkey.toBase58().slice(0, 8)}..`,
      });
    }
    return items;
  });

export const GET = handle;
export const POST = handle;
