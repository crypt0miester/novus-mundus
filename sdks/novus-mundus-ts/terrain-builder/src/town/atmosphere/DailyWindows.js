/**
 * Daily windows atmospheric system — Dawn / Midday / Dusk window events.
 *
 * Each time-of-day window produces unique visual effects on specific buildings:
 *
 *   Dawn    - Golden bell rings, well glows, Barracks NPCs salute
 *   Midday  - Market stalls bustle, Academy books float faster, Arena crowd cheers
 *   Dusk    - Sanctuary candles ignite, Observatory dome opens, Treasury coins glow
 *
 * When a window is completed (player claimed the reward), a checkmark rune
 * appears on affected buildings and the active effect fades to a dim afterglow.
 * When all three windows are completed, the town square fountain turns golden.
 *
 * Effects are driven entirely by uniforms and per-frame parameter updates;
 * other systems (particles, NPCs, audio) query getEffects() to know what
 * to display.
 */

import * as THREE from 'three';

// Bitmask constants (must match on-chain format: 0b00000DML)

const WINDOW_DAWN = 0b001;    // L — Morning
const WINDOW_MIDDAY = 0b010;  // M — Midday
const WINDOW_DUSK = 0b100;    // D — Dusk

// Rune checkmark billboard

const RUNE_VERTEX_SHADER = /* glsl */ `
  uniform float scale;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec4 mvPos = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    mvPos.xy += position.xy * scale;
    gl_Position = projectionMatrix * mvPos;
  }
`;

const RUNE_FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 color;
  uniform float opacity;
  varying vec2 vUv;
  void main() {
    // Procedural checkmark shape
    vec2 p = vUv * 2.0 - 1.0;

    // Circle mask
    float circle = 1.0 - smoothstep(0.6, 0.7, length(p));

    // Check stroke: two line segments forming a V-shape
    // Leg 1: from (-0.3, 0.0) to (0.0, -0.3)
    float d1 = abs((p.y - 0.0) - (p.x + 0.3)) / 1.414;
    float leg1 = 1.0 - smoothstep(0.04, 0.08, d1);
    float inLeg1 = step(-0.3, p.x) * step(p.x, 0.0) * step(-0.35, p.y) * step(p.y, 0.05);

    // Leg 2: from (0.0, -0.3) to (0.4, 0.35)
    float slope2 = (0.35 - (-0.3)) / (0.4 - 0.0);
    float d2 = abs(p.y - (-0.3 + slope2 * (p.x - 0.0))) / sqrt(1.0 + slope2 * slope2);
    float leg2 = 1.0 - smoothstep(0.04, 0.08, d2);
    float inLeg2 = step(0.0, p.x) * step(p.x, 0.45) * step(-0.35, p.y) * step(p.y, 0.4);

    float check = max(leg1 * inLeg1, leg2 * inLeg2);
    float alpha = circle * max(check * 0.9, 0.15) * opacity;

    if (alpha < 0.01) discard;
    gl_FragColor = vec4(color, alpha);
  }
