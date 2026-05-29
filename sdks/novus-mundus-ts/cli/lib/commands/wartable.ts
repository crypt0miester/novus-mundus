// wartable command — send, read, discover, and derive keys for war-table threads.
//
// Subcommands:
//   wartable send --as <keypair|player-name> (--team | --to <wallet> | --encounter <pda>) --text "<msg>" [--reply-to <id-hex>] [--master-secret <hex>]
//   wartable send --as <...> (--team | --to <wallet>) --react <emoji> --parent <id-hex> [--master-secret <hex>]
//   wartable read (<thread> --scope <team|rally|castle|encounter|dm> | --team --as <id> | --to <wallet> --as <id>) [--limit N] [--master-secret <hex>]
//
// read prints each message's 12-byte id as hex (the leading column); pass that
// to --reply-to or --parent to thread a reply or attach a reaction.
//   wartable dm-threads <player-wallet> [--master-secret <hex>]
//   wartable thread-key <thread> --version N --master-secret <hex> --i-understand
//
// K_master comes from --master-secret or WT_MASTER_SECRET (64 hex chars). The
// chain stores war-table messages as sol_log_data; both paths derive the
// per-thread key locally (HMAC-SHA256 over K_master) — no web API / SIWS needed.
// Send encrypts the wt1 envelope and posts it on-chain; read fetches via
// getSignaturesForAddress + getTransaction and keys on the wt1 magic.

import * as fs from 'fs';
import * as path from 'path';
import { Keypair, PublicKey, Transaction } from '@solana/web3.js';

import type { CLIContext, ParsedArgs } from '../context';
import { log } from '../helpers';

import {
  WtScope,
  WtKind,
  WarTableClient,
  decodeEnvelope,
  decodeBody,
  deriveThreadKey,
  decryptBody,
  readProgramData,
  encodeMessageId,
  hexToId,
  idToHex,
  derivePlayerPda,
  deriveDmThreadPda,
  parsePlayer,
  hasTeam,
} from '../../../src/index';
import { LocalHmacKeyProvider, makeEpochResolver } from '../../../src/keyprovider/local';

/** Human label per scope (avoids relying on enum reverse-mapping). */
const SCOPE_LABEL = ['Team', 'Rally', 'Castle', 'Encounter', 'Dm'];

/** Human label per WtKind (index = kind value). */
const KIND_NAMES = ['Text', 'Pledge', 'System', 'Reply', 'Tombstone', 'Reaction', 'Pin'];

/**
 * Resolve `--as` to a signing Keypair: a path (absolute or relative to cwd), or
 * a player name / file under keys/players/ (the create-player output dir).
 */
function loadKeypairFromArg(asValue: string): Keypair {
  const playersDir = path.join(__dirname, '../../../keys/players');
  const candidates = [
    asValue,
    path.resolve(process.cwd(), asValue),
    path.join(playersDir, asValue.endsWith('.json') ? asValue : `${asValue}.json`),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        const secret = JSON.parse(fs.readFileSync(p, 'utf8'));
        return Keypair.fromSecretKey(Uint8Array.from(secret));
      }
    } catch {
      // try the next candidate
    }
  }
  throw new Error(`could not load keypair from --as "${asValue}" (tried it as a path and keys/players/${asValue}.json)`);
}

/** Resolve `--as` to a wallet pubkey: a base58 pubkey, or a keypair file's pubkey. */
function loadIdentityPubkey(asValue: string): PublicKey {
  try {
    return new PublicKey(asValue);
  } catch {
    return loadKeypairFromArg(asValue).publicKey;
  }
}

function getFlag(flags: string[], name: string): string | undefined {
  const idx = flags.indexOf(name);
  return idx >= 0 ? flags[idx + 1] : undefined;
}

function hasFlag(flags: string[], name: string): boolean {
  return flags.includes(name);
}

