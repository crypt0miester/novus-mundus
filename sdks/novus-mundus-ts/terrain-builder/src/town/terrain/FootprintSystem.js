/**
 * FootprintSystem -- Render-to-texture footprint/trail overlay for terrain.
 *
 * Maintains a dynamic "footprint map" as a pair of ping-pong WebGLRenderTargets.
 * NPCs stamp boot-print shapes; carts stamp continuous wheel-track lines.
 * Every frame a fade pass multiplies all pixels by a configurable decay rate
 * so prints gradually vanish.
 *
 * Channel encoding:
 *   R = diffuse darkening  (0 = none, 1 = full darken)
 *   G = roughness change   (0 = none, 1 = full smooth)
 *   B = indent depth       (0 = none, 1 = full indent)
 *   A = unused (always 1)
 *
 * Integration (BiomeShader side):
 *   vec2 fpUV = (worldPos.xz - uFootprintOffset) * uFootprintScale;
 *   vec4 fp  = texture2D(uFootprintMap, fpUV);
 *   color   *= mix(1.0, 0.78, fp.r);
 *   roughness = mix(roughness, 0.4, fp.g * 0.5);
 *   // fp.b for vertex displacement indent
 */

import * as THREE from 'three';

// ---------------------------------------------------------------------------
// GLSL -- Fade pass (full-screen triangle)
// ---------------------------------------------------------------------------

const FADE_VERTEX = /* glsl */ `
precision highp float;
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const FADE_FRAGMENT = /* glsl */ `
precision highp float;
uniform sampler2D uSource;
uniform float uFadeRate;
varying vec2 vUv;
void main() {
  vec4 c = texture2D(uSource, vUv);
  gl_FragColor = vec4(c.rgb * uFadeRate, 1.0);
}
`;

// ---------------------------------------------------------------------------
// GLSL -- Footprint stamp (boot-print: heel ellipse + toe ellipse)
// ---------------------------------------------------------------------------

const STAMP_VERTEX = /* glsl */ `
precision highp float;
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const STAMP_FRAGMENT = /* glsl */ `
precision highp float;

uniform vec2 uCenter;      // stamp center in UV space [0,1]
uniform float uRotation;   // radians
uniform float uSize;       // half-extent of the stamp in UV space
uniform float uDarken;     // R channel intensity
uniform float uRoughness;  // G channel intensity
uniform float uIndent;     // B channel intensity
uniform sampler2D uStampTex;
uniform float uHasStampTex;

varying vec2 vUv;

/**
 * Evaluate a single ellipse SDF in local stamp space.
 * Returns 0.0 outside, 1.0 inside, with smooth edge.
 */
float ellipse(vec2 p, vec2 center, vec2 radii) {
  vec2 d = (p - center) / radii;
  float dist = dot(d, d);
  return 1.0 - smoothstep(0.8, 1.0, dist);
}

void main() {
  // Transform fragment UV into stamp-local coordinates [-1,1] around uCenter
  vec2 diff = (vUv - uCenter) / uSize;

  // Apply inverse rotation
  float cs = cos(-uRotation);
  float sn = sin(-uRotation);
  vec2 local = vec2(
    diff.x * cs - diff.y * sn,
    diff.x * sn + diff.y * cs
  );

  // Discard early if clearly outside bounding box
  if (abs(local.x) > 1.2 || abs(local.y) > 1.6) discard;

  // Boot-print: heel is a wider, rounder ellipse at the back;
  // toe is a narrower ellipse at the front.
  // "forward" is +Y in local space.

  // Heel ellipse: centered at y = -0.45, radii (0.42, 0.50)
  float heel = ellipse(local, vec2(0.0, -0.45), vec2(0.42, 0.50));

  // Toe ellipse: centered at y = +0.45, radii (0.36, 0.44)
  float toe = ellipse(local, vec2(0.0, 0.45), vec2(0.36, 0.44));

  // Arch cutout: a gentle inner ellipse subtracted to create the boot shape
  float arch = ellipse(local, vec2(0.15, 0.0), vec2(0.22, 0.38));

  float shape = max(heel, toe);
  shape = clamp(shape - arch * 0.55, 0.0, 1.0);

  // Blend with stamp texture when available for more realistic boot print
  if (uHasStampTex > 0.5) {
    vec2 texUV = local * 0.5 + 0.5; // Map [-1,1] to [0,1]
    float texShape = texture2D(uStampTex, texUV).r;
    shape = mix(shape, shape * texShape, 0.6);
  }

  if (shape < 0.001) discard;

  gl_FragColor = vec4(
    shape * uDarken,
    shape * uRoughness,
    shape * uIndent,
    1.0
  );
}
`;

