import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GodRayPass } from './GodRays.js';

// ---------------------------------------------------------------------------
// SSAO Shader — custom screen-space ambient occlusion via hemisphere sampling
// ---------------------------------------------------------------------------

/**
 * Generate 16 hemisphere kernel samples distributed in a unit hemisphere,
 * with distance falloff weighting toward the surface.
 */
function generateSSAOKernel(size) {
  const kernel = [];
  for (let i = 0; i < size; i++) {
    // Random point in unit hemisphere (z >= 0)
    const x = Math.random() * 2.0 - 1.0;
    const y = Math.random() * 2.0 - 1.0;
    const z = Math.random(); // hemisphere: z in [0, 1]
    const len = Math.sqrt(x * x + y * y + z * z);
    // Normalize then scale: samples cluster near the origin for better
    // near-field occlusion. scale = lerp(0.1, 1.0, (i/size)^2)
    let scale = i / size;
    scale = 0.1 + scale * scale * 0.9;
    kernel.push(new THREE.Vector3(
      (x / len) * scale,
      (y / len) * scale,
      (z / len) * scale,
    ));
  }
  return kernel;
}

/**
 * Generate a 4x4 rotation noise texture (16 random tangent-space rotations)
 * to reduce banding in the SSAO sampling pattern.
 */
function generateNoiseTexture() {
  const size = 4;
  const data = new Float32Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    // Random rotation vector in tangent plane (z = 0, normalized)
    const angle = Math.random() * Math.PI * 2.0;
    data[i * 4 + 0] = Math.cos(angle);
    data[i * 4 + 1] = Math.sin(angle);
    data[i * 4 + 2] = 0.0;
    data[i * 4 + 3] = 1.0;
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.FloatType);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

const SSAO_KERNEL_SIZE = 16;

