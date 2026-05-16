# Player Journey Game Plan — Novus Mundus

> **From a claimed ruin to a contested crown — a journey narrated by one voice.**

**Status**: Design — approved direction, not yet implemented
**Scope**: Web app only (`apps/web`). No program changes.
**Date**: 2026-05-15
**Companion docs**: `docs/WORLD_LORE.md` (the storyline), `docs/onchain/02-player-journey/` (the technical specs this dramatizes)

---

## 1. Why this doc exists

Novus Mundus has **24 systems and 181 on-chain instructions**. It has a genuinely strong storyline. What it does not have is a **journey** — a felt arc that carries a player from their first minute to their hundredth, that gives every screen an emotional reason to exist, and that makes them *want to come back*.

Right now the game is a skeleton. Every screen is competent CRUD: onboarding is a city-picker form, "finding a team" is a sortable table, the market is number inputs, the castle is `<select>` dropdowns for appointing a "Court." The systems work. Nothing *feels*.

This plan fixes that — not by adding mechanics, but by adding **connective tissue**: a personal arc, a single narrating presence, and per-system emotional framing. It then redesigns the web app flow to deliver that journey.

---

## 2. What we're working with (the diagnosis)

Five findings from a full scan of the lore, the program, and the web app:

1. **The storyline is strong — and already wrote our opening.** `docs/WORLD_LORE.md` is a real storyline: a post-cataclysm world (the *Sundering* broke the old civilization *Aeondral*, which bled the world dry mining *Novis*). It explicitly assigns the player an identity — *"You are no one important… a survivor… a lord of nothing, with everything to gain."* Section XII contains **finished** onboarding text, encounter flavor, and estate-reveal copy. **None of it is wired into the game.**

2. **The app contradicts the storyline.** Onboarding opens with **"WELCOME, WARRIOR"**; loading and transition screens crown the player a *King*, a *legend*, a *"Mythic King"* from the first second. The grounded survivor — the most distinctive thing in the lore — exists nowhere in the product.

3. **A journey already exists in the code — switched off.** `programs/novus_mundus/src/state/estate.rs` lays out **Chapter 1: Foundation → Chapter 2: Expansion → Chapter 3: Mastery** in comments, with per-building unlock gates. Every gate is hardcoded to `0` *"during SDK development for testability."* The skeleton of this journey is already in the codebase, disabled.

4. **The only narrative surface is two transient places.** All "story" lives in the 1.2s transition wipe (`src/lib/store/transition.ts`) and the tiered loading labels (`LoadingSequence.tsx`). Every gameplay screen has zero story.

5. **`TOWN_SOUL_DESIGN.md` exists in the repo — 0 bytes.** Someone already knew this was the gap and named the file. It was never written. This document is its answer.

**The raw materials are better than they look.** There is a world, a player identity, a dormant 3-chapter spine, and pre-written flavor. The work is connective tissue, not invention.

---

## 3. Design decisions (locked)

Four pillars, settled. Every choice in this plan descends from them.

| # | Decision | What it means |
|---|----------|---------------|
| 1 | **Ascent from ash** | The player starts powerless and grounded. The journey *is* the rise: survivor → lord → king. Tone escalates with progress. This reconciles the storyline, the castle endgame, and the existing `data-tier` theme escalation. The app's premature "King/legend" copy is removed; the crown becomes something **earned in Act V**, and only then *true*. |
| 2 | **One voice — the Cairn** | A single narrating voice frames the entire game: the Cairn, an origin-unknown orb at the center of your holding. Not a cast, not a chosen-one mentor, not a person. A guide that was already there when you arrived and never leaves. |
| 3 | **Web app only** | The journey lives entirely in `apps/web` — copy, framing, flow, a reframed quest system. **Zero program changes.** The dormant on-chain gates stay dormant (revisiting them is a noted future option, §11). |
| 4 | **The estate lives** | The primary narrative reason to return is that your holding is a living place with ongoing situations — and the Cairn is always there with news. The comeback hook and the narrating voice are the same thing. |

---

## 4. The Cairn

The Cairn is the spine of the entire journey. Get this voice right and every screen inherits a soul.

### What it is

At the center of your claimed ground rests a stone — a dark orb, smooth, no bigger than a fist, sitting where the old foundations cross. It was there before you. **No one set it down, and no one living knows what it is.** It does not move. It does not leave. When you need the way forward, it shows you; when you don't, it waits. It has stood through every season and watched every would-be lord come up the road and fail — but it is not *watching you*. It has no eye. It is simply *there*, the way the ground is there.

It is called the **Cairn** — for the stacks of stones travelers leave to mark a trail: built by no single hand, of unknown first maker, guiding whoever climbs next.

### What it is not

Not a mentor, not a companion, not a person. It has no past to reveal, no name to learn, no loyalty to win or lose. It owes you nothing and asks nothing. This is deliberate: the Cairn is a **guide** — it marks the path. The climb is yours; the people are yours; the power is yours. The Cairn never hands you any of it.

