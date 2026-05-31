/**
 * airdrop command — Quick SOL airdrop to any address
 *
 * Usage:
 *   novus airdrop <pubkey>           # Airdrop 2 SOL
 *   novus airdrop <pubkey> --amount 10  # Airdrop 10 SOL
 *   novus airdrop dao                # Airdrop to DAO authority
 *   novus airdrop treasury           # Airdrop to treasury
 */

import { PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';

import type { CLIContext, ParsedArgs } from '../context';
import { log } from '../helpers';

export async function handleAirdrop(ctx: CLIContext, args: ParsedArgs): Promise<void> {
  const amountFlag = getFlag(args.flags, '--amount');
  const amount = amountFlag ? parseFloat(amountFlag) : 2;

  let pubkey: PublicKey;
  const target = args.target;

  if (!target) {
    log.error('Specify a target: <pubkey>, dao, or treasury');
    return;
  }

  switch (target) {
    case 'dao':
      pubkey = ctx.daoAuthority.publicKey;
      break;
    case 'treasury':
      pubkey = ctx.treasury.publicKey;
      break;
    default:
      try {
        pubkey = new PublicKey(target);
      } catch {
        log.error(`Invalid public key: ${target}`);
        return;
      }
  }

  if (ctx.env !== 'localnet') {
    log.error('Airdrop only works on localnet');
    return;
  }

  const balanceBefore = Number(await ctx.connection.getBalance(pubkey));

  try {
    const sig = await ctx.connection.requestAirdrop(
      pubkey,
      Math.floor(amount * LAMPORTS_PER_SOL)
    );
    await ctx.connection.confirmTransaction(sig, 'confirmed');
  } catch (e: any) {
    log.error(`Airdrop failed: ${e.message}`);
    return;
  }

  const balanceAfter = Number(await ctx.connection.getBalance(pubkey));

  log.info(`  ${pubkey.toBase58()}`);
  log.info(`  + ${amount} SOL`);
  log.info(`  Balance: ${(balanceBefore / LAMPORTS_PER_SOL).toFixed(2)} → ${(balanceAfter / LAMPORTS_PER_SOL).toFixed(2)} SOL`);
}

function getFlag(flags: string[], name: string): string | undefined {
  const idx = flags.indexOf(name);
  if (idx === -1) return undefined;
  return flags[idx + 1];
}
