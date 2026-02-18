import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Time-of-day keyframes
// Each entry: { hour, sunColor, sunIntensity, ambientColor, skyColor,
//               fogColor, fogDensity, hemiSkyColor, hemiGroundColor,
//               hemiIntensity }
// ---------------------------------------------------------------------------

const TIME_KEYFRAMES = [
  {
    hour: 0,
    sunColor: new THREE.Color(0x8899BB),
    sunIntensity: 0.5,
    ambientColor: new THREE.Color(0x8899BB),
    skyColor: new THREE.Color(0x2a3555),
    fogColor: new THREE.Color(0x3a4a66),
    fogDensity: 0.002,
    hemiSkyColor: new THREE.Color(0x7788AA),
    hemiGroundColor: new THREE.Color(0x3a3530),
    hemiIntensity: 0.7,
  },
  {
    hour: 5,
    sunColor: new THREE.Color(0xFF6B35),
    sunIntensity: 0.3,
    ambientColor: new THREE.Color(0xFFB366),
    skyColor: new THREE.Color(0x2a1530),
    fogColor: new THREE.Color(0xE8D5C4),
    fogDensity: 0.015,
    hemiSkyColor: new THREE.Color(0xFFB366),
    hemiGroundColor: new THREE.Color(0x6B5D4F),
    hemiIntensity: 0.30,
  },
  {
    hour: 8,
    sunColor: new THREE.Color(0xFFE4B5),
    sunIntensity: 1.0,
    ambientColor: new THREE.Color(0x87CEEB),
    skyColor: new THREE.Color(0x6BA3C7),
    fogColor: new THREE.Color(0x9BC4E0),
    fogDensity: 0.003,
    hemiSkyColor: new THREE.Color(0x87CEEB),
    hemiGroundColor: new THREE.Color(0x8B7355),
    hemiIntensity: 0.55,
  },
  {
    hour: 11,
    sunColor: new THREE.Color(0xFFFDE7),
    sunIntensity: 1.8,
    ambientColor: new THREE.Color(0x88BBEE),
    skyColor: new THREE.Color(0x78B4D4),
    fogColor: new THREE.Color(0xA0C8E0),
    fogDensity: 0.002,
    hemiSkyColor: new THREE.Color(0x87CEEB),
    hemiGroundColor: new THREE.Color(0x8B7355),
    hemiIntensity: 0.60,
  },
  {
    hour: 14,
    sunColor: new THREE.Color(0xFFFDE7),
    sunIntensity: 5.0,
    ambientColor: new THREE.Color(0x88BBEE),
    skyColor: new THREE.Color(0x78B4D4),
    fogColor: new THREE.Color(0xA0C8E0),
    fogDensity: 0.002,
    hemiSkyColor: new THREE.Color(0x87CEEB),
    hemiGroundColor: new THREE.Color(0x8B7355),
    hemiIntensity: 0.60,
  },
  {
    hour: 17,
    sunColor: new THREE.Color(0xFFE4B5),
    sunIntensity: 1.0,
    ambientColor: new THREE.Color(0x87CEEB),
    skyColor: new THREE.Color(0x6BA3C7),
    fogColor: new THREE.Color(0x9BC4E0),
    fogDensity: 0.003,
    hemiSkyColor: new THREE.Color(0xFF8844),
    hemiGroundColor: new THREE.Color(0x4A3F35),
    hemiIntensity: 0.55,
  },
  {
    hour: 20,
    sunColor: new THREE.Color(0xFF4500),
    sunIntensity: 0.5,
    ambientColor: new THREE.Color(0xCC6633),
    skyColor: new THREE.Color(0x3A1820),
    fogColor: new THREE.Color(0x9B7653),
    fogDensity: 0.004,
    hemiSkyColor: new THREE.Color(0x665544),
    hemiGroundColor: new THREE.Color(0x302820),
    hemiIntensity: 0.45,
  },
  {
    hour: 23,
    sunColor: new THREE.Color(0x8899BB),
    sunIntensity: 0.5,
    ambientColor: new THREE.Color(0x8899BB),
    skyColor: new THREE.Color(0x2a3555),
    fogColor: new THREE.Color(0x3a4a66),
    fogDensity: 0.002,
    hemiSkyColor: new THREE.Color(0x7788AA),
    hemiGroundColor: new THREE.Color(0x3a3530),
    hemiIntensity: 0.7,
  },
  {
    // Wrap sentinel: hour 24 == hour 0 values for seamless interpolation
    hour: 24,
    sunColor: new THREE.Color(0x8899BB),
    sunIntensity: 0.5,
    ambientColor: new THREE.Color(0x8899BB),
    skyColor: new THREE.Color(0x2a3555),
    fogColor: new THREE.Color(0x3a4a66),
    fogDensity: 0.002,
    hemiSkyColor: new THREE.Color(0x7788AA),
    hemiGroundColor: new THREE.Color(0x3a3530),
    hemiIntensity: 0.7,
  },
];

