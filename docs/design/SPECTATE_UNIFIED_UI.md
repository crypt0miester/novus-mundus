# Spectate = the real game, read-only (unified UI)

> **Status:** design / proposed. Supersedes the original dev-todo **#6 "Make spectate
> actually spectate"** (which proposed a live activity feed). The live feed is kept as
> an optional later layer (see [Out of scope](#out-of-scope--later)).

## Intent

Today there are **two parallel UIs**:

- `(game)/*` — the real game shell (TopBar + LeftPanel + RightPanel + MorphTabBar + Cairn),
  gated behind a connected wallet + a registered `PlayerAccount`.
- `/world/*` — a separate, public, read-only browser (WorldShell = WorldHeader + WorldNav):
  realm map, players, teams, cities, leaderboard.

"Spectate the Realms" on the landing page just routes to `/world` — a second, lesser UI.

**Goal:** collapse to **one UI**. Delete `/world`. A spectator (no wallet, or a wallet
with no player) navigates the *real* `(game)` routes — `/map`, `/shop`, `/team`,
`/leaderboard`, `/players`, `/cities`, `/events` — sees the *real* on-chain values, moves
around freely, and is stopped only at the moment of a write (which prompts them to claim a
seat). The browse surfaces that live under `/world` today (players, cities, team detail)
move into `(game)`.

This is a navigation/access change, **not** a gameplay change. No on-chain or SDK work.

---

## Current architecture (what we're starting from)

### Two route trees

| `(game)/*` (gated) | `/world/*` (public) |
|---|---|
| dashboard, map, shop, estate, events, leaderboard, team, cosmetics, messages, settings | page (RealmMap overview), cities + cities/[id], leaderboard, players + players/[address], teams + teams/[id] |

### The list views are already shared components — there is almost no duplication

Every directory/list already lives in `components/world/` and is imported by **both** trees:

| Component | `/world` importer | `(game)` importer |
|---|---|---|
| `RealmMap.tsx` | `world/page.tsx` | `(game)/map/_components/map-tab.tsx` |
| `LeaderboardView.tsx` | `world/leaderboard/page.tsx` | `(game)/leaderboard/page.tsx` |
| `TeamBrowser.tsx` | `world/teams/page.tsx` | `(game)/team/page.tsx` (Browse tab) |
| `PlayerBrowser.tsx` | `world/players/page.tsx` | **none** (world-only) |
| `CityBrowser.tsx` | `world/cities/page.tsx` | **none** (world-only) |

Only three surfaces are **bespoke, inline, and world-only** (no `(game)` home yet):

- `world/players/[address]/page.tsx` — the shareable player profile (~475 lines). The marquee surface.
- `world/teams/[id]/page.tsx` — team detail (~294 lines).
- `world/cities/[id]/page.tsx` — city roster (~216 lines).

So the consolidation is mostly **routing + link rewiring**, not rewrites.

### Two data paths (the crux)

- **Path A — the zustand `useAccountStore`** (`lib/store/accounts.ts`), seeded by
  `startGameSubscriptions(client, publicKey)` (`lib/store/subscriptions.ts`), which is started
  by `SubscriptionBridge` **only when `publicKey` is non-null** (`lib/solana/provider.tsx`).
  → With no wallet, this store is empty forever; `usePlayer()` is stuck `isLoading: true`.
  Powers: player, user, game engine, **shop catalog**, team, estate, cosmetics.
- **Path B — the `useWorld*` react-query hooks** (`lib/hooks/world/*`), which fetch directly
  from the RPC `Connection` with **no wallet**. Dual-mode: read the store if it's seeded,
  else fall back to an RPC scan (`enabled: !hasStore`).
  → Already works for an anonymous visitor; this is what powers `/world` today.
  Powers: cities, players, teams, castles, game engine, **kingdom events list**.

**Implication:** the spectator-ready surfaces (map, leaderboard, teams browse, players,
cities, events) already have a working wallet-less data path. The only global view with
**no** spectator data path today is the **shop catalog** (prices/deals are Path A only).

### The two guards that block spectating (`(game)/layout.tsx:31-42`)

```ts
// Guard A: no wallet → wiped back to the landing page
useEffect(() => { if (!connected && phase === "idle") trigger(exitMessage(), "/"); }, ...)

// Guard B: wallet but no player → force-redirected into /estate onboarding
useEffect(() => {
  if (connected && !playerLoading && !playerData?.exists && pathname !== "/estate")
    router.replace("/estate");
}, ...)
```

There is **no server middleware** and **no SIWS page gate** (SIWS only co-signs War-Table
chat). Gating is entirely these two client effects. The page bodies themselves already
degrade gracefully without a player — `FeatureGate` renders a "Create a Player" `LockedCard`,
`/map` is explicitly built to render wallet-less, `LeftPanel` returns `null`. **Nothing
crashes.** It is only these two redirects that make in-game spectating impossible.

---

## The design

### 1. One capability model: `canAct`

Introduce a single derived notion, `canAct`, and its inverse "spectator", as a shared hook
(`lib/hooks/useCanAct.ts`):

```
canAct = wallet.connected && playerData?.exists === true && !isViewAs
spectator = !canAct
```

Three states collapse under one read-only umbrella:

| State | `connected` | `player.exists` | meaning |
|---|---|---|---|
| **Anonymous spectator** | false | — | browsing with no wallet |
| **Unclaimed spectator** | true | false | wallet connected, hasn't claimed a seat |
| **viewAs** (existing `?viewAs=<pubkey>`) | true (faked) | true | impersonating a real player read-only |
| **Player** | true | true | can act |

`isViewAs` comes from the existing `ViewAsBridge` (`lib/solana/provider.tsx`), which already
renders the whole shell as a pubkey with signing disabled. Folding it under `canAct` means
viewAs stops throwing raw errors on click and instead disables buttons up front — aligning it
with the project's "UI preflight gating" rule (disable + explain, never let users hit a raw
`GameError`).

### 2. Relax the two guards

`(game)/layout.tsx`:

- **Guard A (no wallet → exit):** remove. A wallet-less visitor stays in `(game)` as a
  spectator. (The landing page still exists; spectators arrive via its "Spectate" button.)
- **Guard B (no player → /estate):** soften from a hard `router.replace` to a *soft nudge*.
  Don't trap the user on `/estate`; let them browse, and surface a persistent **"Claim your
  seat"** CTA (in the shell + on write attempts). `/estate` remains the onboarding home,
  reached when they choose to claim. Seeing the realm before committing is better funnel UX.

### 3. Data strategy

Phase the data work so the bulk of spectate ships without touching subscriptions:

- **Now (lean on Path B):** every spectator-facing route except shop already has a wallet-less
  RPC path via `useWorld*`. Relaxing the guards is enough to make map / leaderboard / teams /
  players / cities / events spectatable. No subscription change required.
- **Shop catalog (the one gap):** add a wallet-less RPC fallback mirroring the `useWorld*`
  pattern (`useWorldShop` / dual-mode `useShop*`: read store if seeded, else
  `enabled: !hasStore` react-query). Lets spectators browse prices/deals; buy buttons gate.
- **Later (unify the two paths):** introduce `startWorldSubscriptions(client)` — a
  wallet-independent subscription that seeds the GameEngine + cities + global lists into the
  store **always** (not just when a wallet connects). The player-specific subscription then
  layers on top when a wallet appears. This removes the "store empty without wallet" landmine,
  gives spectators *live* updates, and collapses Path A/B into one. Bigger refactor of
  `subscriptions.ts`/`SubscriptionBridge`; not required for the first ship.

### 4. Route consolidation (delete `/world`, fold into `(game)`)

Mirror the world subtree under `(game)`. The list components move unchanged; only the 3 inline
detail pages relocate and the `/world/...` href strings get rewritten.

| `/world` route | renders | → `(game)` destination | work |
|---|---|---|---|
| `world/page` (overview) | `RealmMap` | **`/map`** (Realm tab already mounts `RealmMap`) | redirect |
| `world/leaderboard` | `LeaderboardView` | **`/leaderboard`** (already shares the component) | redirect |
| `world/teams` | `TeamBrowser` | **`/team`** Browse tab (already shares it) | redirect |
| `world/teams/[id]` | inline team detail | **`/team/[id]`** (new) | move page |
| `world/players` | `PlayerBrowser` | **`/players`** (new) | new route, same component |
| `world/players/[address]` | inline profile | **`/players/[address]`** (new) | move page |
| `world/cities` | `CityBrowser` | **`/cities`** (new) | new route, same component |
| `world/cities/[id]` | inline city roster | **`/cities/[id]`** (new) | move page |

Then rewrite every `/world/...` href. These already render **inside `(game)` too**, so they're
currently cross-tree/dead from the game side — fixing them is overdue regardless:

- `LeaderboardView.tsx` → `/world/players/...`, `/world/teams/...`
- `PlayerBrowser.tsx`, `TeamBrowser.tsx`, `CityBrowser.tsx`, `RealmMap.tsx` (city seal)
- `components/shared/PlayerCard.tsx`, `components/shared/TeamCard.tsx`
- `nav-config.ts` (Leaderboard → `/world/leaderboard`)
- the 3 detail pages' internal links
- `(auth)/page.tsx` "Spectate the Realms" → `/world`

Mechanical mapping: `/world/players` → `/players`, `/world/teams/` → `/team/`,
`/world/cities` → `/cities`, `/world` (overview) → `/map`.

### 5. Unified nav

`nav-config.ts` becomes the single source of truth (it already feeds both `TopBar` and
`MorphTabBar`). Delete `WorldNav` / `WorldHeader` / `WorldShell`.

Proposed nav (one shell, capability-aware):

- **Always visible (browse — works for spectators):** Map, Leaderboard, Players, Teams,
  Cities, Shop, Events.
- **Player-scoped (visible, but show a claim CTA for spectators):** Home/Dashboard, Estate,
  Cosmetics, Messages, Settings.

The nav already supports a disabled state for the no-player case (`disabled = isSuccess &&
!hasPlayer`); extend it so player-scoped items route to the claim CTA instead of dead links,
and so spectator-browseable items are always enabled.

### 6. Write-gating — one seam, 66 sites

`TxButton` (`components/shared/TxButton.tsx`) is the single write primitive (66 call sites).
It already exposes a `disabled` + `opacity-50` + `cursor-not-allowed` explain path; it just
doesn't know about wallet/player today (each call site computes its own `canX`).

- Have `TxButton` call `useCanAct()` internally. When `!canAct`: force `disabled`, and on press
  open the **claim CTA** (connect wallet if anonymous → `/estate` Arrival if unclaimed) instead
  of attempting the tx. One edit gates every write at once.
- Keep `useTransact`'s `if (!wallet.publicKey) throw` as the backstop (`useTransact.ts`).
- Per-tab `canX` predicates stay as-is (they layer on top); `canAct` is the global floor.

### 7. Per-route spectator behaviour

From the data classification:

| Route | Spectator sees | Action |
|---|---|---|
| `/map` Realm | full map, real city/player/team/castle values | **works as-is** (Path B) |
| `/map` Forces | your in-flight rallies/reinforcements | empty state or hide tab |
| `/map` Expedition | — | already `FeatureGate` → LockedCard |
| `/map` Castle | castle list (global); claim/contribute gated | works; actions via `canAct` |
| `/leaderboard` | full leaderboard | **works as-is** |
| `/team` Browse | full teams list | **works as-is** |
| `/team` Team | your team | `FeatureGate` → "claim to form a team" |
| `/players`, `/cities` | full directories + detail | **works as-is** (Path B) once routed |
| `/events` | full event list (participation pill absent) | **works as-is** |
| `/shop` | catalog/prices read-only; buy gated | **needs the RPC fallback** (§3) |
| `/dashboard` | claim hub + realm summary (see decision D1) | repurpose for spectators |
| `/estate` | Arrival / "claim your seat" | already the onboarding home |
| `/cosmetics`, `/messages`, `/settings` | personal | claim CTA / hide from spectator nav |

`LeftPanel` / `LeftPanelMobile` return `null` without a player → the spectator's resource rail
is blank. Replace the `null` with a small **"Spectating — claim your seat"** card so the rail
isn't empty.

### 8. Onboarding + entry points

- **Landing** (`(auth)/page.tsx`): "Spectate the Realms" → **`/map`** (real shell, spectator
  mode) instead of `/world`. Connected-with-player → `/dashboard`; connected-no-player →
  `/estate` (or `/map`, see D1).
- **Claim funnel:** the disabled `TxButton` CTA and the shell's "Claim your seat" both route to
  `/estate` → `Arrival` → `ClaimBeat` (the existing `init_user` + `init_player` +
  `create_estate` bundle). Unchanged — we're just adding more entrances to it.

---

## What gets deleted

- `app/world/` entire subtree (layout, page, cities, players, teams, leaderboard + `[id]`s) —
  after their detail pages move to `(game)`.
- `app/world/_components/world-shell.tsx`.
- `components/layout/WorldHeader.tsx`, `components/layout/WorldNav.tsx`.
- The original #6 placeholder behaviour ("Spectate → `/world`").

`components/world/*` (the shared list components and `RealmMap`) **stay** — only the route
tree named `/world` goes; the `world` component namespace is unrelated.

---

## Phasing

**Phase 0 — unblock + redirect (small, high value).** Add `useCanAct`; relax Guard A and
soften Guard B; wire `TxButton` to `canAct`; redirect `/world` (overview) → `/map`,
`/world/leaderboard` → `/leaderboard`, `/world/teams` → `/team`. Point landing "Spectate" at
`/map`. Ships spectating for map/leaderboard/teams/events immediately.

**Phase 1 — move the world-only surfaces.** Create `(game)/players`, `(game)/players/[address]`,
`(game)/cities`, `(game)/cities/[id]`, `(game)/team/[id]`; move the 3 inline detail pages;
rewrite all `/world/...` hrefs; update `nav-config.ts`; delete `WorldNav/WorldHeader/WorldShell`
and the `/world` tree.

**Phase 2 — close the data gaps.** Shop catalog RPC fallback; `LeftPanel` spectator card;
`/dashboard` spectator view (per D1). Optionally start the `startWorldSubscriptions` split for
live spectator data.

**Phase 3 — polish / optional.** The original #6 live activity feed, pinned to `RealmMap`
(pulse the city where an attack/rally/dungeon/encounter happened), now that the map is the
shared spectator home.

---

## Open decisions

- **D1 — what is `/dashboard` for a spectator?** Options: (a) a "claim your seat" hub + the
  ungated `GameInfoPanel` realm summary; (b) redirect spectators' default landing to `/map`
  and keep `/dashboard` player-only. Recommendation: (a), so `/dashboard` reads as "the realm
  / your realm" for both audiences.
- **D2 — personal nav items for spectators:** disable-with-claim-CTA (visible, teaches what
  they'd unlock) vs hide entirely. Recommendation: disable-with-CTA for Estate/Dashboard
  (aspirational), hide Messages/Settings/Cosmetics (meaningless empty).
- **D3 — data depth now:** ship on Path B + shop fallback (Phase 0-2) vs do the
  `startWorldSubscriptions` split up front. Recommendation: Path B now; split later only if
  spectators need live updates or more Path-A views.
- **D4 — share links:** `world/players/[address]` is a shareable profile URL today. Preserve
  the capability at `players/[address]` and add a redirect from the old `/world/...` URLs so
  existing links don't 404.
- **D5 — connected-no-player default:** land them on `/estate` (claim now) or `/map` (look
  first)? Recommendation: `/map`, with a prominent claim CTA — "look first" converts better.

---

## Out of scope / later

- The original #6 **live realm activity feed** (streamed attacks/rallies/dungeon
  clears/encounters across all cities, pinned to `RealmMap`). The event pipeline already exists
  (`lib/store/events.ts`, `lib/events/classify.ts`, `lib/events/format.ts`,
  `components/shared/ActivityFeed.tsx`); the city account exposes `activeEncounters` /
  `totalEncountersSpawned`. This is a clean Phase-3 layer on the unified map — it needs a
  realm-wide event subscription strategy, so it stays deferred.
- No on-chain, SDK, or gameplay changes. Spectate is purely client navigation + access.

---

## File-touch checklist

- `app/(game)/layout.tsx` — relax Guard A, soften Guard B.
- `lib/hooks/useCanAct.ts` — **new**: `connected && player.exists && !isViewAs`.
- `components/shared/TxButton.tsx` — consume `useCanAct`, claim CTA on press when spectator.
- `lib/solana/provider.tsx` — expose `isViewAs` to `useCanAct`; (Phase 2) `startWorldSubscriptions`.
- `lib/store/subscriptions.ts` — (Phase 2) split world vs player subscriptions.
- `lib/hooks/world/useWorldShop.ts` (or dual-mode `useShop*`) — **new**: spectator shop catalog.
- `components/layout/nav-config.ts` — unified nav; `/world/leaderboard` → `/leaderboard`.
- `components/layout/{TopBar,MorphTabBar,LeftPanel}.tsx` — capability-aware nav + spectator rail card.
- **New routes:** `app/(game)/players/{page,[address]/page}.tsx`,
  `app/(game)/cities/{page,[id]/page}.tsx`, `app/(game)/team/[id]/page.tsx`.
- **Move + rewrite links:** the 3 inline detail pages from `world/` into `(game)`.
- **Rewrite `/world` hrefs:** `LeaderboardView`, `PlayerBrowser`, `TeamBrowser`, `CityBrowser`,
  `RealmMap` (city seal), `PlayerCard`, `TeamCard`.
- `app/(auth)/page.tsx` — "Spectate" → `/map`; connected routing per D5.
- **Delete:** `app/world/**`, `world/_components/world-shell.tsx`,
  `components/layout/{WorldHeader,WorldNav}.tsx`.
- Add redirects `/world/*` → new paths (D4) so existing links survive.
