# Web UI — Feature Gap Tracker

Gap analysis of `apps/web` against the on-chain program (24 systems) and the
`novus-mundus-ts` SDK (~190 `create*Instruction` builders).

**Status at scan:** ~111/181 player-relevant instruction builders are wired into
the UI. 23/24 systems have at least some UI; **Event has none**.

How to use: work top-down by priority. Check items off as the UI lands. Items
marked _(verify)_ may be intentionally server-side/automatic — confirm before
building.

---

## P1 — Event system UI

**Status: built** (typecheck-clean; runtime-unverified). New `(game)/events`
route with Active/History tabs; an "Events" entry was added to nav `SECONDARY`.

- [x] **Event list / detail view** — `events/_components/event-card.tsx` +
      `events-list.tsx`: name, status, prize, start/end, participants, top-10
      leaderboard, the player's own participation row.
- [x] **Join event** — `createJoinEventInstruction` wired.
- [x] **Finalize event** — `createFinalizeEventInstruction` wired (permissionless;
      shown for events past `endTime` still Active/Pending).
- [x] **Claim prize** — `createClaimPrizeInstruction` wired; SPLToken prizes pass
      `prizeTokenMint`, the event-PDA vault ATA, and the winner's wallet ATA.
- [ ] Admin `createCreateEventInstruction` — still CLI-only (see P4).

---

## P2 — Player-facing actions missing from existing screens

These systems have UI, but specific player actions aren't wired. Each row is one
SDK builder with no call site in `apps/web/src`.

| Action | Builder | Lives in | Notes |
|---|---|---|---|
| Daily login reward claim | `createClaimDailyRewardInstruction` / `createDailyClaimInstruction` | `dashboard` | Dashboard shows daily rewards read-only; claim not wired. |
| Arena direct challenge | `createChallengePlayerInstruction` | `combat` → arena-tab | Only season join is wired; 1v1 challenge missing. |
| Dungeon: choose relic | `createChooseRelicInstruction` | `combat` → dungeon-tab | Relic pick during a run — player decision, unwired. |
| Dungeon: resume run | `createResumeInstruction` | `combat` → dungeon-tab | Resuming an in-progress dungeon. |
| Dungeon: leaderboard prize | `createClaimLeaderboardPrizeInstruction` | `combat` → dungeon-tab | Dungeon leaderboard payout. |
| Transfer cash to player | `createTransferCashInstruction` | `economy` | P2P cash transfer — no UI. |
| Equip item | `createEquipInstruction` | `inventory` / `estate` forge-tab | Equipping crafted/owned equipment. _(verify — equip may flow through `createUpdateLoadoutInstruction`)_ |
| Assign defensive hero | `createAssignDefensiveHeroInstruction` | `combat` → heroes-tab | Slotting a hero to defense. _(verify vs. existing hero slotting)_ |
| Join a rally | `createRallyJoinInstruction` | `team` → rally-tab | Joining someone else's rally. _(verify vs. create/execute flow)_ |
| Close own rally | `createRallyCloseInstruction` | `team` → rally-tab | _(verify)_ |
| Accept team invite | `createTeamAcceptInviteInstruction` | `team` → team-tab | Invites can be *sent* (`createTeamInviteInstruction` wired) but not accepted in-UI. |
| Decline team invite | `createTeamDeclineInviteInstruction` | `team` → team-tab | Same. |
| Join team directly | `createTeamJoinInstruction` | `team` → browse-tab | Join an open team without invite. _(verify)_ |

> Highest confidence / impact: **team invite accept/decline** (an invited player
> currently has no way to accept), **daily reward claim**, and **arena challenge**.

**Status: 6 of the 13 wired this pass** (typecheck-clean; runtime-unverified —
`apps/web` has no e2e suite). Done: daily login reward claim (dashboard
`DailyRewardCard`), transfer cash (economy "Send Cash" tab → `SendCashPanel`),
equip item (forge-tab "Equip Gear" card), assign defensive hero (heroes-tab
locked-hero panel), close own rally (rally-tab action bar), join team directly
(`TeamBrowser` — the dead `?join=` link is now a `TxButton`). Join-a-rally and
accept/decline-invite were already covered by P2a.

**Deferred — blocked, not skipped:**

- **Arena direct challenge** (`createChallengePlayerInstruction`) and **dungeon
  choose-relic** (`createChooseRelicInstruction`) require the off-chain
  `game_authority` to *co-sign* the transaction. `apps/web` has no backend, and
  `useTransact` has no path to carry a server-held signer — so these cannot be
  produced client-side. They need a backend endpoint that builds and
  game-authority-signs a `VersionedTransaction` for the client to relay.
- **Dungeon resume / leaderboard prize** — same backend dependency (`resume`'s
  `firstRoomType` and the leaderboard `weekNumber` are server-derived).
  Separately, the *already-shipped* `dungeon-attack` / `flee` / `claim` calls are
  missing required accounts (`gameAuthority` signer; `heroMint`) — a latent
  on-chain bug hidden by the `FlexIxBuilder` cast in `sdk.ts`. The dungeon
  backend + account wiring should be fixed before adding more dungeon actions.

### P2a — Display gaps: action wired, but the target list is never rendered

A whole class of "act on another account" flows are broken the same way: a
handler exists (or the builder is imported) but the UI never renders the list
of accounts to act on — so the user must guess wallet addresses or simply
can't act. An instruction-centric scan misses these. The relevant zustand store
maps are already populated (`lib/store/accounts.ts` + `subscriptions.ts`);
they're just never read by the screen.

