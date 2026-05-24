/**
 * show mint — Display the NOVI mint's on-chain decimals + supply.
 *
 * Cheap sanity check when something looks 10× off in the UI: this prints the
 * actual SPL Mint layout values, so we can rule out a deploy-time mismatch
 * between the source's `decimals: 1` and what's actually on-chain.
 */

import { Connection } from '@solana/web3.js';
import type { CLIContext } from '../context';
import { log } from '../helpers';
import { section, addr, formatNum, dim } from '../format';
import { deriveNoviMintPda } from '../../../src/pda';

// SPL Token Mint layout (82 bytes):
//   0..3   mint_authority_option (u32 LE) — 0 = None, 1 = Some
//   4..35  mint_authority (Pubkey)
//  36..43  supply (u64 LE)
//      44  decimals (u8)
//      45  is_initialized (u8)
//  46..49  freeze_authority_option (u32 LE)
//  50..81  freeze_authority (Pubkey)

export async function showMint(_client: unknown, ctx: CLIContext): Promise<void> {
  const conn: Connection = ctx.connection;
  const [mintPda] = deriveNoviMintPda();

  const accountInfo = await conn.getAccountInfo(mintPda);
  if (!accountInfo) {
    log.error(`NOVI mint not found at ${addr(mintPda)} — has init run?`);
    return;
  }
  if (accountInfo.data.length < 82) {
    log.error(`NOVI mint account too small: ${accountInfo.data.length} bytes`);
    return;
  }

  const buf = accountInfo.data;
  const supply = buf.readBigUInt64LE(36);
  const decimals = buf.readUInt8(44);
  const isInitialized = buf.readUInt8(45) === 1;
  const mintAuthOpt = buf.readUInt32LE(0);
  const freezeAuthOpt = buf.readUInt32LE(46);

  log.info(`\nNOVI Mint: ${addr(mintPda)}`);

  log.info(section('Mint Info'));
  log.info(`  Decimals: ${decimals}    Initialized: ${isInitialized ? 'yes' : dim('no')}`);
  log.info(`  Supply (raw): ${formatNum(Number(supply))}`);
  log.info(`  Supply (display): ${(Number(supply) / 10 ** decimals).toLocaleString()} NOVI`);
  log.info(`  Mint authority: ${mintAuthOpt === 1 ? 'set' : dim('none')}    Freeze authority: ${freezeAuthOpt === 1 ? 'set' : dim('none')}`);
  log.info('');
}
