# InfoButton Rollout Map

A survey-driven plan for adding inline tooltips across the Novus Mundus web app. Each row is a confusing UI term that needs a one-line explanation drawn from on-chain truth.

## What InfoButton is

`InfoButton` is a small clickable "i" that pops a short explanation next to a label. It lives at `apps/web/src/components/shared/InfoButton.tsx`.

Usage:

```tsx
Networth <InfoButton>Your total on-chain value: held units, weapons, cash, and vault. Excludes NOVI and gems.</InfoButton>
```

Drop it next to any label that needs a word of explanation. Keep copy short (it is a tooltip), plain, factual, and free of em-dashes.

## How to read this map

- Sections are grouped by gameplay domain.
- Each table row: **Location** (file + anchor), **Term**, **Suggested copy** (one line, under ~140 chars, sourced from on-chain mechanics), **Priority**.
- **P1** = high-confusion term in the core loop, ship first. **P2** = important but secondary. **P3** = nice-to-have polish.
- Each domain has a **Sources** subsection with `file:line` citations so a future editor can verify the numbers before merging.
- A trailing **Verify on chain** list flags terms whose copy was inferred and should be double-checked against current chain state.

Duplicate spots that point at the same term have been merged into one row.

---

## Estate

| Location (file + anchor) | Term | Suggested copy | Priority |
| --- | --- | --- | --- |
| `building-card.tsx` :205 | invested | Locked NOVI burned to build and upgrade this slot. It is spent, not refundable. | P1 |
| `building-grid.tsx` :347 | Open ground | An empty building slot on a plot you already own. Each plot gives 4 slots. | P2 |
| `building-grid.tsx` :358 | Ground to Break | Empty slots ready to build on. Building needs a free slot on an owned plot. | P2 |
| `building-grid.tsx` :377 | Land Beyond Your Claim | Plots you have not bought yet. Each adds 4 slots; you can own up to 5 plots (20 slots). | P2 |
| `building-card.tsx` (build/upgrade cost) | Build / Upgrade cost | Builds burn the base NOVI cost; each upgrade level costs 2.618x (phi squared) more, in locked NOVI. | P1 |
| `BuildingUpgradePanel.tsx` :71-72 | Hasten | Spend gems to cut the timer in half (leaves 50% of the time remaining), at 1x gem cost. | P1 |
| `BuildingUpgradePanel.tsx` :83-84 | Rush | Spend gems to leave 25% of the time remaining, at 2x the gem cost of Hasten. | P1 |
| `forge-tab.tsx` :604 | Tempering Stages | Tempering is a per-craft minigame: each stage is one timed strike that sets the item's quality. | P2 |
| `forge-tab.tsx` :606 | strikes | A strike is one timed input in the tempering minigame, not a combat action. More stages = more strikes. | P2 |
| `forge-tab.tsx` :614 | Strike Window | The time window when a strike lands cleanly. Hit inside it for higher precision. | P2 |
| `forge-tab.tsx` :171 | Perfect / Good / Fair / Glancing | Precision tiers from your strikes (90/70/40%). Higher precision raises the crafted item's quality. | P3 |
| `forge-tab.tsx` :159-162 | Heating | The warm-up phase before the strike window opens. Wait for the window, then strike. | P3 |
| `forge-tab.tsx` :182-186 | Missed / craft will fail | A missed strike window lowers that stage's precision; it does not auto-cancel the whole craft. | P3 |

### Sources

