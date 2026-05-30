# anime.js Motion Opportunities

> Internal design doc · Web client (`apps/web`) · anime.js v4.4.1 (modular named-export API)
> Status: proposal · Audience: game engineers

## 1. TL;DR

anime.js v4 is already a dependency and already drives 11 surfaces, but we use maybe a fifth of what we paid for. Today's footprint is `animate()`, `spring`/`createSpring`, `stagger()`, and one `createDraggable()`. The rest of the toolkit, the part that turns "a fade" into "an army marching a curved route locked to chain time" or "the leaderboard physically re-ranking when you switch metrics", is sitting unused: `createTimeline`, `createTimer`, `svg.morphTo`, `svg.createMotionPath`, `svg.createDrawable`, `createAnimatable`, `onScroll`, `engine`, `createScope`, `utils`, `waapi`, and the expressive eases (`steps`, `irregular`, `cubicBezier`, `linear`).

The thesis: stop hand-rolling RAF loops, `setInterval` countdowns, and CSS keyframes that drift from real state. Move motion onto the one shared anime engine clock, bind it to on-chain truth via `seek()`/`progress`, and build a small shared motion layer (tokens, a scope hook, one countdown clock, a reduced-motion switch) so every screen speaks one material language instead of twelve.

This is a Solana game. The motions that matter most are the ones that make on-chain state legible: travel progress, construction countdowns, rank changes, territory shifts, and tx settlement. Those are where we aim first.

### Top integrations by impact / effort

| # | Integration | Surface | Impact | Effort |
|---|---|---|---|---|
| 1 | Path-true travel marker on a curved route, `progress` bound to chain pct | RealmMap | High | M |
| 2 | Chain-synced construction progress (one shared `createTimer` + draw ring) | Estate building card | High | M |
| 3 | FLIP estate reflow (cards slide old slot to new on build/complete) | Estate building grid | High | M |
| 4 | Engine-level reduced-motion + confirm-time slow-mo conductor | App root / TxButton | High | S |
| 5 | FLIP rank-reorder + score count-up on leaderboard tab switch | Leaderboard | High | M |
| 6 | Combat outcome cinematic (HP drain + `irregular()` impact + ringing number) | CombatOutcomeModal | High | M |
| 7 | Jumpahead beat director (`createTimeline` crossfade + morphing sigil) | Arrival flow | High | M |
| 8 | Inertial map: eased zoom + spring fling via `createAnimatable` | RealmMap / useZoomPan | High | M |
| 9 | Living territory borders: `svg.morphTo` control-zones on PvP resolution | RealmMap | High | M |
| 10 | Scroll-scrubbed Chronicle saga via `onScroll(sync:true)` | ChroniclePanel | Med | M |

Foundations (Section 5) come before all of these. They are small, and they make the rest correct by construction.

---

## 2. Current state

### What the 11 files already do

| File | Uses | What it does |
|---|---|---|
| `components/layout/MorphTabBar.tsx` | `animate`, `spring`, `stagger` | Pill morphs width, cross-fades nav/actions/wide/compose layers, staggers children, springs a popover. Five separate `animate()` calls plus a manual `widthAnimating` ResizeObserver gate. |
| `components/layout/TransitionOverlay.tsx` | `createTimeline` | Route-transition overlay: title/lines/ring fade and slide, hold, exit. |
| `components/loading/LoadingSequence.tsx` | `animate` | Boot steps stagger in, checkmarks scale+rotate, container exits. |
| `components/shared/TxButton.tsx` | `animate` + CSS | 4s sending progress bar via `animate`; hold-charge fill via CSS transition; preparing scale via CSS class. |
| `components/shared/NoviGenerator.tsx` | `animate`, `spring` | Gem scale+rotate and pending-count pop on upward NOVI crossing. |
| `components/world/RealmMap.tsx` | `createDraggable` | Map pan/drag. Travel marker, selection rings, roads are all CSS keyframes. |
| `components/combat/CombatOutcomeModal.tsx` | `animate`, `spring` | Card scale-in, HP bar drain, counter tick. Has a reduced-motion guard. |
| `components/cairn/CairnBeat.tsx` | `animate` | Orb scale/fade in, hand-timed text reveal (`ORB_DURATION - 450` magic number). |
| `components/cairn/CairnFloating.tsx` | `animate`, `createDraggable` | Mobile orb settle, popover open/close, edge-snap drag. |
| `components/cairn/CairnPresence.tsx` | `animate` | Breathing loop, word reveal, hover lean, press bounce (discrete duration steps). |
| `components/arrival/useRevealOnMount.ts` | `animate`, `stagger` | The reveal engine for the arrival beats. **No cleanup on unmount.** |

### What is being left on the table

- **Whole API families unused:** `createTimer`, `svg.*` (morph / motionPath / drawable), `createAnimatable`, `onScroll`, `engine`, `createScope`, `waapi`, and the expressive eases (`steps`, `irregular`, `cubicBezier`, `linear`, `createSeededRandom`). `createScope` is used **zero** times despite being the cleanup primitive we keep hand-rolling badly.
- **State that should be animated is static or CSS-only.** The travel marker recomputes one `(mx,my)` per render and snaps. Construction bars step 1% per React tick. Selection rings only fire on mount and never replay on re-pick. Roads do a flat 1.4s opacity fade.
- **Motion drifts from real time.** `setInterval`/RAF countdowns (minigame timer, jumpahead elapsed clock, cooldowns) run on their own clocks and desync from each other and from the bars they fill.
- **Cleanup is forgotten by default.** `useRevealOnMount` returns no cancel. `TransitionOverlay` recreates an uncancelled timeline per phase (leak on rapid route toggles). `LoadingSequence` spawns uncleaned `forEach` animations.
- **Reduced-motion is inconsistent.** 8+ duplicated one-shot `matchMedia('(prefers-reduced-motion: reduce)')` reads that never react to a live OS toggle. `MorphTabBar`'s own comments admit its popover and plus-icon rotate ignore the check entirely. The codebase already ships `lib/hooks/useMediaQuery.ts` and nothing uses it for this.
- **No shared material.** Every surface that wants a spring invents its own `createSpring({stiffness, damping})`. Without a token module, "one coherent motion language" stays aspirational.

---

## 3. The three headline opportunities

### 3a. Estate building reflow - FLIP grid that slides instead of teleporting

**The feeling.** Today, when you build something and it leaves "Ground to Break" to land on a plot, or a construction completes and the parcels re-sort, the cards teleport. You cannot follow where a building went. The fix is a true FLIP (First, Last, Invert, Play): every card visibly slides from exactly where it used to sit to its new slot, like physical tiles re-settling on a board. The reorganization ripples out from the center (the keep) via a grid stagger, so it reads as one organized wave. The arriving building eases into its empty slot last with a small spring overshoot, landing with weight.

