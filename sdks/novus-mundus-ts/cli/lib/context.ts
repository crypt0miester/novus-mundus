/**
 * CLI Context — connection, keypairs, derived PDAs, environment
 */

import {
  Connection,
  Keypair,
  PublicKey,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';
import {
  deriveGameEnginePda,
  deriveNoviMintPda,
  deriveHeroCollectionPda,
} from '../../src/index';

export type Environment = 'localnet' | 'devnet' | 'mainnet';

export interface CLIContext {
  connection: Connection;
  env: Environment;
  kingdomId: number;
  /* Kingdom name (max 32 UTF-8 bytes, zero-padded on chain). */
  kingdomName: string;
  /* Theme enum: 0=Medieval, 1=Cyberpunk, 2=SciFi, 3=Modern, 4=PostApocalyptic. */
  theme: number;
  /* When kingdom gameplay begins (unix seconds). 0 = immediately. */
  kingdomStartTime: number;
  /* When registration closes (unix seconds). 0 = never. */
  registrationClosesAt: number;
  daoAuthority: Keypair;
  treasury: Keypair;
  gameEngine: PublicKey;
  noviMint: PublicKey;
  heroCollection: PublicKey;
  dryRun: boolean;
  verbose: boolean;
  /* City ids the cities/castles phases create. null = all cities. Heroes are
   * always created in full; the web marks heroes pinned to an un-opened city
   * as "Undiscovered" rather than deferring their creation. */
  enrolledCities: Set<number> | null;
}

export interface ParsedArgs {
  command: string;
  target: string;
  extra: string;
  env: Environment;
  kingdomId: number;
  kingdomName?: string;
  theme?: number;
  kingdomStartTime?: number;
  registrationClosesAt?: number;
  authorityPath: string;
  treasuryPath: string;
  dryRun: boolean;
  verbose: boolean;
  from: number;
  /* --cities spec: "0-4", "5,9,13", "0-4,7". Absent = all cities. */
  cities?: string;
  flags: string[];
}

const THEME_NAMES: Record<string, number> = {
  medieval: 0,
  cyberpunk: 1,
  scifi: 2,
  modern: 3,
  postapocalyptic: 4,
};

function parseTheme(v: string): number {
  const n = Number(v);
  if (Number.isInteger(n) && n >= 0 && n <= 4) return n;
  const key = v.trim().toLowerCase().replace(/[\s_-]/g, '');
  const mapped = THEME_NAMES[key];
  if (mapped === undefined) {
    throw new Error(`Invalid --theme "${v}". Use 0-4 or one of: ${Object.keys(THEME_NAMES).join(', ')}`);
  }
  return mapped;
}

function parseTimestamp(v: string): number {
  /* Accept raw unix seconds or an ISO date. */
  if (/^-?\d+$/.test(v.trim())) return parseInt(v, 10);
  const ms = Date.parse(v);
  if (Number.isNaN(ms)) {
    throw new Error(`Invalid timestamp "${v}". Pass unix seconds or an ISO date.`);
  }
  return Math.floor(ms / 1000);
}

/**
 * Parse a `--cities` spec into a set of city ids. Accepts comma-separated ids
 * and inclusive ranges, e.g. "0-4", "5,9,13", "0-4,7,9". Returns null for an
 * absent/empty spec, meaning "all cities".
 */
export function parseCitySpec(spec: string | undefined): Set<number> | null {
  if (!spec || !spec.trim()) return null;
  const ids = new Set<number>();
  for (const part of spec.split(',')) {
    const token = part.trim();
    if (!token) continue;
    const range = token.match(/^(\d+)-(\d+)$/);
    if (range) {
      const lo = parseInt(range[1], 10);
      const hi = parseInt(range[2], 10);
      if (lo > hi) throw new Error(`Invalid --cities range "${token}": start is greater than end`);
      for (let id = lo; id <= hi; id++) ids.add(id);
    } else if (/^\d+$/.test(token)) {
      ids.add(parseInt(token, 10));
    } else {
      throw new Error(`Invalid --cities token "${token}". Use ids and ranges like "5,9,13" or "0-4".`);
    }
  }
  return ids.size ? ids : null;
}

const RPC_URLS: Record<Environment, string> = {
  localnet: 'http://localhost:8899',
  devnet: 'https://api.devnet.solana.com',
  mainnet: process.env.RPC_MAINNET || 'https://api.mainnet-beta.solana.com',
};

export function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = {
    command: '',
    target: '',
    extra: '',
    env: 'localnet',
    kingdomId: 0,
    authorityPath: '',
    treasuryPath: '',
    dryRun: false,
    verbose: false,
    from: 1,
    flags: [],
  };

  const positional: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--env':
        args.env = argv[++i] as Environment;
        break;
      case '--kingdom-id':
        args.kingdomId = parseInt(argv[++i], 10);
        break;
      case '--kingdom-name':
        args.kingdomName = argv[++i];
        break;
      case '--theme':
        args.theme = parseTheme(argv[++i]);
        break;
      case '--kingdom-start-time':
        args.kingdomStartTime = parseTimestamp(argv[++i]);
        break;
      case '--registration-closes-at':
        args.registrationClosesAt = parseTimestamp(argv[++i]);
        break;
      case '--authority':
        args.authorityPath = argv[++i];
        break;
      case '--treasury':
        args.treasuryPath = argv[++i];
        break;
      case '--dry-run':
        args.dryRun = true;
        break;
      case '--verbose':
        args.verbose = true;
        break;
      case '--from':
        args.from = parseInt(argv[++i], 10);
        break;
      case '--cities':
        args.cities = argv[++i];
        break;
      default:
        if (arg.startsWith('--')) {
          args.flags.push(arg);
          // Capture the value following a --flag if it doesn't look like another flag
          if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
            args.flags.push(argv[++i]);
          }
        } else {
          positional.push(arg);
        }
    }
  }

  args.command = positional[0] || '';
  args.target = positional[1] || '';
  args.extra = positional[2] || '';

  return args;
}

