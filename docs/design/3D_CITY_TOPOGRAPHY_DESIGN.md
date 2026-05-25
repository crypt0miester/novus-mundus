# 3D City Topography for `CityTerrainMap.tsx`

Port the displaced-plane terrain renderer from
`sdks/novus-mundus-ts/terrain-builder/src/city/city.js` into
`apps/web/src/components/world/`. A single WebGL scene renders BOTH
the flat top-down ("2D") view and the tilted ("3D") view; a
**2D ↔ 3D toggle pill** in the status row animates between them with
a Google-Maps-style tilt — pitch and per-vertex elevation lerp
together over ~700 ms so the terrain literally rises out of the
plate as the camera tilts back.

The existing Canvas2D component (`CityTerrainMap.tsx` today) survives
as a **WebGL-unavailable fallback only** — see `## Mode toggle` for
the capability gate. Users on WebGL2-capable browsers (effectively
everyone in our target audience) see the WebGL renderer in both
modes; the toggle is a visual-state change, not a backend swap.

The reference renderer and the current web component share the same
chain-faithful heightmap functions (`terrainElevation`,
`terrainMoisture`, `elevationToColor` in
`sdks/novus-mundus-ts/src/calculators/terrain.ts`), so this is a new
rendering layer, not a re-derivation of the math.

**The current `CityTerrainMap.tsx` does more than a naive 2D
renderer.** Read the "Current state" section before touching anything
— every feature listed there must survive in the WebGL renderer's
2D mode (and continue working in the Canvas2D fallback).

## Projection: one perspective camera, two pitch presets

`THREE.PerspectiveCamera` driven by spherical state `(yaw, pitch,
distance, target)`, smoothed every frame — model from
`sdks/novus-mundus-ts/terrain-builder/src/town/camera/IsometricCamera.js`.

**One camera, two modes.** Switching between 2D and 3D doesn't switch
projections (ortho ↔ perspective) — it just animates `pitch` and
`mesh.scale.y` between two presets. This is what makes the
Google-Maps-style tilt possible; you can't continuously animate
across two different projection types.

**Mode presets**:
- **2D mode**: `pitch=0°` (camera looking straight down), `yaw=0°`,
  `mesh.scale.y=0` (flat plate, no displaced terrain — shading from
  vertex colors only, matches Canvas2D look). Orbit gesture
  **disabled** (rotating a top-down view is meaningless; yaw rotation
  is still allowed via the same orbit affordance because compass-spin
  on a top-down map is meaningful, but pitch is locked at 0).
- **3D mode**: `pitch=35°` (cf. `IsometricCamera.js:21`; `city.js:288`
  uses 40° — pick 35° to match the town camera), `yaw=0°` initial but
  user-drivable, `mesh.scale.y=1` (full elevation). Orbit fully
  enabled.

**Pitch bounds depend on mode**. In 2D mode, pitch is locked at 0 (or
in a thin band `[0°, 5°]` if you want gestural pitch to peek). In 3D
mode, pitch is clamped `[5°, 82°]` per `city.js:277-278`. The mode
transition tween crosses the 5° threshold; during the tween,
pitch-clamp checks are bypassed.