`;

// Effect intensity curves

/**
 * Smooth pulse oscillation for active window effects.
 * @param {number} t - Elapsed time
 * @param {number} freq - Oscillation frequency
 * @returns {number} 0..1
 */
function pulse(t, freq) {
  return 0.5 + 0.5 * Math.sin(t * freq * Math.PI * 2);
}

/**
 * Smoothstep helper.
 * @param {number} edge0
 * @param {number} edge1
 * @param {number} x
 * @returns {number}
 */
function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

// Time-of-day window detection

/**
 * Determine which window period the given hour falls into.
 * Dawn: 5-9, Midday: 10-14, Dusk: 16-20.
 * @param {number} hour - 0..24
 * @returns {'dawn'|'midday'|'dusk'|null}
 */
function detectWindow(hour) {
  if (hour >= 5 && hour < 9) return 'dawn';
  if (hour >= 10 && hour < 14) return 'midday';
  if (hour >= 16 && hour < 20) return 'dusk';
  return null;
}

/**
 * Compute a ramp-in / ramp-out intensity for a window period.
 * @param {number} hour
 * @param {number} start - Window start hour
 * @param {number} end   - Window end hour
 * @returns {number} 0..1
 */
function windowIntensity(hour, start, end) {
  const rampIn = 0.5;
  const rampOut = 0.5;
  if (hour < start || hour > end) return 0;
  if (hour < start + rampIn) return smoothstep(start, start + rampIn, hour);
  if (hour > end - rampOut) return 1 - smoothstep(end - rampOut, end, hour);
  return 1;
}

// Colors

const DAWN_COLOR = new THREE.Color(0xffd700);
const MIDDAY_COLOR = new THREE.Color(0xff8c00);
const DUSK_COLOR = new THREE.Color(0x9370db);
const AFTERGLOW_COLOR = new THREE.Color(0xc0c0c0);
const GOLD_FOUNTAIN_COLOR = new THREE.Color(0xffd700);
const RUNE_COMPLETE_COLOR = new THREE.Color(0x90ee90);

// DailyWindows

export class DailyWindows {
  /**
   * @param {THREE.Scene} scene
   */
  constructor(scene) {
    this._scene = scene;

    // Current state
    this._windowsCompleted = 0;   // bitmask 0b00000DML
    this._currentWindow = null;   // 'dawn' | 'midday' | 'dusk' | null

    // Running time for animation pulses
    this._elapsed = 0;

    // Per-window intensity (0..1 animated)
    this._dawnIntensity = 0;
    this._middayIntensity = 0;
    this._duskIntensity = 0;

    // Afterglow intensities for completed windows
    this._dawnAfterglow = 0;
    this._middayAfterglow = 0;
    this._duskAfterglow = 0;

    // Fountain golden state
    this._goldFountainIntensity = 0;

    // Rune billboards: we pool up to 20 (one per building slot)
    this._runes = [];
    this._runeGeometry = new THREE.PlaneGeometry(1, 1);

    // Cached effects output (reused each frame to avoid allocation)
    this._effects = {
      dawnActive: false,
      middayActive: false,
      duskActive: false,
      dawnCompleted: false,
      middayCompleted: false,
      duskCompleted: false,
      allCompleted: false,
      goldFountain: 0,
      dawnIntensity: 0,
      middayIntensity: 0,
      duskIntensity: 0,
      dawnAfterglow: 0,
      middayAfterglow: 0,
      duskAfterglow: 0,
      // Building-specific boost multipliers (1.0 = normal, >1 = boosted)
      barracksBoost: 1.0,
      marketBoost: 1.0,
      academyBoost: 1.0,
      arenaBoost: 1.0,
      sanctuaryBoost: 1.0,
      observatoryBoost: 1.0,
      treasuryBoost: 1.0,
      wellGlow: 0,
      bellRing: 0,
    };
  }

  // Public API

  /**
   * Set which windows are active / completed.
   * @param {number} windowsCompleted - Bitmask 0b00000DML
   * @param {'dawn'|'midday'|'dusk'|null} currentWindow
   */
  setWindowState(windowsCompleted, currentWindow) {
    const prevCompleted = this._windowsCompleted;
    this._windowsCompleted = windowsCompleted;
    this._currentWindow = currentWindow;

    // Check for newly completed windows and spawn rune checkmarks
    const newlyDone = windowsCompleted & ~prevCompleted;
    if (newlyDone & WINDOW_DAWN) this._onWindowCompleted('dawn');
    if (newlyDone & WINDOW_MIDDAY) this._onWindowCompleted('midday');
    if (newlyDone & WINDOW_DUSK) this._onWindowCompleted('dusk');
  }

  /**
   * Get current effect parameters for other systems to query.
   * @returns {object}
   */
  getEffects() {
    return this._effects;
  }

  /**
   * Per-frame update.
   * @param {number} deltaTime - Seconds
   * @param {number} timeOfDay - Hour (0..24)
   */
  update(deltaTime, timeOfDay) {
    const dt = Math.min(deltaTime, 0.1);
    this._elapsed += dt;

    const completed = this._windowsCompleted;
    const dawnDone = !!(completed & WINDOW_DAWN);
    const middayDone = !!(completed & WINDOW_MIDDAY);
    const duskDone = !!(completed & WINDOW_DUSK);
    const allDone = dawnDone && middayDone && duskDone;

    // Auto-detect current window from time if not explicitly set
    const active = this._currentWindow || detectWindow(timeOfDay);

    // Compute raw window intensities from time-of-day
    const rawDawn = windowIntensity(timeOfDay, 5, 9);
    const rawMidday = windowIntensity(timeOfDay, 10, 14);
    const rawDusk = windowIntensity(timeOfDay, 16, 20);

    // Active intensities: full if window is active and NOT completed,
    // otherwise fade to afterglow
    const dawnActive = active === 'dawn' && !dawnDone;
    const middayActive = active === 'midday' && !middayDone;
    const duskActive = active === 'dusk' && !duskDone;

    // Smooth interpolation toward target intensities
    const lerpRate = 3.0 * dt;

    // Dawn
    const dawnTarget = dawnActive ? rawDawn * pulse(this._elapsed, 0.3) : 0;
    this._dawnIntensity += (dawnTarget - this._dawnIntensity) * lerpRate;

    // Midday
    const middayTarget = middayActive ? rawMidday * pulse(this._elapsed, 0.4) : 0;
    this._middayIntensity += (middayTarget - this._middayIntensity) * lerpRate;

    // Dusk
    const duskTarget = duskActive ? rawDusk * pulse(this._elapsed, 0.25) : 0;
    this._duskIntensity += (duskTarget - this._duskIntensity) * lerpRate;

    // Afterglows for completed windows (subtle persistent glow)
    const afterglowBase = 0.25;
    this._dawnAfterglow += ((dawnDone ? afterglowBase * rawDawn : 0) - this._dawnAfterglow) * lerpRate;
    this._middayAfterglow += ((middayDone ? afterglowBase * rawMidday : 0) - this._middayAfterglow) * lerpRate;
    this._duskAfterglow += ((duskDone ? afterglowBase * rawDusk : 0) - this._duskAfterglow) * lerpRate;

    // Golden fountain
    const goldTarget = allDone ? 1.0 : 0;
    this._goldFountainIntensity += (goldTarget - this._goldFountainIntensity) * lerpRate * 0.5;

    // Update rune billboard opacities
    for (let i = 0; i < this._runes.length; i++) {
      const rune = this._runes[i];
      if (!rune.mesh) continue;
      // Pulse the rune opacity gently
      const runeOpacity = 0.6 + 0.2 * Math.sin(this._elapsed * 2 + rune.phaseOffset);
      rune.material.uniforms.opacity.value = runeOpacity;
    }

    // Build effects output
    const eff = this._effects;
    eff.dawnActive = dawnActive;
    eff.middayActive = middayActive;
    eff.duskActive = duskActive;
    eff.dawnCompleted = dawnDone;
    eff.middayCompleted = middayDone;
    eff.duskCompleted = duskDone;
    eff.allCompleted = allDone;
    eff.goldFountain = this._goldFountainIntensity;
    eff.dawnIntensity = this._dawnIntensity;
    eff.middayIntensity = this._middayIntensity;
    eff.duskIntensity = this._duskIntensity;
    eff.dawnAfterglow = this._dawnAfterglow;
    eff.middayAfterglow = this._middayAfterglow;
    eff.duskAfterglow = this._duskAfterglow;

    // Building boost multipliers
    // Dawn effects: Barracks salute, well glow, bell ring
    eff.barracksBoost = 1.0 + this._dawnIntensity * 0.5 + this._dawnAfterglow * 0.2;
    eff.wellGlow = this._dawnIntensity;
    eff.bellRing = dawnActive ? pulse(this._elapsed, 0.15) * this._dawnIntensity : 0;

    // Midday effects: Market bustle, Academy books, Arena crowd
    eff.marketBoost = 1.0 + this._middayIntensity * 0.6 + this._middayAfterglow * 0.2;
    eff.academyBoost = 1.0 + this._middayIntensity * 0.4 + this._middayAfterglow * 0.15;
    eff.arenaBoost = 1.0 + this._middayIntensity * 0.5 + this._middayAfterglow * 0.2;

    // Dusk effects: Sanctuary candles, Observatory dome, Treasury glow
    eff.sanctuaryBoost = 1.0 + this._duskIntensity * 0.5 + this._duskAfterglow * 0.25;
    eff.observatoryBoost = 1.0 + this._duskIntensity * 0.4 + this._duskAfterglow * 0.15;
    eff.treasuryBoost = 1.0 + this._duskIntensity * 0.6 + this._duskAfterglow * 0.3;
  }

  /**
   * Dispose all resources.
   */
  dispose() {
    for (let i = 0; i < this._runes.length; i++) {
      const rune = this._runes[i];
      if (rune.mesh) {
        this._scene.remove(rune.mesh);
        rune.material.dispose();
      }
    }
    this._runes.length = 0;

    if (this._runeGeometry) {
      this._runeGeometry.dispose();
      this._runeGeometry = null;
    }
  }

  // Internal: rune spawning when a window is completed

  /**
   * Spawn checkmark rune billboards on buildings associated with the given window.
   * @param {'dawn'|'midday'|'dusk'} windowName
   * @private
   */
  _onWindowCompleted(windowName) {
    // Determine which building types to mark.
    // Dawn  -> Barracks (1), Workshop (2) — early-game production
    // Midday -> Market (6), Academy (7), Arena (8)
    // Dusk   -> Sanctuary (9), Observatory (10), Treasury (11)
    let targetTypes;
    let runeColor;
    switch (windowName) {
      case 'dawn':
        targetTypes = [1, 2];
        runeColor = DAWN_COLOR;
        break;
      case 'midday':
        targetTypes = [6, 7, 8];
        runeColor = MIDDAY_COLOR;
        break;
      case 'dusk':
        targetTypes = [9, 10, 11];
        runeColor = DUSK_COLOR;
        break;
      default:
        return;
    }

    // Find building meshes in the scene by traversal.
    // We look for groups named 'plot-N' containing children with userData.buildingType.
    this._scene.traverse((obj) => {
      if (!obj.userData || obj.userData.buildingType === undefined) return;
      if (!targetTypes.includes(obj.userData.buildingType)) return;

      // Place rune above the building
      const worldPos = new THREE.Vector3();
      obj.getWorldPosition(worldPos);
      worldPos.y += 0.06; // float above building

      this._spawnRune(worldPos, runeColor);
    });

    // If no scene buildings found yet, place a single rune at origin as fallback.
    // This handles the case where buildings are not yet added to scene but state
    // updates arrive early.
    if (this._runes.length === 0) {
      this._spawnRune(new THREE.Vector3(0, 0.15, 0), RUNE_COMPLETE_COLOR);
    }
  }

  /**
   * Spawn a single rune checkmark billboard at a world position.
   * @param {THREE.Vector3} position
   * @param {THREE.Color} color
   * @private
   */
  _spawnRune(position, color) {
    const material = new THREE.ShaderMaterial({
      uniforms: {
        scale: { value: 0.04 },
        color: { value: color.clone() },
        opacity: { value: 0.0 },
      },
      vertexShader: RUNE_VERTEX_SHADER,
      fragmentShader: RUNE_FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    const mesh = new THREE.Mesh(this._runeGeometry, material);
    mesh.position.copy(position);
    mesh.frustumCulled = false;
    this._scene.add(mesh);

    this._runes.push({
      mesh,
      material,
      phaseOffset: Math.random() * Math.PI * 2,
    });
  }
}
