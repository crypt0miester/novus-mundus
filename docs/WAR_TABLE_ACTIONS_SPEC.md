# War Table Message Actions: Build Spec

Consolidated build spec for the war-table message actions: Reply (D1), Delete/Tombstone (D2), Copy (D3), Reactions (D4), Pin (D5), derived System lines (D6), and the per-bubble actions menu delivery (D7).

This is a SDK + web change only. The chain instruction `post_war_table_message` is KIND-AGNOSTIC (opaque body bytes), so there is NO program change and NO redeploy. Reactions and pins are new `WtKind` values whose effect is computed entirely off-chain by the read-model fold.

All conventions are binding: no em-dash characters in UI strings or comments; no typed `->`/arrows (lucide icons only); line comments `//` only (JSDoc `/** */` allowed), no `/* */` blocks, no divider rule lines; bun only; no git worktrees; no `??`/`||` shims for required state; no commit.

## 0. Verified ground truth (from code, load-bearing)

- `WtKind` lives in `sdks/novus-mundus-ts/src/crypto/wartable.ts` (Text=0, Pledge=1, System=2, Reply=3, Tombstone=4). The inner body is `version:u8 | kind:u8 | created_at:i64 | parent_id:[u8;12] | payload`. `encodeBody`/`decodeBody` are kind-agnostic: a new kind needs no byte-layout change.
- `readThread` (`src/wartable.ts:268`) keeps EVERY decoded wt1 message in `byId`, including tombstones, and only folds the tombstone *effect* onto the parent. So kind=5/6 messages also survive into the returned `ReadMessage[]` and reach the web store unchanged. No SDK fold is needed for reactions/pins.
- `subscribeThread` (`src/wartable.ts:310`) emits one `ReadMessage` per live blob, one at a time. Therefore the reaction/pin fold MUST live in the web store (it cannot be a per-read-batch SDK fold), exactly mirroring why the tombstone fold is duplicated in the store today (`apps/web/src/lib/store/war-table.ts:107`).
- `useWarTable.post` (`apps/web/src/lib/hooks/useWarTable.ts:216`) is kind-agnostic and already builds an optimistic echo keyed on `kind` + `parentId` + `body`. `matchesPending` (`store war-table.ts:94`) reconciles on `senderWallet` + `kind` + `parentId` + `body`. This is correct for reactions (kind=5, parentId=target, body=emoji) and pins (kind=6, parentId=target, body="") with no change to `matchesPending`.
- The web store has NO wallet identity. `mine` must NOT be computed in the store. It is computed in the renderer / hook against `connectedWallet`.
- The thread PDA IS the entity PDA for team/rally/castle/encounter (DM is a synthetic pair PDA). `readThread` runs `getSignaturesForAddress(entityPda)`, so the SAME txs it fetches already carry the Anchor event blobs for that entity. `parseEventsFromLogs(logs)` (SDK index export) parses them. wt1 blobs (magic `0x77 0x74 0x31`) and Anchor event blobs (8-byte discriminator) are mutually exclusive on the same `Program data:` lines, so one pass classifies each. This is the zero-extra-RPC path for D6.
- `WarTableScope` is the web alias for `WtScope` (`src/index.ts:89`). `ThreadRenderer` already routes `WtKind.System` to a centered pill (`ThreadRenderer.tsx:286`) reading `msg.body`, so System items need no new render branch.
- `PlayerActionsMenu` (`apps/web/src/components/war-table/PlayerActionsMenu.tsx`) is the menu pattern to mirror: desktop absolute `role="menu"` panel `lg:block`, mobile `BottomSheet`, outside-mousedown + Escape close, `wasOpen` focus guard (load-bearing: many menus per thread, a closed menu must not steal focus and fight auto-scroll).

## 1. Reaction (kind=5) and Pin (kind=6) body usage + WtKind additions

### WtKind enum (SDK stage owns this edit)

In `sdks/novus-mundus-ts/src/crypto/wartable.ts`:

