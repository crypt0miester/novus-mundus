/**
 * AllDomains HTTP API client.
 *
 * Used for: availability check, purchase, TLD listing, owned domains.
 * On-chain resolution is in resolver.ts (via @onsol/tldparser).
 */

import { ALLDOMAINS_API } from "./constants";

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

/** Web2 TLDs — not usable for on-chain player names. */
const WEB2_TLDS = new Set([".id", ".com", ".xyz"]);

/**
 * Co-signer TLDs use a dedicated endpoint that returns a pre-signed
 * VersionedTransaction. The user just adds their signature and submits.
 * Map: ".tld" → API route slug (e.g. ".solana" → "solana").
 */
const COSIGNER_TLD_SLUGS: Record<string, string> = {
  ".slam": "slam",
  ".letsbonk": "bonk",
  ".syndicate": "syndicate",
  ".solana": "solana",
  ".jpeg": "jpeg",
};

function normalizeTld(tld: string): string {
  return tld.startsWith(".") ? tld : `.${tld}`;
}

export function isWeb2Tld(tld: string): boolean {
  return WEB2_TLDS.has(normalizeTld(tld));
}

export function requiresCosigner(tld: string): boolean {
  return normalizeTld(tld) in COSIGNER_TLD_SLUGS;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DomainCheckResult {
  tld: string;
  exists: boolean;
  domainPrice: { mint: string; price: number } | null;
}

export interface TldInfo {
  tld: string;
  collection: string;
  authority: string;
  chain: string;
}

export interface DomainPurchaseResult {
  status: "success" | "error";
  error: string | null;
  instructionBase64: string | null;
  preInstructionsBase64: string[];
  addressLookupTableAccountsKeys: string[];
  insufficientFunds?: boolean;
}

/**
 * Co-signer endpoints return a pre-signed VersionedTransaction.
 * The user deserializes it, adds their signature, and submits.
 */
export interface CosignerPurchaseResult {
  status: "success" | "error";
  error: string | null;
  msg: string | null;
  /** Base64-encoded VersionedTransaction, already signed by the co-signer. */
  transaction: string;
  blockhash: string;
  lastValidBlockHeight: number;
}

export interface MainDomainResult {
  pubkey: string;
  mainDomain: string | null;
  nameAccount: string | null;
}

// ---------------------------------------------------------------------------
// API calls
// ---------------------------------------------------------------------------

/**
 * Check if a domain is available and get its price.
 * GET /api/check-domain/{domain}
 */
export async function checkDomainAvailability(
  domain: string,
): Promise<DomainCheckResult> {
  const res = await fetch(
    `${ALLDOMAINS_API}/api/check-domain/${encodeURIComponent(domain)}`,
  );
  if (!res.ok) throw new Error(`check-domain failed: ${res.status}`);
  return res.json();
}

/**
 * Fetch all available web3 TLDs (web2 excluded).
 * GET /api/all-tlds?chain=solana
 */
export async function fetchAllTlds(): Promise<TldInfo[]> {
  const res = await fetch(`${ALLDOMAINS_API}/api/all-tlds?chain=solana`);
  if (!res.ok) throw new Error(`all-tlds failed: ${res.status}`);
  const data = await res.json();
  const tlds: TldInfo[] = data.tlds ?? [];
  return tlds.filter((t) => !isWeb2Tld(t.tld));
}

/**
 * Get the primary domain for a single wallet.
 * GET /api/main-domain/{pubkey}
 */
export async function fetchMainDomain(
  pubkey: string,
): Promise<string | null> {
  const res = await fetch(
    `${ALLDOMAINS_API}/api/main-domain/${encodeURIComponent(pubkey)}`,
  );
  if (!res.ok) return null;
  const data = await res.json();
  return data.mainDomain ?? null;
}

/**
 * Batch-fetch primary domains for multiple wallets.
 * POST /api/main-domain/batch (max 100)
 */
export async function fetchMainDomainsBatch(
  pubkeys: string[],
): Promise<MainDomainResult[]> {
  const res = await fetch(`${ALLDOMAINS_API}/api/main-domain/batch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pubkeys }),
  });
  if (!res.ok) throw new Error(`main-domain/batch failed: ${res.status}`);
  const data = await res.json();
  return data.mainDomains ?? [];
}

/**
 * Get domains owned by a wallet for a specific TLD.
 * GET /api/check-user-domains/{tld}/{publicKey}
 */
export async function fetchUserDomainsForTld(
  tld: string,
  publicKey: string,
): Promise<unknown[]> {
  const res = await fetch(
    `${ALLDOMAINS_API}/api/check-user-domains/${encodeURIComponent(tld)}/${encodeURIComponent(publicKey)}`,
  );
  if (!res.ok) throw new Error(`check-user-domains failed: ${res.status}`);
  return res.json();
}

/**
 * Create a domain purchase transaction.
 *
 * Routes automatically:
 * - Standard TLDs  → POST /api/create-domain  (returns instructions)
 * - Co-signer TLDs → POST /api/co-signer-{slug} (returns pre-signed tx)
 *
 * The caller should check the result type:
 * - `DomainPurchaseResult`  → build tx from instructions, sign, send
 * - `CosignerPurchaseResult` → deserialize tx, add user sig, send
 */
export async function createDomainPurchase(params: {
  domain: string;
  tld: string;
  publicKey: string;
  durationRate?: number;
  simulate?: boolean;
}): Promise<DomainPurchaseResult | CosignerPurchaseResult> {
  const tld = normalizeTld(params.tld);

  if (isWeb2Tld(tld)) {
    throw new Error(`Web2 TLD ${tld} is not supported for purchase`);
  }

  const slug = COSIGNER_TLD_SLUGS[tld];

  if (slug) {
    // Co-signer path: server builds + signs the tx, we just add user sig
    const res = await fetch(`${ALLDOMAINS_API}/api/co-signer-${slug}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        domain: params.domain,
        durationRate: params.durationRate ?? 1,
        publicKey: params.publicKey,
      }),
    });
    if (!res.ok) throw new Error(`co-signer-${slug} failed: ${res.status}`);
    return res.json() as Promise<CosignerPurchaseResult>;
  }

  // Standard path: returns instructions to build our own tx
  const res = await fetch(`${ALLDOMAINS_API}/api/create-domain`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      domain: params.domain,
      tld,
      publicKey: params.publicKey,
      durationRate: params.durationRate ?? 1,
      simulate: params.simulate ?? false,
    }),
  });
  if (!res.ok) throw new Error(`create-domain failed: ${res.status}`);
  return res.json() as Promise<DomainPurchaseResult>;
}

/** Type guard: is this a co-signer pre-signed transaction result? */
export function isCosignerResult(
  r: DomainPurchaseResult | CosignerPurchaseResult,
): r is CosignerPurchaseResult {
  return "transaction" in r;
}

/**
 * Get domain suggestions for a query (web2 excluded).
 * GET /api/suggestions/{domain}
 */
export async function fetchDomainSuggestions(
  domain: string,
): Promise<{ domain: string; exists: boolean }[]> {
  const res = await fetch(
    `${ALLDOMAINS_API}/api/suggestions/${encodeURIComponent(domain)}`,
  );
  if (!res.ok) return [];
  const results: { domain: string; exists: boolean }[] = await res.json();
  return results.filter((r) => {
    const dot = r.domain.lastIndexOf(".");
    if (dot === -1) return true;
    return !isWeb2Tld(r.domain.slice(dot));
  });
}
