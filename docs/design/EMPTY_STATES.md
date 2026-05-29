# Empty-State Illustrations

Status: TODO (design).
Last touched: 2026-05-28.
Pipeline: Bonsai (`images/bonsai/`).

## The problem

A first-day player who opens `/team`, `/castles`, the rally panel, the
loot panel, or any of the expedition tabs is met with a sterile two-line
text block: "No teams yet." A returning player who finishes a run
sees "No active dungeon run." These are the highest-leverage UX moments
in the app — the player is *looking at the place where the thing they
want would be* — and we serve them whitespace.

Goal: every empty-state surface gets a small silhouette + a one-line
heading + a clear next action. The art is the invitation; the action
button is the path forward.

## The 10 surfaces

| # | Surface | Current state | Heading | Primary action |
|---|---|---|---|---|
| 1 | Team list — no teams | text | "Form a team or join one" | "Browse teams" / "Create team" |
| 2 | Rally panel — no rallies | text | "No rally in motion" | "Start a rally" |
| 3 | Encounter list — none nearby | text | "The road is quiet" | "Travel" |
| 4 | Locked-hero slots — empty | text ("No locked heroes…") | "Slot a hero to claim its buffs" | "Open Sanctuary" |
| 5 | Castle list — no castles claimed | text | "No castle under your banner" | "View contests" |
| 6 | Catacombs — no active run | text | "Step into the dark" | "Enter dungeon" |
| 7 | Expedition (Workshop/Dock/Farm) — none running | text | "No expedition under way" | "Plan an expedition" |
| 8 | Loot list — nothing to claim | text | "Treasury is empty for now" | "Hunt encounters" |
| 9 | Events list — no active events | text | "Between events" | "View past prizes" |
| 10 | Subscription gate (locked feature) | text | "Locked at your tier" | "Upgrade subscription" |

## Asset spec

Generate at **1024×1024** (proven Bonsai scale, matches the heroes
pipeline), down-sample to 800×800 webp in `export-empty-states.sh` since
these sit inside cards, not full-bleed. Single silhouette subject,
alpha-keyed from pure white during export. Same Bonsai silhouette grammar
as the rest of the art system, BUT no rim light — empty states should
feel quiet, not heroic. Just matte black silhouette against the panel
background.

| # | ID | Subject |
|---|---|---|
| 1 | `empty-team` | Two heater shields propped against each other, leaning |
| 2 | `empty-rally` | A single furled banner on a planted pole |
| 3 | `empty-encounter` | A lone signpost at a crossroad with the arms pointing nowhere |
| 4 | `empty-hero-slot` | An empty pedestal with a wreath of laurel resting on top |
| 5 | `empty-castle` | A vacant flagpole on a low keep, rope slack |
| 6 | `empty-dungeon` | A torch in a wall sconce beside an unopened iron door |
| 7 | `empty-expedition` | A stowed wagon parked beside a folded map and tied bedroll |
| 8 | `empty-loot` | An open empty treasure chest, lid flung back, hinges shown |
| 9 | `empty-event` | A snuffed cauldron with cold smoke rising in a thin line |
| 10 | `empty-locked-tier` | A heavy padlock hung from a chain over an iron gate |

## Pipeline + manifest

```
images/empty-states/
  empty-states.json
  raw/<id>.png
```

Manifest:

```json
{
  "preamble": "Single quiet object silhouette. One isolated subject at rest, centered.",
  "style": {
    "quiet": "Style: black silhouette with no rim light, no halo, no glow — flat matte. Single subject reading as a clean shape. Color: deep matte black (#0a0a0a) silhouette on a pure solid white (#FFFFFF) background for alpha-keying."
  },
  "tail": "Composition: square 1:1, subject occupies central 60%, generous negative space around it. Subject only — no text, no letters, no people, no figures, no scene clutter.",
  "defaults": {
    "model":    "prism-ml/bonsai-image-ternary-4B-mlx-2bit",
    "variant":  "ternary",
    "backend":  "mlx",
    "width":    1024,
    "height":   1024,
    "steps":    28,
    "endpoint": "http://localhost:8000/generate"
  },
  "states": [
    { "id": "empty-team", "seed": 2401, "subject": "Two heater shields propped against each other, leaning at a slight angle." }
    /* …9 more entries… */
  ]
}
```

## `<EmptyState>` component

```tsx
// apps/web/src/components/shared/EmptyState.tsx
interface EmptyStateProps {
  id: EmptyStateId;          // "empty-team", "empty-rally", …
  heading: string;
  body?: string;             // one optional line of muted copy
  action?: {
    label: string;
    href?: string;           // if provided, renders as Link
    onClick?: () => void;    // otherwise button
  };
}
```

Layout: silhouette 144 px square top-center, heading below in display
font, body line in `text-text-muted`, action button gold-accented and
centered. Whole component sits inside the card border its caller
provides.

## Implementation steps

1. **Manifest** — `images/empty-states/empty-states.json` with 10 entries.
2. **Generator + export** — Bonsai wrapper, square dimensions, alpha-key
   from white in post.
3. **`EmptyStateId` type** —
   `apps/web/src/components/shared/empty-state-ids.ts`: union of the 10
   ids.
4. **`<EmptyState>`** component as above.
5. **Refactor** the 10 surfaces. Most are 5-line replacements of an
   existing `<p>` block.

## Open questions

- **Locked-hero slot already has a banner** — `heroes-tab.tsx` shows a
  "Locking is gated" panel today with the building chevron. Does the
  empty-state silhouette duplicate it? Yes — they target different
  reasons: the gate panel explains "you can't lock yet because…", the
  empty-state speaks to "no hero in this slot yet, mint one". They
  co-exist.
- **Subscription gate variants** — different locked features could share
  one `empty-locked-tier` silhouette but ship per-feature copy. Keep one
  silhouette, let copy carry the specifics.
- **First-vs-returning player divergence** — would a returning player
  benefit from a different empty-state line than a first-day one? Probably
  yes ("No rally yet — your last one ended 2 days ago"), but that's copy
  surface, not art. Same silhouette either way.

## Related

- [[BANNERS_BUILDING]] — same Bonsai pipeline, larger format.
- [[CASTLE_BANNERS]] — empty castle list (#5) renders this empty-state
  before showing the castle grid.
