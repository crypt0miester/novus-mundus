import "server-only";
import {
  PROGRAM_ID,
  CORE_SIZE,
  deserializePlayer,
  createDowngradeExpiredInstruction,
} from "novus-mundus-sdk";
import { runCrank, type CrankItem } from "@/lib/server/cron";

export const runtime = "nodejs";

/** Downgrade expired subscriptions to the free tier (Ix 102). */
const handle = (req: Request) =>
  runCrank(req, "subscriptions", async ({ connection, nowSec }) => {
    const accounts = await connection.getProgramAccounts(PROGRAM_ID, {
      commitment: "confirmed",
      filters: [{ dataSize: CORE_SIZE }],
    });
    const items: CrankItem[] = [];
    for (const { account, pubkey } of accounts) {
      let player;
      try {
        player = deserializePlayer(account.data);
      } catch {
        continue;
      }
      if (player.subscriptionTier > 0 && Number(player.subscriptionEnd) <= nowSec) {
        items.push({
          ix: await createDowngradeExpiredInstruction({ playerAccount: pubkey }),
          label: `player ${pubkey.toBase58().slice(0, 8)}..`,
        });
      }
    }
    return items;
  });

export const GET = handle;
export const POST = handle;
