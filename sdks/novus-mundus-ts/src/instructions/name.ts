/**
 * Name Instructions
 *
 * Player display names backed by an AllDomains (ANS) domain:
 * - Set player name   (transfer domain: wallet → player PDA)
 * - Update player name (swap domains: old → wallet, new → player PDA)
 * - Remove player name (transfer domain: player PDA → wallet)
 *
 * The domain is held directly by the player PDA. We do NOT register a TLD-House
 * MainDomain: set_main_domain funds its `init` with a System transfer from the
 * payer (which must be the domain owner — the player PDA), and a System transfer
 * cannot debit a program-owned account that carries data. Team names are
 * unsupported for the same reason.
 */

import { PublicKey, TransactionInstruction } from '@solana/web3.js';
import { PROGRAM_ID, DISCRIMINATORS, ALT_NAME_SERVICE_PROGRAM_ID } from '../program';
import { BufferWriter, createInstructionData } from '../utils/serialize';
import {
  derivePlayerPda,
  deriveNameAccountPda,
  deriveReverseNameAccountPda,
  deriveTldHousePda,
  getHashedName,
} from '../pda';

// Set Player Name

export interface SetPlayerNameAccounts {
  /** Player's wallet (signer) */
  owner: PublicKey;
  /** GameEngine PDA */
  gameEngine: PublicKey;
  /** TLD for the domain (e.g., "sol") */
  tld: string;
  /** Domain name without TLD (e.g., "myname") */
  domainName: string;
  /**
   * Override the TldHouse account. Defaults to `deriveTldHousePda(tld)`, which
   * is correct for houses created at the canonical PDA. Some legacy TLDs (e.g.
   * `.solana`) live at a non-canonical house address and must be passed here.
   */
  tldHouse?: PublicKey;
  /**
   * Override the name_parent (the TLD's registry NameRecord). Defaults to the
   * TldHouse PDA. For TLDs whose `tld_registry_pubkey` differs from the house
   * (e.g. `.solana`), pass the registry record here.
   */
  nameParent?: PublicKey;
}

/** ~7,000 CU */
/**
 * Set a domain name as the player's display name.
 *
 * Transfers the domain to the player account PDA. Domain must be owned by the
 * player's wallet.
 */
