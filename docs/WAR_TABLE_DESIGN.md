# War Table — Design Plan

**Status**: Not started. Planning document, no code yet.
**Owner**: TBD.
**Estimate**: ~1.5 weeks to v1 (team scope, encrypted), +1 week per additional scope variant.

## Goal

A war-table is the social/coordination layer of the game. Players need to:

1. **Discuss strategy** with their team, with people they're rallying, in a castle siege, on a specific encounter, or in a DM.
2. **Pledge contributions** before a raid — "I'm bringing 5k tier-3 + my hero in slot 1" — visible to teammates before the on-chain rally commits.
3. **See live game-state context** alongside the chat — the target castle's HP, current defenders, attack window, vesting timers.
4. **Read the historical outcome** — "rally executed, won, took 12% casualties" — as a system message in the same thread.

The war-table is *not* a replacement for gameplay state. Rallies, attacks, and castle conquest stay on-chain in the existing `novus_mundus` program. The war-table is the coordination overlay that lives between intent and commitment.

## Non-goals

- **Not** a generic chat product. Threads exist only as overlays on game entities (no free-form channels).
- **Not** a fix for `novus_forum`. That program is referenced as a design ancestor; we're not modifying or deploying it. The model is reused; the storage isn't.
- **Not** trying to hide *metadata*. Sender wallet + thread PDA + timing remain public. Privacy applies to message bodies. Metadata-anonymity is a v2+ conversation (sealed-sender).

## Decision summary

**Build it on the existing `novus_mundus` program. Emit messages as `sol_log_data` from a single new instruction. Encrypt bodies per-recipient with hybrid (ECDH wraps a per-message symmetric key) inline in the same log entry — the `novus_forum` 2022 model with N ciphertexts collapsed into one log instead of N accounts. Read via Triton's `getTransactionsForAddress`. Real-time via `logsSubscribe`. No new accounts, no new programs, no off-chain backend, no indexer, no shared keys to rotate.**

Cost: ~$0.00025 per message, paid by the sender's wallet. Zero infrastructure cost to us.

### Why encryption is in v1, not v2

It's a *war* table. The threat model is "the opposing team is reading the chain." Strategic coordination that's globally readable is not strategic coordination. Anything that goes through this surface — pledges, raid timing, target selection, trash-talk — must default to unreadable by non-members of the scope.

## Options considered (and why we rejected them)

| Option | Verdict |
|---|---|
| Fork `novus_forum` as-is (Anchor 0.26, per-recipient accounts) | Per-message-per-recipient account creation costs ~0.005 SOL/msg. Doesn't scale. |
| Postgres + WebSocket | User explicitly didn't want to operate a DB. |
| Redis Streams + Pub/Sub + SSE | Already have Redis (used by minigame sessions), but too centralised for the game's on-chain ethos. Censorship + single point of failure. |
| Solana Memo program + thread PDA | Works but no on-chain auth. Anyone can post to any thread; membership enforced only at render. Misses the `novus_forum` semantics. |
| State compression / Bubblegum cNFTs + DAS | Cheap (~$0.0001/msg) but 2–3 weeks of engineering, requires DAS indexer, and the cNFT-as-message data model is a hack. |
| Custom Merkle tree via SPL Account Compression | Same as above, more flexible, more engineering. |
| **`novus_mundus` instruction emitting `sol_log_data` + Triton read API** | ✅ Picked. One new instruction, zero new accounts, zero new infra. |

## Architecture

```
Player wallet
   │ signs fixed challenge (one-time per session)
   ▼
Session ed25519 keypair                      // also convertible to x25519 for ECDH
   │
   ├─ signs every message body
   └─ x25519 form used as the recipient pubkey when others encrypt to them
   ▼
Sender, for each message:
   1. fetch current scope membership (e.g. team.members[])
   2. fetch each member's session_pubkey (cached after first sighting)
   3. generate random per-message symmetric key K
   4. encrypt body with K (XChaCha20-Poly1305)
   5. wrap K once per recipient (sealed_box-style to each x25519 pubkey)
   6. sign the whole envelope with session_key
   ▼
novus_mundus::post_war_table_message
   │ verifies sender ∈ scope(thread_pda)
   │ emits sol_log_data(["wt1", thread, sender, envelope...])
   ▼
Solana tx log
   │
   ├──> getTransactionsForAddress(thread_pda) ──> envelopes
   │       ↓ recipient client side
   │       finds own wrap → decrypts K → decrypts body → verifies sig
   └──> logsSubscribe(thread_pda)              ──> real-time push (same decrypt path)
```

