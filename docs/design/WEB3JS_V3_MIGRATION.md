# web3.js v1 to v3 migration — novus-mundus-ts

**Decision:** Migrate the production SDK `sdks/novus-mundus-ts` off `@solana/web3.js@1.98.4` to **web3.js v3** (`@solana/web3.js@3.x`, class-based API on Kit internals). In-place strangler migration: convert one subsystem at a time, keep e2e green at every step, ship continuously. Delete `sdks/novus-mundus-ts-kit` (the abandoned functional-Kit fork) at the end.

**Why v3 and not functional `@solana/kit`:** v3 keeps the imperative/class API (`Connection`, `Transaction`, `TransactionInstruction`), so the migration is mostly type swaps rather than a paradigm rewrite. The functional Kit fork already stalled once for exactly that reason. v3 still gets us onto Kit internals (modern RPC, async crypto, bigint, future development).

**Status caveat:** v3 is at `3.0.0-rc.1` (no GA yet). Pin the rc, flip to the GA tag before launch. Official aid: `skills/web3js-v1-to-v3-migration/SKILL.md` in the solana-foundation/solana-web3.js repo.

## Breaking changes from v1 that touch us

- **Async-only signing.** Sync signing/verification paths are gone. Transaction signing in `client.ts` and server cosign becomes `async`.
- **`bigint` everywhere.** Many RPC numeric fields are `bigint` instead of `number`. Account-data numerics we already read manually; this mainly affects RPC responses.
- **`Buffer` to `Uint8Array`.** Byte handling shifts to `Uint8Array`. Our `BufferReader`/`BufferWriter` manual parsers stay, but operate on `Uint8Array`.
- **`PublicKey` is a deprecated alias of `Address`.** Existing `PublicKey` usage still compiles, so the type sweep can be gradual. End state: `Address`.
- **Default commitment is now `confirmed`** (was `finalized`). Audit any place that relied on the old default.
- **Removed surfaces:** `unique()` on Address/PublicKey, `Account`, fee-calculator methods, `BufferLayout`. Grep to confirm none are used.

## The type seam (the contract the web app codes against)

| v1 at boundary | v3 target | Notes |
|---|---|---|
| `PublicKey` | `Address` | `PublicKey` is a deprecated alias, so flip gradually |
| `BN` (bn.js) | `bigint` | web app funnels through `bnToSafeNumber`; simplifies |
| `Buffer` | `Uint8Array` | internal parsers + any exported byte returns |
| `Connection` | `Connection` (v3) | same class name, async crypto, `confirmed` default |

Keep exported **method names and shapes stable** (`buildVersionedTransaction`, `client.connection`, all `derive*Pda`) so the web app's ~227 `useWallet()` sites and 85 web3.js imports do not churn.

## Module checklist (bottom-up)

Nearly all of these are type-only changes; runtime work is concentrated in the last two rows.

| Phase | Modules | Action | Risk |
|---|---|---|---|
| 1 | `constants.ts`, `types/enums.ts`, `errors.ts`, pure `calculators/*` | none / drop `BN` for `bigint` | none |
| 2 | `types/common.ts`, `program.ts` | `PublicKey`->`Address`, `BN`->`bigint` in interfaces; program-id constants to `address('...')` | low |
| 3 | `utils/serialize.ts`, `utils/deserialize.ts`, `state/*` (22) | `BufferReader`/`Writer` operate on `Uint8Array`; `PublicKey` fields to `Address` | medium |
| 4 | `pda.ts` | DECIDED async: `getProgramDerivedAddress` from `@solana/addresses` (native `crypto.subtle`); retype to `Promise<[Address, number]>`; drops @noble `sha256` here. Cascades `await` through instruction builders + callers (accepted; v3 is async-first anyway) | high |
| 5 | `instructions/*` (27), `utils/token.ts`, `external/*` | `TransactionInstruction` retype, `Address` params | medium |
| 6 | `parser/*`, `validation/*`, `events/*`, `keyprovider/*`, `crypto/*`, `wartable.ts`, `spawn/*` | type swaps; `crypto/wartable` uses @noble, no change | low |
| 7 | `subscriptions/*` | `Connection.onAccountChange` against v3 Connection | high |
| 8 | `client.ts` | RPC calls + **signing becomes async**; keep build methods returning a tx the wallet adapter can sign | critical |

