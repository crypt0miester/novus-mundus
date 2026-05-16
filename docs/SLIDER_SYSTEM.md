# Slider System — Novus Mundus

> Every bounded value in the game becomes something you *turn* or *slide* — not something you type.

**Status**: Design — proposed, not yet implemented
**Scope**: Web app only (`apps/web`). No program changes.
**Date**: 2026-05-16
**Companion docs**: `docs/NEXTJS_UI_DESIGN.md`, `docs/THEME_DESIGN_GAPS.md`, `PLAYER_JOURNEY_GAMEPLAN.md`

---

## 1. Why this doc exists

Every numeric input in the web app is a bare `<input type="number">`. There are **46 of them**. A player hiring units, sending cash to a teammate, garrisoning a castle, or recovering wounded troops does the same thing every time: clicks a field and types a number — with no feel for the range, no feel for "half," no feel at all.

`PLAYER_JOURNEY_GAMEPLAN.md` already names this: *"the market is number inputs… The systems work. Nothing feels."* This doc is one concrete piece of that connective-tissue work. Most bounded inputs have a clear **min and a max** — that range is information, and a typed number throws it away. A slider or a knob *shows* the range and makes setting a value physical.

**Phase 1 is a knob** — a rotary dial — built and proven on a small, safe set of inputs before anything else changes.

---

## 2. What we have

### 2.1 The audit

A full scan of `apps/web/src` found **46 bounded numeric inputs**, all bare `<input type="number">`. No `Slider`, `Knob`, `Stepper`, or `<input type="range">` component exists anywhere in the codebase — this system is built from zero.

They collapse into **three patterns**:

| Pattern | Count | Range | Where | Today |
|---|---|---|---|---|
| **A — Unit / weapon / operative counts** | ~22 | `0 → owned`, integer | Rally, Reinforce, Castle garrison, Expedition, Infirmary | bare fields, 3–6 stacked |
| **B — Cash / NOVI amounts** | ~12 | `0 → balance`, wide & continuous | Economy, Market, Team treasury, NOVI rewards | bare fields |
| **C — Bounded settings scalars** | 2 | fixed min/max | Team min level (`1–255`), treasury cooldown (`1–72h`) | bare fields |

Representative file references:

- **Pattern A** — `rally-tab.tsx:635,659` · `reinforce-tab.tsx:378,402` · `castle-tab.tsx:715,739` · `expedition-tab.tsx:530` · `infirmary-tab.tsx:159`. Plus two small quantity fields: `market-tab.tsx:429` (buy qty), `workshop-tab.tsx:121` (conversions).
- **Pattern B** — `economy/page.tsx:409,640,779` · `market-tab.tsx:342,533,682` · `team-tab.tsx:993,1020,1201,1227` · `components/shared/NoviRewards.tsx:265,343`.
- **Pattern C** — `team-tab.tsx:1408` (min level) · `team-tab.tsx:1511` (cooldown).

### 2.2 Not sliders — leave alone

The scan flagged these as numeric, but they are **not bounded ranges**:

- **Hero Template IDs** — `sanctuary-tab.tsx:203,267`. Arbitrary identifiers (you type the ID a hero was minted with). No meaningful max. Keep the field, or build a hero picker.
- **Treasury instant-limit / daily-cap** — 8 cash fields, `team-tab.tsx:1487,1497`. Unbounded caps; a slider needs a ceiling. Keep as input, optionally add preset chips.
- **Hero slot `0–2`** (`heroes-tab.tsx:725`) and **Dungeon "Strikes" `1–5`** (`dungeon-tab.tsx:346`). Too few steps — a **segmented control** beats a slider. Strikes already is one.

### 2.3 Two the input-scan could not see

Not `<input>` elements, so a structural scan misses them — both are good control candidates:

- **Buy Stamina** — hardcoded to `amount: 1` in `dungeon-tab.tsx:167` and `battle-tab.tsx:224`. The on-chain instruction `createPurchaseStaminaInstruction` *already accepts a variable `amount`* — only the UI pins it to 1. Make it variable and it is a perfect knob: dial how much stamina to buy, watch the existing `StatBar` preview-fill. **Frontend-only change.**
- **`SpeedupPanel`** — shared component (`components/shared/SpeedupPanel.tsx`), used in combat + travel. A tiered time-skip selector. A notched slider ("skip N min → X gems") fits later.

### 2.4 What's already in the toolbox

- **`animejs` `^3.2.2`** — already a dependency (`apps/web/package.json`), with `@types/animejs`. The knob needs **no new packages**. Note: this is the v3 API (`anime({ targets, … })`), not v4.
- **`three` `^0.184.0`** — also already present (3D models elsewhere; see `docs/3D_MODEL_GUIDE.md`). Not needed for the knob — see §3.
- **`StatBar`** (`components/shared/StatBar.tsx`) — the closest existing analog: a `current`/`max` visual. The knob mirrors its conventions (props shape, `size`/`color` enums, `cn()`, theme tokens).
- **`shared/animations/MagicRing.tsx`** — an existing circular-animation component. Review for visual consistency with the knob's tick bezel.
- Theme — dark, gold/amber accents, a **tier-based accent** CSS variable `--nm-accent` that escalates with player progression. See `docs/THEME_DESIGN_GAPS.md`.

