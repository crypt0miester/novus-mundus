import "server-only";
import {
  PROGRAM_ID,
  EVENT_ACCOUNT_SIZE,
  parseEvent,
  EventStatus,
  createFinalizeEventInstruction,
} from "novus-mundus-sdk";
import { runCrank, type CrankItem } from "@/lib/server/cron";

export const runtime = "nodejs";

/** Finalize events past their end time so prizes can be claimed (Ix 82). */
const handle = (req: Request) =>
  runCrank(req, "events", async ({ connection, gameEngine, nowSec }) => {
    const accounts = await connection.getProgramAccounts(PROGRAM_ID, {
      commitment: "confirmed",
      filters: [{ dataSize: EVENT_ACCOUNT_SIZE }],
    });
    const items: CrankItem[] = [];
    for (const { account } of accounts) {
      const e = parseEvent(account);
      if (!e || e.status !== EventStatus.Active || Number(e.endTime) > nowSec) continue;
      items.push({
        ix: await createFinalizeEventInstruction({ gameEngine, eventId: Number(e.id) }),
        label: `event ${e.id}`,
      });
    }
    return items;
  });

export const GET = handle;
export const POST = handle;
