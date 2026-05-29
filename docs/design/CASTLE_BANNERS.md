# Castle Banners — Give Territory Weight

Status: TODO (design).
Last touched: 2026-05-28.
Pipeline: Bonsai (`images/bonsai/`).

## The problem

The 23 castles seeded today (Tower of London, Bastille Fortress, Acropolis
Citadel, Forbidden City, …) are real-world landmarks with real visual
identity, and right now the UI shows them as a row of text in a list.
Castles are the territory endgame — they have a 5-tier ownership ladder
(Outpost → Citadel), a state machine (Vacant → Contest → Protected →
Vulnerable → Transitioning), King/Court/Member roles, and a 10-day
protection window. Without art, none of that *feels* like anything.

Goal: every castle in the list, on its detail page, and during a
contest/transition reads as **a place worth defending**, with runtime
overlays that telegraph who owns it and what state it's in — without
costing 23 × 5 tiers × 5 states = 575 unique generations.

## Strategy — one banner per castle, runtime overlays for weight

Generate **one** 16:9 silhouette per castle (23 assets). Use CSS / canvas
overlays at render-time for:

- **Tier** — color of the rim glow around the silhouette (Outpost cool
  grey, Keep bronze, Stronghold silver, Fortress gold, Citadel crimson).
  Five tints, one CSS variable.
- **State** — frame treatment (Vacant: muted grey border; Contest: amber
  pulse; Protected: green steady; Vulnerable: red flicker; Transitioning:
  cyan diagonal hatch). Five state classes, one CSS module.
- **Ownership** — a small heraldic strip across the bottom of the banner
  showing the king's `.solana` ANS name + a 24px team badge if the king
  is on a team.

The static art carries the *place*; the overlays carry the *politics*.
Generating combinatorial state art would burn the Bonsai pipeline on
work CSS does better.

## Per-castle subject silhouettes

The castles in `sdks/novus-mundus-ts/cli/data/castles.ts` are real-world
landmarks. Prompts lean on each landmark's most iconic silhouette feature:

| ID | Subject silhouette |
|---|---|
| `castle-0-tower-of-london` | The White Tower square keep with four corner turrets, river fog at the base |
| `castle-1-bastille-fortress` | Eight cylindrical towers ringed by curtain wall, single drawbridge gate |
| `castle-2-castel-sant-angelo` | Round drum keep on a square base, single bridge across the Tiber |
| `castle-3-acropolis-citadel` | Long colonnaded temple silhouette on a rocky outcrop |
| `castle-4-brandenburg-gate` | Wide neoclassical gate with quadriga statue cresting the top |
| `castle-5-kremlin-fortress` | Crenellated red walls with onion-domed spires rising behind |
| `castle-6-topkapi-palace` | Pavilion roofs and pointed minarets stepping up a hillside |
| `castle-7-cairo-citadel` | Single great dome ringed by minarets, desert plateau base |
| `castle-8-dubai-citadel` | Tall slender fortified tower, single banner at the peak |
| `castle-9-baghdad-palace` | Stepped ziggurat-like palace with arched portals stacked vertically |
| `castle-10-lagos-outpost` | Low coastal fort with a single watchtower, palm silhouettes flanking |
| `castle-11-edo-castle` | Stepped Japanese keep with curved tile roofs, single tall ridgepole |
| `castle-12-forbidden-city` | Wide tiered palace gate with three concentric roof lines |
| `castle-13-shanghai-keep` | Pagoda-style tower of seven stacked roofs |
| `castle-14-gyeongbok-palace` | Wide single-story Korean palace hall with sweeping eaves |
| `castle-15-mumbai-fort` | Bastion fortress wall with cannon embrasures along the parapet |
| `castle-16-liberty-fortress` | Star-shaped earthwork fort with bastion points, lone flagstaff at centre |
| `castle-17-inca-citadel` | Stepped stone terraces ascending to a peaked sanctum |
| `castle-18-aztec-stronghold` | Pyramid temple with single broad stairway, twin shrines at the summit |
| `castle-19-bandeirantes-fort` | Wooden palisade fort with corner blockhouses |
| `castle-20-sydney-stronghold` | Sandstone harbor keep with semaphore mast on the highest tower |
| `castle-21-nairobi-outpost` | Hilltop colonial fort with single round signal tower |
| `castle-22-la-plata-keep` | Long fortified manor with twin round corner turrets |