const SCOPE_BY_NAME: Record<string, WtScope> = {
  team: WtScope.Team,
  rally: WtScope.Rally,
  castle: WtScope.Castle,
  encounter: WtScope.Encounter,
  dm: WtScope.Dm,
};

function resolveMasterSecret(flags: string[]): Uint8Array | undefined {
  const hex = getFlag(flags, '--master-secret') ?? process.env.WT_MASTER_SECRET;
  if (!hex) return undefined;
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error('--master-secret must be 64 hex chars (32 bytes)');
  }
  return new Uint8Array(Buffer.from(hex, 'hex'));
}

function isWt1(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0x77 && bytes[1] === 0x74 && bytes[2] === 0x31;
}

export async function handleWartable(ctx: CLIContext, args: ParsedArgs): Promise<void> {
  switch (args.target) {
    case 'send':
      await handleSend(ctx, args);
      break;
    case 'read':
      await handleRead(ctx, args);
      break;
    case 'dm-threads':
      await handleDmThreads(ctx, args);
      break;
    case 'thread-key':
      await handleThreadKey(ctx, args);
      break;
    default:
      log.error(`Unknown subcommand: ${args.target || '(none)'}`);
      log.info('  wartable send --as <keypair|player-name> (--team | --to <wallet> | --encounter <pda>) --text "<msg>" [--reply-to <id-hex>] [--master-secret <hex>]');
      log.info('  wartable send --as <...> (--team | --to <wallet>) --react <emoji> --parent <id-hex> [--master-secret <hex>]');
      log.info('  wartable read (<thread> --scope <team|rally|castle|encounter|dm> | --team --as <id> | --to <wallet> --as <id>) [--limit N] [--master-secret <hex>]');
      log.info('  wartable dm-threads <player-wallet> [--master-secret <hex>]');
      log.info('  wartable thread-key <thread> --version N --master-secret <hex> --i-understand');
  }
}

/**
 * Send a war-table message. Signs as `--as` (a player keypair); targets a
 * thread by `--team` (the sender's team), `--to <wallet>` (a DM to that player),
 * or `--encounter <pda>` (plaintext). The envelope is built + encrypted by the
 * SDK's WarTableClient using a key derived locally from K_master.
 */
