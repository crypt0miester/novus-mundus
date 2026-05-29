# War Table UI Build Spec

Consolidated from three discovery reports. This is the single source of truth for the
War Table messages front-end redesign. The chat backend is done and working; this is a
pure front-end task. Build ON the existing pieces, do not rebuild them.

## Hard conventions (enforced; violations rejected)

- No em-dash character anywhere in UI strings or comments. Use plain hyphens or restructure.
  CosmeticFrame / CosmeticBadge already contain an em-dash in their `title`; that is a
  pre-existing violation in files we do not own. Do NOT copy that pattern.
- Never render typed `->` / arrow glyphs in UI. Use a lucide-react icon (CornerDownRight,
  ChevronRight, SendHorizontal, etc.).
- Line comments `//` only in new files. No `/* */` blocks (JSDoc `/** */` is allowed). No
  divider rule lines.
- bun, never npm/npx. No git worktrees. Do NOT commit.
- No `??` / `||` shims for required state. Branch explicitly on real "not loaded yet" /
  "unknown player" states. Exception: passing a DISPLAY catalog id into CosmeticFrame as
  `id ?? 0` is acceptable because that matches CosmeticFrame's own documented contract; it
  is a display id, not required app state.
- Import sibling components by their direct path (`@/components/war-table/PlayerAvatar`),
  NOT through the barrel. Only the one agent that owns `index.ts` edits the barrel.

## Resolved facts (where discovery reports disagreed)

1. PDA derivation signature is `derivePlayerPda(gameEngine: PublicKey, owner: PublicKey):
   [PublicKey, number]`. The first arg is a RAW PublicKey.
2. The correct gameEngine source is `client.gameEngine` from `useNovusMundusClient()`
   (`@/lib/solana/provider`). It is already a `PublicKey` and is passed directly to
   `derivePlayerPda` (precedent: team-tab.tsx:161 `derivePlayerPda(client.gameEngine, publicKey)[0]`).
   Discovery C's `useAccountStore((s) => s.gameEngine)` is WRONG for this use: the store's
   `gameEngine` is an `AccountEntry<GameEngine>` (`{ pubkey, account }`), so it would require
   `.pubkey`. USE `client.gameEngine`. Do not read gameEngine from the account store for derivation.
3. `viewProfile === viewOnMap`. There is no clean cross-context profile panel. `pvp-detail`
   is wallet-keyed and current-city-gated (returns "no longer in your city" off-city) and has
   zero live callers. Do NOT call `useRightPanelStore().show(..., "pvp-detail", ...)` from chat.
   The map deep-link preselects the player and opens its inline EntityPanel; that IS the profile.
4. `DmConvo` (war-table.ts) has fields: `threadPda`, `peerPlayerPda`, `lastMessageId` (hex),
   `lastPreview`. It has NO `createdAt`. Inbox rows therefore OMIT the timestamp (do not
   fabricate one). Adding `lastCreatedAt` is a follow-up, out of scope.
5. `ThreadRenderer.tsx` hard-codes `max-h-96` at line 94. Move the cap to a prop so the DM
   page can fill the screen while embeds keep the cap.

---

## (1) PlayerAvatar component contract

File: `src/components/war-table/PlayerAvatar.tsx` (new, war-table owned). `"use client"`.

Renders ONLY the circular avatar (cosmetic frame + inner disc + optional monogram). It does
NOT render names; pair it with DomainName for labels.

Props (accept exactly one of wallet / playerPda):

```ts
interface PlayerAvatarProps {
  // base58 signing WALLET (WtMessage.senderWallet). Derives the PDA internally.
  wallet?: string;
  // base58 PlayerAccount PDA (DmConvo.peerPlayerPda, /messages route param). Used directly.
  playerPda?: string;
  size?: number;   // diameter in CSS px, default 36
  title?: string;  // optional hover title supplied by caller (e.g. resolved domain)
}
```

Derivation:
1. `const client = useNovusMundusClient();` for `client.gameEngine` (a PublicKey).
2. Snapshot the account store with `useShallow` selecting only `otherPlayers`, `myPlayerPda`,
   and the self `player` slot, to avoid churning every avatar in a long thread on an unrelated
   WS tick.