// ---------------------------------------------------------------------------
// Billboard glow shader material (used for torch and window billboards)
// ---------------------------------------------------------------------------

const GLOW_BILLBOARD_VERTEX_SHADER = /* glsl */ `
  uniform float scale;
  varying vec2 vUv;

  void main() {
    vUv = uv;
    // Billboard: always face the camera
    vec4 mvPosition = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    mvPosition.xy += position.xy * scale;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const GLOW_BILLBOARD_FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 glowColor;
  uniform float opacity;
  varying vec2 vUv;

  void main() {
    // Radial gradient: bright center, soft fall-off
    vec2 center = vUv - 0.5;
    float dist = length(center) * 2.0;

    // Smooth radial falloff with a bright core
    float core = 1.0 - smoothstep(0.0, 0.3, dist);
    float halo = 1.0 - smoothstep(0.1, 1.0, dist);
    float alpha = (core * 0.8 + halo * 0.4) * opacity;

    if (alpha < 0.001) discard;

    // Slightly brighter at center
    vec3 col = glowColor * (1.0 + core * 0.5);
    gl_FragColor = vec4(col, alpha);
  }
`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Hermite-style smoothstep: t in [0,1] -> smooth [0,1]
 */
function smoothstep(t) {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
}

/**
 * Find the two bounding keyframes for the given hour and return the lerp
 * factor. Handles 24-hour wrap-around via the sentinel keyframe at hour 24.
 */
function findKeyframePair(hour) {
  const h = ((hour % 24) + 24) % 24; // normalize to [0, 24)
  for (let i = 0; i < TIME_KEYFRAMES.length - 1; i++) {
    const a = TIME_KEYFRAMES[i];
    const b = TIME_KEYFRAMES[i + 1];
    if (h >= a.hour && h < b.hour) {
      const raw = (h - a.hour) / (b.hour - a.hour);
      return { a, b, t: smoothstep(raw) };
    }
  }
  // Fallback (should not normally be reached)
  const last = TIME_KEYFRAMES[TIME_KEYFRAMES.length - 2];
  return { a: last, b: last, t: 0 };
}

/**
 * Lerp a THREE.Color from a to b by t, writing into `out`.
 */
function lerpColorInto(out, a, b, t) {
  out.r = a.r + (b.r - a.r) * t;
  out.g = a.g + (b.g - a.g) * t;
  out.b = a.b + (b.b - a.b) * t;
}

/**
 * Procedurally generate a radial-gradient flame glow texture on a canvas.
 * Returns a THREE.CanvasTexture. Size is 64x64.
 */
function createGlowTexture(colorHex) {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  const cx = size / 2;
  const cy = size / 2;
  const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, cx);

  const color = new THREE.Color(colorHex);
  const r = Math.round(color.r * 255);
  const g = Math.round(color.g * 255);
  const b = Math.round(color.b * 255);

  gradient.addColorStop(0, `rgba(${r},${g},${b},1.0)`);
  gradient.addColorStop(0.15, `rgba(${r},${g},${b},0.85)`);
  gradient.addColorStop(0.4, `rgba(${r},${g},${b},0.35)`);
  gradient.addColorStop(0.7, `rgba(${r},${g},${b},0.08)`);
  gradient.addColorStop(1.0, `rgba(${r},${g},${b},0.0)`);

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.premultiplyAlpha = true;
  return texture;
}

