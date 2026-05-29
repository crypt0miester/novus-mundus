# War Table - Design

**Status**: Implemented. Chain, SDK, tests, and web are shipped. This document
records the design as built; the authoritative implementation spec (every file
path, byte offset, error code, and task) is `docs/WAR_TABLE_IMPL_SPEC.md`.
**Estimate (historical)**: ~1 week to v1 (team scope, encrypted), +0.5 week per
additional scope variant. All five scopes (team, rally, castle, encounter, DM)
shipped.

Two follow-ups remain deferred (see `docs/dev-todo.md`):
1. Castle web embed - no `CastleDetailPanel` exists yet, so scope 2 is wired in
   chain + SDK but not surfaced in any web panel.
2. A true cross-kingdom encounter e2e - the current e2e seeds one game engine, so
   the out-of-kingdom access path is exercised by proxy only.

The text below reflects the IMPLEMENTED design. Where the original plan called for
infrastructure that the implementation replaced (a logsSubscribe rotation listener,
a Redis version counter, a custom `/wt/register` session), those sections have been
rewritten to describe what actually shipped.

## Goal

A war-table is the social/coordination layer of the game. Players need to:

1. **Discuss strategy** with their team, with people they're rallying, in a castle siege, on a specific encounter, or in a DM.
2. **Pledge contributions** before a raid ("I'm bringing 5k tier-3 + my hero in slot 1"), visible to teammates before the on-chain rally commits.
3. **See live game-state context** alongside the chat: the target castle's HP, current defenders, attack window, vesting timers.
4. **Read the historical outcome** ("rally executed, won, took 12% casualties") as a system message in the same thread.

The war-table is *not* a replacement for gameplay state. Rallies, attacks, and castle conquest stay on-chain in the existing `novus_mundus` program. The war-table is the coordination overlay that lives between intent and commitment.

## Non-goals