3. Resolve to an `AccountEntry<PlayerCore> | null`:
   - If `playerPda` given: `otherPlayers.get(playerPda)`; also match self when
     `myPlayerPda === playerPda` -> use the self `player` slot.
   - If `wallet` given: inside a `useMemo`, build `new PublicKey(wallet)` in a try/catch
     (malformed -> null, no shim), then `const [pda] = derivePlayerPda(client.gameEngine, pk)`,
     then `otherPlayers.get(pda.toBase58())`; also match self by `player.account.owner`.
   - gameEngine / client not ready yet is a real not-loaded branch: render the monogram +
     gradient from the raw input string (wallet or pda) with no frame. Not a shim.

Cosmetic frame usage:
- Read `equippedAvatarFrame` (number) and `equippedNameColor` (number) from the resolved
  `account`. Wrap the inner disc in `<CosmeticFrame id={resolved?.account.equippedAvatarFrame ?? 0}
  size={size}>`. CosmeticFrame (import `@/components/cosmetics/CosmeticFrame`) falls through
  cleanly on id 0/unknown and already does `overflow:hidden` + circle, clipping the disc.
- Inner disc fill: if `getCosmeticColor(equippedNameColor)` (from
  `@/lib/config/cosmetics-catalog`) returns an entry, theme the disc with its `.hex` (STATIC;
  skip animation in chat for cost). Else use the deterministic gradient fallback.

Fallback identicon (private helper in the same file, no new lib file):

```ts
function gradientFromKey(base58: string): string {
  let h = 0;
  for (let i = 0; i < base58.length; i++) h = (h * 31 + base58.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return `linear-gradient(135deg, hsl(${hue} 45% 32%), hsl(${(hue + 40) % 360} 50% 22%))`;
}
```

Visual structure:

```tsx
<CosmeticFrame id={resolved?.account.equippedAvatarFrame ?? 0} size={size}>
  <div
    title={title}
    style={{ width: size, height: size, borderRadius: "50%",
             background: discBackground, display: "grid", placeItems: "center" }}
    className="text-text-secondary"
  >
    {/* optional 1-2 char monogram from resolved domain/name or address */}
  </div>
</CosmeticFrame>
```

- Known player (resolved): disc = name-color hex when set else gradient; ring from frame.
- Unknown player (not in store, gameEngine not ready, malformed key): no frame (id 0 falls
  through), disc = `gradientFromKey(wallet ?? playerPda)`. Optional 1-2 char monogram from the
  address for a touch of identity.

Memoize the PDA derivation and disc background on the input id. Do not duplicate name rendering;
that is DomainName's job.

---

## (2) usePlayerActions(playerPda) contract

File: `src/lib/hooks/usePlayerActions.ts` (new). `"use client"`. Keyed by PlayerAccount PDA
base58. Read-only / navigation only; no tx, no shims.

Imports: `useRouter` from `next/navigation`; `useAccountStore` from `@/lib/store/accounts`.

Subscribe to the single store entry so coords stay fresh as the player moves:
`const entry = useAccountStore((s) => s.otherPlayers.get(playerPda));`

Returns `{ viewOnMap, viewProfile, sendDm }`, memoized on `[router, entry, playerPda]`.

EXACT routes / store reads (no ambiguity):

- viewOnMap (and viewProfile, identical): deep-link the `/map` route.
  - `const acc = entry?.account;`
  - If no `acc`: `router.push("/map")` (real degrade branch; the view still lands on the map).
  - Else build params and push:
    - `city` = `String(acc.currentCity)`
    - `lat`  = `String(acc.currentLat)`   (RAW degree float; the map grid-rounds via lat*10000)
    - `long` = `String(acc.currentLong)`  (RAW degree float)
    - `player` = `playerPda` (the PlayerAccount PDA; map sets OCCUPANT_PLAYER and preselects)
    - `router.push(\`/map?${params.toString()}\`)`
  - Precedent: team-tab.tsx navigateToMap(cityId, lat, long, playerPda) lines 215-222.
  - The map (map-tab.tsx lines 219-345) consumes the params on mount, drills into the city,
    focuses the cell, preselects the player (opens the inline EntityPanel = the profile), and
    strips the params from the URL after consumption (safe to push repeatedly).