// ---------------------------------------------------------------------------
// Reusable geometry (allocated once, shared by all billboard quads)
// ---------------------------------------------------------------------------

let _sharedBillboardGeometry = null;
function getSharedBillboardGeometry() {
  if (!_sharedBillboardGeometry) {
    _sharedBillboardGeometry = new THREE.PlaneGeometry(1, 1);
  }
  return _sharedBillboardGeometry;
}

// ---------------------------------------------------------------------------
// DayNightCycle class
// ---------------------------------------------------------------------------

export class DayNightCycle {
  /**
   * @param {THREE.Scene} scene
   * @param {Object} options
   * @param {number} [options.shadowMapSize=2048]
   * @param {number} [options.shadowBias=-0.002]
   * @param {number} [options.shadowCameraBounds=50]
   * @param {number} [options.maxActiveTorches=6]
   * @param {number} [options.sunArcRadius=40]
   * @param {number} [options.baseWindAngle=0]
   * @param {number} [options.baseWindStrength=0.3]
   * @param {boolean} [options.enableShadows=true]
   */
  constructor(scene, options = {}) {
    this.scene = scene;
    this._options = {
      shadowMapSize: 2048,
      shadowBias: -0.002,
      shadowCameraBounds: 50,
      maxActiveTorches: 30,
      sunArcRadius: 40,
      baseWindAngle: 0,
      baseWindStrength: 0.3,
      enableShadows: true,
      ...options,
    };

    this._hour = 12;
    this._elapsedTime = 0;

    // --- Torch / window registries ---
    this._nextTorchId = 1;
    this._torches = new Map(); // id -> torchRecord
    this._nextWindowId = 1;
    this._windows = new Map(); // id -> windowRecord

    // --- PointLight pool for torch culling ---
    this._torchLightPool = [];
    for (let i = 0; i < this._options.maxActiveTorches; i++) {
      const pl = new THREE.PointLight(0xFFAA55, 0, 20, 2);
      pl.castShadow = false;
      pl.visible = false;
      this.scene.add(pl);
      this._torchLightPool.push({ light: pl, assignedTorchId: null });
    }

    // --- Cached interpolated state ---
    this._skyColor = new THREE.Color();
    this._fogColor = new THREE.Color();
    this._fogDensity = 0.002;
    this._windDirection = new THREE.Vector3(1, 0, 0);
    this._windStrength = 0.3;

    // Temporary colors for interpolation (avoid allocations per frame)
    this._tmpColorA = new THREE.Color();
    this._tmpColorB = new THREE.Color();

    // --- Initialize lights ---
    this._initLights();

    // Apply initial time
    this.setTime(this._hour);
  }

  // -----------------------------------------------------------------------
  // Properties
  // -----------------------------------------------------------------------

  /** @returns {THREE.DirectionalLight} */
  get sunLight() {
    return this._sun;
  }

  /** @returns {THREE.AmbientLight} */
  get ambientLight() {
    return this._ambient;
  }

  /** @returns {THREE.HemisphereLight} */
  get hemisphereLight() {
    return this._hemisphere;
  }

  /** @returns {number} Current hour 0-24 */
  get currentHour() {
    return this._hour;
  }

  // -----------------------------------------------------------------------
  // Light initialization
  // -----------------------------------------------------------------------