All 16:9, generated at **1024×576** (Bonsai's proven half-canvas) and
2× upscaled in post to 2048×1152 webp, alpha-keyable. Same Bonsai grammar
+ defaults block as [[BANNERS_BUILDING]] — only the subject changes per
castle.

## Tier overlay — five rim tints

```ts
// apps/web/src/lib/castles/tier-style.ts
export const CASTLE_TIER_STYLE = {
  outpost:    { rimHex: "#A0A0A8", glowBlur: 8,  borderClass: "border-zinc-500/50"  },
  keep:       { rimHex: "#A07845", glowBlur: 12, borderClass: "border-bronze-500/60" },
  stronghold: { rimHex: "#C8C8D0", glowBlur: 16, borderClass: "border-silver-400/70" },
  fortress:   { rimHex: "#C9A961", glowBlur: 20, borderClass: "border-gold-400/80"   },
  citadel:    { rimHex: "#C7423A", glowBlur: 28, borderClass: "border-red-400/90"    },
} as const;
```

Rendered as a CSS `filter: drop-shadow(0 0 <blur>px <rim>)` on the
silhouette `<img>`, layered with the border ring on the wrapping div.
No image regeneration on tier change.

## State overlay — five frame treatments

```ts
// apps/web/src/lib/castles/state-style.ts
export const CASTLE_STATE_STYLE = {
  vacant:        { ringClass: "ring-zinc-700/50",     animClass: "" },
  contest:       { ringClass: "ring-amber-400/80",    animClass: "animate-pulse" },
  protected:     { ringClass: "ring-emerald-400/70",  animClass: "" },
  vulnerable:    { ringClass: "ring-red-500/80",      animClass: "animate-pulse-fast" },
  transitioning: { ringClass: "ring-cyan-400/70",     animClass: "animate-hatch-slide" },
} as const;
```

Combined with the tier border, the castle banner reads as e.g. "Fortress
that's currently being contested" without any text — gold rim + amber
pulse ring.

## Ownership strip

Bottom 60px of the banner — semi-opaque dark gradient, left-aligned:
king's ANS name + 24px team badge (if on a team). Same component as the
header on the team page (`team-tab.tsx`) reused at smaller scale.

Vacant castles get a single italic line in the strip: "Unclaimed —
contest opens in <timer>". On contest, the strip flips to "Contest in
progress — <leader name> leads".

## Surfaces

| Surface | Use |
|---|---|
| Castle list (`/castles` or castle-tab) | Each row uses the banner as a wide 16:9 row tile with the ownership strip and tier+state overlays |
| Castle detail page | Full-bleed hero banner at the top of the page |
| `castle::claim_castle_rewards` modal | Banner header on the reward modal |
| Castle attack confirmation | Banner as the threat-confirmation backdrop |
| Realm map cluster tooltip | Banner thumbnail (down-scaled, no overlay) |

## Pipeline + manifest

```
images/castles/
  castles.json
  raw/<id>.png
images/scripts/
  generate-castles.sh
  export-castles.sh
```

Manifest mirrors [[BANNERS_BUILDING]] manifest schema; just a different
folder and 23 entries. The `id` matches the on-chain castle index
(`castle-0-tower-of-london`, etc.) so the web app can derive the image
path from the chain account directly.

## Implementation steps

1. **Manifest** — `images/castles/castles.json` with 23 entries.
2. **Generator + export** — Bonsai wrapper scripts mirroring the building
   banner ones.
3. **Tier + state style maps** — two small files in
   `apps/web/src/lib/castles/`.
4. **`<CastleBanner>` component** —
   `apps/web/src/components/castles/CastleBanner.tsx`. Takes
   `{ castleId, tier, state, kingName, teamId }` and composes the static
   art + rim + ring + strip.
5. **Surface integration** — refactor the castle list, detail page,
   reward modal, attack confirmation, and realm tooltip to use the new
   `<CastleBanner>` instead of text rows.
6. **Custom Tailwind animation** for `animate-pulse-fast` and
   `animate-hatch-slide` (already-defined `animate-pulse` covers contest).

## Open questions

- **Custom castle skin (cosmetics)** — [[COSMETICS_EXPANSION]] talks about
  castle skins as a future cosmetic kind. The skin would override the
  static art per castle; the tier/state overlays would still apply
  unchanged on top. Plan for it now: `<CastleBanner>` should accept an
  optional `skinOverrideUrl` prop and fall back to the bonsai-baked
  asset when absent.
- **Animated weather/time-of-day layer** — would add real-world day/night
  cycle ambience tied to each castle's geographic timezone. Out of scope
  for slice 1; mention here so we don't re-litigate the layer model
  later.
- **King's banner** — a separate small heraldic strip cosmetic that
  overlays the bottom of the castle banner with the king's chosen
  team/personal banner. Would slot into the ownership strip cleanly. Pair
  with [[COSMETICS_EXPANSION]] item-type for banners.

## Related

- [[BANNERS_BUILDING]] — same Bonsai grammar, simpler runtime treatment.
- [[COSMETICS_EXPANSION]] — castle-skin cosmetic kind that this banner
  system is designed to accept.
- [[HERO_PORTRAITS]] — the compositor that proved runtime-overlay-on-baked-art
  works at scale.