- Building build cost: `programs/novus_mundus/src/processor/estate/build.rs:107-117`; `programs/novus_mundus/src/state/building_template.rs:73-81`; `programs/novus_mundus/src/state/estate.rs:79-103`
- Upgrade cost (2.618x / phi^2 per level): `programs/novus_mundus/src/state/building_template.rs:68-81`; `programs/novus_mundus/src/processor/estate/upgrade.rs:98-114`
- Land plots (4 slots each, up to 5 plots / 20 slots): `programs/novus_mundus/src/state/estate.rs:410-417,638-652,680-682`
- Plot cost scaling (phi^2): `programs/novus_mundus/src/state/estate.rs:654-667`; `programs/novus_mundus/src/processor/estate/buy_plot.rs:87-95`
- Speedup tiers (50% @ 1x, 25% @ 2x): `programs/novus_mundus/src/processor/estate/speedup.rs:98-117`
- Locked NOVI (in-game, burned, not withdrawable): `programs/novus_mundus/src/constants.rs:48-52`; `programs/novus_mundus/src/processor/estate/build.rs:114-149`

---

## Heroes & Sanctuary

| Location (file + anchor) | Term | Suggested copy | Priority |
| --- | --- | --- | --- |
| `heroes-tab.tsx` :515, :532; `heroes/HeroDetailPanel.tsx` :118 | slots / locked / Locked · Slot | You have 3 hero slots. Locking a hero moves its NFT in and turns on its buffs. | P1 |
| `heroes-tab.tsx` :529 | Active Slots | Slots holding a locked hero whose buffs are live. A meditating hero earns XP but gives no buffs. | P2 |
| `heroes-tab.tsx` :571 | Sanctuary lv X unlocks | The Meditation Chamber caps how many heroes you can lock: 1 at Lv1-4, 2 at Lv5-9, 3 at Lv10-14. | P1 |
| `heroes-tab.tsx` :628 | Available | Heroes held in your wallet that are not locked into a slot yet. | P2 |
| `heroes/HeroSlotCard.tsx` :42 | DEF / MED / ACT | DEF = your defensive hero, MED = meditating (earning XP, no buffs), ACT = locked and active. | P2 |
| `heroes/HeroDetailPanel.tsx` :219; `heroes-tab.tsx` :520 | Cost / Fragments | Fragments level heroes (not SOL or gems). A level costs 10 x 1.5^level fragments. | P1 |
| `heroes/HeroDetailPanel.tsx` :227; `heroes-tab.tsx` :521 | Level cap / Cap: Lv X | Fragment leveling is capped by Sanctuary level: 10 at Lv1-4, 25 at Lv5-9, 50 at Lv10-14, 100 at Lv15+. | P1 |
| `heroes/HeroDetailPanel.tsx` :138 | Buffs | Persistent stat bonuses from a locked hero. They scale (sqrt phi)^level: ~1.27x at Lv1, ~11x at Lv10. | P2 |
| `heroes/AbilityCard.tsx` :51 | Signature Ability | One active ability per locked hero: a one-shot combat buff, or instant cash/fragments on use. | P2 |
| `heroes/AbilityCard.tsx` :61 | Cooldown | After use, that hero's ability is locked for its cooldown. The timer survives unlock and relock. | P2 |
| `heroes/TemplateDetailPanel.tsx` :110 | Burn value | Burning an unlocked hero pays locked NOVI = tier base x level^2 (Common 50 up to Mythic 25k base). | P2 |
| `heroes/TemplateDetailPanel.tsx` :103 | Required level | The player level you need to mint this hero. It is not the hero's level. | P2 |
| `heroes/TemplateDetailPanel.tsx` :92 | Origin | The hero's home city. Locking it there adds a tier bonus (+2% to +10%); some heroes can only meditate there. | P2 |
| `sanctuary-tab.tsx` :417 | Meditation rate | Free passive XP for a locked hero: Sanctuary level x 100 XP per hour. | P1 |
| `sanctuary-tab.tsx` :424 | max session | A session caps at 24h plus 3h per Sanctuary level above 1, up to 48h. Claim to bank the XP. | P2 |
| `sanctuary-tab.tsx` :378 | Est. XP Earned / XP | Meditation XP converts to hero levels on claim, up to the meditation cap. It is not fragments. | P2 |
| `sanctuary-tab.tsx` :466 | can only meditate in X | Some heroes meditate only in their origin city. You must be standing in that city or it is rejected. | P2 |
| `sanctuary-tab.tsx` :478 | meditation cap | Meditation only levels up to floor(10 x phi^(Sanctuary/5)): ~16 at Lv5, ~26 at Lv10. Past it, use fragments. | P1 |
| `heroes/HeroDetailPanel.tsx` :259 | Assign as Defender | Picks which locked hero defends you when attacked. Unlocking it auto-reassigns to the next filled slot. | P1 |
| `heroes-tab.tsx` :604-606 | +X.X% (hero buffs) | Each percent is a stat bonus from a locked hero, scaling (sqrt phi)^level. No randomness. | P3 |

