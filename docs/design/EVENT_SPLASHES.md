# Event Splash Art

Status: TODO (design).
Last touched: 2026-05-28.
Pipeline: Bonsai (`images/bonsai/`).

## The problem

Events drive retention: the 24 h Daily Tournaments, the 7 d Weekly PvP,
the 30 d Seasonal, the multi-day World events. Each one has urgency built
into the chain (prize pool, deadline, eligibility caps) and currently shows
as text rows in the events list. A player who opens the events page sees
prose where they should see a moment.

The catch: events are *created dynamically* via instruction 8 (`event::create_event`).
Slice 0 has 3 seeded (Launch Tournament, Weekly PvP, Newcomer Challenge),
but next month there could be 12. Per-event hand-baked art doesn't scale,
and we shouldn't block future events on the art pipeline.

## Strategy — two layers: class default + optional hero

Every event has an `event_class` (Daily / Weekly / Seasonal / World) and
an optional `event_id`. Art lookup:

1. If `event_id`-specific art exists in `images/events/raw/event-<id>.png`,
   use it.
2. Otherwise fall back to the event class's default
   (`event-class-daily.png`, etc.).

Four class defaults + N hand-baked hero splashes = always-have-something
plus the option to invest art on marquee events.

Slice 0 ship list: 4 class defaults + 3 hero splashes for the seeded
events = 7 generations.

## Per-class defaults

The class default art conveys "what kind of event is this?" without
naming a specific event. Players learn the class shape over time.

| Class | Subject | Accent |
|---|---|---|
| Daily | Sundial at the horizon with sand running between two halves — short urgency | Dawn gold (`#C9A961`) |
| Weekly | A folded campaign tent with planted standards around it — sustained commitment | Steel blue (`#7C9DC7`) |
| Seasonal | A wide ceremonial gate flanked by twin braziers — milestone-grade | Amethyst (`#9C7CC7`) |
| World | A great anvil under a starlit sky with a meteor streak across it — once-in-a-cycle | Cosmic violet (`#7C5CC7`) |

## Hero splashes for the 3 seeded events

| ID | Subject |
|---|---|
| `event-1-launch-tournament` | Crossed kingdom standards driven into a pile of trophies, dawn light breaking behind |
| `event-2-weekly-pvp` | Arena dust drifting around two crossed weapons planted upright in the sand |
| `event-3-newcomer-challenge` | A young squire's training stand — wooden post, shield, single sword — at the edge of a long horizon |

Same Bonsai grammar + defaults block as [[BANNERS_BUILDING]]: generate at
**1024×576** (16:9 half-canvas), 2× upscale to 2048×1152 webp in post.
The class accent color is used for the upper-left rim light.

## Surfaces

| Beat | Art lookup |
|---|---|
| Events list card | Hero splash if available, else class default |
| Event detail modal | Same as list, full-bleed at top |
| "Closing soon" toast banner | Class default cropped to 16:5 strip |
| Prize claim modal | Hero splash (full); fades to class default if unspecified |
| Activity feed event-tied beat | Class default thumbnail (256×256 down-sample) |

## Pipeline + manifest

```
images/events/
  events.json
  raw/event-class-{daily,weekly,seasonal,world}.png
  raw/event-<id>.png      # per-event hero splashes (optional)
```

Manifest schema:

```json
{
  "preamble": "Single event splash. One isolated scene at golden hour or twilight as appropriate, viewed straight on.",
  "style": {
    "splash": "Style: black silhouette mass with a single accent-color rim light from upper left, no interior detail, atmospheric depth via fog gradient at the lower edge. Color: deep matte black (#0a0a0a) silhouette with the event's accent color rim on a pure solid white (#FFFFFF) background for alpha-keying."
  },
  "tail": "Composition: 16:9 landscape, subject occupies the central 60%, upper third negative-space sky for headline overlay. No text, no letters, no UI, no people figures unless specified.",
  "defaults": {
    "model":    "prism-ml/bonsai-image-ternary-4B-mlx-2bit",
    "variant":  "ternary",
    "backend":  "mlx",
    "width":    1024,
    "height":   576,
    "steps":    28,
    "endpoint": "http://localhost:8000/generate"
  },
  "events": [
    { "id": "event-class-daily",    "seed": 2301, "accent": "#C9A961", "subject": "A bronze sundial at the horizon line with sand running visibly between two halves of a divided hourglass beside it." },
    { "id": "event-class-weekly",   "seed": 2302, "accent": "#7C9DC7", "subject": "A folded campaign tent under twilight, four planted standard poles surrounding it." },
    { "id": "event-class-seasonal", "seed": 2303, "accent": "#9C7CC7", "subject": "A wide ceremonial stone gate flanked by twin braziers burning with violet flame." },
    { "id": "event-class-world",    "seed": 2304, "accent": "#7C5CC7", "subject": "A great smithing anvil at night under a starlit sky, a single meteor streaking diagonally above it." },

    { "id": "event-1-launch-tournament", "seed": 2311, "accent": "#C9A961", "subject": "Crossed kingdom standards planted into a pile of trophy weapons and shields, dawn light breaking behind." },
    { "id": "event-2-weekly-pvp",        "seed": 2312, "accent": "#7C9DC7", "subject": "Arena dust drifting around two crossed weapons planted upright in the sand, low evening light." },
    { "id": "event-3-newcomer-challenge","seed": 2313, "accent": "#C9A961", "subject": "A wooden training stand at the edge of a long open horizon — single post, a hung shield, one sword propped beside it." }
  ]
}
```

## Lookup helper

```ts
// apps/web/src/lib/events/splash.ts
export function eventSplashUrl(eventId: number, eventClass: EventClass): string {
  const heroPath = `/img/events/event-${eventId}.webp`;
  // ETag fast-path: HEAD the hero asset; on 404, fall back to class default.
  // For slice 0 we precompute the lookup at build time from the export manifest.
  if (EVENT_HERO_IDS.has(eventId)) return heroPath;
  return `/img/events/event-class-${eventClass}.webp`;
}
```

`EVENT_HERO_IDS` is generated by `export-events.sh` listing every
`event-<id>.webp` it produced — no runtime file-system probing.

## Implementation steps

1. **Manifest** — `images/events/events.json` with the 4 + 3 entries above.
2. **Generator + export** — Bonsai wrappers; export script writes the
   `EVENT_HERO_IDS` list to `apps/web/src/lib/events/hero-ids.generated.ts`.
3. **`eventSplashUrl()` helper** — `apps/web/src/lib/events/splash.ts`.
4. **`<EventSplash>` component** —
   `apps/web/src/components/events/EventSplash.tsx`. Takes
   `{ eventId, eventClass, variant: "card" | "modal" | "strip" | "thumb" }`
   and picks the right size + crop.
5. **Refactor** the events list page, event detail modal, prize claim
   modal, and activity feed event row to mount `<EventSplash>` in place of
   text headers.

## Open questions

- **When does a new event get hero art?** Trigger: any event whose
  prize pool ≥ 100K NOVI or whose `event_class` is Seasonal or World.
  Below that, class default is fine. Add a checkbox in the DAO event-create
  flow + a backlog row in dev-todo when the box is ticked.
- **Class-default reuse during long-running events** — if a player sees the
  same Weekly PvP class default every week for a month, does the art go
  stale? Two cheap fixes: rotate four Weekly variants per month, or shift
  the accent color tint by week-of-month. Defer until playtest signals
  fatigue.
- **Animated splash (canvas overlay)** — drifting particles over the
  static splash (embers for World, dust for PvP, snow for Seasonal-winter).
  CSS keyframe layer, no per-event work. Out of scope for slice 1.

## Related

- [[BANNERS_BUILDING]] — same Bonsai pipeline, simpler.
- [[CASTLE_BANNERS]] — runtime overlay-on-static pattern.
- [[DUNGEON_ART]] — accent-color rim treatment shared.
