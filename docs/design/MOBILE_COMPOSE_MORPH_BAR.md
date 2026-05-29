# Mobile compose-in-morph-bar — design

Status: implemented (phone only; the iOS/Android keyboard pass still needs
real-device tuning, per §8)
Owner: war-table / mobile chrome
Scope: phone only (`< md`); web app (`apps/web`)

## 1. Context & motivation

On a phone, an open war-table chat shows **two stacked bottom bars** (see the
mobile screenshot that prompted this): the chat composer (textarea + send) sits
just above the `MorphTabBar`, which during a sheet is mostly empty — it carries
only the sheet-dismiss ✕. That's wasted vertical real estate and reads as two
competing bottom chromes.

The goal is to host the composer **in the morph bar itself** — a new `compose`
shape — so a single bottom bar is the message input, with the send button in
the bar and the close ✕ in its standalone circle slot.

This was initially dismissed as a poor fit. On review that was too cautious: the
content-model objection dissolves with a React portal, and the only genuinely
hard part is the iOS keyboard (a solved-but-fiddly problem). This doc is the
honest plan.

## 2. What exists today (the pieces we build on)

- **`components/layout/MorphTabBar.tsx`** — a singleton, `md:hidden`,
  `position: fixed; bottom: max(12px, env(safe-area-inset-bottom))`, mounted in
  `app/(game)/layout.tsx` beside `{children}`. It is one persistent pill that
  morphs between three shapes via anime.js:
  - `nav` — 5 primary tab icons + a `+` overflow circle.
  - `actions` — 1–2 panel action buttons (centred pill).
  - `wide` — 3+ actions or a dismiss ✕ (pill pinned to `NAV_GROUP_WIDTH`, the ✕
    taking the circle slot). `pillEmpty` = wide + no row actions → invisible
    spacer pill, just the ✕ circle (this is the state during a content-only
    chat sheet today).
  - The pill width animates (CSS can't transition content-`auto` width); two
    layers (`navLayer`, `actionLayer`) cross-fade with a staggered "speed-dial".
- **Content model** — the bar renders `PanelAction[]` (serializable specs:
  `{ id, label, variant, disabled, onClick, kind }`) as `TxButton`s.
  `useMorphActions` re-registers on `JSON.stringify([id,label,variant,disabled])`.
  **There is no channel for a live React node / controlled input.** This is the
  fact that makes a portal (not the action channel) the right tool.
- **`components/war-table/ThreadRenderer.tsx`** — owns `useWarTable` (messages,
  send, loadOlder…) and the composer: local `draft` state, `textareaRef`,
  `handleSend`, auto-grow (`min-h-10 → max-h-32`), UTF-8 byte-limit trim, reply
  chip, byte counter, congestion notice. The composer is a `<div className="flex
  items-end gap-2"><textarea/><button send/></div>`.
- **`components/war-table/MobileTeamDock.tsx`** — `lg:hidden` collapsed strip +
  `BottomSheet` (drag-to-close) whose children include `ThreadRenderer`. The
  `MorphTabBar` appends the sheet-close ✕ via `useSheetStore`.

## 3. Goals / non-goals

Goals
- One bottom bar on phones during a chat sheet: the morph bar becomes the
  composer (textarea + send), the dismiss control in the circle.
- Full-page DM (`/messages/[peer]`) compose-in-bar on phones. A conversation is
  a leaf/detail view reached by navigating into it; it already carries a top
  back affordance (the "Messages" chevron), and we add a thumb-reachable back
  chevron in the bar's circle. Native messengers (iMessage, WhatsApp, Telegram)
  replace the bottom tab bar with the composer inside a conversation, so this is
  the correct pattern, not a regression. The DM surface publishes its own back
  action because there is no sheet to synthesize a close from.
- Keep the composer's draft/send logic on `ThreadRenderer`/`useWarTable`; do
  **not** push chat state into the global nav store. The draft state lives on
  `ThreadRenderer` (above the portal boundary) so a portal flip never loses it.
- Zero regression to `nav` / `actions` / `wide` shapes, to tablet, and to
  desktop (sidebar) chat.
- Correct iOS/Android keyboard behaviour (input rides above the keyboard;
  newest messages stay visible).

Non-goals
- Tablet (`md`–`lg`) compose-in-bar: the morph bar is `md:hidden`, so there is
  no bar to host the composer; tablet keeps the inline composer.
- Desktop: unaffected (right-sidebar chat, no morph bar).

## 4. Constraints & realities (why this is non-trivial)

1. **Breakpoint mismatch.** `MorphTabBar` is `md:hidden` (present `< 768px`);
   the team dock/sheet is `lg:hidden` (`< 1024px`). So at `md`–`lg` (tablet) the
   sheet exists but the bar does not. ⇒ compose-in-bar is **phone-only (`< md`)**
   and the inline composer must remain the default/fallback everywhere else.
2. **iOS keyboard over a fixed-bottom input.** iOS does not lift `position:
   fixed` elements above the on-screen keyboard; the input would hide behind it.
   Requires a `visualViewport` listener that lifts the bar (and pads the message
   list). This is the meatiest engineering piece and **cannot be fully verified
   in dev** — needs a real iOS Safari device.
3. **The pill is not just a width.** `compose` differs from the other shapes in
   height (`h-14` → auto, capped), border-radius (`rounded-full` →
   `rounded-3xl` for multi-line), `overflow-hidden` (must be removed or it clips
   a 2-line textarea + reply chip + counter), and content type (a live input,
   not buttons). It also grows **upward** (bottom-pinned), so the row switches
   `items-center` → `items-end`.
4. **Input vs. messages are in different fixed elements.** Messages live in the
   `BottomSheet`; the composer would live in the bar. On keyboard open both must
   coordinate off one shared inset so the newest message stays visible above the
   input. (Keeping them together would avoid this — see §12.)
5. **The animation state machine is intricate.** Threading a 4th shape through
   the anime.js width-morph + 2-layer cross-fade is the highest-regression-risk
   change. Mitigated by generalising `layerFor()` and a contained transition
   (§7), with a sibling-bar fallback (§12) if it destabilises the existing
   shapes.

## 5. Chosen architecture — `compose` shape + portal

A new `compose` shape on `MorphTabBar` renders an empty **slot** `<div>`. The
embedding surface (team dock) requests compose and `ThreadRenderer`
**`createPortal`s its `<Composer/>` into that slot** — so the composer's React
tree (and draft state) stays in `ThreadRenderer`, while its DOM appears in the
bar. The bar provides the morphing container + the ✕ circle; the composer brings
its own send button.

Control flow (all under `(game)/layout.tsx`, so a zustand store needs no
provider):

```
ThreadRenderer (in sheet, phone)                MorphTabBar (singleton)
  │  useMorphCompose(active=true)  ──────────▶  reads store.composeActive
  │                                              ⇒ shape = "compose", renders slot div,
  │                                                 publishes slotEl to store
  │  reads store.slotEl  ◀───────────────────── store.setSlotEl(node)
  ▼
  createPortal(<Composer/>, slotEl ?? inlineFallback)
```

`<Composer/>` is rendered **once**, always as a portal into a *resolved
container* (`slotEl` when the bar offers one, else an inline fallback `<div>` in
the sheet). Always-a-portal keeps the element type stable across the
inline↔bar switch, so the component instance — and the draft — survive a
breakpoint/resize change without a remount.

### 5.1 New store — `lib/store/morph-compose.ts`

```ts
export interface ComposeDismiss {
  icon: "back" | "close";
  onClick: () => void;
}
interface ComposeEntry {
  owner: string;                  // stable useId per useMorphCompose call site
  dismiss: ComposeDismiss | null; // owner-published; null for sheet-backed surfaces
}
interface MorphComposeState {
  entries: ComposeEntry[];        // topmost-last wins, mirrors right-panel morphActions
  slotEl: HTMLElement | null;     // published by MorphTabBar in the compose shape
  register(owner: string, dismiss: ComposeDismiss | null): void; // upsert in place
  unregister(owner: string): void;
  setSlotEl(el: HTMLElement | null): void;
}
```

`composeActive = entries.length > 0`; the topmost dismiss is the last entry's.
A single nullable `ownerId` cannot honour the stacked-sheets "topmost wins"
promise, so the store stacks per owner like `right-panel.ts`, and the dismiss is
per entry so popping the top atomically restores the next owner's control. The
owner publishes `dismiss`; the bar reads it only when no `topSheet` exists (the
DM case), otherwise it keeps its existing sheet-close synthesis.

### 5.2 New hook — `lib/hooks/useMorphCompose.ts`

`useMorphCompose(active: boolean, dismiss: ComposeDismiss | undefined):
HTMLElement | null`. Registers/releases this caller's entry (its own `useId`
slot) and returns the live `slotEl` while this caller is the topmost owner and
active, else null. The caller portals its `<Composer/>` into it. A latest-ref
keeps the published dismiss handler fresh (re-registers only when the icon
changes), mirroring `useMorphActions`. Releases on unmount.