### Sources

- Hero slots (3) and lock: `programs/novus_mundus/src/state/player.rs:443`; `programs/novus_mundus/src/processor/hero/lock.rs:55-93,118-122`
- Sanctuary lock limit (1/2/3 at Lv1-4/5-9/10-14): `programs/novus_mundus/src/helpers/estate.rs:264-284`; `programs/novus_mundus/src/processor/hero/lock.rs:76-88`
- Fragment level cost (10 x 1.5^level) and cap: `programs/novus_mundus/src/state/hero.rs:243-255`; `programs/novus_mundus/src/helpers/estate.rs:293-301`
- Buff scaling (sqrt phi)^level: `programs/novus_mundus/src/logic/golden_math.rs:33-65`; `programs/novus_mundus/src/state/hero.rs:155-162`
- Ability + cooldown: `programs/novus_mundus/src/state/hero.rs:11-19`; `programs/novus_mundus/src/processor/hero/use_ability.rs:107-157`
- Burn value (tier base x level^2): `programs/novus_mundus/src/state/hero.rs:492-508`; `programs/novus_mundus/src/processor/hero/burn.rs:72-77`
- Home/origin bonus and meditation city: `programs/novus_mundus/src/state/hero.rs:412-420,451-454,189-191`; `programs/novus_mundus/src/processor/hero/lock.rs:154-163`
- Meditation rate, session cap, level cap: `programs/novus_mundus/src/processor/sanctuary/start_meditation.rs:53-78`; `programs/novus_mundus/src/helpers/estate.rs:379-409,437-464`
- Assign defensive hero: `programs/novus_mundus/src/processor/hero/assign_defensive.rs:31-69`

---

## Team / Rally / Reinforce

