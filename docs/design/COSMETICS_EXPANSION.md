# Cosmetics Expansion — Awarded vs. Buyable

Status: §3 (Buyable) being implemented this pass · §2 (Awarded) deferred.
Last touched: 2026-05-26.

This document proposes the next wave of cosmetics for Novus Mundus and splits
every proposed entry into **Awarded** (gated by gameplay / time / subscription /
event) or **Buyable** (direct shop purchase). The split is deliberate: today
the entire catalog is shop-only, which means free players have no on-ramp into
the cosmetic system and the system reads as pay-to-decorate. A healthy mix is
roughly 50% awarded, 20% sub-perk, 20% shop, 10% time-bounded event drops — for
this document the four sub-buckets collapse into the two top-level sections.

> **Current scope.** §2 (Awarded) is on hold until the `award_cosmetic`
> instruction and the per-loop hook design have been studied — the chain
> change is non-trivial and warrants its own pass. §3 (Buyable) is the
> working scope: catalog rows for the three already-wired kinds plus a chain
> extension to wire AvatarFrame (kind=0). Any entry tagged as "awarded later"
> stays buyable in the meantime — moving it requires the chain work in §4.

---

## 1. Context

The on-chain `CosmeticsSection` allocates **six** kind slots, each backed by
`equipped_<kind>: u16` + `owned_<kind>: u64` (max 64 ids per kind). Item-type
ranges in the shop catalog are the only handle the chain exposes for buying a
cosmetic — `fulfill_item` decodes `item_type → (kind, id)` and flips the
matching `owned_<kind>` bit. The ranges live in
`programs/novus_mundus/src/processor/shop/common.rs` (`COSMETIC_*_BASE`):

| Kind | Wired? | Item-type range | Catalog density (web) |
|------|--------|-----------------|-----------------------|
| Badge (`kind=3`) | yes | 1000–1063 (`COSMETIC_BADGE_BASE + id`) | 5/64 |
| Title (`kind=2`) | yes | 1064–1127 (`COSMETIC_TITLE_BASE + id`) | 6/64 |
| Name color (`kind=1`) | yes | 1128–1191 (`COSMETIC_COLOR_BASE + id`) | 6/64 |
| Avatar frame (`kind=0`) | yes | 1192–1255 (`COSMETIC_FRAME_BASE + id`) | 4/64 |
| Attack effect (`kind=4`) | reserved — rejected by `fulfill_item` until wired | 1256–1319 (`COSMETIC_EFFECT_BASE + id`) | 0/64 |
| Victory pose (`kind=5`) | reserved — rejected by `fulfill_item` until wired | 1320–1383 (`COSMETIC_POSE_BASE + id`) | 0/64 |

The 1256–1383 reserved block is explicitly rejected with `InvalidParameter`
in `fulfill_item` rather than silently no-op'd, so a misconfigured shop
listing in that range fails atomically and refunds the buyer. The
`is_inventory_item_type` helper carves out the whole 1000–1383 block as
non-inventory so any catalog change in this window doesn't need a parallel
edit there.

Two further kinds — **Banner** and **City/Castle Skin** — are not in the enum;
adding them is a chain section extension (new `equipped_*` + `owned_*` fields).

### What ships today

- Shop UI cosmetics tab and `/cosmetics` wardrobe (purchase → equip end-to-end)
- Catalog entries: 5 badges, 6 titles, 6 colors (3 deactivated for off-theme),
  6 animated colors, 4 frames — all shop-only
- On-chain `fulfill_item` cosmetic branches for badge/title/color/frame
- `equip` ix at discriminator 322 (uses `load_checked_mut_by_key` for
  discriminator + canonical-PDA validation)
- Shop's bundle and flash-sale paths pre-scan their items for cosmetics and
  unlock `EXT_COSMETICS` ahead of `fulfill_item` so cosmetics-in-bundles
  actually deliver instead of silently no-op'ing
