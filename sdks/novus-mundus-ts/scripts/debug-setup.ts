/**
 * Debug Setup Script
 *
 * Runs each setup step individually with detailed logging.
 * Also tests a single player initialization to debug InvalidRealloc.
 *
 * Usage: bun run scripts/debug-setup.ts
 */

import {
  Connection,
  Keypair,
  Transaction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
  PublicKey,
} from '@solana/web3.js';
import BN from 'bn.js';
import * as fs from 'fs';
import * as path from 'path';

import {
  createInitGameEngineInstruction,
  createInitCityInstruction,
  createInitPlayerInstruction,
  createInitializeConfigInstruction,
  createCreateItemInstruction,
  deriveGameEnginePda,
  derivePlayerPda,
  deriveNoviMintPda,
  deriveCityPda,
  deriveLocationPda,
  deriveShopConfigPda,
  deriveShopItemPda,
  PROGRAM_ID,
  SEEDS,
} from '../src/index';
import { getAssociatedTokenAddressSyncForPda } from '../src/utils/token';

// Configuration

const RPC_URL = process.env.RPC_URL || 'http://localhost:8899';
const KINGDOM_ID = 0;
const KEYS_DIR = path.join(__dirname, '../keys');

function log(step: string, msg: string) {
  console.log(`[${step}] ${msg}`);
}

function logError(step: string, msg: string, err: unknown) {
  console.error(`[${step}] ❌ ${msg}:`, err);
}

function logOk(step: string, msg: string) {
  console.log(`[${step}] ✅ ${msg}`);
}

// Keypair Management

function loadOrCreateKeypair(name: string): Keypair {
  if (!fs.existsSync(KEYS_DIR)) {
    fs.mkdirSync(KEYS_DIR, { recursive: true });
  }
  const filepath = path.join(KEYS_DIR, `${name}.json`);
  if (fs.existsSync(filepath)) {
    const secretKey = JSON.parse(fs.readFileSync(filepath, 'utf8'));
    return Keypair.fromSecretKey(Uint8Array.from(secretKey));
  }
  const keypair = Keypair.generate();
  fs.writeFileSync(filepath, JSON.stringify(Array.from(keypair.secretKey)));
  return keypair;
}

// Helpers

async function accountExists(connection: Connection, pubkey: PublicKey): Promise<boolean> {
  const info = await connection.getAccountInfo(pubkey);
  return info !== null && info.data.length > 0;
}

async function getAccountSize(connection: Connection, pubkey: PublicKey): Promise<number> {
  const info = await connection.getAccountInfo(pubkey);
  return info?.data.length ?? 0;
}

async function sendTx(
  connection: Connection,
  tx: Transaction,
  signers: Keypair[],
  label: string
): Promise<string | null> {
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  tx.feePayer = signers[0]!.publicKey;
  try {
    const sig = await sendAndConfirmTransaction(connection, tx, signers, {
      skipPreflight: true,
      commitment: 'confirmed',
    });
    logOk(label, `tx: ${sig}`);
    return sig;
  } catch (err: any) {
    logError(label, 'Transaction failed', err.message || err);

    // Try to get logs
    if (err.signature) {
      try {
        const status = await connection.getTransaction(err.signature, {
          commitment: 'confirmed',
          maxSupportedTransactionVersion: 0,
        });
        if (status?.meta?.logMessages) {
          console.log(`  Logs:`);
          for (const logLine of status.meta.logMessages) {
            console.log(`    ${logLine}`);
          }
        }
      } catch {}
    }

    // Also try extracting sig from error message
    const sigMatch = err.message?.match(/Transaction ([A-Za-z0-9]+) /);
    if (sigMatch) {
      try {
        await new Promise(r => setTimeout(r, 2000));
        const sigFromErr = sigMatch[1];
        const confirmed = await connection.confirmTransaction(sigFromErr, 'confirmed');
        const txResult = await connection.getTransaction(sigFromErr, {
          commitment: 'confirmed',
          maxSupportedTransactionVersion: 0,
        });
        if (txResult?.meta?.logMessages) {
          console.log(`  Logs from sig ${sigFromErr}:`);
          for (const logLine of txResult.meta.logMessages) {
            console.log(`    ${logLine}`);
          }
        }
      } catch {}
    }

    return null;
  }
}

// Main

