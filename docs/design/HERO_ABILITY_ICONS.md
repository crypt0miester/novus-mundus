# Hero Ability Icons

Status: TODO (design).
Last touched: 2026-05-28.
Pipeline: Bonsai (`prism-ml/bonsai-image-ternary-4B-mlx-2bit` at
`http://localhost:8000/generate`), reusing the relief prompt grammar from
`images/icons/icons.json` — the same `preamble + style.relief + subject +
tail` recipe that produced the 18 buff icons already shipped.

> **Pipeline-state caveat.** `images/icons/icons.json` was authored against
> the Krea generator (its `defaults.model` is `"ideogram/ideogram-3"`, the
> companion script `images/scripts/generate-icons.sh` calls
> `command -v krea`). The buff icons already on disk were *Krea outputs*.
> Per the user instruction "reuse Krea prompts but don't use Krea", the
> ability icons append to icons.json for prompt-grammar consistency, but
> *generate via the local Bonsai endpoint* using a sibling script modelled
> on the working `generate-heroes.sh`. The buff icons stay as-is; only
> new entries route through Bonsai.

## The problem

`apps/web/src/components/heroes/AbilityCard.tsx:48` renders a hero's
signature ability as `{meta.icon} {meta.label}` — where `meta.icon` is a
Unicode emoji glyph from `ABILITY_KIND_META` in
`sdks/novus-mundus-ts/src/utils/ability.ts`:

| Kind | Glyph | Label |
|---|---|---|
| BuffNext | `✦` | BuffNext |
| CritNext | `⚔` | CritNext |
| ShieldNext | `🛡` | ShieldNext |
| EncounterSkip | `✸` | EncounterSkip |
| InstantResource | `₵` | InstantResource |
| FragmentRefund | `❖` | FragmentRefund |

These render inconsistently across OS (the shield emoji is grey on
some platforms, blue on others; the currency symbol drops to fallback
serif), look pasted-in next to the bronze-relief buff icons that already
ship in the same panel, and don't extend visually to the `PendingEffectBadge`
where the ability armed state needs more weight.

Goal: replace the six glyphs with proper relief icons that match the
buff icon family, **reusing the existing prompt grammar verbatim** so the
ability icons sit beside the buff icons as one set.

## Reuse the manifest, don't recreate

`images/icons/icons.json` already defines:

- `preamble` = `"Single game UI icon. One isolated symbolic subject, centered, no scene."`
- `style.relief` = `"Style: the subject rendered as a single raised bronze relief object — one sculpted bronze item alone, with subtle metallic depth and micro-shadows, lit warmly from the upper left. Absolutely NO coin, no disc, no circle, no medallion, no round plate, no frame, nothing behind it — only the item itself, floating isolated in empty space. Color: warm polished bronze and aged gold (#C9A961) on a pure flat solid black background."`
- `tail` = `"Composition: perfectly centered, square 1:1, the icon fills the central portion of the frame on a clean uniform solid black background. Icon only — absolutely no text, no letters, no numbers, no clutter, one subject only."`

Buff icons use `set: "relief"`, individual fixed `seed`, and a single
sentence `subject`. We append six entries that obey the same shape.

**Do not** invent a new style, new manifest, or new prompt scaffolding —
we'd lose the visual through-line that makes the existing 18 buffs read
as one set. The generator (`generate-icons.sh`) and exporter
(`export-icons-to-app.sh`) already handle the relief set end-to-end.
The only repo change for the asset side is the manifest append.

If `generate-icons.sh` still hard-codes `krea generate image`, it needs a
one-shot swap to the Bonsai endpoint (see [[BANNERS_BUILDING]] §4 for the
same swap). That's a script edit, not a new pipeline.

## Append to `images/icons/icons.json`

Six new entries under the `icons` array, all `"set": "relief"`. Seeds
chosen to not collide with existing buff seeds (1701–1766) or resource
seeds (1851–1862):

```json
{ "id": "ability-buff-next",        "set": "relief", "seed": 1771, "subject": "A radiant compass star with a single arrowhead replacing the north tip, pointing forward and slightly upward. No coin, no disc behind it." },
{ "id": "ability-crit-next",        "set": "relief", "seed": 1772, "subject": "A single broad arrowhead embedded dead-center in a concentric struck target, the rings cracked outward from the impact." },
{ "id": "ability-shield-next",      "set": "relief", "seed": 1773, "subject": "A heavy heater shield face-forward, a single arrow snapped in half across its face with both broken pieces hanging." },
{ "id": "ability-encounter-skip",   "set": "relief", "seed": 1774, "subject": "An open stone doorway cut into a wall, a heavy iron key resting in the lock at the latch, light spilling through the gap." },
{ "id": "ability-instant-resource", "set": "relief", "seed": 1775, "subject": "A burst leather coin pouch with three coins lifting in mid-air above its open mouth, the drawstring snapped." },
{ "id": "ability-fragment-refund",  "set": "relief", "seed": 1776, "subject": "Three jagged crystal shards arranged in a tight triangular cluster, the largest shard upright and the smaller two flanking it." }
```