The **thread PDA** is *any existing game entity*. There are no new PDAs to create. Every team, rally, castle, encounter, and player already has a PDA on chain; that PDA becomes the addressable thread marker.

### Scopes

Each scope maps to a different entity PDA and a different access-control predicate. The post instruction dispatches on the target PDA type:

| Scope | Thread PDA | Who can post | Encryption |
|---|---|---|---|
| Team | `TeamAccount` PDA | Members in `team.members` | Per-recipient hybrid |
| Rally war-room | `RallyAccount` PDA | The rally creator + all joined participants | Per-recipient hybrid |
| Castle siege | `CastleAccount` PDA | Current garrison + attackers within siege window | Per-recipient hybrid (membership snapshot at post time) |
| Encounter | `EncounterAccount` PDA | Any player in the same kingdom (open-channel) | Plaintext (intel-sharing is the point) |
| Player DM | Recipient's `PlayerAccount` PDA | Anyone | Per-recipient (just two) |

Scope is parsed from the account discriminator on the thread account. Different access predicates live as separate helper functions in `processor/war_table/access.rs`.

## Data model (log schema)

Every `post_war_table_message` instruction emits one `sol_log_data` call. The message body is encrypted once with a random per-message symmetric key K; K is then wrapped per recipient. The envelope is signed by the sender's session key.

```
[
  b"wt1",                              // protocol discriminator (version 1)
  thread_pda.as_ref(),                 // 32 bytes — index redundancy
  sender_wallet.as_ref(),              // 32 bytes — author wallet (gate by chain auth)
  sender_session_pubkey.as_ref(),      // 32 bytes — ed25519, signs envelope
  ephemeral_x25519_pubkey.as_ref(),    // 32 bytes — per-message ephemeral, used to wrap K
  &nonce_24,                           // 24 bytes — XChaCha20-Poly1305 nonce for ciphertext
  &ciphertext,                         //    variable — body encrypted with K
  &recipients_blob,                    //    variable — see "Recipients blob" below
  &signature_64,                       // 64 bytes — sender_session_key.sign(everything above)
]
```

### Recipients blob

```
recipients_count: u16          // N members of the scope at post time
for i in 0..N:
  recipient_session_pubkey: [u8; 32]   // x25519 pubkey of recipient (their session key, curve-converted)
  wrapped_K:                   [u8; 48]   // XChaCha20-Poly1305(K) under ECDH(ephemeral × recipient)
                                          // = 32 bytes ciphertext (K is 32) + 16 byte Poly1305 tag
                                          // (nonce is derived from ephemeral_x25519_pubkey ‖ i, so omitted)
```

Linear scan on receive is fine — scopes are bounded by team size (≤ 50 in v1) and other-thread membership stays in single digits. Recipient pubkey lookup is `O(N)` per message; N is tiny.

### Body schema (inside the ciphertext)

Once decrypted, the plaintext follows the same binary layout the unencrypted v0 draft used:

| Offset | Field | Bytes | Notes |
|---|---|---|---|
| 0 | `version: u8` | 1 | `0x01` |
| 1 | `kind: u8` | 1 | 0=text, 1=pledge, 2=system, 3=reply, 4=tombstone, 5=attestation |
| 2 | `created_at: i64` | 8 | Unix seconds (client-stamped, verified ≤ slot time) |
| 10 | `parent_id?: [u8; 12]` | 12 | (slot, tx_index, log_index) of parent if reply; zeros otherwise |
| 22 | `payload: &[u8]` | variable | Kind-specific |

**Per-kind payloads:**