export async function loadKeypair(filepath: string): Promise<Keypair> {
  const fullPath = path.resolve(filepath);
  if (!fs.existsSync(fullPath)) {
    const keypair = await Keypair.generate();
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(fullPath, JSON.stringify(Array.from(keypair.secretKey)));
    return keypair;
  }
  const secretKey = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
  return await Keypair.fromSecretKey(Uint8Array.from(secretKey));
}

export async function ensureFunded(
  connection: Connection,
  pubkey: PublicKey,
  minBalance: number = 10 * LAMPORTS_PER_SOL
): Promise<void> {
  // getBalance returns a bigint under the v3 seam; coerce to number for the
  // lamport math below (test balances fit comfortably in a JS number).
  const balance = Number(await connection.getBalance(pubkey));
  if (balance < minBalance) {
    const needed = Math.min(minBalance - balance, 2 * LAMPORTS_PER_SOL);
    const sig = await connection.requestAirdrop(pubkey, needed);
    await connection.confirmTransaction(sig, 'confirmed');
  }
}

export async function buildContext(args: ParsedArgs): Promise<CLIContext> {
  const scriptsDir = path.join(__dirname, '../..');
  const keysDir = path.join(scriptsDir, 'keys');

  const authorityPath = args.authorityPath || path.join(keysDir, 'dao-authority.json');
  const treasuryPath = args.treasuryPath || path.join(keysDir, 'treasury.json');

  const daoAuthority = await loadKeypair(authorityPath);
  const treasury = await loadKeypair(treasuryPath);

  const rpcUrl = process.env.RPC_URL || RPC_URLS[args.env];
  const connection = new Connection(rpcUrl, 'confirmed');

  const [gameEngine] = await deriveGameEnginePda(args.kingdomId);
  const [noviMint] = await deriveNoviMintPda();
  const [heroCollection] = await deriveHeroCollectionPda();

  const ctx: CLIContext = {
    connection,
    env: args.env,
    kingdomId: args.kingdomId,
    kingdomName: args.kingdomName ?? 'Genesis',
    theme: args.theme ?? 3,
    kingdomStartTime: args.kingdomStartTime ?? 0,
    registrationClosesAt: args.registrationClosesAt ?? 0,
    daoAuthority,
    treasury,
    gameEngine,
    noviMint,
    heroCollection,
    dryRun: args.dryRun,
    verbose: args.verbose,
    enrolledCities: parseCitySpec(args.cities),
  };

  if (args.env === 'localnet') {
    await ensureFunded(connection, daoAuthority.publicKey, 50 * LAMPORTS_PER_SOL).catch(() => {});
    await ensureFunded(connection, treasury.publicKey, 1 * LAMPORTS_PER_SOL).catch(() => {});
  }

  return ctx;
}
