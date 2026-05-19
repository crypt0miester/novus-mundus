/**
 * Name Instructions
 *
 * Instructions for name service integration (ANS/TLD House):
 * - Set player name
 * - Update player name
 * - Remove player name
 * - Set team name
 * - Update team name
 * - Remove team name
 */

import type { Address, Instruction } from '@solana/kit';
import { address } from '@solana/kit';
import { PROGRAM_ID, DISCRIMINATORS, ALT_NAME_SERVICE_PROGRAM_ID, TLD_HOUSE_PROGRAM_ID, SYSTEM_PROGRAM_ID } from '../program';
import { buildInstruction } from '../instruction';
import { createInstructionData } from '../utils/serialize';
import { packed, bytes } from '../utils/codec';
import {
  derivePlayerPda,
  deriveNameAccountPda,
  deriveReverseNameAccountPda,
  deriveMainDomainPda,
  deriveTldStatePda,
  deriveTldHousePda,
  getHashedName,
} from '../pda';

/**
 * Args for set/remove player name: reverse_acc_hashed_name ([u8; 32]).
 * The 32-byte hash used to derive/verify the reverse name account.
 */
const hashedNameArgs = packed<{ reverseAccHashedName: Uint8Array }>([
  ['reverseAccHashedName', bytes(32)],
], 32);

/**
 * Encode variable-length name args used by update-player/set-team/update-team:
 * name_len (u8) + name bytes + tld_len (u8) + tld bytes + hashed_name (32 bytes).
 *
 * The payload length depends on the runtime string lengths, so it cannot be a
 * fixed-size `packed` codec — assembled manually into a `Uint8Array`.
 */
function encodeNameArgs(domainName: string, tld: string): Uint8Array {
  const nameBytes = utf8.encode(domainName);
  const tldBytes = utf8.encode(tld);
  const hashedName = Uint8Array.from(getHashedName(domainName));

  const out = new Uint8Array(1 + nameBytes.length + 1 + tldBytes.length + 32);
  let off = 0;
  out[off++] = nameBytes.length;
  out.set(nameBytes, off);
  off += nameBytes.length;
  out[off++] = tldBytes.length;
  out.set(tldBytes, off);
  off += tldBytes.length;
  out.set(hashedName, off);
  return out;
}

const utf8 = new TextEncoder();

// Set Player Name

export interface SetPlayerNameAccounts {
  /** Player's wallet (signer) */
  owner: Address;
  /** GameEngine PDA */
  gameEngine: Address;
  /** TLD for the domain (e.g., "sol") */
  tld: string;
  /** Domain name without TLD (e.g., "myname") */
  domainName: string;
}

/** ~10,000 CU */
/**
 * Set a domain name as the player's display name.
 *
 * Transfers the domain to the player account PDA.
 * Domain must be owned by the player's wallet.
 * Also sets the main domain via TLD House CPI so the player PDA's primary name is set.
 */
