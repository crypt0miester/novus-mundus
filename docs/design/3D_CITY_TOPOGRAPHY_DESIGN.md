# 3D City Topography for `CityTerrainMap.tsx`

Port the displaced-plane terrain renderer from
`sdks/novus-mundus-ts/terrain-builder/src/city/city.js` into
`apps/web/src/components/world/CityTerrainMap.tsx`, replacing the
two-canvas viewport-based 2D path with a single WebGL canvas.

The reference renderer and the current web component share the same
chain-faithful heightmap functions (`terrainElevation`,
`terrainMoisture`, `elevationToColor` in
`sdks/novus-mundus-ts/src/calculators/terrain.ts`), so this is a
rendering-layer swap, not a re-derivation of the math.

**The current `CityTerrainMap.tsx` does more than a naive 2D-disc
renderer.** Read the "Current state" section before touching anything
— every feature listed there must survive the port.

## Projection: isometric (chosen)

Three projections were on the table:

1. **World-map style** — top-down 2D viewBox, north up, no tilt (what
   `RealmMap.tsx` + `useZoomPan` already do). Loses the entire point of
   the upgrade: elevation is only visible via shading.
2. **Free perspective + OrbitControls** — what the terrain-builder
   reference uses. Most flexible, but: foreshortening makes grid cells
   non-uniform on screen, click math is harder to verify against the
   on-chain grid, and "I lost my orientation" is a real failure mode
   for casual players.
3. **Isometric (orthographic + fixed tilt)** — picked.
   `THREE.OrthographicCamera` with `pitch = 35.264°` (the
   `atan(1/√2)` of true iso) and `yaw = 0°` (north up). No perspective
   distortion, so one world-XZ unit projects to a fixed number of CSS
   px regardless of position; the grid is uniform across the screen.

**Honest naming caveat.** "Isometric" with yaw 0° is technically an
axonometric projection — latitude is foreshortened by
`cos(35.264°) ≈ 0.816` on screen Y, but longitude maps 1:1. Cells
look like top-down squares tilted forward, *not* like classic
diamond tiles. If anyone on the team is picturing SimCity, they
should look at a mockup first.

**Why isometric over world-map**: makes mountains actually rise off the
disc, gives the city view a distinct feel from the realm map (you
zoom in from the realm view and the projection itself changes — clear
context switch), and is the conventional projection for city-scale
gameplay rendering.

**Why isometric over free orbit**: keeps the grid axis-aligned and
uniform, which makes the "grid parity" contract trivially verifiable;
the camera always knows where north is, so a compass is meaningful;
and there is nothing to "lose" — gestures only zoom and pan.

**Yaw**: lock to `yaw = 0°` for v1 so the projected grid keeps the
same handedness as the 2D disc (longitude → screen X, latitude →
screen Y). A "rotate camera" button can come later as a quantised
90° snap, never free rotation.

## Current state

`CityTerrainMap.tsx` already implements a viewport-based 2D renderer
that does substantially more than the original port plan acknowledged.
**Every feature in this list must survive the port** unless explicitly
deferred. Read this carefully before designing the 3D scene.

### Terrain layer
- **Viewport-based**, not full-disc. `renderTerrainViewport(terrain,
  sizeDev, panOx, panOy, viewportRadius, cityRadius)` paints only the
  visible region at full pixel resolution, re-rendering on every
  pan/zoom. This is why the current file supports zoom up to **200×**
  without losing crispness.
- The 3D port replaces this with mesh-resolution scaling — at deep
  zoom we want more vertices per cell, not more pixels per cell. See
  "Mesh resolution" below for the strategy.

### Overlay layer
- **City boundary disc** drawn only when the city edge is in view.
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
- **Centre marker** with dark fill, cream stroke. **Radius scales
  with zoom** so it stays visually anchored to its cell at high
  zoom:
  ```ts
  const r = Math.max(5 * dpr, Math.min(pxPerCell * 0.6, 14 * dpr));
  ```
- **Occupant rendering with two modes**, gated on the same
  `GRID_OVERLAY_MIN_CSS_PX_PER_CELL` threshold:
  - Low zoom (below threshold): round dots with cream outline;
    encounters get an inner yellow danger ring.
  - High zoom (at or above threshold): filled square tiles matching
    one grid cell exactly, with outline stroke. Snap tile rect to
    integer device pixels — sub-pixel offsets give visible seams.
    The cell footprint must be obvious; this is the whole UX premise
    of being able to zoom in.