---

## 3. The reference — the knob

`knob_slider.mp4` (16.6s, 960×960, provided reference, not in-repo). Frame-by-frame, the knob is:

- A **rotary dial**, ~270–300° of travel with a gap at the bottom.
- A **tick bezel** — a ring of radial dashes around the dial.
- A raised circular **knob face**.
- A large **number readout** dead-centre — the current value.
- A small **triangular handle** on the bezel — the drag target.
- A **light, minimal, neumorphic** look — white-on-grey, soft shadows, monochrome.

**The signature move:** when the value changes quickly, the centre number **tumbles like an odometer reel, with motion blur** — one frame catches the digits smeared vertically with a ghost trailing. That blur is what makes the control read as *expensive*. It is the one effect worth getting exactly right.

### anime.js, not three.js

The knob is **flat 2D** — the depth is faked entirely with CSS shadows. There is no 3D mesh, no lighting, no perspective. `three` is already in the project, but using it here would mean a renderer and a scene graph to draw what is really a styled `<div>` plus an SVG ring.

→ **Build the knob with anime.js v3** (already installed). It cleanly covers the three moving parts: handle rotation, the odometer number tumble + velocity-driven blur, and a spring settle on release. `three.js` is reserved for a genuinely 3D-shaded knob if that is ever wanted — out of scope here.

---

## 4. Design decisions

The direction is knob-first (decision 1, set). Decisions 2–6 are proposed and follow from it.

| # | Decision | Rationale |
|---|---|---|
| 1 | **Knob first** | Smallest blast radius — Pattern C is 2 inputs. Proves the anime.js approach and the headless hook before touching 34 financial/combat inputs. |
| 2 | **Knob ≠ universal** | A rotary knob suits **bounded, low-precision** values (Pattern C, stamina). It is *wrong* for wide-range amounts — you cannot dial onto an exact 4,237 of 90,000. Pattern B gets a **linear slider**; Pattern A gets a **linear fill slider**. |
| 3 | **One headless hook, two skins** | A single `useSlider` hook (value/min/max/step, drag, keyboard, a11y). `<KnobDial>` and the later `<RangeSlider>` are presentations of it — identical behaviour, different shape. |
| 4 | **Dark reskin** | The reference is light/neumorphic; the game is dark with a tier accent. The knob uses theme tokens — dark face, `var(--nm-accent)` arc + glowing tick — not the video's white. |
| 5 | **anime.js v3** | Already a dependency. No new packages. |
| 6 | **Web-only, no program changes** | Every target (including variable Buy-Stamina) is a frontend change; the on-chain side already supports it. |

---

## 5. The knob — `<KnobDial>` spec

### 5.1 Anatomy

Layered, outermost → in:

1. **Tick bezel** — SVG, a ring of radial dashes over ~270°. Ticks below the handle take the accent colour; ticks ahead stay muted.
2. **Accent arc** — SVG stroke from min to the current value; `var(--nm-accent)`, faint glow.
3. **Knob face** — a `bg-surface` / `bg-surface-raised` disc, soft shadow for a subtle raised feel (the dark equivalent of the video's neumorphism).
4. **Value readout** — centred, `game-num` class, the odometer tumbler (§5.4).
5. **Handle** — a small triangular pointer riding the bezel at the value's angle; the primary drag target and the focus-ring anchor.

### 5.2 Proposed API

Mirrors `StatBarProps` conventions.

```ts
interface KnobDialProps {
  value: number;
  min: number;
  max: number;
  step?: number;                    // default 1
  onChange: (v: number) => void;    // live, every drag frame
  onCommit?: (v: number) => void;   // on release — use for tx-triggering inputs
  label?: string;
  size?: "sm" | "md" | "lg";
  color?: "gold" | "tier";          // default "tier" → var(--nm-accent)
  format?: (v: number) => string;   // e.g. (h) => `${h}h`, (l) => `Lv ${l}`
  disabled?: boolean;
  className?: string;
}
```

`onChange` vs `onCommit` — settings and any transaction-firing input read `onCommit` (release) so a drag does not spam state or a tx. `onChange` drives the live readout only.

### 5.3 Interaction

- **Drag** the handle (or anywhere on the face) — angular tracking maps pointer angle → value.
- **Wheel** — fine ±step.
- **Keyboard** — ↑/↓/←/→ = ±step; Shift+arrow = ±10·step; Home/End = min/max; PageUp/Down = larger step.
- **Snap** to `step`; optional detent feel at notches.

### 5.4 Animation (anime.js v3)

| Element | Effect | Technique |
|---|---|---|
| Handle | rotates to the value angle | `anime({ targets, rotate })`; follows drag 1:1, spring settle on release |
| Accent arc | grows / shrinks to value | animate SVG `stroke-dashoffset` |
| **Number** | **odometer tumble + motion blur** | digit strips `translateY` to the target digit; `filter: blur()` scaled to angular velocity, → 0 on settle |
| Tick bezel | ticks light up to the handle | stagger colour across crossed ticks |
| Release | elastic settle | `easing: 'spring(1, 80, 10, 0)'` or `easeOutElastic` |

The number tumbler is the signature effect: render each digit column as a vertical 0–9 strip, animate `translateY`; during fast drag apply `blur()` proportional to velocity; on settle the blur returns to 0.

### 5.5 Accessibility

A bare `<input type="number">` is accessible for free; a custom knob must re-earn it.

- `role="slider"`, `aria-valuemin` / `aria-valuemax` / `aria-valuenow`, `aria-label` (or `aria-labelledby` → the `label`).
- Focusable (`tabIndex={0}`), visible focus ring, the full keyboard set (§5.3).
- `aria-valuetext` uses `format` for human-readable values ("72 hours", "Level 200").
- Respect `prefers-reduced-motion` — skip the tumble and blur, snap the value.

### 5.6 Theme

A dark reskin of the reference. Face `bg-surface` / `bg-surface-raised`; bezel ticks `text-text-muted`; accent arc, active ticks, and handle glow `var(--nm-accent)` (so the knob escalates with the player's tier); number `game-num`. No hardcoded colours.

---

## 6. Architecture

```
apps/web/src/
  lib/hooks/useSlider.ts             NEW  headless behaviour — value/min/max/step, pointer + keyboard, drag velocity
  components/shared/KnobDial.tsx     NEW  Phase 1 — the rotary knob
  components/shared/RangeSlider.tsx  NEW  Phase 2 — the linear elastic slider
```

`useSlider` owns all behaviour and accessibility. `KnobDial` and `RangeSlider` are pure presentation — so a value set by knob, slider, or keyboard behaves identically. Both are `"use client"`, named exports, `cn()` for classes, props shaped like `StatBar`.

---

## 7. Phase 1 — scope

**Build:** `useSlider` + `KnobDial`, developed against a throwaway dev-only route (e.g. `apps/web/src/app/(dev)/playground/`) so the knob can be tuned in isolation — every state, every easing value — before it touches a real screen. The route is removed once the knob ships.

**Then wire into:**

| Target | Range | File | Note |
|---|---|---|---|
| Team min level | `1–255` | `team-tab.tsx:1408` | `format: (l) => 'Lv ' + l` |
| Treasury cooldown | `1–72` h | `team-tab.tsx:1511` | `format: (h) => h + 'h'` |
| Buy Stamina (amount) | `1 → affordable` | `dungeon-tab.tsx:167`, `battle-tab.tsx:224` | needs Buy-Stamina made variable first (frontend-only); pair with the stamina `StatBar` preview |

Min level and cooldown are pure swaps. Buy-Stamina is the **showcase** — a knob feeding a live `StatBar` fill — and the strongest single argument for the whole system.

**Done when:** the knob matches the reference's feel (tumble + blur + spring), is fully keyboard- and screen-reader-accessible, honours `prefers-reduced-motion`, and is live on the three targets above.

---

## 8. Later phases (sketch)

| Phase | Build | Covers |
|---|---|---|
| 2 | `RangeSlider` — linear elastic (per the [reactbits elastic slider](https://www.reactbits.dev/components/elastic-slider)), + 25/50/75/MAX preset chips + a synced number field | Pattern B — ~12 cash / NOVI amounts |
| 3 | Roll `RangeSlider` (fill variant, `ALL` button) across the army screens | Pattern A — ~22 unit/weapon/operative counts, + the 2 quantity fields |
| 4 | Polish — `SpeedupPanel` notched slider; revisit detents and haptics; optional knob-row "war console" treatment for army screens |

---

## 9. Open questions

1. **Knob visual treatment** — confirm the dark reskin with `--nm-accent`? (Proposed: yes. The video's white look does not belong in this game.)
2. **Playground route** — OK to add a temporary dev-only route to build the knob in isolation? (Proposed: yes; removed once the knob ships.)
3. **Knob beyond settings** — Pattern A could use a *row of knobs* ("war console" look) instead of linear sliders. Stylistic call, deferred to Phase 4.
4. **Touch** — angular drag is fiddly on small touchscreens. Fallback: treat vertical drag as value on touch. Decide during Phase 1 playground tuning.
5. **Buy-Stamina** — in Phase 1, or split to a follow-up? It needs the small variable-amount change first.

---

## 10. References

- `knob_slider.mp4` — the rotary knob reference (frame analysis: ~270° dial, tick bezel, centre readout, odometer tumble + motion blur, spring settle).
- [reactbits — elastic slider](https://www.reactbits.dev/components/elastic-slider) — the linear-slider reference for Phase 2.
- `apps/web/src/components/shared/StatBar.tsx` — the prop / convention analog.
- `apps/web/src/components/shared/animations/MagicRing.tsx` — existing circular animation; review for consistency.
- `PLAYER_JOURNEY_GAMEPLAN.md` — the "make screens feel" goal this serves.
