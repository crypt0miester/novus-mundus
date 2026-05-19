/**
 * set-level-gap.ts — Adjust the encounter level gap.
 *
 * Updates `gameplay_config.max_encounter_level_diff` on the GameEngine, which
 * bounds how far an encounter's level may sit from the attacking player's.
 *
 * Usage:
 *   bun run scripts/set-level-gap.ts [newGap]   # default 50
 */

import {
  Connection,
  Keypair,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';

import { deriveGameEnginePda } from '../src/pda';
import { deserializeGameEngine } from '../src/state/game-engine';
import { createUpdateGameConfigInstruction } from '../src/instructions/initialization';

const RPC = process.env.RPC_URL || 'http://localhost:8899';
const KINGDOM_ID = 0;

async function main(): Promise<void> {
  const newGap = parseInt(process.argv[2] || '50', 10);
  if (!Number.isInteger(newGap) || newGap < 1 || newGap > 255) {
    throw new Error(`Invalid gap "${process.argv[2]}" — must be 1-255`);
  }

  const connection = new Connection(RPC, 'confirmed');

  const daoPath = path.join(__dirname, '../keys/dao-authority.json');
  const dao = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(daoPath, 'utf8'))),
  );

  const [gameEngine] = await deriveGameEnginePda(KINGDOM_ID);
  const info = await connection.getAccountInfo(gameEngine);
  if (!info) throw new Error(`GameEngine not found for kingdom ${KINGDOM_ID}`);

  const engine = deserializeGameEngine(info.data);
  const current = engine.gameplayConfig.maxEncounterLevelDiff;
  console.log(`Current max_encounter_level_diff: ±${current}`);

  if (current === newGap) {
    console.log(`Already ±${newGap} — nothing to do.`);
    return;
  }

  // Round-trip the whole gameplay_config with just this one field changed.
  engine.gameplayConfig.maxEncounterLevelDiff = newGap;

  const ix = createUpdateGameConfigInstruction(
    { authority: dao.publicKey, gameEngine },
    { gameplayConfig: engine.gameplayConfig },
  );

  const sig = await sendAndConfirmTransaction(
    connection,
    new Transaction().add(ix),
    [dao],
  );

  const after = deserializeGameEngine(
    (await connection.getAccountInfo(gameEngine))!.data,
  );
  console.log(`Updated: ±${current} → ±${after.gameplayConfig.maxEncounterLevelDiff}`);
  console.log(`Signature: ${sig}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
