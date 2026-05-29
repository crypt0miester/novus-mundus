# Dungeon Splash Art

Status: TODO (design).
Last touched: 2026-05-28.
Pipeline: Bonsai (`images/bonsai/`). Generations are sequential per
[[feedback_krea_sequential]].

## The problem

The four dungeon templates seeded today — Goblin Caves, Shadow Crypt,
Dragon's Lair, Abyssal Depths — read in the UI as a text card on
`catacombs-tab.tsx`. Dungeons are the marquee PvE loop (runs ~30 min, 10
floors, rare-encounter drops, weekly leaderboard, reserved-NOVI rewards),
and the entry screen is the moment the player has to commit a stamina
chunk + a stretch of time. That moment deserves the strongest art in the
game and currently has none.

## The art surfaces (one dungeon, four beats)

| Beat | Surface | Art job |
|---|---|---|
| Choose dungeon | `dungeon::enter` modal / catacombs-tab card | Sell the *threat*: what you're walking into |
| Floor transition | Between-floor splash on `process_room` | Sell *progress*: you're descending |
| Boss floor (10) | Pre-boss-encounter overlay | Sell *peak*: the final room |
| Leaderboard | `dungeon::claim_leaderboard_prize` panel header | Sell *bragging rights*: the run is the trophy |

A single base splash plus two cheap variants covers all four beats:

- **Base splash (square 1024×1024)** — the dungeon's identity image. Used on
  entry choice and leaderboard.
- **Floor-transition** — re-use the base splash but server-side darken (50%
  black overlay) and overlay the floor number; no new generation needed.
- **Boss splash (square 1024×1024, separate generation)** — same dungeon,
  pulled in closer, threat silhouette larger, redder rim. One per dungeon
  → 4 boss splashes total.

Eight generations cover everything; not the 32 you'd get if every beat were
unique.

## Per-dungeon subjects

Use the existing Bonsai silhouette grammar (`black silhouette + antique
gold rim light + pure white BG for alpha-keying`), but darker — dungeons
are not golden-hour, they're cave-light.

| ID | Base splash subject | Boss splash subject |
|---|---|---|
| `dungeon-1-goblin-caves` | A narrow cave mouth with a single small fanged silhouette crouched near a low firepit, eyes catching the firelight | A larger hunched goblin chieftain silhouette in a wide cave chamber, bone trophies hanging from the ceiling |
| `dungeon-2-shadow-crypt` | A robed sentinel standing in a stone archway, raised staff topped with a single cold violet flame | A skeletal lich silhouette enthroned at the far end of a long crypt nave, cold violet light pooling around the throne |
| `dungeon-3-dragons-lair` | A single dragon eye and horn silhouette emerging from cave shadow, magma glow from below | A full dragon silhouette coiled around a heap of treasure, head raised, wings half-folded |
| `dungeon-4-abyssal-depths` | A pillared underwater corridor receding into black water, faint tentacle silhouettes coiling between pillars | A massive many-tentacled mass filling the lower frame, single luminous eye centered |

**Color override (vs the standard banner spec).** Replace the upper-left
antique-gold rim with a per-dungeon accent:

- Goblin Caves → ember orange (`#D97A3A`)
- Shadow Crypt → cold violet (`#8E6FCB`)
- Dragon's Lair → ember red (`#C7423A`)
- Abyssal Depths → abyssal cyan (`#3C8A9E`)

Same pure-white background so the alpha key still works; the rim color
just changes the mood instantly. The dungeon's accent color is also used
by the CSS frame around the splash so the screen reads in-theme.

## Pipeline + manifest

```
images/dungeons/
  dungeons.json
  raw/<id>.png
  raw/<id>-boss.png
images/scripts/
  generate-dungeons.sh   # bonsai wrapper, square 1024
  export-dungeons.sh     # trim + alpha-key + webp → apps/web/public/img/dungeons/
```

Manifest schema:

```json
{
  "preamble": "Single atmospheric dungeon splash. One isolated scene at the threshold, viewed straight on.",
  "style": {
    "splash": "Style: black silhouette mass with a single accent-color rim light from upper left or above, no interior detail in the silhouette, atmospheric depth via fog gradient. Color: deep matte black (#0a0a0a) silhouette with the dungeon's accent color rim on a pure solid white (#FFFFFF) background for alpha-keying."
  },
  "tail": "Composition: square 1:1, subject centered, lower two thirds of frame. No text, no UI, no people figures unless specified, one subject only.",
  "defaults": {
    "model":    "prism-ml/bonsai-image-ternary-4B-mlx-2bit",
    "variant":  "ternary",
    "backend":  "mlx",
    "width":    1024,
    "height":   1024,
    "steps":    28,
    "endpoint": "http://localhost:8000/generate"
  },
  "dungeons": [
    {
      "id": "dungeon-1-goblin-caves",
      "seed": 2201,
      "accent": "#D97A3A",
      "subject": "A narrow cave mouth with a small fanged silhouette crouched near a low firepit, the figure's eyes catching the firelight."
    },
    {
      "id": "dungeon-1-goblin-caves-boss",
      "seed": 2211,
      "accent": "#D97A3A",
      "subject": "A larger hunched goblin chieftain silhouette in a wide cave chamber, bone trophies hanging from the ceiling above."
    }
    /* …6 more pairs… */
  ]
}
```

The `accent` field is consumed by `export-dungeons.sh` only insofar as the
generator prompt interpolates it; the *runtime* accent comes from a
small `DUNGEON_ACCENT` map in the web app so a CSS frame around the splash
matches.

## Implementation steps

1. **Manifest** — `images/dungeons/dungeons.json` with 8 entries.
2. **Generator** — `generate-dungeons.sh`, modelled on `generate-heroes.sh`
   (curl-POST to `http://localhost:8000/generate`). 1024×1024 native, no
   upscale needed for square assets.
3. **Export** — `export-dungeons.sh` trims, alpha-keys white, encodes webp,
   drops to `apps/web/public/img/dungeons/<id>.webp`.
4. **`DUNGEON_ACCENT` map** —
   `apps/web/src/lib/dungeons/accent.ts`: `{ [templateId]: { rim, frame } }`
   keyed by chain template id. ~12 lines.
5. **Entry surface** — extend `catacombs-tab.tsx`'s dungeon-template card
   list to mount a full-bleed `<DungeonSplash templateId={...} />` panel
   above the existing stats text. Splash on hover/select.
6. **Floor-transition splash** — new
   `apps/web/src/app/(game)/estate/_components/catacombs/FloorTransition.tsx`.
   Renders the base splash with a 50%-opacity black overlay + the floor
   number in large display font. Fired by the dungeon run state machine
   between rooms.
7. **Boss splash** — extends the same component; swap to `<id>-boss.webp`
   when entering floor 10's combat room.
8. **Leaderboard header** — `RunView.tsx` already renders the leaderboard
   panel; thread the splash into its header.

## Open questions

- **Per-floor accent shift** — does the rim color need to deepen as the
  player descends? Probably not for slice 1 — let the floor number carry
  that signal. Reconsider after playtest.
- **Resume splash** — when a player resumes a checkpointed run via
  `dungeon::resume`, do we fire the floor-transition splash for the floor
  they re-enter? Yes — same beat, same art, free signal that the run is
  re-engaged.
- **Spoiler control for boss splash** — first-time players shouldn't see
  the boss splash before they reach floor 10 (kills the surprise). Don't
  prefetch the boss webp; load on demand at floor 9 transition.

## Related

- [[HERO_PORTRAITS]] — silhouette pipeline reference.
- [[CASTLE_BANNERS]] — castle weight uses runtime CSS overlays, similar
  pattern to the per-dungeon accent + frame.