> **The hard line (keep it strict).** The Cairn grants *nothing mechanical* — no resources, no units, no combat aid, no advantage of any kind. It only points. This is what keeps it on the right side of the storyline's Unwritten Rule #4, *"power comes from people, not magic."* An origin-unknown orb is, on its face, magic — but a thing that *only shows you the way* is a **compass, not a weapon**. The moment the Cairn *does* something for the player, the rule breaks. (See §11.)

### Voice

Spare, declarative, exact. The Cairn **states** — it does not advise, comfort, scold, or cheer. Short sentences. Plain, hard images. No *"you should"* — only *"this is"* and *"ahead lies."* It speaks in no person — never *"I"* — because there is no one there to be an *I*. It has the patience of a thing that has stood through every winter. Never warm, never cruel. The flatness is the character.

### The through-line — what the Cairn names

The Cairn's recurring job is to tell you, plainly, **where you stand on the climb.** That naming is the emotional spine of the journey. It is not one fixed line — it is built from four combining principles, so it stays alive across a hundred hours without ever losing the thread.

**1. Two axes.** The Cairn names two things, climbing in parallel:

- ***The place*** — the loud, primary axis. *What is this holding?*
  Act 0 *"A ruin."* → Act I–II *"A holding."* → Act III *"A House."* → Act IV *"A name the realm knows."* → Act V *"A seat. A crown."*
- ***The lord*** — the quiet axis, heard mostly at act *transitions*. *What are you?*
  Act 0 *"No one. A survivor."* → Act I–II *"A lord of mud."* → Act III *"A lord with a House at his back."* → Act IV *"A name."* → Act V *"A king."*

The place is the headline and carries most beats; the lord is a rare echo, saved for the threshold of a new act. Never run both at once.

**2. Headline + variant pool.** Each axis-answer per act is not a single line but a *pool* — one canonical headline plus rephrasings — so a long stretch on "a holding" never goes canned. *Canonical:* "A holding." *Variants:* "Walls, and a name. A holding." / "Still a holding — it is allowed to take time."

**3. Mood-bent.** The line bends to the estate's current mood (§8) — the same mood the orb's color already carries. Act II *thriving:* "A holding, and a good one." Act II *threatened:* "A holding — and someone is testing whether it stays one."

**4. Theme-keyed.** The vocabulary swaps per kingdom theme (§11) — Medieval "a House," Cyberpunk "a syndicate" — without touching any of the structure above.