- viewProfile: alias to the SAME function as viewOnMap. There is no standalone cross-context
  profile panel; pvp-detail is wallet-keyed + current-city-gated. The map's preselected
  EntityPanel is the profile surface.

- sendDm: `router.push(\`/messages/${playerPda}\`)`. The `[peer]` route param IS the peer's
  PlayerAccount PDA base58 (parsePlayerPda + symmetric deriveDmThreadPda). DM always works
  since it only needs the PDA; it does not depend on `otherPlayers`.

Consumer note: if a caller only holds a WALLET, derive the PDA first via
`derivePlayerPda(client.gameEngine, walletPubkey)[0]` (client from `useNovusMundusClient()`),
then pass `pda.toBase58()` to this hook.

---

## (3) PlayerActionsMenu contract

File: `src/components/war-table/PlayerActionsMenu.tsx` (new, war-table owned). `"use client"`.

A small accessible popover/menu built WITHOUT a shared primitive (none exists). Triggered by
an avatar/name tap in a message row.

Props:

```ts
interface PlayerActionsMenuProps {
  playerPda: string;        // target PlayerAccount PDA base58
  scope?: "thread" | "dm";  // in "dm" scope the sendDm item is HIDDEN (already in the DM)
  children: React.ReactNode; // the trigger element (avatar/name); menu anchors to it
}
```

Behavior:
- Calls `usePlayerActions(playerPda)` and renders menu items that invoke
  viewOnMap / viewProfile / sendDm.
- Items render lucide icons (NEVER typed arrows):
  - View on map: `Map` (or `MapPin`)
  - View profile: `User`
  - Send message: `MessageSquare` (HIDDEN when `scope === "dm"`)
- Desktop: an anchored absolute-positioned panel relative to the trigger. Open on trigger
  click. Closes on outside click (document mousedown listener checking the menu+trigger refs)
  AND on Escape (keydown listener). Manage `open` state locally. Add `role="menu"` on the
  panel and `role="menuitem"` on each item; trigger gets `aria-haspopup="menu"` +
  `aria-expanded`. Focus the first item on open; return focus to the trigger on close.
- Mobile: render the same items inside `BottomSheet` (`@/components/shared/BottomSheet`)
  instead of the anchored panel. Gate desktop vs mobile the same way the rest of the app does
  (the existing mobile breakpoint hook / media query). BottomSheet handles its own dismissal.
- Styling: panel `rounded-lg border border-border-default bg-surface`; items
  `flex items-center gap-2 px-3 py-2 text-sm text-text-secondary hover:bg-surface-overlay
  hover:text-text-primary`; icons `h-4 w-4`.
- No `??`/`||` shims, no em-dashes. Item labels: "View on map", "View profile", "Send message".

---

## (4) NewMessageComposer contract

File: `src/components/war-table/NewMessageComposer.tsx` (new, war-table owned). `"use client"`.
Mounted from the inbox page header ("New message" button). On mobile renders inside
`BottomSheet`; on desktop an inline panel/popover.

Purpose: pick a recipient and route to `/messages/<playerPda>`.

Two recipient paths:
1. Search over `otherPlayers` minus self:
   - Read `otherPlayers` (Map<playerPda base58, { pubkey, account }>) and `myPlayerPda` from
     `useAccountStore`. Build the candidate list excluding the entry whose key === myPlayerPda.
   - Match the query against BOTH the address (playerPda base58 and `account.owner` wallet
     base58, case-insensitive substring) AND the resolved domain. Warm domains with
     `useDomainNames` over the candidate PDAs; match against the cached domain string too.
   - CAP results (e.g. first 8 matches) to keep it light. Render each row with PlayerAvatar
     (playerPda) + DomainName.
   - Selecting a row: `router.push(\`/messages/${selectedPlayerPda}\`)` and close.
