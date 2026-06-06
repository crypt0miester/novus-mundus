import "server-only";
import {
  PROGRAM_ID,
  SEASONAL_SALE_ACCOUNT_SIZE,
  parseSeasonalSale,
  DAO_PROMOTION_ACCOUNT_SIZE,
  parseDaoPromotion,
  createActivateSaleInstruction,
} from "novus-mundus-sdk";
import { runCrank, type CrankItem } from "@/lib/server/cron";

export const runtime = "nodejs";

// SeasonalSaleStatus / DAOPromotionStatus: 2 = Ended.
const ENDED = 2;

/** Advance seasonal sales + DAO promotions through their lifecycle (Ix 156). */
const handle = (req: Request) =>
  runCrank(req, "sales", async ({ connection, gameEngine, authority, nowSec }) => {
    const [seasonals, promos] = await Promise.all([
      connection.getProgramAccounts(PROGRAM_ID, {
        commitment: "confirmed",
        filters: [{ dataSize: SEASONAL_SALE_ACCOUNT_SIZE }],
      }),
      connection.getProgramAccounts(PROGRAM_ID, {
        commitment: "confirmed",
        filters: [{ dataSize: DAO_PROMOTION_ACCOUNT_SIZE }],
      }),
    ]);

    const items: CrankItem[] = [];

    for (const { account } of seasonals) {
      const s = parseSeasonalSale(account);
      if (!s || s.status === ENDED) continue;
      if (nowSec < Number(s.startsAt) && nowSec < Number(s.endsAt)) continue;
      items.push({
        ix: await createActivateSaleInstruction(
          { crank: authority.publicKey, gameEngine },
          { saleType: 0, event: s.event },
        ),
        label: `seasonal "${s.name}"`,
      });
    }

    for (const { account } of promos) {
      const p = parseDaoPromotion(account);
      if (!p || p.status === ENDED) continue;
      if (nowSec < Number(p.startsAt) && nowSec < Number(p.endsAt)) continue;
      items.push({
        ix: await createActivateSaleInstruction(
          { crank: authority.publicKey, gameEngine },
          { saleType: 1, proposalId: p.proposalId },
        ),
        label: `dao promo "${p.title}" (#${p.proposalId})`,
      });
    }

    return items;
  });

export const GET = handle;
export const POST = handle;
