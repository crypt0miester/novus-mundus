# War Table — Design Plan

**Status**: Not started. Planning document, no code yet.
**Owner**: TBD.
**Estimate**: ~1 week to v1 (team scope, encrypted), +0.5 week per additional scope variant.

## Goal

A war-table is the social/coordination layer of the game. Players need to:

1. **Discuss strategy** with their team, with people they're rallying, in a castle siege, on a specific encounter, or in a DM.
2. **Pledge contributions** before a raid — "I'm bringing 5k tier-3 + my hero in slot 1" — visible to teammates before the on-chain rally commits.
3. **See live game-state context** alongside the chat — the target castle's HP, current defenders, attack window, vesting timers.
4. **Read the historical outcome** — "rally executed, won, took 12% casualties" — as a system message in the same thread.

The war-table is *not* a replacement for gameplay state. Rallies, attacks, and castle conquest stay on-chain in the existing `novus_mundus` program. The war-table is the coordination overlay that lives between intent and commitment.

## Non-goals

- **Not** a generic chat product. Threads exist only as overlays on game entities.
- **Not** a fix for `novus_forum`. Referenced as a design ancestor; we're not modifying or deploying it.
- **Not** end-to-end encrypted in the strict sense. See [Trust model](#trust-model) — bodies are protected against passive chain observers (rival players), not against the game server itself.
- **Not** trying to hide metadata. Sender wallet, thread PDA, and timing remain public.

## Decision summary

**Build it on the existing `novus_mundus` program. Emit messages as `sol_log_data` from a single new instruction. Encrypt the body once with a per-thread symmetric key `K_thread` held in the game API's Redis. Clients fetch `K_thread` from the API (auth'd by session key); the API authorises by checking on-chain scope membership. Read via Triton's `getTransactionsForAddress`. Real-time via `logsSubscribe`. Public scopes (encounter) skip encryption entirely.**

Cost: ~$0.00025 per message, paid by sender. One API call per session per thread to bootstrap the key — none per message after that.

## Trust model

What this design does and does not protect.

