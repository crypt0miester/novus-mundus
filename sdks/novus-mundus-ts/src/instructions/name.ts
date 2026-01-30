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

import {
  PublicKey,
  TransactionInstruction,
  SystemProgram,
} from '@solana/web3.js';
import { PROGRAM_ID, DISCRIMINATORS, ALT_NAME_SERVICE_PROGRAM_ID, TLD_HOUSE_PROGRAM_ID } from '../program.ts';
import { BufferWriter, createInstructionData } from '../utils/serialize.ts';
import {
  derivePlayerPda,
  deriveNameAccountPda,
  deriveReverseNameAccountPda,
  deriveMainDomainPda,
  deriveTldStatePda,
  deriveTldHousePda,
  getHashedName,
} from '../pda.ts';

// ============================================================
// Set Player Name
// ============================================================

export interface SetPlayerNameAccounts {
  /** Player's wallet (signer) */
  owner: PublicKey;
  /** GameEngine PDA */
  gameEngine: PublicKey;
  /** TLD for the domain (e.g., "sol") */
  tld: string;
  /** Domain name without TLD (e.g., "myname") */
  domainName: string;
}

/**
 * Set a domain name as the player's display name.
 *
 * Transfers the domain to the player account PDA.
 * Domain must be owned by the player's wallet.
 * Also sets the main domain via TLD House CPI so the player PDA's primary name is set.
 */
