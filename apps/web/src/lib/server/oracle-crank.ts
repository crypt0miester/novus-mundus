import "server-only";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { createCrankOracleQuoteInstruction } from "novus-mundus-sdk";
import { gameAuthorityKeypair, serverConnection } from "./game-authority";

// The Switchboard On-Demand SDK runs on web3.js v1 (its own resolved dependency),
// while the app is on v3. Its TransactionInstruction carries v1 `PublicKey`s,
// which the v3 transaction builder rejects, so rebuild it as a v3 instruction via
// raw bytes before composing it with the rest of the (v3) transaction.
function toV3Instruction(ix: {
  programId: { toBytes(): Uint8Array };
  keys: { pubkey: { toBytes(): Uint8Array }; isSigner: boolean; isWritable: boolean }[];
  data: Uint8Array;
}): TransactionInstruction {
  return new TransactionInstruction({
    programId: new PublicKey(ix.programId.toBytes()),
    keys: ix.keys.map((k) => ({
      pubkey: new PublicKey(k.pubkey.toBytes()),
      isSigner: k.isSigner,
      isWritable: k.isWritable,
    })),
    data: Buffer.from(ix.data),
  });
}

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

  // Import the Switchboard SDK lazily: it is heavy and only needed when a quote
  // is actually fetched (not during Next's build-time page-data collection), and
  // it is listed in next.config `serverExternalPackages` so Node requires it at
  // runtime rather than the bundler trying to bundle its deep v1 ESM.
  const sb = await import("@switchboard-xyz/on-demand");
  const { CrossbarClient } = await import("@switchboard-xyz/common");

  // v1/v3 boundary: serverConnection() is a v3 Connection (the 3.0.0-rc.1 compat
  // shim, which exposes the v1 method surface) and switchboardQueue is a v3
  // PublicKey; both are runtime-compatible with the SDK's v1 expectations, so we
  // cast at the boundary.
  type SbConn = Parameters<typeof sb.AnchorUtils.loadProgramFromConnection>[0];
  type SbPk = ConstructorParameters<typeof sb.Queue>[1];
  const connection = serverConnection();
  const program = await sb.AnchorUtils.loadProgramFromConnection(connection as unknown as SbConn);
  // Build the queue pubkey with the SDK's own (v1) PublicKey class, taken from
  // the loaded program's `programId`, so v1-only methods (e.g. `.toBuffer()`)
  // exist on it at runtime — a v3 PublicKey passed here would crash inside the SDK.
  const V1PublicKey = program.programId.constructor as new (bytes: Uint8Array) => SbPk;
  const queue = new sb.Queue(program, new V1PublicKey(params.switchboardQueue.toBytes()));
  const crossbar = CrossbarClient.default();

  // Gateway fetch: the ed25519 verify instruction carrying the oracle-signed
  // quote, positioned at `ed25519IxIndex` within the final transaction.
  const ed25519Ix = await queue.fetchQuoteIx(crossbar, params.feedHashes, {
    variableOverrides: {},
    instructionIdx: params.ed25519IxIndex,
  });

  const crankIx = await createCrankOracleQuoteInstruction(
    {
      cranker: (await gameAuthorityKeypair()).publicKey,
      gameEngine: params.gameEngine,
      switchboardQueue: params.switchboardQueue,
    },
    params.ed25519IxIndex,
  );

  // `ed25519Ix` is a v1 TransactionInstruction; bridge it to v3 so it composes
  // with `crankIx` (v3) in the transaction the cosign route assembles.
  return [toV3Instruction(ed25519Ix), crankIx];
}
