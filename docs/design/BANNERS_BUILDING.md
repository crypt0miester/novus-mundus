# Building Banners + Milestone Flash

Status: TODO (design).
Last touched: 2026-05-28.
Source-of-truth pipeline: Bonsai (`images/bonsai/`), running locally on
`TCP 127.0.0.1:8000`. Per [[feedback_krea_sequential]] generations run one at
a time — batch this overnight rather than fanning out.

## The two surfaces, two treatments

Buildings split into two camps:

1. **View-tabs without baked art (9 buildings).** Each has its own
   `<building>-tab.tsx` and a `ShowcaseBanner` slot at the top, but none of
   them actually mount the banner (or they mount it pointing at nothing).
   These need: a 16:9 banner backdrop + the ShowcaseBanner mount.
2. **No-view buildings (6 buildings).** Citadel, Observatory, Treasury,
   MeditationChamber, TransportBay, Stables. Players never open a "tab" for
   these — they only ever see them as cards in `building-grid.tsx`, and the
   only moment the building is the centre of attention is when it *finishes
   building* or *upgrades a tier*. Don't waste a 16:9 banner on chrome they'll
   never see; instead, make the banner the **reward beat itself** (see §3
   below).

The view-tabs that already have baked art (`barracks, camp, forge, infirmary,
market, sanctuary`) are not in scope here; they're shipped.

## 1. View-tab banner backlog

| Tab file | Banner asset (target) | Subject silhouette |
|---|---|---|
| `arena-tab.tsx` | `arena-banner.webp` | Coliseum arch with crossed swords planted in sand |
| `catacombs-tab.tsx` | `catacombs-banner.webp` | Stone archway descending into shadow, lantern hung |
| `dock-tab.tsx` | `dock-banner.webp` | Tall ship moored against a wooden pier at dusk |
| `farm-tab.tsx` | `farm-banner.webp` | Sheaved wheat field with a single barn silhouette |
| `mansion-tab.tsx` | `mansion-banner.webp` | Manor house with three lit windows at twilight |
| `mine-tab.tsx` | `mine-banner.webp` | Mine entrance with mine-cart rails leading in |
| `research-tab.tsx` | `academy-banner.webp` | Domed library against a starry sky |
| `vault-tab.tsx` | `vault-banner.webp` | Heavy round vault door, hinges visible |
| `workshop-tab.tsx` | `workshop-banner.webp` | Workbench with hanging tools above |

**Wire-up.** Each tab gets a `<ShowcaseBanner image="/img/banners/<id>.webp" .../>`
at the top, mirroring the existing 6 tabs. The `<ShowcaseBanner>` component
itself doesn't need changes (it already gradients the left side dark for
text legibility).