export async function createSetPlayerNameInstruction(
  accounts: SetPlayerNameAccounts
): Promise<Instruction> {
  const [player] = await derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [tldHouse] = await deriveTldHousePda(accounts.tld);
  const [tldState] = await deriveTldStatePda();
  const [mainDomain] = await deriveMainDomainPda(player);
  const [nameParent] = await deriveTldHousePda(accounts.tld); // TLD account (same as tldHouse)
  const [nameAccount] = await deriveNameAccountPda(accounts.domainName, nameParent);
  const [reverseNameAccount] = await deriveReverseNameAccountPda(nameAccount, tldHouse);

  // NULL_PUBKEY for standard domains (name_class)
  const nameClass = address('11111111111111111111111111111111');

  // Rust account order:
  // 0. player (WRITE)
  // 1. name_account (WRITE)
  // 2. reverse_name_account (READ)
  // 3. name_class (READ) - NULL_PUBKEY for standard domains
  // 4. name_parent (READ)
  // 5. tld_house (READ)
  // 6. tld_state (READ)
  // 7. main_domain (WRITE)
  // 8. owner (SIGNER)
  // 9. system_program (READ)
  // 10. alt_name_service_program (READ)
  // 11. tld_house_program (READ)
  const keys = [
    { pubkey: player, isSigner: false, isWritable: true },
    { pubkey: nameAccount, isSigner: false, isWritable: true },
    { pubkey: reverseNameAccount, isSigner: false, isWritable: false },
    { pubkey: nameClass, isSigner: false, isWritable: false },
    { pubkey: nameParent, isSigner: false, isWritable: false },
    { pubkey: tldHouse, isSigner: false, isWritable: false },
    { pubkey: tldState, isSigner: false, isWritable: false },
    { pubkey: mainDomain, isSigner: false, isWritable: true },
    { pubkey: accounts.owner, isSigner: true, isWritable: false },
    { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: ALT_NAME_SERVICE_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: TLD_HOUSE_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  // Instruction data: reverse_acc_hashed_name (32 bytes)
  // This is the hash used to derive/verify the reverse name account
  const data = createInstructionData(
    DISCRIMINATORS.NAME_SET_PLAYER,
    hashedNameArgs.encode({
      reverseAccHashedName: Uint8Array.from(getHashedName(nameAccount)),
    })
  );

  return buildInstruction(PROGRAM_ID, keys, data);
}

// Update Player Name

export interface UpdatePlayerNameAccounts {
  /** Player's wallet (signer) */
  owner: Address;
  /** GameEngine PDA */
  gameEngine: Address;
  /** New TLD */
  tld: string;
  /** New domain name */
  domainName: string;
  /** Old domain name (for transfer back) */
  oldDomainName: string;
  /** Old TLD */
  oldTld: string;
}

/** ~10,000 CU */
/**
 * Update player's display name to a different domain.
 *
 * Transfers old domain back to wallet, sets new domain.
 */
export async function createUpdatePlayerNameInstruction(
  accounts: UpdatePlayerNameAccounts
): Promise<Instruction> {
  const [player] = await derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [tldHouse] = await deriveTldHousePda(accounts.tld);
  const [tldState] = await deriveTldStatePda();
  const [mainDomain] = await deriveMainDomainPda(player);
  const [nameParent] = await deriveTldHousePda(accounts.tld);
  const [nameAccount] = await deriveNameAccountPda(accounts.domainName, nameParent);
  const [reverseNameAccount] = await deriveReverseNameAccountPda(nameAccount, tldHouse);

  // Old domain accounts
  const [oldNameParent] = await deriveTldHousePda(accounts.oldTld);
  const [oldNameAccount] = await deriveNameAccountPda(accounts.oldDomainName, oldNameParent);

  const keys = [
    { pubkey: player, isSigner: false, isWritable: true },
    { pubkey: accounts.owner, isSigner: true, isWritable: true },
    { pubkey: nameAccount, isSigner: false, isWritable: true },
    { pubkey: reverseNameAccount, isSigner: false, isWritable: true },
    { pubkey: nameParent, isSigner: false, isWritable: false },
    { pubkey: tldHouse, isSigner: false, isWritable: false },
    { pubkey: tldState, isSigner: false, isWritable: false },
    { pubkey: mainDomain, isSigner: false, isWritable: true },
    { pubkey: oldNameAccount, isSigner: false, isWritable: true },
    { pubkey: ALT_NAME_SERVICE_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: TLD_HOUSE_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  // Instruction data (variable length): name_len (u8) + name + tld_len (u8) + tld + hash (32)
  const data = createInstructionData(
    DISCRIMINATORS.NAME_UPDATE_PLAYER,
    encodeNameArgs(accounts.domainName, accounts.tld)
  );

  return buildInstruction(PROGRAM_ID, keys, data);
}

// Remove Player Name

export interface RemovePlayerNameAccounts {
  /** Player's wallet (signer) */
  owner: Address;
  /** GameEngine PDA */
  gameEngine: Address;
  /** Current TLD */
  tld: string;
  /** Current domain name */
  domainName: string;
}

/** ~5,000 CU */
/**
 * Remove player's display name (transfer domain back to wallet).
 *
 * Rust account order (8):
 * 0. [writable] player: PlayerAccount PDA
 * 1. [writable] name_account: The domain's name account
 * 2. [] reverse_name_account: The domain's reverse lookup account
 * 3. [] name_class: Name class account (NULL_PUBKEY for standard domains)
 * 4. [] name_parent: Parent TLD account
 * 5. [] tld_house: TldHouse account
 * 6. [signer] owner: Player wallet
 * 7. [] alt_name_service_program: Alt Name Service program
 *
 * Instruction data (32 bytes):
 * - reverse_acc_hashed_name: [u8; 32]
 */
export async function createRemovePlayerNameInstruction(
  accounts: RemovePlayerNameAccounts
): Promise<Instruction> {
  const [player] = await derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [tldHouse] = await deriveTldHousePda(accounts.tld);
  const [nameParent] = await deriveTldHousePda(accounts.tld);
  const [nameAccount] = await deriveNameAccountPda(accounts.domainName, nameParent);
  const [reverseNameAccount] = await deriveReverseNameAccountPda(nameAccount, tldHouse);

  // NULL_PUBKEY for standard domains (name_class)
  const nameClass = address('11111111111111111111111111111111');

  const keys = [
    { pubkey: player, isSigner: false, isWritable: true },
    { pubkey: nameAccount, isSigner: false, isWritable: true },
    { pubkey: reverseNameAccount, isSigner: false, isWritable: false },
    { pubkey: nameClass, isSigner: false, isWritable: false },
    { pubkey: nameParent, isSigner: false, isWritable: false },
    { pubkey: tldHouse, isSigner: false, isWritable: false },
    { pubkey: accounts.owner, isSigner: true, isWritable: false },
    { pubkey: ALT_NAME_SERVICE_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  // Instruction data: reverse_acc_hashed_name (32 bytes)
  const data = createInstructionData(
    DISCRIMINATORS.NAME_REMOVE_PLAYER,
    hashedNameArgs.encode({
      reverseAccHashedName: Uint8Array.from(getHashedName(nameAccount)),
    })
  );

  return buildInstruction(PROGRAM_ID, keys, data);
}

// Set Team Name

export interface SetTeamNameAccounts {
  /** Leader's wallet (signer) */
  leader: Address;
  /** GameEngine PDA */
  gameEngine: Address;
  /** Team account */
  team: Address;
  /** TLD */
  tld: string;
  /** Domain name */
  domainName: string;
}

/** ~10,000 CU */
/**
 * Set a domain name as the team's display name.
 *
 * Only team leader can set team name.
 */
export async function createSetTeamNameInstruction(
  accounts: SetTeamNameAccounts
): Promise<Instruction> {
  const [leaderPlayer] = await derivePlayerPda(accounts.gameEngine, accounts.leader);
  const [tldHouse] = await deriveTldHousePda(accounts.tld);
  const [tldState] = await deriveTldStatePda();
  const [mainDomain] = await deriveMainDomainPda(accounts.team);
  const [nameParent] = await deriveTldHousePda(accounts.tld);
  const [nameAccount] = await deriveNameAccountPda(accounts.domainName, nameParent);
  const [reverseNameAccount] = await deriveReverseNameAccountPda(nameAccount, tldHouse);

  const keys = [
    { pubkey: leaderPlayer, isSigner: false, isWritable: false },
    { pubkey: accounts.leader, isSigner: true, isWritable: true },
    { pubkey: accounts.team, isSigner: false, isWritable: true },
    { pubkey: nameAccount, isSigner: false, isWritable: true },
    { pubkey: reverseNameAccount, isSigner: false, isWritable: true },
    { pubkey: nameParent, isSigner: false, isWritable: false },
    { pubkey: tldHouse, isSigner: false, isWritable: false },
    { pubkey: tldState, isSigner: false, isWritable: false },
    { pubkey: mainDomain, isSigner: false, isWritable: true },
    { pubkey: ALT_NAME_SERVICE_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: TLD_HOUSE_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  const data = createInstructionData(
    DISCRIMINATORS.NAME_SET_TEAM,
    encodeNameArgs(accounts.domainName, accounts.tld)
  );

  return buildInstruction(PROGRAM_ID, keys, data);
}

// Update Team Name

export interface UpdateTeamNameAccounts {
  /** Leader's wallet (signer) */
  leader: Address;
  /** GameEngine PDA */
  gameEngine: Address;
  /** Team account */
  team: Address;
  /** New TLD */
  tld: string;
  /** New domain name */
  domainName: string;
  /** Old TLD */
  oldTld: string;
  /** Old domain name */
  oldDomainName: string;
}

/** ~10,000 CU */
/**
 * Update team's display name to a different domain.
 */
export async function createUpdateTeamNameInstruction(
  accounts: UpdateTeamNameAccounts
): Promise<Instruction> {
  const [leaderPlayer] = await derivePlayerPda(accounts.gameEngine, accounts.leader);
  const [tldHouse] = await deriveTldHousePda(accounts.tld);
  const [tldState] = await deriveTldStatePda();
  const [mainDomain] = await deriveMainDomainPda(accounts.team);
  const [nameParent] = await deriveTldHousePda(accounts.tld);
  const [nameAccount] = await deriveNameAccountPda(accounts.domainName, nameParent);
  const [reverseNameAccount] = await deriveReverseNameAccountPda(nameAccount, tldHouse);

  // Old domain
  const [oldNameParent] = await deriveTldHousePda(accounts.oldTld);
  const [oldNameAccount] = await deriveNameAccountPda(accounts.oldDomainName, oldNameParent);

  const keys = [
    { pubkey: leaderPlayer, isSigner: false, isWritable: false },
    { pubkey: accounts.leader, isSigner: true, isWritable: true },
    { pubkey: accounts.team, isSigner: false, isWritable: true },
    { pubkey: nameAccount, isSigner: false, isWritable: true },
    { pubkey: reverseNameAccount, isSigner: false, isWritable: true },
    { pubkey: nameParent, isSigner: false, isWritable: false },
    { pubkey: tldHouse, isSigner: false, isWritable: false },
    { pubkey: tldState, isSigner: false, isWritable: false },
    { pubkey: mainDomain, isSigner: false, isWritable: true },
    { pubkey: oldNameAccount, isSigner: false, isWritable: true },
    { pubkey: ALT_NAME_SERVICE_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: TLD_HOUSE_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  const data = createInstructionData(
    DISCRIMINATORS.NAME_UPDATE_TEAM,
    encodeNameArgs(accounts.domainName, accounts.tld)
  );

  return buildInstruction(PROGRAM_ID, keys, data);
}

// Remove Team Name

export interface RemoveTeamNameAccounts {
  /** Leader's wallet (signer) */
  leader: Address;
  /** GameEngine PDA */
  gameEngine: Address;
  /** Team account */
  team: Address;
  /** Current TLD */
  tld: string;
  /** Current domain name */
  domainName: string;
}

/** ~5,000 CU */
/**
 * Remove team's display name (transfer domain back to leader).
 */
export async function createRemoveTeamNameInstruction(
  accounts: RemoveTeamNameAccounts
): Promise<Instruction> {
  const [leaderPlayer] = await derivePlayerPda(accounts.gameEngine, accounts.leader);
  const [tldHouse] = await deriveTldHousePda(accounts.tld);
  const [mainDomain] = await deriveMainDomainPda(accounts.team);
  const [nameParent] = await deriveTldHousePda(accounts.tld);
  const [nameAccount] = await deriveNameAccountPda(accounts.domainName, nameParent);

  const keys = [
    { pubkey: leaderPlayer, isSigner: false, isWritable: false },
    { pubkey: accounts.leader, isSigner: true, isWritable: true },
    { pubkey: accounts.team, isSigner: false, isWritable: true },
    { pubkey: nameAccount, isSigner: false, isWritable: true },
    { pubkey: tldHouse, isSigner: false, isWritable: false },
    { pubkey: mainDomain, isSigner: false, isWritable: true },
    { pubkey: ALT_NAME_SERVICE_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: TLD_HOUSE_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  const data = createInstructionData(DISCRIMINATORS.NAME_REMOVE_TEAM);

  return buildInstruction(PROGRAM_ID, keys, data);
}