- **Not** a generic chat product. Threads exist only as overlays on game entities.
- **Not** a fix for `novus_forum`. Referenced as a design ancestor; we're not modifying or deploying it.
- **Not** end-to-end encrypted in the strict sense. See [Trust model](#trust-model); bodies are protected against passive chain observers (rival players), not against the game server itself.
- **Not** trying to hide metadata. Sender wallet, thread PDA, and timing remain public.

## Decision summary

**Build it on the existing `novus_mundus` program. Emit messages as `sol_log_data` from a single new instruction (`POST_WAR_TABLE_MESSAGE = 323`). Encrypt the body once with a per-thread symmetric key `K_thread`, derived on demand as `HMAC-SHA256(K_master, "wt1" + thread_pda + u32_le(key_version))`. `key_version` is the on-chain membership epoch (`membership_epoch`), read directly from the thread account; nothing is stored in Redis. Clients fetch `K_thread` from the web API over their existing SIWS session; the API authorises by reading on-chain scope membership. Read via `getSignaturesForAddress` + batched `getTransaction`. Real-time via `connection.onLogs`. Public scopes (encounter) skip encryption entirely.**

Cost: ~$0.00025 per message, paid by sender. One API call per session per thread to bootstrap the key, none per message after that.

The single biggest change from the original plan is that **`key_version` IS the on-chain `membership_epoch`**, not an off-chain Redis counter advanced by a listener. The chain owns the rotation point, the chain owns the value, and the chain bumps it in the very same transaction that removes a member. This is described in detail under [Key rotation](#key-rotation).

## Trust model

What this design does and does not protect.

| | Protected? |
|---|---|
| Rival players reading the chain to learn rally plans | yes, they do not have `K_thread` |
| A passive observer of public RPC | yes |
| A Redis dump / snapshot / replica / backup leak | yes, Redis holds no war-table secret key material (see [Key custody](#key-custody-admin-side-security)) |
| A malicious or compromised game-server operator | no, the server holds `WT_MASTER_SECRET` and can derive any thread key for any version, past or future |
| Loss of a single member's device | yes, they only had cached keys; no thread-key material leaks beyond what they could read |
| Censorship by the chain | yes, the chain accepts the post regardless |
| Censorship by the API | partial, the API can refuse to hand over keys, but the ciphertext on chain is recoverable once access is restored |

This is the same trust model the rest of the game already uses. Players trust the game server with their wallet integration, NOVI balance, hero state, oracle prices, and everything else. Trusting it with team chat is consistent. For a future scope that genuinely cannot trust the server (DAO governance, treasury secrets), the design preserves an upgrade path, see [Future: per-scope server-untrusted mode](#future-per-scope-server-untrusted-mode).

### Trust ceiling (read this before relying on war-table confidentiality)

This is the load-bearing operator posture. There is **no forward secrecy**, and the ciphertext is **permanent on a public ledger**. Every encrypted message ever sent is derivable from one long-lived secret (`WT_MASTER_SECRET`, with a KMS upgrade path), so any future compromise of that secret - insider access, host RCE, subpoena, an acquisition that changes who controls the keys - **retroactively decrypts EVERY message ever sent across EVERY thread**, and that decryption cannot be revoked or deleted because the ciphertext already lives on chain forever.

The kill-switch (disable the KMS key, or rotate `WT_MASTER_SECRET`) stops **new** key derivations; it does not protect history. Anyone who later restores from a leaked copy of the old secret can decrypt everything that secret ever covered. The kill-switch is a "stop the bleeding now" control, not a "the old data is safe" control.

This is a conscious tradeoff. War-table content is game-strategy chat, not regulated or life-safety data, and the cost of true forward secrecy (per-recipient key agreement, ratcheting) was judged not worth it for v1. If the content ever warrants it, coarse forward secrecy is available later without a wire-format change: roll a new master generation on a schedule, delete the retired generation, and accept that history under the deleted generation becomes permanently unreadable. That is a future option, not the shipped behavior.

**DMs inherit all of the above plus one extra wrinkle: there is no per-pair revocation.** A DM thread uses a single constant key version (1) for the life of the conversation, so anyone who ever held that pair's DM key keeps the ability to read the entire conversation, past and future, forever. There is no membership-epoch bump for DMs because there is no "removal" event for a two-person thread.

## Options considered (and why we rejected them)

| Option | Verdict |
|---|---|
| Fork `novus_forum` as-is (Anchor 0.26, per-recipient accounts) | Per-message-per-recipient account creation costs ~0.005 SOL/msg. Doesn't scale. |
| Postgres + WebSocket | User explicitly didn't want to operate a DB. |
| Redis Streams + Pub/Sub for storage | API down = chat down, history gone. Rejected. |
| Solana Memo program + thread PDA | Works but no on-chain auth: anyone can post to any thread. |
| State compression / Bubblegum cNFTs | 2 to 3 weeks of engineering, requires DAS indexer. |
| `novus_mundus` instruction + per-recipient hybrid (`novus_forum` 2022 model) | Sound but heavy: HKDF + ECDH + ed25519/x25519 + attestations + fan-out for teams over 10. Useful when we don't trust the server; overkill for in-team chat. **Archived for future server-untrusted scopes.** |
| **`novus_mundus` instruction + chain-derived `K_thread` keyed on `membership_epoch`** | Picked. Same on-chain shape, no client crypto beyond AEAD, no fan-out, new members read history, and member-leave revokes future access because the on-chain `membership_epoch` is bumped in the same removal transaction. |

## Architecture

```
Player wallet
   | signs in once via SIWS (the same session the rest of the app already uses)
   v
Existing SIWS session cookie            // no separate war-table session, no /wt/register
   |
   v
Bootstrap thread: GET /api/wt/key/{thread_pda}?scope=&from_version=&peer=
   | credentials: include  -> the API reads the SIWS session to get the wallet,
   | reads chain to confirm wallet is in scope, reads membership_epoch from the
   | thread account, derives the servable K_thread versions, returns
   | { current_version, keys: [{ version, k_base64 }, ...] }
   v
Sending (encrypted scope):
   1. body_nonce = random 24 bytes
   2. key_version = current on-chain membership_epoch for the thread
   3. ciphertext = XChaCha20-Poly1305(K_thread, body_nonce, plaintext, aad=header[0..72])
   4. Wallet-signed tx -> novus_mundus::post_war_table_message
   v
novus_mundus::post_war_table_message  (discriminator 323)
   | verifies sender (tx signer) is in scope(thread_pda)
   | verifies envelope.thread_pda == passed thread account
   | verifies envelope.sender_wallet == tx signer
   | verifies envelope.key_version == thread.membership_epoch (encrypted scopes)
   | verifies the encrypted flag matches the scope (BC2)
   | emits sol_log_data(envelope_bytes)
   v
Solana tx log
   |
   |-> getSignaturesForAddress(thread_pda) + getTransaction -> envelopes
   |      then recipient client side:
   |      look up K_thread by key_version (cache or API) -> AEAD-open -> plaintext
   |-> connection.onLogs(thread_pda)               -> real-time push (same decrypt path)
```

The **thread PDA** is *any existing game entity*. Every team, rally, castle, encounter, and player already has a PDA on chain; that PDA is the addressable thread marker on chain and the KDF input for `K_thread`. There is no Redis index: the only per-thread state that matters to key derivation is `membership_epoch`, which lives in the thread account itself.

### Scopes

| Scope | Thread PDA | Who can post | Encryption |
|---|---|---|---|
| Team | `TeamAccount` PDA | Members of that team | `K_thread`, version = `team.membership_epoch` |
| Rally war-room | `RallyAccount` PDA | Rally creator + joined participants | `K_thread`, version = `rally.membership_epoch` |
| Castle siege | `CastleAccount` PDA | King, garrison, or court (no persistent-attacker record exists, see [Castle access](#castle-access-king-garrison-court)) | `K_thread`, version = `castle.membership_epoch` |
| Encounter | `EncounterAccount` PDA | Any player in the same kingdom (open channel) | **Plaintext** (no key, no API call) |
| Player DM | PDA of the sorted PLAYER PAIR (`["wt_dm", lo, hi]` over the two `PlayerAccount` PDAs) | Either of the two participants | `K_thread`, constant version `1` |

Scope is parsed from the account discriminator on the thread account (DM is the one exception: no account is created, the program verifies `thread.key == derivedPairPda`). Access predicates live in `processor/war_table/access.rs`.

**Why the DM thread PDA is the sorted player PAIR, not the recipient's single PlayerAccount PDA.** If the thread were keyed on a single recipient, that recipient's thread would have ONE key, and everyone who ever DMed that player would hold it, letting any of them read all of that player's DMs with everyone. Keying the PDA on the sorted pair of both PlayerAccount PDAs gives each two-person conversation its own distinct key, so a key learned for the A-B conversation reveals nothing about A-C. The pair is sorted lexicographically so `derive(A, B) == derive(B, A)`.

## Data model (log schema)

Every `post_war_table_message` instruction emits one `sol_log_data` call. Wire format is uniform for encrypted and plaintext envelopes; only `flags` and the interpretation of `body` differ.

```
[
  b"wt1",                              //  3 bytes: protocol discriminator (v1)
  flags: u8,                           //  1 byte : bit 0: encrypted body
  thread_pda: [u8; 32],                // 32 bytes: replay-across-threads defence
  sender_wallet: [u8; 32],             // 32 bytes: must equal tx signer
  key_version: u32,                    //  4 bytes: which K_thread version; 0 if plaintext
  body_nonce: [u8; 24],                // 24 bytes: AEAD nonce; zero if plaintext
  body_len: u16,                       //  2 bytes: length of body field
  body: [u8; body_len],                // var     : ciphertext if encrypted, plaintext otherwise
]
```

**Fixed overhead: 98 bytes.** After tx skeleton, body budget is ~860 bytes per single tx. Same for any scope size, no recipient blob, no fan-out, no multi-page assembly.

**No envelope signature.** Authorship is established by the chain transaction signature: the tx is signed by `sender_wallet`, and the program enforces `envelope.sender_wallet == tx signer`. The SIWS session exists only to authenticate to the web API for key fetches; it has no role in on-chain authentication.

### AEAD AAD binding

The XChaCha20-Poly1305 additional-authenticated-data is **the 72-byte cleartext header**, exactly `envelope[0..72]` (magic, flags, thread_pda, sender_wallet, key_version). Because the chain validates those same bytes before emitting the log, the body cannot be re-bound to a different thread, sender, or key version without breaking the AEAD tag. The AAD is never re-serialized at decrypt time; the decoder always uses the raw `envelope.subarray(0, 72)`, which is byte-identical to what the chain checked.

### Ordering and `created_at`

Message ordering is by **chain coordinates**: the 12-byte message ID is `(slot, tx_index, log_index)`, lexicographically then numerically ascending. The body's `created_at` field is **advisory only** (a client-stamped wall-clock hint for display) and is never used for ordering or trusted for correctness. The chain coordinate is the single source of truth for "what came before what." (Note: `tx_index` is only resolvable via `getBlock`; the shipped read path sets it to 0 with `txIndexResolved: false` and orders by slot, see [Read path](#read-path).)

### Body schema (inside `body`)

| Offset | Field | Bytes | Notes |
|---|---|---|---|
| 0 | `version: u8` | 1 | `0x01` |
| 1 | `kind: u8` | 1 | 0=text, 1=pledge, 2=system, 3=reply, 4=tombstone |
| 2 | `created_at: i64` | 8 | Unix seconds, client-stamped; advisory only, ordering uses chain coordinates |
| 10 | `parent_id?: [u8; 12]` | 12 | `(slot, tx_index, log_index)` of parent if reply; zeros otherwise |
| 22 | `payload: &[u8]` | var | Kind-specific |

**Per-kind payloads:**

- `text(0)`: UTF-8 bytes
- `pledge(1)`: `[u64 tier1, u64 tier2, u64 tier3, u8 hero_slot, i64 ready_at]`
- `system(2)`: structured event reference (e.g., `RallyExecuted` slot+sig)
- `reply(3)`: same as text but `parent_id` set
- `tombstone(4)`: superseded message's id; UI hides the original

**Message ID** (stable, not stored on chain): `(slot, tx_index_in_block, log_index_in_tx)`, 12 bytes, monotonically ordered, deterministic across re-reads.

## Auth model

### Key-fetch auth reuses the existing SIWS session

The implemented design has **no separate war-table session and no `/wt/register` endpoint**. Key fetches authenticate with the **existing SIWS (Sign-In With Solana) session** that the rest of the app already establishes. The key route (`GET /api/wt/key/{thread}`) is called with `credentials: 'include'`; the server reads the SIWS session to recover the wallet, then proceeds with the on-chain scope check. The client helper that ensures the session exists is `ensureSession(signIn)` (exported from `lib/cosign.ts`); on a `401` the hook calls it once and retries.

Because there is no separate registration step, the original **1-per-wallet-per-day register rate-limit is removed** entirely. There is nothing to register: the SIWS session is the bootstrap, and it is the same flow used everywhere else in the app. This eliminates the bespoke session keypair, the `/wt/register` round-trip, and the Redis session-binding record that the original plan carried.

### Per-post authorship

Posting requires a wallet-signed transaction; the program checks `sender == envelope.sender_wallet`. For active raids, players enable their wallet's auto-approve toggle so posts are silent. Without auto-approve, every post is a popup, which is acceptable. A relayer plus on-chain session delegation would reintroduce the complexity that was deliberately removed.

## Encryption

### Construction

```
K_thread     = HMAC-SHA256(K_master, "wt1" + thread_pda + u32_le(key_version))   // 39-byte message
body_nonce   = random 24 bytes per message
ciphertext   = xchacha20poly1305(K_thread, body_nonce, plaintext, aad = header[0..72])
```

`K_master` is the 32-byte `WT_MASTER_SECRET` (hex in env, server-only). The KDF byte layout is pinned identically across the SDK (`@noble/hashes`) and the web server (`node:crypto`), and is restated in `WAR_TABLE_IMPL_SPEC.md` section 4. The 72-byte AAD binds the ciphertext to its header (see [AEAD AAD binding](#aead-aad-binding)). That is the entire client-side crypto: no HKDF, no ECDH, no curve conversion, no recipient blob, no signature. The KMS upgrade path (derive inside an HSM via `GenerateMac`) is preserved and described under [Key custody](#key-custody-admin-side-security).

### Decryption

```
1. K_thread = local_cache.get((thread_pda, envelope.key_version))
              or  await api.getKey(thread_pda, envelope.key_version)
2. plaintext = xchacha20poly1305_open(K_thread, envelope.body_nonce, envelope.body, aad = header[0..72])
```

A miss on `key_version` (for example, the user is reading history from before they joined, and the API does not expose that version to them) yields an unreadable message; the UI surfaces "Message from before you joined" rather than erroring.

### Plaintext path (encounters, future public scopes)

```
flags.encrypted = 0
key_version     = 0
body_nonce      = 0       // padded for uniform parsing
body            = plaintext
```

No API call. The chain tx signature still authenticates the author.

### Library choice

`@noble/ciphers` for XChaCha20-Poly1305 (SDK), `@noble/hashes` for HMAC-SHA256 (SDK), and `node:crypto` for HMAC on the web server. That is the entire crypto dependency.

## Key custody (admin-side security)

The design has exactly one long-lived secret: `K_master`. Everything else is derived from it or is public. This section is the admin-side threat model. Recall the hard [Trust ceiling](#trust-ceiling-read-this-before-relying-on-war-table-confidentiality): there is no forward secrecy, so the entire confidentiality story rests on protecting this one secret.

### Principle: nothing secret is stored at rest

There is no Redis and no database for the war table, so there is no at-rest store to leak. Thread keys are **derived, not stored**: `K_thread_v = HMAC-SHA256(K_master, "wt1" + thread_pda + u32_le(version))`. The only inputs to a derivation are `K_master` and the thread account's on-chain `membership_epoch`, both read at request time. A dump of any datastore the app uses yields nothing that decrypts a message; only `K_master` does.

### Principle: protect `K_master`

The shipped default holds `K_master` in the server-only `WT_MASTER_SECRET` env var, derived in-process via `node:crypto.createHmac`. This is simple and means an attacker who reads the process environment exfiltrates the secret outright, which is the dominant risk to manage (see Trust ceiling and [The honest ceiling](#the-honest-ceiling)).

The KMS upgrade path keeps `K_master` as a non-exportable HMAC key in a managed KMS / Cloud HSM (AWS KMS HMAC keys, GCP Cloud KMS MAC keys, both GA). The server would call `GenerateMac(key_id, "wt1" + thread_pda + version)` so the HMAC is computed inside the HSM and only the 32-byte result returns. Consequences of the KMS path:

- The server process never holds `K_master`; a memory dump cannot exfiltrate it.
- Every derivation is a logged KMS call. Bulk derivation (an attacker dumping every thread key) is visible.
- Access is revocable instantly: disable the KMS key and all new decryption stops. This is the breach kill-switch, and per the Trust ceiling it stops new derivations, not a later restore from a previously leaked secret.
- Cache derived `K_thread` in memory with a short TTL so it is not calling KMS on every read; a memory dump then reveals only the keys cached in that window.

Use a separate `K_master` per environment (dev / staging / prod). Never share.

### Session integrity

The implemented design stores no war-table session binding in Redis: key-fetch auth rides the existing SIWS session, so there is no `wt:session:*` record to forge. The integrity property that mattered in the original plan (an attacker writing a forged session-to-wallet binding) is moot because the binding no longer exists. SIWS session integrity is handled by the same machinery the rest of the app uses.

### The key still leaves your servers, harden the client

`K_thread` is delivered to clients and may be cached client-side. Code executing in the page (XSS, malicious extension) reaches live keys regardless of any at-rest protection, so the dominant client risk is page execution, not file theft. Keep any client-side key cache short-lived and scoped to the threads the user can actually read.

### Shipped default vs. KMS upgrade

The shipped default loads `K_master` from a server-only `WT_MASTER_SECRET` env var (32 bytes, hex; no `NEXT_PUBLIC_`, thrown at module load if absent or malformed). This is operationally simple but means the secret sits in process memory, so the [Trust ceiling](#trust-ceiling-read-this-before-relying-on-war-table-confidentiality) applies in full. The wire format and KDF are identical to the KMS path, so upgrading to a non-exportable HMAC key in a managed KMS / HSM is a server-side swap only (set a KMS key id, derive via `GenerateMac` instead of `createHmac`), with no client or chain change.

### Hardening checklists

**Master secret (env default):**
- Generate with `openssl rand -hex 32`; inject as a deployment secret, never commit it.
- Separate secret per environment (dev / staging / prod); never share or reuse.
- Treat any access to the env var as access to all history (see Trust ceiling).

**KMS (upgrade path):**
- Key policy grants only the API's workload identity `GenerateMac`; no human role has it in prod.
- Audit logging on; alarm on anomalous derivation volume.
- Multi-region replica of the KMS key for DR; losing `K_master` bricks every thread.
- No long-lived IAM keys; use instance / workload identity.

### The honest ceiling

What this design cannot eliminate:

- **Host RCE / env-secret exfiltration.** With the shipped env-secret default, an attacker who reads the API host's environment exfiltrates `K_master` itself and can derive every thread key for every version, past and future, offline and forever. The KMS upgrade narrows this to "derive while you hold the host" (logged, revocable, non-exfiltratable), but the env default does not. See the [Trust ceiling](#trust-ceiling-read-this-before-relying-on-war-table-confidentiality).
- **Client-side compromise.** XSS or a malicious extension leaks the keys that client held, bounded to that user's threads, not global.
- **Malicious insider.** Anyone with production access to `K_master` can derive everything. Irreducible, the "you trust the operator" property already stated in the [Trust model](#trust-model). Only per-recipient client-to-client encryption removes it ([Future: per-scope server-untrusted mode](#future-per-scope-server-untrusted-mode)).

The achievable guarantee with the shipped default: **a Redis or database compromise yields zero readable messages, because no war-table secret material lives there.** Confidentiality rests entirely on `K_master`; protect it accordingly, and adopt the KMS path to make derivation logged and revocable.

## Key rotation

`K_thread` rotates when scope membership changes: a kicked team member, a left rally, a conquered castle. The implemented design makes rotation **chain-authoritative**. There is no off-chain rotation listener and no Redis version counter. `key_version` is the on-chain `membership_epoch`, a `u32` field added to `TeamAccount`, `RallyAccount`, and `CastleAccount`, and the chain bumps it with `saturating_add(1)` **in the same transaction** that performs the removal.

This is the design's most important correctness property and the reason it differs from the original plan.

### `key_version == membership_epoch`, bumped atomically with each removal

Every encrypted scope's `key_version` equals the current `membership_epoch` of the thread account at post time. The chain enforces this in `post.rs`: a Team/Rally/Castle post must carry `key_version == thread.membership_epoch` or it is rejected with `WtKeyVersionMismatch`. Because the epoch lives on chain and is bumped in the removal transaction itself, there is no window in which the "current" version is ambiguous, and no separate system to keep in sync.

Rotation fires only on access-**loss** events, never on join. Adding a member cannot compromise anyone (the new member learning the current key is the point), so joins do not bump the epoch. They instead record the joiner's `joined_at_epoch` (a `u32` added to `TeamMemberSlot`, `RallyParticipant`, and `GarrisonContributionAccount`), which the key route uses to decide the oldest version that member is entitled to.

The exact bump sites are enumerated in `WAR_TABLE_IMPL_SPEC.md` section 5 (thirteen sites across team kick/leave/disband, rally leave/cancel/process-return, and castle leave/relieve/cleanup/finalize/force-remove/claim-vacant/dismiss-court/resign-court/court-cleanup). DM and Encounter scopes have no epoch: DM is a constant `key_version == 1`, Encounter is plaintext with `key_version == 0`.

### Race window: closed

The original plan had a race between the on-chain removal confirming and an off-chain listener rotating, mitigated only by commitment latency and rate limits. **That window does not exist in the implemented design.** The removal and the epoch bump are the same atomic transaction, so the moment a member is removed, the current `membership_epoch` has already advanced. A removed member can still hold and use whatever keys they cached for versions at or below their old epoch (and could already have read any message sent under them), but they cannot fetch the post-removal version: the key route serves a member only versions in `[max(from_version, joinedAtEpoch) .. currentEpoch]`, and a removed member fails the membership check entirely.

### Versioning: reading old messages after a rotation

Every envelope records the `key_version` (the epoch) it was encrypted under. Decryption always uses that version: a message posted under epoch 3 decrypts with `HMAC(K_master, "wt1" + thread + u32_le(3))` forever, no matter how many epochs followed.

- **Old versions are never lost** because they are never stored; every version is re-derivable from `K_master` on demand. The retention invariant collapses to one: **never lose `K_master`** (see [Key custody](#key-custody-admin-side-security)).
- **A current scope member can fetch every version they are entitled to** via `GET /api/wt/key/{thread}` and read back to their `joined_at_epoch`. A member who was present from the start (`joined_at_epoch == 0`) reads the entire thread; a member who joined after a kick reads only from the epoch they joined at forward.
- **A removed member** keeps whatever versions are already in their cache, so old messages they previously had access to still render. They cannot fetch the post-removal version, and cannot re-fetch anything if they clear their cache; the key route only serves current members.

Because the encrypter reads the epoch from the chain account it is posting against, a client cannot "lag a version behind" the way an off-chain pointer could: the chain rejects any post whose `key_version` does not equal the live `membership_epoch`. If a member's view of the epoch is stale (a removal landed between read and post), the chain rejects the post with `WtKeyVersionMismatch` and the UI surfaces "Membership changed, please retry."

## Program changes

### New file

`programs/novus_mundus/src/processor/war_table/post.rs`

Single instruction `post_war_table_message`. Accepts:

- **Accounts**:
  - `thread` (target PDA: rally / castle / encounter / team / DM pair)
  - `sender` (signer, wallet)
  - `player` (sender's `PlayerAccount`, for kingdom-scope auth)
  - Optional gate accounts: `TeamAccount`, `RallyAccount`, `CastleAccount` depending on scope
- **Data**: the envelope blob (program does not parse the body)

Behavior:

1. Parse the `thread` account discriminator to detect scope.
2. Dispatch to the right access predicate (see `access.rs`); require sender ∈ scope.
3. Validate envelope shape:
   - first 3 bytes == `wt1`
   - `envelope.thread_pda` == `thread.key` (anti-replay across threads)
   - `envelope.sender_wallet` == `sender.key` (anti-impersonation)
   - declared `body_len` matches actual data length
4. Enforce the scope-specific `key_version` rule (encrypted scopes: `== membership_epoch`; Encounter: `== 0` with the plaintext flag and zero nonce; DM: `== 1`) and the encrypted-flag rule (BC2): Team/Rally/Castle/DM require the encrypted flag set, Encounter requires it clear.
5. Emit `sol_log_data` with the envelope payload.
6. No state mutation on the thread. Tx cost = base fee + compute. No rent.

The program is intentionally crypto-agnostic: it sees the envelope as opaque bytes and only checks that the sender is in the scope, that the envelope honestly names them as author, and that the key version and flags match the scope. Whether the body is `K_thread`-encrypted, plaintext, or some future per-recipient format is invisible to the chain.

### New file

`programs/novus_mundus/src/processor/war_table/access.rs`

Per-scope predicates as implemented:
- Team: thread is the `TeamAccount` PDA; require `sender_player.team_address() == thread.key`.
- Rally: thread is the `RallyAccount` PDA; verify the sender's `RallyParticipant` PDA (keyed on wallet) and require the participant has not returned.
- Castle: thread is the `CastleAccount` PDA; sender must be the king, a garrison contributor, or hold a court position. There is no "active attacker" branch: `attack_castle.rs` resolves combat instantaneously and creates no persistent attacker record, so an attacker-within-siege-window predicate is undeliverable without a new account (see O6).
- Encounter: thread is the `EncounterAccount` PDA; require `sender_player.game_engine == encounter.game_engine` (same kingdom).
- DM: derive the pair PDA from both `PlayerAccount` gate accounts (each loaded with a program-owner check, BC3) and require `thread.key == derived`; one of the two players' `owner` must equal the signing wallet.

### Account-field additions

The instruction itself creates no accounts, but the rotation design adds two `u32` fields, sized into existing reserved bytes so every account stays its current length: `membership_epoch` on `TeamAccount` / `RallyAccount` / `CastleAccount`, and `joined_at_epoch` on `TeamMemberSlot` / `RallyParticipant` / `GarrisonContributionAccount`. Exact byte offsets and the `repr(C)` alignment fix (BC1) are in `WAR_TABLE_IMPL_SPEC.md` section 3.

### Instruction index

Adds one new instruction, `POST_WAR_TABLE_MESSAGE = 323` (the next free discriminator after `COSMETIC_EQUIP = 322`). The error range `8300..=8308` is reserved for war-table errors. Existing instructions are unchanged and the new epoch fields reuse reserved bytes, so the change is backwards-compatible.

## API surface

The implemented API is a single Next.js route handler in the web app: `apps/web/src/app/api/wt/key/[thread]/route.ts` (`runtime = 'nodejs'`), backed by the server-only key module `apps/web/src/lib/server/war-table.ts`. There is **no separate API service, no Redis, no `/wt/register`, and no chain-event listener.** The route reads the chain on demand and derives keys from `WT_MASTER_SECRET` per request; nothing war-table is persisted server-side.

### Storage layout

None. There is no Redis layout for the war table. Key derivation needs only `K_master` (env) plus the thread account's on-chain `membership_epoch`, both read at request time. The "no secret material at rest" property is now trivially true because there is no at-rest war-table state at all.

### Endpoint

```
GET /api/wt/key/{thread_pda}?scope=<0..4>&from_version=<n>&peer=<playerPdaBase58?>
  auth:   the existing SIWS session cookie (credentials: include); no extra signature
  effect: read the SIWS session to recover the wallet; read the chain for scope
          membership and the per-scope joined_at_epoch; read membership_epoch from the
          thread account; derive the servable versions from WT_MASTER_SECRET; return
          { current_version: number, keys: [{ version: number, k_base64: string }, ...] }
  window: serves only versions [max(from_version, joinedAtEpoch) .. currentEpoch]
  401:    no/invalid SIWS session  (client calls ensureSession(signIn) then retries once)
  403:    authenticated but not a member of the scope
```

Per-scope server-side derivation (BC4), all derivable from `thread` + the session wallet, never trusting any client-supplied epoch:

- Team: derive the caller's `PlayerAccount`; require `player.teamAddress == thread`; read `TeamMemberSlot.joinedAtEpoch`.
- Rally: read `RallyAccount(thread)` for `creator` + `rallyId`; derive the caller's `RallyParticipant` PDA; if absent, 403; else read `RallyParticipant.joinedAtEpoch`.
- Castle: derive the caller's `GarrisonContribution` PDA; if present read its `joinedAtEpoch`; else if the caller is king/court treat `joinedAtEpoch = 0`; else 403.
- DM: re-derive the pair PDA from the caller's `PlayerAccount` PDA and the `peer` PDA, require it equals `thread`, and serve only version 1.
- Encounter: no key; return `{ current_version: 0, keys: [] }`.

`currentEpoch` is read from the thread header's `.membershipEpoch`.

### Rate limiting

The route applies a lightweight per-request rate limit. The original **1-per-wallet-per-day register limit is gone** along with the register endpoint; there is no session to register, so there is no per-wallet registration budget to spend. The leaver race window that the old per-thread-per-minute fetch limit existed to narrow is now closed structurally by the atomic on-chain epoch bump (see [Race window: closed](#race-window-closed)), so the fetch limit is no longer load-bearing for security; it is only abuse protection.

### Failure modes

- **Chain RPC down**: the route cannot verify scope membership or read the epoch, so new key fetches fail. Posts already on chain remain encrypted-but-readable for clients that already hold the key. Durable read also depends on an archival RPC, see [Chain is storage](#chain-is-storage).
- **`WT_MASTER_SECRET` missing/malformed**: the server-only module throws at load, so the route fails fast rather than serving wrong keys.
- **Encounter**: no failure mode for keys; it never derives one.

## Client SDK

`sdks/novus-mundus-ts/src/wartable.ts` exposes a `WarTableClient`:

```ts
// Send: enforces the key_version rule, encrypts with K_thread (or plaintext for
// Encounter), and posts via novus_mundus. Reads getRecentPrioritizationFees and
// caps the per-CU priority fee at WT_MAX_PRIORITY_FEE_MICRO_LAMPORTS_PER_CU.
postMessage(thread, scope, gateAccounts, sender, senderPlayer, body, signTx, opts?): Promise<{ congested: boolean; ... }>;

// Read: getSignaturesForAddress + batched getTransaction; scan meta.logMessages for
// Program data lines, base64-decode, keep wt1 blobs, decode + best-effort decrypt.
readThread(thread, opts?): Promise<ReadMessage[]>;

// Real-time: connection.onLogs(thread, cb, 'confirmed').
subscribeThread(thread, onMessage): { unsubscribe: () => void };

// DM discovery: getSignaturesForAddress(myPlayerPda), filter scope==4, group by thread.
discoverDmThreads(myPlayerPda): Promise<DmConversation[]>;
```

Key access is abstracted behind a `ThreadKeyProvider`: `LocalHmacKeyProvider` (derives directly from `K_master`, used by the CLI and tests) and `HttpKeyProvider` (calls `GET /api/wt/key/...` with `credentials: 'include'`, throwing `WtAuthRequiredError` on 401 and `WtKeyForbiddenError` on 403). There is no `deriveSessionKey` and no `registerSession`; the web layer reuses SIWS via `ensureSession`.

### Read path

The read path uses **`getSignaturesForAddress` + batched `getTransaction`**, not the originally planned Triton `getTransactionsForAddress` (which is not a `Connection` method). For each transaction it scans `meta.logMessages` for `Program data:` lines, base64-decodes them, keeps blobs whose first three bytes are `wt1`, decodes the envelope, and best-effort decrypts. Results are sorted ascending by the chain coordinate `(slot, txIndex, logIndex)` and deduped by 12-byte message ID. A key miss yields `decrypted: false` with an empty payload rather than an error.

Because `getTransaction` and `getSignaturesForAddress` do not surface a transaction's position in its block, `txIndex` is set to `0` with `txIndexResolved: false`; the shipped path therefore orders within a slot by log index only. True `(slot, tx_index, log_index)` ordering requires `getBlock`, which is heavier and reserved for an archival path.

### Real-time

Real-time uses `connection.onLogs(thread, cb, 'confirmed')`. The callback scans the streamed `logs.logs` for `wt1` `Program data:` lines, decodes, and decrypts best-effort. The logs stream does not carry `tx_index`, so streamed messages also use `txIndexResolved: false`.

### Caching

Read caching is a client-side concern (the web layer keeps a Zustand store of decoded messages keyed by thread). There is no IndexedDB key cache encrypted under a derived session secret in the shipped design, because there is no separate war-table session secret to derive from. Any client-side key cache should be short-lived and scoped to threads the user can read; the dominant client risk is in-page code execution (XSS, extensions) reaching live keys, which no at-rest scheme prevents.

## UI integration

The war-table is a `ThreadRenderer` component (`components/war-table/ThreadRenderer.tsx`) embedded inside existing detail panels. Shipped embeds:

- Team page sidebar chat tab: thread bound to `team_pda`.
- `RallyDetailPanel`: thread bound to `rally_pda`.
- `EncounterDetailPanel`: thread bound to `encounter_pda` (plaintext).
- `PvpDetailPanel`: a Message button that navigates to the DM conversation route.
- DM routes: `/messages` (inbox via `useDmInbox`) and `/messages/[peer]` (conversation; derives the pair PDA via `deriveDmThreadPda`).

Deferred:

- Castle embed (scope 2): no `CastleDetailPanel` exists yet, so the castle thread is wired in chain + SDK but not surfaced in any web panel. Tracked in `docs/dev-todo.md`.

The thread component:
1. Reads `useWarTable(thread_pda, scope, { peer })`, a hook combining `readThread` + `subscribeThread` over the SDK client, seeding a Zustand store and fetching keys on demand via `HttpKeyProvider`.
2. Renders a chronological mix of user and system messages (system = kind 2, styled muted; replies = kind 3, show a quoted parent; tombstoned messages hidden).
3. Surfaces a compose box at the bottom; directional affordances use lucide icons, never typed arrows, and UI text carries no em-dashes.
4. Render-filters by membership (defense in depth; auth is already enforced on chain and at the key route).

## Phases (as shipped)

The original plan phased the scopes; the implementation shipped all five at once. What landed:

- **Chain**: the `POST_WAR_TABLE_MESSAGE = 323` instruction with all five scope access predicates, envelope validation, the `key_version == membership_epoch` rule (and the encrypted-flag rule, BC2), the thirteen epoch-bump sites, and the `membership_epoch` / `joined_at_epoch` account fields.
- **SDK + crypto**: envelope encode/decode, the HMAC KDF, XChaCha20-Poly1305 encrypt/decrypt with the 72-byte AAD, the `WarTableClient` (`postMessage` with the priority-fee ceiling, `readThread`, `subscribeThread`, `discoverDmThreads`), the `ThreadKeyProvider` implementations, and updated state parsers. Covered by a crypto unit suite and an e2e suite.
- **Web**: the SIWS-authed key route, the Zustand store, `useWarTable` / `useDmInbox`, `ThreadRenderer`, and the team / rally / encounter / DM / PvP embeds plus the Messages nav entry.

Message kinds shipped: text (0), pledge (1), system (2), reply (3), tombstone (4). Pledges remain non-binding hints; the rally's `join` instruction is still the only commitment. System messages are surfaced client-side by indexing the same tx history and merging into the timeline.

### Still optional, far future

- Permanent archival: snapshot a thread's tx history (with `K_thread` versions exported alongside) into a Bubblegum tree as a frozen archive.
- Sealed-sender / metadata privacy if the threat model ever shifts.
- **Per-scope server-untrusted mode** for scopes that genuinely cannot trust the server. See below.

## Future: per-scope server-untrusted mode

If a future scope (DAO governance coordination, treasury secrets, anything where "the dev can read this" is unacceptable) needs confidentiality against the game server itself, swap that one scope's encryption layer for per-recipient hybrid, the `novus_forum` 2022 model.

The on-chain side is identical: same instruction, same wire format, same `flags` byte signalling encryption. Only the SDK's encrypt/decrypt path branches on scope type.

What the per-recipient mode adds (kept out of v1):

- ECDH between sender's session ECDH key (ed25519 to x25519) and each recipient's
- HKDF-SHA256 wrap-key derivation
- Per-recipient wrapped-K blob in the envelope (~80 bytes/recipient)
- Fan-out across ceil(N/10) txs for scopes with more than 10 members
- On-chain attestation logs to publish wallet-to-session bindings without API mediation

This stays archived as an internal SDK module until needed. Wire format is forward-compatible: a new flag bit (`flags.per_recipient = 1`) signals a per-recipient envelope, and the parser branches.

## Chain is storage

There is no database for chat. Messages live only in Solana transaction logs (`sol_log_data`), and the read path (`getSignaturesForAddress` + `getTransaction`) can only return what the RPC still has. **A standard validator prunes old transaction history after its retention window, after which those calls silently return empty for old slots, with no error.** Durable war-table history therefore depends on an **archival RPC (Triton, Helius, or equivalent) that retains `sol_log_data` indefinitely**. A non-archival deployment will lose old chat with no warning: the reads succeed, they just return nothing for pruned slots. This is a deployment-level requirement, not a code path, so it is called out here explicitly: point the war-table read path at an archival endpoint.

## Per-message priority-fee ceiling

War-table posts are non-urgent and must not overpay during a siege fee spike. The SDK defines `WT_MAX_PRIORITY_FEE_MICRO_LAMPORTS_PER_CU = 50_000` (overridable per call). On each post, `postMessage` reads `getRecentPrioritizationFees([thread])`, takes the median, and uses `min(median, ceiling)`; if the median exceeds the ceiling it sets `congested: true` in the result and still caps at the ceiling. The post never exceeds the ceiling, so a fee-market spike cannot turn a 0.00025 SOL chat message into an expensive transaction.

## Open questions

1. **Rate limiting on posts.** Enforce a 2s cooldown on chain? Likely no; client throttle plus chain cost are enough.
2. **System message extraction.** Surfaced client-side: walk the same tx history, detect known event signatures, render as `kind=2`. A server-side relay remains a future option.
3. **Encounter spam.** Encounters are open-kingdom; anyone in the kingdom can post. Counter is render-side rate limiting per sender.
4. **Wallet compatibility.** Posting needs `signTransaction`; auto-approve makes active-raid posting silent. Hardware wallets fall back to per-message popups.
5. **`K_master` durability.** Keys are never stored, but `K_master` is the single point of total loss: lose it and every encrypted thread bricks at once. With the env-secret default it must be backed up as a managed deployment secret; the KMS upgrade adds multi-region DR for the key.

## Migration notes

The read path already uses vanilla `getSignaturesForAddress` + batched `getTransaction`, so there is no Triton-specific dependency to migrate off. To make reads faster, stand up a custom indexer (Geyser plugin, or a `logsSubscribe` + database materializer) over the same `wt1` logs; the data is identical, just faster to query. The archival-retention requirement under [Chain is storage](#chain-is-storage) applies to whatever RPC backs the read path.

If the project ever wants to drop server trust for a specific scope:

- Implement the per-recipient hybrid SDK path described in [Future](#future-per-scope-server-untrusted-mode).
- Set a new flag bit in `flags` to mark per-recipient envelopes.
- Existing server-encrypted messages remain readable from their `K_thread` versions; new posts in that scope use per-recipient.

## References

- `docs/WAR_TABLE_IMPL_SPEC.md` - the authoritative implementation spec (file paths, byte offsets, error codes, tasks, and the binding corrections in section 13).
- `sdks/novus_forum/` - 2022 ancestor. The per-recipient encryption is archived for the future server-untrusted mode.
- `programs/novus_mundus/src/processor/rally/execute.rs` - the on-chain commitment surface that pledges compile into.
- `@noble/ciphers` (XChaCha20-Poly1305) and `@noble/hashes` (HMAC-SHA256) - the entire crypto dependency.

## What we explicitly are not doing

- Not running Postgres for chat (chain is storage; see [Chain is storage](#chain-is-storage)).
- Not running Redis for the war table at all: no version counters, no session bindings, no key storage.
- Not running a separate API service or a chain-event rotation listener (the chain owns rotation).
- Not running a DAS indexer.
- Not minting cNFTs for messages.
- Not creating a separate `novus_forum` v2 program.
- Not posting on-chain attestations and not running a custom `/wt/register` session (key-fetch auth reuses SIWS).
- Not doing per-recipient encryption in v1 (archived for future server-untrusted scopes).
- Not signing the envelope with a session key (chain tx signature covers authorship).
- Not claiming end-to-end encryption or forward secrecy. See [Trust model](#trust-model) and [Trust ceiling](#trust-ceiling-read-this-before-relying-on-war-table-confidentiality).
- Not hiding metadata (sender, thread, timing remain public).
- Not adding new account types to `novus_mundus` (the epoch fields reuse reserved bytes).

The smallest viable surface that does the job, no more.