| Location (file + anchor) | Term | Suggested copy | Priority |
| --- | --- | --- | --- |
| `team-tab.tsx` :1100-1102 | DU (Defensive Units) | Defensive Units: your combat army. They fight in encounters, PvP, rallies, and defense. | P1 |
| `team-tab.tsx` :1182-1186 | OP (Operative Units) | Operative Units: your economy and expedition workforce. They cannot fight in combat. | P1 |
| `team-tab.tsx` :1183 | PWR (Combat Power) | Combat power sums your units by tier (power 10 / 25 / 60). It is a deterministic stat, not a roll. | P2 |
| `team-tab.tsx` :1215-1239 | Reinforcements held | Defensive units teammates sent you and that are defending here now. A city holds up to 10,000. | P2 |
| `team-tab.tsx` :1086-1089 | Team Capacity (Members / max) | Max members follows the leader's tier: Rookie 5, Expert 10, Epic 25, Legendary 50. Refreshes on each join. | P1 |
| `team-tab.tsx` :2182-2192 | Instant Limit | Cash you can withdraw from the treasury per transaction with no wait. Set per rank; leader unlimited. | P2 |
| `team-tab.tsx` :2193-2203 | Daily Cap | Most cash a member can withdraw from the treasury per 24h day. Resets every 86,400s. | P2 |
| `team-tab.tsx` :2206-2212 | Cooldown | The wait before a requested withdrawal (above your instant limit) becomes executable. Default 8h, range 1-72h. | P2 |
| `team-tab.tsx` :1473-1490 | Request Withdrawal vs Withdraw | Amounts above your instant limit need a request; it pays out after the cooldown or when a higher rank approves it. | P2 |
| `rally-tab.tsx` :527-534, :816-835 | Gathering / Gather Window | Recruiting phase: teammates travel in. Default 1h (3600s); after gather_at no one can join and the march starts. | P1 |
| `rally-tab.tsx` :525-526 | joined / max participants | Rally size cap by tier: 3 / 5 / 10 / 20, times hero rally buff, plus 5% per Citadel level, capped at 255. | P1 |
| `rally-tab.tsx` :512-513 | Rally Status | Gathering, then Marching (army moves to target), then Combat, then Returning home, then Completed or Cancelled. | P1 |
| `reinforce-tab.tsx` :464,529; `ReinforcementDetailPanel.tsx` :34 | Reinforcement Status | Traveling (en route), Active (arrived and defending), Returning (recalled or relieved), Completed (reclaimed). | P1 |
| `reinforce-tab.tsx` :592-595 | Process Arrival | Cranks an arrived reinforcement from Traveling to Active so its units start defending. | P2 |
| `reinforce-tab.tsx` :604-608; `ReinforcementDetailPanel.tsx` :289 | Relieve | The receiver sends active reinforcements back home; returns scale by the survival ratio of the units defending. | P1 |
| `reinforce-tab.tsx` :598-601 | Recall (vs Relieve) | The sender pulls their own reinforcements back. Relieve is the receiver doing it. Both head home. | P1 |
| `team-tab.tsx` :469-475 | Rally Bonus | Rally damage shifts with time of day; night drive-bys (10k+ units) add an extra multiplier. | P3 |

### Sources

- Defensive vs operative units: `programs/novus_mundus/src/constants.rs:210-222,304-309`; `programs/novus_mundus/src/state/player.rs:1979-1983`
- Team max members by leader tier: `programs/novus_mundus/src/constants.rs:46`; `programs/novus_mundus/src/state/team.rs:347-360`; `programs/novus_mundus/src/processor/team/join.rs:97-118`
- Rally capacity (3/5/10/20, hero buff, +5%/Citadel level, cap 255): `programs/novus_mundus/src/state/game_engine.rs:524-564`; `programs/novus_mundus/src/processor/rally/create.rs:221-243`; `programs/novus_mundus/src/helpers/estate.rs:750-758`
- Rally lifecycle: `programs/novus_mundus/src/state/rally.rs:9-22,44-51`
- Gather deadline (default 3600s): `programs/novus_mundus/src/constants.rs:35`; `programs/novus_mundus/src/processor/rally/create.rs:138-143`
- Reinforcement lifecycle and cap (10,000): `programs/novus_mundus/src/state/reinforcement.rs:31-52`; `programs/novus_mundus/src/constants.rs:107`; `programs/novus_mundus/src/processor/reinforcement/send.rs:185-198`
- Recall / relieve / survival ratio: `programs/novus_mundus/src/processor/reinforcement/recall.rs:70-137`; `programs/novus_mundus/src/processor/reinforcement/relieve.rs:77-123`; `programs/novus_mundus/src/state/player.rs:2017-2037`
- Treasury limits, cooldown, daily reset: `programs/novus_mundus/src/state/team.rs:90-179,562-573`; `programs/novus_mundus/src/processor/team/withdraw_treasury.rs:132-149`; `programs/novus_mundus/src/processor/team/treasury_request_withdraw.rs:138-186`

---

## Castle / King / Economy