**Other defaults** (from the terrain-builder reference):
- `distance = 4.5` world units (`city.js:289`).
- `fov = 30°` (`IsometricCamera.js:20`).
- Smoothing factor `8.0`, zoom momentum `0.88` — see
  `IsometricCamera.js:33,31`. Smoothing is bypassed during the mode
  transition (the tween's ease-out IS the curve).

**Why a single perspective camera over ortho-2D + perspective-3D**:
- Continuous animation between modes is the whole point — switching
  projections discretely defeats the Google-Maps wow moment.
- Slight foreshortening in 2D mode (cells at the screen corners
  project ~3% smaller than at centre, at fov=30°/pitch=0°/distance=4.5)
  is below the perceptibility threshold for top-down city-scale
  rendering. Verified against Google Maps's own top-down mode.
- Grid-parity is projection-agnostic — `worldToGrid` raycasts the
  terrain plane and rounds, so click math is identical whether
  pitch is 0° or 35°.
- One controller, one camera matrix, one set of gesture handlers.
  Less code, fewer edge cases.

**Do not use `OrbitControls` verbatim.** It supports the polar bounds
but doesn't ship the smoothing / zoom-momentum pattern we want, and
the mode-transition tween needs direct access to pitch / target /
scale.y outside the controller's lerp loop. Port
`IsometricCamera.js:190-231` (the `update(dt)` interpolation block —
spherical → cartesian with lerp toward target state) and add
yaw/pitch as user-drivable inputs plus an `isTransitioning` bypass.
See `## Camera and movement` and `## Mode transition`.

## Mode toggle (2D ↔ 3D)

The toggle changes camera + elevation state **inside the same WebGL
scene** — see `## Mode transition` for the animation. Mode is not a
renderer choice; it's two presets of camera + `mesh.scale.y` that
the user animates between.

- `mapMode: "2d" | "3d"` lives on `useSettings`
  (`apps/web/src/lib/store/settings.ts`, zustand with `persist`
  middleware) so it survives navigation and reload. Default `"2d"`.
- "2D mode" = perspective camera with `pitch=0°`, `yaw=0°`,
  `mesh.scale.y=0` (flat plate). Visually indistinguishable from the
  Canvas2D path; orbit gesture disabled (orbiting a top-down view is
  meaningless).
- "3D mode" = perspective camera with `pitch=35°`, `yaw=0°` (initial),
  `mesh.scale.y=1` (full elevation). Orbit gesture enabled
  (right-drag mouse, two-finger drag with orbit-toggle pill on touch).
- Tapping the toggle pill animates between these two presets over
  ~700 ms — see `## Mode transition`.

**WebGL2 unavailable / context creation fails** → orchestrator mounts
the `CityTerrainMap2DFallback.tsx` (Canvas2D path, the existing
implementation) instead of `CityTerrainMap3D.tsx`. The toggle pill
is hidden in that fallback state (the fallback only renders 2D and
can't tilt). A one-line `aria-live` notice shows once. The user's
saved `mapMode` is preserved — if the user has 3D saved and WebGL
later becomes available (e.g. they reload after a driver update),
they get 3D back.

On `webglcontextrestored`, the WebGL path remounts with the current
`mapMode`.

The toggle is **not** a hard reload: switching modes preserves
`selected` / `selectedEntity`, and the tween centres the camera target
on the selected cell (or city centre if none).

## Mode transition (Google-Maps tilt)

The signature wow moment. Pressing the toggle pill animates camera
pitch AND per-vertex elevation together — the camera tilts back as
mountains push up out of the flat plate. Same idea Google Maps uses
when you tap 3D.

**What animates** (in lockstep, ~700 ms, ease-out):

| Parameter | 2D → 3D | 3D → 2D |
|---|---|---|
| `pitch` | `0° → 35°` | `35° → 0°` |
| `mesh.scale.y` (terrain height multiplier) | `0 → 1` | `1 → 0` |
| `target.y` (camera look-at height) | `0 → midpointElevation` | reverse |

`mesh.scale.y` is the existing terrain-builder hook
(`city.js:374` exposes it as `_heightScale` for the debug slider).
The mesh is built once with full Y values; `scale.y` lerps from 0
(flat) to 1 (full elevation) — no rebuild, no shader uniforms,
single `group.scale.y = t` per frame.

**Easing**: `cubic-bezier(0.2, 0.8, 0.2, 1)` — fast launch, gentle
settle. Implement inline (one helper) rather than pulling a tween
library:
```ts
function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}
```
Or the bezier above if you want the punchier curve — both are
within ~5% of each other for this duration.

**Driver**: `requestAnimationFrame` loop, runs only while a tween is
active. Sets a `transitionRef.current = { startTs, fromMode, toMode }`
on toggle press; each frame computes `t = clamp((now - startTs)/700,
0, 1)`, applies eased state, calls `requestRender()`. On `t >= 1`,
clears the ref and flips `useSettings.mapMode` to the new value.

```ts
function tickTransition(now: number) {
  const tr = transitionRef.current;
  if (!tr) return;
  const t = Math.min(1, (now - tr.startTs) / 700);
  const e = easeOutCubic(t);

  const pitchA   = tr.fromMode === "3d" ? PITCH_3D : 0;
  const pitchB   = tr.toMode   === "3d" ? PITCH_3D : 0;
  const scaleA   = tr.fromMode === "3d" ? 1 : 0;
  const scaleB   = tr.toMode   === "3d" ? 1 : 0;
  const targetA  = tr.fromMode === "3d" ? midpointElevation : 0;
  const targetB  = tr.toMode   === "3d" ? midpointElevation : 0;

  camera.pitch     = lerp(pitchA,  pitchB,  e);
  terrainMesh.scale.y = lerp(scaleA, scaleB, e);
  cameraTarget.y   = lerp(targetA, targetB, e);

  requestRender();
  if (t >= 1) {
    transitionRef.current = null;
    useSettings.getState().setMapMode(tr.toMode);
  } else {
    requestAnimationFrame(tickTransition);
  }
}
```

`pitch` here is the desired pitch on the camera controller — the
controller's own smoothing factor is bypassed during the tween
(`tickTransition` sets both desired AND smoothed pitch so the tween
curve is the canonical one, not double-smoothed). Same for
`mesh.scale.y` — written directly, no IsometricCamera-style
interpolation layer.

**Click + gesture suppression during tween**: `isTransitioning =
transitionRef.current != null`. While true:
- All click / pointerdown handlers no-op (don't fire `onPick`).
- Pan / zoom / orbit gestures are ignored (they'd race the tween
  and produce visible jitter).
- Toggle pill is disabled (no double-tap mid-tween reversing the
  tween partway through — let it finish, then accept input).

**Selection-aware framing**: at tween start, if `selectedEntity` or
`selected` is non-null, also tween `target.x/z` from current to
`gridToWorld(selectedCell)` so the focused cell stays centred under
the tilt. If nothing's selected, target stays at current position
(usually city centre).

**Reduced motion**: respect `prefers-reduced-motion: reduce`. If set,
skip the tween entirely and snap to the destination mode's state.
One-line check at toggle press:
```ts
const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
if (reduce) { snapToMode(toMode); return; }
```

**Performance note**: the tween is the *only* time the WebGL scene
needs an always-on rAF loop. Outside the tween it stays on the
render-on-demand policy described in `## Stack decisions`. Start
the loop on toggle press, stop on tween completion — never both
modes' rAF cost in steady state.

**Tween direction is symmetric** — 2D → 3D and 3D → 2D use the same
duration and curve. Some animation systems make the reverse faster
("snap back"); resist the temptation. Symmetric feels right because
the toggle pill is a state switch, not a peek.

## In-mode view tweens

Distinct from the mode-transition tween above. While the user stays
in one mode (2D or 3D), discrete gestures get their own short
animation so the view doesn't snap-cut on large state deltas.

**Where it fires**:
- **Double-click** → zoom in 2× at the cursor (Google-Maps
  convention).
- **Reset button (`↻`)** → return to that mode's default state
  (2D: `{scale=1, panOx=0, panOy=0}`; 3D: `{yaw=0, pitch=35°,
  distance=4.5, target=(0, midpointElevation, 0)}`).
- **Selection-aware re-centre** when an entity gets selected
  far from the current viewport centre (optional v1).

**Where it does NOT fire** — wheel and pinch zoom remain instant.
Per-event delta is small enough that the natural input cadence
reads as smooth on its own; tweening every wheel tick would
double-buffer the user's gesture and feel laggy.

**Easing + duration**:
```ts
function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);   // fast departure, gentle settle
}
const DURATION_MS = 220;
```

The 2D file's `animateView()` implements this; the 3D scene must
match the same curve + duration so 2D-mode and 3D-mode discrete
zooms feel like the same product. Different from the mode-transition
tween (`700 ms` because more state is changing and the tilt is the
focal point); both share `easeOutCubic`.

**Cancellation contract**:
- Any new wheel / pinch / drag / touch / pointerdown cancels the
  in-flight tween. The user's gesture always wins — otherwise the
  view keeps drifting toward an old target while being actively
  manipulated, which feels broken.
- Tween cancellation is symmetric: starting a new tween (e.g.
  double-clicking again mid-zoom) cancels the prior tween cleanly
  and captures a fresh `start` snapshot from the latest
  committed view.
- Implementation: a `viewRef` mirrors the latest `view` synchronously
  (no React commit lag), and `cancelAnim()` clears the rAF id.

**Reduced-motion**: respect `prefers-reduced-motion: reduce` —
snap to the destination state instead of tweening. Same rule as
the mode-transition tween.

**3D scene's mirror**: implement the same tween in
`city3d/controls.ts` against `(yaw, pitch, distance, target)`. The
`IsometricCamera.js` smoothing factor (`smoothing = 8.0`) is the
ambient frame-to-frame interpolation; the in-mode tween *replaces*
that smoothing for the duration of the tween by directly writing
the smoothed values from the eased curve. Mode-transition tween
follows the same bypass pattern.

## Current state

`CityTerrainMap.tsx` already implements a viewport-based 2D renderer
that does substantially more than the original port plan acknowledged.
**Every feature in this list must survive the port** unless explicitly
deferred. Read this carefully before designing the 3D scene.

### Terrain layer
- **Viewport-based**, not full-disc. `renderTerrainViewport(terrain,
  sizeDevW, sizeDevH, panOx, panOy, viewportRadius, cityRadius)`
  paints only the visible region at full pixel resolution,
  re-rendering on every pan/zoom. This is why the current file
  supports zoom up to **200×** without losing crispness.
- **Canvas is rectangular**, not square. Tracked as
  `size: { w, h }`; `gridPerPx` is isotropic anchored to the **shorter
  dim** (`logicalMin = min(w, h)`), so the disc stays round while the
  longer axis shows extra terrain past the disc edge. CSS dropped
  `aspect-ratio: 1` and `border-radius: 50%`; the canvas wrap is now
  a transparent full-rectangle and the "disc" is purely a renderer
  artifact.
- **Edge feather fade** past the city disc — `fadeBand = max(1,
  cityRadius * 0.08)`. Inside the disc: opaque. Inside `[cityRadius,
  cityRadius + fadeBand]`: alpha lerps `255 → 0` so the inked terrain
  melts into the surrounding parchment. Past the band: pixel skipped
  entirely (alpha 0) so the parchment shows through. The 3D path
  intentionally does NOT replicate this fade (see "## Mesh build" —
  square mesh with no radial fade; the inscribed gameplay-disc
  overlay carries the same "city limits" cue).
- The 3D port replaces the viewport-pixel renderer with
  mesh-resolution scaling — at deep zoom we want more vertices per
  cell, not more pixels per cell. See "Mesh resolution" below for
  the strategy.

### Overlay layer
- **City boundary disc** drawn only when the city edge is in view.
  **Dashed faint sepia** — `rgba(46, 31, 16, 0.35)`, `lineWidth =
  0.75 * dpr`, dash `[3*dpr, 3*dpr]`. Reads as an inked shoreline on
  a map page, not a precise mathematical circle (the terrain alpha
  already feathers across the edge — this ring just gives a precise
  "where the chain says no" cue without screaming geometry).
- **Proximity grid (graph-paper gridlines)** rendered when
  `cssPxPerCell ≥ GRID_OVERLAY_MIN_CSS_PX_PER_CELL` (currently `8` —
  named constant in the file). Stride is a doubling decimation so
  line count stays bounded at every zoom level:
  ```ts
  const stride = Math.max(
    1,
    2 ** Math.max(0, Math.ceil(Math.log2(MIN / cssPxPerCell)))
  );
  ```
  Threshold is in **CSS px**, not device px, so it stays visually
  consistent across DPRs (a 1-device-px line is 0.5 CSS px on
  Retina — that's the whole reason the threshold is 8 and not 4).
  Lines are drawn at **half-integer grid coords** (`gridToDevPx(ox -
  0.5, …)`) so they bound cells instead of bisecting them — selection
  squares and occupant tiles fill the cell centred on its integer
  coord and align cleanly with the grid.
- **Centre marker** = antique cartographer's town glyph: an 8-rayed
  star (4 cardinal + 4 diagonal rays) around a small inked nucleus
  with a cream halo. Stroke `rgba(70, 50, 28, 0.85)`, lineWidth
  `max(1, 1.25 * dpr)`, `lineCap: round`. Nucleus fill `rgba(70, 50,
  28, 0.95)`, halo fill `rgba(252, 244, 220, 0.95)`. **Radius scales
  with zoom** so it stays visually anchored to its cell at high
  zoom:
  ```ts
  const r = Math.max(6 * dpr, Math.min(pxPerCell * 0.55, 14 * dpr));
  const nucleusR = Math.max(2 * dpr, r * 0.3);
  ```
- **Occupant rendering — shape distinguished by occupant type.**
  Palette: `PLAYER_FILL = rgba(160, 100, 45, 1)` (tobacco amber),
  `WILD_FILL = rgba(115, 55, 30, 1)` (oxblood), `SELECTED_STROKE =
  rgba(220, 175, 60, 1)`, `CREAM_STROKE = rgba(252, 244, 220, 0.95)`.
  Two render modes gated on `GRID_OVERLAY_MIN_CSS_PX_PER_CELL`:
  - Low zoom (below threshold): **player = filled circle**;
    **wild = filled diamond** (rotated-square path). Shape — not
    just hue — is the primary distinguisher so they read clearly
    at the smallest dot size and on the monochrome paper
    background. No inner yellow danger ring; the diamond shape
    itself signals "danger" at this scale.
  - High zoom (at or above threshold): filled square tiles matching
    one grid cell exactly, with outline stroke. Same tile shape for
    both occupant types — colour is the only differentiator at this
    zoom because the cell footprint is the message. Snap tile rect
    to integer device pixels — sub-pixel offsets give visible
    seams. The cell footprint must be obvious; this is the whole
    UX premise of being able to zoom in.
- **Entity selection ring**: if the selected entity matches an
  occupant, that occupant draws with a yellow stroke instead of cream
  (`SELECTED_STROKE = rgba(220, 175, 60, 1)`, `lineWidth` bumped by 1).
- **Landing-cell crosshair** for the intercity picker: orange ring +
  short `+` crosshair, also dual-mode (tile or circle) on the same
  threshold.
- **In-flight walk lines** — dashed seal-orange lines from origin
  cell → destination cell with a pulsing marker at the interpolated
  progress point. Two flavours:
  - **Local player's walk** (`travel` prop) — full brightness:
    line `rgba(180, 83, 9, 0.85)`, stroke `2 * dpr`, dash `[6, 4]`;
    marker `r = 4.5 * dpr` orange fill + cream outline + translucent
    `r = 9 * dpr` halo. Realm-map scale is sub-pixel for an in-city
    walk, so the disc is the only meaningful surface.
  - **Other players' walks** (`otherWalks` prop, array) — muted:
    line opacity `0.4`, stroke `1.5 * dpr`, dash `[4, 4]`; marker
    `r = 3 * dpr` opacity-`0.85` fill + thin cream outline, no halo.
    Drawn FIRST so the local player's bright line layers on top.
  `pct` is interpolated by the parent against `chainNow` (1 Hz), so
  markers advance smoothly between WS pushes — the disc itself
  doesn't run a separate animation frame.
- **Overlay rendering order** (top down → bottom up so each layer
  reads on top of the previous):
  1. City boundary ring (dashed)
  2. Proximity grid (when threshold hit)
  3. Other-players walks (muted)
  4. Local-player walk (bright)
  5. Centre marker (cartographer's star)
  6. Occupancy circles (player) / diamonds (wild) / tiles (high zoom)
  7. Selection ring + crosshair

### Inputs / affordances — must keep working
- `cityAccount`, `selected`, **`selectedEntity`**, optional
  **`onSelect`**, optional **`onEntitySelect`** — full prop surface.
- `onSelect` is **typed** optional on the component (the read-only
  affordance is preserved in the type contract), but the only caller
  (`map-tab.tsx`'s `renderSheetOverride`) now wires it
  unconditionally. The previous home-city-is-read-only branch was
  removed — picking in the **home city** now sets an *intracity
  walk* destination, picking in a **destination city** sets an
  *intercity landing* cell. Same `destCell` state; the downstream
  morph-bar code (see "Downstream of entity selection" below)
  decides which CTA to surface based on `isHomeDestination`.
- The exported `CityTerrainEntity` shape is load-bearing — it's what
  the entity-detail panel in `map-tab.tsx` consumes:
  ```ts
  export interface CityTerrainEntity {
    pubkey: string;        // base58 of the LocationAccount's occupant
    occupantType: number;  // OCCUPANT_PLAYER | OCCUPANT_ENCOUNTER
    gridLat: number;
    gridLong: number;
  }
  ```
  The `OccupiedCell` shape (with the extra `occupant: string` —
  base58 of the location's occupant PDA — so click → entity promotion
  has the pubkey on hand without a re-fetch) is exported from
  `apps/web/src/lib/hooks/useCityOccupied.ts`. The component reads it
  via the `useCityOccupied(cityId)` hook; the hook seeds zustand from
  the SDK once per cityId and otherwise reads from the WS-fed
  `s.locations` map. No GPA polling.
- The exported `WalkLine` shape is load-bearing for in-flight
  intracity rendering — used both for the local player (singular
  `travel` prop) and for every other walker in the city (`otherWalks`
  array):
  ```ts
  export interface WalkLine {
    fromGridLat: number;
    fromGridLong: number;
    toGridLat: number;
    toGridLong: number;
    pct: number;          // 0–100, interpolated by the parent
  }
  ```
  Coords are **full grid units**, NOT offsets from the city centre —
  the component subtracts `cityLat/LongGrid` internally to keep the
  parent's call sites symmetric with PlayerAccount fields. See
  "Grid parity" for the convention.
- Two walk-line props on `CityTerrainMap`:
  - `travel?: WalkLine | null` — the local player's in-flight walk.
    Parent sets it only when `isIntracityTravel && cityId ===
    player.currentCity`.
  - `otherWalks?: WalkLine[]` — every other player intracity-walking
    in the viewed city. Parent is responsible for excluding the local
    player; duplicates would just draw twice.
- Wheel/pinch zoom **1× – 200×**, drag pan, **double-click zooms IN
  2× at the cursor** with a cubic ease-out tween (220 ms) — does NOT
  reset (reset is the `↻` chip in the top-right). Click suppression
  after drag, touch parity.
- **350 ms touch click-suppression** after pinch — preserves UX on
  iOS where a phantom click otherwise fires at end of pinch.
- **rAF-batched pan with explicit final flush on mouseup/touchend**
  — pixel deltas accumulate in `pendingDx/pendingDy` and flush once
  per paint; on release the rAF is cancelled and `flushPan` runs
  inline so final position is exact.
- **Animated view tweens** for discrete gestures (double-click +
  reset). See `## In-mode view tweens` below — the 3D scene must
  match the same easing + cancellation contract for its own
  in-mode reset / zoom-tween.
- Hover readout: **`Water | Shore | Land | Hill | Peak`**, metres
  from centre, `impassable` tag. Label bucketing (passable land):
  `t < 0.1 → Shore`, `t < 0.5 → Land`, `t ≥ 0.5 → Hill`, where
  `t = (elevation − waterLine) / (peakLine − waterLine)`. Water/Peak
  remain driven by `s.isWater` / `s.isMountain` from
  `sampleTerrain`.
- **Click semantics with entity selection** — exactly as currently
  implemented in `handleClick`:
  - Click outside disc → `onEntitySelect(null)` and return.
  - Click on occupied cell → `onEntitySelect({pubkey, occupantType,
    gridLat, gridLong})` and return. **`onSelect` is *never* called
    for occupied cells.** The "fires regardless of whether
    `onSelect` is wired" contract is still part of the component's
    type (props remain optional) — the read-only affordance is
    just no longer exercised by the current caller.
  - Click on empty passable cell → `onEntitySelect(null)`, then
    `onSelect(gridLat, gridLong)` if wired. The parent's
    `onSelect` handler **also clears `selectedEntity`** so picking
    a landing cell drops any active entity selection — port the
    `onEntitySelect(null)` part of this contract into the scene;
    the parent's extra `setSelectedEntity(null)` already happens
    inside its `onSelect` closure.
  - Click on empty impassable cell → `onEntitySelect(null)`; no
    `onSelect` (impassable rejection happens after the entity
    deselection).
- Status row tail: `· scouting…`, `N player(s) · M wild` (singular
  form when `playerCount === 1`), `· terrain unset` (anchorCount ==
  0), `· scouting blocked` on RPC failure, plus a **zoom indicator**
  `· 1×` / `· 1.5×` / etc., followed by `· cells visible` when the
  threshold above is met.
- Empty-state readout copy: "click a player or wild to inspect, or
  pick an empty cell to land." (lowercase 'c', "player" not "soul").
  Aria-label on the canvas wrap: "Terrain disc for {city.name}.
  Click an occupant to inspect them, or pick an empty cell to land.
  Scroll or pinch to zoom, drag to pan, double-click to zoom in."
  Both must port verbatim — the entity-inspect framing is what
  tells users the dot is clickable.

### Live other-players state (zustand + WebSocket, NOT polling)

The `otherWalks` feed is **load-bearing on real-time freshness**. A
30 s tanstack-query refetch (the pattern the original `useWorldPlayers`
hook used) would leave markers stuck at start-pct for ~30 s after a
walk begins and floating at end-pct for ~30 s after it completes —
bad UX. The current path:

- **Boot seed** (`lib/store/subscriptions.ts`): the boot `Promise.all`
  in `startGameSubscriptions` includes `client.fetchAllPlayers()` and
  dispatches `upsertOtherPlayer` for everyone except self. One fetch
  per session, runs at app start.
- **Live updates** (`GameSubscriptionManager`): a single program-wide
  WebSocket routes every `AccountKey.Player` event by handler at
  `subscriptions.ts:168-174` — self → `setPlayer`, others →
  `upsertOtherPlayer`. Travel-state changes (`intracity_start` /
  `intracity_complete` writing `arrivalTime` / `departureTime` /
  `travelingTo*`) land instantly. No polling timer.
- **Read path** (`useCityPlayers(cityId)`): selector over
  `useAccountStore`'s `otherPlayers` map, filtered by `currentCity
  === cityId` and self-excluded. Effect-side seed is a cold-start
  safety net: no-ops when `otherPlayers.size > 0` (boot already
  seeded). Returns `{ pubkey, account: PlayerCore }[]` reactively.
- **Marker interpolation**: each walker's `departureTime` /
  `arrivalTime` are **stable for the duration of the walk** — set
  once by `intracity_start`, cleared once by `intracity_complete`.
  Between those two WS events nothing else fires, so the parent
  interpolates `pct = ((chainNow - dep) / (arr - dep)) * 100` on
  every `chainNow` tick (1 Hz from `useChainNow`). That re-render
  cascades through `useMemo`'d `otherWalks` into the disc effect,
  which redraws the overlay. Smooth glide between WS pushes.

**The 3D port must consume the same source.** Don't reintroduce a
polled refetch for live data; don't push the WS subscription into
the scene component (it lives at the app boot level). The scene
just receives `travel` / `otherWalks` as props — exactly as today.
`useWorldPlayers` (the 30 s tanstack hook) is still wired to
`EntityPanel` for player-profile lookups when you click a dot, but
that's stale-tolerant by nature and not on this critical path.

### Downstream of entity selection (parent-owned, don't re-implement)

`onEntitySelect` is the seam — everything after it lives in
`map-tab.tsx` and reacts to the parent's `selectedEntity` state.
A future implementer porting to 3D should **not** move any of this
into the scene component. The flows that hang off a selected entity:

- **Scroll-panel swap to `<EntityPanel>`** (`map-tab.tsx:640-654`)
  renders rarity / level / health / defense / attacker count /
  despawn timer for encounters, or name / level / reputation /
  networth / locked NOVI / subscription tier / unit pubkeys for
  players. Plus distance, bearing label, and short pubkey
  (`pubkey.slice(0,4)…slice(-4)`).
- **Bottom action bar morphs** (`map-tab.tsx:545-566`) to:
  - **"Approach"** for encounters (`occupantType === 2`), **"Walk
    to"** for players. Both call `approachEntity` which fires
    `intracity_start` to `(entity.gridLat, entity.gridLong)` with the
    flavour text `"Closing in on the wild…"` / `"Walking to the
    soul…"`. Visible only when `isHomeDestination && !traveling`
    (intracity travel can't cross city boundaries). **Hidden when
    the selected entity is the local player themselves** (`isSelfEntity`
    check at `map-tab.tsx:548-557` — own-cell is a no-op so only `✕`
    remains). The button also carries `disabled: !hasStables` —
    travel infrastructure gates the action.
  - **`✕` dismiss** that clears `selectedEntity` and reverts the
    scroll panel + action bar.

All of this works automatically as long as the 3D scene fires
`onEntitySelect` with the same `CityTerrainEntity` shape on the same
events (click on occupied cell → `entity`, click on empty cell or
outside disc → `null`). The scene component never needs to know
about `EntityPanel`, `intracity_start`, the morph bar, or the
"Approach" / "Walk to" labels.

### Pan clamp (2D path — still circular)
The 2D viewport clamp keeps the **entire visible region** inside the
city disc, not just the centre:
```
max = radiusGridUnits − radiusGridUnits / scale
length(panOx, panOy) ≤ max
```
Otherwise the canvas's transparent outside-disc pixels show the
parchment background bleeding through the terrain.

The 3D path uses a **square AABB** clamp on the camera target — see
`## Square pan clamp` in the camera section. The two clamps are
intentionally different because the 3D view is square, not circular.

## Reference renderer (what we're porting)

From `terrain-builder/src/city/city.js:79-213`:

- `THREE.PlaneGeometry(4, 4, 511, 511)` — 512² vertex grid, Y-up by
  writing `setY(h)` and `setZ(-py)` instead of `rotateX`.
- Per-vertex elevation from `fn.elevation(config, ox, oy)` with edge
  fade band between `0.92·r` and `r` falling toward `waterLine - 30`.
- Per-vertex colour from `fn.elevColor(e, waterLine, peakLine,
  moisture)` → `BufferAttribute('color')`, shaded by
  `MeshLambertMaterial({ vertexColors: true })` after
  `computeVertexNormals()`.
- `OrbitControls` constrained: minPolar 5°, maxPolar 82°,
  minDistance ∝ km, maxDistance 9, `screenSpacePanning: false`. We
  port the polar bounds and distance scaling; we do NOT use
  `OrbitControls` itself — see `## Camera and movement`.
- Decoration: large ocean floor plane, circular `MeshPhongMaterial`
  water surface at `waterLine` height, thin boundary `RingGeometry`,
  anchor debug spheres, city name as `CSS2DObject`. The water surface
  and boundary become *square* in our port (`## Markers` and
  `## Mesh build`).
- HUD: bottom-left coord/alt (raycaster), bottom-right scale bar,
  top-right compass SVG.
- `scene.fog = FogExp2(0x08101e, 0.055)`.

Smoothing pattern comes from
`terrain-builder/src/town/camera/IsometricCamera.js:190-231` — the
`update(dt)` interpolation block lerps yaw/pitch/distance/target
toward desireds with `factor = 1 - exp(-smoothing * dt)`. Port that
on top of `city.js`'s polar bounds; see `## Camera and movement`.

## Stack decisions

- Web app has `three@0.184.0` + `@types/three@0.184.1` in
  `apps/web/package.json`; no R3F. Existing direct-three usage in
  `apps/web/src/components/shared/animations/{MagicRing,LaserFlow}.tsx`.
  **Match `MagicRing.tsx`'s setup pattern** — see below.
- All heightmap math is already exported from the TS SDK and is
  bit-identical to the on-chain Rust. Do **not** copy `noise` /
  `terrainHash` / `pressureEffect` into the web app.
- Keep `CityTerrainMap.tsx` as the orchestrator (props, occupancy
  fetch, status row, click contract, entity selection). Extract the
  WebGL scene into a sibling so the file stays under ~700 lines.

### Renderer setup — copy from `MagicRing.tsx` literally

This is the load-bearing template. Same try/catch, same WebGL2 gate,
same `setPixelRatio` → `setSize` ordering, same alpha mode:

```ts
let renderer: THREE.WebGLRenderer;
try {
  renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
} catch {
  onContextLost();   // show parchment "tap to retry" overlay
  return;
}
if (!renderer.capabilities.isWebGL2) {
  renderer.dispose();
  onContextLost();
  return;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // BEFORE setSize
renderer.setSize(w, h, false);                                // false: don't touch CSS
renderer.setClearColor(0x000000, 0);                          // transparent
mount.appendChild(renderer.domElement);
```

### Render policy: on-demand, not always-on

`MagicRing.tsx` uses an always-on rAF loop because it animates per
frame (rings move, hover smooths). The city terrain has none of that
in Phase 1 — no animated water, no fog shimmer, no rotating elements.
An always-on rAF drains battery for zero visual gain.

Use render-on-demand. Trigger `renderer.render(scene, camera)` only
on these events:
- Mesh built or rebuilt
- Marker positions updated (occupancy poll tick)
- Selection changed
- Hover changed (throttled — see below)
- Camera moved (pan/zoom/reset/resize)

Wrap as `requestRender()` that debounces multiple calls in the same
frame into one paint.

Phase 2 (water shimmer / animated fog) flips to an rAF loop. Don't
prematurely build that scaffolding.

### Props ref pattern from `MagicRing.tsx`

For the controller, keep `radiusGridUnits` and clamp constants in a
`propsRef` updated by a no-deps `useEffect` (per `MagicRing.tsx`'s
pattern of updating props in a render-phase effect). This lets gesture
handlers see latest props without re-binding `useEffect`s and tearing
down the scene on every prop change:

```ts
const propsRef = useRef<SceneProps | null>(null);
useEffect(() => { propsRef.current = props; });   // no deps — every render
```

Gesture handlers read `propsRef.current.radiusGridUnits` etc. Mount
effect (with empty deps) builds the scene once and uses `propsRef`
throughout.

## Color management — the actual answer

The reference `city.js` writes 0–255 sRGB values from
`elevationToColor` into a `BufferAttribute('color')` as `c / 255`.
With three.js 0.152+, color attributes are interpreted as **linear**
by default — `ColorManagement.enabled = true`,
`renderer.outputColorSpace = SRGBColorSpace`. This produces a
washed-out, too-bright terrain that does not visually match the 2D
`ImageData` path.

**Visual reference is the antique-map palette** in
`sdks/novus-mundus-ts/src/calculators/terrain.ts` —
`elevationToColor` was retuned to sit inside the realm-map vocabulary
(parchment cream, sepia ink, wax-seal orange): desaturated slate
water, dark-base-to-cream-cap peaks, muted olive lush lowland, warm
pale-sand beach. The 3D path's vertex colors must match this output
exactly. The linearization fix below is still the correct way to get
there — but the side-by-side comparison target is the antique palette,
not the previous saturated palette this section was written against.

Two viable fixes; pick (A):

**(A) Linearize at mesh-build time.** Add this helper to
`city3d/buildTerrainMesh.ts`:
```ts
// Inverse sRGB transfer (component-wise). c, return in [0, 1].
function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
```
Apply before writing into the color attribute:
```ts
const [cr, cg, cb] = elevationToColor(e, waterLine, peakLine, mo);
colors[i * 3]     = srgbToLinear(cr / 255);
colors[i * 3 + 1] = srgbToLinear(cg / 255);
colors[i * 3 + 2] = srgbToLinear(cb / 255);
```
Keep `MeshLambertMaterial({ vertexColors: true })`. Output color
space stays at the three.js default (`SRGBColorSpace`). The 3D path
will now visually match the 2D path.

**(B) Custom `ShaderMaterial`** mirroring `MagicRing`'s pattern.
Idiomatic for this codebase but you reimplement Lambert lighting
yourself. Not worth it for v1.

## Grid parity (load-bearing contract)

Every overlay marker, click hit, and hover readout must round-trip
through **exactly** the same `(ox, oy)` integer grid as the on-chain
program and the current 2D component. Get this wrong and a player
picks a cell two squares off from where they tapped, or an
encounter dot ends up sitting in water.

**The contract** (all in grid units, with
`ox = longitudeGrid - cityLongGrid`, `oy = latitudeGrid - cityLatGrid`):

- World-space mesh size in three.js units: `meshSize = 4` (matches
  the reference; arbitrary but pick once and never drift).
- World-XZ ↔ grid mapping, implemented once in a single helper used
  by mesh build, raycaster, markers, selection ring, and hover:
  ```ts
  const meshSize = 4;

  export function worldToGrid(wx: number, wz: number, rgu: number) {
    return {
      ox: Math.round((wx / (meshSize / 2)) * rgu),
      oy: Math.round((-wz / (meshSize / 2)) * rgu),  // -wz: north is +Y in grid
    };
  }

  export function gridToWorld(ox: number, oy: number, rgu: number) {
    return {
      wx: (ox / rgu) * (meshSize / 2),
      wz: -(oy / rgu) * (meshSize / 2),
    };
  }
  ```
- `rgu = radiusToGridUnits(cityAccount.radiusKm, cityAccount.latitude)`
  — already exported from the SDK, identical to the value
  `renderTerrainViewport` uses today.
- Mesh build samples elevation at the **same** `Math.round`'d
  `(ox, oy)` the click raycaster would produce for that vertex's
  world XZ. No floating-point sample positions, no off-by-one
  between build and pick.
- Y axis: vertex Y is `(elevation / 255) * maxH` where
  `maxH = meshSize * 0.08`. `getElevationAt(ox, oy)` (used for
  marker Y placement) returns the same expression — markers must sit
  on the *analytical* terrain, not on whatever the triangle-
  interpolated surface samples to at that pixel.
- **No edge fade in the 3D path.** The square mesh renders all
  vertices at their chain elevation; there is no radial
  `0.92·rgu → rgu` fade to `waterLine - 30`. The chain's circular
  gameplay disc is shown separately as an inscribed-circle overlay
  (see `## Inscribed gameplay disc` below), not as a fade in the
  mesh. The 2D path's radial fade is unchanged.

**Round-trip property to verify in dev:**
```
const v = gridToWorld(ox, oy, rgu);
const { ox: ox2, oy: oy2 } = worldToGrid(v.wx, v.wz, rgu);
console.assert(ox2 === ox && oy2 === oy);
```

Single source-of-truth module `city3d/coords.ts` exports
`worldToGrid` / `gridToWorld` / `getElevationAt`; the mesh builder,
raycaster, occupancy markers, selection ring, hover readout, **and
walk-line endpoints** all import from it. No duplicate
implementations.

**`WalkLine` convention**: the `fromGridLat/Long` and `toGridLat/Long`
on `WalkLine` are **full grid units** (the same form
`PlayerAccount.currentLat/Long` and `travelingToLat/Long` deserialize
to, via `toGrid(...)`), NOT offsets from the city centre. The 2D
overlay subtracts `cityLat/LongGrid` internally before calling
`gridToDevPx`; the 3D scene must subtract before calling `gridToWorld`
to land the line endpoints in mesh-local space. Keeping the prop in
absolute grid units lets the parent's call site mirror the chain
fields literally (`toGrid(player.currentLat)` etc.) without an extra
subtraction step per walker.

**Verification across renderers**: in dev, log `(ox, oy)` produced by
the 3D raycaster and assert it equals the value `pxToGrid` would
produce for the same screen coordinates. The 2D code path can stay
in git history; verification runs for one PR by toggling between
implementations and confirming they pick the same cell.

## Target structure

```
apps/web/src/components/world/
├── CityTerrainMap.tsx                (THIN orchestrator: capability
│                                       check at mount, owns
│                                       occupancy/walks props, status
│                                       row + toggle pill, click
│                                       contract branching, entity
│                                       selection. Mounts the WebGL
│                                       renderer by default; mounts
│                                       the Canvas2D fallback only if
│                                       WebGL2 init fails.)
├── CityTerrainMap.module.css         (existing shell; add `.canvas3d`,
│                                       `.toggle3DPill`,
│                                       `.orbitTogglePill`)
├── CityTerrainMap2DFallback.tsx      (renamed from today's
│                                       CityTerrainMap.tsx — the
│                                       Canvas2D viewport renderer.
│                                       Mounted ONLY when WebGL2 is
│                                       unavailable. Does not animate;
│                                       does not implement 3D mode.
│                                       Toggle pill is hidden when
│                                       this is the active renderer.)
└── city3d/
    ├── CityTerrainMapWebGL.tsx       (the three.js scene; renders
    │                                   both 2D and 3D modes via
    │                                   camera + mesh.scale.y state.
    │                                   Owns the mode-transition tween.
    │                                   Props-only API, no imperative
    │                                   handle in v1.)
    ├── coords.ts                     (worldToGrid / gridToWorld /
    │                                   getElevationAt + srgbToLinear +
    │                                   cssPxPerCellAt)
    ├── buildTerrainMesh.ts           (square PlaneGeometry build from
    │                                   CityTerrain; uses coords.ts)
    ├── markers.ts                    (InstancedMesh layers:
    │                                   player/encounter dots & tiles,
    │                                   centre, selection, square
    │                                   boundary, inscribed disc)
    ├── controls.ts                   (perspective camera controller:
    │                                   yaw/pitch/distance/target with
    │                                   smoothing; mirrors
    │                                   IsometricCamera.js + orbit;
    │                                   exposes isTransitioning bypass)
    └── transition.ts                 (mode-transition tween driver —
                                        the rAF loop described in
                                        `## Mode transition`)
```

**Shared prop surface (contract)**: `CityTerrainMap2DFallback` and
`CityTerrainMapWebGL` MUST consume the same `Props` interface,
exported from `CityTerrainMap.tsx`. The orchestrator passes through
identically; the only difference between mounting one vs the other
is the renderer backend. Future feature work on either path must
update both consumers and the shared interface in the same PR to
prevent drift.

The orchestrator's capability check runs at mount: try to create a
WebGL2 context; on success, mount `CityTerrainMapWebGL`; on failure,
mount `CityTerrainMap2DFallback` and hide the toggle pill. The
`useSettings.mapMode` value is read by `CityTerrainMapWebGL` to pick
its initial camera state and to wire the toggle pill's tween. The
fallback ignores `mapMode` (it only renders 2D, no transitions).

**Steady-state layout**:
- WebGL-capable users (~100% of target audience): see
  `CityTerrainMapWebGL`, can toggle between 2D and 3D modes with the
  Google-Maps tilt animation. Default landing is 2D mode.
- WebGL-unavailable users: see `CityTerrainMap2DFallback`, no toggle
  pill, no 3D access. Functionally complete, just no tilt.

## Scene API — props, no imperative handle in v1

Rev 1 proposed an imperative-handle API that mixed "scene reacts to
events" with "parent pushes state into scene". Flip the direction:
parent-driven state goes through props, scene-driven events go
through callbacks.

```ts
export interface CityTerrainSceneProps {
  terrain: CityTerrain;
  radiusGridUnits: number;
  meshSize?: number;                      // default 4

  // State (parent → scene; scene reacts via useEffect diffs)
  selected: { gridLat: number; gridLong: number } | null;
  selectedEntity: CityTerrainEntity | null;
  occupied: OccupiedCell[];               // must include `occupant: string`
  cityLatGrid: number;
  cityLongGrid: number;
  // In-flight intracity walks — `travel` is the local player's bright
  // walk; `otherWalks` is the muted set of every other walker in this
  // city. Both use the load-bearing `WalkLine` shape (see "Inputs /
  // affordances"). Source of truth is zustand + WebSocket, NOT polling.
  travel?: WalkLine | null;
  otherWalks?: WalkLine[];

  // Events (scene → parent). `onPick` hands the *raw* hit back; the
  // orchestrator implements the entity-vs-landing branching from the
  // "Click semantics" rules above — keeping that logic in
  // CityTerrainMap.tsx instead of the scene means the read-only
  // home-city flow doesn't even need a different scene component.
  onPick: (info: {
    gridLat: number;
    gridLong: number;
    passable: boolean;
    /* True when the cell is on the square mesh but outside the chain's
     * circular gameplay disc (rgu). Orchestrator surfaces "Outside
     * city bounds" and skips onSelect. Always false in the 2D path. */
    outOfBounds: boolean;
    entityAtCell: CityTerrainEntity | null;  // null = empty cell
  }) => void;
  onHover: (info: HoverInfo | null) => void;
  onContextLost: () => void;
  onContextRestored: () => void;
}
```

Inside the scene, separate `useEffect`s diff specific props:
- `terrain` / `radiusGridUnits` changes → rebuild geometry.
- `occupied` changes → update instance matrices in place
  (`InstancedMesh.instanceMatrix.needsUpdate = true`), no rebuild.
- `selected` / `selectedEntity` changes → update ring position and
  per-instance color override, no rebuild.
- `travel` / `otherWalks` change → update line geometry endpoints
  and marker `position` in the walk-lines layer; the parent already
  re-supplies `pct` each `chainNow` tick, so the marker glides via
  prop-driven re-render rather than a per-scene rAF loop.

If profiling later shows React re-renders are a problem, *then* add
`useImperativeHandle` for `setSelected` / `setMarkers` / `setWalks`.
Premature otherwise.

## Camera and movement

**Camera state — spherical, smoothed**

State is `(yaw, pitch, distance, target)` plus smoothed mirrors that
lerp toward those desireds every frame. Camera *position* is derived,
never directly set:

```ts
const cosPitch = Math.cos(sPitch);
const sinPitch = Math.sin(sPitch);
const cosYaw   = Math.cos(sYaw);
const sinYaw   = Math.sin(sYaw);
camera.position.set(
  sTarget.x + sDistance * sinYaw * cosPitch,
  sTarget.y + sDistance * sinPitch,
  sTarget.z + sDistance * cosYaw * cosPitch,
);
camera.lookAt(sTarget);
```

That block is `IsometricCamera.js:217-231` — port it. Smoothing is
exponential `factor = 1 - exp(-smoothing * dt)`, `smoothing = 8.0`.

**Defaults and bounds** (cf. `IsometricCamera.js` + `city.js:275-283`):
- **Initial state depends on `useSettings.mapMode`** (read once at
  mount):
  - `mapMode === "2d"` (default): `yaw=0`, `pitch=0°`, `distance=4.5`,
    `target=(0, 0, 0)`, `mesh.scale.y=0`.
  - `mapMode === "3d"`: `yaw=0`, `pitch=35° DEG`, `distance=4.5`,
    `target=(0, midpointElevation, 0)`, `mesh.scale.y=1`.
- Yaw: free, no wrap clamp (both modes).
- Pitch bounds: 2D mode locks pitch at `0°` (orbit handler suppresses
  pitch deltas, only yaw). 3D mode clamps pitch `[5°, 82°]`
  (`city.js:277`). Mode-transition tween crosses this band freely.
- Distance: `minDistance = 20 / radiusKm`, `maxDistance = dMin × 200`
  so the displayed zoom ratio matches the 2D file's `[1, 200]` range.
  Status row still shows `1×–200×` as `dMax / distance`. Same in both
  modes.
- Target.y: pinned per mode (0 in 2D, `midpointElevation` in 3D —
  the tween lerps between them so zoom-in always dives toward the
  ground rather than above it).
- `target.x/z`: clamped per `## Square pan clamp` below (same in
  both modes).

**Zoom — distance + momentum**

```ts
// onWheel:
zoomVelocity += deltaY > 0 ? +ZOOM_SPEED : -ZOOM_SPEED;

// In update(dt):
if (abs(zoomVelocity) > 0.0001) {
  distance = clamp(distance + zoomVelocity, dMin, dMax);
  zoomVelocity *= ZOOM_MOMENTUM;            // 0.88, IsometricCamera.js:31
} else {
  zoomVelocity = 0;
}
```

**Zoom-to-cursor** is still a dual raycast (pre and post), but the
delta is applied to `target` (which drives the smoothed camera
position), not directly to `camera.position`:
```ts
function zoomAt(clientX, clientY, deltaSteps) {
  const before = raycastTerrain(clientX, clientY);
  zoomVelocity += deltaSteps * ZOOM_SPEED;
  // ... distance updates next frame; re-raycast post-update and
  //     correct the target by (before - after) on XZ.
}
```

Equivalent to the previous ortho `zoomAt`, but the correction lands
on the spherical target rather than `camera.position`.

**Pan — camera-relative on the ground plane**

The ortho `cos(PITCH)` trick goes away. Use `IsometricCamera.js:288-297`
verbatim: derive right + forward vectors from `(target - camera)`
projected to XZ, scale by `panSpeed * distance`:
```ts
const camDir = tmp.copy(sTarget).sub(camera.position);
right  .set(-camDir.z, 0, camDir.x).normalize();
forward.set( camDir.x, 0, camDir.z).normalize();
const k = PAN_SPEED * sDistance;
target.addScaledVector(right,  -pixelDx * k);
target.addScaledVector(forward, pixelDy * k);
target.y = midpointElevation;
clampTarget();
```
`PAN_SPEED ≈ 0.001` (`IsometricCamera.js:32`). Scaling by distance
gives consistent feel at every zoom level.

**Orbit — yaw + pitch from drag**

New input, doesn't exist in either the Canvas2D path or
`IsometricCamera` (town camera lets you pan but not orbit). Bind
right-drag (mouse) and the orbit-toggle pill (touch — see Gestures
below):
```ts
yaw += -pixelDx * ORBIT_SPEED;          // always allowed
if (mapMode === "3d") {
  pitch += -pixelDy * ORBIT_SPEED;
  pitch  = clamp(pitch, MIN_POLAR, MAX_POLAR);   // 5°, 82°
}
// In 2D mode: pitch delta ignored, only yaw rotates.
```
`ORBIT_SPEED ≈ 0.005` rad/px. Yaw is unconstrained in both modes
(spinning a top-down map compass-style is meaningful and meets the
"move around nicely" bar). Pitch is locked in 2D mode and clamped
in 3D mode. Smoothing carries through automatically — yaw/pitch
lerp toward desired in `update(dt)`. Orbit handler is suppressed
entirely while a mode transition is in flight (see `## Mode
transition`).

## Square pan clamp

Replaces the disc clamp. Keep the entire visible region inside the
square mesh footprint at every camera position:
```ts
const halfSide = meshSize / 2;
// Visible half-extent on the ground at current camera distance/fov:
const visibleHalf = sDistance * Math.tan(fov / 2);     // worst case
const maxOffset   = Math.max(0, halfSide - visibleHalf);
target.x = clamp(target.x, -maxOffset, maxOffset);
target.z = clamp(target.z, -maxOffset, maxOffset);
```
Apply the clamp to *both* the desired `target` AND the smoothed
`sTarget` so the visible camera never overshoots the bound
(`IsometricCamera.js:202-215` does both).

The **2D disc** clamp at `apps/web/src/components/world/CityTerrainMap.tsx`
is unchanged — that path is keeping its circular viewport.

## Resize

```ts
camera.aspect = w / h;
camera.updateProjectionMatrix();
renderer.setSize(w, h, false);
requestRender();
```
`ResizeObserver` + `window.addEventListener('resize')` belt-and-
suspenders, matching `MagicRing.tsx`. No frustum math — perspective
is aspect-driven.

## Gestures

| | Mouse | Touch |
|---|---|---|
| **Pan** | Left-drag (4 px threshold) | One-finger drag (6 px threshold) |
| **Zoom** | Wheel · ctrl+wheel ×0.35 (trackpad pinch) | Two-finger pinch |
| **Orbit (yaw always; pitch in 3D only)** | Right-drag | Two-finger drag *while* orbit toggle on |
| **Zoom in 2×** at cursor | Double-click (tweened) | Double-tap (tweened) |
| **Reset view** | `.resetBtn` pill (tweened) | `.resetBtn` pill (tweened) |
| **Toggle 2D ↔ 3D** | `.toggle3DPill` | `.toggle3DPill` |
| **Orbit toggle** | — | Pill button next to the reset pill |

Rationale on the touch orbit toggle: with three gesture meanings
(pan, zoom, orbit) and only two finger-counts, something has to
multiplex. A discoverable toggle pill (default OFF — pan is the
intuitive default) beats overloading two-finger drag with both zoom
and orbit by axis. Mouse users get right-drag for free.

**Reset view** restores the active mode's defaults:
- In 2D: `yaw=0°, pitch=0°, distance=4.5, target=(0, 0, 0)`,
  `mesh.scale.y=0`.
- In 3D: `yaw=0°, pitch=35°, distance=4.5,
  target=(0, midpointElevation, 0)`, `mesh.scale.y=1`.

`zoomVelocity` is zeroed (`IsometricCamera.js:148`). Reset never
crosses modes — pressing reset in 2D doesn't pop you into 3D.

**Drag-vs-click suppression** preserved via `suppressClickRef` — same
contract as the 2D path.

**350 ms touch click-suppression after pinch** — not optional;
phantom click selection on iOS otherwise.

**Keyboard** (optional, recommend shipping in Phase 1 since
"move around nicely" is a stated requirement):
- `WASD` / arrows: pan the target on the ground plane (~`0.3 *
  distance` units/sec).
- `Q`/`E`: yaw ±.
- `R`/`F`: pitch ± within polar bounds.
- `+`/`-`: zoom.
- Space: reset view.

If keyboard slips to Phase 2, drop the keymap rows but keep the
`role="application"` aria-label documenting available gestures.

**`touch-action: none`** on the canvas wrap. (Already on the current
wrap; carry it onto the new one or one-finger drag will steal page
scroll.)

**Why not OrbitControls** — built around free polar rotation and
doesn't smooth or carry zoom momentum. Write the controller in
`city3d/controls.ts` porting `IsometricCamera.js`'s `update(dt)` +
event handlers, with orbit added on top.

## Click semantics under square view

The Canvas2D fallback's click contract from `## Current state → Click
semantics with entity selection` ports almost verbatim to the WebGL
scene. Two deltas: "outside disc" and tween suppression.

- **Click while a mode-transition tween is in flight** → ignored. No
  `onPick`, no `onEntitySelect`. The tween locks input for ~700 ms
  to prevent the user racing the camera. The toggle pill is also
  disabled during this window. See `## Mode transition`.
- **Click outside the square mesh** (raycast misses entirely) →
  `onEntitySelect(null)` and return. (Was: outside disc.)
- **Click on an occupied cell** → `onEntitySelect({pubkey, occupantType,
  gridLat, gridLong})` and return. **`onSelect` is never called for
  occupied cells.** Same as fallback.
- **Click on empty cell, inside the inscribed gameplay disc** →
  `onEntitySelect(null)`, then `onSelect(gridLat, gridLong)` if wired
  AND the cell is passable. Same as fallback.
- **Click on empty cell, *outside* the inscribed disc but still on the
  square mesh** → `onEntitySelect(null)`, then `onPick` reports
  `{...passable: false, outOfBounds: true}` (extend the existing
  `onPick` payload with `outOfBounds`). The orchestrator surfaces a
  one-line "Outside city bounds" notice next to the action bar; no
  `onSelect` fires. This is the gameplay-vs-rendering wedge: the user
  sees a corner of square terrain but can't land there because the
  chain bounds-check rejects it.
- **Click on empty impassable cell, inside the disc** →
  `onEntitySelect(null)` only; no `onSelect`. Same as fallback.

The orchestrator (`CityTerrainMap.tsx`) implements this branching —
the scene component just hands raw hits up via `onPick`, including the
new `outOfBounds: boolean` field. The same orchestrator branches on
2D vs 3D mode and applies the same rules (the 2D file's
"outside disc → null" rule is just the special case of `outOfBounds`
in 2D, where the canvas itself has no out-of-disc clickable region).

## Mesh resolution

`res = 256` for `PlaneGeometry(meshSize, meshSize, res - 1, res - 1)`
in Phase 1. ~65 k vertices, ~1.5 MB GPU buffers, well under the iOS
budget.

- At zoom 1 this is way more vertices than needed.
- At zoom 200 this is ~1 vertex per 2 cells — slightly under-sampled,
  but acceptable because the proximity-grid overlay and tile-rendered
  occupants provide cell structure visually.

Phase 2 (optional): dynamic LOD that rebuilds geometry when zoom
crosses thresholds (1×–4× → 128; 4×–32× → 256; 32×–200× → 512 over
a viewport-cropped extent). Defer until Phase 1 ships and someone
complains.

## Mesh build

Build per the reference, with these corrections:

- **Use `flatShading = true`** on `MeshLambertMaterial`. With
  cell-aligned `Math.round` sampling, adjacent vertices in the same
  cell get identical Y → `computeVertexNormals` averages plateau
  normals with ramp-face normals and produces smeared shading. Flat
  shading is what makes the cell-grid structure readable.
- **Linearize vertex colors** (see "Color management" above).
- **Polygon offset on the terrain material**:
  ```ts
  material.polygonOffset = true;
  material.polygonOffsetFactor = 1;
  material.polygonOffsetUnits = 1;
  ```
  Selection ring, boundary ring, water surface, and proximity-grid
  plane (Phase 2) all sit at or near the terrain Y — without polygon
  offset they z-fight.
- **Anchor count = 0 short-circuit**: build a flat square at elevation
  128, skip the elevation lookup loop, square boundary + "terrain
  unset" status still render. Matches the Canvas2D fallback's
  short-circuit but on the square mesh.
- **Build once with full Y**. The mesh is built with `(elevation /
  255) * maxH` written into vertex Y exactly as the reference
  `city.js:126-128` does. The 2D mode does NOT re-build the mesh
  with flat Y — instead, set `terrainMesh.scale.y = 0` and the same
  vertices appear flat at the plate. This is the load-bearing trick
  for the mode-transition tween: `scale.y` lerps from 0 → 1 over
  ~700 ms and mountains rise out of the plate without a rebuild.
  See `## Mode transition`. (Reference: `city.js:374`'s
  `_heightScale` setter exposes the same hook for the debug slider.)

## Lights

Not in Rev 1. `MeshLambertMaterial` is unlit without them.

```ts
scene.add(new THREE.AmbientLight(0xffffff, 0.45));
const sun = new THREE.DirectionalLight(0xffffff, 0.95);
sun.position.set(meshSize * 0.6, meshSize * 1.2, meshSize * 0.4); // NE + above
scene.add(sun);
```

No shadow maps — cost outweighs benefit at this scale, and Lambert
shading already reads elevation clearly.

## Markers

Rev 1 used a "slightly larger sphere" as outline, which produces
occlusion not outline. Replaced with flat ring + filled disc,
matching how the 2D path already draws everything. This also avoids
the billboard-vs-not problem entirely.

Two render modes, mirroring the 2D path. Threshold is the same
`GRID_OVERLAY_MIN_CSS_PX_PER_CELL` (currently `8` CSS px per grid
cell) used by the proximity grid — not `4`.

**`cssPxPerCell` under perspective**: cells project to different
screen sizes depending on depth, so define `cssPxPerCell` as the
projected size of one cell **at the camera target** (the centre of
attention) — a single representative number. Helper in
`city3d/coords.ts`:

```ts
export function cssPxPerCellAt(
  camera: THREE.PerspectiveCamera,
  target: THREE.Vector3,
  rgu: number,
  meshSize: number,
  canvasHeightPx: number,
): number {
  // World-XZ size of one cell:
  const cellWorld = meshSize / rgu;
  // Vertical world-extent that fills the canvas at this distance:
  const distance = camera.position.distanceTo(target);
  const visibleWorldH = 2 * distance * Math.tan((camera.fov * Math.PI / 180) / 2);
  return (cellWorld / visibleWorldH) * canvasHeightPx;
}
```

Recompute every camera change (zoom, pan, orbit) and gate every
dual-mode marker on the same expression so the transition is atomic
across all of them. Status row `· cells visible` indicator reads
the same number.

**Palette (must match the Canvas2D fallback, antique-map tuned)**:
- `PLAYER_FILL = rgba(160, 100, 45, 1)` — tobacco amber.
- `WILD_FILL = rgba(115, 55, 30, 1)` — oxblood.
- `SELECTED_STROKE = rgba(220, 175, 60, 1)` — selection highlight.
- `CREAM_STROKE = rgba(252, 244, 220, 0.95)` — outline + halo.

### Low-zoom dot mode (`cssPxPerCell < GRID_OVERLAY_MIN_CSS_PX_PER_CELL`)

**Shape distinguishes occupant type** — same contract as the
Canvas2D fallback. Different `InstancedMesh` per layer (no
multi-shape instance trickery).

- **Player** = `CircleGeometry(rDot, 24)` filled `PLAYER_FILL`,
  plus a concentric `RingGeometry(rDot, rDot * 1.18, 24)` filled
  `CREAM_STROKE`. Both lie flat on the terrain at `getElevationAt(ox,
  oy) + maxH * 0.005`. `InstancedMesh` per layer, `frustumCulled =
  false` (or fat bounding sphere) so distant instances don't get
  culled.
- **Wild** = `ShapeGeometry` of a 4-vertex diamond (rotated square)
  filled `WILD_FILL`, with the same concentric `RingGeometry` cream
  outline pattern. **No inner danger ring** — the diamond shape
  itself signals "danger" at this scale, same as the Canvas2D
  fallback.
- **Selected entity** stroke override → `SELECTED_STROKE`
  applied per-instance via `setColorAt`, `lineWidth` bumped by 1 (in
  3D this becomes a slightly thicker outline ring on the same
  instance).
- **Selection ring** (landing-cell picker) = `RingGeometry(rDot * 1.4,
  rDot * 1.7, 64)` orange ink + `+` crosshair strips.

### High-zoom tile mode (`cssPxPerCell ≥ GRID_OVERLAY_MIN_CSS_PX_PER_CELL`)
- Same shape-distinguished layers collapse to a single tile shape
  per cell: `PlaneGeometry(cellSize, cellSize)` where `cellSize =
  (1 / rgu) * meshSize`, filled with `PLAYER_FILL` or `WILD_FILL`
  depending on occupant type. The outline ring layer swaps to 4
  thin border strips (or a `RingGeometry`-shaped square frame —
  picker's call). Snap world position to grid centres so the tile
  rect aligns with the underlying flat-shaded mesh cell.
- **Selection ring** swaps to a tile-rect outline (`PlaneGeometry`
  with stroke-only material or 4 strips) at the selected cell — same
  pattern as the Canvas2D fallback's `if (renderAsTiles)` branch.

Switch is driven by `cssPxPerCell` crossing the threshold; instance
visibility toggles, no rebuild.

### Other markers
- **Centre marker — antique cartographer's town glyph**, mirroring
  the Canvas2D fallback. 8-rayed star (4 cardinal + 4 diagonal,
  diagonals at `r * 0.65`) drawn as a `BufferGeometry` of line
  segments, stroke `rgba(70, 50, 28, 0.85)`. Inked nucleus
  (`CircleGeometry`) fill `rgba(70, 50, 28, 0.95)`. Cream halo
  (`RingGeometry` slightly larger than the nucleus) fill
  `rgba(252, 244, 220, 0.95)`. All non-instanced, all at
  `(0, getElevationAt(0, 0) + bias, 0)`. **Radius scales with zoom**
  per the Canvas2D fallback: `rWorld = max(rDotMin, min(0.55 *
  cellWorld, rDotMax))` where `cellWorld = meshSize / rgu`, and
  `nucleusR = max(2 * scale, rWorld * 0.3)` — so the glyph stays
  anchored to its cell at every zoom level.
- **Selection ring** dimensions per the dual-mode section above.
- **City boundary frame (square)** = four `LineSegments` along the
  edges of the `meshSize × meshSize` plane, faint sepia
  `rgba(46, 31, 16, 0.55)`, flat at midpoint elevation. (Use
  `EdgesGeometry(new PlaneGeometry(meshSize, meshSize))` rotated to
  XZ — single draw call, single material, easy to dispose.) Visible
  at every camera position; the frame is the visual "you are looking
  at one city" cue. Replaces the 2D path's `RingGeometry` boundary.
- **Inscribed gameplay disc** = thin dashed `LineLoop` at radius
  `meshSize/2` (the inscribed circle of the square mesh). Faint
  sepia `rgba(46, 31, 16, 0.35)`, dash matched to the Canvas2D
  fallback's `[3, 3]*dpr` pattern (use `LineDashedMaterial` with
  comparable world-units dashes), flat at midpoint elevation, label
  "city limits" via tooltip on hover. Mirrors the Canvas2D
  fallback's dashed boundary line one-for-one. Picks outside this
  ring surface a "Outside city bounds" notice in the action bar.
  See `## Click semantics under square view` below.
- **Proximity grid (Phase 1, load-bearing at high zoom)**: a
  `LineSegments` net at midpoint elevation, rebuilt on zoom/pan when
  `cssPxPerCell ≥ GRID_OVERLAY_MIN_CSS_PX_PER_CELL`. Stride is the
  doubling decimation from the "Overlay layer" section, **not** a
  linear step. Without this, high-zoom mode is a checkerboard of
  colored tiles on continuous shading with no scale reference — the
  whole "cells visible" UX premise depends on these lines.
- **Anchor markers** — debug-only behind
  `useFeatureGate('debugTerrain')`, ported from `city.js:181-197`.

### Walk lines (intracity travel, local + others)

In-flight intracity walks render as flat dashed segments on the
terrain surface with a small disc-marker that interpolates between
the two endpoints. Mirrors the 2D path 1:1 — same palette, same
opacity tiers, same z-stack — but uses three.js primitives.

**Per walk** (one entry from `travel` or `otherWalks`):
- **Line geometry** = `THREE.Line` with `LineDashedMaterial` (or a
  shader-based dashed line if the 0.184 build still has the
  `computeLineDistances` quirk), endpoints at
  `gridToWorld(from)` and `gridToWorld(to)`, Y = `getElevationAt(
  midpointGrid) + maxH * 0.005` so it floats just above the terrain
  to avoid z-fighting and follows the elevation roughly. (Linear
  interpolation across the midpoint is fine — walks are short
  enough that the line skimming the surface reads correctly without
  per-vertex elevation sampling.)
- **Marker** = small `CircleGeometry` (or `SphereGeometry` if a
  3D dot reads better at the camera tilt) translated to
  `gridToWorld(lerp(from, to, pct/100))` with Y =
  `getElevationAt(...)+ bias`. The parent re-supplies `pct` each
  `chainNow` tick (1 Hz) so the marker advances via prop-driven
  re-render — no per-scene rAF.

**Style tiers** (palette matches the 2D path verbatim):

| | Line | Marker | Halo |
|---|---|---|---|
| **`travel`** (own) | `rgba(180,83,9,0.85)` · stroke `2/dpr` · dash `[6,4]` · `linecap: round` | `r = 4.5/dpr` orange fill + cream stroke | Yes, `r = 9/dpr`, opacity `0.25` |
| **`otherWalks`** (others) | `rgba(180,83,9,0.4)` · stroke `1.5/dpr` · dash `[4,4]` | `r = 3/dpr` orange fill `0.85` + thin cream stroke | No |

Stroke widths in the 3D port should use `vector-effect`-equivalent
non-scaling math — pin to screen px regardless of camera zoom, the
same way `vectorEffect="non-scaling-stroke"` is used on the
realm-map intercity line.

**`InstancedMesh` for `otherWalks`** is a Phase-2 optimisation. v1
can build one `Line` + `Mesh` per other-walker — at 5–20 active
walkers in a typical city, the draw-call overhead is negligible
and instance setup is more complexity than warranted. Pre-allocate
a pool and reuse when the next render fires.

**Re-bind cadence**: when `occupied` changes (every poll tick),
update the instance matrices in place — no geometry rebuild, no React
re-render of the canvas. Selection changes similarly.
`travel` / `otherWalks` change *each chainNow tick* (because `pct`
moves) — update the marker position attributes in place and call
`needsUpdate = true`; do NOT rebuild the line geometry unless
endpoints actually change (start/complete events).

**`renderOrder`**: terrain (default 0) → boundary ring (1) →
**other-walks line (1.2) → other-walks marker (1.3) → own-walk
line (1.5) → own-walk marker (1.6)** → centre marker (2) →
occupants (3) → selection ring (4). Combined with polygon offset
on terrain, this stacks cleanly with no z-fighting. Walks under
occupants is deliberate — a dot for a player sitting at the
endpoint should still be the topmost cue at that cell.

**Pre-allocate `InstancedMesh`** with `count = MAX_INSTANCES = 512`
and call `mesh.count = actual` per update; no resize/realloc.

## Hover / readout

- Hover throttled to ~30 Hz (drop `pointermove` events more frequent
  than every 33 ms). Raycasting per `pointermove` melts mid-range
  laptops without this.
- Hover readout (`Water | Shore | Land | Hill | Peak`, metres,
  `impassable`) → same React DOM nodes the current file uses, fed
  via `onHover` callback. Bucket thresholds per the Canvas2D
  fallback: `t < 0.1 → Shore`, `t < 0.5 → Land`, `t ≥ 0.5 → Hill`.
  Do not recreate the reference's `_hudEl` DOM manipulation — that
  pattern doesn't fit React.

## Cleanup (mandatory, modelled on `MagicRing.tsx`)

```ts
return () => {
  cancelAnimationFrame(frameId);                 // if any rAF pending
  el.removeEventListener('wheel', onWheel);
  // ... all listeners, including window-level mousemove/mouseup
  ro.disconnect();
  renderer.domElement.parentNode?.removeChild(renderer.domElement);
  scene.traverse(o => {
    const mesh = o as THREE.Mesh;
    mesh.geometry?.dispose();
    const m = mesh.material;
    if (Array.isArray(m)) m.forEach(x => x.dispose());
    else m?.dispose();
  });
  renderer.dispose();
};
```

Order matters: cancel pending frames first, then unbind events, then
remove DOM, then dispose GPU resources.

## Phase 1 — 3D mode shipped behind a toggle, with full parity

Goal: 2D path stays default and untouched. 3D path ships in a new
`city3d/` directory with full feature parity vs. the 2D viewport,
selected by a `useSettings.mapMode` toggle pill in the status row.

- **Orchestrator**: extract `CityTerrainMap2D.tsx` (current
  implementation, renamed). New `CityTerrainMap.tsx` reads
  `useSettings(s => s.mapMode)` and mounts either `CityTerrainMap2D`
  or `CityTerrainMap3D`, passing the same prop set. Toggle pill +
  3D-disabled fallback flag live in the orchestrator.
- **Mesh build** per "Mesh build" + "Color management" — square
  geometry, no radial fade, square boundary frame, dashed inscribed
  gameplay-disc overlay.
- **Camera**: perspective + `(yaw, pitch, distance, target)` smoothed
  via the `IsometricCamera` lerp pattern. Polar bounds 5°–82°.
  Defaults `yaw=0, pitch=35°, distance=4.5`. Distance mapped to
  display zoom 1×–200×. Pan clamp is the square AABB (`## Square pan
  clamp`).
- **Gestures** per the gestures table: pan, zoom, orbit (right-drag /
  touch-orbit-toggle), reset, drag-vs-click suppression, 350 ms iOS
  pinch suppression, `touch-action: none`. Keyboard shortcuts
  optional for v1.
- **Markers** per "Markers" — both low-zoom dot mode and high-zoom
  tile mode (gated on `cssPxPerCellAt(camera, target, …)`), the
  entity-selection yellow override, the zoom-scaled centre marker,
  the dual-mode selection ring, the proximity grid lines, **and the
  in-flight walk lines for the local player (`travel`) plus every
  other intracity walker in the city (`otherWalks`)**.
- **Walk-data source** must be `useCityPlayers(cityId)`
  (zustand-backed, live via the program-wide WS) — NOT
  `useWorldPlayers` (the 30 s tanstack-query polling path). See
  "Live other-players state" for the full data flow. The 3D scene
  consumes the same shapes via the same props the 2D file already
  receives.
- **Occupancy source** is `useCityOccupied(cityId)` from
  `apps/web/src/lib/hooks/useCityOccupied.ts` — both modes read it.
  No GPA polling.
- **Click + hover** use `THREE.Raycaster` against the terrain mesh →
  `worldToGrid(point.x, point.z, rgu)` → entity lookup against
  `occupied`, then `onPick({gridLat, gridLong, passable, outOfBounds,
  entityAtCell})`. Orchestrator implements the entity-vs-landing-vs-
  out-of-bounds branching from `## Click semantics under square view`;
  the scene just hands raw hits up.
- **Renderer setup** mirrors `MagicRing.tsx` (try/catch, WebGL2 gate,
  `setPixelRatio` before `setSize`, transparent clear). On WebGL2-
  unavailable or context-creation throw, orchestrator flips fallback
  flag to 2D and disables the toggle pill.
- **Re-uses** the existing `.canvasWrap` shell, status row (incl.
  zoom multiplier + `· cells visible` indicator), hover readout
  `aria-live`, legend, reset button. Status row gains the 2D/3D
  toggle pill and (touch only) the orbit-toggle pill.

## Phase 2 — polish (optional, can land later)

- `MeshPhongMaterial` circular water surface at
  `(waterLine/255) * maxH + maxH * 0.004`, opacity 0.5, specular
  highlight — matches `city.js:158-168`.
- `CSS2DRenderer` city name label above peak (mirror of
  `city.js:200`), driven by the existing parchment typography vars
  (`--ink`, `--ink-soft`, `--seal`).
- Scale bar + compass overlay — port `updateScaleBar` /
  `updateCompass` from `city.js:431-465` as DOM siblings inside
  `.canvasWrap`. **Use ortho frustum width** for the scale bar, not
  perspective `fov`:
  ```ts
  const visibleWorldW = (camera.right - camera.left) / camera.zoom;
  const visibleM = visibleWorldW * worldToM;
  ```
  Compass is a static SVG while yaw is locked at 0°. Hide both on the
  embedded scroll-panel layout (≤ 360 CSS px); show only in the
  full-sheet override.
- Height-scale slider (`scene.scale.y`) — debug-only, behind a query
  param or `useFeatureGate('debugTerrain')`.
- Subtle `FogExp2` tuned to parchment palette (e.g.
  `0x6b4a2a` `0.04`) so distant mountains haze toward the ink color
  instead of the reference dark navy.
- Dynamic LOD per "Mesh resolution".
- Animated water → flip to always-on rAF loop at this point.

## Decisions deferred

- **Web Worker offload.** Skip. Mesh build at 256² × ~8 anchors is
  well under the existing main-thread budget. Revisit if a city ships
  with > 32 anchors.
- **`OffscreenCanvas`.** Skip. Same reasoning.
- **R3F migration.** Out of scope. Direct three works for the two
  existing components and works for this one.
- **Imperative scene API.** v1 uses props + callbacks only. Revisit
  if React re-renders show up in profiling.

## Risks and mitigations

- **WebGL context loss or no context at all** — wire
  `webglcontextlost` / `restored` plus the `MagicRing.tsx` try/catch
  + WebGL2 gate at construction. On any of these, the orchestrator
  unmounts `CityTerrainMapWebGL` and mounts the
  `CityTerrainMap2DFallback` (Canvas2D path). The 2D ↔ 3D toggle
  pill is hidden in the fallback state (the fallback can't tilt).
  A one-line `aria-live` notice shows once ("3D rendering
  unavailable — using 2D mode"). The user's saved
  `useSettings.mapMode` is preserved — if they had 3D selected, they
  get the tilt back as soon as WebGL becomes available again. On
  `webglcontextrestored`, the orchestrator unmounts the fallback
  and remounts `CityTerrainMapWebGL` in the saved mode.
- **Tween hijack by gestures** — clicks, drags, pinches, and toggle
  re-presses during the ~700 ms transition can race the camera and
  produce visible jitter. Mitigation: `isTransitioning` flag set by
  the rAF driver, consumed by every gesture handler AND the toggle
  pill `disabled` prop. Symmetric for 2D → 3D and 3D → 2D.
- **Reduced-motion users** — respect `prefers-reduced-motion:
  reduce`. Skip the tween, snap to destination state. Verified by
  the matchMedia check in `## Mode transition`.
- **DPR thrash on retina + dynamic ResizeObserver** — clamp
  `setPixelRatio` to 2 and re-use the existing 150 ms debounce on
  `logicalSize` for `renderer.setSize`.
- **Cleanup leaks** — every `Geometry` / `Material` / `Texture`
  disposed on unmount, renderer disposed last. Modelled on
  `city.js:218-236`'s `unload()` traversal and the dispose order in
  `MagicRing.tsx`.
- **Color management drift** — `srgbToLinear` is centralised in
  `coords.ts` (or a sibling helper). If three.js ever changes the
  color-attribute interpretation again, one place to update.
- **`camera.zoom = 200` precision** — float32 vertex positions resolve
  fine at this scale, but if shimmering shows up on raycasts very
  close to vertices, snap the raycaster hit to the nearest grid cell
  before display (the `worldToGrid → gridToWorld` round-trip does this
  for free).
- **Mesh under-sampling at zoom 200** — mitigated by the proximity
  grid overlay and tile-rendered occupants providing cell structure
  visually. Phase 2 dynamic LOD is the long-term fix.
- **`anchorCount == 0`** — 3D mesh build short-circuits to a flat
  square at elevation 128; square boundary + inscribed disc + "terrain
  unset" status keep displaying. 2D path's short-circuit (flat disc at
  elevation 128) is unchanged.
- **Camera-occluded occupancy dots** in Phase 2 — instanced rings
  sitting on the terrain are visually correct (a player behind a
  mountain *should* be occluded for v1), but a "show all" toggle may
  be desirable. Defer until a user complaint.
- **iOS Safari WebGL memory** — 256² mesh is ~1.5 MB GPU; far under
  the iOS budget.

## Acceptance checklist (full migration done)

- [ ] Visual: tilted terrain **square** renders with shaded
      elevation, **square boundary frame**, **dashed inscribed
      gameplay-disc overlay**, parchment-toned background. Color
      visually matches the current 2D path side-by-side (sRGB
      linearization verified).
- [ ] **2D ↔ 3D toggle pill** in status row triggers the tilt tween
      between two camera + scale.y presets inside the SAME WebGL
      scene. Choice persists in `useSettings.mapMode` zustand store
      across navigation and reload.
- [ ] **Mode transition (Google-Maps tilt)**: pressing the pill
      animates `pitch` (0° ↔ 35°) AND `mesh.scale.y` (0 ↔ 1) AND
      `target.y` (0 ↔ midpointElevation) in lockstep over ~700 ms
      with `easeOutCubic` (or `cubic-bezier(0.2, 0.8, 0.2, 1)`).
      Terrain literally rises out of the flat plate as the camera
      tilts back; reverse on 3D → 2D.
- [ ] **Tween input suppression**: clicks, pans, zooms, orbits, AND
      re-presses of the toggle pill are all ignored while
      `isTransitioning` is true. No jitter, no half-completed tween.
- [ ] **Selection-aware tween framing**: if `selectedEntity` or
      `selected` is non-null at tween start, target.x/z also tweens
      from current to `gridToWorld(selectedCell)` so the focused
      cell stays centred. If nothing's selected, target stays put.
- [ ] **`prefers-reduced-motion: reduce`** → tween is skipped; state
      snaps to destination instantly.
- [ ] **WebGL2 unavailable / context creation fails** → orchestrator
      mounts `CityTerrainMap2DFallback` (Canvas2D path) and HIDES
      the toggle pill. One-line `aria-live` notice shows once. The
      saved `useSettings.mapMode` is preserved.
- [ ] **Context restored** while in fallback → orchestrator
      unmounts the fallback, remounts `CityTerrainMapWebGL` in the
      saved mode, toggle pill reappears.
- [ ] **Mode switch preserves state**: selecting an entity in 2D
      then toggling to 3D keeps the entity selected; the tween
      frames the camera target on the selected cell. Same the
      other way. No `onEntitySelect(null)` fires on mode change.
- [ ] `onSelect` rejects impassable terrain and occupied cells.
- [ ] **Entity selection**: click on player/encounter dot fires
      `onEntitySelect(entity)`; click on empty passable cell fires
      `onEntitySelect(null)` then `onSelect(gridLat, gridLong)`;
      click on empty impassable cell fires `onEntitySelect(null)`
      only.
- [ ] Selected entity renders with yellow stroke (per-instance color
      override).
- [ ] Drag-pan no longer fires `onSelect` (suppress-click contract
      preserved).
- [ ] **350 ms touch click-suppression** after pinch on iOS — no
      phantom selection.
- [ ] Double-click / double-tap zooms IN 2× at the cursor with a
      cubic ease-out tween (220 ms); does NOT reset. Reset is only
      via the dedicated `↻` button (also tweened).
- [ ] In-mode tween cancellation: any wheel / pinch / drag / new
      pointerdown during a zoom-tween or reset-tween cancels it
      immediately and hands control back to the user's gesture.
- [ ] Hover readout emits `Water | Shore | Land | Hill | Peak`,
      metres from centre, `impassable` tag. Bucket thresholds match
      the Canvas2D fallback: `t < 0.1 → Shore`, `t < 0.5 → Land`,
      `t ≥ 0.5 → Hill`. Throttled to ~30 Hz, doesn't pin a CPU core.
- [ ] **3D camera**: right-drag (mouse) and two-finger drag with
      orbit-toggle ON (touch) change yaw and pitch within polar
      bounds (5°–82°), smoothed via the `IsometricCamera` lerp
      pattern. Yaw wraps freely; pitch never crosses the horizon.
- [ ] **3D reset view** button restores `yaw=0°, pitch=35°,
      distance=4.5, target=(0, midpointElevation, 0)` and zeroes
      `zoomVelocity`.
- [ ] **Square pan clamp** keeps the visible region inside the
      `meshSize × meshSize` square at every camera distance, yaw,
      and pitch. No parchment bleed past mesh edges.
- [ ] **Out-of-bounds click**: picking an empty cell on the square
      mesh but outside the inscribed gameplay-disc fires `onPick`
      with `outOfBounds: true`; the orchestrator surfaces a
      one-line "Outside city bounds" notice and does **not** call
      `onSelect`. Picks inside the inscribed disc behave per the
      2D contract.
- [ ] Zoom range 1× – 200× (mapped to `distance` under perspective,
      anchored at cursor via dual raycast).
- [ ] Low-zoom dot mode and high-zoom tile mode both render
      correctly; transition is at
      `cssPxPerCell ≥ GRID_OVERLAY_MIN_CSS_PX_PER_CELL` (currently 8).
- [ ] **Proximity grid** (stride-decimated graph-paper lines) renders
      whenever the threshold is crossed and disappears below it.
- [ ] **Zoom indicator + `· cells visible` status pill** in the label
      row — `1×`, `1.5×`, …, plus `· cells visible` once in tile
      mode.
- [ ] **Click on an occupied cell never fires `onSelect`** —
      `onEntitySelect({pubkey, occupantType, gridLat, gridLong})`
      runs and returns; the type contract still allows omitting
      `onSelect` even though the current caller doesn't exercise
      it.
- [ ] **Downstream flows still work** without any change to
      `map-tab.tsx`: clicking a player swaps the scroll panel to
      `<EntityPanel>`, the bottom action bar morphs to "Walk to" +
      `✕`, and the Walk action fires `intracity_start`. Clicking an
      encounter does the same with "Approach". Clicking your own
      player cell shows only `✕` (no Approach). Clicking ✕ or an
      empty cell clears the selection and restores the city panel +
      nav bar.
- [ ] **Picking an empty cell in the home city** sets an intracity
      walk destination (parent surfaces "Walk here"); picking in a
      destination city sets the intercity landing cell (parent
      surfaces Walk/Hasten/Rush). The scene-level click contract is
      the same in both — the parent branches on
      `isHomeDestination`.
- [ ] Empty-state readout copy and aria-label match the current
      file's strings verbatim.
- [ ] **Local player's walk line** renders on the map (both modes)
      whenever `isIntracityTravel && viewedCity ===
      player.currentCity` — full brightness style; marker advances
      each `chainNow` tick and glides smoothly between start and
      arrival; disappears the moment `intracity_complete` fires (no
      stale leftover).
- [ ] **Other players' walks** render on the map (both modes)
      whenever any other player satisfies `travelType === Intracity
      && arrivalTime > 0 && currentCity === viewedCity` — muted
      style (per "Walk lines" style table); self never appears in
      this set.
- [ ] **Walk source is live, not polled**: `useCityPlayers` reads
      `otherPlayers` from zustand fed by the program-wide WebSocket;
      starting/completing a walk on another wallet reflects on the
      map within one RTT, NOT up to 30 s later. The cold-start
      fetch in `useCityPlayers` no-ops when boot has already seeded
      `otherPlayers`.
- [ ] 2D pan clamp: visible region stays inside the city disc.
      3D pan clamp: visible region stays inside the square mesh
      (`## Square pan clamp`). Neither leaks parchment past its edge
      at any zoom or pan position.
- [ ] Resize: 3D camera aspect updated, no squash. 2D viewport math
      unchanged.
- [ ] Status row unchanged; both modes read occupancy from the same
      zustand-backed `useCityOccupied(cityId)` (no polling — WS
      streams Location updates into the store; the hook seeds once
      per cityId change).
- [ ] Full-sheet override in `map-tab.tsx:956-965` and the embedded
      scroll-panel layout both render correctly at their respective
      sizes (CSS module already handles both via flex + aspect-ratio).
      Both home and destination cities mount with the same prop set
      now — no read-only branch to test separately.
- [ ] WebGL2 unavailable / context creation fails: parchment-styled
      "tap to retry" overlay, no white screen.
- [ ] No always-on rAF in steady state: idle CPU ~0% in chrome
      devtools profiler when the panel is mounted but not interacted
      with. The mode-transition tween IS allowed an rAF loop for the
      ~700 ms it runs, then must stop.
- [ ] Mount/unmount 10× in a row: `renderer.info.memory.geometries`
      and `.textures` return to zero. No leaks.
- [ ] `bun typecheck` and the e2e suite that exercises landing-cell
      selection still pass.

## Open follow-ups (track separately)

- **Walk-line palette mismatch with occupant palette.** When the
  antique palette landed in `CityTerrainMap.tsx`, occupants moved
  to `PLAYER_FILL = rgba(160, 100, 45)` (tobacco amber) /
  `WILD_FILL = rgba(115, 55, 30)` (oxblood), but the walk lines
  still use the prior **seal-orange `rgba(180, 83, 9)`** family.
  Result: the local player's dot and the local player's walk line
  are now visually different oranges. Decide: either (a) align
  walk lines to `PLAYER_FILL` for visual consistency, or (b)
  intentionally keep seal-orange as the "in-flight" cue
  distinguished from the static occupant. The doc's walk-lines
  style table currently cites the seal-orange code, so it stays
  accurate either way — just pick one and update both code and
  table together. Affects the Canvas2D fallback AND the 3D scene.

## Out of scope

- The "Town" mode from `terrain-builder/src/town/` (estate editor,
  buildings, NPCs, physics, atmosphere). Separate, much larger port;
  probably a follow-on `EstateView` component, not part of
  CityTerrainMap.
- The "Globe" / azimuthal world view — covered by `RealmMap.tsx`
  separately.
- **Intercity-travel arrival lines on the disc.** When a player is
  intercity-flying TOWARD this city, their origin cell is in another
  city's disc — the "from" point is off the current disc entirely.
  Showing the inbound arrow would require clipping the line at the
  disc edge and a separate "incoming from kingdom-direction X"
  indicator. Defer; intercity progress already shows on the realm
  map line + marker. v1 city disc is intracity-only for walks; the
  destination cell still highlights as the `selected` ring (chain
  derived, see "Live other-players state" pattern but for self
  during in-flight intercity).
- Free camera rotation. Quantised 90° yaw snap is a possible Phase 2
  follow-up; free orbit never.