async function main() {
  console.log('='.repeat(60));
  console.log('Debug Setup Script');
  console.log('='.repeat(60));

  const connection = new Connection(RPC_URL, 'confirmed');
  const daoAuthority = loadOrCreateKeypair('dao-authority');
  const treasury = loadOrCreateKeypair('treasury');

  log('CONFIG', `RPC: ${RPC_URL}`);
  log('CONFIG', `Kingdom ID: ${KINGDOM_ID}`);
  log('CONFIG', `DAO Authority: ${daoAuthority.publicKey.toBase58()}`);
  log('CONFIG', `Treasury: ${treasury.publicKey.toBase58()}`);
  log('CONFIG', `Program ID: ${PROGRAM_ID.toBase58()}`);

  // Derive PDAs
  const [gameEngine] = deriveGameEnginePda(KINGDOM_ID);
  const [noviMint] = deriveNoviMintPda();
  log('PDA', `GameEngine: ${gameEngine.toBase58()}`);
  log('PDA', `NOVI Mint: ${noviMint.toBase58()}`);

  // Step 1: Airdrop
  console.log('\n--- Step 1: Airdrop ---');
  const balance = await connection.getBalance(daoAuthority.publicKey);
  log('AIRDROP', `Current balance: ${balance / LAMPORTS_PER_SOL} SOL`);
  if (balance < 10 * LAMPORTS_PER_SOL) {
    const sig = await connection.requestAirdrop(daoAuthority.publicKey, 100 * LAMPORTS_PER_SOL);
    await connection.confirmTransaction(sig, 'confirmed');
    logOk('AIRDROP', `Airdropped 100 SOL`);
  } else {
    logOk('AIRDROP', `Already has enough SOL`);
  }

  // Step 2: GameEngine
  console.log('\n--- Step 2: GameEngine ---');
  if (await accountExists(connection, gameEngine)) {
    const size = await getAccountSize(connection, gameEngine);
    logOk('GAME_ENGINE', `Already exists (${size} bytes)`);
  } else {
    const ix = createInitGameEngineInstruction({
      authority: daoAuthority.publicKey,
      treasuryWallet: treasury.publicKey,
      kingdomId: KINGDOM_ID,
    });
    const tx = new Transaction().add(ix);
    log('GAME_ENGINE', `Creating with kingdomId=${KINGDOM_ID}...`);
    log('GAME_ENGINE', `Instruction data length: ${ix.data.length} bytes`);
    log('GAME_ENGINE', `Accounts: ${ix.keys.length}`);
    for (let i = 0; i < ix.keys.length; i++) {
      const k = ix.keys[i]!;
      log('GAME_ENGINE', `  [${i}] ${k.pubkey.toBase58()} signer=${k.isSigner} writable=${k.isWritable}`);
    }
    await sendTx(connection, tx, [daoAuthority], 'GAME_ENGINE');
  }

  // Read GameEngine data
  const geInfo = await connection.getAccountInfo(gameEngine);
  if (geInfo) {
    log('GAME_ENGINE', `Account size: ${geInfo.data.length} bytes`);
    log('GAME_ENGINE', `Owner: ${geInfo.owner.toBase58()}`);
  }

  // Step 3: Cities (just city 1 for debugging)
  console.log('\n--- Step 3: City 1 ---');
  const [city1Pda] = deriveCityPda(gameEngine, 1);
  log('CITY', `City 1 PDA: ${city1Pda.toBase58()}`);

  if (await accountExists(connection, city1Pda)) {
    const size = await getAccountSize(connection, city1Pda);
    logOk('CITY', `City 1 already exists (${size} bytes)`);
  } else {
    const ix = createInitCityInstruction(
      { authority: daoAuthority.publicKey, gameEngine },
      {
        cityId: 1,
        name: 'Novus Prime',
        latitude: 40.7128,
        longitude: -74.006,
        radiusKm: 10,
        cityType: 0,
      }
    );
    const tx = new Transaction().add(ix);
    log('CITY', `Creating city 1...`);
    log('CITY', `Instruction data length: ${ix.data.length} bytes`);
    await sendTx(connection, tx, [daoAuthority], 'CITY');
  }

  // Step 4: Init Player
  console.log('\n--- Step 4: Init Player ---');
  const playerKeypair = Keypair.generate();
  const [playerPda, playerBump] = derivePlayerPda(gameEngine, playerKeypair.publicKey);
  const playerTokenAccount = getAssociatedTokenAddressSyncForPda(noviMint, playerPda);
  const [spawnLocation] = deriveLocationPda(gameEngine, 1, 0, 0);

  log('PLAYER', `Player wallet: ${playerKeypair.publicKey.toBase58()}`);
  log('PLAYER', `Player PDA: ${playerPda.toBase58()} (bump=${playerBump})`);
  log('PLAYER', `Player token ATA: ${playerTokenAccount.toBase58()}`);
  log('PLAYER', `Spawn location PDA: ${spawnLocation.toBase58()}`);
  log('PLAYER', `City PDA passed: ${city1Pda.toBase58()}`);
  log('PLAYER', `NOVI Mint: ${noviMint.toBase58()}`);

  // Check SDK vs Rust PDA derivation for location
  // SDK: [LOCATION, cityId, lat, long]
  // Rust: [LOCATION, game_engine, cityId, lat, long]
  // Let's also try with gameEngine to see if they differ
  const cityIdBuf = Buffer.alloc(2);
  cityIdBuf.writeUInt16LE(1);
  const latBuf = Buffer.alloc(4);
  latBuf.writeInt32LE(0);
  const longBuf = Buffer.alloc(4);
  longBuf.writeInt32LE(0);

  const [locationWithoutGE] = PublicKey.findProgramAddressSync(
    [SEEDS.LOCATION, cityIdBuf, latBuf, longBuf],
    PROGRAM_ID
  );
  const [locationWithGE] = PublicKey.findProgramAddressSync(
    [SEEDS.LOCATION, gameEngine.toBuffer(), cityIdBuf, latBuf, longBuf],
    PROGRAM_ID
  );

  log('PDA_CHECK', `Location WITHOUT gameEngine: ${locationWithoutGE.toBase58()}`);
  log('PDA_CHECK', `Location WITH gameEngine:    ${locationWithGE.toBase58()}`);
  log('PDA_CHECK', `SDK derives (deriveLocationPda): ${spawnLocation.toBase58()}`);
  log('PDA_CHECK', `Match without GE: ${locationWithoutGE.equals(spawnLocation)}`);
  log('PDA_CHECK', `Match with GE: ${locationWithGE.equals(spawnLocation)}`);

  // Airdrop to player
  const airdropSig = await connection.requestAirdrop(playerKeypair.publicKey, 5 * LAMPORTS_PER_SOL);
  await connection.confirmTransaction(airdropSig, 'confirmed');
  logOk('PLAYER', `Airdropped 5 SOL to player`);

  // Build the init player instruction (city 1 = Novus Prime @ 40.7128, -74.006)
  const ix = createInitPlayerInstruction({
    owner: playerKeypair.publicKey,
    gameEngine,
    startingCityId: 1,
    cityLatitude: 40.7128,
    cityLongitude: -74.006,
  });

  log('PLAYER', `Instruction data: ${Buffer.from(ix.data).toString('hex')}`);
  log('PLAYER', `Instruction data length: ${ix.data.length} bytes`);
  log('PLAYER', `Accounts (${ix.keys.length}):`);
  const accountLabels = [
    'player PDA', 'owner (signer)', 'player_token_account', 'game_engine',
    'novi_mint', 'starting_city', 'spawn_location', 'system_program',
    'token_program', 'associated_token_program'
  ];
  for (let i = 0; i < ix.keys.length; i++) {
    const k = ix.keys[i]!;
    const label = accountLabels[i] || `account_${i}`;
    const exists = await accountExists(connection, k.pubkey);
    log('PLAYER', `  [${i}] ${label}: ${k.pubkey.toBase58()}`);
    log('PLAYER', `        signer=${k.isSigner} writable=${k.isWritable} exists=${exists}`);
  }

  const tx = new Transaction().add(ix);
  log('PLAYER', `Sending init player transaction...`);
  const result = await sendTx(connection, tx, [playerKeypair], 'PLAYER');

  if (result) {
    // Fetch and display player data
    const playerInfo = await connection.getAccountInfo(playerPda);
    if (playerInfo) {
      logOk('PLAYER', `Player account created! Size: ${playerInfo.data.length} bytes`);
      logOk('PLAYER', `Player owner: ${playerInfo.owner.toBase58()}`);
    }
  } else {
    // Additional debugging: check if the location PDA mismatch is the issue
    console.log('\n--- Additional PDA Debug ---');
    log('DEBUG', `The Rust processor derives location PDA with seeds: [LOCATION_SEED, game_engine, city_id, lat, long]`);
    log('DEBUG', `The SDK deriveLocationPda uses seeds: [LOCATION, city_id, lat, long] (NO game_engine)`);
    log('DEBUG', `If these don't match, the Rust program will reject the PDA.`);
    log('DEBUG', `However, InvalidRealloc is a runtime error, not a program error.`);
    log('DEBUG', ``);
    log('DEBUG', `Possible causes of InvalidRealloc:`);
    log('DEBUG', `1. PlayerAccount::LEN mismatch between compiled .so and actual struct size`);
    log('DEBUG', `2. LocationAccount::LEN mismatch`);
    log('DEBUG', `3. CityAccount::load_mut doing an implicit realloc`);
    log('DEBUG', `4. Stale .so deployed to validator (rebuild needed)`);
    log('DEBUG', ``);
    log('DEBUG', `Try: cargo build-sbf && restart validator with --reset`);
  }

  console.log('\n' + '='.repeat(60));
  console.log('Debug complete.');
}

main().catch(console.error);
