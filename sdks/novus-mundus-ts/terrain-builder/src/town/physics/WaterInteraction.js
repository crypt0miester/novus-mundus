/**
 * Water interaction system — boat bobbing + GPGPU ripple propagation.
 *
 * Boats sample Gerstner wave height at three hull points (bow, port,
 * starboard) and derive a tilt quaternion from the resulting triangle normal.
 *
 * Ripples use the 2D wave equation solved on a ping-pong pair of float
 * render targets.  Fish jumps, clicks, or boat wakes write a bright spike
 * into the heightmap; the shader propagates it outward each frame.
 *
 * The ripple texture is exposed for the water surface shader to sample
 * (additive displacement on top of Gerstner).
 */

import * as THREE from 'three';

// ---------------------------------------------------------------------------
// GLSL — wave equation propagation (ping-pong)
// ---------------------------------------------------------------------------

const PROPAGATION_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const PROPAGATION_FRAGMENT = /* glsl */ `
uniform sampler2D currentState;
uniform sampler2D previousState;
uniform float damping;
uniform float speed;
uniform vec2 resolution;

varying vec2 vUv;

void main() {
  vec2 texel = 1.0 / resolution;

  float current  = texture2D(currentState, vUv).r;
  float previous = texture2D(previousState, vUv).r;

  float left  = texture2D(currentState, vUv + vec2(-texel.x, 0.0)).r;
  float right = texture2D(currentState, vUv + vec2( texel.x, 0.0)).r;
  float up    = texture2D(currentState, vUv + vec2(0.0,  texel.y)).r;
  float down  = texture2D(currentState, vUv + vec2(0.0, -texel.y)).r;

  // 2D wave equation:  next = 2*current - previous + c^2 * laplacian
  float next = 2.0 * current - previous + speed * speed * (left + right + up + down - 4.0 * current);
  next *= damping;

  gl_FragColor = vec4(next, 0.0, 0.0, 1.0);
}
`;

// ---------------------------------------------------------------------------
// GLSL — ripple spike injection
// ---------------------------------------------------------------------------

const SPIKE_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const SPIKE_FRAGMENT = /* glsl */ `
uniform sampler2D inputTex;
uniform vec2 spikeUV;
uniform float spikeStrength;
uniform float spikeRadius;
uniform vec2 resolution;

varying vec2 vUv;

void main() {
  float existing = texture2D(inputTex, vUv).r;
  float dist = length((vUv - spikeUV) * resolution) / resolution.x;
  float spike = spikeStrength * exp(-dist * dist / (2.0 * spikeRadius * spikeRadius));
  gl_FragColor = vec4(existing + spike, 0.0, 0.0, 1.0);
}
`;

// ---------------------------------------------------------------------------
// Reusable temporaries
// ---------------------------------------------------------------------------

const _v3a = new THREE.Vector3();
const _v3b = new THREE.Vector3();
const _v3c = new THREE.Vector3();
const _ab  = new THREE.Vector3();
const _ac  = new THREE.Vector3();
const _up  = new THREE.Vector3(0, 1, 0);
const _quat = new THREE.Quaternion();
const _mat4 = new THREE.Matrix4();

// ---------------------------------------------------------------------------
// WaterInteraction
// ---------------------------------------------------------------------------