2. Paste-a-wallet path:
   - A text input accepts a base58 WALLET. On submit, `new PublicKey(value)` inside try/catch
     (invalid -> show an inline error, no shim), then
     `const [pda] = derivePlayerPda(client.gameEngine, pk)` (client from
     `useNovusMundusClient()`), then `router.push(\`/messages/${pda.toBase58()}\`)`.
   - Note: this derives a PlayerAccount PDA from a WALLET. (A pasted value that is itself a
     PDA cannot be derived from; the search path covers known-PDA selection. If you also want
     to accept a pasted PDA, mirror parsePlayerPda from the [peer] page and route it directly
     when it matches a known otherPlayers key, else treat the pasted value as a wallet.)
   - Recommended: a single input that first tries wallet-derivation; surface the resolved
     domain/avatar as a confirmation row before routing.
- Styling consistent with the menu: rounded surface, border-border-default, accent focus ring,
  lucide search icon. No em-dashes, no typed arrows.

This is the ONE place the brief says a small menu/composer must be built. It DOES have a data
source now (otherPlayers + paste-a-wallet derivation), so build it; do not punt to a "link to
map" hint.

---

## (5) ThreadRenderer + MessageBubble iOS-Messages design

Keep the PUBLIC CONTRACT of ThreadRenderer identical (`ThreadRendererProps`, exported via the
barrel) so all 4 embed sites (team chat tab, RallyDetailPanel, EncounterDetailPanel) and the
DM page keep working untouched. Build new sibling files and have ThreadRenderer orchestrate
them.

New files (all `"use client"` unless pure):
- `src/components/war-table/MessageBubble.tsx` — one chat bubble
- `src/components/war-table/DaySeparator.tsx` — centered day pill
- `src/components/war-table/Composer.tsx` — pill compose bar + round send button
- `src/lib/war-table-grouping.ts` — PURE grouping helper (no React)

ThreadRenderer keeps the `useWarTable` lifecycle, auto-scroll, empty/loading states; maps
grouped rows to MessageBubble; renders Composer. MessageRow / placeholderFor are absorbed into
MessageBubble. Keep `LOCKED_PLACEHOLDER` / `TOMBSTONE_PLACEHOLDER` / `placeholderFor` and the
parent `byId` lookup.

### Grouping (`lib/war-table-grouping.ts`, pure)

Input: ordered `WtMessage[]` (store already sorts ascending by id) + the connected wallet
base58 (pass it IN; do not read the store inside the pure fn). Output: flat render items:

```ts
type RenderItem =
  | { kind: "day"; key: string; label: string }
  | { kind: "system"; key: string; msg: WtMessage }
  | { kind: "msg"; key: string; msg: WtMessage; mine: boolean;
      groupPos: "single" | "first" | "middle" | "last"; showMeta: boolean };
```

Rules:
- `mine` = `msg.senderWallet === connectedWallet`.
- Day separator: insert a `day` item when local-day `floor(createdAt/86400 adjusted to local)`
  changes vs the previous message, and before the first message. Messages with `createdAt === 0`
  (advisory ts missing) join the previous day group (no spurious separator).
- Grouping: consecutive messages with same `senderWallet`, same side, same local-day, within a
  5-minute `createdAt` gap form one group. `System` and reply-with-parent messages ALWAYS break
  the group. `pending` messages start/continue their own visual group; never merge a confirmed
  message into a pending group.
- `groupPos`: `single` if alone, else `first`/`middle`/`last` by position in its group (drives
  corner rounding).
- `showMeta`: true for the FIRST bubble of a received group (renders avatar + name) and the
  LAST bubble of any group (renders the subtle timestamp). Avatar shown once per received group;
  own groups never show an avatar (iOS convention).
- Day label: `Today`, `Yesterday`, else
  `toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" })`. Plain text.

### ThreadRenderer list region

New `maxHeightClass?: string` prop, default `"max-h-96"` (preserves current embed behavior; no
call-site change at the team/rally/encounter embeds). The DM page passes
`maxHeightClass="max-h-none"`. Move the existing hard-coded `max-h-96` (line 94) onto this prop.

```
<div className={cn("flex h-full min-h-64 flex-col gap-2", maxHeightClass)}>
  <div ref={scrollRef} className="flex-1 space-y-1 overflow-y-auto rounded-lg
        border border-border-default bg-surface/60 px-3 py-3">
    {/* render items: DaySeparator | system pill | MessageBubble */}
  </div>
  <Composer .../>
</div>
```