| Location (file + anchor) | Term | Suggested copy | Priority |
| --- | --- | --- | --- |
| `castle-tab.tsx` :872-873 | Garrison (count) | Teammates defending the castle. Slots cap by king tier: Rookie 5, Expert 10, Epic 15, Legendary 25. | P2 |
| `castle-tab.tsx` :147-160 | Garrison contribution | You commit defensive units, weapons, and one hero to defend the castle. They are held in the garrison, not consumed up front. | P2 |
| `castle-tab.tsx` :329 | Protection (castle status) | Protected = safe from attack. A new or claimed castle gets a 10-day window, extended by the watchtower. | P1 |
| `NoviView.tsx` :110 | Reserved Novi | Purchased NOVI lands in Reserved (withdrawable). It must vest 7 days, or convert it to Locked to spend in-game. | P1 |
| `NoviRewards.tsx` :92 | Vesting | Reserved NOVI must wait 7 days after it is earned before you can withdraw it to your wallet. | P1 |
| `NoviRewards.tsx` :170 | Locked vs Reserved vs Wallet | Locked = in-game fuel (not withdrawable). Reserved = withdrawable after 7-day vest. Wallet = on-chain SPL NOVI. | P1 |
| `dashboard/page.tsx` :280 | Net Worth | Sum of your units, weapons, armor, produce, vehicles, plus cash and vault. Excludes NOVI and gems. | P1 |
| `subscribe-tab.tsx` :240 | NOVI generation multiplier | Locked NOVI mints every 5 min by tier: Rookie 50, Expert 100, Epic 500, Legendary 2,500 (display). | P1 |
| `subscribe-tab.tsx` :290 | maxLockedNovi cap | Your locked-NOVI store caps by tier (3k / 6k / 30k / 150k display); generation stops at the cap. The Vault raises it. | P2 |
| `subscribe-tab.tsx` :295 | Daily purchase limit | The most NOVI you can buy from the shop per day. Set by subscription tier; resets each 24h day. | P2 |
| `subscribe-tab.tsx` :310 | drays (grant) | Drays are vehicles granted by a charter. Vehicles count toward networth, separate from units and weapons. | P3 |
| `subscribe-tab.tsx` :175 | vault shrinks if charter lapses | If your charter lapses you drop to the free tier cap; locked NOVI above it stops generating, but teammates are never kicked. | P2 |
| `barracks-tab.tsx` :100,:152 | Defensive Power | Sums your defensive units by power 10 / 25 / 60 (tier 1 / 2 / 3). It is a deterministic stat. | P1 |
| `barracks-tab.tsx` :160-161 | defenders without a weapon | Unarmed defenders fight at reduced coverage. Arm them with matching weapons for full damage output. | P2 |
| `camp-tab.tsx` :110,:146 | Operative Power | Sums your operatives by yield 1.0x / 1.5x / 2.0x. It drives expedition output, not combat. | P1 |
| `camp-tab.tsx` :115,:152 | operatives going hungry | A produce deficit means operatives are not fully fed, which lowers happiness and their effective output. | P2 |
| `vault-tab.tsx` :75 | 75% vault protection | Cash placed in the vault keeps 75% of its worth in a raid, versus cash on hand which is more exposed. | P2 |
| `mansion-tab.tsx` :145 | Streak multiplier | Login streak multiplies your daily reward (1.5x at day 7, 2.5x at day 30). Missing a day resets it. | P2 |
| `mansion-tab.tsx` :175 | Permanent Bonuses (mansion) | Each mansion level adds a permanent reward bonus (Lv5 = +2.5%) applied to your estate rewards. | P3 |
| `NoviGenerator.tsx` :170 | Rate /5m | Locked NOVI mints once every 5 minutes at your tier's rate, until your locked-NOVI cap is reached. | P2 |
| `NoviView.tsx` :165 | bulk / subscription / streak bonus | Shop NOVI packs add bulk, subscription, and streak bonuses to the minted reserved NOVI before the daily cap. | P3 |
| `dashboard/page.tsx` :265 | Vault accounting | The on-chain locked-NOVI store, which may lag the displayed wallet figure between syncs. | P3 |
| `NoviRewards.tsx` :265 | Deposit fee | Converting Reserved into Locked NOVI burns a small fee (DEPOSIT_FEE_BPS); it is permanent, not refundable. | P2 |

