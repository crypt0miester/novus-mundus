/**
 * CLI Formatting Utilities — tables, colors, number formatting
 */

import type BN from 'bn.js';
import { type PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';

// ANSI Colors

const isColorEnabled = process.env.NO_COLOR === undefined;

const c = (code: string) => (s: string) =>
  isColorEnabled ? `\x1b[${code}m${s}\x1b[0m` : s;

export const dim    = c('2');
export const bold   = c('1');
export const green  = c('32');
export const red    = c('31');
export const yellow = c('33');
export const cyan   = c('36');
export const white  = c('37');
export const magenta = c('35');

// Number Formatting

export function formatSol(lamports: number | BN): string {
  const n = typeof lamports === 'number' ? lamports : lamports.toNumber();
  return (n / LAMPORTS_PER_SOL).toFixed(4);
}

export function formatNum(n: number | BN): string {
  const v = typeof n === 'number' ? n : n.toNumber();
  return v.toLocaleString('en-US');
}

export function formatBps(bps: number): string {
  return `${(bps / 100).toFixed(1)}%`;
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  return h > 0 ? `${d}d ${h}h` : `${d}d`;
}

export function formatDate(unixSeconds: number | BN): string {
  const ts = typeof unixSeconds === 'number' ? unixSeconds : unixSeconds.toNumber();
  if (ts === 0) return dim('--');
  return new Date(ts * 1000).toISOString().slice(0, 16).replace('T', ' ');
}

export function formatUsd(cents: number): string {
  if (cents === 0) return 'Free';
  return `$${(cents / 100).toFixed(2)}`;
}

// Address Formatting

export function addr(pubkey: PublicKey | string): string {
  const s = typeof pubkey === 'string' ? pubkey : pubkey.toBase58();
  if (s === '11111111111111111111111111111111') return dim('None');
  return `${s.slice(0, 4)}..${s.slice(-4)}`;
}

// Hero Portrait URL — `<heroes-base>/<pubkey>` where heroes-base matches the
// on-chain template URI (programs/novus_mundus/src/processor/hero/mint.rs
// `uri: b"https://novusmundus.gg/heroes/"`). The route at this path returns
// a 1024² procedural PNG (see docs/design/HERO_PORTRAITS.md).
//
// Override the base via WEB_BASE_URL for local dev (e.g. http://localhost:3001/heroes).
// Pass `level` for cache-busting on level-up (?v=<level>).
export function heroPortraitUrl(
  pubkey: PublicKey | string,
  opts: { baseUrl?: string; level?: number } = {},
): string {
  const s = typeof pubkey === 'string' ? pubkey : pubkey.toBase58();
  const base = (
    opts.baseUrl ?? process.env.WEB_BASE_URL ?? 'https://novusmundus.gg/heroes'
  ).replace(/\/$/, '');
  const v = opts.level != null ? `?v=${opts.level}` : '';
  return `${base}/${s}${v}`;
}

// Table Formatting

export interface Column {
  header: string;
  align?: 'left' | 'right';
  width?: number; // min width
}

export function table(columns: Column[], rows: string[][]): string {
  // Calculate widths
  const widths = columns.map((col, i) => {
    const headerLen = stripAnsi(col.header).length;
    const maxData = rows.reduce((max, row) => {
      const cellLen = stripAnsi(row[i] || '').length;
      return Math.max(max, cellLen);
    }, 0);
    return Math.max(col.width ?? 0, headerLen, maxData);
  });

  const lines: string[] = [];

  // Header
  const headerLine = columns
    .map((col, i) => padCell(bold(col.header), col.header, widths[i], col.align ?? 'left'))
    .join('  ');
  lines.push(headerLine);

  // Separator
  lines.push(dim('─'.repeat(widths.reduce((s, w) => s + w, 0) + (widths.length - 1) * 2)));

  // Rows
  for (const row of rows) {
    const line = columns
      .map((col, i) => padCell(row[i] || '', stripAnsi(row[i] || ''), widths[i], col.align ?? 'left'))
      .join('  ');
    lines.push(line);
  }

  return lines.join('\n');
}

function padCell(display: string, plain: string, width: number, align: 'left' | 'right'): string {
  const pad = width - plain.length;
  if (pad <= 0) return display;
  const spaces = ' '.repeat(pad);
  return align === 'right' ? spaces + display : display + spaces;
}

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

// Section Headers

export function section(title: string): string {
  return `\n${bold(title)}\n`;
}

export function statusBadge(ok: boolean): string {
  return ok ? green('OK') : red('MISSING');
}

export function check(v: boolean): string {
  return v ? green('yes') : dim('no');
}

export function stockLabel(n: number | BN): string {
  const v = typeof n === 'number' ? n : n.toNumber();
  return v === 0 ? dim('unlimited') : formatNum(v);
}