**Asset spec.** Generate at **1024×576** (Bonsai's proven half-canvas 16:9),
2× upscale + alpha-key in `banners-export.sh` to 2048×1152 webp. Bonsai
silhouette aesthetic: black mass + antique gold (`#C9A961`) rim light from
upper left + pure solid white background for alpha-keying. Composition:
subject occupies central 60%, negative space sky on the upper third for
the gradient overlay.

## 2. No-view buildings — the celebration twist

Citadel / Observatory / Treasury / MeditationChamber / TransportBay / Stables
all unlock real player capability when built and again at every tier upgrade:

| Building | First-unlock payload | Tier-up payload |
|---|---|---|
| Citadel | Max-tier rally caps, kingdom watch role | Rally cap bumps |
| Observatory | "Star Reading" daily activity + loot bonus | Stronger loot multiplier |
| Treasury | "Ledger Audit" daily activity + NOVI mint cap | Higher NOVI mint cap |
| MeditationChamber | "Hero Blessing" daily activity + sanctuary bonus | Longer blessing window |
| TransportBay | "Route Planning" daily activity + travel speed | Travel discount |
| Stables | Cavalry unit type unlocked | Stable level boost |

Today, those unlocks land silently — a toast and the building-card flipping
from "Building…" to "Lv 1". The art moment is wasted.

**Proposal — `BuildingMilestoneFlash`.** A new component that listens for the
success of `estate::complete` and `estate::upgrade` instructions (the SDK
already emits these via the program-event parser). On success, it shows a
fullscreen vignette for ~3.5 s:

```
┌───────────────────────────────────────────┐
│                                           │
│    [building art, 16:9, fade-in]          │
│                                           │
│      OBSERVATORY · FOUNDED                │
│      Star Reading unlocked                │
│                                           │
│                              [Dismiss]    │
└───────────────────────────────────────────┘
```

The flash is **the only place the no-view buildings' art appears**. Two
concrete wins:

- Players who never check the building grid still feel the upgrade weight.
- The art is *single-use* per upgrade event — overuse can't dilute it.

Extending it to the 6 *view-tab* buildings too is free (the same trigger
fires) and gives the already-bannered tabs a fresh "you built this" moment
the chrome banner can't.

**Asset spec — same as §1.** One 16:9 file per building, reused between the
tab chrome (where applicable) and the flash. The flash adds a 2-line
overlay generated client-side from the program event payload (building
name + the one-line unlock copy from a static `BUILDING_MILESTONE_COPY`
map).

## 3. Pipeline + manifest

```
images/banners/
  banners.json          # manifest (id, subject, seed, set: "banner")
  raw/<id>.png          # bonsai-generated 2048×1152 PNG
  ../banners-export.sh  # alpha-key + webp + drop in apps/web/public/img/banners
```

Manifest schema (mirrors `images/icons/icons.json`):

```json
{
  "preamble": "Single building silhouette. One isolated medieval fantasy structure at golden hour, viewed in 3/4 perspective.",
  "style": {
    "banner": "Style: black silhouette with antique gold (#C9A961) rim light from upper left, no interior detail, subject reading as a flat shape. Color: deep matte black (#0a0a0a) on pure solid white (#FFFFFF) background for alpha-keying in post."
  },
  "tail": "Composition: 16:9 landscape, subject occupies the central 60%, upper third left as negative-space sky for gradient overlay. Building only — absolutely no text, no letters, no people, no animals, no scene clutter.",
  "defaults": {
    "model":    "prism-ml/bonsai-image-ternary-4B-mlx-2bit",
    "variant":  "ternary",
    "backend":  "mlx",
    "width":    1024,
    "height":   576,
    "steps":    28,
    "endpoint": "http://localhost:8000/generate"
  },
  "banners": [
    { "id": "arena-banner",     "seed": 2101, "subject": "A Roman coliseum arch with two crossed gladii planted upright in sand at its base." },
    { "id": "catacombs-banner", "seed": 2102, "subject": "A stone archway descending into shadow, a single lit lantern hung from a rusted iron hook above the threshold." }
    /* …9 view-tab entries + 6 no-view entries… */
  ]
}
```

## 4. Implementation steps

1. **Manifest** — write `images/banners/banners.json` with all 15 entries.
2. **Generator script** — `images/scripts/generate-banners.sh`, modelled on
   the working `generate-heroes.sh` (curl-POST to
   `http://localhost:8000/generate` with the manifest's prompt parts).
   *Don't* fork from `generate-icons.sh` — that script still calls the
   `krea` CLI and is the wrong base.
3. **Export script** — `banners-export.sh`: trim, alpha-key white, encode
   webp at quality 82, drop into `apps/web/public/img/banners/`.
4. **`BuildingMilestoneFlash` component** —
   `apps/web/src/components/estate/BuildingMilestoneFlash.tsx`. Subscribes
   to the chain event stream (`lib/events/classify.ts` already classifies
   `estate::complete` and `estate::upgrade`) and pops the vignette on match.
   One mount at the root of `(game)/estate/page.tsx`.
5. **`BUILDING_MILESTONE_COPY` map** —
   `apps/web/src/lib/estate/milestone-copy.ts`: `{ buildingId: { foundedCopy, upgradeCopy } }`. Hand-written, ~30 lines total.
6. **Wire `ShowcaseBanner`** into the 9 unbannered view-tabs. Each is a
   one-line addition; copy the existing pattern from `sanctuary-tab.tsx:301`.

## 5. Open questions

- **Flash dismissal model** — auto-dismiss after 3.5 s, or stay until clicked?
  3.5 s is the right default; clicking the flash earlier dismisses it.
  Holding the option key (or long-press on mobile) freezes the timer so
  screenshot collectors can capture the moment.
- **Multi-upgrade rapid-fire** — a player who batches 3 upgrades shouldn't
  see 3 stacked flashes. Queue them with a 200 ms minimum gap and an "skip
  remaining" affordance after the second.
- **Replay** — surface a button on the building card ("Show founding") that
  re-fires the flash for the building's *first* unlock. Memory-only, no
  chain state.

## Related

- [[HERO_PORTRAITS]] — the existing template silhouette pipeline this
  borrows from.
- [[CASTLE_BANNERS]] — castles use a similar Bonsai silhouette aesthetic
  but with runtime tier/state overlays instead of pure static art.
- [[EMPTY_STATES]] — same Bonsai pipeline, smaller assets.