### Sources

- Garrison capacity by king tier: `programs/novus_mundus/src/constants.rs:596`; `programs/novus_mundus/src/processor/castle/claim_vacant_castle.rs:197-203`; `programs/novus_mundus/src/processor/castle/join_garrison.rs:98-145`
- Castle protection (10 days, watchtower extension): `programs/novus_mundus/src/constants.rs:586`; `programs/novus_mundus/src/state/castle.rs:411-413,438-444`; `programs/novus_mundus/src/processor/castle/create_castle.rs:273`
- Reserved NOVI (7-day vest, withdrawable): `programs/novus_mundus/src/processor/token/withdraw_reserved.rs:18-129`; `programs/novus_mundus/src/constants.rs:23`
- Reserved to locked (one-way): `programs/novus_mundus/src/processor/token/reserved_to_locked.rs:17-21`
- Networth: `programs/novus_mundus/src/logic/calculations.rs:5-87`
- Locked NOVI generation rate and caps: `programs/novus_mundus/src/processor/economy/update_locked_novi.rs:34-160`; `programs/novus_mundus/src/state/game_engine.rs:458-459`
- Vault cap bonus: `programs/novus_mundus/src/processor/economy/update_locked_novi.rs:50-138`
- Subscription tiers and daily cap: `programs/novus_mundus/src/processor/subscription/purchase.rs:346-471`; `programs/novus_mundus/src/processor/shop/purchase_novi.rs:18-231`
- Unit power / operative yields: `programs/novus_mundus/src/constants.rs:210-222,304-309`

---

## Map / Combat / Units

| Location (file + anchor) | Term | Suggested copy | Priority |
| --- | --- | --- | --- |
| `barracks-tab.tsx` :165-200; `TripleCountInput.tsx` :5-8; `UnitGrid.tsx` :32-44 | Infantry / Cavalry / Siege (defensive) | Defensive tiers by power 10 / 25 / 60 and HP 2 / 5 / 12. Arm them with Melee / Ranged / Siege weapons in turn. | P1 |
| `camp-tab.tsx` :154-190; `UnitGrid.tsx` :32-44 | Laborer / Artisan / Engineer (operative) | Operative tiers yielding 1.0x / 1.5x / 2.0x. They work expeditions and the economy; they never fight. | P1 |
| `expedition-tab.tsx` :241; `EncounterDetailPanel.tsx` :241-245 | Stamina | Regenerates 1 point per 5 min (more at night). Max by tier: Rookie 100, Expert 500, Epic 1000, Legendary 10000. | P1 |
| `EncounterDetailPanel.tsx` :241-245 | Stamina Cost (by rarity) | Per attack: Common 10, Uncommon 25, Rare 50, Epic 100, Legendary 250, World Event 500 stamina. | P1 |
| `EncounterDetailPanel.tsx` :268-274 | Level gap too wide | You can only attack encounters within 30 levels of yours, above or below. A wider gap is blocked. | P1 |
| `expedition-tab.tsx` :608-631 | Tier (expedition) | Tiers 0-4 run 1-16h, each gating on a building level and locked NOVI (100 / 500 / 2k / 8k / 30k). Higher tiers raise rare-find odds. | P2 |
| `expedition-tab.tsx` :530,:515 | Strike (expedition) | One strike unlocks per elapsed hour; your average strike score lifts the expedition's final yield. | P2 |
| `expedition-tab.tsx` :689 | Bonus Fragments | Fragments from an expedition. Fragments level your heroes (10 x 1.5^level each); they are not bought. | P2 |
| `expedition-tab.tsx` :635-645 | Operatives to Send (cap) | Output scales with operatives but with sqrt diminishing returns, so doubling the squad does not double the yield. | P2 |
| `TargetTravel.tsx` :242 | Travel (intracity) | Within a city you always walk at 5 km/h; Stables cuts that time. Intercity travel uses theme speed over distance. | P2 |
| `castle-tab.tsx` :329 | Castle status (Vacant/Contest/Protected/Vulnerable) | Attackable only when Contest (2h window after a claim) or Vulnerable. Protected and Vacant cannot be attacked. | P1 |
| `CombatForecastPanel.tsx` :49 | Underarmed coverage | Each defender needs a weapon for full damage; unarmed units fight at reduced weapon coverage. | P2 |

