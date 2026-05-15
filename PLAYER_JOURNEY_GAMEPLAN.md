# Player Journey Game Plan — Novus Mundus

> **From a claimed ruin to a contested crown — a journey narrated by one voice.**

**Status**: Design — approved direction, not yet implemented
**Scope**: Web app only (`apps/web`). No program changes.
**Date**: 2026-05-15
**Companion docs**: `docs/WORLD_LORE.md` (the world bible), `docs/onchain/02-player-journey/` (the technical specs this dramatizes)

---

## 1. Why this doc exists

Novus Mundus has **24 systems and 181 on-chain instructions**. It has a genuinely strong world bible. What it does not have is a **journey** — a felt arc that carries a player from their first minute to their hundredth, that gives every screen an emotional reason to exist, and that makes them *want to come back*.

Right now the game is a skeleton. Every screen is competent CRUD: onboarding is a city-picker form, "finding a team" is a sortable table, the market is number inputs, the castle is `<select>` dropdowns for appointing a "Court." The systems work. Nothing *feels*.

This plan fixes that — not by adding mechanics, but by adding **connective tissue**: a personal arc, a single narrating character, and per-system emotional framing. It then redesigns the web app flow to deliver that journey.

---

## 2. What we're working with (the diagnosis)

Five findings from a full scan of the lore, the program, and the web app:

1. **The world bible is strong — and already wrote our opening.** `docs/WORLD_LORE.md` is a real story bible: a post-cataclysm world (the *Sundering* broke the old civilization *Aeondral*, which bled the world dry mining *Novis*). It explicitly assigns the player an identity — *"You are no one important… a survivor… a lord of nothing, with everything to gain."* Section XII contains **finished** onboarding text, encounter flavor, and estate-reveal copy. **None of it is wired into the game.**

2. **The app contradicts the bible.** Onboarding opens with **"WELCOME, WARRIOR"**; loading and transition screens crown the player a *King*, a *legend*, a *"Mythic King"* from the first second. The grounded survivor — the most distinctive thing in the lore — exists nowhere in the product.

3. **A journey already exists in the code — switched off.** `programs/novus_mundus/src/state/estate.rs` lays out **Chapter 1: Foundation → Chapter 2: Expansion → Chapter 3: Mastery** in comments, with per-building unlock gates. Every gate is hardcoded to `0` *"during SDK development for testability."* The skeleton of this journey is already in the codebase, disabled.

4. **The only narrative surface is two transient places.** All "story" lives in the 1.2s transition wipe (`src/lib/store/transition.ts`) and the tiered loading labels (`LoadingSequence.tsx`). Every gameplay screen has zero story.

5. **`TOWN_SOUL_DESIGN.md` exists in the repo — 0 bytes.** Someone already knew this was the gap and named the file. It was never written. This document is its answer.

**The raw materials are better than they look.** There is a world, a player identity, a dormant 3-chapter spine, and pre-written flavor. The work is connective tissue, not invention.

---

## 3. Design decisions (locked)

Four pillars, settled. Every choice in this plan descends from them.

| # | Decision | What it means |
|---|----------|---------------|
| 1 | **Ascent from ash** | The player starts powerless and grounded. The journey *is* the rise: survivor → lord → king. Tone escalates with progress. This reconciles the bible, the castle endgame, and the existing `data-tier` theme escalation. The app's premature "King/legend" copy is removed; the crown becomes something **earned in Act V**, and only then *true*. |
| 2 | **One voice — the Steward** | A single narrating character frames the entire game: the Steward of your estate. Not a cast. Not a chosen-one mentor. One weathered companion who was already living in the ruins when you arrived. |
| 3 | **Web app only** | The journey lives entirely in `apps/web` — copy, characters, flow, framing, a reframed quest system. **Zero program changes.** The dormant on-chain gates stay dormant (revisiting them is a noted future option, §11). |
| 4 | **The estate lives** | The primary narrative reason to return is that your holding is a living place with ongoing situations — and the Steward is always there with news. The comeback hook and the narrating voice are the same thing. |