### 5.3 Composer extraction — `components/war-table/Composer.tsx`

Pure refactor (Phase 0): lift the textarea + send button + reply chip + byte
counter + congestion notice + auto-grow out of `ThreadRenderer` into a
**controlled** `<Composer>` with props `{ draft, onDraftChange, onSubmit,
sending, canPost, placeholder, replyTarget, onClearReply, congested, threadId }`.
The `draft` and `sending` state stay on `ThreadRenderer` (above the portal
boundary); `Composer` is presentational and clamps input to the byte limit
before calling `onDraftChange`. `remainingBytes` and `replyTargetPda` are
internal to `Composer`. No behaviour change; `ThreadRenderer` renders
`<Composer/>` inline exactly as before. Independently shippable; de-risks
everything after it.

Why controlled (draft on the parent): flipping a child in/out of `createPortal`
remounts it in React (a portal is a distinct reconciliation node), which would
wipe any state held *inside* `Composer`. Keeping `draft`/`sending` on
`ThreadRenderer`, which never unmounts across the inline↔bar flip, is what makes
the draft survive a dock/undock and a rotation across `md`.

### 5.4 ThreadRenderer wiring

```ts
const isPhone = useIsPhone();                       // lib/hooks/useMediaQuery.ts
// Only dock once the thread is actually open: while the encrypted-thread sign-in
// gate (authState "locked"/"unknown") is up there is no composer, so the bar must
// stay in nav rather than morph to an empty compose slot.
const dockToBar = isPhone && composeInBar === true && authState === "open";
const slotEl = useMorphCompose(dockToBar, composeDismiss);
const composer = <Composer … />;                    // controlled; draft lives here
return (
  <>
    …messages…
    {dockToBar && slotEl ? createPortal(composer, slotEl) : composer}
  </>
);
```