- Wardrobe preflights `EXT_COSMETICS` before submitting equip, so a player
  who never bought a cosmetic gets a clear gate message instead of a
  guaranteed-fail tx
- Already-owned/sold-out/daily-cap UI states in the shop tab and wardrobe

### What is missing for an awarded path

Today the only way to land a bit in `owned_<kind>` is `purchase_item` through
the shop. There is no chain instruction that grants a cosmetic outside the
shop. **Adding awarded cosmetics requires a new instruction** — most likely
`award_cosmetic { kind, id }` signed by the game engine authority, called as
part of the existing gameplay completion flows (PvP win, dungeon clear,
streak rollover, event tick). Without this, every entry in §2 stays
unobtainable no matter how many catalog rows we add.

---

## 2. Awarded

These cosmetics are obtained through play, time, subscription, or event
participation. They cannot be purchased directly. Their value comes from the
fact that someone wearing them did the thing.

### 2.1 Within existing kinds

#### Badges (currently 5/64; target ~25/64)

| Id | Name | Rarity | Source |
|----|------|--------|--------|
| — | Mountain Walker | rare | Visited every city in the realm |
| — | Hundred Battles | rare | 100 PvP wins |
| — | Subterranean Scholar | epic | Cleared every dungeon at least once |
| — | Rally Captain | epic | Led 50 successful rallies |
| — | Reinforcer | rare | Sent ≥100k reinforcement units lifetime |
| — | Trade Baron | epic | Lifetime shop spend ≥ tier-3 milestone |
| — | Bronze Loyalist | rare | 30 cumulative days with active subscription |
| — | Silver Loyalist | epic | 90 cumulative days |
| — | Gold Loyalist | legendary | 365 cumulative days |
| — | Ember Loyalist | mythic | 1000 cumulative days |
| — | Day-One Quill | mythic | Registered in opening cohort (date-bounded) |
| — | Beta Witness | legendary | Registered during beta window (date-bounded) |
| — | Solstice 2026 | legendary | Owned during the 2026 solstice event window |
| — | Harvest Wake | legendary | Participated in Harvest event |
| — | Eclipse Witness | mythic | Logged in during the Eclipse event |
| — | Black Moon Survivor | mythic | Survived the Black Moon event without dying |

#### Titles (currently 6/64; target ~25/64)

| Id | Name | Rarity | Source |
|----|------|--------|--------|
| — | Berserker | rare | 1000 PvE kills |
| — | Sentinel | epic | Successfully defended team plot 100 times |
| — | Slayer | epic | 1000 encounters defeated |
| — | Marshal | legendary | Won an arena season |
| — | Magistrate | epic | Held team treasurer role 30 days |
| — | Bursar | rare | Top-3 team treasury contributor 3 months running |
| — | Steward | rare | Founded a team |
| — | Augur | epic | Correctly predicted an event outcome (TBD mechanic) |
| — | Lorekeeper | legendary | Read every storyline beat |
| — | Cartographer | rare | Mapped every cell of any one city |
| — | Pathfinder | epic | Walked from any pole to the opposite pole |
| — | Dedicated | rare | 30-day current subscription streak |
| — | Unwavering | legendary | 180-day current subscription streak |
| — | Quillbearer | mythic | Awarded by storyline (one-shot) |

Note: `Dedicated` and `Unwavering` are already referenced in
`mansion-tab.tsx`'s milestone copy ("Dedicated title", "Unwavering title"); the
chain side and catalog rows need to land for the existing milestone text to
actually mean something.

#### Name colors (currently 6/64; target ~15–20/64)

| Id | Name | Rarity | Source |
|----|------|--------|--------|
| 1 | Parchment Ink *(existing)* | common | Default — everyone has this |
| — | Mossbark | rare | First city built |
| — | Goldleaf-Awarded | legendary | Reach Legendary subscription tier (separate id from the buyable Goldleaf) |
| — | Iridescent | mythic | Realm-wide community milestone unlock |

### 2.2 Within enum-allocated but unwired kinds