**Target files**
- `apps/web/src/app/(game)/estate/_components/building-grid.tsx` (the sort/distribute logic at lines 99-110, the plot grid at 173-210)

**anime.js v4 APIs:** `animate()` with function-based per-target values, `stagger({ grid, from:'center' })`, a shared `createSpring` settle, `useAnimeScope` (Section 5) - but note the FLIP teardown rule below.

**Code sketch**

```tsx
// FLIP: measure old layout, let React commit the new one, animate the delta to zero.
// Key by building id, NOT DOM index, because the grid re-sorts by building id across plots.
const prevRects = useRef(new Map<number, DOMRect>());
const gridRef = useRef<HTMLDivElement>(null);

// Gate on an actual layout signature so we do NOT measure on the 1s construction tick.
const layoutSig = settledIds.join(",") + "|" + plotsOwned;

useLayoutEffect(() => {
  const cards = gridRef.current?.querySelectorAll<HTMLElement>("[data-bcard]");
  if (!cards) return;
  if (prefersReducedMotion()) {
    // snap: record rects, no Invert
    cards.forEach((el) => prevRects.current.set(Number(el.dataset.bcard), el.getBoundingClientRect()));
    return;
  }
  // batch all reads first, then all writes (avoid layout thrash)
  const deltas: Array<[HTMLElement, number, number]> = [];
  cards.forEach((el) => {
    const id = Number(el.dataset.bcard);
    const next = el.getBoundingClientRect();
    const prev = prevRects.current.get(id);
    if (prev) {
      const dx = prev.left - next.left;
      const dy = prev.top - next.top;
      if (dx || dy) deltas.push([el, dx, dy]);
    }
    prevRects.current.set(id, next);
  });
  for (const [el] of deltas) {
    const [, dx, dy] = deltas.find(([e]) => e === el)!;
    // Invert to old position, Play back to identity. cancel() (not revert) so a
    // second reflow mid-flight retargets cleanly and we never wipe the transform.
    animate(el, {
      translateX: [dx, 0],
      translateY: [dy, 0],
      ease: SETTLE,                     // shared spring from motion tokens
      composition: "replace",           // overlapping completions retarget, no snap-back
      delay: stagger(28, { from: "center", grid: GRID_DIMS }), // GRID_DIMS read from live breakpoint
    });
  }
  // NOTE: do NOT scope.revert() a FLIP. Settle to identity and rely on cancel().
}, [layoutSig]);

// each BuildingCard wrapper: <div data-bcard={data.config.id}>
```

**Correctness notes (load-bearing):**
- **Do not `scope.revert()` a FLIP.** Revert restores pre-animation inline styles and will flash; the animation settles to identity (`translate 0`) on its own, and `cancel()` handles interruption.
- **Gate the measure effect** on a layout signature (settled-id order + plots owned). This grid re-renders on a 1s construction tick; measuring every card every render is forced synchronous layout for nothing.
- **`GRID_DIMS` must read the live breakpoint** (the grid is `grid-cols-2 lg:grid-cols-4`), or the ripple direction is wrong on resize.
- This proposal **owns all card motion.** Any "ground-breaking handoff" flourish must defer to it or they will both grab `[data-bcard]` and fight.

---

### 3b. Jumpahead / arrival onboarding - a cinematic beat director

**The feeling.** Beats currently hard-swap: the whole UI replaces instantly, breaking narrative immersion. We replace the cut with a turning-page gesture. Crossing from one beat to the next, the outgoing content sinks and dims with an anticipatory pull-in (`inBack`), a small ink sigil at page center draws itself and morphs its silhouette per beat (world rune to claim stake to Cairn glyph), and the incoming lines rise into place from below in a tight cascade. It reads as one continuous gesture, like turning a page in an illuminated manuscript. Going back plays the same timeline reversed, so retreating rewinds the same motion. The React state swap is pinned to the timeline midpoint so visuals and state commit on the same beat.

**Target files**
- `apps/web/src/components/arrival/Arrival.tsx` (beat orchestration, lines 94-140)
- `apps/web/src/components/arrival/useRevealOnMount.ts` (the reveal contract these beats share)

**anime.js v4 APIs:** `createTimeline`, `svg.createDrawable` (self-drawing sigil), `svg.morphTo` (per-beat glyph), `tl.call()` (state swap on beat), `eases` (`inBack`/`outExpo`), `useAnimeScope`.

**Code sketch**

```tsx
// Arrival owns the active beat AND a transient "next" beat during a transition.
// A small fixed center SVG sigil (#beat-sigil) is hidden between transitions.
function goToBeat(next: Beat) {
  inFlight.current?.cancel();              // re-entrancy guard: users mash back/forward
  const tl = createTimeline({ defaults: { duration: 420, ease: "outExpo" } });

  // outgoing content: anticipatory pull-in, then fade. Scope selectors to the current beat.
  tl.add("[data-beat-current] [data-reveal]", { opacity: [1, 0], y: [0, -10], ease: "inBack" }, 0);

  // sigil etches itself, then morphs to the next beat's glyph mid-cross
  const [sigil] = svg.createDrawable("#beat-sigil");
  tl.add(sigil, { draw: ["0 0", "0 1"] }, "<<");
  tl.add("#beat-sigil path", { d: svg.morphTo(GLYPH[next]) }, "<<+=120");

  // swap React state at the midpoint so state and visuals land together
  tl.call(() => setBeat(next), "+=0");

  // incoming lines cascade up (reuses the [data-reveal] contract, scoped to the next beat)
  tl.add("[data-beat-next] [data-reveal]", { opacity: [0, 1], y: [14, 0] }, "+=60");

  inFlight.current = tl;
  tl.play();
}
// back button reuses the same path; reverse() for a symmetric exit.
// useAnimeScope({ root: overlayRef }) so scope.revert() kills any in-flight transition on unmount.
```

**Correctness notes:**
- **`svg.morphTo` requires compatible point counts.** Author the three glyph paths pre-normalized to the same node count, or the morph jumps. If that is too costly, downgrade to draw-in + crossfade.
- **Double-rendering current + next** briefly doubles the DOM; the `[data-reveal]` selectors must disambiguate via `data-beat-current` / `data-beat-next` scoping, and the overlay must sit above with `pointer-events: none` during transit.
- **Re-entrancy guard is mandatory** (`cancel()` the in-flight timeline).
- The weaker `WorldBeat` per-line drift idea is **cut**; the valuable parts of it (a shared `BeatButton` spring hover/press, and a subtle persistent shimmer marking the premium jump-ahead path) fold into the motion-tokens work and the foundation hover pattern, not a per-line jitter that re-tags three files for marginal payoff.