export function createSetPlayerNameInstruction(
  accounts: SetPlayerNameAccounts
): TransactionInstruction {
  const [player] = derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [tldHouse] = deriveTldHousePda(accounts.tld);
  const [tldState] = deriveTldStatePda();
  const [mainDomain] = deriveMainDomainPda(player);
  const [nameParent] = deriveTldHousePda(accounts.tld); // TLD account (same as tldHouse)
  const [nameAccount] = deriveNameAccountPda(accounts.domainName, nameParent);
  const [reverseNameAccount] = deriveReverseNameAccountPda(nameAccount, tldHouse);

  // NULL_PUBKEY for standard domains (name_class)
  const nameClass = PublicKey.default;

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
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: ALT_NAME_SERVICE_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: TLD_HOUSE_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  // Instruction data: reverse_acc_hashed_name (32 bytes)
  // This is the hash used to derive/verify the reverse name account
  const reverseAccHashedName = getHashedName(nameAccount.toBase58());

  const writer = new BufferWriter(32);
  writer.writeBytes(Buffer.from(reverseAccHashedName));

  const data = createInstructionData(DISCRIMINATORS.NAME_SET_PLAYER, writer.toBuffer());

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// ============================================================
// Update Player Name
// ============================================================

export interface UpdatePlayerNameAccounts {
  /** Player's wallet (signer) */
  owner: PublicKey;
  /** GameEngine PDA */
  gameEngine: PublicKey;
  /** New TLD */
  tld: string;
  /** New domain name */
  domainName: string;
  /** Old domain name (for transfer back) */
  oldDomainName: string;
  /** Old TLD */
  oldTld: string;
}

/**
 * Update player's display name to a different domain.
 *
 * Transfers old domain back to wallet, sets new domain.
 */
export function createUpdatePlayerNameInstruction(
  accounts: UpdatePlayerNameAccounts
): TransactionInstruction {
  const [player] = derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [tldHouse] = deriveTldHousePda(accounts.tld);
  const [tldState] = deriveTldStatePda();
  const [mainDomain] = deriveMainDomainPda(player);
  const [nameParent] = deriveTldHousePda(accounts.tld);
  const [nameAccount] = deriveNameAccountPda(accounts.domainName, nameParent);
  const [reverseNameAccount] = deriveReverseNameAccountPda(nameAccount, tldHouse);

  // Old domain accounts
  const [oldNameParent] = deriveTldHousePda(accounts.oldTld);
  const [oldNameAccount] = deriveNameAccountPda(accounts.oldDomainName, oldNameParent);

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

  // Instruction data: same as set_player
  const nameBytes = Buffer.from(accounts.domainName, 'utf8');
  const tldBytes = Buffer.from(accounts.tld, 'utf8');
  const hashedName = getHashedName(accounts.domainName);

  const writer = new BufferWriter(1 + nameBytes.length + 1 + tldBytes.length + 32);
  writer.writeU8(nameBytes.length);
  writer.writeBytes(nameBytes);
  writer.writeU8(tldBytes.length);
  writer.writeBytes(tldBytes);
  writer.writeBytes(Buffer.from(hashedName));

  const data = createInstructionData(DISCRIMINATORS.NAME_UPDATE_PLAYER, writer.toBuffer());

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// ============================================================
// Remove Player Name
// ============================================================

export interface RemovePlayerNameAccounts {
  /** Player's wallet (signer) */
  owner: PublicKey;
  /** GameEngine PDA */
  gameEngine: PublicKey;
  /** Current TLD */
  tld: string;
  /** Current domain name */
  domainName: string;
}

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
export function createRemovePlayerNameInstruction(
  accounts: RemovePlayerNameAccounts
): TransactionInstruction {
  const [player] = derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [tldHouse] = deriveTldHousePda(accounts.tld);
  const [nameParent] = deriveTldHousePda(accounts.tld);
  const [nameAccount] = deriveNameAccountPda(accounts.domainName, nameParent);
  const [reverseNameAccount] = deriveReverseNameAccountPda(nameAccount, tldHouse);

  // NULL_PUBKEY for standard domains (name_class)
  const nameClass = PublicKey.default;

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
  const reverseAccHashedName = getHashedName(nameAccount.toBase58());

  const writer = new BufferWriter(32);
  writer.writeBytes(Buffer.from(reverseAccHashedName));

  const data = createInstructionData(DISCRIMINATORS.NAME_REMOVE_PLAYER, writer.toBuffer());

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// ============================================================
// Set Team Name
// ============================================================

export interface SetTeamNameAccounts {
  /** Leader's wallet (signer) */
  leader: PublicKey;
  /** GameEngine PDA */
  gameEngine: PublicKey;
  /** Team account */
  team: PublicKey;
  /** TLD */
  tld: string;
  /** Domain name */
  domainName: string;
}

/**
 * Set a domain name as the team's display name.
 *
 * Only team leader can set team name.
 */
export function createSetTeamNameInstruction(
  accounts: SetTeamNameAccounts
): TransactionInstruction {
  const [leaderPlayer] = derivePlayerPda(accounts.gameEngine, accounts.leader);
  const [tldHouse] = deriveTldHousePda(accounts.tld);
  const [tldState] = deriveTldStatePda();
  const [mainDomain] = deriveMainDomainPda(accounts.team);
  const [nameParent] = deriveTldHousePda(accounts.tld);
  const [nameAccount] = deriveNameAccountPda(accounts.domainName, nameParent);
  const [reverseNameAccount] = deriveReverseNameAccountPda(nameAccount, tldHouse);

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

  const nameBytes = Buffer.from(accounts.domainName, 'utf8');
  const tldBytes = Buffer.from(accounts.tld, 'utf8');
  const hashedName = getHashedName(accounts.domainName);

  const writer = new BufferWriter(1 + nameBytes.length + 1 + tldBytes.length + 32);
  writer.writeU8(nameBytes.length);
  writer.writeBytes(nameBytes);
  writer.writeU8(tldBytes.length);
  writer.writeBytes(tldBytes);
  writer.writeBytes(Buffer.from(hashedName));

  const data = createInstructionData(DISCRIMINATORS.NAME_SET_TEAM, writer.toBuffer());

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// ============================================================
// Update Team Name
// ============================================================

export interface UpdateTeamNameAccounts {
  /** Leader's wallet (signer) */
  leader: PublicKey;
  /** GameEngine PDA */
  gameEngine: PublicKey;
  /** Team account */
  team: PublicKey;
  /** New TLD */
  tld: string;
  /** New domain name */
  domainName: string;
  /** Old TLD */
  oldTld: string;
  /** Old domain name */
  oldDomainName: string;
}

/**
 * Update team's display name to a different domain.
 */
export function createUpdateTeamNameInstruction(
  accounts: UpdateTeamNameAccounts
): TransactionInstruction {
  const [leaderPlayer] = derivePlayerPda(accounts.gameEngine, accounts.leader);
  const [tldHouse] = deriveTldHousePda(accounts.tld);
  const [tldState] = deriveTldStatePda();
  const [mainDomain] = deriveMainDomainPda(accounts.team);
  const [nameParent] = deriveTldHousePda(accounts.tld);
  const [nameAccount] = deriveNameAccountPda(accounts.domainName, nameParent);
  const [reverseNameAccount] = deriveReverseNameAccountPda(nameAccount, tldHouse);

  // Old domain
  const [oldNameParent] = deriveTldHousePda(accounts.oldTld);
  const [oldNameAccount] = deriveNameAccountPda(accounts.oldDomainName, oldNameParent);

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

  const nameBytes = Buffer.from(accounts.domainName, 'utf8');
  const tldBytes = Buffer.from(accounts.tld, 'utf8');
  const hashedName = getHashedName(accounts.domainName);

  const writer = new BufferWriter(1 + nameBytes.length + 1 + tldBytes.length + 32);
  writer.writeU8(nameBytes.length);
  writer.writeBytes(nameBytes);
  writer.writeU8(tldBytes.length);
  writer.writeBytes(tldBytes);
  writer.writeBytes(Buffer.from(hashedName));

  const data = createInstructionData(DISCRIMINATORS.NAME_UPDATE_TEAM, writer.toBuffer());

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// ============================================================
// Remove Team Name
// ============================================================

export interface RemoveTeamNameAccounts {
  /** Leader's wallet (signer) */
  leader: PublicKey;
  /** GameEngine PDA */
  gameEngine: PublicKey;
  /** Team account */
  team: PublicKey;
  /** Current TLD */
  tld: string;
  /** Current domain name */
  domainName: string;
}

/**
 * Remove team's display name (transfer domain back to leader).
 */
export function createRemoveTeamNameInstruction(
  accounts: RemoveTeamNameAccounts
): TransactionInstruction {
  const [leaderPlayer] = derivePlayerPda(accounts.gameEngine, accounts.leader);
  const [tldHouse] = deriveTldHousePda(accounts.tld);
  const [mainDomain] = deriveMainDomainPda(accounts.team);
  const [nameParent] = deriveTldHousePda(accounts.tld);
  const [nameAccount] = deriveNameAccountPda(accounts.domainName, nameParent);

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

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}