async function handleSend(ctx: CLIContext, args: ParsedArgs): Promise<void> {
  const asFlag = getFlag(args.flags, '--as');
  if (!asFlag) {
    log.error('send needs --as <keypair-file | player-name> (the sender that signs the post)');
    return;
  }
  let kp: Keypair;
  try {
    kp = loadKeypairFromArg(asFlag);
  } catch (e) {
    log.error((e as Error).message);
    return;
  }

  // Body kind: a reaction (--react <emoji> --parent <id>), a threaded reply
  // (--reply-to <id> --text), or a plain text message (--text). parentId is the
  // target message's 12-byte id, copied from the read command's hex column.
  const reactEmoji = getFlag(args.flags, '--react');
  const replyToHex = getFlag(args.flags, '--reply-to');
  let body: { kind: WtKind; payload: string; parentId?: Uint8Array };
  try {
    if (reactEmoji !== undefined) {
      const parentHex = getFlag(args.flags, '--parent');
      if (!parentHex) {
        log.error('--react <emoji> needs --parent <message-id-hex> (the message being reacted to)');
        return;
      }
      body = { kind: WtKind.Reaction, payload: reactEmoji, parentId: hexToId(parentHex) };
    } else if (replyToHex !== undefined) {
      const text = getFlag(args.flags, '--text');
      if (!text) {
        log.error('--reply-to <id> needs --text "<message>"');
        return;
      }
      body = { kind: WtKind.Reply, payload: text, parentId: hexToId(replyToHex) };
    } else {
      const text = getFlag(args.flags, '--text');
      if (!text) {
        log.error('send needs --text "<message>"  (or --react <emoji> --parent <id-hex>)');
        return;
      }
      body = { kind: WtKind.Text, payload: text };
    }
  } catch (e) {
    log.error(`bad --parent/--reply-to id: ${(e as Error).message}`);
    return;
  }

  const sender = kp.publicKey;
  const [senderPlayer] = derivePlayerPda(ctx.gameEngine, sender);

  // Resolve the target thread + scope + on-chain gate accounts from the flags.
  let scope: WtScope;
  let thread: PublicKey;
  let gateAccounts: PublicKey[];

  const toFlag = getFlag(args.flags, '--to');
  const encounterFlag = getFlag(args.flags, '--encounter');

  if (hasFlag(args.flags, '--team')) {
    const info = await ctx.connection.getAccountInfo(senderPlayer);
    const player = info ? parsePlayer(info) : null;
    if (!player) {
      log.error(`sender ${sender.toBase58()} has no player account in this kingdom — init the player first`);
      return;
    }
    if (!hasTeam(player)) {
      log.error('sender is not on a team — join a team before sending --team messages');
      return;
    }
    scope = WtScope.Team;
    thread = player.team;
    gateAccounts = [];
  } else if (toFlag) {
    let peerWallet: PublicKey;
    try {
      peerWallet = new PublicKey(toFlag);
    } catch {
      log.error('--to must be a base58 wallet pubkey');
      return;
    }
    const [peerPlayer] = derivePlayerPda(ctx.gameEngine, peerWallet);
    [thread] = deriveDmThreadPda(senderPlayer, peerPlayer);
    scope = WtScope.Dm;
    gateAccounts = [senderPlayer, peerPlayer];
  } else if (encounterFlag) {
    try {
      thread = new PublicKey(encounterFlag);
    } catch {
      log.error('--encounter must be a base58 encounter PDA');
      return;
    }
    scope = WtScope.Encounter;
    gateAccounts = [];
  } else {
    log.error('send needs a target: --team, --to <wallet>, or --encounter <pda>');
    return;
  }

  // Encounter is plaintext (no key); every encrypted scope needs K_master.
  let masterSecret: Uint8Array | undefined;
  if (scope !== WtScope.Encounter) {
    masterSecret = resolveMasterSecret(args.flags);
    if (!masterSecret) {
      log.error('Encrypted scopes need --master-secret <hex> or WT_MASTER_SECRET.');
      return;
    }
  }

  const keyProvider = new LocalHmacKeyProvider(
    masterSecret ?? new Uint8Array(32), // unused on the plaintext Encounter path
    makeEpochResolver(ctx.connection, scope),
  );
  const client = new WarTableClient({ connection: ctx.connection, keyProvider });

  const signTx = async (tx: Transaction): Promise<Transaction> => {
    tx.sign(kp);
    return tx;
  };

  try {
    const res = await client.postMessage(
      thread,
      scope,
      gateAccounts,
      sender,
      senderPlayer,
      body,
      signTx,
    );
    const kindLabel = ['Text', 'Pledge', 'System', 'Reply', 'Tombstone', 'Reaction', 'Pin'][body.kind] ?? 'Text';
    log.info(`Posted ${SCOPE_LABEL[scope]} ${kindLabel} to thread ${thread.toBase58()}`);
    log.info(`  from ${sender.toBase58().slice(0, 8)} | sig ${res.signature}`);
    if (res.congested) {
      log.info('  (network congested — priority fee was clamped to the ceiling)');
    }
  } catch (e) {
    log.error(`send failed: ${(e as Error).message}`);
  }
}