  _initLights() {
    const opts = this._options;

    // --- Sun (DirectionalLight with shadows) ---
    this._sun = new THREE.DirectionalLight(0xFFFDE7, 2.0);
    this._sun.position.set(0, opts.sunArcRadius, 2);
    this._sun.castShadow = opts.enableShadows;

    if (opts.enableShadows) {
      this._sun.shadow.mapSize.width = opts.shadowMapSize;
      this._sun.shadow.mapSize.height = opts.shadowMapSize;
      this._sun.shadow.camera.left = -opts.shadowCameraBounds;
      this._sun.shadow.camera.right = opts.shadowCameraBounds;
      this._sun.shadow.camera.top = opts.shadowCameraBounds;
      this._sun.shadow.camera.bottom = -opts.shadowCameraBounds;
      this._sun.shadow.camera.near = 0.5;
      this._sun.shadow.camera.far = opts.sunArcRadius * 2 + 50;
      this._sun.shadow.bias = opts.shadowBias;
    }

    this._sun.target.position.set(0, 0, 0);
    this.scene.add(this._sun);
    this.scene.add(this._sun.target);

    // --- Ambient light ---
    this._ambient = new THREE.AmbientLight(0x88BBEE, 0.8);
    this.scene.add(this._ambient);

    // --- Hemisphere light ---
    this._hemisphere = new THREE.HemisphereLight(0x87CEEB, 0x8B7355, 0.8);
    this.scene.add(this._hemisphere);
  }

  // -----------------------------------------------------------------------
  // Time control
  // -----------------------------------------------------------------------

  /**
   * Set the time immediately (0-24 float).
   * Updates all lighting, sun position, cached colors, etc.
   */
  setTime(hour) {
    this._hour = ((hour % 24) + 24) % 24;
    this._applyTimeToLighting();
  }

  /**
   * Advance time by dt hours (useful for animation loops).
   */
  advanceTime(dt) {
    this.setTime(this._hour + dt);
  }

  // -----------------------------------------------------------------------
  // Torch & lamp registration
  // -----------------------------------------------------------------------

  /**
   * Register a torch / lamp at the given world position.
   * @param {THREE.Vector3} position
   * @param {Object} [options]
   * @param {number} [options.color=0xFFAA55]
   * @param {number} [options.intensity=2.0]
   * @param {number} [options.radius=20] - PointLight distance
   * @returns {number} torch ID
   */
  registerTorch(position, options = {}) {
    const id = this._nextTorchId++;
    const color = options.color !== undefined ? options.color : 0xFFAA55;
    const intensity = options.intensity !== undefined ? options.intensity : 2.0;
    const radius = options.radius !== undefined ? options.radius : 20;

    // Small sphere mesh for torch flame (constant glow, always visible)
    const sphereGeo = new THREE.SphereGeometry(0.012, 6, 4);
    const sphereMat = new THREE.MeshStandardMaterial({
      color: color,
      emissive: color,
      emissiveIntensity: 0.6,
      roughness: 0.5,
      metalness: 0.0,
    });
    const sphereMesh = new THREE.Mesh(sphereGeo, sphereMat);
    sphereMesh.position.copy(position);
    this.scene.add(sphereMesh);

    const record = {
      id,
      position: position.clone(),
      color,
      baseIntensity: intensity,
      radius,
      sphereMesh,
      billboardMesh: null,
      billboardMat: null,
      currentIntensity: 0,
      isRealLight: false,
    };

    this._torches.set(id, record);
    return id;
  }

  /**
   * Unregister a torch and clean up its resources.
   * @param {number} id
   */
  unregisterTorch(id) {
    const rec = this._torches.get(id);
    if (!rec) return;

    // Free the pool slot if this torch was using one
    for (const slot of this._torchLightPool) {
      if (slot.assignedTorchId === id) {
        slot.light.visible = false;
        slot.light.intensity = 0;
        slot.assignedTorchId = null;
        break;
      }
    }

    // Dispose sphere
    if (rec.sphereMesh) {
      this.scene.remove(rec.sphereMesh);
      rec.sphereMesh.geometry.dispose();
      rec.sphereMesh.material.dispose();
    }

    this._torches.delete(id);
  }

  // -----------------------------------------------------------------------
  // Window glow registration
  // -----------------------------------------------------------------------

