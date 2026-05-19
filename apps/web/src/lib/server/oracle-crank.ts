import "server-only";
import * as sb from "@switchboard-xyz/on-demand";
import { CrossbarClient } from "@switchboard-xyz/common";
import type { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { createCrankOracleQuoteInstruction } from "novus-mundus-sdk";
import { gameAuthorityKeypair, serverConnection } from "./game-authority";

/**
 * Server-side Switchboard On-Demand crank for the bundled-purchase flow.
 *
 * A Switchboard-payment purchase needs a fresh on-chain `OracleQuote`. Rather
 * than a background cron, the crank rides in the same transaction the user
 * signs: `[ed25519-verify, crank_oracle_quote, purchase_item]`. This builds
 * the first two instructions — a fresh oracle-signed quote fetched just in
 * time from the Switchboard gateway, plus the `crank_oracle_quote` instruction
 * (ix 302) that persists it. `crank_oracle_quote` is co-signed by the
 * `game_authority` (the `GAME_AUTHORITY_SECRET_KEY` keypair).
 *
 * The quote covers exactly the two feeds the purchase reads — SOL/USD and the
 * payment token — so the bundle size is constant regardless of how many
 * tokens are whitelisted.
 */
export async function buildOracleCrankIxs(params: {
  /** This kingdom's GameEngine PDA. */
  gameEngine: PublicKey;
  /** The Switchboard On-Demand queue (`shop_config.sol_switchboard_queue`). */
  switchboardQueue: PublicKey;
  /** Switchboard feed hashes (hex) — SOL/USD + the payment token's TOKEN/USD. */
  feedHashes: string[];
  /** Index of the ed25519 instruction in the final transaction. */
  ed25519IxIndex: number;
}): Promise<TransactionInstruction[]> {
  if (params.feedHashes.length === 0 || params.feedHashes.length > 8) {
    throw new Error("oracle crank: expected 1-8 feed hashes");
  }

  const connection = serverConnection();
  const program = await sb.AnchorUtils.loadProgramFromConnection(connection);
  const queue = new sb.Queue(program, params.switchboardQueue);
  const crossbar = CrossbarClient.default();

  // Gateway fetch: the ed25519 verify instruction carrying the oracle-signed
  // quote, positioned at `ed25519IxIndex` within the final transaction.
  const ed25519Ix = await queue.fetchQuoteIx(crossbar, params.feedHashes, {
    variableOverrides: {},
    instructionIdx: params.ed25519IxIndex,
  });

  const crankIx = createCrankOracleQuoteInstruction(
    {
      cranker: gameAuthorityKeypair().publicKey,
      gameEngine: params.gameEngine,
      switchboardQueue: params.switchboardQueue,
    },
    params.ed25519IxIndex,
  );

  return [ed25519Ix, crankIx];
}