Run via the new Bonsai sibling generator:

```bash
./images/scripts/generate-icons-bonsai.sh \
  ability-buff-next ability-crit-next ability-shield-next \
  ability-encounter-skip ability-instant-resource ability-fragment-refund

./images/scripts/export-icons-to-app.sh   # unchanged — bakes raw/<id>.png to apps/web/public/img/icons/game/ability-<slug>@2x.webp
```

`generate-icons-bonsai.sh` is forked from the working
`generate-heroes.sh` (curl-POST loop against
`http://localhost:8000/generate`), but reads the icons.json manifest
shape (preamble + style.relief + subject + tail) instead of heroes.json.
Sequential per [[feedback_krea_sequential]]; budget ~6 min of Bonsai
time for the 6-entry batch at 1024×1024 / 28 steps.

`export-icons-to-app.sh` is unchanged — it already handles the relief →
webp post-processing regardless of which generator wrote the raw PNGs.

## Wire to `GameIcon` + `ABILITY_KIND_META`

The web app already has a `<GameIcon id={...} />` component that resolves
`buff-<slug>` ids to `/img/icons/game/buff-<slug>@2x.webp`. The same
component picks up `ability-<slug>` ids the moment the webp files land,
no component change needed.

`ABILITY_KIND_META` needs an `iconId` field added:

```ts
// sdks/novus-mundus-ts/src/utils/ability.ts
export interface AbilityKindMeta {
  kind: AbilityKindValue;
  label: string;
  /** GameIconId of the bronze-relief icon. */
  iconId: string;
  accentClass: string;
  baseDescription: string;
}

export const ABILITY_KIND_META: Record<number, AbilityKindMeta> = {
  [AbilityKind.None]: { kind: AbilityKind.None, label: "None", iconId: "",
    accentClass: "text-zinc-500", baseDescription: "No active ability." },
  [AbilityKind.BuffNext]: { kind: AbilityKind.BuffNext, label: "BuffNext",
    iconId: "ability-buff-next", accentClass: "text-amber-400",
    baseDescription: "Boosts your next combat action." },
  /* …5 more… */
};
```

The legacy `icon` glyph field gets removed once consumers migrate.

## Consumer migration

Two surfaces use `meta.icon` today:

- `apps/web/src/components/heroes/AbilityCard.tsx:48`
- `apps/web/src/components/heroes/PendingEffectBadge.tsx` (kind switch
  surfaces in the badge label)

Both update to:

```tsx
{meta.iconId
  ? <GameIcon id={meta.iconId} title={meta.label} size={16} />
  : null}
{meta.label}
```

`size={16}` matches the existing buff icon usage in `AbilityCard`'s
sibling buff-row. `PendingEffectBadge` can use `size={20}` since it's the
header chip of an armed-ability banner — more weight justified.

## Fallback during the asset gap

The webp files don't ship until the manifest is generated and exported.
Until then, `<GameIcon id="ability-buff-next" />` falls through to its
404 placeholder. To avoid a broken-image flash:

```tsx
{meta.iconId
  ? <GameIcon id={meta.iconId} title={meta.label} size={16} fallback="✦" />
  : null}
```

`fallback` is a one-line addition to `GameIcon` — render the fallback
glyph in a span if the underlying image fails. Drop the fallback once the
ability assets are baked and confirmed present.

## Implementation steps

1. **Append** 6 entries to `images/icons/icons.json` (prompt grammar only;
   the manifest's `defaults.model` field stays Krea-historic — the new
   entries don't read it).
2. **Add** `images/scripts/generate-icons-bonsai.sh` forked from
   `generate-heroes.sh` but reading the icons.json prompt-part schema
   (`preamble + style[entry.set] + subject + tail`). Hits the local
   Bonsai endpoint exactly the way the working hero pipeline does.
3. **Export** via `export-icons-to-app.sh` — drops to
   `apps/web/public/img/icons/game/ability-<slug>@2x.webp`.
4. **Add `iconId`** to `ABILITY_KIND_META` and remove the `icon` glyph
   field (delete-after-migration).
5. **Update** `AbilityCard.tsx` and `PendingEffectBadge.tsx` to render
   `<GameIcon id={meta.iconId} ... />`.
6. **Add `fallback` prop** to `GameIcon` so the asset gap doesn't show a
   broken icon during rollout.

## Open questions

- **Do we want one variant per template ability?** The chain stores
  `abilityKind` (one of 6) plus per-template params (`abilityStat`,
  `abilityParam1`, etc.). The kind is what's visually distinctive; per-template
  variation lives in copy, not icon. Six icons is the right count.
- **Animated relief variant** — the bronze relief could shimmer during the
  "armed — fires on next matching action" state. CSS mask + animated
  gradient over the static icon; no extra generation. Optional; ship the
  static icons first.

## Related

- [[HERO_PORTRAITS]] — the hero compositor; ability icon work pairs with
  the per-hero portrait pipeline conceptually.
- `images/icons/icons.json` — the manifest these entries append to.
- [[BANNERS_BUILDING]] §4 — the Bonsai-swap note for the shared icon
  generator script.
