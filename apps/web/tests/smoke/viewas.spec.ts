/**
 * viewAs render smoke test.
 *
 * Exercises the `?viewAs=<pubkey>` debug override (src/lib/solana/provider.tsx):
 * with the param set, the app must render as if that pubkey were a connected
 * wallet — no extension, no signing — so a CLI-created player can be inspected
 * in-browser. This is the "mocked wallet adapter" follow-up noted in
 * dom-nesting.spec.ts.
 *
 * We probe /estate, not /settings: /estate is the home a connected-but-still-
 * loading session lands on (layout.tsx redirects there while usePlayer resolves),
 * so a deep-link to any other route races that redirect. /estate is the stable
 * landing and renders the most impersonation-proving content anyway.
 *
 * Requires the full local stack (validator + `novus init all` + a created
 * player + `bun dev`). Supply the on-chain player pubkey via VIEW_AS_PUBKEY;
 * the default is the `advanced`-tier player from `novus create-player`.
 */
import { test, expect } from '@playwright/test';

const PUBKEY = process.env.VIEW_AS_PUBKEY ?? '78cqDn2gnBawA4qYU1AhzWVWGwsZt1TbR2ydBUSrpEuM';

// The TopBar wallet button truncates as first4..last4 with two dots (see
// BaseWalletMultiButton.tsx) — NOT the single … ellipsis of shortenAddress.
const shortened = `${PUBKEY.slice(0, 4)}..${PUBKEY.slice(-4)}`;

test('viewAs renders /estate as the impersonated wallet', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  await page.goto(`/estate?viewAs=${PUBKEY}`, { waitUntil: 'domcontentloaded' });

  // The TopBar wallet button shows the shortened impersonated pubkey only when
  // useWallet().publicKey is set — i.e. the viewAs context override took hold.
  await expect(page.getByText(shortened, { exact: false }).first()).toBeVisible({
    timeout: 20_000,
  });

  // The left rail renders nothing until usePlayer() resolves on-chain data
  // (LeftPanel: `if (!player) return null`). "Stamina" appearing proves the read
  // path resolved for the impersonated wallet, not merely that the override set
  // a publicKey. It also proves we landed in the game shell, not on "/".
  await expect(page.getByText('Stamina', { exact: false }).first()).toBeVisible({
    timeout: 20_000,
  });

  // Loading must not surface the view-only signing denial — nothing signs on a
  // read-only page load.
  expect(pageErrors.filter((e) => /view-only mode/i.test(e))).toEqual([]);
});