- `space-y-1` for tight intra-group spacing; add `mt-3` on each new group's first bubble and
  `mt-4` around day separators (applied in the map) so groups breathe but bubbles hug.
- Auto-scroll effect: keep as-is (`scrollRef.scrollTop = scrollHeight` on message count).
- Empty/loading: keep current `LoaderCircle` / `MessageSquare` placeholders verbatim.
- Pass a `compact` boolean down (true when default max-h, i.e. embeds) -> avatar size 28 in
  compact, 32 in full-screen DM.

### MessageBubble

Row wrapper: `flex w-full items-end gap-2` + `justify-end` (mine) / `justify-start` (received).
Received rows reserve a leading avatar gutter so middle/last bubbles align under the first:

```
<div className="flex w-full items-end gap-2 justify-start">
  <div className="w-7 shrink-0">  // 28px gutter (w-8 for full-screen)
    {showMeta ? <PlayerActionsMenu playerPda={pda} scope={scope}>
                  <PlayerAvatar wallet={msg.senderWallet} size={28} />
                </PlayerActionsMenu> : null}
  </div>
  <div className="flex max-w-[78%] flex-col gap-0.5">
    {showMeta && <name header>}
    <bubble/>
    {lastOfGroup && <timestamp + delivery tick row>}
  </div>
</div>
```

Bubble surface:
- Own (right): `bg-accent text-surface`. (`--color-accent` = `--tier-accent`; text-surface reads
  on the saturated accent across all tiers.)
- Received (left): `bg-surface-overlay text-text-primary`.
- Shared: `whitespace-pre-wrap break-words px-3 py-2 text-sm`.

Corner rounding by groupPos + side (base `rounded-2xl`, tighten the inner-stack corner via a
`cn()` lookup; no shims):
- Own group: first -> `rounded-br-md`; middle -> `rounded-r-md`; last -> `rounded-tr-md`;
  single -> full `rounded-2xl`.
- Received group: mirror on the left (`rounded-bl-md` / `rounded-l-md` / `rounded-tl-md`).

Name header (received, first-of-group only): `<DomainName pubkey={pda}
className="text-[11px] font-semibold text-text-secondary" />`. Derive `pda` from
`msg.senderWallet` once (the same derivation PlayerAvatar uses; optionally share a tiny
`useSenderIdentity(wallet)` hook colocated in PlayerAvatar.tsx). Drop the old mono
`text-accent` short-wallet (the accent is now the bubble fill).

Per-group timestamp (last-of-group only, `createdAt > 0`): `<span className="text-[10px]
text-text-muted">` via `toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })`.
Right-aligned under own bubbles, left-aligned under received.

Pending / delivered (optimistic echo): `WtMessage.pending === true` until reconciled.
- Pending bubble: add `opacity-70`.
- Delivery tick on OWN last-of-group only, in the timestamp row:
  - pending -> `<LoaderCircle className="h-3 w-3 animate-spin" />`
  - delivered -> `<Check className="h-3 w-3" />` (single check; we have one confirmation signal,
    no double-check / read receipt).

Reply quoting parent: a quote strip INSIDE the top of the bubble, above the body:
```
<div className="mb-1 flex items-center gap-1 rounded-md border-l-2 border-border-default/60
      bg-black/5 px-2 py-1 text-[11px] opacity-80">
  <CornerDownRight className="h-3 w-3 shrink-0" />  // lucide, NOT a typed arrow
  <span className="truncate">{parent.locked || parent.tombstoned ? placeholderFor(parent)
       : parent.body}</span>
</div>
```
On own (accent) bubbles use `bg-black/10`; on received use `bg-black/5`. Replies always break
grouping so the sender header always shows.

Locked / tombstoned (preserved): render inside the bubble as italic muted, same side/rounding,
flat neutral fill: `bg-surface text-text-muted italic opacity-70`. Locked prefixes
`<Lock className="h-3 w-3 shrink-0" />`. Uses `placeholderFor`.