- `text(0)`: UTF-8 bytes
- `pledge(1)`: `[u64 tier1, u64 tier2, u64 tier3, u8 hero_slot, i64 ready_at]`
- `system(2)`: structured event reference (e.g., `RallyExecuted` slot+sig)
- `reply(3)`: same as text but `parent_id` set
- `tombstone(4)`: superseded message's id; UI hides the original
- `attestation(5)`: first-touch session key declaration, see [Encryption](#encryption)

**Message ID** (stable, not stored on chain): `(slot, tx_index_in_block, log_index_in_tx)`. Twelve bytes total, monotonically ordered, deterministic across re-reads.

### Wire-format size budget

The crypto overhead is fixed per-message regardless of body length:

| Component | Bytes |
|---|---|
| `wt1` + thread + sender_wallet + session + ephemeral | 32+32+32+32 + 3 = ~131 |
| nonce | 24 |
| signature | 64 |
| `recipients_count` + per-recipient (32 + 48) | 2 + 80·N |
| **Fixed at N=1** | ~301 bytes |
| **Fixed at N=10** | ~1021 bytes |

The Solana tx data limit is ~1232 bytes total. After accounts list and auth overhead, real budget for `sol_log_data` is ~900 bytes. **At ten recipients the envelope is already at the limit before any ciphertext.**

Two implications:

1. **Body budget shrinks with member count.** At N=5 (~ a small team) we have ~500 bytes of ciphertext = ~480 bytes of plaintext after Poly1305 tag. At N=20 (a large team) the envelope no longer fits — we need to split.
2. **Above ~12 recipients we send the envelope across multiple `sol_log_data` entries in the same tx** (one "header" + N "recipient pages"). This keeps the per-message cost bounded by tx fee, not by linear recipient blowup.

For Phase 1 (team chat, max 50 members) the splitting path is required. The decoder reassembles by `(thread, sender_session, ephemeral, slot, tx_index)`.

### Why binary instead of JSON

`sol_log_data` is base64-encoded; binary halves byte count, which matters because of the envelope overhead above.

## Auth model: session keys

Borrowed from `novus_forum`'s 2022 design and extended for the encryption layer. The wallet signs *once* per session; from there a derived keypair both signs every message body **and** serves as the recipient identity for incoming encrypted messages. No wallet popup during a raid.

The session keypair is ed25519 (Solana-native, used for signing). The same scalar is converted to x25519 (Curve25519) for ECDH — this is the standard `ed25519_pk_to_curve25519` / `ed25519_sk_to_curve25519` conversion that nacl/libsodium expose. One keypair, two views.

### One-time derivation (client)

```ts
async function deriveSessionKey(wallet: Wallet): Promise<SessionKey> {
  // Sign a fixed message — same input + same wallet = same session key, every time.
  const challenge = new TextEncoder().encode("novus-mundus war-table session v1");
  const sig = await wallet.signMessage(challenge);
  // Hash the signature into a 32-byte seed.
  const seed = sha256(sig);
  const signKp = nacl.sign.keyPair.fromSeed(seed);
  // Same secret, x25519 view — used for ECDH wrapping/unwrapping.
  const ecdhSk = ed25519SkToCurve25519(signKp.secretKey);
  const ecdhPk = ed25519PkToCurve25519(signKp.publicKey);
  return { signKp, ecdhSk, ecdhPk };
}
```

The session key never leaves the browser. Loss = re-derive from wallet sig, free.

### Per-message signing

The session ed25519 key signs the full envelope (everything but the signature itself). This binds the encrypted body, the recipient list, the ephemeral pubkey, and the nonce to a single authenticated unit.

```ts
function signEnvelope(session: SessionKey, envelopeWithoutSig: Uint8Array): Uint8Array {
  return nacl.sign.detached(envelopeWithoutSig, session.signKp.secretKey);
}
```

### Verification on read

```ts
function verifyEnvelope(msg: ParsedEnvelope): boolean {
  return nacl.sign.detached.verify(
    msg.envelopeWithoutSig,
    msg.signature,
    msg.senderSessionPubkey,
  );
}
```

That verifies the envelope came from whoever holds `senderSessionPubkey`. Tying that session pubkey to the claimed `senderWallet` is the job of the **attestation** layer below.

### Session attestation (v1, required)

Each session's *first* post to a thread is a `kind=attestation(5)` envelope whose plaintext body is a wallet-signed declaration:

```
attestation payload = {
  session_pubkey: [u8; 32],
  ecdh_pubkey:    [u8; 32],
  not_after:      i64,             // unix seconds, e.g. now + 24h
  scope_root:     [u8; 32],        // thread_pda OR all-zeros for "any thread"
  wallet_sig:     [u8; 64],        // wallet.signMessage over the bytes above
}
```

Readers cache attestations per `(wallet, session_pubkey)` and reject envelopes whose session pubkey lacks a current, valid attestation. This is what makes "session key impersonation" infeasible — an attacker would need a wallet popup signature from the victim, not just access to the victim's browser session.

`novus_forum` skipped this in 2022 because per-recipient encryption already bound posts to the session key. In our setting we keep the bind, and we add the attestation because session keys are persisted in IndexedDB rather than ephemeral.

### Distribution of session pubkeys (first-touch)

Encrypting to a recipient requires knowing their `ecdh_pubkey`. The simplest, scheme-with-no-schema-changes approach:

- The first time player A reads the thread, they see B's attestation log (kind=5) — that envelope is **broadcast-unencrypted to the thread's membership** (`recipients[]` lists every member's `ecdh_pubkey`, but the *attestation body* itself is not the secret being protected; it's the public key declaration). Strictly speaking the attestation can also be sent plaintext-in-log under a known constant key.
- A caches B's session pubkeys in IndexedDB.
- When A composes a message, the client iterates `team.members[]`, looks up the cached attestation for each, and includes them in `recipients[]`. Any member without a cached attestation is excluded — the client surfaces this as "X hasn't joined the war-table yet" in the compose box.

This means a brand-new member sees historical messages they weren't a recipient of as opaque — by design. They can only read traffic posted after their attestation is visible. Same property `novus_forum` had, same property modern E2E group chats have (Signal "missing key material" UX).

If we want forward-readable history for new joiners later, we'd add a per-thread re-encrypt-on-join helper (out of scope for v1).

## Encryption

### Construction (per message)

```
K  = random 32 bytes                                  // per-message symmetric key
ε  = nacl.box.keyPair()                               // per-message ephemeral x25519
nonce_body = random 24 bytes
ct_body = xchacha20poly1305(K, nonce_body, plaintext) // body, encrypted once

for each recipient r in scope_members:
  shared_r  = ECDH(ε.secret, r.ecdh_pubkey)           // 32 bytes
  wrap_key_r = HKDF(shared_r, info = ε.pub || r.pub)  // 32 bytes
  nonce_wrap_r = blake3(ε.pub || u16(index_r))[..24]  // deterministic per (msg, slot)
  wrapped_K_r = xchacha20poly1305(wrap_key_r, nonce_wrap_r, K)
```

Envelope-without-sig = all bytes from `wt1` through the recipients blob.
`signature = ed25519_sign(sender_session_signing_secret, envelope-without-sig)`.

Same scheme `novus_forum` used in 2022 (nacl.box per recipient), repackaged into a single log entry and with an ephemeral pubkey instead of reusing the sender's session pubkey. The ephemeral matters for forward secrecy: compromising the long-lived session key later doesn't unlock prior message keys, because each prior message's K was wrapped under an ECDH that mixes in `ε.secret`, which doesn't exist after the message was sent.

### Decryption (per recipient)

```
1. find my entry in recipients[]:  i such that recipient_session_pubkey[i] == my.ecdh_pubkey
2. shared    = ECDH(my.ecdh_secret, ephemeral_x25519_pubkey)
3. wrap_key  = HKDF(shared, info = ε.pub || my.pub)
4. nonce_wrap = blake3(ε.pub || u16(i))[..24]
5. K         = xchacha20poly1305_open(wrap_key, nonce_wrap, wrapped_K[i])
6. plaintext = xchacha20poly1305_open(K, nonce_body, ciphertext)
7. verify signature on envelope-without-sig
```

If you're not in `recipients[]`: you see the metadata (sender, slot, recipient count) but no plaintext. By design.

### Threat model

| Threat | Mitigation |
|---|---|
| Opposing team reads chain to learn rally plans | Bodies encrypted, only `recipients[]` decrypt |
| Compromise of session key reveals all prior chat | Per-message ephemeral → forward secrecy on body |
| Adversary forges a message as another player | Envelope signed by session key; session key bound to wallet via attestation |
| Adversary replaces wrapped K to substitute their own | Signature covers `recipients[]`; tamper invalidates sig |
| Adversary swaps sender identity | `sender_wallet` must match the on-chain transaction signer; program checks this |
| Adversary adds themselves to `recipients[]` after the fact | Logs are immutable; attempt fails |
| Two devices for same wallet — out-of-band sync | Both derive identical session keys from the same wallet sig + challenge; no sync needed |
| **Non-mitigations** | |
| Hiding *who* talked to *who* | Metadata is in the clear by definition of being on chain |
| Hiding *when* a thread is active | Same |
| Preventing a removed member from reading historical messages they were a recipient of | Out of scope — they already had K |

### Library choice

`@noble/ciphers` for XChaCha20-Poly1305 (audited, tree-shakeable), `@noble/curves/ed25519` for the curve conversion and ECDH. Both already in the React/Vite supply chain. No new heavy deps.

## Program changes

### New file

`programs/novus_mundus/src/processor/war_table/post.rs`

Single instruction `post_war_table_message`. Accepts:

- **Accounts**:
  - `thread` (the target PDA — rally / castle / encounter / team / player)
  - `sender` (signer, wallet)
  - `player` (sender's `PlayerAccount`, for kingdom-scope auth)
  - Optional gate accounts: `TeamAccount`, `RallyAccount`, `CastleAccount` depending on scope
- **Data**: the opaque envelope blob (the program does not parse the ciphertext)

Behavior:

1. Parse the `thread` account discriminator to detect scope.
2. Dispatch to the right access predicate (see `access.rs`).
3. Sanity-check the envelope shape: minimum length, `wt1` magic, thread bytes match the passed thread account. The program does *not* verify the body signature (that's a client job — chain space is too expensive to spend on it).
4. If allowed, emit `sol_log_data` with the envelope payload.
5. No state mutation. Tx cost is base fee + compute. No rent.

Note: the program is intentionally agnostic to the encryption — it cares only that the sender is in the scope. Crypto is end-to-end between clients.

### New file

`programs/novus_mundus/src/processor/war_table/access.rs`

Pure predicates:
- `is_team_member(team, sender)`
- `is_rally_participant(rally, sender)`
- `is_castle_combatant(castle, sender)`  // garrison or attacker
- `is_in_kingdom(encounter, player)`
- `is_dm_open(recipient, sender)`  // permissive for v1; UI filters spam

### Instruction index

Adds one new instruction at the next free discriminator. No state schema changes anywhere else in `novus_mundus`. Backwards-compatible. **No `share_war_table_key` or epoch rotation instruction** — keys live in envelopes, not on chain.

## Client SDK

`sdks/novus-mundus-ts/src/wartable.ts`

```ts
// Send (resolves recipients from scope membership, encrypts, signs, posts)
postMessage(thread: PublicKey, body: Uint8Array, opts?: {
  kind?: MessageKind;
  parent?: MessageId;
}): Promise<MessageId>;

// Read (decrypts what's addressed to us; renders opaque metadata for the rest)
readThread(thread: PublicKey, opts?: {
  limit?: number;
  before?: PaginationCursor;
}): Promise<{ messages: Message[]; cursor?: PaginationCursor }>;

// Real-time
subscribeThread(
  thread: PublicKey,
  onMessage: (m: Message) => void
): Unsubscribe;

// Session-key helpers
deriveSessionKey(wallet: Wallet): Promise<SessionKey>;     // cached in IndexedDB
postAttestation(thread: PublicKey): Promise<MessageId>;    // call once per scope
getMemberKeys(thread: PublicKey): Promise<MemberKeyMap>;   // attestation cache lookup

// Crypto helpers
encryptForScope(body: Uint8Array, members: MemberKeyMap): Promise<Envelope>;
decryptEnvelope(env: Envelope, session: SessionKey): Promise<Uint8Array | null>;
verifyEnvelope(env: Envelope): boolean;
parseScope(thread: PublicKey, accountFetcher: AccountFetcher): Promise<Scope>;
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
      filters: {
        programIds: [NOVUS_MUNDUS_PROGRAM_ID.toBase58()],
        excludeFailed: true,
      },
      paginationToken: before,
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    },
  ]);
  return {
    messages: res.result.transactions
      .flatMap(extractWarTableLogs)
      .filter(verifyMessage),
    cursor: res.result.paginationToken,
  };
}
```

One round-trip. ~150ms latency on a warm Triton RPC. Falls back to `getSignaturesForAddress` + batched `getTransaction` on vanilla RPC at ~1.5s latency.

### Real-time

```ts
function subscribeThread(thread, onMessage) {
  return connection.onLogs(
    thread,
    (logs) => {
      extractWarTableLogs(logs).forEach(onMessage);
    },
    "confirmed",
  );
}
```

### Caching

Client maintains an IndexedDB cache of `(thread_pda, last_seen_signature) → Message[]`. On open, read cache → render → fetch only newer signatures via `getTransactionsForAddress` with `paginationToken` of the last-seen tx. Cold loads only happen on first visit per browser.

## UI integration

The war-table is a **thread renderer** that lives inside existing detail panels:

- `RallyDetailPanel` → embed thread bound to `rally_pda`
- `EncounterDetailPanel` → embed thread bound to `encounter_pda`
- `PvpDetailPanel` → embed thread bound to defender's `player_pda`
- Castle detail (TBD) → embed thread bound to `castle_pda`
- Team page → embed thread bound to `team_pda`

The thread component:
1. Reads `useWarTable(thread_pda)` — hook that combines `readThread` + `subscribeThread` with IndexedDB caching.
2. Renders chronological mix of user messages + system messages (decoded from the same tx history).
3. Surfaces a compose box (text or pledge picker) at the bottom.
4. Render-filters by membership predicate (defense in depth — auth is already enforced on chain).

## Phases

### Phase 1 — Team chat (v1)

- One scope only: team-scoped threads, thread PDA = `TeamAccount` PDA
- Text messages only (`kind=0`) + attestations (`kind=5`); no replies, no pledges yet
- **Full encryption layer in v1.** Per-recipient hybrid envelope, session keys, attestations.
- Add `post_war_table_message` instruction to `novus_mundus`
- Client SDK with `deriveSessionKey`, `postAttestation`, `postMessage`, `readThread`, `subscribeThread`
- Embed in the team page

**Ships in ~1.5 weeks. Smallest possible thing that proves the architecture *and* keeps the bodies private.**

### Phase 2 — Rally war-room

- Add rally scope (access predicate, scope detection)
- Add `pledge` kind to body schema
- Pledges appear as a sidebar widget in the rally thread, summed and rendered live
- Pledges are *non-binding hints* — the rally's actual `join` ix is still the only commitment

### Phase 3 — Castle siege + encounter coordination

- Add castle scope (garrison + attacker access)
- Add encounter scope (open kingdom). For encounters specifically, evaluate whether to send plaintext bodies (kingdom-wide intel-share is the point) vs encrypt-to-kingdom (re-broadcast to N members of a kingdom is expensive). Likely answer: encounter scope uses a public-channel mode (no `recipients[]`, body is unencrypted); program differentiates by scope flag.
- Surface system messages from existing on-chain events (`RallyExecuted`, `CastleConquered`, `EncounterDefeated`) by indexing the same tx history client-side and merging into the timeline

### Phase 4 — DM + polish

- Player-to-player DMs (open by default, render-filtered) — encryption trivially extends (recipient list = [you, them])
- Reply chains (`kind=3`, `parent_id` set)
- Tombstones (`kind=4`) for soft-delete in UI
- Multi-page envelope assembly for scopes >12 members

### Phase 5 — Optional, far future

- If permanence / archival becomes a real requirement: write a one-way exporter that snapshots a thread's tx history into a Bubblegum-compressed tree as a "frozen archive." Same data, different storage. The live system stays as-is.
- Sealed-sender / metadata privacy if the threat model ever shifts.

## Open questions

1. **Pagination cursor format.** Triton's `paginationToken` is opaque — confirm it's stable across reconnects and use it directly. Otherwise fall back to `(slot, signature)` pair.

2. **Body size budget vs. member count.** With encryption, each recipient adds ~80 bytes to the envelope. At N=5 the body budget is ~480 plaintext bytes; at N=12 it's near zero. Phase 1 (teams up to 50) **requires** the multi-page envelope path described in "Wire-format size budget." Spec out the page header format and decoder state machine before starting Phase 1.

3. **Rate limiting.** Should we enforce a cooldown in `post_war_table_message` (e.g., reject if sender posted within last 2s to the same thread)? Cheaper alternative: client-side throttle + chain cost of spam as natural deterrent. Lean toward no on-chain rate limit in v1.

4. **System message extraction.** Two options for surfacing on-chain events in the timeline:
   - (a) Client-side: walk the same tx history, detect known event signatures, render as system messages. Zero new code.
   - (b) Server-side relay: a one-off indexer that watches and posts a synthetic `kind=2` message. More work, but cleaner timeline ordering.
   v1: do (a).

5. **Encounter scope spam.** Encounters are open-kingdom — anyone can post. That's by design (intel sharing), but worst-case a griefer spams an encounter thread. Counter: render-side rate limit per sender. If it becomes a real problem, add a `kingdom_membership` check (already implicit in `player.kingdom == encounter.kingdom`).

6. **Session key persistence.** Cached in IndexedDB per-origin. On a new device, user re-derives — same input (wallet + challenge string) yields same key. No sync needed.

7. **Wallet compatibility.** Both Phantom and Backpack support `signMessage`. Hardware wallets vary — some don't. For hardware-only users, fall back to "wallet signs every message" mode with a clear UX (popup per send). For encryption: those users still need an ECDH keypair; derive deterministically from a one-time wallet signature, accept the friction of a single popup at session start.

8. **Attestation refresh cadence.** `not_after` defaults to 24h. Re-posting an attestation costs one tx every 24h per session per scope. Acceptable if active; effectively zero for idle users. Consider longer (7d) if the wallet UX cost is the bigger pain point.

9. **Member removed mid-thread.** When a player leaves a team, future messages won't include them in `recipients[]`. They retain whatever K's they already decrypted — same property every group chat has. If we want forward-secrecy-on-removal, add a re-key-on-membership-change protocol (out of scope v1).

## Migration notes

If the project ever decides to leave Triton or migrate to a self-hosted indexer:

- The on-chain side is unchanged — messages stay in tx logs.
- Read path switches to vanilla `getSignaturesForAddress` + batched `getTransaction`. Same data, slower.
- Or stand up a custom indexer (Geyser plugin or `logsSubscribe` + Postgres) that watches `novus_mundus` and materialises threads. Same data, faster reads, our infrastructure to operate.
- The migration is read-side only. No on-chain state changes, no client-side schema change. Drop-in.

If the project ever wants permanent archival of threads:

- Run a one-off batch job that reads all messages for a thread and writes them as leaves into a Bubblegum tree.
- After archival, the thread is frozen and visible via DAS. Live system continues unaffected.
- This is opt-in, per-thread, and far-future.

## References

- `sdks/novus_forum/` — the 2022 ancestor design. Same domain model (forum/header/message), same per-recipient `nacl.box` encryption, same session-keypair derivation trick. Storage layer is what we're replacing.
- `programs/novus_mundus/src/processor/rally/execute.rs` — the on-chain commitment surface that pledges compile into.
- Triton `getTransactionsForAddress` — https://docs.triton.one/chains/solana/gettransactionsforaddress
- `@noble/ciphers` (XChaCha20-Poly1305), `@noble/curves/ed25519` (curve conversion + ECDH).
- SPL Memo program (not used, considered): `MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr`
- SPL Account Compression (not used, considered): https://docs.solana.com/developing/runtime-facilities/spl-account-compression

## What we explicitly are not doing

- Not running Redis for chat.
- Not running Postgres for chat.
- Not running a DAS indexer.
- Not minting cNFTs for messages.
- Not creating a separate `novus_forum` v2 program.
- Not storing shared epoch keys on chain. Not rotating shared keys. Not adding a `share_war_table_key` ix.
- Not hiding metadata (sender, recipient count, timing). That's a different threat model.
- Not adding new account types to `novus_mundus`.

The smallest viable surface that does the job, no more.