These three kinds are in the `CosmeticsKind` enum but have no item-type range
or `fulfill_item` decoding yet. Wiring them is a chain change (new range
allocations + decoder arms).

#### Avatar frames (kind=0)

| Id | Name | Rarity | Source |
|----|------|--------|--------|
| — | Iron Buckler | rare | First PvP win |
| — | Founder's Wreath | mythic | Opening cohort registration |
| — | Eclipse Cradle | mythic | Eclipse event drop |

#### Attack effects (kind=4)

| Id | Name | Rarity | Source |
|----|------|--------|--------|
| — | First Spark | common | Granted on first PvP win — every player's starter effect |
| — | Verdant Burst | epic | Sanctuary level ≥ 20 |
| — | Sigil Sealed | legendary | Cleared every dungeon |
| — | Eclipse Strike | mythic | Eclipse event drop |

#### Victory poses (kind=5)

| Id | Name | Rarity | Source |
|----|------|--------|--------|
| — | Salute | common | Default — granted at player init |
| — | Banner Raise | rare | Won a rally |
| — | Crown Lift | legendary | Held the top leaderboard spot for ≥1 day |
| — | World Tree Bloom | mythic | Realm-wide community milestone |

### 2.3 New chain sections (not yet in `CosmeticsSection`)

Requires extending the on-chain section with new `equipped_*` + `owned_*`
slots. Bigger chain change; bigger surface return.

#### Banners (personal + team)

| Id | Name | Rarity | Source |
|----|------|--------|--------|
| — | Founding Banner | mythic | Opening cohort registration |
| — | Victorious Standard | legendary | Won 100 rallies as leader |
| — | Team's First Plot | rare | Awarded to team at first plot claim |
| — | Realm Champion Standard | mythic | Awarded to the team that wins a season |

Team banners are equipped by the team leader on the team account, not the
player account — that's a separate chain change beyond just adding a section.

#### City/Castle skins

| Id | Name | Rarity | Source |
|----|------|--------|--------|
| — | Stone Keep | common | Default — every player starts with this |
| — | Founding Castle | mythic | Visible-on-the-map cohort marker |

---

## 3. Buyable

These cosmetics are direct SOL purchases through the existing shop pipeline.
They lean toward visual flair over prestige — the highest-rarity flashy
options live here, while the truly-prestigious options live in §2.

### 3.1 Within existing kinds

#### Badges (existing buyables + proposed additions)

| Id | Name | Rarity | Status |
|----|------|--------|--------|
| 1 | Kingdom Pioneer | epic | **shipped** |
| 2 | Genesis Patron | mythic | **shipped** |
| 3 | Vanguard's Mark | legendary | **shipped** |
| 4 | Forgemaster | rare | **shipped** |
| 5 | Wanderer | common | **shipped** |
| — | Crowned Patron | mythic | new — flair, no gameplay tie |
| — | Sigilbearer | legendary | new |
| — | Sun-Sealed | epic | new |
| — | Goldleafed | rare | new |

#### Titles (existing buyables + proposed additions)

| Id | Name | Rarity | Status |
|----|------|--------|--------|
| 1 | Wayfarer | common | **shipped** |
| 2 | Hearthkeeper | rare | **shipped** |
| 3 | Stormcaller | epic | **shipped** |
| 4 | Dungeon Conqueror | legendary | **shipped** (re-issue as awarded once §2 lands) |
| 5 | Treasury Whale | legendary | **shipped** |
| 6 | Realm Pillar | mythic | **shipped** |
| — | Patron | rare | new |
| — | Maecenas | epic | new |
| — | Endowed | legendary | new |
| — | Skirmisher / Lancer / Crossbowman | rare | new (combat-archetype tier) |

#### Name colors (existing buyables + proposed additions)