System messages (preserved, centered) routed through the `system` render item:
```
<div className="flex justify-center py-1">
  <span className="rounded-full bg-surface px-2 py-0.5 text-[10px] uppercase tracking-wider
        text-text-muted">
    {msg.locked || msg.tombstoned ? placeholderFor(msg) : msg.body}
  </span>
</div>
```

### DaySeparator
```
<div className="flex items-center justify-center py-2">
  <span className="rounded-full bg-surface px-3 py-0.5 text-[10px] font-medium uppercase
        tracking-wider text-text-muted">{label}</span>
</div>
```

### Composer (pill)
Props: `{ draft, onChange, onSend, disabled, sending, placeholder, congested }`. Keep the
Enter-sends / Shift+Enter-newline `onKeyDown` logic. Auto-grow `rows={1}` to `max-h-32`.
```
<div className="flex flex-col gap-1">
  <div className="flex items-end gap-2">
    <textarea rows={1} className={cn(
      "min-h-[2.5rem] max-h-32 flex-1 resize-none rounded-3xl border border-border-default
       bg-surface px-4 py-2.5 text-sm text-text-primary placeholder:text-text-muted",
      "focus:border-accent focus:outline-none",
      disabled && "cursor-not-allowed opacity-60")} />
    <button aria-label="Send message" className={cn(
      "flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-surface
       transition-opacity", "disabled:cursor-not-allowed disabled:opacity-40")}>
      {sending ? <LoaderCircle className="h-4 w-4 animate-spin" />
               : <SendHorizontal className="h-4 w-4" />}
    </button>
  </div>
  {congested && <p className="text-[10px] text-text-muted">Network fees are high right now;
    your message was sent at the capped priority fee.</p>}
</div>
```
Keep the congested notice text and the "Read-only" placeholder verbatim. Changes vs today:
`rounded-md` -> `rounded-3xl` (textarea pill), `rounded-md` -> `rounded-full` (send circle).

### Compact-embed safety
- Default `maxHeightClass="max-h-96"` preserves team/rally/encounter behavior (no call-site
  change there).
- compact -> avatar size 28, gutter `w-7`, `max-w-[78%]` bubbles, `space-y-1`.
- Composer `rows={1}` auto-grow starts short.
- DM page opts into `max-h-none`.

---

## (6) Inbox + conversation page restyle

### Inbox: `app/(game)/messages/page.tsx`
Keep `useDmInbox`, `DmConvo`, the `Link href`, and the `Suspense` / `PageTransition` shell.
Restyle `ConversationRow` to an iOS conversation-list row:
```
<Link className="flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors
      hover:bg-surface-overlay">
  <PlayerAvatar playerPda={convo.peerPlayerPda} size={44} />
  <div className="min-w-0 flex-1">
    <div className="flex items-center gap-2">
      <DomainName pubkey={convo.peerPlayerPda} className="truncate text-sm font-semibold
            text-text-primary" />
    </div>
    <p className="truncate text-xs text-text-muted">{convo.lastPreview}</p>
  </div>
  <ChevronRight className="h-4 w-4 shrink-0 text-text-muted" />
</Link>
```
- Avatar by PLAYER PDA (inbox only has `peerPlayerPda`); PlayerAvatar's `playerPda` prop covers
  this with no derivation.
- NO timestamp: `DmConvo` carries no `createdAt`. Omit it; do not invent a time. Follow-up:
  add `lastCreatedAt` to DmConvo + populate in useDmInbox (out of scope).