```ts
export enum WtKind {
  Text = 0,
  Pledge = 1,
  System = 2,
  Reply = 3,
  Tombstone = 4,
  Reaction = 5,
  Pin = 6,
}
```

No envelope or body byte-layout change. Reaction emoji and pin target ride the existing `payload`/`parentId` fields.

### Reaction (kind=5) body usage

A reaction message:
- `kind = WtKind.Reaction`
- `parentId = <12-byte id of the target message being reacted to>`
- `payload = UTF-8 of the emoji` (one of the curated 6, see section 6)

Un-react = a Tombstone (kind=4) whose `parentId` is the id of MY OWN reaction message (NOT the reacted-to message). The store tombstone fold is extended to mark reaction records tombstoned.

### Pin (kind=6) body usage

A pin message:
- `kind = WtKind.Pin`
- `parentId = <12-byte id of the message to pin>`, or `WT_ID_ZERO` to UNPIN
- `payload = empty`

The CURRENT pin = the highest-id (latest) non-tombstoned kind=6 message. If that message's `parentId` is all-zero, there is no pin. Unpinning is a zero-parent Pin; no tombstone is required to unpin.

## 2. readThread + store FOLD algorithms and new fields

### SDK side: `ReadMessage` is UNCHANGED

`readThread` returns kind=5/6 messages verbatim (they land in `byId`). No new `ReadMessage` field. The web store derives reactions/pins from these raw messages. The only SDK addition for the action plumbing is the `hexToId` helper (section 3).

System items returned by the new `readThreadWithSystem` (section 4) are `ReadMessage`-shaped with `kind = WtKind.System`; no new field there either.

### Web store new fields

`WtMessage` (`apps/web/src/lib/store/war-table.ts:24`) gains:

```ts
// Folded reaction summary: one entry per distinct emoji, in first-seen order.
// Recomputed by the store fold whenever a reaction record for this message
// changes. mine is NOT set by the store (the store is wallet-agnostic); the
// renderer marks mine against the connected wallet.
reactions?: { emoji: string; count: number; reactorWallets: string[] }[];
```

Note the divergence from Discovery B: the store stores `reactorWallets` per emoji (not `mine`/`myReactionIds`), because the store has no wallet. The renderer/hook derives `mine` and the un-react target id from `reactorWallets` + a per-(parent,emoji) reactor-to-reaction-id map (below).

`ThreadEntry` (`store war-table.ts:61`) gains:

```ts
// Current pin target hex (the pinned message id), or ZERO_ID for none.
pinnedId: string;
// Highest kind=6 reaction-message id seen, used to resolve the current pin.
// Stored so out-of-order pin arrivals resolve to the latest by id.
maxPinId: string;
// Raw reaction records grouped by the parent (reacted-to) message hex id.
// id = the reaction message id; sender = reactor wallet; tombstoned via the
// extended tombstone fold (un-react). This is the source the reactions[]
// summary on each parent WtMessage is recomputed from.
reactionRecords: Map<string, Array<{ id: string; emoji: string; sender: string; tombstoned: boolean }>>;
```

`emptyThread()` initializes `pinnedId: ZERO_ID`, `maxPinId: ZERO_ID`, `reactionRecords: new Map()`.

### Reaction fold algorithm (store `ingest`, before the sorted insert)

Branch by kind BEFORE the existing tombstone/insert logic:

1. `kind === WtKind.Reaction`:
   - Do NOT `insertSorted` into `messages` (reactions are folded onto their parent, never bubbles).
   - Push `{ id: msg.id, emoji: msg.body, sender: msg.senderWallet, tombstoned: false }` into `reactionRecords.get(msg.parentId)` (create the array if absent). `msg.body` is the decoded emoji (payload UTF-8 via `toStoreMessage`).
   - Recompute the target parent's `reactions[]`: filter the parent's records to `!tombstoned`, group by `emoji` in first-seen order, set `count = group.length`, `reactorWallets = [sender...]`. If the parent message is present in `messages`, write the updated copy back (`messages = messages.slice(); messages[idx] = { ...parent, reactions }`). If the parent has not arrived yet, the records are retained keyed by `parentId` and the summary is computed when the parent later lands (out-of-order, same template as `pendingTombstones`).