---

### 3c. RealmMap travel across terrain - path-true marker, route etch, camera

**The feeling.** Today the marker computes one `(mx, my)` from `travel.pct` per render and snaps forward a step each chain tick; on a slow phone or laggy RPC it jumps. We make it geometry-true. When a march is dispatched, the dashed route line **etches itself** from origin outward toward the destination (it does not just appear). A heading-locked marker token then rides that exact curved line, banking to face its direction of travel, gliding continuously between the discrete chain pct values and re-locking to ground truth each tick. On arrival it eases to a firm stop on the destination dot. This is the single best cross-cutting idea in the set: the marker becomes a faithful spatial readout of where the army actually is, because its position is bound to `anim.progress = chainPct`, not to time.

**Target files**
- `apps/web/src/components/world/RealmMap.tsx` (travel marker render at lines 782-822; the dashed `<line>` becomes a curved `<path>`)
- `apps/web/src/components/world/RealmMap.module.css` (retire the `travelDash` / `travelMarkerPulse` keyframes, lines 474-509)

**anime.js v4 APIs:** `svg.createMotionPath` (tangent-locked translate + rotate generators), `svg.createDrawable` (route etch), `animate({ autoplay:false })`, `anim.progress` (bind to chain), `useAnimeScope`.

**Code sketch**

```tsx
// Render an invisible CURVED <path> per active travel instead of a straight <line>.
// Quadratic control point perpendicular to the chord so routes arc like a campaign map.
const d = `M ${from.x} ${from.y} Q ${ctrlX} ${ctrlY} ${to.x} ${to.y}`;

useAnimeScope({ root: svgRef, deps: [from.x, from.y, to.x, to.y] }, ({ reduce }) => {
  // 1. etch the route in (skip under reduced motion)
  const [route] = svg.createDrawable("#travel-route");
  if (!reduce) animate(route, { draw: ["0 0", "0 1"], duration: 520, ease: "inOutQuad" });

  // 2. motion path gives translateX, translateY, rotate generators (auto-faces heading)
  const mp = svg.createMotionPath("#travel-route");
  const march = animate(markerRef.current, {
    ...mp,
    ease: "linear",
    autoplay: false,        // we drive position by progress, not time
    duration: 1000,         // nominal; progress maps 0..1 across the path
  });
  marchRef.current = march;
});

// each render where pct changes: bind to chain ground-truth
useEffect(() => {
  marchRef.current?.refresh();              // path may have moved
  if (marchRef.current) marchRef.current.progress = utils.clamp(travel.pct / 100, 0, 1);
}, [travel.pct]);
```

**Correctness notes (this is the one that bites):**
- **`createMotionPath` translates relative to the element's own layout box,** not the SVG viewBox. The marker group must be **re-anchored to coordinate origin `(0,0)`** and the existing `translate(mx,my)` removed, or the token lands offset.
- The marker lives **inside the zoom/pan `<g>` with the pervasive `1/zoom.scale` counter-scale** (RealmMap ~755-926). Verify the counter-scale group still wraps the token so it stays screen-sized after re-anchoring. **This needs a real spike before committing.**
- **Reduced motion:** skip the draw-in, set `progress` directly.
- Pair the route etch with the march so dispatch reads as "ink, then march." For **multi-leg operative/trade caravans**, chain `createMotionPath` legs in a `createTimeline` with per-leg pauses - that animates the economy layer nothing touches today.

---

## 4. Opportunities by area

### 4.1 Estate building lifecycle

**Anticipation drop-in + completion bloom** - `building-card.tsx`, `building-grid.tsx`.
A newly-placed card does an anticipation-overshoot-settle (percent keyframes: `scale` past 1 with a downward nudge, then settle). The instant a constructing card flips to `ready`, one per-card timeline sweeps a single `--phase` CSS var that both the border color and a `--glow` box-shadow read (so color and bloom cannot desync), and the "Ready!" text pops on a spring. Fold drop-in and bloom into **one timeline** so a card that mounts already-ready (reload mid-construction) does not double-fire. Edge-detect via a `ready` Set-diff across renders so it fires once, not every 1s tick. APIs: `createTimeline`, percent `keyframes`, `createSpring`, `--glow` var. **Impact High / Effort M.**

```tsx
// fires once on the ready edge; one timeline, --phase drives both border + glow
createTimeline({ defaults: { ease: "outQuad" } })
  .add(cardRef.current, { "--phase": [0, 1], duration: 620 }, 0)        // border + box-shadow read --phase
  .add("[data-ready-text]", {
    scale: [0.6, 1], opacity: [0, 1],
    ease: createSpring({ bounce: 0.6, duration: 360 }),
  }, "<<+=80");
```

**Construction-alert banner as a live muster** - `building-grid.tsx`.
The "{N} rising" count rolls up with a spring (plain-object tween + `utils.round(0)`), the newest rising chip leads via `stagger(…, { from: "last" })`, and the banner's glow intensity tracks the nearest-completion fraction via `utils.mapRange`. APIs: `animate` on a plain object, `stagger`, `createSpring`. **Impact Med / Effort S.** Note: a looping `box-shadow` is **main-thread paint** even via `waapi` (see Section 5 perf rule); drive the breathe on a transform/opacity glow layer instead.

> **Cut / downgrade:** the "empty-slot ground-breaking handoff" with `svg.morphTo` is **cut as written** - the cards are HTML divs with a CSS dashed border, not SVG paths, so `morphTo` cannot apply, and stripped of the morph it overlaps with the FLIP reflow and double-animates the same card. Either commit to a real inline-SVG plot outline morphing to the building's outline, or let 3a own all card motion.

### 4.2 Combat, dungeons, minigames

**Combat outcome cinematic** - `CombatOutcomeModal.tsx`. *(This is the reference implementation for the scope + reduced-motion + teardown pattern.)*
The card springs in, then the load-bearing beat lands: the HP bar drains in one decisive `outQuart` sweep while the card does a tiny `irregular()` rumble (under 6px) timed exactly to the drain starting, as if the blow connected. The HP number counts down in lockstep (plain-object target, `utils.round` modifier) and pops with an `outElastic` ring as it settles, its color cross-fading to the critical tone (animated, not baked at render). Breakdown rows deal in on a stagger trailing the HP beat. Defeat gets a heavier rumble; victory a crisp single kick. APIs: `createTimeline`, `irregular()`, `createSpring`, `utils.round`, `createScope({ mediaQueries: { reduce } })`. **Impact High / Effort M.**