`composer` is the same element in both branches and `draft`/`sending` live on
`ThreadRenderer`, so the draft survives the inline↔bar flip (the portal remount
discards only the textarea DOM height, which the auto-grow effect restores). No
inline-fallback ref node is needed (one would be null on first paint). There is
no `useMatchMedia`; use `useIsPhone()` from `lib/hooks/useMediaQuery.ts`.
`composeInBar` is opt-in: the team dock (`composeInBar={mobileTeamOpen}`, so it
releases cleanly as the sheet closes) and the full-page DM set it; every other
surface keeps the inline composer.

## 6. The `compose` shape in MorphTabBar

```ts
const composeActive = useMorphComposeStore(s => s.ownerId !== null);
const shape: Shape = composeActive ? "compose" : (wide ? "wide" : mode);
```

- **Layer.** Add a `composeLayerRef` (3rd layer) whose only child is the slot
  `<div ref={slotRef}>`; publish `slotRef.current` to the store when
  `shape === "compose"` (and `null` on leave). Generalise the cross-fade's
  `from === "nav" ? navLayer : actionLayer` into a `layerFor(shape)` helper so
  compose participates.
- **Width.** `composeWidth = min(viewport − 2·margin − circle − gap, MAX)`.
  Feed it into the existing width-morph exactly like `wideBarWidth`.
