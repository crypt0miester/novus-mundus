/**
 * On-chain domain resolution via @onsol/tldparser.
 *
 * - Single:  getMainDomain()   (profile page, settings)
 * - Batched: getMainDomains()  (leaderboards, garrison lists, combat logs)
 *
 * Both methods use getMultipleAccountsInfo under the hood.
 */

import type { Connection, PublicKey } from "@solana/web3.js";
import { TldParser } from "@onsol/tldparser";
import type { MainDomain } from "@onsol/tldparser";

// Singleton per connection (same RPC = same parser)
let _parser: TldParser | null = null;
let _connId: string | null = null;

function getParser(connection: Connection): TldParser {
  const id = connection.rpcEndpoint;
  if (_parser && _connId === id) return _parser;
  _parser = new TldParser(connection);
  _connId = id;
  return _parser;
}

/** Resolve a single wallet to "domain.tld" or null. */
export async function resolveDomainName(
  connection: Connection,
  owner: PublicKey | string,
): Promise<string | null> {
  try {
    const parser = getParser(connection);
    const main = (await parser.getMainDomain(owner)) as MainDomain;
    if (!main?.domain) return null;
    return `${main.domain}${main.tld}`;
  } catch {
    return null;
  }
}

/**
 * Batch-resolve wallets to domain names.
 * Uses getMultipleAccountsInfo internally (max ~100 per call).
 *
 * Returns a Map<base58, domainString | null>.
 */
export async function resolveDomainNamesBatched(
  connection: Connection,
  owners: (PublicKey | string)[],
): Promise<Map<string, string | null>> {
  const result = new Map<string, string | null>();
  if (owners.length === 0) return result;

  const parser = getParser(connection);
  const addresses = owners.map((o) => (typeof o === "string" ? o : o.toBase58()));

  try {
    const domains = await parser.getMainDomains(addresses);

    for (let i = 0; i < addresses.length; i++) {
      result.set(addresses[i]!, domains[i] ?? null);
    }
  } catch {
    // On error, set all to null
    for (const addr of addresses) {
      result.set(addr, null);
    }
  }

  return result;
}

/**
 * Fetch all parsed domains owned by a wallet.
 * Returns array of { nameAccount, domain } sorted alphabetically.
 */
export async function getOwnedDomains(connection: Connection, owner: PublicKey | string) {
  const parser = getParser(connection);
  return parser.getParsedAllUserDomains(owner);
}
