/**
 * TLD House and Alt Name Service Helpers
 *
 * Utilities for working with domain names on Solana.
 */

import { PublicKey } from '@solana/web3.js';
import type { Connection } from '@solana/web3.js';
import { sha256 } from '@noble/hashes/sha2.js';

// Re-export program IDs from main program module
export { TLD_HOUSE_PROGRAM_ID, ALT_NAME_SERVICE_PROGRAM_ID } from '../program';

// Re-export PDA functions from main pda module
export {
  deriveTldHousePda,
  deriveNameAccountPda,
  deriveMainDomainPda,
} from '../pda';

// Import for internal use
import { ALT_NAME_SERVICE_PROGRAM_ID } from '../program';
import { deriveTldHousePda, deriveNameAccountPda, deriveMainDomainPda } from '../pda';

// Constants

/** Hash prefix used by Alt Name Service for PDA derivation */
export const HASH_PREFIX = 'ALT Name Service';

/** PDA seed constants */
export const TLD_HOUSE_PREFIX = 'tld_house';
export const TLD_PDA_SEED = 'tld_pda';
export const MAIN_DOMAIN_PREFIX = 'main_domain';

// Types

/** Name record header data */
export interface NameRecordHeader {
  /** Parent name account (for TLD hierarchy) */
  parentName: PublicKey;
  /** Owner of this name record */
  owner: PublicKey;
  /** Name class (categorization) */
  nclass: PublicKey;
  /** Expiration timestamp (0 = never expires) */
  expiresAt: number;
}

/** TLD House account data */
export interface TldHouseData {
  /** Treasury manager */
  treasuryManager: PublicKey;
  /** Authority */
  authority: PublicKey;
  /** TLD registry pubkey */
  tldRegistryPubkey: PublicKey;
  /** TLD string (e.g., ".sol") */
  tld: string;
}

/** Domain info with resolved data */
export interface DomainInfo {
  /** Full domain name (e.g., "example.sol") */
  name: string;
  /** Name without TLD (e.g., "example") */
  baseName: string;
  /** TLD (e.g., ".sol") */
  tld: string;
  /** Owner of the domain */
  owner: PublicKey;
  /** Name account pubkey */
  nameAccount: PublicKey;
  /** Expiration timestamp */
  expiresAt: number;
  /** Whether domain is expired */
  isExpired: boolean;
}

// Hash Functions

/**
 * Compute name hash for Alt Name Service PDA derivation.
 * hash = SHA256(HASH_PREFIX + name)
 *
 * @param name - Name string to hash
 * @returns 32-byte hash
 */
export function computeNameHash(name: string): Uint8Array {
  const encoder = new TextEncoder();
  const prefixBytes = encoder.encode(HASH_PREFIX);
  const nameBytes = encoder.encode(name);

  const combined = new Uint8Array(prefixBytes.length + nameBytes.length);
  combined.set(prefixBytes);
  combined.set(nameBytes, prefixBytes.length);

  return sha256(combined);
}

/**
 * Compute reverse lookup hash for a pubkey.
 * hash = SHA256(HASH_PREFIX + pubkey.toBase58())
 *
 * @param pubkey - Public key to create reverse lookup for
 * @returns 32-byte hash
 */
export function computeReverseLookupHash(pubkey: PublicKey): Uint8Array {
  const base58String = pubkey.toBase58();
  return computeNameHash(base58String);
}

// Additional PDA Derivation Functions

/**
 * Derive reverse lookup account PDA.
 *
 * @param nameAccount - Forward name account pubkey
 * @param tldHouse - TLD House account pubkey
 * @returns [pda, bump]
 */
export function deriveReverseLookupPda(
  nameAccount: PublicKey,
  tldHouse: PublicKey
): [PublicKey, number] {
  const hashedName = computeReverseLookupHash(nameAccount);
  const nullKey = PublicKey.default;

  return PublicKey.findProgramAddressSync(
    [hashedName, tldHouse.toBytes(), nullKey.toBytes()],
    ALT_NAME_SERVICE_PROGRAM_ID
  );
}

// Parsing Functions

/** Name record header size in bytes */
export const NAME_RECORD_HEADER_SIZE = 96;

/**
 * Parse name record header from account data.
 *
 * @param data - Account data buffer
 * @returns Parsed header or null if invalid
 */
export function parseNameRecordHeader(data: Buffer): NameRecordHeader | null {
  if (data.length < NAME_RECORD_HEADER_SIZE) {
    return null;
  }

  return {
    parentName: new PublicKey(data.subarray(0, 32)),
    owner: new PublicKey(data.subarray(32, 64)),
    nclass: new PublicKey(data.subarray(64, 96)),
    expiresAt: data.length >= 104 ? Number(data.readBigInt64LE(96)) : 0,
  };
}

/**
 * Extract domain name from name record data.
 *
 * @param data - Account data buffer
 * @returns Domain name string or null if invalid
 */
export function extractDomainName(data: Buffer): string | null {
  if (data.length <= NAME_RECORD_HEADER_SIZE) {
    return null;
  }

  const nameData = data.subarray(NAME_RECORD_HEADER_SIZE);

  // Find end of name (null terminated or end of buffer)
  let endIdx = nameData.indexOf(0);
  if (endIdx === -1) {
    endIdx = nameData.length;
  }

  if (endIdx === 0) {
    return null;
  }

  return new TextDecoder().decode(nameData.subarray(0, endIdx));
}

/**
 * Parse TLD House account data.
 *
 * @param data - Account data buffer
 * @returns Parsed TLD House data or null if invalid
 */