- Unread dot is optional: `DmConvo` has no unread flag today, so DO NOT render a fabricated
  unread dot. (Discovery C's dot was speculative.) If/when an unread signal exists, add
  `<span role="status" aria-label="Unread" className="ml-auto h-2 w-2 shrink-0 rounded-full
  bg-accent" />`. Flag as follow-up.
- List container: flat hover rows separated by `divide-y divide-border-default/50` (drop the
  per-row card border). Keep empty/loading states verbatim.
- Warm names once: `useDomainNames(conversations.map((c) => c.peerPlayerPda))` in the content
  component; rows still render via DomainName.
- Header: add a "New message" button next to the MESSAGES title that opens NewMessageComposer
  (BottomSheet on mobile, inline panel on desktop). Button:
  `<button className="inline-flex items-center gap-1.5 rounded-full border border-border-default
   px-3 py-1.5 text-xs font-semibold text-text-secondary hover:border-border-gold
   hover:text-text-primary"><PenSquare className="h-4 w-4" /> New message</button>`
  (verify the exact lucide export name PenSquare vs SquarePen at build).

### Conversation page: `app/(game)/messages/[peer]/page.tsx`
Keep ALL PDA-derivation logic, `BackLink`, error states, `WarTableScope.Dm`, `peer`, `canPost`,
`placeholder`, and the ThreadRenderer call, except: add `maxHeightClass="max-h-none"` and
restyle the header.
```
<div className="flex items-center gap-3">
  <PlayerAvatar playerPda={peerPda.toBase58()} size={36} />
  <DomainName pubkey={peerPda} className="tier-title font-display text-lg font-bold
        tracking-wide" />
</div>
```

---

## (7) File ownership map (no collisions)

Each implementation agent OWNS (writes) only its listed files. Reuse-only files are read, never
edited. Siblings import by direct path; only the index agent edits `index.ts`.

| Agent | OWNS (writes) | Reuse-only (read, no edit) |
|---|---|---|
| Agent 1 - Avatar | `src/components/war-table/PlayerAvatar.tsx` | CosmeticFrame, cosmetics-catalog, accounts store, DomainName, novus-mundus-sdk (derivePlayerPda), provider (useNovusMundusClient) |
| Agent 2 - Actions | `src/lib/hooks/usePlayerActions.ts`, `src/components/war-table/PlayerActionsMenu.tsx` | accounts store, BottomSheet, lucide-react; consumes PlayerAvatar by direct path |
| Agent 3 - Composer/New | `src/components/war-table/NewMessageComposer.tsx` | accounts store, useDomainNames, BottomSheet, provider, sdk; consumes PlayerAvatar + DomainName by direct path |
| Agent 4 - Thread core | `src/components/war-table/ThreadRenderer.tsx`, `src/components/war-table/MessageBubble.tsx`, `src/components/war-table/DaySeparator.tsx`, `src/components/war-table/Composer.tsx`, `src/lib/war-table-grouping.ts` | useWarTable, war-table store (WtMessage), DomainName; consumes PlayerAvatar + PlayerActionsMenu by direct path |
| Agent 5 - Inbox/pages | `src/app/(game)/messages/page.tsx`, `src/app/(game)/messages/[peer]/page.tsx` | useDmInbox, DomainName, useDomainNames; consumes PlayerAvatar + NewMessageComposer by direct path |
| Agent 6 - Barrel | `src/components/war-table/index.ts` | adds exports for new public components |

Collision-avoidance rules:
- Only Agent 6 edits `index.ts`. Everyone else imports siblings via
  `@/components/war-table/<Name>`.
- Agent 4 keeps the ThreadRenderer public contract identical (ThreadRendererProps export name,
  default behavior) so the embeds and Agent 5's pages keep working. The only additive prop is
  `maxHeightClass?` (defaulted).
- Agents 2, 3, 4, 5 depend on Agent 1's PlayerAvatar prop shape (`wallet?` / `playerPda?` /
  `size?` / `title?`); that shape is frozen by this spec.
- No agent edits CosmeticFrame, cosmetics-catalog, the account store, the war-table store,
  DomainName, useDmInbox, useWarTable, or the SDK. Open items (DmConvo `lastCreatedAt`, inbox
  unread signal) are flagged follow-ups, not in-scope edits.

## Open items (flagged, not shimmed)
1. Inbox row timestamp: DmConvo has no `createdAt`. Omit the time now; add `lastCreatedAt` to
   DmConvo + useDmInbox as a follow-up.
2. Inbox unread indicator: no unread signal in DmConvo today. Do not fabricate a dot; follow-up.
3. Single delivery tick only: chain gives one confirmation (the reconciled copy). No read
   receipt / double-check.
4. Paste-a-PDA in NewMessageComposer: derivation goes wallet -> PDA. Accepting a pasted PDA
   directly requires matching it against a known `otherPlayers` key; the search path covers
   known-PDA selection.