2. `kind === WtKind.Pin`:
   - Do NOT `insertSorted` into `messages`.
   - If `msg.id > maxPinId` (hex string compare, same order as `insertSorted`): set `maxPinId = msg.id` and set `pinnedId = msg.parentId` (which is `ZERO_ID` for an unpin). Lower-id pins are ignored. Tombstoning a pin is possible but not required for unpin; if a kind=4 tombstones the current pin message, treat `pinnedId` as `ZERO_ID` (extend the tombstone fold to clear `pinnedId` when the tombstone parent equals `maxPinId`).

3. `kind === WtKind.Tombstone` (EXTENDED): the existing branch folds a tombstone onto a parent message in `messages`. Extend it so that when the tombstone's `parentId` is NOT found in `messages`, it ALSO checks `reactionRecords`: for each parent-key array, if a record's `id === msg.parentId`, mark that record `tombstoned = true` and recompute that parent's `reactions[]` (un-react). The tombstone is still not inserted as a bubble. Keep the `pendingTombstones` retention for the message case.

### Pin resolution rule

Current pin = latest (highest id) non-tombstoned kind=6. `pinnedId` on the entry holds the resolved target hex (or `ZERO_ID`). A zero-parent pin yields no pin. This is O(1) per ingest via `maxPinId`.

### Seed/reconcile paths

`setThreadMessages` and `mergeThreadMessages` (and `addPendingMessage`, section 3) MUST route kind=5/6 through the same branch as `ingest`, not blindly `insertSorted`. Concretely: rewrite `setThreadMessages` to fold each incoming message through `ingest` (like `mergeThreadMessages` already does) rather than a plain sort, so reaction/pin folding and pin resolution apply to the initial read seed too. The existing pending-tombstone fold over the fresh list is preserved by `ingest`.

### buildRenderItems guard

In `ThreadRenderer.buildRenderItems` add at the top of the loop, defensively (the store already keeps them out of `messages`, but this protects the optimistic-pending window):

```ts
if (msg.kind === WtKind.Reaction || msg.kind === WtKind.Pin) continue;
```

## 3. useWarTable post helpers + optimistic behavior

`post` stays the single kind-agnostic sender. Add thin typed wrappers to `useWarTable` so callers do not hand-build `PostMessageBody`, and add `pinnedId` to the result. Import `hexToId` from the SDK.

### SDK helper to add (SDK stage owns this edit)

`hexToId` in `sdks/novus-mundus-ts/src/crypto/wartable.ts`, exported and re-exported from `src/wartable.ts` and the SDK index, mirroring the private `idHex`:

```ts
// Convert a fixed-width 24-char hex message id back to its 12 raw bytes. The
// inverse of the web idHex; required because reply/delete/react/pin targets
// originate as store hex ids but post needs the 12-byte parentId.
export function hexToId(hex: string): Uint8Array {
  const out = new Uint8Array(WT_ID_LEN);
  for (let i = 0; i < WT_ID_LEN; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}
```

### Hook helpers (StoreHook stage owns this edit)

Add to `UseWarTableResult` and `useWarTable`:

```ts
pinnedId: string; // current pin target hex (ZERO_ID = none), selected from the store entry
replyTo: (parentId: string, text: string) => Promise<string>;
deleteMessage: (id: string) => Promise<string>;
react: (parentId: string, emoji: string) => Promise<string>;
unreact: (myReactionId: string) => Promise<string>;
pin: (id: string) => Promise<string>;
unpin: () => Promise<string>;
```

Implementations (all forward to `post`; `hexToId` from the SDK turns a store hex id into the 12-byte parentId):