async function handleRead(ctx: CLIContext, args: ParsedArgs): Promise<void> {
  let thread: PublicKey;
  let scope: WtScope;

  const teamMode = hasFlag(args.flags, '--team');
  const toFlag = getFlag(args.flags, '--to');

  if (teamMode || toFlag) {
    // Convenience: resolve the thread from an identity (--as) rather than a raw PDA.
    const asFlag = getFlag(args.flags, '--as');
    if (!asFlag) {
      log.error('--team / --to read needs --as <wallet | keypair-file | player-name> to resolve the thread');
      return;
    }
    let identity: PublicKey;
    try {
      identity = loadIdentityPubkey(asFlag);
    } catch (e) {
      log.error((e as Error).message);
      return;
    }
    const [myPlayer] = derivePlayerPda(ctx.gameEngine, identity);
    if (teamMode) {
      const info = await ctx.connection.getAccountInfo(myPlayer);
      const player = info ? parsePlayer(info) : null;
      if (!player || !hasTeam(player)) {
        log.error(`identity ${identity.toBase58().slice(0, 8)} is not on a team`);
        return;
      }
      thread = player.team;
      scope = WtScope.Team;
    } else {
      let peer: PublicKey;
      try {
        peer = new PublicKey(toFlag as string);
      } catch {
        log.error('--to must be a base58 wallet pubkey');
        return;
      }
      const [peerPlayer] = derivePlayerPda(ctx.gameEngine, peer);
      [thread] = deriveDmThreadPda(myPlayer, peerPlayer);
      scope = WtScope.Dm;
    }
  } else {
    const threadStr = args.extra;
    if (!threadStr) {
      log.error('Specify the thread PDA: wartable read <thread> --scope <...>  (or --team / --to <wallet> with --as <id>)');
      return;
    }
    thread = new PublicKey(threadStr);
    const scopeName = (getFlag(args.flags, '--scope') ?? '').toLowerCase();
    const resolved = SCOPE_BY_NAME[scopeName];
    if (resolved === undefined) {
      log.error('Specify --scope <team|rally|castle|encounter|dm>');
      return;
    }
    scope = resolved;
  }

  const limit = parseInt(getFlag(args.flags, '--limit') ?? '50', 10);
  const masterSecret = scope === WtScope.Encounter ? undefined : resolveMasterSecret(args.flags);
  if (scope !== WtScope.Encounter && !masterSecret) {
    log.error('Encrypted scopes need --master-secret <hex> or WT_MASTER_SECRET.');
    return;
  }

  const sigs = await ctx.connection.getSignaturesForAddress(thread, { limit });
  // getSignaturesForAddress returns newest-first; reverse so we walk oldest-first.
  const rows: string[] = [];
  for (const sigInfo of [...sigs].reverse()) {
    const tx = await ctx.connection.getTransaction(sigInfo.signature, {
      maxSupportedTransactionVersion: 0,
    });
    if (!tx || !tx.meta || !tx.meta.logMessages) continue;
    const slot = tx.slot;
    const blobs = readProgramData(tx.meta.logMessages).filter(isWt1);
    let logIndex = 0;
    for (const blob of blobs) {
      const idx = logIndex;
      logIndex += 1;
      let env;
      try {
        env = decodeEnvelope(blob);
      } catch {
        continue;
      }
      const senderShort = env.senderWallet.toBase58().slice(0, 8);
      let text = '[encrypted, no key]';
      // Decode the full body where we can (plaintext, or encrypted with a key) so
      // the row can show the real kind and, for replies/reactions/tombstones/pins,
      // the parent id they target.
      let decoded: { kind: number; parentId: Uint8Array; payload: Uint8Array } | null = null;
      if (!env.encrypted) {
        try {
          decoded = decodeBody(env.body);
        } catch {
          text = '[plaintext decode error]';
        }
      } else if (masterSecret) {
        try {
          const key = deriveThreadKey(masterSecret, thread, env.keyVersion);
          decoded = decodeBody(decryptBody(key, env.bodyNonce, env.body, env.aad));
        } catch {
          text = '[encrypted, decrypt failed]';
        }
      }
      let kindName = !env.encrypted || decoded ? 'Unknown' : 'Encrypted';
      let parentNote = '';
      if (decoded) {
        text = new TextDecoder().decode(decoded.payload);
        kindName = KIND_NAMES[decoded.kind] ?? 'Unknown';
        if (decoded.kind !== WtKind.Text && decoded.kind !== WtKind.Pledge) {
          parentNote = `  [parent ${idToHex(decoded.parentId)}]`;
        }
      }
      const idHexStr = idToHex(encodeMessageId({ slot: BigInt(slot), txIndex: 0, logIndex: idx }));
      rows.push(`${idHexStr} | ${senderShort} | ${kindName} | v${env.keyVersion} | ${text}${parentNote}`);
    }
  }

  if (rows.length === 0) {
    log.info('No war-table messages found for this thread.');
    log.info('(Note: a non-archival RPC may have dropped older sol_log_data history.)');
    return;
  }
  for (const row of rows) log.info(row);
}