---

## 4. The Steward

The Steward is the spine of the entire journey. Get this character right and every screen inherits a soul.

### Who they are

When you claim your patch of ruin, **you are not the first person to stand there.** An old survivor already lives in the wreckage — too tired, too cautious, or too scarred to rebuild it themselves, but they know this ground. They have watched would-be lords come up the road, count their imagined gold, and fail. When you drive your stakes in and *stay*, the Steward does not leave. They stay, and they start calling you *"my lord"* — at first half in irony, because you have nothing.

The Steward is the embodiment of the bible's Unwritten Rule #4: **"Power comes from people, not magic."** Your first and most loyal subject is a person who chose you.

### Voice

Weathered, dry, unsentimental, quietly loyal. Speaks in plain, hard images. Never a cheerleader, never servile. Has seen enough to be skeptical and enough to still hope. Practical wisdom delivered flat.

### The "my lord" through-line — the emotional spine

The Steward calls you *"my lord"* from minute one. It is **the running thread of the whole journey**:

- **Act 0–II:** said dryly, almost a joke — you are a lord of mud and rubble.
- **Act III:** said with the first trace of belief.
- **Act V (the payoff):** the Steward finally admits, openly, that they did not mean it at the start — and that they mean it now.

One phrase, repeated across a hundred hours, that *changes meaning* as the player climbs. That is the journey, compressed into two words.

### Sample lines (voice reference for writers)

> **Arrival —** "I've watched a dozen of you come up that road. Chins up, eyes already counting the gold. They're not here anymore. You're still standing in the mud. I'll take that as a good sign, my lord."

> **First building completes —** "A roof. Walls that meet at the corners. Yesterday this was a place people *died* in. Don't get sentimental. Don't pretend it's nothing, either."

> **New-player protection ends —** "The quiet's over. Word's gone round that there's something here worth the walk now. That's what you wanted — to be worth taking. Hard to complain now it's arrived."

> **A costly defeat —** "You'll lose people. Not numbers. People — the ones who came because they believed you could keep them. Remember that next time it feels cheap to spend them."

> **Finding a House (Act III) —** "You've built as far as your own two arms reach. Everything past this you'll have to be *given* — and given means owed. A House isn't friends, my lord. It's debts you've chosen carefully."

> **The name reveal (Act III intimacy beat) —** "You've never asked my name. Good — meant you had work to do. I had a holding once, past Vraenholdt. Built it the way you're building this. I'll tell you how I lost it some night you can afford the story."

> **The Crown (Act V payoff) —** "I've called you 'my lord' since the day you arrived with empty hands. I'll say a thing now it can't cost me: I didn't mean it then. Habit, mostly. Pity, a little. I mean it today. Wear the thing. You climbed for it."

> **Every return (the comeback engine) —** "You're back. Good — the place doesn't run itself, whatever the songs say. While you were gone—"

### The Steward's own arc

The Steward is not static set-dressing. They had a holding once and lost it (revealed in Act III). This does three things: it deepens "power comes from people," it quietly seeds the bible's "history repeats" theme, and it makes the Steward's loyalty a *choice* with a cost — they are helping you succeed where they failed. The name-reveal beat is a deliberate **intimacy reward** for reaching Act III: the relationship itself progresses.

---

## 5. The Arc — six acts