### Sources

- Stamina (regen, tier caps): `programs/novus_mundus/src/constants.rs:237-247`; `sdks/novus-mundus-ts/src/calculators/stamina.ts:39-73`
- Encounter stamina cost by rarity: `programs/novus_mundus/src/constants.rs:228-235`; `programs/novus_mundus/src/processor/combat/attack_encounter.rs:181-185`
- Encounter level band (30): `programs/novus_mundus/src/processor/combat/attack_encounter.rs:187-197`; `programs/novus_mundus/src/state/game_engine.rs:434`
- Unit power / HP and operative yields: `programs/novus_mundus/src/constants.rs:210-222,304-309`; `programs/novus_mundus/src/state/player.rs:1979-1983`
- Expeditions (tiers, time, building gate, NOVI cost): `programs/novus_mundus/src/constants.rs:257-294`; `programs/novus_mundus/src/processor/expedition/start.rs:117-178`
- Fragments source and cost: `programs/novus_mundus/src/processor/expedition/claim.rs:396-416`; `programs/novus_mundus/src/state/hero.rs:243-255`
- Intracity vs intercity travel: `programs/novus_mundus/src/logic/location.rs:208-253`; `programs/novus_mundus/src/constants.rs:39-40`
- Castle attack windows and range: `programs/novus_mundus/src/processor/castle/attack_castle.rs:86-143`; `programs/novus_mundus/src/state/castle.rs:93-123,370-385`
- Damage output / weapon coverage: `programs/novus_mundus/src/logic/combat.rs:354-427`

---

## Verify on chain

These UI terms had no exact on-chain explanation in the supplied truth set, or the suggested copy was inferred from adjacent mechanics. Confirm the live values before merging the tooltip.

- **Forge / Tempering minigame** (`forge-tab.tsx` strikes, strike window, precision tiers, heating, missed): the precision thresholds (90/70/40) and the heating/missed state machine are client-side. Confirm against the crafting processor that a missed window only lowers precision and never hard-cancels the craft, and that precision actually maps to item quality.
- **Mansion permanent bonus / login streak** (`mansion-tab.tsx`): confirm the exact per-level percentage (Lv5 = +2.5%) and which rewards the streak multiplier applies to (daily NOVI vs all estate rewards).
- **Vault raid protection 75%** (`vault-tab.tsx`): confirm the 75% retention is a flat keep-rate per raid and what triggers a raid, against the raid/PvP processor.
- **Deposit fee** (`NoviRewards.tsx` :265): confirm DEPOSIT_FEE_BPS is burned (not routed to treasury) and whether it varies by tier.
- **Drays** (`subscribe-tab.tsx` :310): confirm drays are the "vehicles" networth category and the per-tier grant amounts in the current charter config.
- **Vault accounting desync** (`dashboard/page.tsx` :265): confirm whether the two displayed NOVI numbers are a normal sync lag or signal a real wallet/state mismatch before writing reassuring copy.
- **Rally time-of-day bonus** (`team-tab.tsx` :469-475): confirm the day/night rally multiplier values and the 10k-unit drive-by threshold against `programs/novus_mundus/src/logic/combat.rs:380-388`.
- **PWR / Combat Power formula** (`team-tab.tsx` :1183): the survey calls the formula opaque. Confirm whether the displayed PWR is the raw tier-weighted unit sum or includes weapon/hero/research multipliers before describing it.