- **Box overrides (compose only).** `h-14 → h-auto` (cap `max-h-40`),
  `rounded-full → rounded-3xl`, drop `overflow-hidden`; row `items-center →
  items-end` so the ✕ circle aligns to the bottom of a tall pill. Border-radius
  + height get a short CSS transition (anime.js animates width only).
- **Circle slot.** In compose, the circle holds a dismiss control: the
  surface-supplied back chevron (full-page DM) when present, else the
  synthesized sheet-close ✕ (team dock), else nothing (the pill spans the full
  width). Send lives inside the portaled `<Composer/>`, not the bar. The circle
  is `self-end`, so it stays bottom-anchored as the pill grows upward.
- **`md:hidden`** unchanged — the bar (and thus compose) only exists `< md`. The
  bar's `composeActive` is additionally gated on `useIsPhone()`, so a future
  non-phone-gated consumer cannot register at tablet width and portal into a
  `display:none` slot (which would trap the draft).

### 6.1 Dismiss source: sheet-close vs surface-supplied back

The circle's dismiss has two sources, resolved topmost-first:

- Inside a `BottomSheet` (team dock): the dismiss is the sheet-close,
  synthesized by `MorphTabBar` from `useSheetStore`'s `topSheet`. The team dock
  passes no `composeDismiss`; `useMorphCompose(active, undefined)` registers a
  null dismiss and the bar renders the close glyph.
- Full-page DM (no sheet): there is no `topSheet`, so the surface supplies its
  own control. The DM page builds `{ icon: "back", onClick: () =>
  router.push("/messages") }` (deterministic, matching the header chevron; not
  `router.back()`, which could strand a deep-linked visitor) and threads it:
  page to `ThreadRenderer` (`composeDismiss` prop) to `useMorphCompose` to the
  store. `ThreadRenderer` never hardcodes `/messages`; the route lives only in
  the page. The bar reads the topmost entry's dismiss and renders a back chevron.

The compose shape is flipped by `composeActive` (store-driven), NOT by
`topSheet`: the DM has no sheet but still enters compose.

## 7. Animation integration (highest risk) + fallback

- Reuse the **width-morph** verbatim (it is shape-agnostic — just a target
  width). `nav/wide → compose` animates width to `composeWidth`.
- Generalise the **cross-fade** to `layerFor(from)`/`layerFor(to)`; compose
  enters with a plain fade + rise (skip the per-child speed-dial stagger — there
  are no "items", just the slot).
- **Height/radius** via CSS transition, not anime.js.
- **Reduced motion** — instant opacity/width as the existing code already does.
- **Fallback (if this destabilises nav/actions/wide):** ship compose as a
  **sibling `<ComposeBar>`** (a separate fixed element at the same bottom anchor)
  that the bar yields to (`MorphTabBar` returns `null` / stays behind while
  `composeActive`), cross-fading between the two elements instead of threading a
  4th shape through the anime.js machine. Same UX, zero edits to the existing
  state machine. Decision gate at the end of Phase 1.

## 8. Keyboard handling — `lib/hooks/useKeyboardInset.ts`

`useKeyboardInset(): number` returns the px the keyboard occludes:
`kb = max(0, documentElement.clientHeight - visualViewport.height -
visualViewport.offsetTop)`, on the visual-viewport `resize` + `scroll` events,
rAF-throttled, 0 on the server / unsupported / keyboard-closed. iOS does not
resize the layout viewport, so this recovers the occluded height; Android
usually resizes it and reports ~0 (the fixed bar is already lifted). The result
is **clamped to `[0, 60% of the layout height]`** because the iOS layout-vs-
visual reference frames can disagree by the URL-bar height across Safari
versions; the clamp keeps a bad measurement from pushing the bar off the top.
This is the piece that **cannot be fully verified in dev** and needs a real
iOS Safari device pass.

- **Bar:** when `composeActive`, apply `transform: translateY(-kbInset)` to the
  **outer fixed wrapper** (not `bottom`). `translateY` is compositor-cheap and
  stacks on the resolved `bottom: max(12px, safe-area)` with no safe-area
  double-count, and the anime.js width-morph never touches the wrapper, so the
  transform owner is conflict-free. Never moves the bar in `nav`/`actions`/`wide`.