## The three choke points

1. **`client.ts` signing goes async.** v3 confirmed: `versionedTransaction.sign(...)` still exists but is now async. Build-sign-send methods need async plumbing. `.serialize()` survives; wire format unchanged.
2. **Wallet-adapter signing boundary** (the one spot v3 does not de-risk). DECIDED: keep wallet-adapter as the permanent wallet layer (`@solana/react` rejected as too verbose). wallet-adapter-base imports `VersionedTransaction` from `@solana/web3.js` and peers on `^1.77.3`, and `StandardWalletAdapter` calls `transaction.serialize()` / `VersionedTransaction.deserialize()` internally (wallets sign bytes via Wallet Standard). **DECIDED: fork wallet-adapter to v3** (to keep wallet-adapter AND purge v1 from the browser; the wrapper was rejected because keeping stock wallet-adapter would ship v1+v3 = two majors, defeating the bundle goal). Fork scope is SMALL because `apps/web/.../provider.tsx` registers `wallets={[]}` + `autoConnect`, i.e. relies entirely on Wallet Standard auto-detection — so NONE of the 40 `wallet-adapter-*` wallet packages are forked. Fork surface = 3 packages: (a) `@solana/wallet-adapter-base` (swap v1 web3.js type imports to v3; reimplement `isVersionedTransaction`); (b) `@solana/wallet-standard-wallet-adapter-base` (the seam: `adapter.js` `transaction.serialize()` out, `wallet.js` `_deserializeTransaction` = `VersionedTransaction.deserialize`/`Transaction.from` + reserialize back, plus `PublicKey` in account/signMessage/signIn) -> v3; (c) `@solana/wallet-adapter-react` (`useConnection`/`ConnectionProvider` build a v1 `Connection`). Shrink further: (1) drop `@solana/wallet-adapter-wallets` from package.json (unused given `wallets={[]}`; removes 40 transitive pkgs); (2) route RPC through the app's own v3 context instead of `useConnection`/`wallet.sendTransaction(tx, conn)` -> drops package (c), fork collapses to base + standard-wallet-adapter-base (just the serialize/deserialize seam). Verify in v3 rc: `VersionedTransaction.deserialize`/`.serialize()`, legacy `Transaction.serialize({verifySignatures,requireAllSignatures})`, and (if keeping (c)) `Connection.sendRawTransaction`/`getLatestBlockhash`. Wire format identical, so the forked adapter still interops with real wallets. Mechanism: vendor the 3 packages' TS source as workspace packages (clean) over patch-package on compiled cjs (brittle).
3. **PDA derivation is async** (decided): see Phase 4. Not a blocker, just a viral `await`, consistent with v3's async-first crypto.

## Web app plug (apps/web)

The transaction flow is centralized, so this is small despite the import counts:

