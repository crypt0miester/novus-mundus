/**
 * End-to-end proof for the cosmetics flow:
 *   1. Player buys shop item #100 (Vanguard's Mark badge, item_type=1003)
 *   2. Chain `fulfill_item` flips owned_badges bit 3 + unlocks EXT_COSMETICS
 *   3. Player calls cosmetic::equip with {kind: Badge, id: 3}
 *   4. We read the player account and verify equipped_badge === 3
 *
 * Usage: bun run scripts/test-cosmetic-flow.ts [<player-keypair.json>]
 * Defaults to keys/players/player-1045.json (the one create-player --tier beginner just made).
 */

import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  Transaction,
} from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";

import {
  CosmeticKind,
  createEquipCosmeticInstruction,
  createPurchaseItemInstruction,
  deriveGameEnginePda,
  derivePlayerPda,
  derivePlayerPurchasePda,
  deriveShopItemPda,
  parsePlayer,
} from "../src/index";

const RPC = "http://127.0.0.1:8899";
const KINGDOM_ID = 0;
const ITEM_ID = 100;
const BADGE_ID = 3;

function loadKeypair(p: string): Keypair {
  const raw = JSON.parse(fs.readFileSync(p, "utf-8"));
  return Keypair.fromSecretKey(new Uint8Array(raw));
}

async function main() {
  const playerKp = loadKeypair(
    process.argv[2] ??
      path.join(__dirname, "..", "keys", "players", "player-1045.json"),
  );
  const conn = new Connection(RPC, "confirmed");

  const [gameEngine] = deriveGameEnginePda(KINGDOM_ID);
  const treasury = loadKeypair(
    path.join(__dirname, "..", "keys", "treasury.json"),
  ).publicKey;
  const [playerPda] = derivePlayerPda(gameEngine, playerKp.publicKey);

  const [playerPurchasePda] = derivePlayerPurchasePda(playerKp.publicKey, ITEM_ID);
  const [shopItemPda] = deriveShopItemPda(gameEngine, ITEM_ID);

  console.log("[cosmetic-flow]");
  console.log("  player wallet :", playerKp.publicKey.toBase58());
  console.log("  player PDA    :", playerPda.toBase58());
  console.log("  game engine   :", gameEngine.toBase58());
  console.log("  treasury      :", treasury.toBase58());
  console.log("  shopItem PDA  :", shopItemPda.toBase58());
  console.log("  playerPurchase PDA:", playerPurchasePda.toBase58());

  // Sanity check: chain has the shop item?
  {
    const info = await conn.getAccountInfo(shopItemPda);
    console.log("  shopItem exists:", info !== null, info ? `(${info.data.length}B)` : "");
  }

  // BEFORE: inspect the player's cosmetics state.
  {
    const info = await conn.getAccountInfo(playerPda);
    if (!info) throw new Error("Player PDA does not exist — run `novus create-player --tier beginner` first.");
    const pre = parsePlayer(info)!;
    console.log("[before]");
    console.log("  extensions      :", pre.extensions.toString(2).padStart(7, "0"), "(0b)");
    console.log("  equipped_badge  :", pre.equippedBadge);
    console.log("  owned_badges    :", pre.ownedBadges.toString(2));
  }

  // ── Step 1: buy the badge ─────────────────────────────────────
  console.log("[buy] item #" + ITEM_ID + " (Vanguard's Mark, item_type=1003)…");
  const buyIx = createPurchaseItemInstruction(
    {
      buyer: playerKp.publicKey,
      gameEngine,
      itemId: ITEM_ID,
      treasury,
    },
    { quantity: 1, paymentType: 0 },
  );
  const buyTx = new Transaction()
    .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }))
    .add(buyIx);
  const buySig = await conn.sendTransaction(buyTx, [playerKp], { skipPreflight: false });
  await conn.confirmTransaction(buySig, "confirmed");
  console.log("  ✓ purchase sig :", buySig);

  // ── Step 2: equip the badge ───────────────────────────────────
  console.log("[equip] kind=Badge id=" + BADGE_ID + "…");
  const equipIx = createEquipCosmeticInstruction(
    { owner: playerKp.publicKey, gameEngine },
    { kind: CosmeticKind.Badge, id: BADGE_ID },
  );
  const equipTx = new Transaction()
    .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 60_000 }))
    .add(equipIx);
  const equipSig = await conn.sendTransaction(equipTx, [playerKp], { skipPreflight: false });
  await conn.confirmTransaction(equipSig, "confirmed");
  console.log("  ✓ equip sig    :", equipSig);

  // AFTER: re-inspect.
  {
    const info = await conn.getAccountInfo(playerPda);
    if (!info) throw new Error("Player PDA missing post-equip — RPC race?");
    const post = parsePlayer(info);
    if (!post) throw new Error("Failed to parse player account post-equip");
    console.log("[after]");
    console.log("  extensions      :", post.extensions.toString(2).padStart(7, "0"), "(0b)");
    console.log("  equipped_badge  :", post.equippedBadge);
    console.log("  owned_badges    :", post.ownedBadges.toString(2));
    if (post.equippedBadge !== BADGE_ID) {
      throw new Error(`equipped_badge ${post.equippedBadge} ≠ ${BADGE_ID}`);
    }
    if (post.ownedBadges.testn(BADGE_ID) !== true) {
      throw new Error(`owned_badges bit ${BADGE_ID} not set`);
    }
    console.log("[ok] Vanguard's Mark owned + equipped.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