- **Messages:** `ThreadRenderer`'s own `scrollRef` adds `paddingBottom = kbInset
  + max(0, slotHeight - COMPOSE_AMBIENT_PAD)` and re-pins to bottom (a
  `useLayoutEffect`) on that value changing. Each docked surface already reserves
  ambient bottom space that clears a *resting* compose bar (the game `<main>`
  pb-20, the team sheet content pb-18 ≈ `COMPOSE_AMBIENT_PAD`), so the list only
  adds the keyboard inset plus any composer growth past that ambient pad. The bar
  and the list both call `useKeyboardInset()` directly; the formula is pure and
  rounded, so two consumers compute the identical integer on the same frame (no
  shared store needed). `slotHeight` is the docked composer's measured height
  (the bar's slot node, observed by a ResizeObserver), so a multi-line composer
  never hides the newest bubble; measuring the slot does not feed back into the
  list's own layout (it lives in the bar).
- Do **not** subtract a safe-area term from `kbInset`: the visual viewport
  already excludes the keyboard, and `bottom: max(12px, safe-area)` handles
  safe-area independently (iOS collapses safe-area to 0 while the keyboard is up).

## 9. Edge cases

- **Read-only** (`!canPost`): still enter compose; render the composer disabled
  with the "Read-only" placeholder (consistent with today).
- **Send in flight:** the spinner lives in the composer's own send button
  (unchanged).
- **Reply chip + byte counter:** part of `<Composer/>`, so they portal into the
  bar and drive its (capped) height. The `max-h-40` cap on compose keeps a long
  reply chip + 2-line draft + counter from eating the screen.
- **Stacked sheets:** compose ownership uses `useId` slot-stacking (topmost
  wins), mirroring `useMorphActions`.
- **Resize across `md`** (rotate / devtools): always-portal-into-resolved-
  container keeps the `<Composer/>` instance ⇒ draft survives.
- **Sheet close / unmount order:** portal target resolves to the inline fallback
  if `slotEl` is briefly null during teardown (no portal-into-removed-node).
- **Unread / mark-read, auto-scroll, load-older:** untouched — they live on the
  message list, not the composer.

## 10. Phasing (each independently shippable, flag-gated)

- **Phase 0 — extract `<Composer>`** from `ThreadRenderer`. Pure refactor, no
  behaviour change. Ship + verify chat is identical.
- **Phase 1 — shape + portal + DM**, behind the `COMPOSE_IN_BAR` flag. `compose`
  shape, `morph-compose` store (per-owner `dismiss`), `useMorphCompose(active,
  dismiss)`, shared `useIsPhone`, controlled `<Composer>` (draft on
  `ThreadRenderer`), team-dock opt-in (sheet-close dismiss) AND full-page DM
  opt-in (router-back dismiss). Verify nav/actions/wide and tablet/desktop
  untouched, the DM circle shows a back chevron, and the team-dock circle shows
  the close glyph. **Decision gate:** if the anime.js integration is shaky,
  switch to the sibling-bar fallback (§7).
- **Phase 2 — keyboard** (`useKeyboardInset`, bar lift + list padding/scroll).
  The piece that needs real-device iOS/Android verification.
- **Phase 3 — animation polish** (morph from nav/wide → compose; height/radius
  transition tuning; reduced-motion).

## 11. Testing

- Typecheck (`tsc --noEmit`) for SDK-free web changes.
- **Regression:** nav ↔ actions ↔ wide morph still correct; sheet-close ✕ still
  works; tablet (`md`–`lg`) and desktop chat unchanged.
- **Device matrix (manual, required for Phase 2):** iOS Safari (keyboard lift,
  safe-area, rubber-band scroll), Android Chrome (resize behaviour), small + tall
  phones, rotation.
- **Functional:** type/send, multi-line growth + cap, reply chip, byte counter
  at the limit (emoji = multi-byte), read-only, send-in-flight, congestion
  notice, load-older while composing, draft survival on resize.
- **Reduced motion.**

## 12. Alternatives considered

- **Sibling `<ComposeBar>` (not a 4th shape).** A separate fixed element the
  morph bar yields to while composing. Same UX; **does not touch** the anime.js
  state machine ⇒ lower regression risk, looser coupling. Trade-off: two bottom
  elements to keep visually/positionally in sync, and it's not literally "a
  morph variant." **Kept as the Phase-1 fallback.**
- **Keep the composer in the sheet; just remove the redundant bar.** Hide the
  morph bar (or its empty pill) while a chat sheet is open and move the ✕ into
  the composer/sheet. Lowest risk, achieves the "one bar" space win, and keeps
  input+messages in one element (no split keyboard coordination). Rejected as
  the primary because it isn't the requested "compose lives in the morph bar,"
  but it remains the cheapest fallback if §8 proves too costly on-device.
- **Push the composer through the `PanelAction` channel.** Rejected: the channel
  is serializable button specs; a controlled multi-line input doesn't fit, and
  forcing it would couple chat state into the nav store.

## 13. Risks & mitigations

| Risk | Severity | Mitigation |
|------|----------|------------|
| anime.js state-machine regression (nav/actions/wide) | High | `layerFor()` generalisation + contained transition; **sibling-bar fallback**; Phase-1 decision gate |
| iOS keyboard coordination unverifiable in dev | High | `visualViewport` (standard); isolate in `useKeyboardInset`; real-device pass in Phase 2; keep-in-sheet fallback (§12) |
| input(bar)/messages(sheet) split desync | Med | single shared `kbInset`; both consume it |
| z-index / stacking of sheet vs bar | Med | audit `z-[60]` bar vs sheet; explicit ordering |
| draft loss on resize | Low | always-portal-into-resolved-container |
| breakpoint gaps (md–lg) | Low | phone-only gate + inline fallback everywhere else |

## 14. Files touched

- `components/layout/MorphTabBar.tsx` — `compose` shape + layer + slot + circle
  (DM back-chevron vs sheet-close), width/height/radius/overflow/`items-end`
  overrides, `layerFor`, `COMPOSE_IN_BAR` flag, keyboard lift on the outer wrapper.
- `lib/store/morph-compose.ts` *(new)* — `entries: ComposeEntry[]` (per-owner
  `dismiss: ComposeDismiss | null`) + `slotEl`; topmost wins.
- `lib/hooks/useMorphCompose.ts` *(new)* — `useMorphCompose(active, dismiss)`.
- `lib/hooks/useMediaQuery.ts` *(new)* — shared `useMediaQuery` + `useIsPhone`
  (`max-width: 767px`).
- `lib/hooks/useKeyboardInset.ts` *(new)* — clamped visualViewport keyboard height.
- `components/war-table/Composer.tsx` *(new)* — extracted controlled composer.
- `components/war-table/ThreadRenderer.tsx` — render the controlled `<Composer>`;
  `composeInBar` / `composeDismiss` props; phone gate; portal into the bar slot
  when docked, inline otherwise; list `paddingBottom` + re-pin from `kbInset` and
  the measured slot height.
- `app/(game)/messages/[peer]/page.tsx` — opt in via `composeInBar` and
  `composeDismiss={{ icon: "back", onClick: () => router.push("/messages") }}`.
- `app/(game)/team/_components/team-tab.tsx` — pass `composeInBar={mobileTeamOpen}`
  to the MobileTeamDock `ThreadRenderer` (sheet-close dismiss; no `composeDismiss`).
- `components/shared/BottomSheet.tsx` — **no change** (the list pads its own
  `scrollRef`, never the sheet inner div, so it never double-pads).

## 15. Rollback

The `COMPOSE_IN_BAR` flag lives in `MorphTabBar.tsx` (module constant). Off ⇒
`composeActive` is forced false, the bar keeps its three shapes, and
`ThreadRenderer` renders the controlled `<Composer>` inline (its `dockToBar`
stays satisfiable but `slotEl` never resolves, so it falls back to inline) — i.e.
today's behaviour. Phase 0 (the controlled-composer extraction) is permanent and
safe on its own.