```tsx
useAnimeScope({ root: cardRef, mediaQueries: { reduce: "(prefers-reduced-motion: reduce)" } }, ({ reduce }) => {
  // reduced motion: set final HP width + number directly, no timeline, then bail
  if (reduce) return;
  const counter = { v: from };
  createTimeline({ defaults: { ease: "outQuart" } })
    .add(cardRef.current, { scale: [0.86, 1], opacity: [0, 1], ease: CARD_SPRING }, 0)
    .add(fillRef.current, { width: [`${fromPct}%`, `${toPct}%`], duration: 820 }, "+=120")
    // impact rumble fires the same instant the drain starts. amplitude < 6px or it reads as a glitch.
    .add(cardRef.current, { x: [0, 6, 0], y: [0, -4, 0], ease: irregular(10, tone === "defeat" ? 2.4 : 1.4) }, "<<")
    .add(counter, { v: [from, to], duration: 820, modifier: utils.round(0),
                    onUpdate: () => { numRef.current.textContent = Math.round(counter.v).toLocaleString(); } }, "<<")
    .add(numRef.current, { scale: [1, 1.25, 1], color: critColor, ease: POP_SPRING }, "<")  // color, not opacity (clamp-safe)
    .add(".outcome-row", { opacity: [0, 1], y: [10, 0], delay: stagger(45) }, "<<+=120");
});
```

**Dungeon boss reveal** - `DungeonSplash.tsx`. Art scales `1.08 to 1.0` on `outExpo` (camera settling), a thin accent ward ring self-draws around the frame (`svg.createDrawable`, breathing loop on boss splashes), title rises on a spring, subtitle trails 120ms. Desktop pointer parallax via `createAnimatable` (skipped under reduce). Ring is `fill:none`, no `non-scaling-stroke`. APIs: `createTimeline`, `svg.createDrawable`, `createAnimatable`, `createScope`. **Impact High / Effort M.**

**Precision reflex heat-readout** - `games/ReflexGame.tsx`. The marker's glow is a live `mapRange(distance-to-band)` heat readout (dim orange to gold to bright yellow near the target), the band springs in and pulses with a magnetic pull, on-band release rings with `outElastic`. **Critical:** pipe the per-frame `--heat` through **one reused `createAnimatable`**, never `animate()` per RAF frame. APIs: `createAnimatable`, `utils.mapRange`, `createSpring`. **Impact High / Effort M.**

**Score reveal as a slot-roll** - `ActivityResult.tsx`, `MemoryGame.tsx`, `games/_shell.tsx`. The card lands on a spring, the score rolls up with `steps()` for a ledger/slot cadence (fits an economy game), the final number pops `outElastic` with a diagonal shine sweep, the tier badge flips in edge-on (`rotateY 90 to 0`) like an earned stamp. Shared `celebrate()` helper in `_shell.tsx` so three games inherit one celebration. `steps(n)` tuned to the score range. APIs: `createTimeline`, `steps()`, `createSpring`. **Impact High / Effort M.**

**Single accelerating-urgency countdown** - `games/_shell.tsx`, `MinigameSession.tsx`, `games/ReflexGame.tsx`. One `createTimer` on the shared engine replaces per-component `setInterval`/RAF so the bar, seconds text, ReflexGame live clock, and danger heartbeat are frame-synced and pause together (and freeze coherently on tab blur). A `--urgency` var smoothly cross-fades the bar color across the whole drain; the danger heartbeat **accelerates** (shrinking cadence as ms drop) rather than a fixed blink. **Drive DOM directly from `onUpdate`** (keep the 100ms React-render quantum); keep the `firedRef` onExpire guard. Build this on the **shared countdown clock** (Section 5). APIs: `createTimer`, `createAnimatable` (`--urgency`), `utils.mapRange`. **Impact Med / Effort L.**

**Memory tile 3D flip** - `MemoryGame.tsx`. Real `rotateY` flips (needs `preserve-3d` two-face markup), spring-celebrate on match vs `outElastic` recoil on mismatch, center-origin grid-ripple deal-in. Idle facedown tiles get a `waapi` scale/opacity breathe (compositor-safe). Reduced motion falls back to instant reveal. **Impact Med / Effort M.**

### 4.3 RealmMap, terrain, travel (beyond 3c)

**Inertial map** - `util/useZoomPan.ts`, `RealmMap.tsx`. Eased zoom (scroll/pinch dollies in, not a hard cut) and a velocity-seeded spring fling on drag-release, via one reused `createAnimatable` per transform channel (no per-event `animate()` churn). **This is the highest-risk proposal despite "L":** the transform is a React-derived string that every counter-scale layer divides by `zoom.scale` (labels, markers, day/night meridian ticks, ~755-926). Moving source-of-truth into an animatable means those reads must sample the **live eased `cam.scale()`** via a ref or they desync a frame during zoom. Bounds-clamp continuously during fling. Gate behind a spike; sequence after the travel-marker win. APIs: `createAnimatable`, `createSpring`, `utils.damp`/`clamp`. **Impact High / Effort M (was L).**

**Ceremonial city selection** - `RealmMap.tsx`, `.module.css`. The current CSS `ringDraw` keyframe only fires on mount and uses a hardcoded `stroke-dasharray: 60`. Replace with `svg.createDrawable` proxies and a three-beat timeline (outer ring scribes, inner follows, dot springs, shockwave ripples) that **replays on every re-pick**, keyed imperatively off `[selectedId]` (not a React remount). Drive the ripple radius via the `r` attribute, not transform scale, so the counter-scale does not fight it. APIs: `svg.createDrawable`, `createTimeline`, `stagger`. **Impact Med / Effort M.**

**Inked parchment road reveal** - `RealmMap.tsx`, `.module.css`. Roads self-draw center-out (`stagger({ from: "center" })`) instead of a flat 1.4s opacity fade. Catch: roads use `stroke-dasharray: 6 4` and `createDrawable` also commandeers dasharray, so `commitStyles()` then restore the dashed class on completion; reapply `non-scaling-stroke` only post-draw (it hurts drawable perf). APIs: `svg.createDrawable`, `stagger`. **Impact Med / Effort S.**

**2D/3D toggle on a shared timeline** - `city3d/transition.ts`. Fold camera pitch + terrain extrusion + look-at target onto one `createTimeline` so they cannot desync, replacing the hand-rolled RAF+lerp+`easeOutCubic` loop. Spring tilt for organic settle. Keep the `setPitchHard`/`setTargetHard` setters inside `onUpdate` so the Three.js controller's own smoothing does not double-lerp. **A spring's settle duration overrides explicit `duration`,** so the precise 220ms `runViewTween` must stay on a **named ease** (`inOutCubic`), not a spring. Verify `.then()`/`onComplete` still fire if `pauseOnDocumentHidden` freezes mid-tilt. APIs: `createTimeline`, `createSpring`, plain-object targets. **Impact Med / Effort M.**