async function handleDmThreads(ctx: CLIContext, args: ParsedArgs): Promise<void> {
  const walletStr = args.extra;
  if (!walletStr) {
    log.error('Specify the player wallet: wartable dm-threads <player-wallet>');
    return;
  }
  const wallet = new PublicKey(walletStr);
  const [playerPda] = derivePlayerPda(ctx.gameEngine, wallet);

  const sigs = await ctx.connection.getSignaturesForAddress(playerPda, { limit: 1000 });
  const threads = new Map<string, { lastPreview: string }>();
  const masterSecret = resolveMasterSecret(args.flags);

  for (const sigInfo of [...sigs].reverse()) {
    const tx = await ctx.connection.getTransaction(sigInfo.signature, {
      maxSupportedTransactionVersion: 0,
    });
    if (!tx || !tx.meta || !tx.meta.logMessages) continue;
    const blobs = readProgramData(tx.meta.logMessages).filter(isWt1);
    for (const blob of blobs) {
      let env;
      try {
        env = decodeEnvelope(blob);
      } catch {
        continue;
      }
      // Sender-side discovery: keep messages this wallet sent (scope==4 DMs use
      // keyVersion 1). Full inbox requires the API key route.
      if (!env.senderWallet.equals(wallet)) continue;
      let preview = '[encrypted]';
      if (masterSecret && env.encrypted) {
        try {
          const key = deriveThreadKey(masterSecret, env.threadPda, env.keyVersion);
          preview = new TextDecoder().decode(decodeBody(decryptBody(key, env.bodyNonce, env.body, env.aad)).payload).slice(0, 48);
        } catch {
          preview = '[encrypted, decrypt failed]';
        }
      }
      threads.set(env.threadPda.toBase58(), { lastPreview: preview });
    }
  }

  if (threads.size === 0) {
    log.info('No DM threads found (sender-side discovery only).');
    return;
  }
  for (const [threadPda, info] of threads) {
    log.info(`${threadPda} | ${info.lastPreview}`);
  }
  log.info('Note: only sender-side discovery; full inbox requires the API key route.');
}

async function handleThreadKey(_ctx: CLIContext, args: ParsedArgs): Promise<void> {
  const threadStr = args.extra;
  if (!threadStr) {
    log.error('Specify the thread PDA: wartable thread-key <thread> --version N --master-secret <hex> --i-understand');
    return;
  }
  if (!hasFlag(args.flags, '--i-understand')) {
    log.error('Refusing without --i-understand. This prints a thread key derived from K_master.');
    log.error('Anyone with K_master can retroactively decrypt all war-table history. Do not log or paste it.');
    return;
  }
  const masterSecret = resolveMasterSecret(args.flags);
  if (!masterSecret) {
    log.error('thread-key needs --master-secret <hex> or WT_MASTER_SECRET.');
    return;
  }
  const version = parseInt(getFlag(args.flags, '--version') ?? '0', 10);
  const thread = new PublicKey(threadStr);
  const key = deriveThreadKey(masterSecret, thread, version);
  log.info(`WARNING: exposing a thread key. Treat as sensitive; do not store in shell history.`);
  log.info(Buffer.from(key).toString('base64'));
}
