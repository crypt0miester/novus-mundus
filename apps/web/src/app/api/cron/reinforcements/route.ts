import "server-only";
import {
  PROGRAM_ID,
  REINFORCEMENT_ACCOUNT_SIZE,
  parseReinforcement,
  ReinforcementStatus,
  createProcessArrivalInstruction,
  createProcessReturnInstruction,
  derivePlayerPda,
  deriveEstatePda,
} from "novus-mundus-sdk";
import { runCrank, type CrankItem } from "@/lib/server/cron";

export const runtime = "nodejs";

/** Process reinforcement arrivals (Ix 191) and returns (Ix 194) once timers elapse. */
const handle = (req: Request) =>
  runCrank(req, "reinforcements", async ({ connection, gameEngine, nowSec }) => {
    const accounts = await connection.getProgramAccounts(PROGRAM_ID, {
      commitment: "confirmed",
      filters: [{ dataSize: REINFORCEMENT_ACCOUNT_SIZE }],
    });
    const items: CrankItem[] = [];
    for (const { account, pubkey } of accounts) {
      const r = parseReinforcement(account);
      if (!r) continue;

      if (r.status === ReinforcementStatus.Traveling && nowSec >= Number(r.arrivesAt)) {
        const [destinationPlayer] = await derivePlayerPda(gameEngine, r.destination);
        items.push({
          ix: createProcessArrivalInstruction({ reinforcement: pubkey, destinationPlayer }),
          label: `arrival ${pubkey.toBase58().slice(0, 8)}..`,
        });
        continue;
      }

      const returnsAt = Number(r.returnStartedAt) + r.returnDuration;
      if (r.status === ReinforcementStatus.Returning && r.returnStartedAt > 0n && nowSec >= returnsAt) {
        const [senderPlayer] = await derivePlayerPda(gameEngine, r.sender);
        const [estateAccount] = await deriveEstatePda(senderPlayer);
        items.push({
          ix: createProcessReturnInstruction({
            reinforcement: pubkey,
            senderPlayer,
            senderOwner: r.sender,
            estateAccount,
          }),
          label: `return ${pubkey.toBase58().slice(0, 8)}..`,
        });
      }
    }
    return items;
  });

export const GET = handle;
export const POST = handle;