- `replyTo(parentId, text)` -> `post({ kind: WtKind.Reply, payload: text, parentId: hexToId(parentId) })`. Optimistic echo shows the reply text immediately (existing path).
- `deleteMessage(id)` -> `post({ kind: WtKind.Tombstone, payload: "", parentId: hexToId(id) })`. Optimistic: the echo is a kind=4 with empty body; `ingest` folds it onto the parent on arrival, hiding it. The optimistic echo of the tombstone itself should fold the parent immediately (route the pending kind=4 through `ingest` too, see below).
- `react(parentId, emoji)` -> `post({ kind: WtKind.Reaction, payload: emoji, parentId: hexToId(parentId) })`. Optimistic: the pending kind=5 must reach the store reaction fold so the chip appears instantly (see `addPendingMessage` change). Reconciled by (sender, kind, parentId, body=emoji) via `matchesPending`.
- `unreact(myReactionId)` -> `post({ kind: WtKind.Tombstone, payload: "", parentId: hexToId(myReactionId) })`. The target is MY reaction message id (resolved by the renderer from `reactionRecords`/`reactorWallets`). The tombstone fold marks the reaction record tombstoned and recomputes the chip.
- `pin(id)` -> `post({ kind: WtKind.Pin, payload: "", parentId: hexToId(id) })`.
- `unpin()` -> `post({ kind: WtKind.Pin, payload: "", parentId: WT_ID_ZERO })` (zero parent).

`pinnedId` selector: `useWarTableStore((s) => s.threads.get(threadPda.toBase58())?.pinnedId ?? ZERO_ID)`. (`?? ZERO_ID` here is a not-loaded default for an absent thread entry, not a required-state shim.)

### addPendingMessage change (StoreHook stage)

`addPendingMessage` currently always `insertSorted`s the echo into `messages`. It MUST branch like `ingest` for kind=5/6 (route reactions into `reactionRecords` + recompute; route pins into `maxPinId`/`pinnedId`) and for kind=4 (fold onto the parent) so optimistic reactions/pins/deletes render immediately rather than appearing as stray bubbles. Factor the kind-branch out of `ingest` into a shared helper both `ingest` and `addPendingMessage` call, or have `addPendingMessage` call `ingest` with `{ ...msg, pending: true }` (preferred: `ingest` already handles the pending flag and the sorted insert for non-5/6 kinds).

## 4. System-message merge plan (D6, no-extra-RPC path)

Resolution: implement the SDK-side path from Discovery A (`readThreadWithSystem`). Discovery B proposed deferring; we DO NOT defer, because the no-extra-RPC path is verified and cheap. System lines are read-model only and never posted by the client.

### New SDK method (SDK stage owns this edit)

```ts
async readThreadWithSystem(
  thread: PublicKey,
  scope: WtScope,
  opts?: { limit?: number },
): Promise<ReadMessage[]>
```

Internals, identical signature sweep to `readThread` but with ONE shared `logIndex` per tx across BOTH wt1 and event blobs:

1. `getSignaturesForAddress(thread, { limit })`, then `getTransaction` per signature (same as `readThread`).
2. Per tx, iterate the raw `Program data:` lines ONCE with a single `logIndex` counter that increments for EVERY `Program data:` blob regardless of type. This is load-bearing: a wt1 blob and an event blob in the same tx must not both start at `logIndex = 0`, or their 12-byte ids collide. Use `readProgramData(tx.meta.logMessages)` to get the ordered blob list, then for each blob at position `logIndex`:
   - If `isWt1(blob)`: existing `decodeAndDecrypt(blob, slot, logIndex)` path; set into `byId`; collect tombstone parents.
   - Else: `parseNovusMundusEvent(blob)` (per-blob, not `parseEventsFromLogs`, so the shared `logIndex` stays aligned with the blob position). If it parses AND `systemLabelFor(scope, thread, event)` returns a non-null label, push a synthetic System `ReadMessage`:
     - `id = encodeMessageId({ slot, txIndex: 0, logIndex })`
     - `kind = WtKind.System`
     - `createdAt = BigInt(event.data.timestamp)` (BN -> bigint; the i64 unix-seconds every event carries)
     - `senderWallet = thread` (placeholder; the System pill never shows a sender)
     - `threadPda = thread`, `keyVersion = 0`, `parentId = WT_ID_ZERO`
     - `payload = new TextEncoder().encode(label)`, `decrypted = true`, `txIndexResolved = false`