// ---------------------------------------------------------------------------
// GLSL -- Track stamp (thick line segment with dual ruts in UV space)
// ---------------------------------------------------------------------------

const TRACK_VERTEX = /* glsl */ `
precision highp float;
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const TRACK_FRAGMENT = /* glsl */ `
precision highp float;

uniform vec2 uA;          // segment start in UV [0,1]
uniform vec2 uB;          // segment end in UV [0,1]
uniform float uWidth;     // half-width in UV space
uniform float uDarken;
uniform float uRoughness;
uniform float uIndent;

varying vec2 vUv;

float segmentSDF(vec2 p, vec2 a, vec2 b) {
  vec2 ab = b - a;
  float len2 = dot(ab, ab);
  if (len2 < 1e-10) return length(p - a);
  float t = clamp(dot(p - a, ab) / len2, 0.0, 1.0);
  vec2 proj = a + t * ab;
  return length(p - proj);
}

void main() {
  // Overall bounding check against the full segment width
  float dFull = segmentSDF(vUv, uA, uB);
  if (dFull > uWidth * 1.5) discard;

  // Compute perpendicular direction to the segment
  vec2 ab = uB - uA;
  float len2 = dot(ab, ab);
  vec2 perp = vec2(0.0);
  if (len2 > 1e-10) {
    vec2 dir = normalize(ab);
    perp = vec2(-dir.y, dir.x);
  }

  // Cart tracks: two parallel ruts offset from the center line
  float rutOffset = uWidth * 0.65;
  float d1 = segmentSDF(vUv, uA + perp * rutOffset, uB + perp * rutOffset);
  float d2 = segmentSDF(vUv, uA - perp * rutOffset, uB - perp * rutOffset);

  float rutWidth = uWidth * 0.35;
  float rut1 = 1.0 - smoothstep(rutWidth * 0.6, rutWidth, d1);
  float rut2 = 1.0 - smoothstep(rutWidth * 0.6, rutWidth, d2);

  float ruts = max(rut1, rut2);

  // Between the ruts: slight raised center with reduced intensity
  float centerBand = 1.0 - smoothstep(uWidth * 0.7, uWidth, dFull);
  float center = centerBand * (1.0 - ruts) * 0.3;
  float combined = max(ruts, center);

  if (combined < 0.001) discard;

  gl_FragColor = vec4(
    combined * uDarken,
    combined * uRoughness,
    combined * uIndent,
    1.0
  );
}
`;

// ---------------------------------------------------------------------------
// Helper: create a full-screen triangle (more efficient than a quad --
// single triangle with vertices at (-1,-1), (3,-1), (-1,3) covers the
// entire [-1,1] clip-space region with no overdraw at the diagonal seam)
// ---------------------------------------------------------------------------

function createFullscreenTriangle() {
  const geometry = new THREE.BufferGeometry();
  const vertices = new Float32Array([
    -1, -1, 0,
     3, -1, 0,
    -1,  3, 0
  ]);
  const uvs = new Float32Array([
    0, 0,
    2, 0,
    0, 2
  ]);
  geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  return geometry;
}

// ---------------------------------------------------------------------------
// FootprintSystem
// ---------------------------------------------------------------------------

class FootprintSystem {
  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {object} [options]
   * @param {number} [options.resolution=256]   Texture resolution (px)
   * @param {number} [options.worldSize=5.0]    World-space extent covered (square)
   * @param {number} [options.fadeRate=0.995]    Per-frame multiplicative decay
   */
  constructor(renderer, options = {}) {
    this._renderer = renderer;

    this._resolution = options.resolution ?? 256;
    this._worldSize = options.worldSize ?? 5.0;
    this._fadeRate = options.fadeRate ?? 0.995;

    // Track which render target is the "current" readable one.
    // After update(), _currentIndex points to the target that was written to.
    this._currentIndex = 0;

    // Ping-pong render targets
    this._targets = [
      this._createTarget(),
      this._createTarget()
    ];

    // Clear both targets to black
    this._clearTargets();

    // Orthographic camera for fullscreen passes (NDC identity)
    this._orthoCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    // Full-screen geometry shared by all passes
    this._fsGeometry = createFullscreenTriangle();

    // ---- Fade material ----
    this._fadeMaterial = new THREE.ShaderMaterial({
      vertexShader: FADE_VERTEX,
      fragmentShader: FADE_FRAGMENT,
      uniforms: {
        uSource: { value: null },
        uFadeRate: { value: this._fadeRate }
      },
      depthTest: false,
      depthWrite: false
    });

    // ---- Footprint stamp material (additive blending) ----
    this._stampMaterial = new THREE.ShaderMaterial({
      vertexShader: STAMP_VERTEX,
      fragmentShader: STAMP_FRAGMENT,
      uniforms: {
        uCenter: { value: new THREE.Vector2() },
        uRotation: { value: 0 },
        uSize: { value: 0.02 },
        uDarken: { value: 0.85 },
        uRoughness: { value: 0.6 },
        uIndent: { value: 0.4 },
        uStampTex: { value: null },
        uHasStampTex: { value: 0.0 },
      },
      depthTest: false,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      transparent: true
    });

    // ---- Track stamp material (additive blending) ----
    this._trackMaterial = new THREE.ShaderMaterial({
      vertexShader: TRACK_VERTEX,
      fragmentShader: TRACK_FRAGMENT,
      uniforms: {
        uA: { value: new THREE.Vector2() },
        uB: { value: new THREE.Vector2() },
        uWidth: { value: 0.015 },
        uDarken: { value: 0.7 },
        uRoughness: { value: 0.8 },
        uIndent: { value: 0.55 }
      },
      depthTest: false,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      transparent: true
    });

    // Meshes for rendering (one per material)
    this._fadeMesh = new THREE.Mesh(this._fsGeometry, this._fadeMaterial);
    this._fadeMesh.frustumCulled = false;

    this._stampMesh = new THREE.Mesh(this._fsGeometry, this._stampMaterial);
    this._stampMesh.frustumCulled = false;

    this._trackMesh = new THREE.Mesh(this._fsGeometry, this._trackMaterial);
    this._trackMesh.frustumCulled = false;

    // Tiny scene used for all RTT passes
    this._scene = new THREE.Scene();

    // Pending stamps queued between update() calls
    this._pendingFootprints = [];
    this._pendingTracks = [];
  }

  // -----------------------------------------------------------------------
  // Render target creation / management
  // -----------------------------------------------------------------------

  /** @returns {THREE.WebGLRenderTarget} */
  _createTarget() {
    return new THREE.WebGLRenderTarget(this._resolution, this._resolution, {
      format: THREE.RGBAFormat,
      type: THREE.FloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      depthBuffer: false,
      stencilBuffer: false
    });
  }

  /** Clear both ping-pong targets to black. */
  _clearTargets() {
    const renderer = this._renderer;
    const savedTarget = renderer.getRenderTarget();
    const savedClearColor = new THREE.Color();
    renderer.getClearColor(savedClearColor);
    const savedClearAlpha = renderer.getClearAlpha();

    renderer.setClearColor(0x000000, 1);
    for (let i = 0; i < 2; i++) {
      renderer.setRenderTarget(this._targets[i]);
      renderer.clear(true, false, false);
    }

    renderer.setClearColor(savedClearColor, savedClearAlpha);
    renderer.setRenderTarget(savedTarget);
  }

  // -----------------------------------------------------------------------
  // World-space <-> UV-space conversion
  // -----------------------------------------------------------------------

  /**
   * Convert world XZ to footprint UV [0,1].
   * World origin (0,0) maps to UV (0.5, 0.5).
   * @param {number} x
   * @param {number} z
   * @returns {THREE.Vector2}
   */
  _worldToUV(x, z) {
    const half = this._worldSize * 0.5;
    return new THREE.Vector2(
      (x + half) / this._worldSize,
      (z + half) / this._worldSize
    );
  }

  /**
   * Convert a world-space distance to UV-space distance.
   * @param {number} d
   * @returns {number}
   */
  _worldToUVScale(d) {
    return d / this._worldSize;
  }

  // -----------------------------------------------------------------------
  // Public: stamp a single footprint
  // -----------------------------------------------------------------------

  /**
   * Queue a single boot-print stamp at world position (x, z).
   * @param {number} x        World X
   * @param {number} z        World Z
   * @param {number} rotation Radians, heading direction
   * @param {number} [size=0.02] World-space half-extent of the print
   */
  stampFootprint(x, z, rotation, size = 0.02) {
    this._pendingFootprints.push({ x, z, rotation, size });
  }

  // -----------------------------------------------------------------------
  // Public: stamp a footprint pair (left/right foot along heading)
  // -----------------------------------------------------------------------

  /**
   * Stamp a single left or right foot offset from the walk line.
   * Call alternately with 'left' and 'right' as the NPC walks.
   *
   * @param {number} x       World X center of the stride
   * @param {number} z       World Z center of the stride
   * @param {number} heading Radians, direction of travel
   * @param {number} stride  World-space forward offset per step (unused for
   *                          position -- the caller is responsible for advancing
   *                          x,z each step; this is accepted for API symmetry)
   * @param {'left'|'right'} side Which foot
   */
  stampFootprintPair(x, z, heading, stride, side) {
    const lateralOffset = 0.012; // half the stance width in world units
    const sign = side === 'left' ? -1 : 1;

    // Perpendicular direction (rotate heading 90 degrees)
    const px = -Math.sin(heading) * lateralOffset * sign;
    const pz = Math.cos(heading) * lateralOffset * sign;

    // Slight toe-out rotation for natural gait (~8.6 degrees)
    const toeOut = sign * 0.15;

    this.stampFootprint(
      x + px,
      z + pz,
      heading + toeOut,
      0.018
    );
  }

  // -----------------------------------------------------------------------
  // Public: stamp a cart wheel track segment
  // -----------------------------------------------------------------------

  /**
   * Queue a wheel-track line segment from (x1,z1) to (x2,z2).
   * @param {number} x1
   * @param {number} z1
   * @param {number} x2
   * @param {number} z2
   * @param {number} [width=0.015] World-space width of the track
   */
  stampTrack(x1, z1, x2, z2, width = 0.015) {
    this._pendingTracks.push({ x1, z1, x2, z2, width });
  }

  // -----------------------------------------------------------------------
  // Public: per-frame update (fade + flush queued stamps)
  // -----------------------------------------------------------------------

  /**
   * Call once per frame. Runs the fade pass and flushes all queued stamps
   * into the footprint render target.
   */
  update() {
    const renderer = this._renderer;

    // Save renderer state
    const savedTarget = renderer.getRenderTarget();
    const savedAutoClear = renderer.autoClear;
    renderer.autoClear = false;

    const src = this._targets[this._currentIndex];
    const dst = this._targets[1 - this._currentIndex];

    // ---- 1. Fade pass: read src, write faded result to dst ----
    this._fadeMaterial.uniforms.uSource.value = src.texture;
    this._fadeMaterial.uniforms.uFadeRate.value = this._fadeRate;

    this._scene.children.length = 0;
    this._scene.add(this._fadeMesh);

    renderer.setRenderTarget(dst);
    renderer.clear(true, false, false);
    renderer.render(this._scene, this._orthoCamera);

    // ---- 2. Stamp footprints onto dst (additive over faded image) ----
    if (this._pendingFootprints.length > 0) {
      this._scene.children.length = 0;
      this._scene.add(this._stampMesh);

      for (let i = 0; i < this._pendingFootprints.length; i++) {
        const fp = this._pendingFootprints[i];
        const uv = this._worldToUV(fp.x, fp.z);
        const uvSize = this._worldToUVScale(fp.size);

        this._stampMaterial.uniforms.uCenter.value.copy(uv);
        this._stampMaterial.uniforms.uRotation.value = fp.rotation;
        this._stampMaterial.uniforms.uSize.value = uvSize;

        renderer.setRenderTarget(dst);
        renderer.render(this._scene, this._orthoCamera);
      }

      this._pendingFootprints.length = 0;
    }

    // ---- 3. Stamp tracks onto dst (additive over faded image) ----
    if (this._pendingTracks.length > 0) {
      this._scene.children.length = 0;
      this._scene.add(this._trackMesh);

      for (let i = 0; i < this._pendingTracks.length; i++) {
        const tk = this._pendingTracks[i];
        const uvA = this._worldToUV(tk.x1, tk.z1);
        const uvB = this._worldToUV(tk.x2, tk.z2);
        const uvWidth = this._worldToUVScale(tk.width);

        this._trackMaterial.uniforms.uA.value.copy(uvA);
        this._trackMaterial.uniforms.uB.value.copy(uvB);
        this._trackMaterial.uniforms.uWidth.value = uvWidth;

        renderer.setRenderTarget(dst);
        renderer.render(this._scene, this._orthoCamera);
      }

      this._pendingTracks.length = 0;
    }

    // ---- 4. Flip ping-pong: dst is now the readable target ----
    this._currentIndex = 1 - this._currentIndex;

    // Restore renderer state
    this._scene.children.length = 0;
    renderer.setRenderTarget(savedTarget);
    renderer.autoClear = savedAutoClear;
  }

  // -----------------------------------------------------------------------
  // Public: accessors
  // -----------------------------------------------------------------------

  /**
   * Returns the current footprint texture for use in the terrain shader.
   * Bind this to the `uFootprintMap` uniform.
   * @returns {THREE.Texture}
   */
  getTexture() {
    // After update(), _currentIndex was flipped to point at dst (the one we
    // just wrote to), so this is the freshest data.
    return this._targets[this._currentIndex].texture;
  }

  /**
   * Returns the UV transform parameters for mapping world XZ coordinates
   * to footprint texture UVs.
   *
   * Usage in shader:
   *   vec2 fpUV = (worldPos.xz - uFootprintOffset) * uFootprintScale;
   *
   * @returns {{ offsetX: number, offsetZ: number, scaleX: number, scaleZ: number }}
   */
  getUVTransform() {
    const half = this._worldSize * 0.5;
    const invSize = 1.0 / this._worldSize;
    return {
      offsetX: -half,
      offsetZ: -half,
      scaleX: invSize,
      scaleZ: invSize
    };
  }

  // -----------------------------------------------------------------------
  // Public: set stamp texture for more realistic footprints
  // -----------------------------------------------------------------------

  /**
   * Set a texture to modulate the procedural boot-print SDF.
   * @param {THREE.Texture} tex - Stamp texture (greyscale, R channel used)
   */
  setStampTexture(tex) {
    if (!tex) return;
    this._stampMaterial.uniforms.uStampTex.value = tex;
    this._stampMaterial.uniforms.uHasStampTex.value = 1.0;
  }

  // -----------------------------------------------------------------------
  // Public: resize the coverage area
  // -----------------------------------------------------------------------

  /**
   * Change the world-space area covered by the footprint map.
   * Clears all existing footprints.
   * @param {number} worldSize New world-space extent (square)
   */
  resize(worldSize) {
    this._worldSize = worldSize;
    this._clearTargets();
  }

  // -----------------------------------------------------------------------
  // Public: cleanup
  // -----------------------------------------------------------------------

  /** Dispose all GPU resources. Call when the system is no longer needed. */
  dispose() {
    this._targets[0].dispose();
    this._targets[1].dispose();
    this._fsGeometry.dispose();
    this._fadeMaterial.dispose();
    this._stampMaterial.dispose();
    this._trackMaterial.dispose();
    this._pendingFootprints.length = 0;
    this._pendingTracks.length = 0;
  }
}

export { FootprintSystem };
