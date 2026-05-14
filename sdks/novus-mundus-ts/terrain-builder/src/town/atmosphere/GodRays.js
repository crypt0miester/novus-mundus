/**
 * GodRayPass — Screen-space radial blur volumetric light shafts.
 *
 * Two-pass technique:
 *   1. Occlusion Pass — Render scene with override black material, except
 *      a white emissive sphere at the light position. Output at half-res.
 *   2. Radial Blur Pass — 60-sample radial blur from the light source
 *      screen position, blended additively onto the scene.
 *
 * Designed for the sanctuary spire at dawn/dusk. ~1-2ms GPU budget.
 */

import * as THREE from 'three';
import { Pass } from 'three/addons/postprocessing/Pass.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

// Constants

const NUM_SAMPLES = 60;

// GLSL — Occlusion vertex (standard fullscreen)

const OCCLUSION_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// GLSL — Radial blur fragment

const RADIAL_BLUR_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const RADIAL_BLUR_FRAGMENT = /* glsl */ `
precision highp float;

uniform sampler2D tOcclusion;
uniform sampler2D tDiffuse;
uniform vec2 lightScreenPos;
uniform float density;
uniform float weight;
uniform float decay;
uniform float exposure;
uniform float intensity;
uniform vec3 rayColor;

varying vec2 vUv;

void main() {
  vec2 uv = vUv;
  vec2 deltaUv = (uv - lightScreenPos) * density / float(${NUM_SAMPLES});

  vec3 godRays = vec3(0.0);
  float illumination = 1.0;
  vec2 sampleUv = uv;

  for (int i = 0; i < ${NUM_SAMPLES}; i++) {
    sampleUv -= deltaUv;
    vec2 clampedUv = clamp(sampleUv, vec2(0.001), vec2(0.999));
    vec3 samp = texture2D(tOcclusion, clampedUv).rgb;
    samp *= illumination * weight;
    godRays += samp;
    illumination *= decay;
  }

  godRays *= exposure * intensity;

  vec4 scene = texture2D(tDiffuse, uv);
  gl_FragColor = vec4(scene.rgb + godRays * rayColor, scene.a);
}
`;

// GodRayOcclusionPass — renders the black/white occlusion mask

class GodRayOcclusionPass extends Pass {
  /**
   * @param {THREE.Scene} scene
   * @param {THREE.Camera} camera
   * @param {THREE.WebGLRenderTarget} occlusionTarget
   */
  constructor(scene, camera, occlusionTarget) {
    super();

    this.scene = scene;
    this.camera = camera;
    this.occlusionTarget = occlusionTarget;
    this.needsSwap = false;
    this.enabled = true;

    // Reusable black color for scene background during occlusion
    this._blackColor = new THREE.Color(0x000000);

    // Black override material for everything except the light source
    this._blackMaterial = new THREE.MeshBasicMaterial({ color: 0x000000 });

    // Emissive white sphere representing the god ray light source
    this._lightSphere = new THREE.Mesh(
      new THREE.SphereGeometry(0.15, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
    );
    this._lightSphere.frustumCulled = false;
    this._lightSphere.visible = false;
  }

  /**
   * Set the world position of the god ray light source.
   * @param {THREE.Vector3} pos
   */
  setLightPosition(pos) {
    this._lightSphere.position.copy(pos);
  }

  /**
   * Set the radius of the light source sphere.
   * @param {number} radius
   */
  setLightRadius(radius) {
    this._lightSphere.scale.setScalar(radius / 0.15);
  }

  render(renderer, writeBuffer, readBuffer) {
    if (!this.enabled) return;

    const savedOverride = this.scene.overrideMaterial;
    const savedBackground = this.scene.background;

    // Override everything to black
    this.scene.overrideMaterial = this._blackMaterial;
    this.scene.background = this._blackColor;

    // Add the white light sphere temporarily
    this._lightSphere.visible = true;
    this.scene.add(this._lightSphere);

    // The light sphere must bypass the override material
    this._lightSphere.material._isGodRaySource = true;

    // Render the occlusion mask to the half-res target
    renderer.setRenderTarget(this.occlusionTarget);
    renderer.clear(true, true, false);

    // Temporarily remove override to render the light sphere white,
    // then restore override for the rest of the scene.
    // Strategy: render scene black first, then render light sphere on top.
    renderer.render(this.scene, this.camera);

    // Now render just the light sphere with its own white material
    this.scene.overrideMaterial = null;
    this._lightSphere.renderOrder = 999;
    renderer.autoClear = false;
    renderer.render(this._lightSphere, this.camera);
    renderer.autoClear = true;

    // Cleanup
    this.scene.remove(this._lightSphere);
    this._lightSphere.visible = false;
    this.scene.overrideMaterial = savedOverride;
    this.scene.background = savedBackground;
    renderer.setRenderTarget(null);
  }

  dispose() {
    this._blackMaterial.dispose();
    this._lightSphere.geometry.dispose();
    this._lightSphere.material.dispose();
  }
}

// GodRayPass — main class combining occlusion + radial blur

export class GodRayPass {
  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {THREE.Scene} scene
   * @param {THREE.Camera} camera
   * @param {object} [options]
   * @param {number} [options.density=1.0]
   * @param {number} [options.weight=0.01]
   * @param {number} [options.decay=0.97]
   * @param {number} [options.exposure=0.3]
   * @param {number} [options.intensity=0.6]
   * @param {number} [options.lightRadius=0.15]
   */
  constructor(renderer, scene, camera, options = {}) {
    this._renderer = renderer;
    this._scene = scene;
    this._camera = camera;

    this._intensity = options.intensity ?? 0.6;
    this._timeIntensity = 0; // driven by setTimeOfDay
    this._manualIntensity = null; // user override

    // Light world position (typically sanctuary spire tip)
    this._lightWorldPos = new THREE.Vector3(0, 1, 0);
    this._lightScreenPos = new THREE.Vector2(0.5, 0.5);

    // Half-resolution occlusion render target
    const w = renderer.domElement.width || renderer.domElement.clientWidth || 800;
    const h = renderer.domElement.height || renderer.domElement.clientHeight || 600;
    const halfW = Math.max(1, Math.floor(w / 2));
    const halfH = Math.max(1, Math.floor(h / 2));

    this._occlusionTarget = new THREE.WebGLRenderTarget(halfW, halfH, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
    });