3. Apply the existing tombstone fold over the wt1 messages only. Then the existing `compareId` sort over the merged array. System items interleave by slot via the shared id ordering, for free.
4. Dedup by 12-byte id in `byId` is automatic; a given event tx yields a stable id, so the 25s reconcile re-read dedups cleanly.

### `systemLabelFor(scope, thread, event): string | null` (pure, SDK stage)

Returns null when the event is unrelated to this thread or has no label. Association is by the entity-pubkey field in the event payload matching `thread`:

- `scope === WtScope.Team`, keep `event.data.team === thread.toBase58()` (or PublicKey equals):
  - `TeamJoined` -> `"<player> joined the team"`
  - `MemberKicked` -> `"<kicked> was removed"`
  - `TeamLeft` -> `"<player> left the team"`
  - `LeadershipTransferred` -> `"Leadership passed to <newLeader>"`
  - `MotdUpdated` -> `"Message of the day updated"`
  - `TeamDisbanded` -> `"Team disbanded"`
- `scope === WtScope.Rally`, keep `event.data.rally === thread`:
  - `RallyCreated` -> `"Rally created"`
  - `RallyJoined` -> `"<player> joined the rally"`
  - `RallyExecuted` -> `"Rally struck the target"`
  - `RallyCancelled` -> `"Rally cancelled"`
  - `RallyClosed` -> `"Rally closed"`
- `scope === WtScope.Castle`, keep `event.data.castle === thread`:
  - `CastleConquered` -> `"Castle conquered by <newKingName>"`
  - `CastleDefended` -> `"Castle held"`
  - `CastleClaimed` -> `"<kingName> claimed the castle"`
  - `GarrisonJoined` -> `"<contributorName> reinforced the garrison"`
  - `GarrisonLeft` -> `"<contributorName> left the garrison"`
  - `CastleAttacked` -> `"Under attack by <attackerName>"`
  - `KingForceRemoved` -> `"<removedKingName> was forced out"`
- `scope === WtScope.Encounter`, keep `event.data.encounter === thread`:
  - `EncounterDefeated` -> `"Encounter defeated by <killingBlowName>"`
  - `EncounterAttacked` -> `"<playerName> struck the encounter"`
- `scope === WtScope.Dm`: always null (no game entity behind the pair PDA).

Names in events are fixed-width `readName48`/`readName32` already decoded by the parser; use them directly, no extra account lookups. Pubkey fields are `PublicKey`/base58 from the parser; compare via base58 string or `.equals`. BN fields (`timestamp`, counts) need `.toNumber()`/`.toString()`. All labels are plain prose, no em-dash, no typed arrows. The arrows shown above are spec shorthand, not literal output.

### Hook + renderer integration

- `useWarTable` calls `readThreadWithSystem(thread, scope)` instead of `readThread` for the initial seed AND the 25s reconcile re-read. `scope` is already in hand. System items flow through the existing `toStoreMessage` (kind=2, non-empty body). The store keeps them in `messages` (System is not folded out). `buildRenderItems` already renders them as centered pills. No ThreadRenderer System-branch change.
- `subscribeThread` is unchanged (live chat only). New live system lines appear on the next 25s reconcile re-read; events are low frequency so this latency is acceptable. Do NOT wire events into `subscribeThread` in this pass.

## 5. UI changes: MessageActionsMenu + MessageBubble + ThreadRenderer

### MessageActionsMenu (new file, UI stage)