**Living territory borders** *(new, high-ceiling)* - `RealmMap.tsx`, `.module.css`. `svg.morphTo` is entirely unused and the map never animates its strategic payload: who owns what. Morph a control-zone polygon as front lines shift after an on-chain PvP/rally resolution; draw/retract the border stroke on claim/loss. Drive *which* silhouette from chain state (the existing `biomeAt`/Haversine source of truth); the morph is purely visual. Requires pre-normalized polygon point counts. APIs: `svg.morphTo`, `svg.createDrawable`, `createTimeline`. **Impact High / Effort M.**

### 4.4 Cosmetics, heroes, shop, leaderboard

**FLIP rank-reorder** - `LeaderboardView.tsx`, `leaderboard/page.tsx`. True FLIP keyed by on-chain pubkey so identity-preserving rows physically overtake each other when you switch metric (Networth to Combat Power), paired with a synchronized score count-up. Medal rows entering the top 3 get a gold/silver/bronze glow. Capture First rects **before** React reorders (useLayoutEffect ordering is the trick), measure only visible rows (50-row pagination), guard `dy` for rows paging in/out. `GoldNumber` needs a controlled value path for the count-up. **Do not `scope.revert`** (FLIP settles to identity). APIs: `getBoundingClientRect` + `animate(translateY)`, `createSpring`, plain-object count-up. **Impact High / Effort M.**

**Rarity-aware tile ripple** - six shop/wardrobe grids (`CosmeticsView`, `ItemsView`, `NoviView`, `DailyView`, `BundlesView`, `wardrobe-tab`). Tiles wash in as a 2D diagonal ripple; each tile's glow blur encodes rarity via a `stagger` range fed into a `boxShadow` keyframe, so the entrance doubles as a rarity-hierarchy reveal. One shared scope + spring across all six. `grid:[cols,rows]` must read the live breakpoint. `utils.set` initial state to avoid first-frame flash. Box-shadow bloom is main-thread; the stagger spreads the paint in time, keep the resting glow cheap. APIs: `stagger({ grid, range })`, `createScope`, `createSpring`. **Impact High / Effort M.**

**Tactile selection physics** - `NoviView`, `FlashView`, `CosmeticsView`, `PaymentMethodSelector`. Two independent clocks in one call: a snappy scale-bounce (instant feedback) + a slower lingering glow (status cue), with `composition:'blend'` so hover-while-selected stacks instead of fighting. Reframe NoviView's `md:-translate-y-3` hard-jump into an `outElastic` physics float - **replace the class, do not stack** or the element double-offsets. **Under `blend`, use plain `[from,to]` arrays only** (no multi-keyframe/color). APIs: per-property overrides, `composition:'blend'`, `createSpring`. **Impact High / Effort M.**

**Living ability card** - `heroes/AbilityCard.tsx`, `PendingEffectBadge.tsx`. An SVG arc ring draws emptier as cooldown burns down, `seek()`-ed to real remaining-seconds from chain (not a free-running CSS animation that desyncs). Per-second number scale-flip; ready-state spring bloom on the button. Armed badge pulses via `waapi` scale/opacity (compositor-safe - survives tx signing). **`InteractiveTrigger` re-renders every second**, so the timer + ring instance **must live in refs**, not be recreated each render. APIs: `svg.createDrawable`, `animate({ autoplay:false })` + `seek`, `createTimer` (or the shared clock), `waapi`. **Impact Med / Effort M.**

**Subscribe tier ladder** - `subscribe-tab.tsx`. One timeline: cards deal in left-to-right with a spring rise, each card's perk list cascades down as it lands, the recommended tier floats higher (physics, replacing `md:-translate-y-3`) and its badge pops on the same beat (prefer always-rendered + opacity over a `display` toggle to avoid a flash), a conditional expiry pulse keyed on real `subscription_end`. APIs: `createTimeline`, `stagger` as position arg, `createSpring`. **Impact Med / Effort M.**

**Wardrobe equip ceremony** - `wardrobe-tab.tsx`, `CosmeticFrame.tsx`, `CosmeticBadge.tsx`. Equip is a reversible ceremony: border morphs to the seal color, rarity glow blooms then settles into a breathing halo, a checkmark self-draws (`svg.createDrawable`). `anim.reverse()` makes unequip the same timeline backward. Tiles re-render on `ownedIds` refetch, so `commitStyles` or guard against mid-play remount; wire equip-success from the TxButton resolution path. APIs: `createTimeline`, `svg.createDrawable`, `anim.reverse`, `--glow` var. **Impact Med / Effort M.**

### 4.5 War-table, messages, chronicle, presence, cairn

**Jump-to-parent homing ring** - `ThreadRenderer.tsx`, `MessageBubble.tsx`. Tapping a reply quote recoils the source; the thread scrolls the parent to center; a wide halo collapses onto the bubble and rings down in two diminishing sonar waves (`composition:'blend'` so rapid re-jumps add, not snap). Needs a dedicated `pointer-events:none` `.jump-halo` span at rest opacity 0. Keep duration under (or extend) the existing 1200ms highlight timer. **Under blend use a plain scale array, not a 5-stop keyframe.** APIs: `animate`, `createSpring`, `composition:'blend'`. **Impact High / Effort M.**

**Sent confirmation seal** - `MessageBubble.tsx`. When a pending message reconciles, the Check pops with a spring overshoot while a thin ring sweeps once around it (`svg.createDrawable`) and dissolves - a stroke-traced "settled on chain" seal. Detect the delivered **edge** with a `wasPending` ref so it does not fire on initial mount of already-delivered messages. The lucide Check needs a ref-able inline `<svg>`. APIs: `createTimeline`, `svg.createDrawable`, `createSpring`. **Impact High / Effort M.**

**Reaction chips** - `ReactionRow.tsx`. Chips deal in with a spatial stagger whose origin flips by bubble side (`from:'last'` under your own, `'first'` under received); a chip flipping to *mine* does a scale punch + center-origin glow burst. Detect the per-emoji `false to true` transition (track previous `reactedByMe` set) or it fires on unrelated re-renders. `utils.set` initial state. APIs: `stagger`, `createScope`, `animate(boxShadow)`. **Impact Med / Effort M.**