export async function createSetPlayerNameInstruction(
  accounts: SetPlayerNameAccounts
): Promise<TransactionInstruction> {
  const [player] = await derivePlayerPda(accounts.gameEngine, accounts.owner);
  const tldHouse = accounts.tldHouse ?? (await deriveTldHousePda(accounts.tld))[0];
  const nameParent = accounts.nameParent ?? tldHouse;
  const [nameAccount] = await deriveNameAccountPda(accounts.domainName, nameParent);
  const [reverseNameAccount] = await deriveReverseNameAccountPda(nameAccount, tldHouse);

  const nameClass = PublicKey.default; // NULL_PUBKEY for standard domains

  // Rust account order (8):
  // 0. player (WRITE)  1. name_account (WRITE)  2. reverse_name_account
  // 3. name_class  4. name_parent  5. tld_house
  // 6. owner (SIGNER, WRITE)  7. alt_name_service_program
  const keys = [
    { pubkey: player, isSigner: false, isWritable: true },
    { pubkey: nameAccount, isSigner: false, isWritable: true },
    { pubkey: reverseNameAccount, isSigner: false, isWritable: false },
    { pubkey: nameClass, isSigner: false, isWritable: false },
    { pubkey: nameParent, isSigner: false, isWritable: false },
    { pubkey: tldHouse, isSigner: false, isWritable: false },
    // owner is the mut signer of the ANS domain transfer.
    { pubkey: accounts.owner, isSigner: true, isWritable: true },
    { pubkey: ALT_NAME_SERVICE_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  // Instruction data: reverse_acc_hashed_name (32 bytes), used to derive/verify
  // the reverse name account on-chain.
  const writer = new BufferWriter(32);
  writer.writeBytes(getHashedName(nameAccount.toBase58()));

  const data = createInstructionData(DISCRIMINATORS.NAME_SET_PLAYER, writer.toBuffer());
  return new TransactionInstruction({ keys, programId: PROGRAM_ID, data });
}

// Update Player Name

export interface UpdatePlayerNameAccounts {
  /** Player's wallet (signer) */
  owner: PublicKey;
  /** GameEngine PDA */
  gameEngine: PublicKey;
  /** TLD shared by both old and new domains (the processor takes one name_parent) */
  tld: string;
  /** New domain name */
  domainName: string;
  /** Old domain name (transferred back to the wallet) */
  oldDomainName: string;
  /** Override the TldHouse account (see {@link SetPlayerNameAccounts.tldHouse}). */
  tldHouse?: PublicKey;
  /** Override the name_parent registry record (see {@link SetPlayerNameAccounts.nameParent}). */
  nameParent?: PublicKey;
}

/** ~12,000 CU */
/**
 * Update the player's display name to a different domain under the same TLD.
 *
 * Transfers the old domain back to the wallet and the new domain to the PDA.
 */
export async function createUpdatePlayerNameInstruction(
  accounts: UpdatePlayerNameAccounts
): Promise<TransactionInstruction> {
  const [player] = await derivePlayerPda(accounts.gameEngine, accounts.owner);
  const tldHouse = accounts.tldHouse ?? (await deriveTldHousePda(accounts.tld))[0];
  const nameParent = accounts.nameParent ?? tldHouse;
  const [oldNameAccount] = await deriveNameAccountPda(accounts.oldDomainName, nameParent);
  const [oldReverseNameAccount] = await deriveReverseNameAccountPda(oldNameAccount, tldHouse);
  const [newNameAccount] = await deriveNameAccountPda(accounts.domainName, nameParent);
  const [newReverseNameAccount] = await deriveReverseNameAccountPda(newNameAccount, tldHouse);

  const nameClass = PublicKey.default;

  // Rust account order (10):
  // 0. player (WRITE)  1. old_name_account (WRITE)  2. old_reverse_name_account
  // 3. new_name_account (WRITE)  4. new_reverse_name_account
  // 5. name_class  6. name_parent  7. tld_house
  // 8. owner (SIGNER, WRITE)  9. alt_name_service_program
  const keys = [
    { pubkey: player, isSigner: false, isWritable: true },
    { pubkey: oldNameAccount, isSigner: false, isWritable: true },
    { pubkey: oldReverseNameAccount, isSigner: false, isWritable: false },
    { pubkey: newNameAccount, isSigner: false, isWritable: true },
    { pubkey: newReverseNameAccount, isSigner: false, isWritable: false },
    { pubkey: nameClass, isSigner: false, isWritable: false },
    { pubkey: nameParent, isSigner: false, isWritable: false },
    { pubkey: tldHouse, isSigner: false, isWritable: false },
    // owner is the mut signer of the new-domain transfer.
    { pubkey: accounts.owner, isSigner: true, isWritable: true },
    { pubkey: ALT_NAME_SERVICE_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  // Instruction data: old_reverse_acc_hashed_name (32) + new_reverse_acc_hashed_name (32)
  const writer = new BufferWriter(64);
  writer.writeBytes(getHashedName(oldNameAccount.toBase58()));
  writer.writeBytes(getHashedName(newNameAccount.toBase58()));

  const data = createInstructionData(DISCRIMINATORS.NAME_UPDATE_PLAYER, writer.toBuffer());
  return new TransactionInstruction({ keys, programId: PROGRAM_ID, data });
}

// Remove Player Name

export interface RemovePlayerNameAccounts {
  /** Player's wallet (signer) */
  owner: PublicKey;
  /** GameEngine PDA */
  gameEngine: PublicKey;
  /** Current TLD */
  tld: string;
  /** Current domain name */
  domainName: string;
  /** Override the TldHouse account (see {@link SetPlayerNameAccounts.tldHouse}). */
  tldHouse?: PublicKey;
  /** Override the name_parent registry record (see {@link SetPlayerNameAccounts.nameParent}). */
  nameParent?: PublicKey;
}

/** ~6,000 CU */
/**
 * Remove the player's display name, transferring the domain back to the wallet.
 *
 * Rust account order (8):
 * 0. [writable] player  1. [writable] name_account  2. reverse_name_account
 * 3. name_class  4. name_parent  5. tld_house
 * 6. [signer] owner  7. alt_name_service_program
 *
 * Instruction data (32 bytes): reverse_acc_hashed_name
 */
export async function createRemovePlayerNameInstruction(
  accounts: RemovePlayerNameAccounts
): Promise<TransactionInstruction> {
  const [player] = await derivePlayerPda(accounts.gameEngine, accounts.owner);
  const tldHouse = accounts.tldHouse ?? (await deriveTldHousePda(accounts.tld))[0];
  const nameParent = accounts.nameParent ?? tldHouse;
  const [nameAccount] = await deriveNameAccountPda(accounts.domainName, nameParent);
  const [reverseNameAccount] = await deriveReverseNameAccountPda(nameAccount, tldHouse);

  const nameClass = PublicKey.default;

  const keys = [
    { pubkey: player, isSigner: false, isWritable: true },
    { pubkey: nameAccount, isSigner: false, isWritable: true },
    { pubkey: reverseNameAccount, isSigner: false, isWritable: false },
    { pubkey: nameClass, isSigner: false, isWritable: false },
    { pubkey: nameParent, isSigner: false, isWritable: false },
    { pubkey: tldHouse, isSigner: false, isWritable: false },
    // The player PDA owns the domain and signs the transfer; the wallet just
    // receives it back, so owner is a read-only signer.
    { pubkey: accounts.owner, isSigner: true, isWritable: false },
    { pubkey: ALT_NAME_SERVICE_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  const writer = new BufferWriter(32);
  writer.writeBytes(getHashedName(nameAccount.toBase58()));

  const data = createInstructionData(DISCRIMINATORS.NAME_REMOVE_PLAYER, writer.toBuffer());
  return new TransactionInstruction({ keys, programId: PROGRAM_ID, data });
}