export class WaterInteraction {

  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {object} [options]
   * @param {number} [options.resolution=256]   ripple texture resolution
   * @param {number} [options.damping=0.995]    wave damping per frame
   * @param {number} [options.speed=0.5]        wave propagation speed constant
   * @param {number} [options.worldSize=20]     world-space extent of the ripple domain
   */
  constructor(renderer, options = {}) {
    this._renderer = renderer;

    const res  = options.resolution ?? 256;
    this._res  = res;
    this._damping   = options.damping ?? 0.995;
    this._speed     = options.speed   ?? 0.5;
    this._worldSize = options.worldSize ?? 20;

    // Ping-pong float render targets ----------------------------------------
    const rtOpts = {
      type:      THREE.FloatType,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      format:    THREE.RGBAFormat,
      depthBuffer:   false,
      stencilBuffer: false,
    };
    this._rtA = new THREE.WebGLRenderTarget(res, res, rtOpts);
    this._rtB = new THREE.WebGLRenderTarget(res, res, rtOpts);

    // Which target is "current" vs "previous"
    this._current  = this._rtA;
    this._previous = this._rtB;

    // Full-screen quad scene for GPGPU passes --------------------------------
    this._scene  = new THREE.Scene();
    this._camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    const quadGeo = new THREE.PlaneGeometry(2, 2);

    // Propagation material
    this._propagationMat = new THREE.ShaderMaterial({
      uniforms: {
        currentState:  { value: null },
        previousState: { value: null },
        damping:       { value: this._damping },
        speed:         { value: this._speed },
        resolution:    { value: new THREE.Vector2(res, res) },
      },
      vertexShader:   PROPAGATION_VERTEX,
      fragmentShader: PROPAGATION_FRAGMENT,
      depthTest:  false,
      depthWrite: false,
    });

    // Spike injection material
    this._spikeMat = new THREE.ShaderMaterial({
      uniforms: {
        inputTex:      { value: null },
        spikeUV:       { value: new THREE.Vector2() },
        spikeStrength: { value: 0 },
        spikeRadius:   { value: 0.02 },
        resolution:    { value: new THREE.Vector2(res, res) },
      },
      vertexShader:   SPIKE_VERTEX,
      fragmentShader: SPIKE_FRAGMENT,
      depthTest:  false,
      depthWrite: false,
    });

    this._quad = new THREE.Mesh(quadGeo, this._propagationMat);
    this._scene.add(this._quad);

    // Pending ripples to inject before the next propagation step
    /** @type {Array<{u: number, v: number, strength: number}>} */
    this._pendingRipples = [];

    // Boats -----------------------------------------------------------------
    /** @type {Map<string, BoatEntry>} */
    this._boats = new Map();
    this._nextBoatId = 0;

    // Clear both targets to zero -------------------------------------------
    this._clearTarget(this._rtA);
    this._clearTarget(this._rtB);
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /** Clear a render target to black. */
  _clearTarget(rt) {
    const renderer = this._renderer;
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(rt);
    renderer.clearColor();
    renderer.setRenderTarget(prev);
  }

  /**
   * Convert a world XZ position to UV coordinates in the ripple domain.
   * The domain is centered at origin, spanning [-worldSize/2, worldSize/2].
   * @param {number} x
   * @param {number} z
   * @returns {{u: number, v: number}}
   */
  _worldToUV(x, z) {
    const half = this._worldSize * 0.5;
    return {
      u: (x + half) / this._worldSize,
      v: (z + half) / this._worldSize,
    };
  }

  // -------------------------------------------------------------------------
  // Boat registration
  // -------------------------------------------------------------------------

  /**
   * Register a floating object (boat, raft, debris).
   *
   * @param {THREE.Object3D} mesh
   * @param {object} waterSystem  Must implement getWaveHeight(x, z) → number
   * @param {object} [options]
   * @param {THREE.Vector3} [options.bow]        local offset of bow sample point
   * @param {THREE.Vector3} [options.port]       local offset of port sample point
   * @param {THREE.Vector3} [options.starboard]  local offset of starboard sample point
   * @param {string}        [options.id]
   * @returns {string} boatId
   */
  registerBoat(mesh, waterSystem, options = {}) {
    const id = options.id ?? `boat_${this._nextBoatId++}`;
    this._boats.set(id, {
      mesh,
      waterSystem,
      bow:       options.bow       ? options.bow.clone()       : new THREE.Vector3(0, 0, -0.5),
      port:      options.port      ? options.port.clone()      : new THREE.Vector3(-0.3, 0, 0.2),
      starboard: options.starboard ? options.starboard.clone() : new THREE.Vector3(0.3, 0, 0.2),
    });
    return id;
  }

  /**
   * @param {string} id
   */
  unregisterBoat(id) {
    this._boats.delete(id);
  }

  // -------------------------------------------------------------------------
  // Ripple creation
  // -------------------------------------------------------------------------

  /**
   * Queue a ripple at a world-space position.
   * @param {number} x  world X
   * @param {number} z  world Z
   * @param {number} [strength=0.5]
   */
  createRipple(x, z, strength = 0.5) {
    const { u, v } = this._worldToUV(x, z);
    // Only queue if inside the domain
    if (u >= 0 && u <= 1 && v >= 0 && v <= 1) {
      this._pendingRipples.push({ u, v, strength });
    }
  }

  // -------------------------------------------------------------------------
  // Per-frame update
  // -------------------------------------------------------------------------

  /**
   * Advance the water interaction by one frame.
   * @param {number} _deltaTime  (currently unused; wave equation is framerate-driven)
   */
  update(_deltaTime) {
    const renderer = this._renderer;
    const prevRT   = renderer.getRenderTarget();
    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = false;

    // 1. Inject pending ripples into the current state ----------------------
    if (this._pendingRipples.length > 0) {
      this._quad.material = this._spikeMat;

      for (let i = 0; i < this._pendingRipples.length; i++) {
        const r = this._pendingRipples[i];

        this._spikeMat.uniforms.inputTex.value      = this._current.texture;
        this._spikeMat.uniforms.spikeUV.value.set(r.u, r.v);
        this._spikeMat.uniforms.spikeStrength.value  = r.strength;

        // Render spike pass into the "previous" target as temp, then swap
        // so current contains the spiked data.
        renderer.setRenderTarget(this._previous);
        renderer.render(this._scene, this._camera);

        // Swap so _current now has the spike
        const tmp      = this._current;
        this._current  = this._previous;
        this._previous = tmp;
      }

      this._pendingRipples.length = 0;
    }

    // 2. Wave equation propagation (one step) --------------------------------
    this._quad.material = this._propagationMat;
    this._propagationMat.uniforms.currentState.value  = this._current.texture;
    this._propagationMat.uniforms.previousState.value = this._previous.texture;

    // Render into the _previous target (it becomes the "next" state).
    renderer.setRenderTarget(this._previous);
    renderer.render(this._scene, this._camera);

    // Cycle:  previous → next (just written), current → becomes previous.
    const oldCurrent = this._current;
    this._current    = this._previous;   // freshly propagated
    this._previous   = oldCurrent;       // one step behind

    // Restore renderer state
    renderer.setRenderTarget(prevRT);
    renderer.autoClear = prevAutoClear;

    // 3. Update boat transforms from wave heights ---------------------------
    this._updateBoats();
  }

  // -------------------------------------------------------------------------
  // Boat physics
  // -------------------------------------------------------------------------

  _updateBoats() {
    for (const entry of this._boats.values()) {
      const { mesh, waterSystem, bow, port, starboard } = entry;

      // Sample world positions of the three hull points
      const wx = mesh.position.x;
      const wz = mesh.position.z;

      const bowWorld = _v3a.set(
        wx + bow.x, 0, wz + bow.z
      );
      const portWorld = _v3b.set(
        wx + port.x, 0, wz + port.z
      );
      const starWorld = _v3c.set(
        wx + starboard.x, 0, wz + starboard.z
      );

      // Sample wave heights
      const hBow  = waterSystem.getWaveHeight(bowWorld.x, bowWorld.z);
      const hPort = waterSystem.getWaveHeight(portWorld.x, portWorld.z);
      const hStar = waterSystem.getWaveHeight(starWorld.x, starWorld.z);

      bowWorld.y  = hBow;
      portWorld.y = hPort;
      starWorld.y = hStar;

      // Average height for vertical placement
      const avgHeight = (hBow + hPort + hStar) / 3;
      mesh.position.y = avgHeight;

      // Compute surface normal from the three sample points
      _ab.subVectors(portWorld, bowWorld);
      _ac.subVectors(starWorld, bowWorld);
      _ab.cross(_ac).normalize();

      // If the normal points downward, flip it
      if (_ab.y < 0) _ab.negate();

      // Build a quaternion that rotates UP to the surface normal
      _quat.setFromUnitVectors(_up, _ab);
      mesh.quaternion.copy(_quat);
    }
  }

  // -------------------------------------------------------------------------
  // Public accessors
  // -------------------------------------------------------------------------

  /**
   * Get the ripple heightmap texture for the water surface shader.
   * Sample the red channel: positive = crest, negative = trough.
   * @returns {THREE.Texture}
   */
  getRippleTexture() {
    return this._current.texture;
  }

  // -------------------------------------------------------------------------
  // Cleanup
  // -------------------------------------------------------------------------

  dispose() {
    this._rtA.dispose();
    this._rtB.dispose();
    this._propagationMat.dispose();
    this._spikeMat.dispose();
    this._quad.geometry.dispose();
    this._boats.clear();
    this._pendingRipples.length = 0;
  }
}