  /**
   * Register a window glow point.
   * @param {THREE.Vector3} position - Position just outside the window face.
   * @param {Object} [options]
   * @param {number} [options.color=0xFFCC66]
   * @param {number} [options.intensity=1.0]
   * @returns {number} window ID
   */
  registerWindow(position, options = {}) {
    const id = this._nextWindowId++;
    const color = options.color !== undefined ? options.color : 0xFFCC66;
    const intensity = options.intensity !== undefined ? options.intensity : 1.0;

    // Small warm-colored plane for window light (visible at night, not glowing)
    const windowMat = new THREE.MeshStandardMaterial({
      color: color,
      emissive: color,
      emissiveIntensity: 0.15,
      roughness: 0.8,
      transparent: true,
      opacity: 0,
    });
    const windowMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.2), windowMat);
    windowMesh.position.copy(position);
    this.scene.add(windowMesh);

    const record = {
      id,
      position: position.clone(),
      color,
      baseIntensity: intensity,
      billboardMesh: windowMesh,
      billboardMat: windowMat,
    };

    this._windows.set(id, record);
    return id;
  }

  /**
   * Unregister a window and clean up its resources.
   * @param {number} id
   */
  unregisterWindow(id) {
    const rec = this._windows.get(id);
    if (!rec) return;

    if (rec.billboardMesh) {
      this.scene.remove(rec.billboardMesh);
      if (rec.billboardMat) rec.billboardMat.dispose();
      if (rec.billboardMesh.geometry) rec.billboardMesh.geometry.dispose();
    }

    this._windows.delete(id);
  }

  // -----------------------------------------------------------------------
  // Per-frame update
  // -----------------------------------------------------------------------

  /**
   * Call every frame.
   * @param {number} deltaTime - Seconds since last frame
   * @param {THREE.Vector3} cameraPosition
   */
  update(deltaTime, cameraPosition) {
    this._elapsedTime += deltaTime;

    // 1. Sun position, color, intensity from current hour
    this._updateSunPosition();
    this._applyTimeToLighting();

    // 2. Shadow camera tracks sun
    this._updateShadowCamera();

    // 3. Torch flicker + culling
    this._updateTorches(deltaTime, cameraPosition);

    // 4. Window glow
    this._updateWindows();

    // 5. Wind
    this._updateWind();
  }

  // -----------------------------------------------------------------------
  // Sky / fog / wind queries
  // -----------------------------------------------------------------------

  /** @returns {THREE.Color} current interpolated sky color (clone) */
  getSkyColor() {
    return this._skyColor.clone();
  }

  /** @returns {THREE.Color} current interpolated fog color (clone) */
  getFogColor() {
    return this._fogColor.clone();
  }

  /** @returns {number} current exponential fog density */
  getFogDensity() {
    return this._fogDensity;
  }

  /**
   * Wind direction as a normalized THREE.Vector3 (in the XZ plane).
   * @returns {THREE.Vector3}
   */
  getSunDirection() {
    if (!this._sun) return new THREE.Vector3(0, 1, 0);
    return this._sun.position.clone().normalize();
  }

  getWindDirection() {
    return this._windDirection.clone();
  }

  /**
   * Wind strength (scalar, roughly 0-1 range).
   * @returns {number}
   */
  getWindStrength() {
    return this._windStrength;
  }

  // -----------------------------------------------------------------------
  // Dispose
  // -----------------------------------------------------------------------

  dispose() {
    // Unregister all torches
    for (const id of [...this._torches.keys()]) {
      this.unregisterTorch(id);
    }

    // Unregister all windows
    for (const id of [...this._windows.keys()]) {
      this.unregisterWindow(id);
    }

    // Dispose torch light pool
    for (const slot of this._torchLightPool) {
      this.scene.remove(slot.light);
      slot.light.dispose();
    }
    this._torchLightPool.length = 0;

    // Dispose main lights
    if (this._sun) {
      this.scene.remove(this._sun);
      this.scene.remove(this._sun.target);
      if (this._sun.shadow && this._sun.shadow.map) {
        this._sun.shadow.map.dispose();
      }
    }
    if (this._ambient) {
      this.scene.remove(this._ambient);
    }
    if (this._hemisphere) {
      this.scene.remove(this._hemisphere);
    }

    this._sun = null;
    this._ambient = null;
    this._hemisphere = null;
  }

  // -----------------------------------------------------------------------
  // Private: sun position arc
  // -----------------------------------------------------------------------

  _updateSunPosition() {
    const hour = this._hour;
    const radius = this._options.sunArcRadius;

    // Sun arc: angle 0 at 6 AM (horizon east), PI at 6 PM (horizon west)
    const sunAngle = ((hour - 6) / 12) * Math.PI;

    this._sun.position.set(
      Math.cos(sunAngle) * radius,
      Math.sin(sunAngle) * radius,
      2
    );

    this._sun.target.position.set(0, 0, 0);
    this._sun.target.updateMatrixWorld();
  }

  // -----------------------------------------------------------------------
  // Private: apply keyframe-interpolated lighting
  // -----------------------------------------------------------------------

  _applyTimeToLighting() {
    const { a, b, t } = findKeyframePair(this._hour);

    // Sun color + intensity
    lerpColorInto(this._sun.color, a.sunColor, b.sunColor, t);
    this._sun.intensity = a.sunIntensity + (b.sunIntensity - a.sunIntensity) * t;

    // Ambient
    lerpColorInto(this._ambient.color, a.ambientColor, b.ambientColor, t);
    // Ambient intensity: derive from keyframe ambient brightness
    const ambIntA = 0.5 + a.sunIntensity * 0.3;
    const ambIntB = 0.5 + b.sunIntensity * 0.3;
    this._ambient.intensity = ambIntA + (ambIntB - ambIntA) * t;

    // Hemisphere
    lerpColorInto(this._hemisphere.color, a.hemiSkyColor, b.hemiSkyColor, t);
    lerpColorInto(this._hemisphere.groundColor, a.hemiGroundColor, b.hemiGroundColor, t);
    this._hemisphere.intensity = a.hemiIntensity + (b.hemiIntensity - a.hemiIntensity) * t;

    // Sky
    lerpColorInto(this._skyColor, a.skyColor, b.skyColor, t);

    // Fog
    lerpColorInto(this._fogColor, a.fogColor, b.fogColor, t);
    this._fogDensity = a.fogDensity + (b.fogDensity - a.fogDensity) * t;
  }

  // -----------------------------------------------------------------------
  // Private: shadow camera tracks sun
  // -----------------------------------------------------------------------

  _updateShadowCamera() {
    if (!this._options.enableShadows) return;
    // The shadow camera is already configured with large ortho bounds.
    // Just make sure the projection is up-to-date after sun moves.
    this._sun.shadow.camera.updateProjectionMatrix();
  }

  // -----------------------------------------------------------------------
  // Private: torch flicker, culling, billboard update
  // -----------------------------------------------------------------------

  _updateTorches(deltaTime, cameraPosition) {
    const hour = this._hour;

    // --- Torch activation: on at night, off during the day ---
    let torchActivation = 0;
    if (hour >= 17 && hour < 20) {
      torchActivation = (hour - 17) / 3; // fade in over 17-20
    } else if (hour >= 20 || hour < 5) {
      torchActivation = 1.0; // fully lit at night
    } else if (hour >= 5 && hour < 7) {
      torchActivation = 1.0 - (hour - 5) / 2; // fade out over 5-7
    }

    for (const [, rec] of this._torches) {
      // PointLight intensity follows day/night, no flicker
      rec.currentIntensity = rec.baseIntensity * torchActivation;

      // Sphere (bulb) is always visible at constant size — no flicker, no scaling
      if (rec.sphereMesh) {
        rec.sphereMesh.visible = true;
      }
    }

    // --- Cull: assign the N nearest torches to real PointLights ---
    if (!cameraPosition) {
      // No camera info; keep existing assignments
      this._updatePoolIntensities();
      return;
    }

    // Build sorted list by distance to camera
    const sorted = [];
    for (const [, rec] of this._torches) {
      const distSq = rec.position.distanceToSquared(cameraPosition);
      sorted.push({ rec, distSq });
    }
    sorted.sort((a, b) => a.distSq - b.distSq);

    // Determine which torches get real lights
    const realSet = new Set();
    const maxReal = this._options.maxActiveTorches;
    for (let i = 0; i < Math.min(sorted.length, maxReal); i++) {
      realSet.add(sorted[i].rec.id);
    }

    // First pass: release pool slots whose torch is no longer in realSet
    for (const slot of this._torchLightPool) {
      if (slot.assignedTorchId !== null && !realSet.has(slot.assignedTorchId)) {
        slot.light.visible = false;
        slot.light.intensity = 0;
        const oldRec = this._torches.get(slot.assignedTorchId);
        if (oldRec) oldRec.isRealLight = false;
        slot.assignedTorchId = null;
      }
    }

    // Second pass: assign free pool slots to torches that need one
    for (const torchId of realSet) {
      const rec = this._torches.get(torchId);
      if (!rec) continue;

      // Already assigned?
      let alreadyAssigned = false;
      for (const slot of this._torchLightPool) {
        if (slot.assignedTorchId === torchId) {
          alreadyAssigned = true;
          break;
        }
      }
      if (alreadyAssigned) continue;

      // Find a free slot
      for (const slot of this._torchLightPool) {
        if (slot.assignedTorchId === null) {
          slot.assignedTorchId = torchId;
          slot.light.position.copy(rec.position);
          slot.light.color.setHex(rec.color);
          slot.light.distance = rec.radius;
          slot.light.visible = true;
          rec.isRealLight = true;
          break;
        }
      }
    }

    // Third pass: update pool light intensities
    this._updatePoolIntensities();
  }

  _updatePoolIntensities() {
    for (const slot of this._torchLightPool) {
      if (slot.assignedTorchId === null) continue;
      const rec = this._torches.get(slot.assignedTorchId);
      if (!rec) {
        slot.assignedTorchId = null;
        slot.light.visible = false;
        continue;
      }
      slot.light.intensity = rec.currentIntensity;
      // In case torch moved, update position
      slot.light.position.copy(rec.position);
    }
  }

  // -----------------------------------------------------------------------
  // Private: window glow
  // -----------------------------------------------------------------------

  _updateWindows() {
    const hour = this._hour;

    // Window glow opacity ramp:
    // - Fade in from hour 18 to 20 (opacity 0 -> 1)
    // - Full brightness 20 to 5
    // - Fade out from hour 5 to 7 (opacity 1 -> 0)
    // - Off from 7 to 18
    let windowOpacity = 0;
    if (hour >= 18 && hour < 20) {
      windowOpacity = (hour - 18) / 2;
    } else if (hour >= 20 || hour < 5) {
      windowOpacity = 1.0;
    } else if (hour >= 5 && hour < 7) {
      windowOpacity = 1.0 - (hour - 5) / 2;
    }

    for (const [, rec] of this._windows) {
      if (rec.billboardMat) {
        rec.billboardMat.opacity = windowOpacity * rec.baseIntensity * 0.5;
        rec.billboardMat.emissiveIntensity = windowOpacity * 0.15;
      }
      if (rec.billboardMesh) {
        rec.billboardMesh.visible = windowOpacity > 0.01;
      }
    }
  }

  // -----------------------------------------------------------------------
  // Private: wind simulation
  // -----------------------------------------------------------------------

  _updateWind() {
    const time = this._elapsedTime;
    const base = this._options.baseWindAngle;
    const baseStr = this._options.baseWindStrength;

    const windAngle = base
      + 0.3 * Math.sin(time * 0.1)
      + 0.1 * Math.sin(time * 0.37);

    this._windDirection.set(
      Math.cos(windAngle),
      0,
      Math.sin(windAngle)
    ).normalize();

    this._windStrength = baseStr * (0.7 + 0.3 * Math.sin(time * 0.15));
  }
}