export function parseTldHouseData(data: Buffer): TldHouseData | null {
  // TLD House layout:
  // 8 bytes: discriminator
  // 32 bytes: treasury_manager
  // 32 bytes: authority
  // 32 bytes: tld_registry_pubkey
  // 4 bytes: tld string length
  // N bytes: tld string

  if (data.length < 108) {
    // 8 + 32 + 32 + 32 + 4
    return null;
  }

  const treasuryManager = new PublicKey(data.subarray(8, 40));
  const authority = new PublicKey(data.subarray(40, 72));
  const tldRegistryPubkey = new PublicKey(data.subarray(72, 104));

  const tldLength = data.readUInt32LE(104);
  if (data.length < 108 + tldLength) {
    return null;
  }

  const tld = new TextDecoder().decode(data.subarray(108, 108 + tldLength));

  return {
    treasuryManager,
    authority,
    tldRegistryPubkey,
    tld,
  };
}

// Validation Functions

/**
 * Validate a domain name format.
 *
 * @param name - Domain name to validate
 * @returns true if valid format
 */
export function isValidDomainName(name: string): boolean {
  // Domain names: alphanumeric, hyphens, 1-63 chars
  const domainRegex = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/i;
  return domainRegex.test(name);
}

/**
 * Check if a name record is expired.
 *
 * @param header - Name record header
 * @param currentTimestamp - Current Unix timestamp
 * @returns true if expired
 */
export function isNameExpired(header: NameRecordHeader, currentTimestamp: number): boolean {
  if (header.expiresAt === 0) {
    return false; // Never expires
  }
  return currentTimestamp > header.expiresAt;
}

// Fetch Functions

/**
 * Fetch domain info by name.
 *
 * @param connection - Solana connection
 * @param domainName - Full domain name (e.g., "example.sol")
 * @returns Domain info or null if not found
 */
export async function fetchDomainInfo(
  connection: Connection,
  domainName: string
): Promise<DomainInfo | null> {
  // Parse domain name
  const parts = domainName.split('.');
  if (parts.length !== 2) {
    return null;
  }

  const baseName = parts[0]!;
  const tldPart = parts[1]!;
  const tld = '.' + tldPart;

  // Derive TLD House PDA
  const [tldHouse] = deriveTldHousePda(tld);

  // Fetch TLD House to get TLD registry
  const tldHouseInfo = await connection.getAccountInfo(tldHouse);
  if (!tldHouseInfo || !tldHouseInfo.data) {
    return null;
  }

  const tldHouseData = parseTldHouseData(Buffer.from(tldHouseInfo.data));
  if (!tldHouseData) {
    return null;
  }

  // Derive name account PDA
  const [nameAccount] = deriveNameAccountPda(baseName, tldHouseData.tldRegistryPubkey);

  // Fetch name account
  const nameAccountInfo = await connection.getAccountInfo(nameAccount);
  if (!nameAccountInfo || !nameAccountInfo.data) {
    return null;
  }

  const header = parseNameRecordHeader(Buffer.from(nameAccountInfo.data));
  if (!header) {
    return null;
  }

  const currentTimestamp = Math.floor(Date.now() / 1000);

  return {
    name: domainName,
    baseName,
    tld,
    owner: header.owner,
    nameAccount,
    expiresAt: header.expiresAt,
    isExpired: isNameExpired(header, currentTimestamp),
  };
}

/**
 * Fetch the main domain for an owner.
 *
 * @param connection - Solana connection
 * @param owner - Owner's wallet pubkey
 * @param tld - TLD to check (e.g., ".sol")
 * @returns Domain name or null if not set
 */
export async function fetchMainDomain(
  connection: Connection,
  owner: PublicKey,
  tld: string
): Promise<string | null> {
  const [tldHouse] = deriveTldHousePda(tld);
  const [mainDomainPda] = deriveMainDomainPda(owner);

  const accountInfo = await connection.getAccountInfo(mainDomainPda);
  if (!accountInfo || !accountInfo.data) {
    return null;
  }

  // Main domain account contains the name account pubkey
  // Then we need to reverse lookup to get the name
  const data = Buffer.from(accountInfo.data);
  if (data.length < 40) {
    // 8 (discriminator) + 32 (name account)
    return null;
  }

  const nameAccountPubkey = new PublicKey(data.subarray(8, 40));

  // Derive reverse lookup
  const [reversePda] = deriveReverseLookupPda(nameAccountPubkey, tldHouse);

  const reverseInfo = await connection.getAccountInfo(reversePda);
  if (!reverseInfo || !reverseInfo.data) {
    return null;
  }

  const domainName = extractDomainName(Buffer.from(reverseInfo.data));
  if (!domainName) {
    return null;
  }

  return domainName + tld;
}

/**
 * Resolve a domain name to owner pubkey.
 *
 * @param connection - Solana connection
 * @param domainName - Full domain name (e.g., "example.sol")
 * @returns Owner pubkey or null if not found
 */
export async function resolveDomain(
  connection: Connection,
  domainName: string
): Promise<PublicKey | null> {
  const info = await fetchDomainInfo(connection, domainName);
  if (!info || info.isExpired) {
    return null;
  }
  return info.owner;
}

/**
 * Reverse lookup: find domain name for an owner.
 *
 * @param connection - Solana connection
 * @param owner - Owner's wallet pubkey
 * @param tld - TLD to check (e.g., ".sol")
 * @returns Domain name or null if not found
 */
export async function reverseLookup(
  connection: Connection,
  owner: PublicKey,
  tld: string
): Promise<string | null> {
  return fetchMainDomain(connection, owner, tld);
}