    // Occlusion pre-pass
    this._occlusionPass = new GodRayOcclusionPass(scene, camera, this._occlusionTarget);
    this._occlusionPass.setLightRadius(options.lightRadius ?? 0.15);

    // Radial blur shader material
    this._blurMaterial = new THREE.ShaderMaterial({
      vertexShader: RADIAL_BLUR_VERTEX,
      fragmentShader: RADIAL_BLUR_FRAGMENT,
      uniforms: {
        tOcclusion: { value: this._occlusionTarget.texture },
        tDiffuse: { value: null },
        lightScreenPos: { value: this._lightScreenPos },
        density: { value: options.density ?? 1.0 },
        weight: { value: options.weight ?? 0.01 },
        decay: { value: options.decay ?? 0.97 },
        exposure: { value: options.exposure ?? 0.3 },
        intensity: { value: this._intensity },
        rayColor: { value: new THREE.Vector3(1.0, 0.9, 0.7) }, // warm golden
      },
      depthTest: false,
      depthWrite: false,
    });

    this._blurQuad = new FullScreenQuad(this._blurMaterial);

    // ShaderPass-compatible wrapper for the EffectComposer
    this._composerPass = new GodRayComposerPass(this);
  }

  // Public API

  /**
   * Set the world position of the god ray light source.
   * @param {THREE.Vector3} pos
   */
  setLightWorldPosition(pos) {
    this._lightWorldPos.copy(pos);
    this._occlusionPass.setLightPosition(pos);
  }

  /**
   * Set overall intensity manually. Overrides time-of-day auto intensity.
   * Pass null to return to automatic time-of-day control.
   * @param {number|null} intensity 0-1
   */
  setIntensity(intensity) {
    this._manualIntensity = intensity;
  }

  /**
   * Set time of day to auto-adjust god ray intensity.
   * Peaks at dawn (~6:00-7:30) and dusk (~17:00-18:30).
   * @param {number} hour 0-24
   */
  setTimeOfDay(hour) {
    const h = ((hour % 24) + 24) % 24;

    // Dawn peak: 6:00-7:30 (strongest at 6:30)
    let dawnIntensity = 0;
    if (h >= 5.5 && h <= 8.0) {
      if (h < 6.5) {
        dawnIntensity = smoothCos((h - 5.5) / 1.0); // ramp up 5:30-6:30
      } else {
        dawnIntensity = smoothCos(1.0 - (h - 6.5) / 1.5); // ramp down 6:30-8:00
      }
    }

    // Dusk peak: 17:00-18:30 (strongest at 17:30)
    let duskIntensity = 0;
    if (h >= 16.5 && h <= 19.0) {
      if (h < 17.5) {
        duskIntensity = smoothCos((h - 16.5) / 1.0); // ramp up
      } else {
        duskIntensity = smoothCos(1.0 - (h - 17.5) / 1.5); // ramp down
      }
    }

    this._timeIntensity = Math.max(dawnIntensity, duskIntensity);

    // Warm golden at dawn, amber-orange at dusk
    const rayColor = this._blurMaterial.uniforms.rayColor.value;
    if (dawnIntensity > duskIntensity) {
      // Dawn: warm gold
      rayColor.set(1.0, 0.92, 0.7);
    } else if (duskIntensity > 0) {
      // Dusk: deeper amber
      rayColor.set(1.0, 0.75, 0.45);
    }
  }