`apps/web/src/components/war-table/MessageActionsMenu.tsx`, mirroring `PlayerActionsMenu` (desktop absolute panel `lg:block`, mobile `BottomSheet` titled "Message actions", outside-mousedown + Escape close, `wasOpen` focus guard).

Controlled-open (so the bubble can open it via long-press AND a desktop hover button):

```ts
interface MessageActionsMenuProps {
  msg: WtMessage;
  mine: boolean;
  canPin: boolean;          // officer-or-own for team, own otherwise (computed upstream)
  pinnedId: string;         // current thread pin hex; flips Pin/Unpin and avoids re-pin
  myReactionIds: Record<string, string>; // emoji -> my reaction message hex, for un-react
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onReact: (emoji: string) => void;   // post kind=5 parentId=msg.id
  onReply: () => void;                // set replyTo upstream
  onPin: () => void;                  // post kind=6 parentId=msg.id
  onUnpin: () => void;                // post kind=6 parentId=ZERO
  onDelete: () => void;               // post kind=4 parentId=msg.id
  children: ReactNode;                // desktop trigger affordance
}
```

Local `view: "menu" | "react"` state. Context-gated `MenuItemSpec[]` (build conditionally), all gated behind `!locked && !tombstoned` except where noted:

- React (always when actionable) icon `SmilePlus`. The item sets `view = "react"` (does NOT close+run); the picker (section 6) renders in place of the item list in both the desktop panel and the BottomSheet.
- Reply (when actionable) icon `Reply`. `run: onReply` then close.
- Copy (when actionable) icon `Copy`. `run: () => navigator.clipboard.writeText(msg.body)` then close. Client only.
- Pin / Unpin (when `canPin`): if `pinnedId === msg.id` show Unpin (`PinOff`, `onUnpin`); else Pin (`Pin`, `onPin`). Then close.
- Delete (when `mine && !tombstoned`) icon `Trash2`. `run: onDelete` then close. Render a second muted subtitle span in the item: "Removes it for others; the encrypted copy stays on-chain."

Keep the `wasOpen` focus guard verbatim (many instances per thread). lucide icons only, no typed arrows, line comments only.

### MessageBubble changes (UI stage)

Edit `apps/web/src/components/war-table/MessageBubble.tsx`:

- Gate the whole actions affordance behind `!showPlaceholder` (no menu on locked/tombstoned bubbles). The player menu on the avatar/name stays as-is; message actions are a SEPARATE bubble-anchored affordance.
- Wrap the bubble `<div>` (line 158) in a `relative` container. Mount `MessageActionsMenu` controlled by a local `open` state; pass the desktop hover button as `children`.
- Desktop hover trigger: a small `<button>` (`MoreHorizontal` icon) positioned `absolute` just outside the bubble inner edge (`mine ? "-left-7" : "-right-7"`, `top-1/2 -translate-y-1/2`), `hidden lg:flex opacity-0 group-hover/bubble:opacity-100`. Add `group/bubble` to the bubble row wrapper. Absolute positioning guarantees zero layout shift (no iOS reflow, no grouping/cornerClass impact, which key only off `groupPos`).
- Mobile long-press: `onPointerDown` starts a ~450ms timer ref; `onPointerUp`/`onPointerCancel` clear it; `onPointerMove` beyond ~10px clears it (so scrolling never opens the menu). On fire, `setOpen(true)` (the BottomSheet path keys off the same `open`).
- Reaction quote/reply strip (lines 166-178): make the reply quote a `<button>` calling a new `onJumpTo(parentId)` prop so tapping the quote scrolls to the parent.
- Render `ReactionRow` (section 6) below the bubble `<div>`, before/independent of the last-of-group timestamp row, aligned `mine ? justify-end : justify-start` inside the bubble column (under the bubble, not the avatar). Derive `mine`/`myReactionIds` here from `msg.reactions[].reactorWallets` vs `connectedWallet` (passed down), since the store does not set `mine`.