**DM inbox presence** - `PresenceDot.tsx`, `messages/page.tsx`. Two tiers: a one-shot spring **sonar** on the offline to online edge (the moment that matters) + a perpetual cheap `waapi` scale/opacity **breathe** (compositor-safe, survives RPC polling). Scope the `.sonar` selector within the dot wrapper or all dots fire together; cancel the waapi loop on unmount **and on going offline**; edge-guard against initial mount. Keep offline dots plain CSS (no idle compositor work across a long roster). APIs: `animate`, `createSpring`, `waapi`, `createSeededRandom` (phase jitter so a roster does not pulse like a metronome). **Impact High / Effort M.**

**Chronicle** - `ChroniclePanel.tsx`. Beats unfold one by one (stagger), the chapter bar fills under a spring whose numeric counter is tweened off the **same object** (bar and number cannot desync), and a `svg.createDrawable` gold seal stamps on the `done`-flag edge. Diff the previous done set so the stamp does not replay every chain poll; mount seals only on the current act to bound cost. APIs: `animate`, `createTimeline`, `stagger`, `svg.createDrawable`, `createScope`. **Impact Med / Effort L.**
*See also:* **scroll-scrubbed Chronicle saga** (Section 4.6) - the higher-ceiling version.

**Cairn polish** - `CairnPresence.tsx`, `CairnFloating.tsx`. In-place tuning of an already-animated surface: swap two-step duration tweens for one coherent spring recoil, use `composition:'blend'` so the click never stutters the idle breathe (**simple scale array under blend, not percent-keyframes** - the sketch must resolve this), name the Draggable release spring so drag-settle and the squeeze-pulse share one material. Verify `breathRef` differs from `pressRef` so they compose, not collide. APIs: `createSpring`, `composition:'blend'`, `createDraggable` `releaseEase`. **Impact Med / Effort S.**

### 4.6 Cross-cutting / new

**Scroll-scrubbed Chronicle saga** *(new)* - `ChroniclePanel.tsx`. `onScroll` is entirely unused and the Chronicle is the one surface that is literally a temporal narrative. Bind each act/beat to `onScroll({ sync: true })` so scrolling the history scrubs the kingdom's timeline forward and reverses on scroll-up - banners unfurl, counts tick, seals draw as you scroll. The textbook `onScroll` use case; a signature "turn the illuminated pages" moment. APIs: `onScroll(sync:true)`, `createTimeline`, `svg.createDrawable`, `utils.mapRange`. **Impact Med / Effort M.**

**One shared cinematic camera rig** *(new)* - RealmMap / useZoomPan / city3d / Arrival. A module-level `{panX, panY, zoom}` rig driven by one `createAnimatable`, exposed via context, so fly-to-city, the 2D/3D toggle, the travel-marker follow, and the arrival "survey the land then focus the capital" beat all speak one spatial language and chain into each other. The single biggest coherence multiplier and it removes two competing rAF loops. Sequence after the travel-marker and inertial-map wins land. **Impact High / Effort L.**

**Layout-driven motion infra** (`MorphTabBar`, `TransitionOverlay`, `TxButton`, `LoadingSequence`, `NoviGenerator`): the existing-usage refactors fold into Foundations below - consolidate `MorphTabBar`'s five calls into one reversible timeline, scope-and-clean `TransitionOverlay`'s leaking per-phase timeline, fuse `TxButton`'s three motion layers into one `createAnimatable`, batch `LoadingSequence` + fix `useRevealOnMount` cleanup.

---

## 5. Foundations - build these first

These are small, they are infra, and the ~38 surface proposals above **consume** them. Building them first makes the rest correct by construction (the codebase forgets cleanup by default - `useRevealOnMount`, `TransitionOverlay`, `LoadingSequence` all prove it).

### 5.1 `useReducedMotion()` + one source of truth

Reduced-motion is 8+ duplicated, non-reactive `matchMedia` reads today; none react to a live OS toggle, and `MorphTabBar`'s popover and plus-icon rotate ignore it entirely. The codebase already ships `lib/hooks/useMediaQuery.ts` and nothing uses it for this.

- Keep a single non-hook `prefersReducedMotion()` in `lib/utils.ts` for the dozens of `animate()` effects.
- Add `lib/hooks/useReducedMotion.ts` built on `useMediaQuery` for React branches that need a real "skip the choreography, set final state" path (combat, dungeon, FLIP) - something `engine.speed` alone cannot express.
- Files: `lib/utils.ts`, `lib/hooks/useMediaQuery.ts`, `lib/hooks/useReducedMotion.ts`.

### 5.2 The engine conductor: global reduced-motion + confirm-time slow-mo

There is **zero `engine.*` usage** today. One root-provider effect sets `engine.speed = 0.001` on OS reduce (retroactively covering the spots the code misses, with no per-file edits), and `TxButton` drops the world to `engine.speed ≈ 0.6` during the `sending` phase so attention concentrates on the confirming on-chain action, snapping back on confirm/fail. `engine.pauseOnDocumentHidden` is already the default - **stop hand-rolling `visibilitychange`.**

```tsx
// app root: reduced-motion master switch (reactive)
useEffect(() => {
  const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
  const apply = () => { engine.speed = mq.matches ? 0.001 : 1; };
  apply();
  mq.addEventListener("change", apply);
  return () => mq.removeEventListener("change", apply);
}, []);
```

> **The single most important cross-cutting rule:** `engine.speed` scales the **whole** library. Any authoritative on-chain countdown driven by `createTimer` (construction, cooldown, claim ring, minigame timer) would **also** slow during the confirm-beat or reduced-motion, and would then **lie about remaining chain time.** Drive chain-truth countdowns off `Date.now()` / wall-clock, **or** keep them in a scope exempt from the global speed. Never touch `engine.timeUnit`. Keep the slow-mo beat very short.

> **Ambient loops must early-return under reduced motion**, not merely run fast - an instant-but-still-looping breathe is wasted compositor work and still implies motion. One-shot choreography can rely on the `engine.speed` fast-forward; presence/memory/cairn/banner breathes should not even mount under reduce.

### 5.3 `useAnimeScope(rootRef, builder, deps)` - the React cleanup pattern

`createScope` is used **zero** times, yet nearly every proposal reaches for `createScope({root}).add(...)` + `return () => scope.revert()` + a reduced-motion early-return. That is the same 6 lines copied into ~25 effects. Build one hook that (a) builds the scope rooted at a ref once populated (post-mount, inside the effect - the ref must exist), (b) passes `mediaQueries: { reduce }` so builders read `self.matches.reduce`, (c) returns `scope.revert()` as cleanup, (d) re-runs on deps, and (e) exposes a `revert: false` option for FLIP cases.