| Flow | Component | What's missing |
|---|---|---|
| Incoming team invites | `team-tab.tsx` | Only *sent* invites are shown (to cancel). Incoming invites land in the `teamInvites` store map but no accept/decline list is rendered. |
| Rally join | `rally-tab.tsx` | Only the player's *own* rally is shown. No list of joinable team rallies → `createRallyJoinInstruction` unreachable. |
| Reinforcements | `reinforce-tab.tsx` | Manual "Target Player Address" text input only (`:206`). No list of in-flight reinforcements → recall/relieve/process-arrival need guessed addresses. |
| Castle garrison | `castle-tab.tsx` | Garrison shown as a count only. No roster → relieve/claim-loot use a manual wallet input (`:541`). |
| Castle court | `castle-tab.tsx` | Court slots show "Occupied/Vacant" but never *who*. Appoint/dismiss use manual address input. **Bug:** Dismiss is hardcoded to `publicKey` (self) instead of the target — `castle-tab.tsx:176`. |
| Treasury requests | `team-tab.tsx` | No pending-request list (detail below). |

Fix shape for all: read the relevant store map, render a list, pass the chosen
account into the existing handler.

**Treasury requests (detail):** `team-tab.tsx` never reads the `treasuryRequests`
store map even though `subscriptions.ts` streams `TreasuryRequest` accounts for
the player's team. `handleTreasuryApprove`/`handleTreasuryReject`
(`team-tab.tsx:432`, `:446`) are defined but never called — no JSX triggers
them. Execute/Cancel (`:795`/`987`) act on the caller's own request but show no
amount, status, or cooldown — so a solo leader who hit the request flow
(deposit → `requestWithdraw` when the amount exceeds the instant limit)
executes blind.

_(Arena challenges are **not** a display gap — challenges are assigned by the
game authority and not stored in the client store; that's architectural.)_

**Status: all 6 fixed** (typecheck-clean; runtime-unverified — `apps/web` has no
e2e suite). Also fixed a latent bug found along the way: `handleTreasuryApprove`
was missing the `requesterSlotIndex` account field (hidden by the `FlexIxBuilder`
cast in `sdk.ts`).

- [x] Treasury requests: `TreasuryRequestsPanel` renders pending requests
      (requester / amount / cooldown), Approve/Reject per row; Execute/Cancel
      gate on the caller's own request.
- [x] Incoming team invites: accept/decline card in the no-team view.
- [x] Rally join: "Joinable Team Rallies" card, `createRallyJoinInstruction` per row.
- [x] Reinforcements: in-flight list (sent + received) replacing the typed-address card.
- [x] Castle garrison: member roster with per-row Relieve.
- [x] Castle court: holder roster; Dismiss self-target bug fixed (now passes the
      member's resolved wallet).

---

## P3 — Stubs & placeholders in shipped UI

- [ ] **Team chat** — "coming soon" placeholder.
      `app/(game)/team/_components/team-tab.tsx:739` and `:934` (two variants).
      _Deferred_ — real-time chat needs a backend (websockets / a chat service);
      it is not an on-chain instruction wire.
- [x] **Arena season authority hardcoded** — fixed. `arena-tab.tsx`
      `handleJoin` / `handleClaimDailyReward` / `handleClaimMasterReward` now pass
      `season.authority` from the fetched season account instead of `publicKey`.

---

## P4 — Admin / GM tooling: no surface at all

~70 builders are admin/config/maintenance (`createCreate*`, `createUpdate*`,
`createInit*`, season/sale/template setup, cleanup jobs, `createMintForPrize`,
`createForceRemoveKing`, terrain seeding, etc.). None are exposed in `apps/web`.

- [ ] Decide whether admin tooling belongs in this app (gated route), a separate
      internal console, or stays CLI-only. Currently CLI-only via `sdks/.../cli`.

---

## Per-system coverage

| System | Coverage | Gap |
|---|---|---|
| Event | 🟢 Wired | `(game)/events` route built — see P1 (admin create still CLI-only) |
| Progression | 🟢 Wired | Daily reward claim wired (dashboard) |
| Arena | 🟢 Wired | Season-authority bug fixed; direct challenge needs a game_authority backend |
| Dungeon | 🟡 Partial | choose-relic/resume/leaderboard need a game_authority backend; attack/flee/claim missing required accounts (latent bug) |
| Economy | 🟢 Wired | `transferCash` wired (economy "Send Cash" tab) |
| Hero | 🟢 Wired | `assignDefensiveHero` wired |
| Forge | 🟢 Wired | `equip` wired |
| Rally | 🟢 Wired | `rallyJoin` (P2a) + `rallyClose` wired |
| Team | 🟢 Wired | Invites + treasury requests fixed (P2a). Remaining: chat stub (P3) |
| Castle | 🟢 Wired | Garrison/court rosters + Dismiss bug fixed (P2a) |
| Combat | 🟢 Wired | Player actions complete |
| Estate | 🟢 Wired | Complete |
| Expedition | 🟢 Wired | `expeditionStrike` _(verify)_ |
| Research | 🟢 Wired | Complete |
| Sanctuary | 🟢 Wired | Complete |
| Shop | 🟢 Wired | Complete (admin config separate) |
| Subscription | 🟢 Wired | Complete |
| Travel | 🟢 Wired | Complete |
| Token | 🟢 Wired | Complete |
| Name | 🟢 Wired | Complete |
| Loot | 🟢 Wired | Complete |
| Reinforcement | 🟢 Wired | Complete |
| Encounter | 🟡 Read-only | Attack wired; `spawnEncounter` likely server-side |
| Initialization | 🟢 Wired | Player onboarding wired; game/city setup is admin (P4) |

_Generated by scan — re-run if the SDK or `apps/web` changes substantially._