| | Protected? |
|---|---|
| Rival players reading the chain to learn rally plans | yes — they don't have `K_thread` |
| A passive observer of public RPC | yes |
| A Redis dump / snapshot / replica / backup leak | yes — Redis holds no secret key material (see [Key custody](#key-custody-admin-side-security)) |
| A malicious or compromised game-server operator | **no — server can derive any thread key via KMS** |
| Loss of a single member's device | yes — they only had cached keys, no thread-key material leaks beyond what they could read |
| Censorship by the chain | yes — chain accepts the post regardless |
| Censorship by the API | partial — API can refuse to hand over keys, but ciphertext on chain is recoverable when access is restored |

This is the same trust model the rest of the game already uses. Players trust the game server with their wallet integration, NOVI balance, hero state, oracle prices, and everything else. Trusting it with team chat is consistent. For a future scope that genuinely can't trust the server (DAO governance, treasury secrets), the design preserves an upgrade path — see [Future: per-scope server-untrusted mode](#future-per-scope-server-untrusted-mode).

## Options considered (and why we rejected them)

| Option | Verdict |
|---|---|
| Fork `novus_forum` as-is (Anchor 0.26, per-recipient accounts) | Per-message-per-recipient account creation costs ~0.005 SOL/msg. Doesn't scale. |
| Postgres + WebSocket | User explicitly didn't want to operate a DB. |
| Redis Streams + Pub/Sub for storage | API down = chat down, history gone. Rejected. |
| Solana Memo program + thread PDA | Works but no on-chain auth — anyone can post to any thread. |
| State compression / Bubblegum cNFTs | 2–3 weeks of engineering, requires DAS indexer. |
| `novus_mundus` instruction + per-recipient hybrid (`novus_forum` 2022 model) | Sound but heavy: HKDF + ECDH + ed25519↔x25519 + attestations + fan-out for teams > 10. Useful when we don't trust the server; overkill for in-team chat. **Archived for future server-untrusted scopes.** |
| **`novus_mundus` instruction + API-held `K_thread`** | ✅ Picked. Same on-chain shape, no client crypto beyond AEAD, no fan-out, new members read history, member-leave actually revokes future access. |

## Architecture

```
Player wallet
   │ signs fixed challenge once (no popup per read after that)
   ▼
Session ed25519 keypair                 // only used to auth to game API
   │
   ▼
First-time: POST /wt/register
   │ wallet_sig over (session_pubkey, expiry) → API caches in Redis
   ▼
Bootstrap thread: GET /wt/key/{thread_pda}
   │ session-signed challenge → API verifies session→wallet binding,
   │ reads chain to confirm wallet ∈ scope, returns current K_thread + recent versions
   ▼
Sending (encrypted scope):
   1. body_nonce = random 24 bytes
   2. ciphertext = XChaCha20-Poly1305(K_thread, body_nonce, plaintext)
   3. Wallet-signed tx → novus_mundus::post_war_table_message
   ▼
novus_mundus::post_war_table_message
   │ verifies sender (tx signer) ∈ scope(thread_pda)
   │ verifies envelope.thread_pda == passed thread account
   │ verifies envelope.sender_wallet == tx signer
   │ emits sol_log_data(envelope_bytes)
   ▼
Solana tx log
   │
   ├──> getTransactionsForAddress(thread_pda) ──> envelopes
   │       ↓ recipient client side
   │       look up K_thread by key_version (cache or API) → AEAD-open → plaintext
   └──> logsSubscribe(thread_pda)              ──> real-time push (same decrypt path)
```

The **thread PDA** is *any existing game entity*. Every team, rally, castle, encounter, and player already has a PDA on chain; that PDA is the addressable thread marker on chain *and* the Redis index for `K_thread`.

### Scopes

| Scope | Thread PDA | Who can post | Encryption |
|---|---|---|---|
| Team | `TeamAccount` PDA | Members in `team.members` | API-held `K_thread` |
| Rally war-room | `RallyAccount` PDA | Rally creator + joined participants | API-held `K_thread` |
| Castle siege | `CastleAccount` PDA | Garrison + attackers within siege window | API-held `K_thread` |
| Encounter | `EncounterAccount` PDA | Any player in the same kingdom (open channel) | **Plaintext** (no key, no API call) |
| Player DM | Recipient's `PlayerAccount` PDA | Anyone | API-held `K_thread` (members = sender + recipient) |

Scope is parsed from the account discriminator on the thread account. Access predicates live in `processor/war_table/access.rs`.

## Data model (log schema)

Every `post_war_table_message` instruction emits one `sol_log_data` call. Wire format is uniform for encrypted and plaintext envelopes; only `flags` and the interpretation of `body` differ.

```
[
  b"wt1",                              //  3 bytes — protocol discriminator (v1)
  flags: u8,                           //  1 byte  — bit 0: encrypted body
  thread_pda: [u8; 32],                // 32 bytes — replay-across-threads defence
  sender_wallet: [u8; 32],             // 32 bytes — must equal tx signer
  key_version: u32,                    //  4 bytes — which K_thread version; 0 if plaintext
  body_nonce: [u8; 24],                // 24 bytes — AEAD nonce; zero if plaintext
  body_len: u16,                       //  2 bytes — length of body field
  body: [u8; body_len],                // var      — ciphertext if encrypted, plaintext otherwise
]
```

**Fixed overhead: 98 bytes.** After tx skeleton, body budget is ~860 bytes per single tx. Same for any scope size — no recipient blob, no fan-out, no multi-page assembly.

**No envelope signature.** Authorship is established by the chain transaction signature: the tx is signed by `sender_wallet`, and the program enforces `envelope.sender_wallet == tx signer`. Session keys exist only to authenticate to the game API — they have no role in on-chain authentication.

### Body schema (inside `body`)

| Offset | Field | Bytes | Notes |
|---|---|---|---|
| 0 | `version: u8` | 1 | `0x01` |
| 1 | `kind: u8` | 1 | 0=text, 1=pledge, 2=system, 3=reply, 4=tombstone |
| 2 | `created_at: i64` | 8 | Unix seconds, client-stamped |
| 10 | `parent_id?: [u8; 12]` | 12 | `(slot, tx_index, log_index)` of parent if reply; zeros otherwise |
| 22 | `payload: &[u8]` | var | Kind-specific |

**Per-kind payloads:**

- `text(0)`: UTF-8 bytes
- `pledge(1)`: `[u64 tier1, u64 tier2, u64 tier3, u8 hero_slot, i64 ready_at]`
- `system(2)`: structured event reference (e.g., `RallyExecuted` slot+sig)
- `reply(3)`: same as text but `parent_id` set
- `tombstone(4)`: superseded message's id; UI hides the original

**Message ID** (stable, not stored on chain): `(slot, tx_index_in_block, log_index_in_tx)` — 12 bytes, monotonically ordered, deterministic across re-reads.

## Auth model

### Session key derivation (one wallet popup, then silent)

The wallet signs a fixed challenge once per browser session:

```ts
async function deriveSessionKey(wallet: Wallet): Promise<Keypair> {
  const challenge = new TextEncoder().encode("novus-mundus war-table session v1");
  const sig = await wallet.signMessage(challenge);
  const seed = sha256(sig);
  return nacl.sign.keyPair.fromSeed(seed);
}
```

Same wallet → same session key, every time. No cross-device sync needed. The session secret never leaves the browser.

### Session registration (one POST after first derive)

Before fetching any thread key, the client registers the session→wallet binding with the API:

```ts
async function registerSession(wallet: Wallet, session: Keypair, expiry: number) {
  const payload = serialize({ session_pubkey: session.publicKey, expiry });
  const wallet_sig = await wallet.signMessage(payload);
  await api.post("/wt/register", {
    wallet: wallet.publicKey.toBase58(),
    session_pubkey: session.publicKey.toBase58(),
    expiry,
    wallet_sig: base58(wallet_sig),
  });
}
```

API verifies `wallet_sig` under `wallet`, then stores `(session_pubkey → wallet, expiry, wallet_sig)` in Redis. The stored `wallet_sig` is re-verified every time the binding is consumed, so the record is self-authenticating: a Redis *write* compromise cannot forge a session→wallet binding (the attacker cannot produce a valid wallet signature). All later key requests use a session-key signature on a short-lived nonce — no wallet involvement on reads.

This replaces on-chain attestations entirely. The wallet↔session binding lived on chain in the per-recipient design because every reader needed to verify it independently. Now that the API mediates key access, the binding lives in Redis where the API checks it directly.

### Per-post authorship

Posting still requires a wallet-signed transaction — the program checks `sender == envelope.sender_wallet`. For active raids, players enable Phantom/Backpack's auto-approve toggle so posts are silent. Without auto-approve, every post is a popup; acceptable for v1. A relayer + on-chain session delegation would reintroduce the complexity we just removed.

## Encryption

### Construction

```
K_thread     = HMAC(K_master, "wt1" ‖ thread_pda ‖ u32(key_version))   // derived inside KMS by the
                                                                       // API; delivered + cached locally
body_nonce   = random 24 bytes per message
ciphertext   = xchacha20poly1305(K_thread, body_nonce, plaintext)
```

That's the entire client-side crypto. No HKDF, no ECDH, no curve conversion, no recipient blob, no signature. See [Key custody](#key-custody-admin-side-security) for how `K_thread` is derived and protected.

### Decryption

```
1. K_thread = local_cache.get((thread_pda, envelope.key_version))
            ?? await api.getKey(thread_pda, envelope.key_version)
2. plaintext = xchacha20poly1305_open(K_thread, envelope.body_nonce, envelope.body)
```

A miss on `key_version` (e.g., the user is reading history from before they joined and the API doesn't expose that version to them) yields an unreadable message — the UI surfaces "not available for this account."

### Plaintext path (encounters, future public scopes)

```
flags.encrypted = 0
key_version     = 0
body_nonce      = 0       // padded for uniform parsing
body            = plaintext
```

No API call. The chain tx signature still authenticates the author.

### Library choice

`@noble/ciphers` for XChaCha20-Poly1305. That's the entire crypto dependency.

## Key custody (admin-side security)

The design has exactly one long-lived secret: `K_master`. Everything else is derived from it or is public. This section is the admin-side threat model.

### Principle: Redis holds nothing worth stealing

Redis values are not encrypted at rest, so assume any Redis contents can leak — RDB/AOF snapshot, replica, backup file, `MONITOR`, memory dump. The design therefore puts **no secret key material in Redis**:

- Thread keys are **derived, not stored**: `K_thread_v = HMAC(K_master, "wt1" ‖ thread_pda ‖ u32(version))`.
- Redis holds only the current version integer per thread and session↔wallet bindings — none of it secret.
- A full Redis dump yields version counters and public-key correlations. Nothing in it decrypts a message.

This is strictly stronger than storing KMS-wrapped keys in Redis: there is no wrapped blob to pair with a future KMS compromise.

### Principle: `K_master` never leaves the HSM

`K_master` is a non-exportable HMAC key in a managed KMS / Cloud HSM (AWS KMS HMAC keys, GCP Cloud KMS MAC keys — both GA). The API never fetches it. To derive a thread key the API calls `GenerateMac(key_id, "wt1" ‖ thread_pda ‖ version)`; the HMAC is computed **inside** the HSM and only the 32-byte result returns.

Consequences:

- The API process never holds `K_master`. An API memory dump cannot exfiltrate it.
- Every derivation is a logged KMS call (CloudTrail / Cloud Audit Logs). Bulk derivation — an attacker dumping every thread key — is visible.
- Access is revocable instantly: disable the KMS key and all decryption stops. This is the breach kill-switch (it stops chat too — the correct trade under active compromise).
- The API caches derived `K_thread` in memory with a short TTL (~5 min) so it isn't calling KMS on every read. A deliberate, bounded exposure: an API memory dump reveals only the keys cached in that window.

Use a separate KMS key per environment (dev / staging / prod). Never share.

### Redis integrity, not just confidentiality

A leak is one risk; an attacker who can *write* to Redis is another. The dangerous write is forging a session↔wallet binding (`wt:session:{attacker_session} → victim_wallet`), which would make the API hand victim-scoped keys to the attacker.

Defence: the binding stores the original `wallet_sig`, and the API re-verifies it under the named wallet every time the binding is consumed. A binding that did not come from a genuine `/wt/register` — i.e. lacks a valid wallet signature over `session_pubkey ‖ expiry` — is rejected. The record is self-authenticating; its trust does not depend on Redis being trusted.

### The key still leaves your servers — harden the client

`K_thread` is delivered to clients and cached in IndexedDB. That cache is encrypted at rest under `HKDF(session_secret, "wt-cache-v1")`; the session secret is re-derived in-browser from a wallet signature and never persisted, so a stolen IndexedDB file alone is useless. This stops at-rest theft (shared computer, offline malware) — it does **not** stop code executing in the page (XSS, malicious extension), which reaches live keys regardless. Keep the IndexedDB key-cache TTL short.

### Hardening checklists

**Redis** (defence in depth, even though it holds no secrets):
- ACL users per service, minimal command set; strong `requirepass`.
- `rename-command` to disable `MONITOR`, `DEBUG`, `KEYS`, `FLUSHALL`, `CONFIG`.
- TLS for client and replication traffic; bind to a private network; never publicly reachable.
- A dedicated logical DB or instance for war-table data.

**KMS:**
- Key policy grants only the API's workload identity `GenerateMac`; no human role has it in prod.
- Audit logging on; alarm on anomalous derivation volume.
- Multi-region replica of the KMS key for DR — losing `K_master` bricks every thread.
- No long-lived IAM keys; use instance / workload identity.

### The honest ceiling

What this design cannot eliminate:

- **API host RCE.** An attacker on the API host can call KMS to derive any thread key for as long as they hold the host. Detectable (audit logs), revocable (disable the KMS key), non-exfiltratable (`K_master` stays in the HSM) — but not prevented. To shrink this further, split the membership-check service from the key-derivation service so an RCE on the user-facing one can't directly derive.
- **Client-side compromise.** XSS or a malicious extension leaks the keys that client held — bounded to that user's threads, not global.
- **Malicious insider.** Anyone with production KMS access can derive everything. Irreducible — the "you trust the operator" property already stated in the [Trust model](#trust-model). Audit logs make it detectable after the fact; only per-recipient client-to-client encryption removes it ([Future: per-scope server-untrusted mode](#future-per-scope-server-untrusted-mode)).

The achievable guarantee: **a Redis compromise — the cheapest, most common breach — yields zero readable messages.** Decryption requires live KMS access, which is logged and revocable.

## Key rotation

`K_thread` rotates when scope membership changes — a kicked team member, a finished rally, a conquered castle. Old versions are kept indefinitely so historical messages remain readable to members who were present at the time. New versions are unreachable for members who lost access.

### Trigger sources

Rotation fires only on access-*loss* events — never on join. Adding a member can't compromise anyone (the new member learning the current key is the point); removing a member is the only thing that demands a key they don't know. Rotating on join would also pointlessly bar the new member from reading history they're now entitled to.

The API runs a chain-event listener that subscribes to `novus_mundus` via `logsSubscribe` at `processed` commitment. On these events it rotates `K_thread`:

- `TeamMemberRemoved`, `TeamDisbanded`
- `RallyEnded`, `RallyCanceled`
- `CastleConquered`, `CastleAbandoned`

Rotation = bump `current_version` in `wt:thread:{thread_pda}`. Nothing else happens — the new key is `HMAC(K_master, "wt1" ‖ thread_pda ‖ new_version)`, derived on demand. Old versions are not "kept"; they are simply re-derivable forever from `K_master`. Rotation only makes *newer* messages unreadable to whoever lost access.

### Race window (leaver fetches key one more time)

Between the on-chain kick tx confirming and the API rotating, a kicked member could fetch the old key. Mitigations:

- API watches at `processed` commitment — sub-second latency from tx submission to rotation.
- Per-session-per-thread fetch rate-limit: 1 fetch per minute. A leaver can't poll faster than rotation lands.
- Even in the worst case, the leaker gets the old K, which is being rotated *out*; they can't decrypt anything sent after rotation. They could have already received any pre-rotation message anyway.

Acceptable for v1.

### Versioning: reading old messages after a rotation

Every envelope records the `key_version` it was encrypted under. Decryption always uses *that* version — a message posted under v3 decrypts with `HMAC(K_master, "wt1" ‖ thread ‖ 3)` forever, no matter how many rotations followed.

- **Old versions are never lost** because they are never stored — every version is re-derivable from `K_master` on demand. The retention invariant collapses to a single one: **never lose `K_master`** (see [Key custody](#key-custody-admin-side-security)).
- **A current scope member can fetch every version** via `GET /wt/key/{thread}` and read the entire thread back to its first message — including history from before they joined.
- **A removed member** keeps whatever versions are already in their local cache, so old messages they previously had access to still render. They cannot fetch the post-removal version, and cannot re-fetch anything if they clear their cache — the API only serves current members.

There is no decryption "grace period." After a rotation a client may briefly still *encrypt* under the prior `current` version until it refreshes the pointer (a ~60s poll, or a `logsSubscribe` rotation hint). Those posts are still perfectly decryptable — they just sit one version behind. The only effect is a marginally wider race window for a just-removed member, already covered under [Race window](#race-window-leaver-fetches-key-one-more-time).

## Program changes

### New file

`programs/novus_mundus/src/processor/war_table/post.rs`

Single instruction `post_war_table_message`. Accepts:

- **Accounts**:
  - `thread` (target PDA — rally / castle / encounter / team / player)
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
4. Emit `sol_log_data` with the envelope payload.
5. No state mutation. Tx cost = base fee + compute. No rent.

The program is intentionally crypto-agnostic — it sees the envelope as opaque bytes and only checks that the sender is in the scope and the envelope honestly names them as author. Whether the body is `K_thread`-encrypted, plaintext, or in some future per-recipient format is invisible to the chain.

### New file

`programs/novus_mundus/src/processor/war_table/access.rs`

Pure predicates:
- `is_team_member(team, sender)`
- `is_rally_participant(rally, sender)`
- `is_castle_combatant(castle, sender)`  // garrison or attacker
- `is_in_kingdom(encounter, player)`
- `is_dm_open(recipient, sender)`  // permissive for v1; UI filters spam

### Instruction index

Adds one new instruction at the next free discriminator. No state schema changes anywhere else in `novus_mundus`. Backwards-compatible.

## API surface

New module in the existing game API: `apps/api/src/wartable/`.

### Redis layout

Redis holds **no secret key material** — see [Key custody](#key-custody-admin-side-security). Thread keys are derived from KMS on demand, never stored.

```
wt:session:{session_pubkey}   → JSON { wallet, expiry, wallet_sig }   TTL = expiry
wt:thread:{thread_pda}        → JSON { current_version, scope_type, created_at, rotated_at }
```

`current_version` is a plain integer; `wt:thread:{thread_pda}` is lazily created (version 1) on first access. `wallet_sig` makes the session binding self-authenticating — the API re-verifies it on use, so a Redis *write* compromise cannot forge a binding. A full Redis dump yields only version counters and public session↔wallet correlations: nothing that decrypts a message.

### Endpoints

```
POST /wt/register
  body: { wallet, session_pubkey, expiry, wallet_sig }
  effect: verify wallet_sig under wallet over (session_pubkey || expiry); store binding

GET /wt/key/{thread_pda}?from_version=<n>
  headers: { X-Session-Sig: base58 sig over short-lived server-issued nonce }
  effect: look up session → wallet (re-verify stored wallet_sig), read chain for scope
          membership, derive the requested versions via KMS GenerateMac, return
          { current_version, keys: [{ version, K_base64 }, ...] }
  default response window: current version + last 10. Older requested via from_version.

(internal) chain-event listener
  subscribes to novus_mundus logs; rotates K_thread on membership-change events
```

### Rate limiting

- `POST /wt/register`: 1 per wallet per day.
- `GET /wt/key/{thread_pda}`: 1 per session per thread per minute.

Tight enough to close the leaver race window; loose enough that legitimate clients (mobile users switching networks) can re-fetch on session revival.

### Failure modes

- **Redis down**: API returns 503 on key fetch. Cached keys still work; new sessions can't bootstrap. Chat degrades to "read-ciphertext-only" until Redis returns.
- **Chain RPC down**: API can't verify scope membership; new key fetches blocked. Existing posts on chain remain encrypted-but-readable for sessions that already have the key.
- **Chain-event listener down**: rotations stop. Leavers retain key access for the outage window. Operationally critical; alert on listener heartbeat.
- **KMS down**: API can't derive thread keys. API-side cache serves the TTL window; clients with cached keys keep working; new derivations blocked until KMS returns.

## Client SDK

`sdks/novus-mundus-ts/src/wartable.ts`

```ts
// Send (encrypts with cached K_thread, posts via novus_mundus)
postMessage(thread: PublicKey, body: Uint8Array, opts?: {
  kind?: MessageKind;
  parent?: MessageId;
}): Promise<MessageId>;

// Read (decrypts with cached K_thread; fetches from API on cache miss)
readThread(thread: PublicKey, opts?: {
  limit?: number;
  before?: PaginationCursor;
}): Promise<{ messages: Message[]; cursor?: PaginationCursor }>;

// Real-time
subscribeThread(
  thread: PublicKey,
  onMessage: (m: Message) => void,
): Unsubscribe;

// Session bootstrap
deriveSessionKey(wallet: Wallet): Promise<Keypair>;   // cached in IndexedDB
registerSession(wallet: Wallet): Promise<void>;       // POST /wt/register; idempotent

// Key cache (surfaced for diagnostics)
getThreadKey(thread: PublicKey, version?: number): Promise<Uint8Array>;
```

### Read path (Triton)

```ts
async function readThread(thread, { limit = 50, before } = {}) {
  const res = await rpc.send("getTransactionsForAddress", [
    thread.toBase58(),
    {
      limit,
      sortOrder: "desc",
      details: "full",
      encoding: "base64+zstd",
      filters: { programIds: [NOVUS_MUNDUS_PROGRAM_ID.toBase58()], excludeFailed: true },
      paginationToken: before,
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    },
  ]);
  const envelopes = res.result.transactions.flatMap(extractWarTableLogs);
  return {
    messages: await Promise.all(envelopes.map(decryptEnvelope)),
    cursor: res.result.paginationToken,
  };
}
```

### Real-time

```ts
function subscribeThread(thread, onMessage) {
  return connection.onLogs(thread, (logs) => {
    extractWarTableLogs(logs).forEach(async (env) => onMessage(await decryptEnvelope(env)));
  }, "confirmed");
}
```

### Caching

Two IndexedDB caches per origin:

- `(thread_pda, last_seen_signature) → Message[]` for instant cold-load.
- `(thread_pda, key_version) → K_thread` to avoid re-fetching from the API every page load.

**The key cache is encrypted at rest** under `HKDF(session_secret, "wt-cache-v1")` — the session secret is re-derived in-browser from a wallet signature and never persisted, so a stolen IndexedDB file is useless without the wallet. This protects against at-rest theft only; code running in the page (XSS, malicious extension) can still reach the live keys. Both caches are cleared on session expiry or wallet change; keep the key-cache TTL short.

## UI integration

The war-table is a **thread renderer** that lives inside existing detail panels:

- `RallyDetailPanel` → embed thread bound to `rally_pda`
- `EncounterDetailPanel` → embed thread bound to `encounter_pda` (plaintext)
- `PvpDetailPanel` → embed thread bound to defender's `player_pda`
- Castle detail (TBD) → embed thread bound to `castle_pda`
- Team page → embed thread bound to `team_pda`

The thread component:
1. Reads `useWarTable(thread_pda)` — hook combining `readThread` + `subscribeThread` with IndexedDB caching and on-demand key fetches.
2. Renders chronological mix of user messages + system messages (decoded from the same tx history).
3. Surfaces a compose box (text or pledge picker) at the bottom.
4. Render-filters by membership predicate (defense in depth — auth is already enforced on chain and at the API).

## Phases

### Phase 1 — Team chat (v1)

- One scope only: team-scoped threads, thread PDA = `TeamAccount` PDA.
- Text messages only (`kind=0`).
- Add `post_war_table_message` instruction to `novus_mundus`.
- API: `POST /wt/register`, `GET /wt/key/{thread}`, chain-event listener for team membership.
- Client SDK with `deriveSessionKey`, `registerSession`, `postMessage`, `readThread`, `subscribeThread`.
- Embed in the team page.

**Ships in ~1 week.** Client crypto is one AEAD call; everything else is REST + chain reads.

### Phase 2 — Rally war-room

- Add rally scope (access predicate, scope detection in program; API rotation triggers on rally lifecycle events).
- Add `pledge` kind to body schema.
- Pledges appear as a sidebar widget in the rally thread, summed and rendered live.
- Pledges are *non-binding hints* — the rally's actual `join` ix is still the only commitment.

### Phase 3 — Castle siege + encounter coordination

- Add castle scope (garrison + attacker access; API rotation on garrison-*loss* events — a departing defender, never a joining one).
- Add encounter scope (open kingdom; plaintext; no API involvement).
- Surface system messages from existing on-chain events (`RallyExecuted`, `CastleConquered`, `EncounterDefeated`) by indexing the same tx history client-side and merging into the timeline.

### Phase 4 — DM + polish

- Player-to-player DMs (open by default, render-filtered).
- Reply chains (`kind=3`, `parent_id` set).
- Tombstones (`kind=4`) for soft-delete in UI.

### Phase 5 — Optional, far future

- Permanent archival: snapshot a thread's tx history (with K_thread versions exported alongside) into a Bubblegum tree as a "frozen archive."
- Sealed-sender / metadata privacy if the threat model ever shifts.
- **Per-scope server-untrusted mode** for scopes that genuinely can't trust the server. See below.

## Future: per-scope server-untrusted mode

If a future scope (DAO governance coordination, treasury secrets, anything where "the dev can read this" is unacceptable) needs confidentiality against the game server itself, swap that one scope's encryption layer for per-recipient hybrid — the `novus_forum` 2022 model.

The on-chain side is identical: same instruction, same wire format, same `flags` byte signalling encryption. Only the SDK's encrypt/decrypt path branches on scope type.

What the per-recipient mode adds (kept out of v1):

- ECDH between sender's session ECDH key (ed25519↔x25519) and each recipient's
- HKDF-SHA256 wrap-key derivation
- Per-recipient wrapped-K blob in the envelope (~80 bytes/recipient)
- Fan-out across ⌈N/10⌉ txs for scopes with > 10 members
- On-chain attestation logs to publish wallet→session bindings without API mediation

This stays archived as an internal SDK module until needed. Wire format is forward-compatible — a new flag bit (`flags.per_recipient = 1`) signals a per-recipient envelope, and the parser branches.

## Open questions

1. **Pagination cursor format.** Triton's `paginationToken` is opaque — confirm it's stable across reconnects.

2. **Rate limiting on posts.** Enforce a 2s cooldown in `post_war_table_message`? Probably no — client throttle + chain cost are enough.

3. **System message extraction.** Two options for surfacing on-chain events in the timeline:
   - (a) Client-side: walk the same tx history, detect known event signatures, render as system messages.
   - (b) Server-side relay: indexer posts a synthetic `kind=2` message.
   v1: (a).

4. **Encounter spam.** Encounters are open-kingdom — anyone can post. Counter: render-side rate limit per sender.

5. **Wallet compatibility.** Both Phantom and Backpack support `signMessage`. Hardware wallets vary — fall back to per-message wallet popups.

6. **Auto-approve and posting UX.** Encourage Phantom auto-approve toggle for active raids. Document the trade-off.

7. **KMS choice for key-at-rest encryption.** AWS KMS, GCP KMS, or local HSM. Decide at deploy time.

8. **Breach posture.** Redis exfiltration alone exposes nothing — no secret material (see [Key custody](#key-custody-admin-side-security)). The real exposure is `K_master`: anyone who can call the KMS derivation key can derive any thread key. Mitigate with least-privilege KMS policy, audit logging, an anomaly alarm on derivation volume, and the documented kill-switch (disable the KMS key to halt all decryption instantly).

9. **Chain reorgs and rotation.** A reorg could un-confirm a membership-change tx after we rotated. API would over-rotate — extra version, no harm. Stays correct.

10. **`K_master` durability.** With derived keys there are no stored versions to retain — but `K_master` becomes the single point of total data loss: lose it and every encrypted thread bricks at once. It must be a non-exportable KMS key with multi-region replication and proper DR. Never a copy-pasteable secret, never exported.

## Migration notes

If the project ever leaves Triton or migrates to a self-hosted indexer:

- On-chain side unchanged — envelopes stay in tx logs.
- Read path switches to vanilla `getSignaturesForAddress` + batched `getTransaction`. Same data, slower.
- Or stand up a custom indexer (Geyser plugin or `logsSubscribe` + Postgres) materialising threads. Same data, faster reads, our infrastructure.

If the project ever wants to drop API trust for a specific scope:

- Implement the per-recipient hybrid SDK path described in [Future](#future-per-scope-server-untrusted-mode).
- Set a new flag bit in `flags` to mark per-recipient envelopes.
- Existing API-encrypted messages remain readable from their K_thread versions; new posts in that scope use per-recipient.

## References

- `sdks/novus_forum/` — 2022 ancestor. The wallet→session derivation trick comes from here. The per-recipient encryption is archived for the future server-untrusted mode.
- `programs/novus_mundus/src/processor/rally/execute.rs` — the on-chain commitment surface that pledges compile into.
- Triton `getTransactionsForAddress` — https://docs.triton.one/chains/solana/gettransactionsforaddress
- `@noble/ciphers` — XChaCha20-Poly1305. That's the entire crypto dependency.

## What we explicitly are not doing

- Not running Postgres for chat (chain is storage).
- Not running Redis for chat *storage*, and not storing keys in Redis (only non-secret version counters + self-authenticating session bindings).
- Not running a DAS indexer.
- Not minting cNFTs for messages.
- Not creating a separate `novus_forum` v2 program.
- Not posting on-chain attestations (replaced by API session registration).
- Not doing per-recipient encryption in v1 (archived for future server-untrusted scopes).
- Not signing the envelope with a session key (chain tx signature covers authorship).
- Not claiming end-to-end encryption. See [Trust model](#trust-model).
- Not hiding metadata (sender, thread, timing remain public).
- Not adding new account types to `novus_mundus`.

The smallest viable surface that does the job, no more.