```tsx
export function useAnimeScope(
  opts: { root: RefObject<Element>; mediaQueries?: Record<string, string>; deps?: unknown[]; revertOnCleanup?: boolean },
  builder: (m: { reduce: boolean }) => void,
) {
  useEffect(() => {
    if (!opts.root.current) return;
    const scope = createScope({
      root: opts.root.current,
      mediaQueries: { reduce: "(prefers-reduced-motion: reduce)", ...opts.mediaQueries },
    }).add((self) => builder({ reduce: !!self.matches.reduce }));
    return () => { if (opts.revertOnCleanup !== false) scope.revert(); else scope.cancel?.(); };
  }, opts.deps ?? []);
}
```

> **FLIP teardown rule:** FLIP animations (estate reflow, leaderboard, any "settle to identity") must **not** `scope.revert()` - revert wipes the inline transform and flashes. Pass `revertOnCleanup: false` and rely on `cancel()`. Reserve `revert()` for entrance/celebration animations whose final visible state equals the **CSS resting state** (otherwise revert strips a value only the animation set).

Validate this hook against rapid mount/unmount **before** fanning it into 25 files. `CombatOutcomeModal` (4.2) is the reference integration.

### 5.4 Motion tokens module - `lib/motion/tokens.ts`

Across the proposals there are dozens of inline `createSpring({ stiffness, damping })` literals (190/19, 210/24, 240/18, 200/20, 240/12, 160/22…). "One shared spring" only pays off if there is **one place** defining the material. Export named springs, a duration scale, canonical eases, and stagger steps, built **once at module scope** (recreating a spring per render re-runs its simulation).

```ts
// lib/motion/tokens.ts - built once, imported everywhere
export const PRESS    = createSpring({ stiffness: 240, damping: 18 });
export const SETTLE   = createSpring({ stiffness: 210, damping: 24 });
export const BLOOM    = createSpring({ stiffness: 190, damping: 14 });
export const REORDER  = createSpring({ stiffness: 200, damping: 20 });
export const WORLD_FLING = createSpring({ stiffness: 90, damping: 16 });
export const DUR = { fast: 200, base: 420, slow: 700 } as const;
export const STAGGER = { tight: 28, base: 45, loose: 70 } as const;
```

A global retune becomes a one-file change; `MorphTabBar`'s existing `SPRING_OPEN` folds in here.

### 5.5 One shared countdown clock - `lib/motion/countdownClock.ts`

Several high-value proposals each spin up their own `createTimer` per element (construction per card, cooldown per ability, minigame, claim). One app-level `createTimer` loop whose `onUpdate` fans out to every registered countdown (each reads its own chain `endTs`, writes its own `--progress` var) bounds main-thread cost to a single rAF loop regardless of N, keeps everything frame-synced and paused-together, and gives **one place to exempt chain-truth from the `engine.speed` slow-mo** (per 5.2). Turns N timers into 1. **Construction progress (3b/4.1) and cooldowns (4.4) must use this, not per-card timers.**

### 5.6 waapi vs JS guidance

- **`waapi` only accelerates `transform` and `opacity`** (the compositor properties). A looping `box-shadow`, `backgroundColor`, `width`, or `filter` through waapi gets **no GPU benefit** and is still main-thread paint. The "survives a busy main thread / tx signing" justification holds **only** for scale/opacity loops (presence sonar/breathe, memory idle breathe, cairn breathe). For glows, animate a transform/opacity pseudo-element layer instead of `box-shadow`, or accept it as a cheap short main-thread paint.
- Keep **cinematic sequencing** (`createTimeline`, mid-flight `seek`/compose) in JS `animate`. Reserve `waapi` for standalone always-on ambient loops.
- **Per-frame RAF visuals** (ReflexGame heat, minigame `--urgency`) must pipe through **one reused `createAnimatable`**, never `animate()` per frame - stacking instances is the classic anime.js footgun. `.revert()` on unmount.
- **Forced synchronous layout:** every FLIP / measure-into-stepper reads `getBoundingClientRect` in `useLayoutEffect`. Gate measurement behind an actual "did the relevant data change" check, batch all reads before all writes, never measure on unrelated re-renders.
- **`composition:'blend'`** is forward-only and does **not** support multi-keyframe / color / `reverse`. Authoritative rule: **under blend, plain `[from,to]` arrays only**; if you need keyframes, layer a second non-blended animation.
- **`svg.morphTo`** degrades when point counts or command structures differ - require pre-normalized paths (matching node counts) for any morph target, or downgrade to draw + crossfade.
- **Bundle:** confirm the new `svg.*` / `engine` / `utils` / `waapi` named exports tree-shake cleanly and that pulling in motion-path + morph + drawable does not drag the whole SVG plugin into every route. Prefer **route-level dynamic import** for the arrival/dungeon cinematics that are off the critical path.

### 5.7 Coexistence with three.js and the existing draggable

- **city3d** runs its own rAF lerp loop (`transition.ts`) competing with anime's loop. The 2D/3D timeline refactor (4.3) folds it onto the engine via the `Hard` camera setters so the controller does not double-lerp. Longer term, `engine.useDefaultMainLoop = false` + a manual `engine.tick(now)` inside one render loop would unify both under a single rAF - a latent perf win, not urgent.
- **`BootRing`** is a Three.js/WebGL renderer; the `TransitionOverlay` drawable ring (5.8) needs a **new dedicated stroked SVG overlay**, not the WebGL ring.
- The **existing `createDraggable`** on RealmMap and Cairn stays; the inertial-map work (4.3) layers eased zoom/fling on top, and Cairn's drag-release spring gets named (5.4) so manual settle and the squeeze-pulse share one material. Keep touch scroll-lock and suppress-click intact.

### 5.8 Refactor the existing animated files onto these foundations

- **`MorphTabBar`** to one reversible `createTimeline` (width + layer cross-fade + child stagger as a position arg), removing the `widthAnimating` ResizeObserver gate. Use `tl.cancel()` (keeps final styles), **not** `scope.revert()` (would wipe to origin and flash `auto` width). Read rest-width before animating. Pairs with the engine switch (5.2) to cover the popover + icon-rotate that currently ignore reduce.
- **`TransitionOverlay`** to wrap in `useAnimeScope` so the per-phase timeline is cancelled (fixes the confirmed leak); upgrade the flat `scaleX` lines to a self-drawing stroke that retracts on exit. Use `eases.outQuad`/`eases.inQuad` function refs (the bare `in`/`out`/`inOut` strings are power-1.675, not quad aliases).
- **`TxButton`** to fuse the three motion layers into one reused `createAnimatable` that retargets per hold-tick (no `animate()` spawn per increment). Keep the 4s linear-over-time sending fill as an `animate()` tween, not a spring.
- **`LoadingSequence`** to one scoped reveal-and-stamp lifecycle; batch the per-step `forEach` checkmark animations into one staggered call; `utils.set` for a flicker-free first frame.
- **`useRevealOnMount`** to add the missing `return () => a.cancel()`.