- **4 choke files:** `lib/solana/provider.tsx` (Connection construction), `lib/server/game-authority.ts` (server Connection + Keypair), `lib/hooks/useTransact.ts` (build/sign/send), `lib/server/cosign.ts` (server cosign + sign).
- **Type sweep (non-blocking):** `PublicKey`->`Address` across ~57 files (mostly type-only), `TransactionInstruction`->v3, drop `bn.js` (`bnToSafeNumber` now takes `bigint`).
- **227 `useWallet()` sites** mostly read `publicKey`/`connected` and do NOT need changes.
- **Server routes** (cosign/*, auth/siws, wt/key, cron/encounters) are bundle-irrelevant and migrate independently once `client.ts` lands.

## Dependency consolidation (drop what v3 / @solana covers — only where safe)

Shed third-party deps that v3 or the @solana ecosystem replaces, but only where it does not mean rewriting spec-locked crypto. Verdict per dep, from actual usage:

**Drop (required — both `bn.js` and `bs58` must go; this is NOT an optional cleanup):** v3 deleted `BN` and stopped depending on `bs58`, so the SDK cannot sit on a split toolchain. The type seam the app codes against flips wholesale from `BN` to `bigint`; a half-migrated SDK that still exposes `BN` while consuming v3's `bigint` internals turns every numeric boundary into a BN↔bigint conversion minefield. Removing them is also the *point* of the migration (bundle size + the supply-chain surface the Dec 2024 web3.js compromise hit), not a side benefit.
- `bn.js` (49 SDK files / 1,166 sites + 12 app files) to native `bigint`. The largest single change, and load-bearing: v3 returns `bigint` and ships no `BN`, so the SDK's public numeric types become `bigint` end-to-end and `bnToSafeNumber` collapses to a bigint clamp. Must be done in full — a partial pass leaves the SDK↔app boundary incoherent.
- `bs58` to the `@solana` base58 codec (`getBase58Encoder`/`getBase58Decoder`). Threaded through `getProgramAccounts` memcmp filters (`client.ts`, `apps/web/.../useCastleRosters.ts`) and keypair-from-base58 (`apps/web/.../game-authority.ts`). Do it alongside the `client.ts` pass; verify v3's memcmp filter expects the same byte/base58 encoding. Smaller than `bn.js` but equally non-optional — leaving it ships a redundant base58 impl next to v3's, defeating the consolidation.

**Keep (no safe / worthwhile replacement):**
- `@noble/ciphers` — `xchacha20poly1305` (War Table AEAD, `crypto/wartable.ts`, 24-byte nonce, envelope validated byte-for-byte by `post.rs`). Checked all native paths (2026-05-30): **no runtime exposes XChaCha20-Poly1305.** Node `crypto`/OpenSSL has only IETF `chacha20-poly1305` (96-bit nonce; `getCiphers()` shows `chacha20`, `chacha20-poly1305`, no xchacha — XChaCha never landed in OpenSSL). WebCrypto `crypto.subtle` has no ChaCha at all in browsers (WICG "Modern Algorithms" draft + Chrome Intent-to-Prototype only, not shipped, not a standard), and the proposal is for IETF ChaCha, not the X variant. XChaCha is a libsodium construction. So going native would require re-speccing the envelope to a 12-byte nonce across chain+SDK+web in lockstep (a nonce-safety downgrade), and the browser (where the envelope is built) would still need a JS lib until the WebCrypto proposal ships. Not a migration freebie. Keep.
- `@noble/hashes` — `hmac` + `sha256` (War Table HKDF in `crypto/wartable.ts`, TLD reverse-lookup hash in `external/tld-house.ts`, PDA `sha256` in `pda.ts`). NOTE: SHA-256 *is* available natively — `@solana/addresses` derives PDAs via `await crypto.subtle.digest('SHA-256', ...)` (confirmed in `node_modules/@solana/addresses/src/program-derived-address.ts`), so `pda.ts` could drop the @noble import and go async (see open Q1). But removing `@noble/hashes` removes nothing from the tree: it is a transitive dep of `@solana/web3.js`, of `@noble/curves`, and of the Solana wallet-standard stack you keep (`@solana/wallet-standard-util` etc.) — so it stays installed regardless. Dropping our direct import would just force an async rewrite of working, byte-exact security crypto (wartable HKDF + TLD hash) for zero dependency reduction. `pda.ts` does drop its direct `sha256` (PDA is now async/native), but the package remains. Net zero benefit. Keep.

Net: the crypto libs stay (unless War Table encryption is deliberately re-spec'd to AES-GCM). `bn.js` (large) and `bs58` (small) both come out as part of the migration — neither is deferrable; v3 removes the toolchain they belonged to, so they go when web3.js does.

## Open questions to verify against v3 rc.1

1. ~~PDA sync?~~ RESOLVED: PDA goes async via `@solana/addresses` `getProgramDerivedAddress` (native crypto.subtle); Phase 4 cascades `await`.
2. ~~Wallet-adapter v3?~~ RESOLVED: v3 keeps `VersionedTransaction` with async `.sign()`; wallet-adapter-base is v1-bound (`^1.77.3`). Bridge via serialize/deserialize at the signing seam; do NOT fork; real exit is `@solana/react` Wallet Standard signers.
3. Does `Connection.onAccountChange` keep the same signature in v3? (Phase 7)
4. Confirm no usage of removed surfaces (`unique()`, `Account`, fee-calculator, `BufferLayout`).

## Final cleanup

- Delete `sdks/novus-mundus-ts-kit`.
- Drop `@solana/web3.js@1`, `bn.js`, and `bs58` from `novus-mundus-ts` and `apps/web` — all three are removed by the migration, not deferred.
- Flip `@solana/web3.js` from the `rc` tag to GA before launch.