const SSAOShader = {
  uniforms: {
    tDiffuse: { value: null },
    tDepth: { value: null },
    tNoise: { value: null },
    kernel: { value: [] },
    resolution: { value: new THREE.Vector2(1, 1) },
    cameraNear: { value: 0.1 },
    cameraFar: { value: 100.0 },
    cameraProjection: { value: new THREE.Matrix4() },
    cameraInverseProjection: { value: new THREE.Matrix4() },
    aoRadius: { value: 0.5 },
    aoIntensity: { value: 1.5 },
    distanceFalloff: { value: 1.0 },
    noiseScale: { value: new THREE.Vector2(1, 1) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    #include <packing>

    uniform sampler2D tDiffuse;
    uniform sampler2D tDepth;
    uniform sampler2D tNoise;

    uniform vec3 kernel[${SSAO_KERNEL_SIZE}];
    uniform vec2 resolution;
    uniform float cameraNear;
    uniform float cameraFar;
    uniform mat4 cameraProjection;
    uniform mat4 cameraInverseProjection;
    uniform float aoRadius;
    uniform float aoIntensity;
    uniform float distanceFalloff;
    uniform vec2 noiseScale;

    varying vec2 vUv;

    // Reconstruct linear depth from the depth buffer
    float getLinearDepth(vec2 uv) {
      float fragDepth = texture2D(tDepth, uv).x;
      float ndc = fragDepth * 2.0 - 1.0;
      float linearDepth = (2.0 * cameraNear * cameraFar) /
        (cameraFar + cameraNear - ndc * (cameraFar - cameraNear));
      return linearDepth;
    }

    // Reconstruct view-space position from UV + linear depth
    vec3 getViewPosition(vec2 uv, float depth) {
      vec4 clipPos = vec4(uv * 2.0 - 1.0, 1.0, 1.0);
      vec4 viewRay = cameraInverseProjection * clipPos;
      viewRay.xyz /= viewRay.w;
      // viewRay points from origin through the far plane at this pixel.
      // Scale by depth / far to get actual view-space position.
      return viewRay.xyz * (depth / cameraFar);
    }

    // Derive view-space normal from screen-space depth derivatives
    vec3 getViewNormal(vec3 viewPos) {
      vec3 dx = dFdx(viewPos);
      vec3 dy = dFdy(viewPos);
      return normalize(cross(dy, dx));
    }

    void main() {
      vec4 sceneColor = texture2D(tDiffuse, vUv);
      float depth = getLinearDepth(vUv);

      // Skip pixels at the far plane (sky)
      if (depth >= cameraFar * 0.999) {
        gl_FragColor = sceneColor;
        return;
      }

      vec3 viewPos = getViewPosition(vUv, depth);
      vec3 viewNormal = getViewNormal(viewPos);

      // Sample rotation from the 4x4 noise texture to break banding
      vec3 randomVec = texture2D(tNoise, vUv * noiseScale).xyz;

      // Build TBN matrix: Gram-Schmidt orthogonalize tangent from randomVec
      vec3 tangent = normalize(randomVec - viewNormal * dot(randomVec, viewNormal));
      vec3 bitangent = cross(viewNormal, tangent);
      mat3 TBN = mat3(tangent, bitangent, viewNormal);

      float occlusion = 0.0;

      for (int i = 0; i < ${SSAO_KERNEL_SIZE}; i++) {
        // Transform kernel sample from tangent space to view space
        vec3 sampleDir = TBN * kernel[i];
        vec3 samplePos = viewPos + sampleDir * aoRadius;

        // Project sample position to screen space
        vec4 offset = cameraProjection * vec4(samplePos, 1.0);
        offset.xy /= offset.w;
        offset.xy = offset.xy * 0.5 + 0.5;

        // Clamp to screen bounds
        if (offset.x < 0.0 || offset.x > 1.0 || offset.y < 0.0 || offset.y > 1.0) {
          continue;
        }

        // Sample the depth buffer at the projected position
        float sampleDepth = getLinearDepth(offset.xy);

        // Range check: ignore samples too far from the surface
        float rangeCheck = smoothstep(0.0, 1.0,
          aoRadius * distanceFalloff / (abs(depth - sampleDepth) + 0.001));

        // If the sampled depth is closer than the sample position,
        // the sample is occluded
        float sampleLinearZ = -samplePos.z; // view space z is negative in GL
        if (sampleDepth < sampleLinearZ) {
          occlusion += rangeCheck;
        }
      }

      occlusion = 1.0 - (occlusion / float(${SSAO_KERNEL_SIZE})) * aoIntensity;
      occlusion = clamp(occlusion, 0.0, 1.0);

      // Multiply blend: darken scene color by the AO factor
      gl_FragColor = vec4(sceneColor.rgb * occlusion, sceneColor.a);
    }
  `,
};

// ---------------------------------------------------------------------------
// Tilt-Shift Horizontal Blur Shader
// ---------------------------------------------------------------------------
const TiltShiftHorizontalShader = {
  uniforms: {
    tDiffuse: { value: null },
    focusCenter: { value: 0.5 },
    focusWidth: { value: 0.4 },
    maxBlur: { value: 4.0 },
    resolution: { value: new THREE.Vector2(1, 1) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float focusCenter;
    uniform float focusWidth;
    uniform float maxBlur;
    uniform vec2 resolution;
    varying vec2 vUv;

    void main() {
      // Distance from the focus band center
      float dist = abs(vUv.y - focusCenter);
      float halfFocus = focusWidth * 0.5;
      float fadeWidth = 0.2;

      // Blur amount ramps quadratically from focus edge
      float blurAmount = smoothstep(halfFocus, halfFocus + fadeWidth, dist);
      blurAmount *= blurAmount; // quadratic ramp

      float blur = blurAmount * maxBlur / resolution.x;

      if (blur < 0.0001) {
        gl_FragColor = texture2D(tDiffuse, vUv);
        return;
      }

      // 9-tap separable gaussian (horizontal)
      vec4 sum = vec4(0.0);
      float weights[9];
      weights[0] = 0.0162;
      weights[1] = 0.0540;
      weights[2] = 0.1218;
      weights[3] = 0.1944;
      weights[4] = 0.2270;
      weights[5] = 0.1944;
      weights[6] = 0.1218;
      weights[7] = 0.0540;
      weights[8] = 0.0162;

      float totalWeight = 0.0;
      for (int i = 0; i < 9; i++) {
        float offset = float(i - 4) * blur;
        vec2 sampleUv = clamp(vUv + vec2(offset, 0.0), 0.0, 1.0);
        sum += texture2D(tDiffuse, sampleUv) * weights[i];
        totalWeight += weights[i];
      }

      gl_FragColor = sum / totalWeight;
    }
  `,
};

// ---------------------------------------------------------------------------
// Tilt-Shift Vertical Blur Shader
// ---------------------------------------------------------------------------
const TiltShiftVerticalShader = {
  uniforms: {
    tDiffuse: { value: null },
    focusCenter: { value: 0.5 },
    focusWidth: { value: 0.4 },
    maxBlur: { value: 4.0 },
    resolution: { value: new THREE.Vector2(1, 1) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float focusCenter;
    uniform float focusWidth;
    uniform float maxBlur;
    uniform vec2 resolution;
    varying vec2 vUv;

    void main() {
      float dist = abs(vUv.y - focusCenter);
      float halfFocus = focusWidth * 0.5;
      float fadeWidth = 0.2;

      float blurAmount = smoothstep(halfFocus, halfFocus + fadeWidth, dist);
      blurAmount *= blurAmount;

      float blur = blurAmount * maxBlur / resolution.y;

      if (blur < 0.0001) {
        gl_FragColor = texture2D(tDiffuse, vUv);
        return;
      }

      // 9-tap separable gaussian (vertical)
      vec4 sum = vec4(0.0);
      float weights[9];
      weights[0] = 0.0162;
      weights[1] = 0.0540;
      weights[2] = 0.1218;
      weights[3] = 0.1944;
      weights[4] = 0.2270;
      weights[5] = 0.1944;
      weights[6] = 0.1218;
      weights[7] = 0.0540;
      weights[8] = 0.0162;

      float totalWeight = 0.0;
      for (int i = 0; i < 9; i++) {
        float offset = float(i - 4) * blur;
        vec2 sampleUv = clamp(vUv + vec2(0.0, offset), 0.0, 1.0);
        sum += texture2D(tDiffuse, sampleUv) * weights[i];
        totalWeight += weights[i];
      }

      gl_FragColor = sum / totalWeight;
    }
  `,
};

// ---------------------------------------------------------------------------
// Color Grading + Vignette Shader
// ---------------------------------------------------------------------------
const ColorGradeVignetteShader = {
  uniforms: {
    tDiffuse: { value: null },
    saturation: { value: 1.15 },
    warmth: { value: 0.5 },
    contrast: { value: 1.1 },
    vignetteIntensity: { value: 0.3 },
    vignetteRadius: { value: 0.8 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float saturation;
    uniform float warmth;
    uniform float contrast;
    uniform float vignetteIntensity;
    uniform float vignetteRadius;
    varying vec2 vUv;

    void main() {
      vec4 color = texture2D(tDiffuse, vUv);

      // ── Contrast boost ──
      // Pivot around mid-grey
      color.rgb = (color.rgb - 0.5) * contrast + 0.5;

      // ── Saturation boost ──
      float luminance = dot(color.rgb, vec3(0.2126, 0.7152, 0.0722));
      color.rgb = mix(vec3(luminance), color.rgb, saturation);

      // ── Warmth / coolness tint ──
      // warmth 0.0 = cool (night), 1.0 = warm (day)
      // Cool tint: slight blue shift. Warm tint: slight amber shift.
      // Interpolate between cool and warm color offsets.
      vec3 coolTint = vec3(-0.03, -0.01, 0.06);   // blue shift
      vec3 warmTint = vec3(0.06, 0.03, -0.03);     // amber shift
      vec3 tint = mix(coolTint, warmTint, warmth);
      color.rgb += tint;

      // ── Vignette ──
      // Distance from center of screen in normalized coords
      vec2 uv = vUv * 2.0 - 1.0;
      float dist = length(uv);
      // Smooth darkening beyond vignetteRadius
      float vignette = 1.0 - smoothstep(vignetteRadius, vignetteRadius + 0.6, dist) * vignetteIntensity;
      color.rgb *= vignette;

      // Clamp to valid range
      color.rgb = clamp(color.rgb, 0.0, 1.0);

      gl_FragColor = color;
    }
  `,
};

// ---------------------------------------------------------------------------
// PostProcessingPipeline
// ---------------------------------------------------------------------------

/**
 * Post-processing pipeline for the town diorama renderer.
 * Creates a "precious hand-crafted miniature / snow globe" look with:
 * - Custom SSAO for depth and grounding (16 hemisphere samples + noise)
 * - Selective bloom for magical glow effects (forge embers, sanctuary crystals, torches)
 * - Tilt-shift blur for miniature/diorama feel (two-pass separable gaussian)
 * - Color grading + vignette for polish (saturation, warmth, contrast, edge darkening)
 *
 * Pipeline order: RenderPass -> SSAO -> Bloom -> TiltShift H -> TiltShift V ->
 *                 ColorGrade+Vignette -> OutputPass
 */
export class PostProcessingPipeline {
  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {THREE.Scene} scene
   * @param {THREE.Camera} camera
   * @param {Object} options - Optional configuration overrides
   * @param {Object} [options.ssao] - { radius, intensity, distanceFalloff }
   * @param {Object} [options.bloom] - { strength, radius, threshold }
   * @param {Object} [options.tiltShift] - { focusCenter, focusWidth, maxBlur }
   * @param {Object} [options.colorGrade] - { saturation, warmth, vignetteIntensity, vignetteRadius, contrast }
   */
  constructor(renderer, scene, camera, options = {}) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;

    const width = renderer.domElement.width || renderer.domElement.clientWidth || 800;
    const height = renderer.domElement.height || renderer.domElement.clientHeight || 600;

    // ── Depth pre-pass render target ──
    // Renders scene depth into a DepthTexture for the custom SSAO shader.
    this.depthRenderTarget = new THREE.WebGLRenderTarget(width, height, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
    });
    this.depthRenderTarget.depthTexture = new THREE.DepthTexture(width, height);
    this.depthRenderTarget.depthTexture.format = THREE.DepthFormat;
    this.depthRenderTarget.depthTexture.type = THREE.UnsignedIntType;

    // Depth-only material for the pre-pass
    this.depthMaterial = new THREE.MeshDepthMaterial({
      depthPacking: THREE.BasicDepthPacking,
    });

    // ── SSAO kernel + noise ──
    this._ssaoKernel = generateSSAOKernel(SSAO_KERNEL_SIZE);
    this._ssaoNoise = generateNoiseTexture();

    // ── EffectComposer ──
    this.composer = new EffectComposer(renderer);

    // Merge user options with defaults
    const ssaoOpts = { radius: 0.5, intensity: 1.5, distanceFalloff: 1.0, ...options.ssao };
    const bloomOpts = { strength: 0.4, radius: 0.5, threshold: 0.8, ...options.bloom };
    const tiltOpts = { focusCenter: 0.5, focusWidth: 0.4, maxBlur: 4.0, ...options.tiltShift };
    const colorOpts = {
      saturation: 1.15, warmth: 0.5, vignetteIntensity: 0.3,
      vignetteRadius: 0.8, contrast: 1.1, ...options.colorGrade,
    };

    // ── 1. Render Pass ──
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);

    // ── 2. SSAO Pass (custom ShaderPass) ──
    this.ssaoPass = new ShaderPass(SSAOShader);
    this.ssaoPass.uniforms.tDepth.value = this.depthRenderTarget.depthTexture;
    this.ssaoPass.uniforms.tNoise.value = this._ssaoNoise;
    this.ssaoPass.uniforms.kernel.value = this._ssaoKernel;
    this.ssaoPass.uniforms.resolution.value.set(width, height);
    this.ssaoPass.uniforms.noiseScale.value.set(width / 4.0, height / 4.0);
    this.ssaoPass.uniforms.aoRadius.value = ssaoOpts.radius;
    this.ssaoPass.uniforms.aoIntensity.value = ssaoOpts.intensity;
    this.ssaoPass.uniforms.distanceFalloff.value = ssaoOpts.distanceFalloff;
    this._syncCameraUniforms();
    this.composer.addPass(this.ssaoPass);

    // ── 3. God Rays Pass (screen-space radial blur volumetric light shafts) ──
    this._godRayPass = new GodRayPass(renderer, scene, camera, {
      density: 1.0,
      weight: 0.01,
      decay: 0.97,
      exposure: 0.3,
      intensity: 0.6,
      lightRadius: 0.15,
    });
    this.godRayComposerPass = this._godRayPass.getPass();
    this.godRayComposerPass.enabled = true;
    this.composer.addPass(this.godRayComposerPass);

    // ── 4. Bloom Pass (UnrealBloomPass) ──
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(width, height),
      bloomOpts.strength,
      bloomOpts.radius,
      bloomOpts.threshold,
    );
    this.composer.addPass(this.bloomPass);

    // ── 5. Tilt-Shift Horizontal Pass ──
    this.tiltShiftHPass = new ShaderPass(TiltShiftHorizontalShader);
    this.tiltShiftHPass.uniforms.focusCenter.value = tiltOpts.focusCenter;
    this.tiltShiftHPass.uniforms.focusWidth.value = tiltOpts.focusWidth;
    this.tiltShiftHPass.uniforms.maxBlur.value = tiltOpts.maxBlur;
    this.tiltShiftHPass.uniforms.resolution.value.set(width, height);
    this.composer.addPass(this.tiltShiftHPass);

    // ── 6. Tilt-Shift Vertical Pass ──
    this.tiltShiftVPass = new ShaderPass(TiltShiftVerticalShader);
    this.tiltShiftVPass.uniforms.focusCenter.value = tiltOpts.focusCenter;
    this.tiltShiftVPass.uniforms.focusWidth.value = tiltOpts.focusWidth;
    this.tiltShiftVPass.uniforms.maxBlur.value = tiltOpts.maxBlur;
    this.tiltShiftVPass.uniforms.resolution.value.set(width, height);
    this.composer.addPass(this.tiltShiftVPass);

    // ── 7. Color Grading + Vignette Pass ──
    this.colorGradePass = new ShaderPass(ColorGradeVignetteShader);
    this.colorGradePass.uniforms.saturation.value = colorOpts.saturation;
    this.colorGradePass.uniforms.warmth.value = colorOpts.warmth;
    this.colorGradePass.uniforms.contrast.value = colorOpts.contrast;
    this.colorGradePass.uniforms.vignetteIntensity.value = colorOpts.vignetteIntensity;
    this.colorGradePass.uniforms.vignetteRadius.value = colorOpts.vignetteRadius;
    this.composer.addPass(this.colorGradePass);

    // ── 8. Output Pass (final color space conversion) ──
    this.outputPass = new OutputPass();
    this.composer.addPass(this.outputPass);

    // Store last-known values for enable/disable restore
    this._savedVignetteIntensity = colorOpts.vignetteIntensity;
    this._savedColorGradeEnabled = true;
  }

  // ── Enable / Disable ──

  /**
   * Enable or disable the SSAO pass.
   * @param {boolean} enabled
   */
  setSSAOEnabled(enabled) {
    this.ssaoPass.enabled = enabled;
  }

  /**
   * Enable or disable the bloom pass.
   * @param {boolean} enabled
   */
  setBloomEnabled(enabled) {
    this.bloomPass.enabled = enabled;
  }

  /**
   * Enable or disable the god ray pass.
   * @param {boolean} enabled
   */
  setGodRaysEnabled(enabled) {
    this.godRayComposerPass.enabled = enabled;
  }

  /**
   * Set the world position of the god ray light source.
   * @param {THREE.Vector3} pos
   */
  setGodRayLightPosition(pos) {
    this._godRayPass.setLightWorldPosition(pos);
  }

  /**
   * Set god ray intensity manually (null for auto time-of-day).
   * @param {number|null} intensity
   */
  setGodRayIntensity(intensity) {
    this._godRayPass.setIntensity(intensity);
  }

  /**
   * Update god rays time of day for automatic intensity/color.
   * @param {number} hour 0-24
   */
  setGodRayTimeOfDay(hour) {
    this._godRayPass.setTimeOfDay(hour);
  }

  /**
   * Set god ray color tint.
   * @param {number} r 0-1
   * @param {number} g 0-1
   * @param {number} b 0-1
   */
  setGodRayColor(r, g, b) {
    this._godRayPass.setRayColor(r, g, b);
  }

  /**
   * Enable or disable the tilt-shift blur (both horizontal and vertical passes).
   * @param {boolean} enabled
   */
  setTiltShiftEnabled(enabled) {
    this.tiltShiftHPass.enabled = enabled;
    this.tiltShiftVPass.enabled = enabled;
  }

  /**
   * Enable or disable the color grading + vignette pass.
   * @param {boolean} enabled
   */
  setColorGradeEnabled(enabled) {
    this.colorGradePass.enabled = enabled;
  }

  // ── Parameter Adjustment ──

  /**
   * Update SSAO parameters.
   * @param {Object} params
   * @param {number} [params.radius] - Sample hemisphere radius (default 0.5)
   * @param {number} [params.intensity] - Occlusion intensity multiplier (default 1.5)
   * @param {number} [params.distanceFalloff] - Range check falloff (default 1.0)
   */
  setSSAOParams({ radius, intensity, distanceFalloff } = {}) {
    if (radius !== undefined) {
      this.ssaoPass.uniforms.aoRadius.value = radius;
    }
    if (intensity !== undefined) {
      this.ssaoPass.uniforms.aoIntensity.value = intensity;
    }
    if (distanceFalloff !== undefined) {
      this.ssaoPass.uniforms.distanceFalloff.value = distanceFalloff;
    }
  }

  /**
   * Update bloom parameters.
   * @param {Object} params
   * @param {number} [params.strength] - Bloom strength (default 0.4)
   * @param {number} [params.radius] - Bloom radius (default 0.5)
   * @param {number} [params.threshold] - Luminance threshold (default 0.8)
   */
  setBloomParams({ strength, radius, threshold } = {}) {
    if (strength !== undefined) {
      this.bloomPass.strength = strength;
    }
    if (radius !== undefined) {
      this.bloomPass.radius = radius;
    }
    if (threshold !== undefined) {
      this.bloomPass.threshold = threshold;
    }
  }

  /**
   * Set just the bloom strength. Convenience for per-system tuning.
   * @param {number} strength
   */
  setBloomStrength(strength) {
    this.bloomPass.strength = strength;
  }

  /**
   * Set just the bloom luminance threshold. Convenience for per-system tuning.
   * @param {number} threshold
   */
  setBloomThreshold(threshold) {
    this.bloomPass.threshold = threshold;
  }

  /**
   * Update tilt-shift parameters (applied to both horizontal and vertical passes).
   * @param {Object} params
   * @param {number} [params.focusCenter] - Screen Y center of the focus band (0-1, default 0.5)
   * @param {number} [params.focusWidth] - Fraction of screen height that stays sharp (default 0.4)
   * @param {number} [params.maxBlur] - Maximum blur radius in pixels (default 4.0)
   */
  setTiltShiftParams({ focusCenter, focusWidth, maxBlur } = {}) {
    if (focusCenter !== undefined) {
      this.tiltShiftHPass.uniforms.focusCenter.value = focusCenter;
      this.tiltShiftVPass.uniforms.focusCenter.value = focusCenter;
    }
    if (focusWidth !== undefined) {
      this.tiltShiftHPass.uniforms.focusWidth.value = focusWidth;
      this.tiltShiftVPass.uniforms.focusWidth.value = focusWidth;
    }
    if (maxBlur !== undefined) {
      this.tiltShiftHPass.uniforms.maxBlur.value = maxBlur;
      this.tiltShiftVPass.uniforms.maxBlur.value = maxBlur;
    }
  }

  /**
   * Update color grading and vignette parameters.
   * @param {Object} params
   * @param {number} [params.saturation] - Saturation multiplier (1.0 neutral, default 1.15 = +15%)
   * @param {number} [params.warmth] - 0 = cool night tint, 1 = warm day tint (default 0.5)
   * @param {number} [params.vignetteIntensity] - Edge darkening strength (default 0.3)
   * @param {number} [params.contrast] - Contrast multiplier (default 1.1)
   */
  setColorGradeParams({ saturation, warmth, vignetteIntensity, contrast } = {}) {
    if (saturation !== undefined) {
      this.colorGradePass.uniforms.saturation.value = saturation;
    }
    if (warmth !== undefined) {
      this.colorGradePass.uniforms.warmth.value = warmth;
    }
    if (vignetteIntensity !== undefined) {
      this.colorGradePass.uniforms.vignetteIntensity.value = vignetteIntensity;
      this._savedVignetteIntensity = vignetteIntensity;
    }
    if (contrast !== undefined) {
      this.colorGradePass.uniforms.contrast.value = contrast;
    }
  }

  // ── Time of Day ──

  /**
   * Called by the time-of-day system to adjust color grading warmth.
   * Maps hour (0-24) to warmth uniform:
   *   Night (0-5, 20-24): cool (warmth ~ 0.0-0.2)
   *   Dawn/Dusk (5-8, 17-20): warm (warmth ~ 0.7-1.0)
   *   Day (8-17): neutral-warm (warmth ~ 0.5-0.7)
   * @param {number} hour - Hour of day (0-24)
   */
  setTimeOfDay(hour) {
    const h = Math.max(0, Math.min(24, hour));
    let warmth;

    if (h < 5 || h >= 21) {
      // Deep night: cool blue tones
      warmth = 0.05;
    } else if (h < 6) {
      // Pre-dawn: transitioning from cool to warm
      warmth = 0.05 + (h - 5) * 0.45; // 0.05 -> 0.5
    } else if (h < 8) {
      // Dawn golden hour: warmest
      warmth = 0.5 + (h - 6) * 0.25; // 0.5 -> 1.0
    } else if (h < 10) {
      // Morning: settling from golden hour to daytime
      warmth = 1.0 - (h - 8) * 0.2; // 1.0 -> 0.6
    } else if (h < 16) {
      // Midday: neutral warm
      warmth = 0.6;
    } else if (h < 18) {
      // Afternoon: warming toward golden hour
      warmth = 0.6 + (h - 16) * 0.2; // 0.6 -> 1.0
    } else if (h < 20) {
      // Dusk golden hour: warm, fading to cool
      warmth = 1.0 - (h - 18) * 0.4; // 1.0 -> 0.2
    } else {
      // Early night: cool
      warmth = 0.2 - (h - 20) * 0.15; // 0.2 -> 0.05
    }

    this.colorGradePass.uniforms.warmth.value = Math.max(0, Math.min(1, warmth));
  }

  // ── Rendering ──

  /**
   * Synchronize camera projection uniforms used by the SSAO shader.
   * Called automatically before each render; can also be called manually
   * after camera changes.
   * @private
   */
  _syncCameraUniforms() {
    const cam = this.camera;
    this.ssaoPass.uniforms.cameraNear.value = cam.near;
    this.ssaoPass.uniforms.cameraFar.value = cam.far;
    this.ssaoPass.uniforms.cameraProjection.value.copy(cam.projectionMatrix);
    this.ssaoPass.uniforms.cameraInverseProjection.value.copy(cam.projectionMatrixInverse);
  }

  /**
   * Render the full post-processing pipeline.
   * This replaces `renderer.render(scene, camera)` in the main loop.
   */
  render() {
    try {
      // Update camera-dependent SSAO uniforms each frame
      this._syncCameraUniforms();

      // Depth pre-pass: render scene depth into the depth texture
      if (this.ssaoPass.enabled) {
        const originalOverrideMaterial = this.scene.overrideMaterial;
        this.scene.overrideMaterial = this.depthMaterial;
        this.renderer.setRenderTarget(this.depthRenderTarget);
        this.renderer.render(this.scene, this.camera);
        this.scene.overrideMaterial = originalOverrideMaterial;
        this.renderer.setRenderTarget(null);
      }

      // Run the full post-processing chain
      this.composer.render();
    } catch (err) {
      // Fallback to direct rendering if post-processing fails
      if (!this._renderErrorLogged) {
        console.error('[PostProcessing] render error, falling back to direct:', err);
        this._renderErrorLogged = true;
      }
      this.renderer.setRenderTarget(null);
      this.renderer.render(this.scene, this.camera);
    }
  }

  // ── Resize ──

  /**
   * Handle viewport resize. Updates all render targets, passes, and resolution uniforms.
   * @param {number} width
   * @param {number} height
   */
  resize(width, height) {
    // EffectComposer and its internal render targets
    this.composer.setSize(width, height);

    // Depth pre-pass render target
    this.depthRenderTarget.setSize(width, height);

    // SSAO resolution-dependent uniforms
    this.ssaoPass.uniforms.resolution.value.set(width, height);
    this.ssaoPass.uniforms.noiseScale.value.set(width / 4.0, height / 4.0);

    // God rays half-res target
    if (this._godRayPass) {
      this._godRayPass.resize(width, height);
    }

    // Bloom resolution
    this.bloomPass.resolution.set(width, height);

    // Tilt-shift resolution
    this.tiltShiftHPass.uniforms.resolution.value.set(width, height);
    this.tiltShiftVPass.uniforms.resolution.value.set(width, height);
  }

  // ── Cleanup ──

  /**
   * Dispose of all GPU resources held by this pipeline.
   */
  dispose() {
    // Dispose the composer (frees its internal render targets)
    if (this.composer) {
      this.composer.dispose();
    }

    // Dispose the depth pre-pass render target and its depth texture
    if (this.depthRenderTarget) {
      if (this.depthRenderTarget.depthTexture) {
        this.depthRenderTarget.depthTexture.dispose();
      }
      this.depthRenderTarget.dispose();
    }

    // Dispose the depth material
    if (this.depthMaterial) {
      this.depthMaterial.dispose();
    }

    // Dispose the SSAO noise texture
    if (this._ssaoNoise) {
      this._ssaoNoise.dispose();
    }

    // Dispose god ray resources
    if (this._godRayPass) {
      this._godRayPass.dispose();
      this._godRayPass = null;
    }

    // Dispose individual passes that have dispose methods
    const passes = [
      this.renderPass,
      this.ssaoPass,
      this.godRayComposerPass,
      this.bloomPass,
      this.tiltShiftHPass,
      this.tiltShiftVPass,
      this.colorGradePass,
      this.outputPass,
    ];
    for (const pass of passes) {
      if (pass && typeof pass.dispose === 'function') {
        pass.dispose();
      }
    }

    // Null out references
    this.composer = null;
    this.depthRenderTarget = null;
    this.depthMaterial = null;
    this._ssaoKernel = null;
    this._ssaoNoise = null;
    this.renderPass = null;
    this.ssaoPass = null;
    this.bloomPass = null;
    this.tiltShiftHPass = null;
    this.tiltShiftVPass = null;
    this.colorGradePass = null;
    this.outputPass = null;
  }
}