| Id | Name | Rarity | Status |
|----|------|--------|--------|
| 1 | Parchment Ink | common | **shipped** |
| 2 | Mossbark | rare | **shipped** (re-issue as awarded once §2 lands) |
| 3 | Ember | rare | **shipped** |
| 4 | Royal Purple | epic | **shipped** |
| 5 | Goldleaf | legendary | **shipped** (re-issue as awarded once §2 lands) |
| 6 | Iridescent | mythic | **shipped** (re-issue as awarded once §2 lands) |
| — | Copper | rare | new |
| — | Electrum | epic | new |
| — | Mithril | legendary | new |
| — | Adamantine | legendary | new |
| — | Obsidian | mythic | new |
| — | Pulse (animated) | mythic | new — breathing alpha |
| — | Embered (animated) | mythic | new — occasional sparkle |
| — | Frostlace (animated) | mythic | new — subtle ice shimmer |
| — | Aurora (animated) | mythic | new — slow 3-hue gradient |
| — | Cinder (animated) | mythic | new — drifting heat |

Animation lives entirely in the off-chain catalog (CSS keyframes / SVG `<animate>`).
The chain just stores the u16 id — no chain change to add animated colors.

### 3.2 Within enum-allocated but unwired kinds

#### Avatar frames (kind=0)

| Id | Name | Rarity | Source |
|----|------|--------|--------|
| — | Parchment Scroll | common | shop |
| — | Royal Crest | epic | shop |
| — | Dragon Coil | legendary | shop |
| — | Starlight Aureole | mythic | shop |

#### Attack effects (kind=4)

| Id | Name | Rarity | Source |
|----|------|--------|--------|
| — | Sparkflash | common | shop |
| — | Ember Trail | rare | shop |
| — | Lightning Mark | epic | shop |
| — | Sigil-cast (animated) | legendary | shop |

#### Victory poses (kind=5)

| Id | Name | Rarity | Source |
|----|------|--------|--------|
| — | Tome Open | epic | shop |
| — | Lightning Brandish | legendary | shop |
| — | Phoenix Wake | mythic | shop |

### 3.3 New chain sections

#### Banners

The buyable banner system is **combinatorial**: instead of 64 fixed banners,
sell ownership of *field* tinctures (8 options: argent, or, gules, azure,
vert, purpure, sable, ermine) and *charge* devices (a wider set: lion, eagle,
wolf, tower, axe, oak, sun, anchor, etc.). The equipped slot stores
`(field_id, charge_id)`. This swaps "buy a banner" for "buy components, design
your own" — far more identity per art unit.

| Component | Rarity ladder | Notes |
|-----------|---------------|-------|
| Field tincture | common → epic | Sable (black) / Or (gold) gated at epic; rest common-rare |
| Charge device | common → legendary | Tower / sun / oak common; dragon / phoenix legendary |
| Border style | epic → mythic | A frame *around* the banner — engrailed, embattled, etc. |

The chain section change here is non-trivial: it adds at minimum three new
u64 ownership bitmasks (fields, charges, borders) and three new u8/u16
equipped slots — and the equipped state is a *tuple*, not a single id.

#### City/Castle skins

| Id | Name | Rarity | Source |
|----|------|--------|--------|
| — | Sky-Spire | epic | shop |
| — | Sand Fortress | epic | shop |
| — | Ironwood Hold | legendary | shop |
| — | Coral Pavilion | legendary | shop |
| — | Obsidian Tower | mythic | shop |

Castle skins are visible to every other player who pans past your city on the
world map — high surface area, whale-tier price band ($50–$500 historically
for comparable products).

---

## 4. Distribution mechanics

For every cosmetic, **how does it land in `owned_<kind>`?** Today only the
shop's `purchase_item` flips ownership bits. The awarded categories below
each need a different on-chain path:

| Source category | On-chain path | Notes |
|-----------------|---------------|-------|
| Shop purchase (Buyable) | `purchase_item` → `fulfill_item` (existing) | Already shipped |
| Achievement-earned | **new** `award_cosmetic { kind, id }` ix, called by the program at completion of the qualifying event | Signed by game engine authority; players cannot call it directly |
| Subscription perk | Same `award_cosmetic` ix, called during `subscribe`/renewal flow when the streak crosses a threshold | Requires reading the cumulative-days field on the player |
| Time-bounded event drop | Same `award_cosmetic` ix, called during the event's claim instruction (TBD per-event mechanic) | The event drives whose `owned_<kind>` bit flips |
| Cohort marker | One-shot `award_cosmetic` ix during `init_player` when `now < cohort_cutoff` | Decision: gate by registration timestamp on chain |
| Realm-wide milestone | One-shot `award_cosmetic_realm_wide { kind, id }` ix that iterates all players (or, more practically, marks a flag on `GameEngine` and lets each player claim their bit lazily on next interaction) | Lazy claim is the only scalable shape |

**Key chain work for §2 to actually function:**

1. `award_cosmetic { kind, id }` — single-player award by the program
2. Hook this ix into existing completion flows:
   - PvP win → potentially award starter `First Spark` attack effect on first
     win, achievement badges at milestone counts
   - Dungeon clear → progress toward `Subterranean Scholar` + `Sigil Sealed`
   - Subscription rollover → loyalty badges and `Dedicated` / `Unwavering` titles
   - City visit → progress toward `Mountain Walker`
3. Per-player counters on `PlayerAccount` for the milestone trackers that
   don't already exist (e.g. cities-visited bitmask, dungeons-cleared bitmask)
4. A lazy "claim my realm milestone" path so we don't iterate all players
   on chain

---

## 5. Prioritization

In order of cost-adjusted impact:

1. **Catalog density within existing kinds + the award ix.** Brings badges,
   titles, and name colors from 5–6/64 to ~25/64 with a healthy awarded mix.
   The infrastructure work (the `award_cosmetic` ix and hooking it into PvP /
   dungeon / sub flows) unlocks every awarded entry in §2 at once. **Single
   biggest unlock** — without it, awarded cosmetics cannot exist.
2. **Wire AttackEffect (kind=4).** Plays on every fight — highest LTV touchpoint
   per the frequency-times-visibility model. Chain change is a single new
   item-type range + decoder arm.
3. **Wire VictoryPose (kind=5).** Emotional-peak monetization — players are
   maximally happy right after a win. Same chain shape as attack effect.
4. **Wire AvatarFrame (kind=0).** Subtle but always-visible. Pairs naturally
   with badges (frame around the device). Same chain shape.
5. **Banner (new chain section).** Substantial chain change; biggest visibility
   surface on the world map. Team banner is the wedge for team-leader monetization.
6. **City/Castle skin (new chain section).** Whale-tier capstone. Largest
   per-player footprint on the world map. Share chain infrastructure with
   banners.

Items 1–4 share the shop+wardrobe scaffolding that's already shipped — only
catalog rows, chain ranges, and the award ix grow. Items 5–6 each need a new
chain section, new SDK surface, and new render surface (banners and castles
need to show up on the world map).

---

## 6. Open questions

- Should the realm-milestone awarded cosmetics be **automatic-lazy** (claimed
  on the player's next interaction) or **opt-in claim** (the player has to
  press a button to take it)? Lazy is cheaper; opt-in is a UX moment that
  surfaces the milestone.
- For combinatorial banners, do we keep `equipped_banner: u16` or do we
  redesign the section to hold `(field_id: u8, charge_id: u8, border_id: u8,
  equipped_marker: bool)`? The latter is the better data model but is a
  bigger chain reshape.
- Should "Dungeon Conqueror" (currently a buyable mythic title) be retired
  from the shop and re-issued as an awarded title? Migration cost: anyone who
  already owns it via shop is fine; the awarded path opens up for everyone
  else.
- Animated name colors — do we cap them at the inspection panel or also run
  them at every dot on the world map? Capping is the performance-safe call;
  the user-perception cost of "my color doesn't pulse on the disc" is probably
  acceptable.