New MessageBubble props: `onReact`, `onReply`, `onPin`, `onUnpin`, `onDelete`, `onJumpTo`, `canPin`, `pinnedId`, `connectedWallet`.

### ThreadRenderer changes (UI stage)

Edit `apps/web/src/components/war-table/ThreadRenderer.tsx`:

- `buildRenderItems`: add the kind=5/6 skip guard (section 2).
- Pull `pinnedId`, `replyTo`/`deleteMessage`/`react`/`unreact`/`pin`/`unpin` from `useWarTable`.
- Reply state: `const [replyTo, setReplyTo] = useState<WtMessage | null>(null)`. Pass `onReply={(m) => setReplyTo(m)}` down. Render a chip above the composer: "Replying to <DomainName sender> : <snippet>" with a cancel X button. `handleSend`: when `replyTo` is set, call `replyTo(replyTo.id, text)` (the hook helper) and clear on success; else the existing text post.
- Scroll-to-parent: implement `onJumpTo(parentHex)` using `document.querySelector('[data-msg-id="..."]')` (or a ref map), `scrollIntoView({ block: "center" })`, plus a short-lived `highlightId` state cleared after ~1.2s. Add `data-msg-id={item.msg.id}` and a conditional `ring-2 ring-accent` to the per-message wrapper at line 303.
- Pin banner: above the scroll region, resolve `byId.get(pinnedId)` (the existing `byId` map at line 198). When present and not tombstoned, render a slim banner (`flex items-center gap-2 rounded-lg border border-border-default bg-surface-overlay px-3 py-1.5 text-xs`): `Pin` icon + truncated snippet + a jump button (reuse `onJumpTo`) + an unpin button gated by `canPin`.
- `canPin`: add an optional prop `canPin?: (msg: WtMessage) => boolean` to `ThreadRendererProps`, default `(msg) => msg.senderWallet === connectedWallet`. The team-chat embed passes an officer-aware predicate (D5: officers-or-own for team, own otherwise). This keeps ThreadRenderer scope-agnostic.
- Pass `connectedWallet` down to MessageBubble for `mine`/reaction-mine derivation.

Existing embeds (team/rally/encounter/DM) and `ThreadRendererProps` stay working; the only new prop is the optional `canPin`.

## 6. Emoji set

Six curated unicode emoji (D4):

| key | emoji | name |
| --- | --- | --- |
| thumbsup | U+1F44D | thumbs up |
| heart | U+2764 U+FE0F | red heart |
| fire | U+1F525 | fire |
| joy | U+1F602 | face with tears of joy |
| open_mouth | U+1F62E | face with open mouth |
| cry | U+1F622 | crying face |

The picker is one row of 6 emoji `<button>`s (`text-xl`, `hover:bg-surface-overlay`, `rounded`) rendered as the `view === "react"` body inside both the desktop panel and the BottomSheet; tapping one calls `onReact(emoji)` then closes. The `ReactionRow` under a bubble maps `msg.reactions` to chips `[emoji count]` (`rounded-full border px-2 py-0.5 text-xs`); mine-highlighted = `border-accent bg-accent/15 text-accent`, else `border-border-default bg-surface text-text-secondary`; pending at reduced opacity; tapping toggles (mine -> `unreact(myReactionIds[emoji])`, else -> `onReact(emoji)`).

## 7. FILE-OWNERSHIP MAP

Each file is assigned to exactly ONE sequential stage. Stages run in order: SDK, then StoreHook, then UI. No file is edited by two stages, so sequential stages never collide.

### Stage 1: SDK (`sdks/novus-mundus-ts`)

