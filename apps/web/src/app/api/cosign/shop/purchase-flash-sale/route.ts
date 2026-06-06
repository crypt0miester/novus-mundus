import "server-only";
import { NextResponse } from "next/server";
import {
  createPurchaseFlashSaleInstruction,
  deriveFlashSalePda,
  deriveShopItemPda,
  deriveBundlePda,
  parseFlashSale,
  getAssociatedTokenAddressAsync,
} from "novus-mundus-sdk";
import { coSign } from "@/lib/server/cosign";
import { buildOracleCrankIxs } from "@/lib/server/oracle-crank";
import { parseSessionBody, fail } from "@/lib/server/route-helpers";
import { loadTokenPurchaseContext, feedHex } from "@/lib/server/shop-cosign";

export const runtime = "nodejs";

interface FlashSaleBody {
  /** Flash sale id (u64; accepted as a number or decimal string). */
  saleId: number | string;
  tokenMint: string;
  quantity?: number;
}

/**
 * POST /api/cosign/shop/purchase-flash-sale
 *
 * Switchboard-payment flash-sale purchase. Bundles the JIT oracle refresh:
 *
 *   [ed25519-verify, crank_oracle_quote, purchase_flash_sale]
 *
 * Flash sales are SOL-priced, so the token path always needs the oracle. The
 * `item_or_bundle` account is resolved from the on-chain FlashSale (item vs
 * bundle). Non-Switchboard tokens get `NOT_SWITCHBOARD` for the direct path.
 */
export async function POST(req: Request) {
  const parsed = await parseSessionBody<FlashSaleBody>(req);
  if ("error" in parsed) return parsed.error;
  const { owner: buyer, body } = parsed;

  let saleId: bigint;
  try {
    saleId = BigInt(body.saleId);
    if (saleId < 0n) throw new Error("negative");
  } catch {
    return fail("invalid 'saleId'");
  }
  const quantity = body.quantity ?? 1;
  if (!Number.isInteger(quantity) || quantity < 1) {
    return fail("invalid 'quantity'");
  }

  const loaded = await loadTokenPurchaseContext(body.tokenMint);
  if (loaded instanceof NextResponse) return loaded;
  const { ctx, tok, tokenMint } = loaded;

  // Resolve the item-or-bundle account the flash sale points at.
  const [flashSalePda] = await deriveFlashSalePda(ctx.gameEngine, saleId);
  const flashSaleInfo = await ctx.connection.getAccountInfo(flashSalePda);
  const flashSale = flashSaleInfo ? parseFlashSale(flashSaleInfo) : null;
  if (!flashSale) return fail("flash sale not found", 404);
  const [itemOrBundle] = flashSale.isBundle
    ? await deriveBundlePda(ctx.gameEngine, flashSale.itemId)
    : await deriveShopItemPda(ctx.gameEngine, flashSale.itemId);

  try {
    const crankIxs = await buildOracleCrankIxs({
      gameEngine: ctx.gameEngine,
      switchboardQueue: ctx.switchboardQueue,
      feedHashes: [feedHex(ctx.shopConfig.solSwitchboardFeed), tok.tokenFeedHex],
      ed25519IxIndex: ctx.ed25519IxIndex,
    });

    const purchaseIx = await createPurchaseFlashSaleInstruction(
      {
        buyer,
        gameEngine: ctx.gameEngine,
        saleId,
        itemOrBundle,
        treasury: ctx.treasury,
        tokenPayment: {
          allowedToken: tok.allowedTokenPda,
          tokenMint,
          buyerTokenAta: await getAssociatedTokenAddressAsync(tokenMint, buyer),
          treasuryTokenAta: await getAssociatedTokenAddressAsync(tokenMint, ctx.treasury),
          oracleQuote: ctx.oracleQuote,
          switchboardQueue: ctx.switchboardQueue,
        },
      },
      { quantity, paymentType: 2 },
    );

    const transaction = await coSign([...crankIxs, purchaseIx], buyer, [ctx.alt]);
    return NextResponse.json({ transaction });
  } catch (e) {
    console.error("flash sale co-sign failed", e);
    return fail(e instanceof Error ? e.message : "co-sign failed", 500);
  }
}