The player's personal arc mirrors the kingdom's macro-arc (the bible's three **Ages**: Ashes → Crowns → Dominion). It expands the dormant `estate.rs` 3-chapter skeleton — Foundation and Mastery are kept by name; the Arrival, First Blood, The House, and The Crown are the new connective acts.

| Act | Kingdom Age | Systems it covers | Player's state | The turn (inciting beat) | The payoff |
|-----|-------------|-------------------|----------------|--------------------------|------------|
| **0 — The Arrival** | Ashes | account + estate creation, city choice | Nothing. Just arrived. | You stop walking. You drive your stakes. | The ruin is *yours*. The Steward stays. |
| **I — Foundation** | Ashes | estate ch.1 (Mansion, Barracks, Workshop, Vault, Camp), hiring units, daily claim | Alone, building | The first building completes | A holding that keeps the rain off. The first people take *you* in. |
| **II — First Blood** | Ashes | travel, combat, encounters, stamina, Academy/research begins | Tested by the world | New-player protection ends — the world notices you | You survive your first real fight. You've earned a place on the map. |
| **III — The House** | Crowns | teams, rally, reinforcements, inventory/shop, research deepens | At the ceiling of solo play | The extension chain forces it — you cannot rise alone | An oath sworn. You're in a House. The Steward tells you their name. |
| **IV — Mastery** | Crowns | heroes, forge, dungeon (Catacombs), arena, sanctuary | A known name | Your first hero locked into a slot | Legendary arms, the Catacombs cleared, an arena rank. The kingdom reckons with you. |
| **V — The Crown** | Dominion | castle, court, garrison, endgame | A power | A castle stands vacant. You can take it. | A crown. A court of your own people. The Steward's "my lord", finally meant. |

**Act V does not end the game.** The crown is contestable (bible: "the real enemy is other players"). The endgame loop is *defending* the climb: rivals rise, the Ages turn, new kingdoms launch. The journey graduates into the persistent sandbox — but the player arrives there having *felt* every step.

### How the acts gate

The acts are **descriptive, not enforced** (web-only scope). They are inferred client-side from existing on-chain state the app already reads:

- **Estate extension bitmap** (`PlayerAccount.extensions`) — the Research → Inventory → Team → Rally → Heroes → Cosmetics → Court chain already forces the social detour that defines Act III.
- **Estate building levels** — Mansion/Barracks (Act I), Academy/Stables (Act II), Citadel (Act III), Forge/Arena/DungeonEntry/MeditationChamber (Act IV).
- **Castle ownership** (Act V).

A small client-side helper (`deriveAct(player, estate, castles)`) reads these and returns the current act. No new data, no contract change.

---

## 6. The systems, retold

Each system the user flagged, transformed from CRUD into a place in the world. Pattern for each: **Current** (what it is now) → **Reframe** (what it becomes) → **First beat** (the moment that introduces it) → **Lives by** (how it stays alive on return).

### 6.0 The structural fix — every action at its building

One structural correction the rest of §6 depends on.

Today the **Estate** is the hub: it opens every other screen as an in-page "feature view." But one of those feature views — the **Market** (`market-tab.tsx`) — is an overloaded grab-bag. Five unrelated activities are glued together only because they all spend NOVI:

```
TODAY
ESTATE ─ the hub (home base; opens every system below)
   ├─ Market ─── Hire · Equip · Collect · Stamina · Vault   ← grab-bag
   ├─ Academy ── Research
   └─ Forge · Sanctuary · Infirmary · Workshop
```

That grab-bag is *why the Market has no feel* — it is a menu, not a place — and *why hiring has no story of its own*: it is one toggle button of five. The fix: **unbundle**. Every action moves to the building it thematically belongs to.

```
REDESIGNED
ESTATE ─ the hub
   ├─ Barracks ──────── hire soldiers      "people come to your gate"
   ├─ Camp ──────────── hire workers
   ├─ Mine / Farm / Dock ─ collect          "your people work the land"
   ├─ Market ────────── trade & equip       "the holding touches the world"
   ├─ Vault ─────────── store & hide cash
   ├─ Academy ───────── Research
   └─ Forge · Sanctuary · Infirmary · Workshop
```

This is not a new architecture: the feature-view pattern already exists; only six buildings use it. Unbundling extends the same pattern to the Barracks, Camp, Mine, Farm, and Dock, and retires the orphaned `/economy` route (§7.8) that today duplicates Collect/Stamina/Vault. Each action happens where it belongs — and each becomes a place with room for its own story.

### 6.1 The Estate — *home, and the hub of the game*

The estate page is the most important screen in the redesign. It is **home** — where the player lands after the Arrival and returns every session — and the **hub**: every building opens its own feature view, so roughly a third of the game's surface is reached through this one screen.

- **Current:** `estate/page.tsx` — a grid of 18 building cards in 5 color-coded category groups, terse function labels ("Recruit defensive units"), a header stat-strip. No fiction, no sense of place. The biggest "no feel" offender in the app.
- **Reframe:** the estate is a *holding*, not a grid — the physical proof of the climb (the bible: *"your anchor… the physical manifestation of everything you've built"*). It is laid out as the player's **land**: the 5 plots they can own, each holding 4 building slots, rendered as parcels — claimed plots show their buildings, unclaimed plots read as *"land beyond your claim."* The holding visibly fills, plot by plot.

  > **Layout decision (locked):** the **plot-parcel** grouping — moderate build, no new art. A fully illustrated "spatial" holding view is the *same model rendered richer*, kept as a later upgrade; the structural design below is identical either way.

**What the player does on the estate page — three loops:**

1. **Build the holding** (the journey, made physical): establish the estate (Act 0); buy land plots (5 total, ~free → ~1.8M NOVI, each a visible extension of the claim); build / complete / upgrade buildings; speed up construction with gems.
2. **Run the holding day to day** (the comeback loop): daily claim + streak (the Steward keeps the books; milestones at 7/14/30/60/90/180 days); the daily rounds — the `daily_activity` mini-games in 3 time windows (Dawn/Midday/Dusk), reframed as "the work of the day"; recover wounded units (Infirmary); convert materials (Workshop).
3. **Enter the deeper systems:** each building opens its feature view — Barracks/Camp (hire), Mine/Farm/Dock (collect), Market (trade), Academy (research), Forge, Sanctuary, Infirmary, Workshop.

**The four levers that turn a grid into a place:**

1. **The Steward's hearth, up top.** The player lands and the Steward greets them with the Report — what changed while they were away (§8). The comeback engine lives here.
2. **The estate has a mood** — *raw / working / thriving / threatened* — driven by real state (construction, happiness, attacks). Same data, the page *reads* different. Cheapest, highest-impact feel lever.
3. **Buildings as beats.** The chapter-defining buildings get a moment when raised; the dormant `estate.rs` comments already wrote the hooks — Mansion "the first building," Vault "secure your wealth," MeditationChamber "recruit your first hero," Citadel "lead your first rally."
4. **Upgrades reveal history.** The world is "the corpse of the old one." Each upgrade *digs deeper* and uncovers what the estate is built on (the world bible's section XII idea — "the foundation wasn't a house, it was a courthouse; the cells are still intact below"). Upgrading becomes discovery, not a stat bump.

**The chapter band.** The estate buildings *are* the journey's spine (Foundation → Expansion → Mastery). The page shows which chapter the player is in and what the next building means, in the Steward's voice — the estate page and the Chronicle (§7.4) are the same story told two ways.

- **First beat:** Act 0 — the player stands on the ruin; the Steward names what it could be.
- **Lives by:** the Steward's Report on every return; the estate visibly changes mood and fills with buildings.

> **Recommendation:** the estate becomes the screen the player *lands on* — the true home base. The current `/dashboard` (Power, Treasury, Net Worth, Activity Feed) folds into the estate's header or slims to an optional quick-glance. A thread to settle during Phase 2.

### 6.2 Hiring — *taking people in* — at the Barracks & the Camp

- **Current:** buried as the "Hire" toggle inside the Market grab-bag — number inputs that increment army counters.
- **Reframe:** hiring unbundles to **two places**, because there are two kinds of people. **Soldiers are recruited at the Barracks; workers (operatives) at the Camp.** Units are not numbers — they are survivors who attach to a lord who can feed and protect them. The happiness/abandonment system already in the program *is this story*: people lose faith and leave. Hiring is *"word has spread that someone at your holding is building — and people are walking here to find out."* Soldiers come to fight; workers come to labor — two different arrivals, two different rooms.
- **First beat:** Act I — the first recruits reach the Barracks; the Steward: *"They came because they heard. Don't make a liar of the rumor."*
- **Lives by:** happiness surfaced as the morale of cohorts; abandonment reported by the Steward as people *leaving*, not a stat ticking down.

### 6.3 Collecting — *your people work the land* — at the Mine, Farm & Dock

- **Current:** the "Collect" toggle inside the Market grab-bag — four collection cards (Cash, Mining, Fishing, Farming) over number inputs.
- **Reframe:** collection unbundles to the **production buildings** — the player gathers where the land-work happens: ore at the **Mine**, crops at the **Farm**, the catch at the **Dock**. Collection is operatives going *out* and bringing the world *back*; each building's feature view reads as a **ledger of what went out and what came home**, not a calculator. The Steward tallies the haul.
- **First beat:** Act I/II — the first operatives return from the field; the Steward counts the take.
- **Lives by:** "what your people brought back while you were away" folds into the Steward's Report.

### 6.4 The Market — *where the holding touches the world*

- **Current:** `market-tab.tsx` — the 5-in-1 grab-bag (Hire/Equip/Collect/Stamina/Vault). After unbundling: Hire → Barracks/Camp (§6.2), Collect → Mine/Farm/Dock (§6.3), Vault → the Vault building.
- **Reframe:** stripped to what it actually is — **trade**. The Market is where the holding *buys*: weapons, armor, equipment — its one window onto outside commerce. Freed of the grab-bag, it can finally be a *place* — a real market, merchants, the caravan road — instead of a junk drawer. (Stamina, the lone leftover, is minor: fold it into the Market as "provisions" or surface it on the player card; decide in Phase 3.)
- **First beat:** Act II — the first equipment bought; the holding can now arm what it recruits.
- **Lives by:** the caravan and its wares arrive on their own cadence — see §6.7 for the strict line between the Market's in-world commerce and the Shop's real-money offers.

### 6.5 The House — *finding a team* (the one the user flagged hardest)

- **Current:** `/team` → "Browse" → `TeamBrowser.tsx` — a search box, a "Public only" checkbox, a sort dropdown, a grid of cards. Joining is a link. The chat is a *"coming soon"* stub.
- **Reframe:** In the bible, *"a House is a claim to legitimacy."* This is **Act III**, and it has a thesis the Steward delivers: *you have built as far as one lord alone can reach.* The TeamBrowser becomes **"The Houses of [Kingdom]"** — each team is a House with a banner, a seat, a reputation. Member count → *sworn blades*; treasury → *war-chest*; age → *how long the banner has flown*. **Joining a House is an oath** — a real ceremonial moment (use the transition system, §7). The "Create a Team" empty-state card becomes *"Raise your own banner."* The chat stub becomes **the war-table**.
- **First beat:** Act III opens — the Steward: *"A lord with no House is just a man with a large house."*
- **Lives by:** your House's deeds (rallies, members joining, treasury moves) reported by the Steward on return.

### 6.6 The Castle — *the crown*

- **Current:** `map/_components/castle-tab.tsx` — castle-index selectors, a `<select>` for court positions, **raw wallet-address text inputs** to appoint a Court. The most kingdom-themed feature with the least kingdom feeling.
- **Reframe:** **Act V.** The castle is a *seat of power*. Claiming it is a **coronation** — the single most cinematic beat in the game (full-screen interstitial). The Court is not a dropdown — it is *your people taking seats*: you name House-mates you already know to Advisor/Marshal/Scholar/Guardian/Treasurer. The wallet-address input is replaced by picking from your known allies (this also fixes the self-target bug `UI_GAPS.md` flags at `castle-tab.tsx:176`). Castle status (Vacant/Contest/Protected/Vulnerable) becomes the castle's *condition*, narrated — "the walls are quiet," "banners on the horizon."
- **First beat:** Act V — a castle stands vacant; the Steward, for once, says nothing and lets you decide.
- **Lives by:** the crown is *contestable* — the Steward's Report carries the weather of the realm. This is where the comeback hook turns from "tend your home" to "hold your throne."

### 6.7 The Shop — *the caravan* (handle with care)

- **Current:** `shop/page.tsx` — an e-commerce catalog + a SaaS-style subscription pricing table.
- **Reframe:** The Shop is **the caravan** — outside merchants and charters that reach your holding. Subscriptions are *a patron's charter*: backing that accelerates your estate (the bible already says subscriptions "accelerate but don't guarantee").
- **Hard rule — the ethics line:** The narrative must **never** weaponize the comeback hook to upsell. The Steward reports on your *estate*, never on *sales*. The Steward never guilt-trips, never creates false urgency, never says "you should buy." The caravan is an opportunity that arrives; it is never a story beat the player is pushed toward. Flash-sale countdowns stay in the Shop and out of the Steward's mouth. **The Steward's loyalty is to the player, not to revenue.**
- **First beat:** Act II/III — the first caravan reaches a holding now worth visiting.
- **Lives by:** the caravan comes and goes on its own cadence; the Steward mentions it neutrally, at most.

---

## 7. The web app flow, redesigned

Current funnel: **Landing → 1.2s transition wipe → bare city-picker form → dashboard with a TODO checklist.** Every screen thereafter is CRUD.

Redesigned funnel, screen by screen:

### 7.1 Landing — `app/(auth)/page.tsx`
- **Now:** "Conquer kingdoms. Forge empires. Command armies."
- **Redesign:** Re-voice in the bible's register — the grounded survivor, not the conqueror. Keep the "Spectate the Realm as a Peasant" link (it has charm). The connect button leads into the Arrival, not straight to the dashboard.

### 7.2 The Arrival — replaces `components/onboarding/OnboardingFlow.tsx`
The single biggest first-impression change. The current onboarding is one screen: "WELCOME, WARRIOR" + a 5-column city grid + "Enter {city}." Replace it with a short, paced narrative sequence (built on the existing `TransitionOverlay` + `LoadingSequence` machinery — already the richest narrative tech in the app):

1. **The world** — the bible's finished onboarding text, surfaced at last: *"The old world fell. You don't remember it — no one alive does…"*
2. **The choice** — *where you make your stand.* The same city pick, but each city *type* (Capital/Trade/Combat/Resource) explained **in fiction** — not "Trade: Economy ×1.618" but what kind of life that ground offers.
3. **The claim** — you drive your stakes. The on-chain `init_user`/`init_player`/`create_progress`/`create_estate` calls fire here, dressed as a single act of *claiming*.
4. **The Steward** — the Steward appears, delivers the Arrival line, and stays.

Outcome: a new player's first five minutes have a *world*, a *decision that matters*, and a *companion* — instead of a form.

### 7.3 The home base — `dashboard` + `estate`
The dashboard and estate are reframed as **coming home**. The first thing on return is the **Steward's Report** (§8) — not stat cards. The estate carries its current *mood*. Stat cards stay, but below the fold; the hearth comes first. The full estate-page design — the three loops, the four feel levers, the chapter band, the plot-parcel layout — is in §6.1.

### 7.4 The Chronicle — replaces `QuestSteps` (in `dashboard/page.tsx`)
The current `QuestSteps` is an 11-item TODO checklist with "Go →" buttons. Replace it with **the Chronicle** — the Steward's account of your climb:
- It is the **journey tracker**: current act, the next beat, framed in the Steward's voice (not "Build Market" but *why* the next thing matters).
- Completed beats become **history** — a readable chronicle of how far you've come. This is itself a comeback hook: returning players *see their climb*.
- It absorbs the existing 11 steps and extends them across all six acts.

### 7.5 FeatureGate, re-voiced — `lib/hooks/useFeatureGate.ts` + `FeatureGate.tsx`
The gating engine is excellent and stays. Today it emits sterile cards: *"Feature Locked — Build Market (Lv1) →"*. Re-voice the `MissingRequirement` copy through the narrative layer: the Steward tells you what's needed and why it serves the climb. Same data, same `href`, narrative skin.

### 7.6 Act interstitials — extends `TransitionOverlay`
Act transitions (entering First Blood, swearing into a House, the coronation) become **full-screen narrative beats**. The `TransitionOverlay` + `transition.ts` store already do cinematic screen-to-screen moments — extend them with act-keyed content. `PageTransition.tsx` is **currently a no-op** (`return <div>{children}</div>`) — a free hook point for per-screen entrance beats.

### 7.7 Tone escalation tied to act
The app already escalates *visual* tone via `body[data-tier="0..4"]` theming. Today that tracks only the paid subscription tier — which is why a free player gets crowned a "legend." **Re-key the narrative tone to the act**, not the wallet. Act 0–II reads grounded and grim; Act IV–V reads grand. The crown-language returns only when the crown is real.

### 7.8 Housekeeping flagged by the scan
- `/economy` is an **orphaned route** (Collect/Stamina/Vault tabs; not linked from any nav) duplicating most of the old Market tab. It is **retired** — its functions unbundle exactly as the Market tab's do (§6.0): Collect → Mine/Farm/Dock, Vault → the Vault building, Stamina → the Market. Note this is *not* the Shop: the real-money store lives at `/shop` and stays a separate surface (§6.7).
- `/leaderboard` and `/world/leaderboard` overlap — pick one.
- Team **incoming invites** have no accept/decline UI (`UI_GAPS.md`) — the House reframe is the natural place to add it.

---

## 8. The comeback engine — "the estate lives"

The mechanical retention hooks already exist (5-min NOVI regen, stamina, expedition/research/build timers, daily streaks, arena seasons, castle protection). What is missing is a *narrative* reason to return. The answer is the **Steward's Report**.

**On every return, before anything else, the Steward briefs you on what changed while you were away** — drawn entirely from on-chain state the app already fetches:

- Buildings that finished construction
- Expeditions and research that completed; what your operatives brought back
- Combat that happened to you (attacks, new-player protection expiring)
- Your House's deeds — rallies, members, treasury
- The realm's weather — castle contests, season turning, the Ages advancing
- In Act V: threats to your crown

This reframes the entire timer economy. A research timer is no longer a countdown — it is *something the Steward will have news about*. The estate has **moods** (raw / working / thriving / threatened) that the player feels the moment they load in. The hook is not "your timer is up." It is **"someone is keeping your home while you're gone, and they have things to tell you."**

The Report is also where the journey *paces itself*: it is the natural surface for nudging the next beat — in the Steward's voice, never the Shop's.

---

## 9. What to build (web deliverables)

All in `apps/web`. No program changes.

| # | Deliverable | Replaces / touches | Notes |
|---|-------------|--------------------|-------|
| 1 | **Narrative content layer** — `src/lib/narrative/` | new | Pure data, zero logic, zero contract risk. `steward.ts` (lines keyed by context), `acts.ts` (the six acts + beats + transition copy), `systems.ts` (per-system framing, building copy). The bulk of the writing; ships incrementally. |
| 2 | **`deriveAct()` helper** | new | Client-side; reads extension bitmap + building levels + castle ownership → current act. |
| 3 | **The Arrival** — `components/arrival/` | replaces `components/onboarding/OnboardingFlow.tsx` | Paced narrative onboarding (§7.2). |
| 4 | **StewardPresence** | new | Persistent UI element (portrait/sigil + current line) on the home base. |
| 5 | **StewardReport** | new; mounts on `dashboard`/`estate` | The comeback engine (§8). Composes from existing data hooks. |
| 6 | **The Chronicle** — `components/chronicle/` | replaces `QuestSteps` in `dashboard/page.tsx` | Narrated journey tracker + history (§7.4). |
| 7 | **ActInterstitial** | extends `TransitionOverlay` / `transition.ts` | Full-screen act-transition beats. |
| 8 | **Re-voiced FeatureGate copy** | `useFeatureGate.ts`, `FeatureGate.tsx` | Route `MissingRequirement` copy through layer #1. |
| 9 | **Reframed + unbundled system screens** | `building-features.ts`, `market-tab.tsx`, `TeamBrowser.tsx`, `castle-tab.tsx`, `shop`; **new feature views for Barracks, Camp, Mine, Farm, Dock** | Copy, empty states, framing per §6; unbundle the Market into per-building screens (§6.0). |
| 10 | **Wire `PageTransition.tsx`** | currently a no-op | Per-screen entrance beats. |
| 11 | **Re-key tone to act** | `data-tier` theming usage | Narrative tone follows the act, not the subscription (§7.7). |

---

## 10. Rollout phases

Ordered so the biggest felt change ships first, and each phase stands alone.

- **Phase 1 — The Voice & The Arrival.** Deliverables 1, 2, 3, 4. Scaffold the narrative layer; build the Steward; replace onboarding with the Arrival. *After this, a new player's first impression is transformed.* Covers Acts 0–I.
- **Phase 2 — The Chronicle & the comeback engine.** Deliverables 5, 6. The journey becomes trackable; the estate starts to live. *After this, returning players have a reason rooted in fiction.*
- **Phase 3 — The systems, retold.** Deliverables 8, 9, 11. Re-voice the estate, market, hiring, House, castle, shop. Covers Acts II–V framing.
- **Phase 4 — Cinematics & polish.** Deliverables 7, 10. Act-transition interstitials, the coronation, per-screen entrances.
- **Phase 5 (future, out of current scope) — Make it real on-chain.** Un-hardcode the dormant `required_estate_level()` gates in `estate.rs` so the acts are mechanically enforced, not just narrated. Requires touching tests that assume gates are `0`. Decide later.

---

## 11. Open questions & risks

- **The Steward needs a name and a face.** This plan uses the role only. The name is revealed as an Act III beat; pick it together with the Steward's failed-holding backstory. Art direction (a portrait or sigil) is a follow-on task.
- **The bible says "no NPCs."** The Steward is a deliberate, surgical exception — *one* retainer, not a cast; serves, does not save; consistent with Rule #4 ("power comes from people"). Recommend a short addition to `docs/WORLD_LORE.md` to canonize the Steward so the bible and the game agree. Consider finally writing `TOWN_SOUL_DESIGN.md` (currently 0 bytes) from this material.
- **Monetization ethics is a hard rule, not a guideline.** The comeback hook must never become an upsell. The Steward is loyal to the player. Re-read §6.7 before writing any Shop-adjacent copy.
- **The journey is descriptive, not enforced.** A player can technically skip ahead via the sandbox. That is acceptable — the journey *guides and frames*; it does not cage. (Phase 5 would change this.)
- **Theme flexibility.** The bible defines five themes (Medieval default; Cyberpunk/SciFi/Modern/PostApocalyptic stubbed). The Steward and the six-act arc are theme-agnostic in *structure*; only the *vocabulary* changes per kingdom theme. Keep the narrative layer (#1) theme-keyed from day one so this stays cheap.

---

## 12. The one-sentence version

*A nobody claims a ruin; an old survivor stays to help rebuild it and calls them "my lord" before it's true; six acts later — Foundation, First Blood, the House, Mastery, the Crown — it is true, and the Steward says so.*
