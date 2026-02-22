/**
 * RainRenderer — InstancedMesh-based rain drops with SDF capsule shape.
 *
 * Based on billboard quads that face the camera, with per-frame CPU
 * animation. Each drop falls downward, resets when below ground.
 *
 * Reference: Faraz-Portfolio/demo-2023-rain-puddle
 */

import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Shaders
// ---------------------------------------------------------------------------

const RAIN_VERTEX = /* glsl */ `
  uniform float uTime;

  varying vec2 vUv;
  varying float vAlpha;

  void main() {
    vUv = uv;
    vAlpha = 1.0;
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  }
`;

const RAIN_FRAGMENT = /* glsl */ `
  uniform float uIntensity;

  varying vec2 vUv;
  varying float vAlpha;

  // SDF uneven capsule — wider at top, tapers at bottom (raindrop shape)
  float sdUnevenCapsule(vec2 p, float r1, float r2, float h) {
    p.x = abs(p.x);
    float b = (r1 - r2) / h;
    float a = sqrt(1.0 - b * b);
    float k = dot(p, vec2(-b, a));
    if (k < 0.0) return length(p) - r1;
    if (k > a * h) return length(p - vec2(0.0, h)) - r2;
    return dot(p, vec2(a, b)) - r1;
  }

  void main() {
    vec2 coord = (vUv - 0.5) * 10.0;

    float d = sdUnevenCapsule(coord, 0.08, 0.0, 3.0);
    float drop = 1.0 - smoothstep(0.0, 0.08, d);

    if (drop < 0.01) discard;

    // Slightly blue-tinted white
    vec3 color = vec3(0.7, 0.75, 0.85);

    float alpha = drop * 0.15 * uIntensity;
    gl_FragColor = vec4(color, alpha);
  }
`;

// ---------------------------------------------------------------------------
// RainRenderer
// ---------------------------------------------------------------------------

export class RainRenderer {
  /**
   * @param {THREE.Scene} scene
   * @param {object} [options]
   * @param {number} [options.maxCount=4000]
   * @param {number} [options.spread=12]
   * @param {number} [options.height=6]
   * @param {number} [options.fallSpeed=5.0]
   * @param {number} [options.dropWidth=0.04]
   * @param {number} [options.dropHeight=0.12]
   */
  constructor(scene, options = {}) {
    this._scene = scene;
    this._maxCount = options.maxCount || 4000;
    this._spread = options.spread || 12;
    this._height = options.height || 6;
    this._fallSpeed = options.fallSpeed || 5.0;
    this._dropWidth = options.dropWidth || 0.04;
    this._dropHeight = options.dropHeight || 0.12;

    this._intensity = 0;
    this._dummy = new THREE.Object3D();
    this._disposed = false;

    this._build();
  }

  // ---------- public ----------

  /**
   * Set rain intensity (0 = off, 1 = full downpour).
   * @param {number} intensity
   */
  setIntensity(intensity) {
    this._intensity = Math.max(0, Math.min(1, intensity));
    this._mesh.material.uniforms.uIntensity.value = this._intensity;
    this._mesh.visible = this._intensity > 0.1;
  }

  /**
   * Set wind influence on rain angle.
   * @param {THREE.Vector2|{x:number,y:number}} dir - wind direction (XZ plane)
   * @param {number} strength - wind strength (0-1)
   */
  setWind(dir, strength) {
    this._windX = (dir.x || 0) * strength * 0.3;
    this._windZ = (dir.y || 0) * strength * 0.3;
  }

  /**
   * Per-frame update: move drops down, reset at bottom, billboard toward camera.
   * @param {number} dt - delta time in seconds
   * @param {THREE.Camera} camera
   */
  update(dt, camera) {
    if (!this._mesh.visible || this._disposed) return;

    const activeCount = Math.floor(this._maxCount * this._intensity);
    const mesh = this._mesh;
    const dummy = this._dummy;
    const speed = this._fallSpeed;
    const spread = this._spread;
    const height = this._height;
    const windX = this._windX || 0;
    const windZ = this._windZ || 0;

    for (let i = 0; i < this._maxCount; i++) {
      mesh.getMatrixAt(i, dummy.matrix);
      dummy.matrix.decompose(dummy.position, dummy.quaternion, dummy.scale);

      if (i >= activeCount) {
        // Hide inactive drops by scaling to zero
        dummy.scale.setScalar(0);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        continue;
      }

      // Move down + wind drift
      dummy.position.y -= dt * speed;
      dummy.position.x += windX * dt;
      dummy.position.z += windZ * dt;

      // Reset when below ground
      if (dummy.position.y <= -0.1) {
        dummy.position.set(
          (Math.random() * 2 - 1) * spread,
          Math.random() * height + 0.5,
          (Math.random() * 2 - 1) * spread,
        );
        const s = 0.5 + Math.random() * 1.0;
        dummy.scale.set(s, s, s);
      }

      // Billboard: face camera
      dummy.rotation.y = Math.atan2(
        camera.position.x - dummy.position.x,
        camera.position.z - dummy.position.z,
      );

      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }

    mesh.instanceMatrix.needsUpdate = true;
  }

  /** Dispose GPU resources. */
  dispose() {
    this._disposed = true;
    if (this._mesh) {
      if (this._mesh.geometry) this._mesh.geometry.dispose();
      if (this._mesh.material) this._mesh.material.dispose();
      if (this._mesh.parent) this._mesh.parent.remove(this._mesh);
      this._mesh = null;
    }
  }

  // ---------- internal ----------

  _build() {
    const geo = new THREE.PlaneGeometry(this._dropWidth, this._dropHeight);

    const mat = new THREE.ShaderMaterial({
      vertexShader: RAIN_VERTEX,
      fragmentShader: RAIN_FRAGMENT,
      uniforms: {
        uTime: { value: 0 },
        uIntensity: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    this._mesh = new THREE.InstancedMesh(geo, mat, this._maxCount);
    this._mesh.frustumCulled = false;
    this._mesh.visible = false;
    this._mesh.renderOrder = 10;

    // Initialize all drops at random positions
    const dummy = this._dummy;
    for (let i = 0; i < this._maxCount; i++) {
      dummy.position.set(
        (Math.random() * 2 - 1) * this._spread,
        Math.random() * this._height + 0.5,
        (Math.random() * 2 - 1) * this._spread,
      );
      const s = 0.5 + Math.random() * 1.0;
      dummy.scale.set(s, s, s);
      dummy.updateMatrix();
      this._mesh.setMatrixAt(i, dummy.matrix);
    }
    this._mesh.instanceMatrix.needsUpdate = true;

    this._scene.add(this._mesh);
  }
}
