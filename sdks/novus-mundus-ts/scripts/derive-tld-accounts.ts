/**
 * Derive TLD House accounts for cloning
 *
 * Run with: bun run scripts/derive-tld-accounts.ts
 */

import { PublicKey } from '@solana/web3.js';

const TLD_HOUSE_PROGRAM_ID = new PublicKey('TLDHkysf5pCnKsVA4gXpNvmy7psXLPEu4LAdDJthT9S');
const ALT_NAME_SERVICE_PROGRAM_ID = new PublicKey('ALTNSZ46uaAUU7XUV6awvdorLGqAsPwa9shm7h4uP2FK');

// Derive TLD State PDA
const [tldState] = PublicKey.findProgramAddressSync(
  [Buffer.from('tld_pda')],
  TLD_HOUSE_PROGRAM_ID
);

// Derive TLD House for .solana
const [tldHouseSolana] = PublicKey.findProgramAddressSync(
  [Buffer.from('tld_house'), Buffer.from('.solana')],
  TLD_HOUSE_PROGRAM_ID
);

// Derive Name Class (registry for .sol TLD)
// The TLD parent is the name class account that holds the TLD registry
const NULL_PUBKEY = new PublicKey(new Uint8Array(32));

console.log('=== TLD House Accounts to Clone ===');
console.log('');
console.log('TLD State PDA:', tldState.toBase58());
console.log('TLD House (.solana):', tldHouseSolana.toBase58());
console.log('');
console.log('=== Validator --clone flags ===');
console.log(`--clone ${tldState.toBase58()} \\`);
console.log(`--clone ${tldHouseSolana.toBase58()} \\`);