- `src/crypto/wartable.ts` — add `WtKind.Reaction = 5`, `WtKind.Pin = 6`; add and export `hexToId`.
- `src/wartable.ts` — re-export `hexToId`; add `readThreadWithSystem(thread, scope, opts)`; add the pure `systemLabelFor(scope, thread, event)` (here or in a new `src/wartable-system.ts`, but if new it belongs to the SDK stage). `ReadMessage` unchanged.
- `src/index.ts` — export `hexToId` (and `systemLabelFor` if exported). Only if not already surfaced.
- `tests/unit/wartable-crypto.test.ts` — kind 5/6 encode/decode round-trip, `hexToId` round-trip vs `idHex`.
- `tests/e2e/30-wartable.test.ts` — reaction post + fold, pin/unpin resolution, un-react via tombstone of the reaction id, and a System line synthesized from an entity event via `readThreadWithSystem`.

### Stage 2: StoreHook (web store + hook)

- `apps/web/src/lib/store/war-table.ts` — `WtMessage.reactions`; `ThreadEntry.pinnedId`/`maxPinId`/`reactionRecords`; `emptyThread` init; reaction/pin/extended-tombstone branches in `ingest`; route kind=5/6/4 through `ingest` in `setThreadMessages`/`mergeThreadMessages`/`addPendingMessage`; a `pinnedId` accessor/selector path.
- `apps/web/src/lib/hooks/useWarTable.ts` — import `hexToId`; add `pinnedId` to `UseWarTableResult` + selector; add helpers `replyTo`/`deleteMessage`/`react`/`unreact`/`pin`/`unpin`; switch the seed + reconcile reads from `readThread` to `readThreadWithSystem(thread, scope)`. `toStoreMessage` is unchanged (kind/parentId/body already generic).

### Stage 3: UI (war-table components)

- `apps/web/src/components/war-table/MessageActionsMenu.tsx` — NEW (mirror PlayerActionsMenu, controlled open, react picker view, context-gated items).
- `apps/web/src/components/war-table/MessageBubble.tsx` — hover trigger + long-press, mount MessageActionsMenu, ReactionRow, clickable reply quote -> `onJumpTo`, derive reaction `mine` from `reactorWallets`, new action props.
- `apps/web/src/components/war-table/ThreadRenderer.tsx` — kind=5/6 render guard, replyTo state + composer chip, pin banner, `onJumpTo` + `highlightId`, optional `canPin` prop, `data-msg-id` + highlight ring, wire all callbacks and `connectedWallet`/`pinnedId` down.
- (optional) `apps/web/src/components/war-table/ReactionRow.tsx` — if extracted from MessageBubble; UI stage.

Files NOT edited by any stage (read-only references): `PlayerActionsMenu.tsx`, `BottomSheet.tsx`, `src/events/parser.ts`, `src/instructions/wartable.ts`, the chain program.

## 8. Risks / load-bearing details

1. Shared single `logIndex` per tx across BOTH wt1 and event blobs in `readThreadWithSystem`, or a wt1 id collides with an event id in the same tx. Use the position in `readProgramData(logMessages)`.
2. Un-react targets the REACTION message id, not the reacted-to message. The tombstone fold must scan `reactionRecords` (not just `messages`) and recompute the affected parent's `reactions`. This is the single most error-prone extension point.
3. Pin = highest-id non-tombstoned kind=6; zero-parent = none. Track `maxPinId`; resolve `pinnedId` from its parentId. A tombstone of the current pin message clears `pinnedId`.
4. `hexToId` must produce exactly 12 bytes from the fixed-width 24-char hex; reply/delete/react/pin all depend on the round-trip.
5. The store has no wallet: store `reactorWallets`, derive `mine`/`myReactionIds` in the renderer/hook against `connectedWallet`.
6. Keep the `wasOpen` focus guard in MessageActionsMenu; many instances per thread, a closed menu must not steal focus and fight auto-scroll.
7. Mobile long-press must cancel on `pointermove` > ~10px or scrolling opens menus.
8. `addPendingMessage` must branch like `ingest` for kind=4/5/6 so optimistic delete/react/pin fold immediately instead of rendering stray bubbles.
9. `setThreadMessages` (initial seed) must fold kind=5/6 too; rewrite it to loop through `ingest` rather than a plain sort.