- **Entity selection ring**: if the selected entity matches an
  occupant, that occupant draws with a yellow stroke instead of cream
  (`rgba(255, 220, 80, 1)`, `lineWidth` bumped by 1).
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
  1. City boundary ring
  2. Proximity grid (when threshold hit)
  3. Other-players walks (muted)
  4. Local-player walk (bright)
  5. Centre marker
  6. Occupancy dots / tiles (incl. encounter danger ring in dot mode)
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
  The internal `OccupiedCell` carries an extra `occupant: string`
  field (base58 of the location's occupant PDA) so click → entity
  promotion has the pubkey on hand without a re-fetch.
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
- Wheel/pinch zoom **1× – 200×**, drag pan, dbl-click reset, click
  suppression after drag, touch parity.
- **350 ms touch click-suppression** after pinch — preserves UX on
  iOS where a phantom click otherwise fires at end of pinch.
- **rAF-batched pan with explicit final flush on mouseup/touchend**
  — pixel deltas accumulate in `pendingDx/pendingDy` and flush once
  per paint; on release the rAF is cancelled and `flushPan` runs
  inline so final position is exact.
- Hover readout: `Water | Land | Peak`, metres from centre,
  `impassable` tag.
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
  Scroll or pinch to zoom, drag to pan, double-click to reset."
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

### Pan clamp (correction to Rev 1)
The clamp keeps the **entire visible region** inside the city disc,
not just the centre:
```
max = radiusGridUnits − radiusGridUnits / scale
length(panOx, panOy) ≤ max
```
Otherwise the canvas's transparent outside-disc pixels show the
parchment background bleeding through the terrain. Port this
constraint verbatim into the 3D path — the math is the same, the
viewport just becomes the camera frustum.

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
  minDistance ∝ km, maxDistance 9, `screenSpacePanning: false`.
- Decoration: large ocean floor plane, circular `MeshPhongMaterial`
  water surface at `waterLine` height, thin boundary `RingGeometry`,
  anchor debug spheres, city name as `CSS2DObject`.
- HUD: bottom-left coord/alt (raycaster), bottom-right scale bar,
  top-right compass SVG.
- `scene.fog = FogExp2(0x08101e, 0.055)`.

The reference uses a perspective camera and `OrbitControls`. Neither
is appropriate for this port — see "Camera and movement" below.

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
- **Edge fade**: the band between `0.92·rgu` and `rgu` falls toward
  `waterLine − 30` in the mesh, but `isPassable(terrain, ox, oy)` is
  computed from the *raw* `terrainElevation` and ignores the fade.
  This is intentional — the fade is decorative, the passability
  contract belongs to the chain. Markers inside the fade band still
  use chain elevation for their Y, not the faded one, otherwise a
  player on shoreline cell `(rgu − 5, 0)` would sink under the water
  plane.

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
├── CityTerrainMap.tsx          (orchestrator: occupancy fetch, status,
│                                 hover readout, click contract, entity
│                                 selection)
├── CityTerrainMap.module.css   (unchanged shell; add `.canvas3d`,
│                                 `.errorOverlay`)
└── city3d/
    ├── CityTerrainScene.tsx    (the three.js renderer; props-only API,
    │                             no imperative handle in v1)
    ├── coords.ts               (worldToGrid / gridToWorld /
    │                             getElevationAt + srgbToLinear)
    ├── buildTerrainMesh.ts     (PlaneGeometry build from CityTerrain;
    │                             uses coords.ts)
    ├── markers.ts              (InstancedMesh layers: player/encounter
    │                             dots & tiles, centre, selection,
    │                             boundary)
    └── controls.ts             (ortho pan/zoom + click-vs-drag
                                  suppression; mirrors current 2D
                                  gesture math; uses propsRef pattern)
```

`CityTerrainMap.tsx` mounts `<CityTerrainScene>` instead of the two
2D `<canvas>` elements.

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

**Camera**:
- `THREE.OrthographicCamera`. Frustum sized from a constant
  `FRUSTUM_HEIGHT = meshSize * 1.15` so the city disc fills ~85% of
  the viewport at zoom = 1, leaving a small parchment margin.
- Fixed pitch `35.264°`. Fixed yaw `0°` (north up).
- Camera target stays on the terrain plane at `Y = midpointElevation
  ≈ ((waterLine + peakLine) / 2 / 255) * maxH`, not at world origin —
  keeps zoom-in feeling like you're diving toward the ground.

**Zoom is `camera.zoom`, not frustum size**:
```ts
camera.zoom = clamp(camera.zoom * factor, 1, 200);
camera.updateProjectionMatrix();
requestRender();
```
Range `[1, 200]` matches the current 2D file. **Not** `[1, 6]` as Rev 1
proposed — that would delete the "cells visible" UX.

**On resize**:
```ts
const aspect = w / h;
const half = FRUSTUM_HEIGHT / 2;
camera.left   = -half * aspect;
camera.right  =  half * aspect;
camera.top    =  half;
camera.bottom = -half;
camera.updateProjectionMatrix();
renderer.setSize(w, h, false);
requestRender();
```
`ResizeObserver` + `window.addEventListener('resize')` belt-and-
suspenders, matching `MagicRing.tsx`.

**Zoom-to-cursor with ortho + tilt** (the 2D `zoomAt` math does *not*
translate directly because of the 35° pitch — needs a raycast on
each side of the zoom):
```ts
function zoomAt(clientX: number, clientY: number, factor: number) {
  const before = raycastTerrain(clientX, clientY);
  if (!before) return;
  camera.zoom = clamp(camera.zoom * factor, 1, 200);
  camera.updateProjectionMatrix();
  const after = raycastTerrain(clientX, clientY);
  if (!after) return;
  const dx = before.x - after.x;
  const dz = before.z - after.z;
  camera.position.x += dx;
  camera.position.z += dz;
  controls.target.x += dx;
  controls.target.z += dz;
  clampPan();
  requestRender();
}
```

**Pan in world units with a tilted camera**. Screen Y is foreshortened
by `cos(PITCH)`:
```ts
const worldPerPx = FRUSTUM_HEIGHT / (camera.zoom * canvasHeightPx);
const worldDx = -pixelDx * worldPerPx;
const worldDz =  pixelDy * worldPerPx / Math.cos(PITCH);
```
Apply to both `camera.position` and target — yaw and pitch never
change.

**`clampPan`** (entire visible region inside city disc, matching
current behaviour):
```ts
const visibleHalfW = (camera.right - camera.left) / (2 * camera.zoom);
const visibleHalfH = (camera.top   - camera.bottom) / (2 * camera.zoom);
const visibleRadius = Math.hypot(visibleHalfW, visibleHalfH / Math.cos(PITCH));
const cityWorldRadius = meshSize / 2;
const maxOffset = Math.max(0, cityWorldRadius - visibleRadius);
// Clamp target offset from world origin to maxOffset.
```

**Gestures** — one source of truth, all bound to the WebGL canvas
wrap. Port the current 2D event handlers wholesale:
- **Pan**: mouse drag (4 px threshold), one-finger touch drag (6 px
  threshold). Pixel deltas accumulate in `pendingDx/pendingDy` and
  flush once per rAF; on release the rAF is cancelled and `flushPan`
  runs inline for an exact final position.
- **Zoom**: mouse wheel, ctrl+wheel (trackpad pinch dampened
  ×0.35), two-finger touch pinch.
- **Reset**: double-click / double-tap + `.resetBtn` pill.
- **Drag-vs-click suppression**: preserve `suppressClickRef`.
- **350 ms touch click-suppression after pinch** — not optional;
  phantom click selection on iOS otherwise.
- **No keyboard movement** in v1; `role="application"` aria-label
  documents the gestures.

**`touch-action: none`** on the canvas wrap. (Already on the current
wrap; carry it onto the new one or one-finger drag will steal page
scroll.)

**Do not use `OrbitControls`** — built around a polar camera and
free rotation. Write the controller in `city3d/controls.ts` mirroring
the existing 2D gesture math but mutating `camera.position`,
`camera.zoom`, and `controls.target` instead of a CSS transform.

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
- **Anchor count = 0 short-circuit**: build a flat disc at elevation
  128, skip the elevation lookup loop, boundary ring + "terrain
  unset" status still render. Matches current 2D behaviour.

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
cell) used by the proximity grid — not `4`. Read it once into a
`useMemo` (`cssPxPerCell = canvasCssWidth / (2 × viewportRadius)`)
and gate every dual-mode marker on the same expression so the
transition is atomic.

### Low-zoom dot mode (`cssPxPerCell < GRID_OVERLAY_MIN_CSS_PX_PER_CELL`)
- **Player dot** = `CircleGeometry(rDot, 24)` filled
  `rgba(180, 83, 9, 1)`, plus a concentric `RingGeometry(rDot,
  rDot * 1.18, 24)` filled cream `rgba(255, 250, 235, 0.95)`. Both
  lie flat on the terrain at `getElevationAt(ox, oy) + maxH * 0.005`.
  `InstancedMesh` per layer, `frustumCulled = false` (or fat bounding
  sphere) so distant instances don't get culled.
- **Encounter dot** = same pattern, red `rgba(160, 30, 30, 1)`. Plus
  an inner yellow danger ring (`CircleGeometry(rDot * 0.55, 16)`,
  additive blending) as a third `InstancedMesh`. **Dot mode only**
  — the danger ring is hidden in tile mode (the tile fill already
  reads as "danger" at that scale).
- **Selected entity** stroke override → yellow `rgba(255, 220, 80, 1)`
  applied per-instance via `setColorAt`, `lineWidth` bumped by 1 (in
  3D this becomes a slightly thicker outline ring on the same
  instance).
- **Selection ring** (landing-cell picker) = `RingGeometry(rDot * 1.4,
  rDot * 1.7, 64)` orange ink + `+` crosshair strips.

### High-zoom tile mode (`cssPxPerCell ≥ GRID_OVERLAY_MIN_CSS_PX_PER_CELL`)
- Same `InstancedMesh` layers but the inner geometry swaps from
  `CircleGeometry` to `PlaneGeometry(cellSize, cellSize)` where
  `cellSize = (1 / rgu) * meshSize`. The outline ring layer swaps to
  4 thin border strips (or a `RingGeometry`-shaped square frame —
  picker's call). Snap world position to grid centres so the tile
  rect aligns with the underlying flat-shaded mesh cell.
- **Selection ring** swaps to a tile-rect outline (`PlaneGeometry`
  with stroke-only material or 4 strips) at the selected cell — same
  pattern as the 2D file's `if (renderAsTiles)` branch at the
  selected-cell draw step.

Switch is driven by `cssPxPerCell` crossing the threshold; instance
visibility toggles, no rebuild.

### Other markers
- **Centre marker** = single (non-instanced) flat ring + filled disc
  at `(0, getElevationAt(0, 0) + bias, 0)`, dark ink + cream ring.
  **Radius scales with zoom** per the 2D path —
  `rWorld = max(rDotMin, min(0.6 * cellWorld, rDotMax))` where
  `cellWorld = meshSize / rgu` — so the marker stays anchored to its
  cell at every zoom level.
- **Selection ring** dimensions per the dual-mode section above.
- **City boundary ring** = `RingGeometry(meshSize/2 * 0.99,
  meshSize/2 * 1.01, 128)`, faint sepia
  `rgba(46, 31, 16, 0.55)`, flat at midpoint elevation. Visible only
  when the city edge is within the camera frustum (cull or fade
  based on `view.scale` vs. visible-radius math).
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
- Hover readout (`Water | Land | Peak`, metres, `impassable`) → same
  React DOM nodes the current file uses, fed via `onHover` callback.
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

## Phase 1 — terrain + markers + click (full parity)

Goal: full feature parity with the current 2D component in one WebGL
component, isometric from day 1.

- Mesh build per "Mesh build" + "Color management" above.
- Camera, gestures, lights per the sections above.
- Markers per "Markers" above — both low-zoom dot mode and high-zoom
  tile mode, including the entity-selection yellow override, the
  zoom-scaled centre marker, the dual-mode selection ring, the
  proximity grid lines, **and the in-flight walk lines for the local
  player (`travel`) plus every other intracity walker in the city
  (`otherWalks`)**.
- Walk-data source must be `useCityPlayers(cityId)` (zustand-backed,
  live via the program-wide WS) — NOT `useWorldPlayers` (the 30 s
  tanstack-query polling path). See "Live other-players state" for
  the full data flow. The 3D port consumes the same shapes via the
  same props.
- Click + hover use `THREE.Raycaster` against the terrain mesh →
  `worldToGrid(point.x, point.z, rgu)` → entity lookup against
  `occupied`, then `onPick({gridLat, gridLong, passable,
  entityAtCell})`. The orchestrator (`CityTerrainMap.tsx`)
  implements the entity-vs-landing branching from "Click semantics"
  — the scene component just hands raw hits up.
- Renderer setup mirrors `MagicRing.tsx` (try/catch, WebGL2 gate,
  `setPixelRatio` before `setSize`, transparent clear).
- Re-uses the existing `.canvasWrap` shell, status row (including
  the zoom multiplier + `· cells visible` indicator), hover readout
  `aria-live`, legend, and reset button. Only the canvas pair
  (`terrainCanvasRef` + `overlayCanvasRef`) is replaced.

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

- **2D fallback.** Don't ship a runtime 2D/3D toggle until we have a
  reason to keep the 2D code path alive. WebGL2 is universally
  available in our target browsers and the heightmap math is the same
  cost in both. WebGL2 unavailable falls back to the
  `onContextLost` overlay, not a runtime 2D render. If a fallback is
  needed later, the 2D path lives in git history.
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
  + WebGL2 gate at construction. On any of these, fire
  `onContextLost` and render a parchment-styled "tap to retry"
  overlay (don't silently die). On restore, rebuild mesh from current
  `terrain` prop.
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
- **`anchorCount == 0`** — mesh build short-circuits to a flat disc at
  elevation 128; boundary ring + "terrain unset" status keep
  displaying. Matches current behaviour.
- **Camera-occluded occupancy dots** in Phase 2 — instanced rings
  sitting on the terrain are visually correct (a player behind a
  mountain *should* be occluded for v1), but a "show all" toggle may
  be desirable. Defer until a user complaint.
- **iOS Safari WebGL memory** — 256² mesh is ~1.5 MB GPU; far under
  the iOS budget.

## Acceptance checklist (full migration done)

- [ ] Visual: tilted terrain disc renders with shaded elevation,
      boundary ring, parchment-toned background. Color visually
      matches the current 2D path side-by-side (sRGB linearization
      verified).
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
- [ ] Double-tap / dedicated reset button recentres.
- [ ] Hover readout emits `Water | Land | Peak`, metres from centre,
      `impassable` tag. Throttled to ~30 Hz, doesn't pin a CPU core.
- [ ] Zoom range 1× – 200×, anchored at cursor.
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
- [ ] **Local player's walk line** renders on the disc whenever
      `isIntracityTravel && viewedCity === player.currentCity` — full
      brightness style; marker advances each `chainNow` tick and
      glides smoothly between start and arrival; disappears the
      moment `intracity_complete` fires (no stale leftover).
- [ ] **Other players' walks** render whenever any other player
      satisfies `travelType === Intracity && arrivalTime > 0 &&
      currentCity === viewedCity` — muted style (per "Walk lines"
      style table); self never appears in this set.
- [ ] **Walk source is live, not polled**: `useCityPlayers` reads
      `otherPlayers` from zustand fed by the program-wide WebSocket;
      starting/completing a walk on another wallet reflects on the
      disc within one RTT, NOT up to 30 s later. The cold-start
      fetch in `useCityPlayers` no-ops when boot has already seeded
      `otherPlayers`.
- [ ] Pan clamp keeps entire visible region inside the city disc —
      no parchment bleed at any zoom or pan position.
- [ ] Resize: ortho frustum recomputed, no aspect squash.
- [ ] Status row, occupancy poll, visibility-pause behaviour
      unchanged.
- [ ] Full-sheet override in `map-tab.tsx:956-965` and the embedded
      scroll-panel layout both render correctly at their respective
      sizes (CSS module already handles both via flex + aspect-ratio).
      Both home and destination cities mount with the same prop set
      now — no read-only branch to test separately.
- [ ] WebGL2 unavailable / context creation fails: parchment-styled
      "tap to retry" overlay, no white screen.
- [ ] No always-on rAF: idle CPU ~0% in chrome devtools profiler when
      the panel is mounted but not interacted with.
- [ ] Mount/unmount 10× in a row: `renderer.info.memory.geometries`
      and `.textures` return to zero. No leaks.
- [ ] `bun typecheck` and the e2e suite that exercises landing-cell
      selection still pass.

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