  /**
   * Set the color tint of the god rays.
   * @param {number} r 0-1
   * @param {number} g 0-1
   * @param {number} b 0-1
   */
  setRayColor(r, g, b) {
    this._blurMaterial.uniforms.rayColor.value.set(r, g, b);
  }

  /**
   * Returns the EffectComposer-compatible pass.
   * Add this to your composer: `composer.addPass(godRays.getPass())`
   * @returns {Pass}
   */
  getPass() {
    return this._composerPass;
  }

  /**
   * Returns the occlusion pre-pass (for manual rendering if not using
   * the integrated getPass()).
   * @returns {GodRayOcclusionPass}
   */
  getOcclusionPass() {
    return this._occlusionPass;
  }

  /**
   * Handle viewport resize.
   * @param {number} width
   * @param {number} height
   */
  resize(width, height) {
    const halfW = Math.max(1, Math.floor(width / 2));
    const halfH = Math.max(1, Math.floor(height / 2));
    this._occlusionTarget.setSize(halfW, halfH);
  }

  /**
   * Dispose all GPU resources.
   */
  dispose() {
    this._occlusionTarget.dispose();
    this._occlusionPass.dispose();
    this._blurMaterial.dispose();
    this._blurQuad.dispose();
  }

  // Internal: called by the composer pass each frame

  /** @private */
  _updateScreenPosition() {
    if (!this._tmpProjectPos) this._tmpProjectPos = new THREE.Vector3();
    const pos = this._tmpProjectPos.copy(this._lightWorldPos);
    pos.project(this._camera);

    // NDC -> UV space [0,1]
    this._lightScreenPos.set(
      pos.x * 0.5 + 0.5,
      pos.y * 0.5 + 0.5,
    );

    this._blurMaterial.uniforms.lightScreenPos.value.copy(this._lightScreenPos);
  }

  /** @private */
  _getEffectiveIntensity() {
    if (this._manualIntensity !== null) return this._manualIntensity;
    return this._timeIntensity * this._intensity;
  }

  /** @private */
  _renderOcclusion(renderer) {
    this._occlusionPass.render(renderer, null, null);
  }

  /** @private */
  _renderBlur(renderer, readBuffer, writeBuffer) {
    const effectiveIntensity = this._getEffectiveIntensity();
    this._blurMaterial.uniforms.intensity.value = effectiveIntensity;
    this._blurMaterial.uniforms.tDiffuse.value = readBuffer.texture;
    this._blurMaterial.uniforms.tOcclusion.value = this._occlusionTarget.texture;

    renderer.setRenderTarget(writeBuffer);
    this._blurQuad.render(renderer);
  }
}

// GodRayComposerPass — EffectComposer-compatible pass wrapper

class GodRayComposerPass extends Pass {
  /**
   * @param {GodRayPass} godRayPass
   */
  constructor(godRayPass) {
    super();
    this._godRay = godRayPass;
    this.needsSwap = true;
    this.enabled = true;
    // Reusable temporaries for render()
    this._camDir = new THREE.Vector3();
    this._toLight = new THREE.Vector3();
  }

  render(renderer, writeBuffer, readBuffer) {
    if (!this.enabled) return;

    const effectiveIntensity = this._godRay._getEffectiveIntensity();

    // Check if light is behind the camera
    this._godRay._updateScreenPosition();
    const camDir = this._camDir;
    this._godRay._camera.getWorldDirection(camDir);
    const toLight = this._toLight.subVectors(
      this._godRay._lightWorldPos,
      this._godRay._camera.position,
    );
    const lenSq = toLight.lengthSq();
    const lightBehind = lenSq > 0.0001
      ? camDir.dot(toLight.normalize()) < -0.1
      : false;

    // When intensity is negligible or light is behind camera, skip entirely.
    // Setting needsSwap=false tells EffectComposer not to swap buffers,
    // so readBuffer passes through unchanged to the next pass.
    if (effectiveIntensity < 0.001 || lightBehind) {
      this.needsSwap = false;
      return;
    }

    this.needsSwap = true;

    // 1. Render occlusion mask
    this._godRay._renderOcclusion(renderer);

    // 2. Render radial blur (compositing onto the scene)
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this._godRay._renderBlur(renderer, readBuffer, this.renderToScreen ? null : writeBuffer);
  }

  dispose() {
    // Disposed via GodRayPass.dispose()
  }
}

// Utility

/**
 * Smooth cosine interpolation (0 at edges, 1 at center).
 * @param {number} t 0-1
 * @returns {number} 0-1
 */
function smoothCos(t) {
  const clamped = Math.max(0, Math.min(1, t));
  return (1 - Math.cos(clamped * Math.PI)) * 0.5;
}