So a through-line line is selected by **(axis, act, mood, theme) → a pool**, and one is drawn from it. In `cairn.ts` (deliverable #1) the through-line is exactly that keyed table.

> **The guardrail — the one thing that never varies.** The climb is *singular and legible*. The answer escalates; it never **forks**. Variety lives in phrasing, mood, axis, and theme — never in giving two contradictory answers to "what is this place" at the same point. The player must always feel one line going up.

### Sample lines (voice reference for writers)

> **Arrival —** "A dozen came up that road before you. They counted gold they did not have, and the road took them back. You drove your stakes instead. The stone is lit. — This is a ruin. It does not have to stay one."

> **First building completes —** "Walls that meet at the corners. People died in this place once. Now it keeps the rain out. That is the whole distance traveled. It is not nothing."

> **New-player protection ends —** "The quiet held while the holding was small. It is not small now. Word has crossed the road: there is something here worth the walk. To be worth taking was the asking. It has arrived."

> **A costly defeat —** "People were spent here. Not numbers — people. They came because a rumor said this lord could keep them. The rumor is poorer tonight."

> **Finding a House (Act III) —** "The holding has reached the edge of one pair of hands. Past this line nothing is taken — it is given, and given is owed. A House is not friendship. It is debt, chosen well."

> **The Act III beat —** "Every lord whose holding fell, the stone went dark the day they broke. It has not gone dark. — That is not counsel. It is only what the light is doing."

> **The Crown (Act V payoff) —** "A ruin once asked what it could become. The question has its answer. — A crown. The climb earned it, stake by stake, stone by stone. The stone has marked the whole road. It marks this too: the place is yours."

> **Every return (the comeback engine) —** "You are back. The holding kept turning while you were gone. Here is what moved—"

### The Cairn's arc — shown, not told

The Cairn has no story to confess, so its arc is **visual**. The orb itself changes with the climb: it begins small and dull, a dark stone that throws a shadow. As the holding rises it deepens, brightens, and by Act V throws light instead of shadow — fully lit. The player watches the guide become a beacon, without a word spoken about it.

The orb also carries the **estate's mood** (§8) — its color and intensity shift across *raw / working / thriving / threatened*. So one element does three jobs at once: the guide, the at-a-glance state of home, and the visible proof of how far you've climbed. (This collapses deliverable #4 and the mood system into a single component.)

### Visual treatment

The Cairn is **always visible**, fixed on the home base. It is built to read against any background: it casts a soft shadow in the light theme and throws light in the dark theme — inverted, so it never disappears into the page. Color and intensity track estate mood.

> **Future (out of current scope) — the "AI touch."** The Cairn could one day become a genuine conversational assistant. Keeping every line as data in `cairn.ts` (deliverable #1) means a future model can speak *in character* without contradicting the fiction. Design the voice now — spare, impersonal, declarative — so it survives that step.

---

## 5. The Arc — six acts

The player's personal arc mirrors the kingdom's macro-arc (the storyline's three **Ages**: Ashes → Crowns → Dominion). It expands the dormant `estate.rs` 3-chapter skeleton — Foundation and Mastery are kept by name; the Arrival, First Blood, The House, and The Crown are the new connective acts.

| Act | Kingdom Age | Systems it covers | Player's state | The turn (inciting beat) | The payoff |
|-----|-------------|-------------------|----------------|--------------------------|------------|
| **0 — The Arrival** | Ashes | account + estate creation, city choice | Nothing. Just arrived. | You stop walking. You drive your stakes. | The ruin is *yours*. The Cairn lights. |
| **I — Foundation** | Ashes | estate ch.1 (Mansion, Barracks, Workshop, Vault, Camp), hiring units, daily claim | Alone, building | The first building completes | A holding that keeps the rain off. The first people take *you* in. |
| **II — First Blood** | Ashes | travel, combat, encounters, stamina, Academy/research begins | Tested by the world | New-player protection ends — the world notices you | You survive your first real fight. You've earned a place on the map. |
| **III — The House** | Crowns | teams, rally, reinforcements, inventory/shop, research deepens | At the ceiling of solo play | The extension chain forces it — you cannot rise alone | An oath sworn. You're in a House. The Cairn marks *you*, not just your walls. |
| **IV — Mastery** | Crowns | heroes, forge, dungeon (Catacombs), arena, sanctuary | A known name | Your first hero locked into a slot | Legendary arms, the Catacombs cleared, an arena rank. The kingdom reckons with you. |
| **V — The Crown** | Dominion | castle, court, garrison, endgame | A power | A castle stands vacant. You can take it. | A crown. A court of your own people. The Cairn names the seat yours. |

**Act V does not end the game.** The crown is contestable (storyline: "the real enemy is other players"). The endgame loop is *defending* the climb: rivals rise, the Ages turn, new kingdoms launch. The journey graduates into the persistent sandbox — but the player arrives there having *felt* every step.

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
- **Reframe:** the estate is a *holding*, not a grid — the physical proof of the climb (the storyline: *"your anchor… the physical manifestation of everything you've built"*). It is laid out as the player's **land**: the 5 plots they can own, each holding 4 building slots, rendered as parcels — claimed plots show their buildings, unclaimed plots read as *"land beyond your claim."* The holding visibly fills, plot by plot.

  > **Layout decision (locked):** the **plot-parcel** grouping — moderate build, no new art. A fully illustrated "spatial" holding view is the *same model rendered richer*, kept as a later upgrade; the structural design below is identical either way.

**What the player does on the estate page — three loops:**

1. **Build the holding** (the journey, made physical): establish the estate (Act 0); buy land plots (5 total, ~free → ~1.8M NOVI, each a visible extension of the claim); build / complete / upgrade buildings; speed up construction with gems.
2. **Run the holding day to day** (the comeback loop): daily claim + streak (the Cairn keeps the count; milestones at 7/14/30/60/90/180 days); the daily rounds — the `daily_activity` mini-games in 3 time windows (Dawn/Midday/Dusk), reframed as "the work of the day"; recover wounded units (Infirmary); convert materials (Workshop).
3. **Enter the deeper systems:** each building opens its feature view — Barracks/Camp (hire), Mine/Farm/Dock (collect), Market (trade), Academy (research), Forge, Sanctuary, Infirmary, Workshop.

**The four levers that turn a grid into a place:**

1. **The Cairn, up top.** The player lands and the Cairn lays out the Report — what changed while they were away (§8). The comeback engine lives here, and the orb is the first thing the eye finds.
2. **The estate has a mood** — *raw / working / thriving / threatened* — driven by real state (construction, happiness, attacks). Same data, the page *reads* different. Cheapest, highest-impact feel lever. The Cairn's color carries it.
3. **Buildings as beats.** The chapter-defining buildings get a moment when raised; the dormant `estate.rs` comments already wrote the hooks — Mansion "the first building," Vault "secure your wealth," MeditationChamber "recruit your first hero," Citadel "lead your first rally."
4. **Upgrades reveal history.** The world is "the corpse of the old one." Each upgrade *digs deeper* and uncovers what the estate is built on (the storyline's section XII idea — "the foundation wasn't a house, it was a courthouse; the cells are still intact below"). Upgrading becomes discovery, not a stat bump.

**The chapter band.** The estate buildings *are* the journey's spine (Foundation → Expansion → Mastery). The page shows which chapter the player is in and what the next building means, in the Cairn's voice — the estate page and the Chronicle (§7.4) are the same story told two ways.

- **First beat:** Act 0 — the player stands on the ruin; the Cairn names what it is, and what it could be.
- **Lives by:** the Cairn's Report on every return; the estate visibly changes mood and fills with buildings.

> **Recommendation:** the estate becomes the screen the player *lands on* — the true home base. The current `/dashboard` (Power, Treasury, Net Worth, Activity Feed) folds into the estate's header or slims to an optional quick-glance. A thread to settle during Phase 2.

### 6.2 Hiring — *taking people in* — at the Barracks & the Camp

- **Current:** buried as the "Hire" toggle inside the Market grab-bag — number inputs that increment army counters.
- **Reframe:** hiring unbundles to **two places**, because there are two kinds of people. **Soldiers are recruited at the Barracks; workers (operatives) at the Camp.** Units are not numbers — they are survivors who attach to a lord who can feed and protect them. The happiness/abandonment system already in the program *is this story*: people lose faith and leave. Hiring is *"word has spread that someone at your holding is building — and people are walking here to find out."* Soldiers come to fight; workers come to labor — two different arrivals, two different rooms.
- **First beat:** Act I — the first recruits reach the Barracks; the Cairn: *"They came because they heard a rumor. The rumor is now a thing to keep or break."*
- **Lives by:** happiness surfaced as the morale of cohorts; abandonment reported by the Cairn as people *leaving*, not a stat ticking down.

### 6.3 Collecting — *your people work the land* — at the Mine, Farm & Dock

- **Current:** the "Collect" toggle inside the Market grab-bag — four collection cards (Cash, Mining, Fishing, Farming) over number inputs.
- **Reframe:** collection unbundles to the **production buildings** — the player gathers where the land-work happens: ore at the **Mine**, crops at the **Farm**, the catch at the **Dock**. Collection is operatives going *out* and bringing the world *back*; each building's feature view reads as a **ledger of what went out and what came home**, not a calculator. The Cairn tallies the haul.
- **First beat:** Act I/II — the first operatives return from the field; the Cairn counts the take.
- **Lives by:** "what your people brought back while you were away" folds into the Cairn's Report.

### 6.4 The Market — *where the holding touches the world*

- **Current:** `market-tab.tsx` — the 5-in-1 grab-bag (Hire/Equip/Collect/Stamina/Vault). After unbundling: Hire → Barracks/Camp (§6.2), Collect → Mine/Farm/Dock (§6.3), Vault → the Vault building.
- **Reframe:** stripped to what it actually is — **trade**. The Market is where the holding *buys*: weapons, armor, equipment — its one window onto outside commerce. Freed of the grab-bag, it can finally be a *place* — a real market, merchants, the caravan road — instead of a junk drawer. (Stamina, the lone leftover, is minor: fold it into the Market as "provisions" or surface it on the player card; decide in Phase 3.)
- **First beat:** Act II — the first equipment bought; the holding can now arm what it recruits.
- **Lives by:** the caravan and its wares arrive on their own cadence — see §6.7 for the strict line between the Market's in-world commerce and the Shop's real-money offers.

### 6.5 The House — *finding a team* (the one the user flagged hardest)

- **Current:** `/team` → "Browse" → `TeamBrowser.tsx` — a search box, a "Public only" checkbox, a sort dropdown, a grid of cards. Joining is a link. The chat is a *"coming soon"* stub.
- **Reframe:** In the storyline, *"a House is a claim to legitimacy."* This is **Act III**, and it has a thesis the Cairn delivers: *you have built as far as one lord alone can reach.* The TeamBrowser becomes **"The Houses of [Kingdom]"** — each team is a House with a banner, a seat, a reputation. Member count → *sworn blades*; treasury → *war-chest*; age → *how long the banner has flown*. **Joining a House is an oath** — a real ceremonial moment (use the transition system, §7). The "Create a Team" empty-state card becomes *"Raise your own banner."* The chat stub becomes **the war-table**.
- **First beat:** Act III opens — the Cairn: *"A lord with no House is a large house, and one man rattling in it."*
- **Lives by:** your House's deeds (rallies, members joining, treasury moves) reported by the Cairn on return.

### 6.6 The Castle — *the crown*

- **Current:** `map/_components/castle-tab.tsx` — castle-index selectors, a `<select>` for court positions, **raw wallet-address text inputs** to appoint a Court. The most kingdom-themed feature with the least kingdom feeling.
- **Reframe:** **Act V.** The castle is a *seat of power*. Claiming it is a **coronation** — the single most cinematic beat in the game (full-screen interstitial). The Court is not a dropdown — it is *your people taking seats*: you name House-mates you already know to Advisor/Marshal/Scholar/Guardian/Treasurer. The wallet-address input is replaced by picking from your known allies (this also fixes the self-target bug `UI_GAPS.md` flags at `castle-tab.tsx:176`). Castle status (Vacant/Contest/Protected/Vulnerable) becomes the castle's *condition*, narrated — "the walls are quiet," "banners on the horizon."
- **First beat:** Act V — a castle stands vacant; the Cairn, for once, names nothing — the choice stands alone.
- **Lives by:** the crown is *contestable* — the Cairn's Report carries the weather of the realm. This is where the comeback hook turns from "tend your home" to "hold your throne."

### 6.7 The Shop — *the caravan* (handle with care)

- **Current:** `shop/page.tsx` — an e-commerce catalog + a SaaS-style subscription pricing table.
- **Reframe:** The Shop is **the caravan** — outside merchants and charters that reach your holding. Subscriptions are *a patron's charter*: backing that accelerates your estate (the storyline already says subscriptions "accelerate but don't guarantee").
- **Hard rule — the ethics line:** The narrative must **never** weaponize the comeback hook to upsell. The Cairn marks your *estate*, never *sales*. The Cairn never guilt-trips, never manufactures false urgency, never says "you should buy." The caravan is an opportunity that arrives; it is never a story beat the player is pushed toward. Flash-sale countdowns stay in the Shop and out of the Cairn's voice. **The Cairn marks the climb, never the coin.**
- **First beat:** Act II/III — the first caravan reaches a holding now worth visiting.
- **Lives by:** the caravan comes and goes on its own cadence; the Cairn names it neutrally, at most.

### 6.8 The Vault — *the two NOVIs*

- **Current:** the Vault is one of the §6.0 unbundle targets — today "store & hide cash," and the app shows NOVI as a single pooled number. The storyline's *central economic dilemma* is invisible.
- **Reframe:** the Vault is where the storyline's **Relic Economy** (§VII) becomes something the player can *see and feel*. NOVI is two different things, and the UI must **never sum them**:
  - **Locked NOVI — your fuel.** What the game runs on: buildings, units, research, speed-ups. It regenerates, and the **daily claim pays into it.** It is bonded to Novus Mundus — **it can never leave the game.** Rendered as a working *fuel gauge* on the estate header / player card, not as a wallet balance.
  - **Reserved NOVI — your wealth.** Earned from prizes and events; raw crystal; **withdrawable** after a 7-day vest (`reserved_novi_earned_at`). The only NOVI that can ever become real value to the player. It lives *in the Vault*, rendered as treasure that visibly *settles* before it can be taken.
  - **The one-way door.** Reserved → Locked is **irreversible** — committing wealth to growth locks it in the game forever; there is no path back, and daily claim only ever flows *into* Locked. This is the dilemma §VII names. The conversion is never a silent transaction: the Cairn marks it — *this NOVI is in the walls now; it does not come back* — in the voice of §VII's warning, *"are we making the same mistake?"* (Aeondral overspent Novis and died.) A weighted choice, never a bare "Are you sure?" dialog.
- **First beat:** Act I/II — the first Reserved NOVI vests; the Vault stops being a number and becomes a place with a locked door and a slow clock.
- **Lives by:** the Cairn's Report notes Reserved that has finished vesting (*"yours to take now"*) — neutrally, never nagging (the §6.7 ethics line holds); Reserved also feeds the estate mood — a holding with reserves reads *secure*, one running on fumes reads *threatened*.

---

## 7. The web app flow, redesigned

Current funnel: **Landing → 1.2s transition wipe → bare city-picker form → dashboard with a TODO checklist.** Every screen thereafter is CRUD.

Redesigned funnel, screen by screen:

### 7.1 Landing — `app/(auth)/page.tsx`
- **Now:** "Conquer kingdoms. Forge empires. Command armies."
- **Redesign:** Re-voice in the storyline's register — the grounded survivor, not the conqueror. Keep the "Spectate the Realm as a Peasant" link (it has charm). The connect button leads into the Arrival, not straight to the dashboard.

### 7.2 The Arrival — replaces `components/onboarding/OnboardingFlow.tsx`
The single biggest first-impression change. The current onboarding is one screen: "WELCOME, WARRIOR" + a 5-column city grid + "Enter {city}." Replace it with a short, paced narrative sequence (built on the existing `TransitionOverlay` + `LoadingSequence` machinery — already the richest narrative tech in the app):

1. **The world** — the storyline's finished onboarding text, surfaced at last: *"The old world fell. You don't remember it — no one alive does…"*
2. **The choice** — *where you make your stand.* The same city pick, but each city *type* (Capital/Trade/Combat/Resource) explained **in fiction** — not "Trade: Economy ×1.618" but what kind of life that ground offers.
3. **The claim** — you drive your stakes. The on-chain `init_user`/`init_player`/`create_progress`/`create_estate` calls fire here, dressed as a single act of *claiming*.
4. **The Cairn** — at the heart of the claimed ground, the stone lights. It delivers the Arrival line. It stays.

Outcome: a new player's first five minutes have a *world*, a *decision that matters*, and a *constant presence* — instead of a form.

### 7.3 The home base — `dashboard` + `estate`
The dashboard and estate are reframed as **coming home**. The first thing on return is the **Cairn's Report** (§8) — not stat cards. The estate carries its current *mood*. Stat cards stay, but below the fold; the orb comes first. The full estate-page design — the three loops, the four feel levers, the chapter band, the plot-parcel layout — is in §6.1.

### 7.4 The Chronicle — replaces `QuestSteps` (in `dashboard/page.tsx`)
The current `QuestSteps` is an 11-item TODO checklist with "Go →" buttons. Replace it with **the Chronicle** — the Cairn's account of your climb:
- It is the **journey tracker**: current act, the next beat, framed in the Cairn's voice (not "Build Market" but *why* the next thing matters).
- Completed beats become **history** — a readable chronicle of how far you've come. This is itself a comeback hook: returning players *see their climb*.
- It absorbs the existing 11 steps and extends them across all six acts.

### 7.5 FeatureGate, re-voiced — `lib/hooks/useFeatureGate.ts` + `FeatureGate.tsx`
The gating engine is excellent and stays. Today it emits sterile cards: *"Feature Locked — Build Market (Lv1) →"*. Re-voice the `MissingRequirement` copy through the narrative layer: the Cairn names what's needed and why it serves the climb. Same data, same `href`, narrative skin.

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

The mechanical retention hooks already exist (5-min NOVI regen, stamina, expedition/research/build timers, daily streaks, arena seasons, castle protection). What is missing is a *narrative* reason to return. The answer is the **Cairn's Report**.

**On every return, before anything else, the Cairn lays out what changed while you were away** — drawn from on-chain state the app already fetches, diffed against a client-side last-seen snapshot (see below):

- Buildings that finished construction
- Expeditions and research that completed; what your operatives brought back
- Combat that happened to you (attacks, new-player protection expiring)
- Your House's deeds — rallies, members, treasury
- The realm's weather — castle contests, season turning, the Ages advancing
- In Act V: threats to your crown

This reframes the entire timer economy. A research timer is no longer a countdown — it is *something the Cairn will have news about*. The estate has **moods** (raw / working / thriving / threatened) that the player feels the moment they load in — carried by the orb's color and light. The hook is not "your timer is up." It is **"the holding lived while you were gone — and the Cairn holds all of it, waiting to be shown."**

**How the Report knows what *changed* — the last-seen snapshot.** On-chain state tells the app what *is*; to tell the player what *changed*, the Report needs a reference point. On exit (and periodically), the app writes a **last-seen snapshot** to `localStorage`, keyed by wallet address — the values that feed the Report (treasury, House member count, building states, army counts, Locked/Reserved NOVI) plus a timestamp. On return, it diffs current on-chain state against that snapshot. Three rules keep it honest:

- **Cumulative deltas** — treasury up, House gained members, Reserved vested — come from the snapshot diff: cheap and exact.
- **Discrete events** — "you were attacked," new-player protection expired — come from **on-chain truth** (timestamps, logs) wherever the program records them. A diff can tell you the army shrank; only on-chain data can tell you it was an *attack*, and by whom. Use whichever source is authoritative per fact.
- **Fallback** — `localStorage` is per-device and can be cleared. First load on a new device, or a wiped store → no snapshot → the Report falls back to on-chain timestamps, or simply shows a quiet "welcome back" with no deltas. Never block the screen on a missing snapshot.

The Report is also where the journey *paces itself*: it is the natural surface for nudging the next beat — in the Cairn's voice, never the Shop's.

---

## 9. What to build (web deliverables)

All in `apps/web`. No program changes.

| # | Deliverable | Replaces / touches | Notes |
|---|-------------|--------------------|-------|
| 1 | **Narrative content layer** — `src/lib/narrative/` | new | Pure data, zero logic, zero contract risk. `cairn.ts` (lines keyed by context), `acts.ts` (the six acts + beats + transition copy), `systems.ts` (per-system framing, building copy). The bulk of the writing; ships incrementally. |
| 2 | **`deriveAct()` helper** | new | Client-side; reads extension bitmap + building levels + castle ownership → current act. |
| 3 | **The Arrival** — `components/arrival/` | replaces `components/onboarding/OnboardingFlow.tsx` | Paced narrative onboarding (§7.2). |
| 4 | **CairnPresence** | new | Persistent UI element — the orb itself (light/shadow theme inversion, mood-driven color/intensity) + current line. On the home base. |
| 5 | **CairnReport** | new; mounts on `dashboard`/`estate` | The comeback engine (§8). Composes from existing data hooks, diffed against a `localStorage` last-seen snapshot (keyed by wallet) for change detection. |
| 6 | **The Chronicle** — `components/chronicle/` | replaces `QuestSteps` in `dashboard/page.tsx` | Narrated journey tracker + history (§7.4). |
| 7 | **ActInterstitial** | extends `TransitionOverlay` / `transition.ts` | Full-screen act-transition beats. |
| 8 | **Re-voiced FeatureGate copy** | `useFeatureGate.ts`, `FeatureGate.tsx` | Route `MissingRequirement` copy through layer #1. |
| 9 | **Reframed + unbundled system screens** | `building-features.ts`, `market-tab.tsx`, `TeamBrowser.tsx`, `castle-tab.tsx`, `shop`; **new feature views for Barracks, Camp, Mine, Farm, Dock** | Copy, empty states, framing per §6; unbundle the Market into per-building screens (§6.0). |
| 10 | **Wire `PageTransition.tsx`** | currently a no-op | Per-screen entrance beats. |
| 11 | **Re-key tone to act** | `data-tier` theming usage | Narrative tone follows the act, not the subscription (§7.7). |

---

## 10. Rollout phases

Ordered so the biggest felt change ships first, and each phase stands alone.

- **Phase 1 — The Voice & The Arrival.** Deliverables 1, 2, 3, 4. Scaffold the narrative layer; build the Cairn; replace onboarding with the Arrival. *After this, a new player's first impression is transformed.* Covers Acts 0–I.
- **Phase 2 — The Chronicle & the comeback engine.** Deliverables 5, 6. The journey becomes trackable; the estate starts to live. *After this, returning players have a reason rooted in fiction.*
- **Phase 3 — The systems, retold.** Deliverables 8, 9, 11. Re-voice the estate, market, hiring, House, castle, shop. Covers Acts II–V framing.
- **Phase 4 — Cinematics & polish.** Deliverables 7, 10. Act-transition interstitials, the coronation, per-screen entrances.
- **Phase 5 (future, out of current scope) — Make it real on-chain.** Un-hardcode the dormant `required_estate_level()` gates in `estate.rs` so the acts are mechanically enforced, not just narrated. Requires touching tests that assume gates are `0`. Decide later.

---

## 11. Open questions & risks

- **The Cairn replaces a human "Steward" — a deliberate trade with a real cost.** Earlier drafts of this plan used a weathered human companion whose *name* and *failed-holding backstory* were revealed as an Act III intimacy reward, paying off in Act V when they admitted their loyalty had become real. The Cairn — an origin-unknown orb, with no person inside — **cannot carry those beats.** What replaces them: the Act III line where the orb marks *you* and not just your walls, the Act V naming of the crown, and the orb's silent visual arc from dull stone to beacon. This is lighter than a deepening relationship. Accept that as the price of the orb's mystery, or introduce a human secondary character later if the journey plays cold. Decide before Phase 1 writing begins.
- **The Cairn sits in tension with Unwritten Rule #4** (*"power comes from people, not magic"*). An origin-unknown orb is, on its face, magic. The plan resolves this with the hard line in §4: the Cairn grants *nothing* — no resources, units, or aid — it only points the way. Keep that rule strict. The moment the orb hands the player anything mechanical, it becomes the very thing the storyline warns against, and the rule breaks.
- **Art direction for the orb.** The Cairn needs a visual design: its form, the light-theme shadow / dark-theme glow inversion, the mood-color range, and the dull-stone-to-beacon progression across the six acts. A follow-on task — but it is the single most-seen element in the app, so it should not be left late.
- **Monetization ethics is a hard rule, not a guideline.** The comeback hook must never become an upsell. The Cairn marks the climb, never the coin. Re-read §6.7 before writing any Shop-adjacent copy.
- **The journey is descriptive, not enforced.** A player can technically skip ahead via the sandbox. That is acceptable — the journey *guides and frames*; it does not cage. (Phase 5 would change this.)
- **Theme flexibility.** The storyline defines five themes (Medieval default; Cyberpunk/SciFi/Modern/PostApocalyptic stubbed). The Cairn and the six-act arc are theme-agnostic in *structure* — an origin-unknown orb reads as a relic in Medieval and a core/beacon in Cyberpunk without a rewrite; only the *vocabulary* changes per kingdom theme. Keep the narrative layer (#1) theme-keyed from day one so this stays cheap.

---

## 12. Beyond this plan — captured follow-ups

This plan is deliberately **web-only, zero program changes** (§3, pillar 3). Work that needs the program, the SDK, or the CLI is *out of scope here* — but real, and captured below so it is not lost between now and when it is scheduled. **This is a living list.**

### 12.1 City seeding contradicts the storyline

- **What's wrong:** the CLI seeds the literal modern Earth. `sdks/novus-mundus-ts/cli/data/cities.ts` defines `CITIES` as **33 present-day cities** under their real names — *New York, Los Angeles, Paris, Rome, Tokyo…* — and the CLI city phase (`cli/lib/phases/cities.ts`) writes them on-chain via `batch_cities`.
- **What the storyline says:** `WORLD_LORE.md` §XI ("City Registry") defines **24 settlements of Novus Mundus** with post-Sundering names — *Valdenmoor, Coranthas, Solterrae, Shirevane…* — each *built on the ruins of* a real-world city, grouped into named kingdoms (*Ashenmere, Stormbreak Isles, Ironmarch, Greenvast*).
- **The gap:** wrong count (33 vs 24), wrong names (modern vs in-world), and no kingdom grouping at all. A player who picks a city today lands in "New York," not "Valdenmoor" — the most lore-breaking thing in the live data.
- **The fix touches:** the CLI city data, the SDK, and the Rust `INITIAL_CITIES` / `batch_cities` constants — a **program change**. Needs its own plan.
- **Why it matters to this plan:** the Arrival (§7.2) is built around *choosing where you make your stand.* Once the storyline's names + kingdoms are in the registry, the Arrival's city-choice screen inherits its real flavor for free — the Cairn names a *place*, not a zip code.

### 12.2 Dungeon names ignore the bestiary

- **What's wrong:** the CLI/SDK seeds four dungeons — *Goblin Caves, Shadow Crypt, Dragon's Lair, Abyssal Depths* — in `sdks/novus-mundus-ts/cli/data/dungeons.ts` (`name` fields, lines ~34–109), as generic fantasy locations with bare mechanical themes (RadiantWeakness, FastMobs…) and no creature lore.
- **What the storyline says:** §VI defines a five-tier bestiary of *wild forces* — Goblin Raiders, Troll Warlords, Wyverns, Dragons, Ancient Wyrms — each with specific behaviour and flavour (§XII), framed as "the natural order of a planet that never belonged to us," not as evil.
- **The gap:** "Shadow Crypt" and "Abyssal Depths" map to no creature in the storyline; even the ones that do (goblins, dragons) carry none of the bestiary's tiering or flavour.
- **The fix touches:** the CLI/SDK dungeon data, plus the program's dungeon config if names/tiers are stored on-chain.
- **Why it matters to this plan:** the Catacombs is an Act IV beat (§5). Aligning dungeon data with the bestiary lets the Cairn and encounter copy speak the storyline's language instead of stock fantasy.

### 12.3 The Ages have no on-chain existence

- **What's wrong:** there is no Age enum, constant, or kingdom-lifecycle state anywhere in `programs/novus_mundus/src/` — a search for *Ashes / Crowns / Dominion / Age* returns nothing.
- **What the storyline says:** §V makes per-kingdom **Ages** foundational — *Age of Ashes → Age of Crowns → Age of Dominion* — each a distinct phase of a kingdom's life (raw frontier → consolidating Houses → mature politics).
- **The gap:** the kingdom has no lifecycle. This plan's six acts (§5) *map onto* the Ages descriptively and client-side, but the kingdom itself never advances; nothing on-chain knows what age a kingdom is in.
- **The fix touches:** the program (kingdom state + an Age-transition rule) and web (surfacing it).
- **Why it matters to this plan:** §5 and §8 already lean on the Ages as the macro-arc behind the player's acts ("the Ages turn" in the Cairn's Report). Until the Age is real state, that backdrop is narration with nothing underneath it.

### 12.4 The five themes exist as an enum and nothing else

- **What's wrong:** `programs/novus_mundus/src/types.rs` defines a `Theme` enum with all five variants (Medieval, Cyberpunk, SciFi, Modern, PostApocalyptic) — but no kingdom-creation flow lets a kingdom be anything but Medieval, and there is no per-theme content (names, copy, art) anywhere.
- **What the storyline says:** the storyline frames the non-Medieval themes as the game's expansion path — alternate reinterpretations of the same core story.
- **The gap:** a large promised feature — five thematic worlds — is a dead enum. No player can experience a non-Medieval Novus Mundus.
- **The fix touches:** program/SDK (theme selection at kingdom creation) and web (per-theme content).
- **Why it matters to this plan:** §4 and §11 require the narrative layer to be theme-keyed from day one. That investment only pays off once themes are actually selectable — otherwise the Cairn's theme-keyed vocabulary is built for a feature that never ships.

### 12.5 Further changes — to be captured

> Out-of-scope items surface here as they are found. Each entry follows §12.1's shape: *what's wrong → what the storyline/design says → the gap → what the fix touches → why it matters here.*

---

## 13. The one-sentence version

*A nobody claims a ruin; a nameless stone at its heart marks every step of the climb — and the place it first called a ruin, six acts later — Foundation, First Blood, the House, Mastery, the Crown — it calls a crown.*
