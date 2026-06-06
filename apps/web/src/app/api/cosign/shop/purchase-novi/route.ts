import "server-only";
import { NextResponse } from "next/server";
import {
  createPurchaseNoviInstruction,
  deriveShopConfigPda,
  deriveNoviMintPda,
} from "novus-mundus-sdk";
import { coSign } from "@/lib/server/cosign";
import { buildOracleCrankIxs } from "@/lib/server/oracle-crank";
import { parseSessionBody, fail } from "@/lib/server/route-helpers";
import { loadShopSwitchboardContext, feedHex } from "@/lib/server/shop-cosign";

export const runtime = "nodejs";

interface NoviBody {
  /** Package index 0-4. */
  packageIndex: number;
  /** Slippage ceiling in lamports (u64; number or decimal string). */
  maxLamports: number | string;
}

/**
 * POST /api/cosign/shop/purchase-novi
 *
 * NOVI-pack purchase priced from a Switchboard quote. Unlike the item/flash/
 * bundle routes, NOVI is paid in SOL — the oracle only discovers the SOL→NOVI
 * price (with the DAO undercut). Still bundles the JIT refresh:
 *
 *   [ed25519-verify, crank_oracle_quote, purchase_novi]
 *
 * One quote carries both the SOL/USD and NOVI/USD feeds. Pyth-priced or
 * fallback-priced NOVI needs no server involvement (the client builds those
 * directly); a kingdom without a NOVI Switchboard feed gets `NOT_SWITCHBOARD`.
 */
export async function POST(req: Request) {
  const parsed = await parseSessionBody<NoviBody>(req);
  if ("error" in parsed) return parsed.error;
  const { owner: buyer, body } = parsed;

  if (!Number.isInteger(body.packageIndex) || body.packageIndex < 0 || body.packageIndex > 4) {
    return fail("invalid 'packageIndex' (0-4)");
  }
  let maxLamports: bigint;
  try {
    maxLamports = BigInt(body.maxLamports);
    if (maxLamports <= 0n) throw new Error("non-positive");
  } catch {
    return fail("invalid 'maxLamports'");
  }

  const ctx = await loadShopSwitchboardContext();
  if (ctx instanceof NextResponse) return ctx;

  // NOVI's TOKEN/USD feed lives on the NOVI purchase config, not an AllowedToken.
  const noviFeed = ctx.engine.noviPurchaseConfig.noviSwitchboardFeed;
  if (!noviFeed) {
    return fail(
      "NOVI is not Switchboard-priced — use the direct purchase path",
      400,
      "NOT_SWITCHBOARD",
    );
  }

  const [shopConfigPda] = await deriveShopConfigPda(ctx.gameEngine);
  const [noviMint] = await deriveNoviMintPda();

  try {
    const crankIxs = await buildOracleCrankIxs({
      gameEngine: ctx.gameEngine,
      switchboardQueue: ctx.switchboardQueue,
      feedHashes: [feedHex(ctx.shopConfig.solSwitchboardFeed), feedHex(noviFeed)],
      ed25519IxIndex: ctx.ed25519IxIndex,
    });

    const purchaseIx = await createPurchaseNoviInstruction(
      {
        buyer,
        gameEngine: ctx.gameEngine,
        treasury: ctx.treasury,
        noviMint,
      },
      {
        packageIndex: body.packageIndex,
        maxLamports,
        oracleAccounts: {
          shopConfig: shopConfigPda,
          oracleQuote: ctx.oracleQuote,
          switchboardQueue: ctx.switchboardQueue,
        },
      },
    );

    const transaction = await coSign([...crankIxs, purchaseIx], buyer, [ctx.alt]);
    return NextResponse.json({ transaction });
  } catch (e) {
    console.error("NOVI purchase co-sign failed", e);
    return fail(e instanceof Error ? e.message : "co-sign failed", 500);
  }
}