---

## 6. Capability coverage matrix

| anime.js v4 module | Used today | Proposed here | Still unused |
|---|---|---|---|
| `animate()` (core) | ✅ 11 files | ✅ broadened (plain-object targets, function values, per-prop overrides, modifiers, composition) | - |
| Playback / `seek` / `progress` / callbacks | partial (`animate` defaults) | ✅ `progress`-bound travel, `seek`-to-chain countdowns, `then()` choreography | - |
| `createTimer` | ❌ | ✅ shared countdown clock, minigame urgency, claim ring, onboarding director | - |
| `createTimeline` | ✅ TransitionOverlay | ✅ combat, beat director, score reveal, subscribe ladder, MorphTabBar, equip ceremony | - |
| `stagger` | ✅ MorphTabBar, useRevealOnMount, LoadingSequence | ✅ grid/`from`/range/axis/modifier across FLIP, roads, tiles, reactions | - |
| `svg.morphTo` | ❌ | ✅ territory borders, beat sigil | terrain/biome blobs, building-tier silhouettes (need authored paths) |
| `svg.createMotionPath` | ❌ | ✅ travel marker, multi-leg caravan | rally arrows, projectile arcs, orbiting presence pip |
| `svg.createDrawable` | ❌ | ✅ route etch, construction ring, cooldown arc, selection seal, roads, ward ring, chronicle seal, sent-confirm ring | sigil/crest reveals, minimap scan |
| `createDraggable` | ✅ RealmMap, CairnFloating | ✅ named release spring, inertial fling | grid-snap building placement, dismiss-by-flick panels, slingshot minigame |
| `createAnimatable` | ❌ | ✅ inertial map, camera rig, ReflexGame heat, urgency var, TxButton, pointer-tilt cards | reactive reticle, live gauge needles |
| `onScroll` / ScrollObserver | ❌ | ✅ scroll-scrubbed Chronicle saga | long-scroll lore onboarding, reveal-on-scroll feeds |
| `eases` / `createSpring` | ✅ `spring`/`createSpring`, string eases | ✅ tokenized springs, named eases module-wide | - |
| `steps()` | ❌ | ✅ score slot-roll | sprite-sheet walk cycles, discrete pip drains, tick clocks |
| `irregular()` | ❌ | ✅ combat impact rumble | torch/fire flicker, dice/RNG spins, damaged-unit limp |
| `cubicBezier()` | ❌ | - | bespoke brand/IP curve matching |
| `linear()` (custom stops) | ❌ | - | peek/double-take, explicit projectile arc profiles |
| `engine` | ❌ | ✅ reduced-motion switch, confirm-time slow-mo, shared clock host | `useDefaultMainLoop` unify with three.js, battery `fps` throttle |
| `createScope` | ❌ | ✅ `useAnimeScope` everywhere (cleanup + `mediaQueries.reduce`) | - |
| `utils` (`damp`/`clamp`/`mapRange`/`round`/`createSeededRandom`/`set`/`get`/`$`) | ❌ | ✅ camera follow, heat mapping, count-up rounding, seeded presence jitter, flicker-free set | `interpolate`, `keepTime`, `shuffle` reveal order |
| `waapi` | ❌ | ✅ presence breathe/sonar, memory idle, cairn breathe (scale/opacity only) | hardware-accelerated title reveals |

---

## 7. Phased rollout

**Phase 0 - Foundations (do not skip).** 5.1-5.6: `prefersReducedMotion()` source + `useReducedMotion()`, the engine conductor (with the chain-truth exemption rule wired), `useAnimeScope` (validated on rapid mount/unmount), `lib/motion/tokens.ts`, the shared countdown clock, and the waapi/blend/morph/FLIP discipline written down. Small, mostly new files, near-zero UI risk. Land `CombatOutcomeModal` (4.2) here too as the reference integration that exercises scope + `mediaQueries.reduce` + teardown.
*Risk:* the engine-speed-vs-chain-timer collision. Resolve it in Phase 0 or every later countdown lies.

**Phase 1 - Refactor existing animated files onto the foundations (5.8).** `MorphTabBar`, `TransitionOverlay` (fixes a real leak), `TxButton`, `LoadingSequence`, `useRevealOnMount` (adds missing cleanup). These pay down debt, prove the hooks under load, and ship the reduced-motion coverage the current code admits it lacks. Low ceiling, high confidence.

**Phase 2 - The three headliners.** Construction progress (3b, on the shared clock) to FLIP estate reflow (3a) to leaderboard FLIP (4.4, same FLIP discipline) to travel marker (3c, **spike the counter-scale interaction first**) to jumpahead beat director (3b cinematic). Sequence so the FLIP rule and the chain-sync pattern are battle-tested on the estate before the leaderboard and the map.
*Risk:* `createMotionPath` re-anchoring inside the counter-scale `<g>` is the thing that bites; do the spike before committing the marker.

**Phase 3 - Breadth: per-area polish.** Combat dungeon/precision/score/memory, shop tile ripple + selection physics, ability card, subscribe ladder, equip ceremony, war-table seals/sonar/reactions, chronicle. All consume Phase 0 infra, so each is a contained surface change.
*Risk:* main-thread paint piling up - box-shadow/color glows are everywhere here; honor the waapi rule and keep celebrations short. Edge-detection (Set-diffs for ready/done/mine/delivered transitions) is the recurring correctness trap; enforce it per the per-proposal notes.

**Phase 4 - High-ceiling cross-cutting.** Inertial map (4.3, **highest map-render risk - gate behind a spike**, sequence after the travel marker), living territory borders (4.6 morph), scroll-scrubbed Chronicle saga (4.6 `onScroll`), and finally the shared cinematic camera rig (4.6) once fly-to / 2D-3D / travel-follow all exist to unify.
*Risk:* these move the map transform's source of truth and touch the strategic payload; they are the most rewarding and the most likely to regress the render model. They go last, behind spikes, on purpose.

**Caveats that span every phase:** every effect-driven `animate`/`createTimer`/`createAnimatable`/`waapi.animate` returns its cancel/revert (enforced by `useAnimeScope`); FLIP never reverts; chain-truth countdowns are exempt from global speed; `box-shadow`/color loops are main-thread; `blend` takes plain arrays; `morphTo` needs matched point counts; ambient loops early-return (not just slow down) under reduced motion; and bundle size gets a check after the heavy SVG features land, with the off-critical-path cinematics dynamically imported.
