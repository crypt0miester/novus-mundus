/**
 * GPU-driven particle system for town diorama.
 *
 * All animation runs in vertex shaders — the CPU updates ONE uniform (`time`)
 * per emitter per frame.  Zero per-particle CPU work.
 *
 * Exports:
 *   - GPUParticleSystem  — high-level manager (create/remove/update emitters)
 *   - ParticleEmitter     — low-level single-emitter wrapper around THREE.Points
 */

import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

const _v3 = new THREE.Vector3();

/** Deterministic-ish pseudo-random from a seed integer. */
function seededRandom(seed) {
  let s = (seed * 16807 + 2147483647) & 0x7fffffff;
  return (s & 0xffffff) / 0xffffff;
}

/** Parse a hex color string (#RGB or #RRGGBB) into a THREE.Color. */
function parseColor(c) {
  if (c instanceof THREE.Color) return c.clone();
  return new THREE.Color(c);
}

/** Linear interpolation between two THREE.Color instances, returns [r,g,b]. */
function lerpColorArray(a, b, t) {
  return [
    a.r + (b.r - a.r) * t,
    a.g + (b.g - a.g) * t,
    a.b + (b.b - a.b) * t,
  ];
}

// ---------------------------------------------------------------------------
// Shader chunks shared across all particle types
// ---------------------------------------------------------------------------

const COMMON_VERTEX_HEADER = /* glsl */ `
  uniform float time;
  uniform vec3 windDir;
  uniform float windStr;
  uniform float windFactor;
  uniform float buoyancy;
  uniform float turbFreq;
  uniform float turbAmp;
  uniform float startSize;
  uniform float endSize;
  uniform float pixelRatio;

  attribute float birthTime;
  attribute float lifetime;
  attribute vec3 velocity;
  attribute vec3 emitPos;

  varying float vAlpha;
  varying float vT;
  varying float vAge;
  varying float vBirthTime;
`;

const STANDARD_VERTEX_BODY = /* glsl */ `
  void main() {
    float age = mod(time - birthTime, lifetime);
    float t = age / lifetime;

    vec3 pos = emitPos + velocity * age;
    pos.y += buoyancy * age * age;

    // Turbulence
    pos.x += sin(age * turbFreq + birthTime) * turbAmp;
    pos.z += cos(age * turbFreq * 0.7 + birthTime) * turbAmp;

    // Wind
    pos += windDir * windStr * age * windFactor;

    gl_PointSize = mix(startSize, endSize, t) * (1.0 - t * 0.5) * pixelRatio;
    vAlpha = 1.0 - smoothstep(0.6, 1.0, t);
    vT = t;
    vAge = age;
    vBirthTime = birthTime;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

const FIREFLY_VERTEX_BODY = /* glsl */ `
  void main() {
    float age = mod(time - birthTime, lifetime);
    float t = age / lifetime;

    vec3 pos = emitPos + velocity * age;
    pos.y += buoyancy * age * age;

    pos.x += sin(age * turbFreq + birthTime) * turbAmp;
    pos.z += cos(age * turbFreq * 0.7 + birthTime) * turbAmp;

    pos += windDir * windStr * age * windFactor;

    gl_PointSize = startSize * pixelRatio;

    // Random blink
    float blink = step(0.5, sin(time * 5.0 + birthTime * 17.0));
    vAlpha = blink * (1.0 - smoothstep(0.7, 1.0, t));
    vT = t;
    vAge = age;
    vBirthTime = birthTime;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

const WATER_SPARKLE_VERTEX_BODY = /* glsl */ `
  void main() {
    float age = mod(time - birthTime, lifetime);
    float t = age / lifetime;

    vec3 pos = emitPos;
    pos += windDir * windStr * age * windFactor;

    gl_PointSize = startSize * pixelRatio;

    // Random sparkle
    float sparkle = step(0.7, sin(time * 8.0 + birthTime * 23.0));
    vAlpha = sparkle * (1.0 - smoothstep(0.8, 1.0, t));
    vT = t;
    vAge = age;
    vBirthTime = birthTime;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

const RAIN_VERTEX_BODY = /* glsl */ `
  void main() {
    float age = mod(time - birthTime, lifetime);
    float t = age / lifetime;

    vec3 pos = emitPos + velocity * age;
    pos.y += buoyancy * age * age;

    // Wind sway
    pos += windDir * windStr * age * windFactor;

    // Large point size so the fragment shader can draw a visible streak
    gl_PointSize = startSize * pixelRatio;

    // Fade in quickly, hold, fade out at end of life
    float fadeIn = smoothstep(0.0, 0.05, t);
    float fadeOut = 1.0 - smoothstep(0.8, 1.0, t);
    vAlpha = fadeIn * fadeOut * 0.7;
    vT = t;
    vAge = age;
    vBirthTime = birthTime;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

const TORCH_VERTEX_BODY = /* glsl */ `
  void main() {
    float age = mod(time - birthTime, lifetime);
    float t = age / lifetime;

    vec3 pos = emitPos + velocity * age;
    pos.y += buoyancy * age * age;

    // Rapid jitter for flame
    pos.x += sin(age * turbFreq + birthTime) * turbAmp;
    pos.z += cos(age * turbFreq * 0.7 + birthTime) * turbAmp;

    pos += windDir * windStr * age * windFactor;

    // Flicker size
    float flicker = 0.85 + 0.15 * sin(time * 12.0 + birthTime * 7.0);
    gl_PointSize = mix(startSize, endSize, t) * flicker * (1.0 - t * 0.3) * pixelRatio;

    vAlpha = (1.0 - smoothstep(0.5, 1.0, t)) * flicker;
    vT = t;
    vAge = age;
    vBirthTime = birthTime;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

// ---- Fragment shaders ----

const STANDARD_FRAGMENT = /* glsl */ `
  uniform vec3 startColor;
  uniform vec3 endColor;

  varying float vAlpha;
  varying float vT;
  varying float vAge;
  varying float vBirthTime;

  void main() {
    // Circular soft particle
    vec2 uv = gl_PointCoord * 2.0 - 1.0;
    float dist = dot(uv, uv);
    if (dist > 1.0) discard;

    float edgeFade = 1.0 - smoothstep(0.3, 1.0, dist);
    vec3 col = mix(startColor, endColor, vT);

    gl_FragColor = vec4(col, vAlpha * edgeFade);
  }
`;

const SMOKE_FRAGMENT = /* glsl */ `
  uniform vec3 startColor;
  uniform vec3 endColor;
  uniform sampler2D uParticleTex;
  uniform float uHasParticleTex;

  varying float vAlpha;
  varying float vT;
  varying float vAge;
  varying float vBirthTime;

  void main() {
    vec2 uv = gl_PointCoord * 2.0 - 1.0;
    float dist = dot(uv, uv);
    if (dist > 1.0) discard;

    // Softer, puffier fade for smoke
    float edgeFade = 1.0 - smoothstep(0.1, 1.0, dist);
    // Noise-like variation using birth time
    float noisyAlpha = vAlpha * (0.6 + 0.4 * sin(vBirthTime * 13.7 + vT * 6.28));
    vec3 col = mix(startColor, endColor, vT);

    // Sample particle texture when available — blend with procedural shape
    if (uHasParticleTex > 0.5) {
      vec4 texSample = texture2D(uParticleTex, gl_PointCoord);
      noisyAlpha *= texSample.a;
      col *= texSample.rgb;
    }

    gl_FragColor = vec4(col, noisyAlpha * edgeFade);
  }
`;

const SPARK_FRAGMENT = /* glsl */ `
  uniform vec3 startColor;
  uniform vec3 endColor;

  varying float vAlpha;
  varying float vT;
  varying float vAge;
  varying float vBirthTime;

  void main() {
    vec2 uv = gl_PointCoord * 2.0 - 1.0;
    float dist = dot(uv, uv);
    if (dist > 1.0) discard;

    // Hard bright core, fast falloff
    float core = 1.0 - smoothstep(0.0, 0.4, dist);
    float glow = (1.0 - smoothstep(0.0, 1.0, dist)) * 0.5;
    float edgeFade = core + glow;

    vec3 col = mix(startColor, endColor, vT);
    gl_FragColor = vec4(col, vAlpha * edgeFade);
  }
`;

const RAIN_FRAGMENT = /* glsl */ `
  uniform vec3 startColor;
  uniform vec3 endColor;

  varying float vAlpha;
  varying float vT;
  varying float vAge;
  varying float vBirthTime;

  void main() {
    vec2 uv = gl_PointCoord * 2.0 - 1.0;

    // Narrow vertical streak: tight on X, elongated on Y
    float xFade = 1.0 - smoothstep(0.0, 0.15, abs(uv.x));
    // Tapered — thinner at bottom, wider at top
    float yFade = smoothstep(-1.0, -0.8, uv.y) * (1.0 - smoothstep(0.9, 1.0, uv.y));

    float mask = xFade * yFade;
    if (mask < 0.02) discard;

    // Bright core along center line
    float core = exp(-abs(uv.x) * 20.0) * 0.4;
    mask = min(1.0, mask + core);

    vec3 col = mix(startColor, endColor, vT);
    gl_FragColor = vec4(col, vAlpha * mask);
  }
`;

const SNOW_VERTEX_BODY = /* glsl */ `
  void main() {
    float age = mod(time - birthTime, lifetime);
    float t = age / lifetime;

    vec3 pos = emitPos + velocity * age;
    pos.y += buoyancy * age * age;

    // Gentle wobble for realistic flutter
    float wobble = sin(age * turbFreq + birthTime * 6.28) * turbAmp;
    pos.x += wobble;
    pos.z += cos(age * turbFreq * 0.6 + birthTime * 3.14) * turbAmp * 0.7;

    // Wind
    pos += windDir * windStr * age * windFactor;

    // Slight size variation per flake
    float sizeVar = 0.7 + 0.6 * fract(sin(birthTime * 91.3) * 43758.5);
    gl_PointSize = startSize * sizeVar * pixelRatio;

    float fadeIn = smoothstep(0.0, 0.1, t);
    float fadeOut = 1.0 - smoothstep(0.75, 1.0, t);
    vAlpha = fadeIn * fadeOut * 0.85;
    vT = t;
    vAge = age;
    vBirthTime = birthTime;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

const SNOW_FRAGMENT = /* glsl */ `
  uniform vec3 startColor;
  uniform vec3 endColor;

  varying float vAlpha;
  varying float vT;
  varying float vAge;
  varying float vBirthTime;

  void main() {
    vec2 uv = gl_PointCoord * 2.0 - 1.0;
    float dist = dot(uv, uv);
    if (dist > 1.0) discard;

    // Soft snowflake: bright core with gentle falloff
    float core = 1.0 - smoothstep(0.0, 0.3, dist);
    float glow = (1.0 - smoothstep(0.0, 1.0, dist)) * 0.6;
    float edgeFade = core + glow;

    vec3 col = mix(startColor, endColor, vT);
    gl_FragColor = vec4(col, vAlpha * edgeFade);
  }
`;

const MOTE_FRAGMENT = /* glsl */ `
  uniform vec3 startColor;
  uniform vec3 endColor;

  varying float vAlpha;
  varying float vT;
  varying float vAge;
  varying float vBirthTime;

  void main() {
    vec2 uv = gl_PointCoord * 2.0 - 1.0;
    float dist = dot(uv, uv);
    if (dist > 1.0) discard;

    // Glowy halo
    float core = 1.0 - smoothstep(0.0, 0.3, dist);
    float halo = (1.0 - smoothstep(0.0, 1.0, dist)) * 0.4;
    float edgeFade = core + halo;

    vec3 col = mix(startColor, endColor, vT);
    gl_FragColor = vec4(col, vAlpha * edgeFade);
  }
`;

const TORCH_FRAGMENT = /* glsl */ `
  uniform vec3 startColor;
  uniform vec3 endColor;
  uniform sampler2D uParticleTex;
  uniform float uHasParticleTex;

  varying float vAlpha;
  varying float vT;
  varying float vAge;
  varying float vBirthTime;

  void main() {
    vec2 uv = gl_PointCoord * 2.0 - 1.0;
    float dist = dot(uv, uv);
    if (dist > 1.0) discard;

    // Bright flame core with soft halo
    float core = 1.0 - smoothstep(0.0, 0.25, dist);
    float mid  = (1.0 - smoothstep(0.0, 0.6, dist)) * 0.7;
    float halo = (1.0 - smoothstep(0.0, 1.0, dist)) * 0.3;
    float edgeFade = core + mid + halo;

    // Hot core is whiter
    vec3 col = mix(startColor, endColor, vT);
    col = mix(col, vec3(1.0, 0.95, 0.8), core * 0.6);

    // Sample particle texture when available — modulate flame shape
    if (uHasParticleTex > 0.5) {
      vec4 texSample = texture2D(uParticleTex, gl_PointCoord);
      edgeFade *= texSample.a;
      col *= mix(vec3(1.0), texSample.rgb, 0.5);
    }

    gl_FragColor = vec4(col, vAlpha * edgeFade);
  }
`;

// ---------------------------------------------------------------------------
// Falling leaves — uses InstancedMesh with small quads so they can tumble
// ---------------------------------------------------------------------------

const LEAF_VERTEX_SHADER = /* glsl */ `
  uniform float time;
  uniform vec3 windDir;
  uniform float windStr;
  uniform float windFactor;
  uniform float buoyancy;
  uniform float turbFreq;
  uniform float turbAmp;

  // Per-instance attributes packed into instanceMatrix already exist.
  // We add custom attributes via InstancedBufferAttribute.
  attribute float birthTime;
  attribute float lifetime;
  attribute vec3 velocity;
  attribute vec3 emitPos;
  attribute vec3 leafColor;
  attribute float tumbleSpeed;

  varying float vAlpha;
  varying vec3 vColor;

  void main() {
    float age = mod(time - birthTime, lifetime);
    float t = age / lifetime;

    vec3 pos = emitPos + velocity * age;
    pos.y += buoyancy * age * age;

    // Turbulent drift
    pos.x += sin(age * turbFreq + birthTime) * turbAmp;
    pos.z += cos(age * turbFreq * 0.7 + birthTime) * turbAmp;

    // Wind
    pos += windDir * windStr * age * windFactor;

    // Tumble rotation — rotate the quad vertex around the center
    float angle = age * tumbleSpeed + birthTime * 3.14159;
    float ca = cos(angle);
    float sa = sin(angle);

    // position is the local quad vertex (from geometry)
    vec3 localPos = position;
    vec3 rotated = vec3(
      localPos.x * ca - localPos.y * sa,
      localPos.x * sa + localPos.y * ca,
      localPos.z
    );

    // Billboard: align rotated quad to face camera
    vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
    mvPos.xy += rotated.xy * 0.02; // Scale quad in view space

    vAlpha = 1.0 - smoothstep(0.7, 1.0, t);
    vColor = leafColor;

    gl_Position = projectionMatrix * mvPos;
  }
`;

const LEAF_FRAGMENT_SHADER = /* glsl */ `
  varying float vAlpha;
  varying vec3 vColor;

  void main() {
    // Simple filled quad with soft edges
    vec2 uv = gl_PointCoord;
    // For instanced mesh, use varying uv from vertex
    // The geometry already has its own shape — just color it
    gl_FragColor = vec4(vColor, vAlpha);
  }
`;

// ---------------------------------------------------------------------------
// Preset definitions
// ---------------------------------------------------------------------------

const PRESETS = {
  'forge-smoke': {
    count: 40,
    lifetime: 3.0,
    lifetimeVariance: 0.5,
    buoyancy: 0.3,
    turbFreq: 2.0,
    turbAmp: 0.1,
    startSize: 8.0,
    endSize: 20.0,
    startColor: '#444444',
    endColor: '#888888',
    emitRadius: 0.03,
    emitShape: 'sphere',
    velocityMin: [0, 0.05, 0],
    velocityMax: [0, 0.12, 0],
    windFactor: 0.8,
    blending: 'normal',
    depthWrite: false,
    vertexBody: STANDARD_VERTEX_BODY,
    fragment: SMOKE_FRAGMENT,
  },

  'forge-sparks': {
    count: 20,
    lifetime: 1.2,
    lifetimeVariance: 0.4,
    buoyancy: -0.5,
    turbFreq: 0.0,
    turbAmp: 0.0,
    startSize: 3.0,
    endSize: 1.0,
    startColor: '#FF8800',
    endColor: '#FF2200',
    emitRadius: 0.02,
    emitShape: 'sphere',
    velocityMin: [-0.15, 0.2, -0.15],
    velocityMax: [0.15, 0.4, 0.15],
    windFactor: 0.1,
    blending: 'additive',
    depthWrite: false,
    vertexBody: STANDARD_VERTEX_BODY,
    fragment: SPARK_FRAGMENT,
  },

  'chimney-smoke': {
    count: 8,
    lifetime: 4.0,
    lifetimeVariance: 1.0,
    buoyancy: 0.2,
    turbFreq: 1.5,
    turbAmp: 0.05,
    startSize: 4.0,
    endSize: 12.0,
    startColor: '#999999',
    endColor: '#CCCCCC',
    emitRadius: 0.01,
    emitShape: 'sphere',
    velocityMin: [0, 0.02, 0],
    velocityMax: [0, 0.06, 0],
    windFactor: 1.0,
    blending: 'normal',
    depthWrite: false,
    vertexBody: STANDARD_VERTEX_BODY,
    fragment: SMOKE_FRAGMENT,
  },

  'sanctuary-motes': {
    count: 50,
    lifetime: 5.0,
    lifetimeVariance: 1.5,
    buoyancy: 0.1,
    turbFreq: 3.0,
    turbAmp: 0.15,
    startSize: 2.0,
    endSize: 4.0,
    startColor: '#FFFFFF',
    endColor: '#FFD700',
    emitRadius: 0.2,
    emitShape: 'sphere',
    velocityMin: [-0.02, 0.01, -0.02],
    velocityMax: [0.02, 0.04, 0.02],
    windFactor: 0.3,
    blending: 'additive',
    depthWrite: false,
    vertexBody: STANDARD_VERTEX_BODY,
    fragment: MOTE_FRAGMENT,
  },

  'fireflies': {
    count: 40,
    lifetime: 4.0,
    lifetimeVariance: 1.5,
    buoyancy: 0.0,
    turbFreq: 5.0,
    turbAmp: 0.3,
    startSize: 3.0,
    endSize: 3.0,
    startColor: '#AAFF00',
    endColor: '#AAFF00',
    emitRadius: 0.4,
    emitShape: 'sphere',
    velocityMin: [-0.03, -0.01, -0.03],
    velocityMax: [0.03, 0.01, 0.03],
    windFactor: 0.1,
    blending: 'additive',
    depthWrite: false,
    vertexBody: FIREFLY_VERTEX_BODY,
    fragment: MOTE_FRAGMENT,
  },

  'water-sparkle': {
    count: 25,
    lifetime: 2.0,
    lifetimeVariance: 0.8,
    buoyancy: 0.0,
    turbFreq: 0.0,
    turbAmp: 0.0,
    startSize: 2.0,
    endSize: 2.0,
    startColor: '#FFFFFF',
    endColor: '#FFFFFF',
    emitRadius: 0.15,
    emitShape: 'disc',
    velocityMin: [0, 0, 0],
    velocityMax: [0, 0, 0],
    windFactor: 0.0,
    blending: 'additive',
    depthWrite: false,
    vertexBody: WATER_SPARKLE_VERTEX_BODY,
    fragment: STANDARD_FRAGMENT,
  },

  'dust-motes': {
    count: 12,
    lifetime: 6.0,
    lifetimeVariance: 2.0,
    buoyancy: 0.02,
    turbFreq: 2.0,
    turbAmp: 0.1,
    startSize: 2.0,
    endSize: 3.0,
    startColor: '#C4A882',
    endColor: '#C4A882',
    emitRadius: 0.3,
    emitShape: 'sphere',
    velocityMin: [-0.01, 0.005, -0.01],
    velocityMax: [0.01, 0.015, 0.01],
    windFactor: 0.6,
    blending: 'normal',
    depthWrite: false,
    vertexBody: STANDARD_VERTEX_BODY,
    fragment: STANDARD_FRAGMENT,
  },

  'construction-sparks': {
    count: 8,
    lifetime: 0.8,
    lifetimeVariance: 0.3,
    buoyancy: -0.3,
    turbFreq: 0.0,
    turbAmp: 0.0,
    startSize: 2.0,
    endSize: 1.0,
    startColor: '#FFAA00',
    endColor: '#FF4400',
    emitRadius: 0.01,
    emitShape: 'sphere',
    velocityMin: [-0.2, 0.15, -0.2],
    velocityMax: [0.2, 0.35, 0.2],
    windFactor: 0.05,
    blending: 'additive',
    depthWrite: false,
    vertexBody: STANDARD_VERTEX_BODY,
    fragment: SPARK_FRAGMENT,
  },

  'rain': {
    count: 10000,
    lifetime: 0.8,
    lifetimeVariance: 0.2,
    buoyancy: -12.0,
    turbFreq: 0.5,
    turbAmp: 0.01,
    startSize: 16.0,
    endSize: 16.0,
    startColor: '#8899AA',
    endColor: '#8899AA',
    emitRadius: 8.0,
    emitShape: 'box',
    emitHeight: 5.0,
    velocityMin: [-0.01, -2.0, -0.01],
    velocityMax: [0.01, -1.2, 0.01],
    windFactor: 0.6,
    blending: 'normal',
    depthWrite: false,
    vertexBody: RAIN_VERTEX_BODY,
    fragment: RAIN_FRAGMENT,
  },

  'snow': {
    count: 5000,
    lifetime: 8.0,
    lifetimeVariance: 3.0,
    buoyancy: -0.3,
    turbFreq: 1.5,
    turbAmp: 0.4,
    startSize: 5.0,
    endSize: 5.0,
    startColor: '#EEEEFF',
    endColor: '#FFFFFF',
    emitRadius: 8.0,
    emitShape: 'box',
    emitHeight: 5.0,
    velocityMin: [-0.04, -0.08, -0.04],
    velocityMax: [0.04, -0.03, 0.04],
    windFactor: 0.8,
    blending: 'normal',
    depthWrite: false,
    vertexBody: SNOW_VERTEX_BODY,
    fragment: SNOW_FRAGMENT,
  },

  'falling-leaves': {
    count: 8,
    lifetime: 5.0,
    lifetimeVariance: 1.5,
    buoyancy: -0.2,
    turbFreq: 4.0,
    turbAmp: 0.2,
    startSize: 5.0,
    endSize: 5.0,
    startColor: '#8B4513',
    endColor: '#2D6B30',
    leafColors: ['#8B4513', '#A0522D', '#2D6B30', '#4A7C2F', '#C8A23D'],
    emitRadius: 0.5,
    emitShape: 'sphere',
    emitHeight: 0.5,
    velocityMin: [-0.05, -0.01, -0.05],
    velocityMax: [0.05, 0.01, 0.05],
    windFactor: 0.9,
    blending: 'normal',
    depthWrite: false,
    useInstancedMesh: true,
    vertexShader: LEAF_VERTEX_SHADER,
    fragmentShader: LEAF_FRAGMENT_SHADER,
  },

  'mining-dust': {
    count: 12,
    lifetime: 2.0,
    lifetimeVariance: 0.5,
    buoyancy: 0.05,
    turbFreq: 3.0,
    turbAmp: 0.15,
    startSize: 4.0,
    endSize: 8.0,
    startColor: '#888888',
    endColor: '#AAAAAA',
    emitRadius: 0.05,
    emitShape: 'sphere',
    velocityMin: [-0.15, 0.02, -0.15],
    velocityMax: [0.15, 0.08, 0.15],
    windFactor: 0.4,
    blending: 'normal',
    depthWrite: false,
    vertexBody: STANDARD_VERTEX_BODY,
    fragment: SMOKE_FRAGMENT,
  },

  'torch-fire': {
    count: 1,
    lifetime: 0.6,
    lifetimeVariance: 0.15,
    buoyancy: 0.5,
    turbFreq: 8.0,
    turbAmp: 0.02,
    startSize: 6.0,
    endSize: 8.0,
    startColor: '#FF6600',
    endColor: '#FFCC00',
    emitRadius: 0.005,
    emitShape: 'sphere',
    velocityMin: [-0.01, 0.05, -0.01],
    velocityMax: [0.01, 0.12, 0.01],
    windFactor: 0.2,
    blending: 'additive',
    depthWrite: false,
    // Torch always gets a minimum particle count to fill the flame
    minCount: 12,
    vertexBody: TORCH_VERTEX_BODY,
    fragment: TORCH_FRAGMENT,
  },
};

// ---------------------------------------------------------------------------
// ParticleEmitter — wraps a single THREE.Points (or InstancedMesh for leaves)
// ---------------------------------------------------------------------------

export class ParticleEmitter {
  /**
   * @param {object} config — merged preset + user overrides
   *   { count, lifetime, lifetimeVariance, buoyancy, turbFreq, turbAmp,
   *     startSize, endSize, startColor, endColor, emitRadius, emitShape,
   *     velocityMin, velocityMax, windFactor, blending, depthWrite,
   *     vertexBody, fragment, useInstancedMesh, ... }
   */
  constructor(config) {
    this._config = config;
    this._active = true;
    this._position = new THREE.Vector3();

    if (config.useInstancedMesh) {
      this._buildInstancedLeaves(config);
    } else {
      this._buildPoints(config);
    }
  }

  // ---------- public ----------

  /** The renderable object (THREE.Points or THREE.Mesh) to add to a scene. */
  get mesh() {
    return this._mesh;
  }

  /** Move the emitter origin (updates the Object3D position). */
  setPosition(pos) {
    if (pos.isVector3) {
      this._position.copy(pos);
    } else {
      this._position.set(pos.x ?? pos[0] ?? 0, pos.y ?? pos[1] ?? 0, pos.z ?? pos[2] ?? 0);
    }
    this._mesh.position.copy(this._position);
  }

  /** Show / hide without destroying. */
  setActive(active) {
    this._active = !!active;
    this._mesh.visible = this._active;
  }

  /** Per-frame: update the `time` uniform and optionally wind. */
  updateTime(time, windDir, windStr) {
    const u = this._mesh.material.uniforms;
    u.time.value = time;
    if (windDir !== undefined) {
      u.windDir.value.set(
        windDir.x ?? windDir[0] ?? 0,
        windDir.y ?? windDir[1] ?? 0,
        windDir.z ?? windDir[2] ?? 0,
      );
    }
    if (windStr !== undefined) {
      u.windStr.value = windStr;
    }
  }

  /** Dispose GPU resources. */
  dispose() {
    if (this._mesh) {
      if (this._mesh.geometry) this._mesh.geometry.dispose();
      if (this._mesh.material) this._mesh.material.dispose();
      if (this._mesh.parent) this._mesh.parent.remove(this._mesh);
      this._mesh = null;
    }
  }

  // ---------- internal: standard Points ----------

  _buildPoints(cfg) {
    const count = Math.max(cfg.minCount || 0, cfg.count);
    const lt = cfg.lifetime;
    const ltVar = cfg.lifetimeVariance || 0;
    const emitR = cfg.emitRadius || 0;
    const emitH = cfg.emitHeight || 0;
    const vMin = cfg.velocityMin || [0, 0, 0];
    const vMax = cfg.velocityMax || [0, 0, 0];

    // Attribute arrays
    const birthTimes = new Float32Array(count);
    const lifetimes = new Float32Array(count);
    const velocities = new Float32Array(count * 3);
    const emitPositions = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
      const seed = i;

      // Stagger birth times across the full lifetime so particles are
      // uniformly distributed in time from the very first frame.
      const baseLT = lt + (seededRandom(seed * 3 + 1) * 2.0 - 1.0) * ltVar;
      const clampedLT = Math.max(0.1, baseLT);
      lifetimes[i] = clampedLT;

      // Stagger births so all particles don't pop in at once
      birthTimes[i] = -(seededRandom(seed * 7 + 2)) * clampedLT;

      // Velocity: random between min and max
      const r0 = seededRandom(seed * 11 + 3);
      const r1 = seededRandom(seed * 13 + 5);
      const r2 = seededRandom(seed * 17 + 7);
      velocities[i * 3 + 0] = vMin[0] + (vMax[0] - vMin[0]) * r0;
      velocities[i * 3 + 1] = vMin[1] + (vMax[1] - vMin[1]) * r1;
      velocities[i * 3 + 2] = vMin[2] + (vMax[2] - vMin[2]) * r2;

      // Emit position: offset from center based on shape
      const rx = seededRandom(seed * 19 + 11);
      const ry = seededRandom(seed * 23 + 13);
      const rz = seededRandom(seed * 29 + 17);
      if (cfg.emitShape === 'box') {
        emitPositions[i * 3 + 0] = (rx * 2.0 - 1.0) * emitR;
        emitPositions[i * 3 + 1] = ry * emitH;
        emitPositions[i * 3 + 2] = (rz * 2.0 - 1.0) * emitR;
      } else if (cfg.emitShape === 'disc') {
        const angle = rx * Math.PI * 2;
        const radius = Math.sqrt(ry) * emitR;
        emitPositions[i * 3 + 0] = Math.cos(angle) * radius;
        emitPositions[i * 3 + 1] = 0;
        emitPositions[i * 3 + 2] = Math.sin(angle) * radius;
      } else {
        // 'sphere' (default)
        const theta = rx * Math.PI * 2;
        const phi = Math.acos(2.0 * ry - 1.0);
        const radius = Math.cbrt(rz) * emitR;
        emitPositions[i * 3 + 0] = Math.sin(phi) * Math.cos(theta) * radius;
        emitPositions[i * 3 + 1] = Math.cos(phi) * radius + ry * emitH;
        emitPositions[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * radius;
      }
    }

    // BufferGeometry with a dummy position attribute (required by Three.js)
    const geometry = new THREE.BufferGeometry();
    // We need a position attribute — set to zeros since emitPos does the work
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    geometry.setAttribute('birthTime', new THREE.BufferAttribute(birthTimes, 1));
    geometry.setAttribute('lifetime', new THREE.BufferAttribute(lifetimes, 1));
    geometry.setAttribute('velocity', new THREE.BufferAttribute(velocities, 3));
    geometry.setAttribute('emitPos', new THREE.BufferAttribute(emitPositions, 3));

    // Shader material
    const startCol = parseColor(cfg.startColor);
    const endCol = parseColor(cfg.endColor);
    const pr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;

    const material = new THREE.ShaderMaterial({
      uniforms: {
        time:       { value: 0.0 },
        windDir:    { value: new THREE.Vector3(1, 0, 0) },
        windStr:    { value: 0.0 },
        windFactor: { value: cfg.windFactor ?? 0.5 },
        buoyancy:   { value: cfg.buoyancy ?? 0.0 },
        turbFreq:   { value: cfg.turbFreq ?? 0.0 },
        turbAmp:    { value: cfg.turbAmp ?? 0.0 },
        startSize:  { value: cfg.startSize ?? 4.0 },
        endSize:    { value: cfg.endSize ?? 4.0 },
        pixelRatio: { value: pr },
        startColor: { value: new THREE.Vector3(startCol.r, startCol.g, startCol.b) },
        endColor:   { value: new THREE.Vector3(endCol.r, endCol.g, endCol.b) },
        uParticleTex:    { value: null },
        uHasParticleTex: { value: 0.0 },
      },
      vertexShader: COMMON_VERTEX_HEADER + (cfg.vertexBody || STANDARD_VERTEX_BODY),
      fragmentShader: cfg.fragment || STANDARD_FRAGMENT,
      transparent: true,
      depthWrite: cfg.depthWrite ?? false,
      blending: cfg.blending === 'additive' ? THREE.AdditiveBlending : THREE.NormalBlending,
    });

    this._mesh = new THREE.Points(geometry, material);
    this._mesh.frustumCulled = false;
    this._mesh.renderOrder = cfg.blending === 'additive' ? 10 : 5;
  }

  // ---------- internal: instanced leaves ----------

  _buildInstancedLeaves(cfg) {
    const count = cfg.count;
    const lt = cfg.lifetime;
    const ltVar = cfg.lifetimeVariance || 0;
    const emitR = cfg.emitRadius || 0;
    const emitH = cfg.emitHeight || 0;
    const vMin = cfg.velocityMin || [0, 0, 0];
    const vMax = cfg.velocityMax || [0, 0, 0];
    const leafColors = cfg.leafColors || ['#8B4513', '#2D6B30'];

    // Small quad geometry for each leaf
    const quadGeo = new THREE.PlaneGeometry(1, 1, 1, 1);

    // Per-instance attributes
    const birthTimes = new Float32Array(count);
    const lifetimes = new Float32Array(count);
    const velocities = new Float32Array(count * 3);
    const emitPositions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const tumbleSpeeds = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      const seed = i;

      const baseLT = lt + (seededRandom(seed * 3 + 1) * 2.0 - 1.0) * ltVar;
      const clampedLT = Math.max(0.1, baseLT);
      lifetimes[i] = clampedLT;
      birthTimes[i] = -(seededRandom(seed * 7 + 2)) * clampedLT;

      const r0 = seededRandom(seed * 11 + 3);
      const r1 = seededRandom(seed * 13 + 5);
      const r2 = seededRandom(seed * 17 + 7);
      velocities[i * 3 + 0] = vMin[0] + (vMax[0] - vMin[0]) * r0;
      velocities[i * 3 + 1] = vMin[1] + (vMax[1] - vMin[1]) * r1;
      velocities[i * 3 + 2] = vMin[2] + (vMax[2] - vMin[2]) * r2;

      const rx = seededRandom(seed * 19 + 11);
      const ry = seededRandom(seed * 23 + 13);
      const rz = seededRandom(seed * 29 + 17);
      const theta = rx * Math.PI * 2;
      const phi = Math.acos(2.0 * ry - 1.0);
      const radius = Math.cbrt(rz) * emitR;
      emitPositions[i * 3 + 0] = Math.sin(phi) * Math.cos(theta) * radius;
      emitPositions[i * 3 + 1] = Math.cos(phi) * radius + ry * emitH;
      emitPositions[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * radius;

      // Pick a random leaf color
      const lc = parseColor(leafColors[Math.floor(seededRandom(seed * 31 + 19) * leafColors.length)]);
      colors[i * 3 + 0] = lc.r;
      colors[i * 3 + 1] = lc.g;
      colors[i * 3 + 2] = lc.b;

      // Random tumble speed between 1 and 5
      tumbleSpeeds[i] = 1.0 + seededRandom(seed * 37 + 23) * 4.0;
    }

    // Add per-instance attributes to the geometry
    quadGeo.setAttribute('birthTime', new THREE.InstancedBufferAttribute(birthTimes, 1));
    quadGeo.setAttribute('lifetime', new THREE.InstancedBufferAttribute(lifetimes, 1));
    quadGeo.setAttribute('velocity', new THREE.InstancedBufferAttribute(velocities, 3));
    quadGeo.setAttribute('emitPos', new THREE.InstancedBufferAttribute(emitPositions, 3));
    quadGeo.setAttribute('leafColor', new THREE.InstancedBufferAttribute(colors, 3));
    quadGeo.setAttribute('tumbleSpeed', new THREE.InstancedBufferAttribute(tumbleSpeeds, 1));

    const pr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;

    const material = new THREE.ShaderMaterial({
      uniforms: {
        time:       { value: 0.0 },
        windDir:    { value: new THREE.Vector3(1, 0, 0) },
        windStr:    { value: 0.0 },
        windFactor: { value: cfg.windFactor ?? 0.5 },
        buoyancy:   { value: cfg.buoyancy ?? 0.0 },
        turbFreq:   { value: cfg.turbFreq ?? 0.0 },
        turbAmp:    { value: cfg.turbAmp ?? 0.0 },
      },
      vertexShader: cfg.vertexShader || LEAF_VERTEX_SHADER,
      fragmentShader: cfg.fragmentShader || LEAF_FRAGMENT_SHADER,
      transparent: true,
      depthWrite: cfg.depthWrite ?? false,
      blending: THREE.NormalBlending,
      side: THREE.DoubleSide,
    });

    this._mesh = new THREE.InstancedMesh(quadGeo, material, count);
    this._mesh.frustumCulled = false;
    this._mesh.renderOrder = 5;

    // Set identity matrices for all instances (positions are handled in shader)
    const identity = new THREE.Matrix4();
    for (let i = 0; i < count; i++) {
      this._mesh.setMatrixAt(i, identity);
    }
    this._mesh.instanceMatrix.needsUpdate = true;
  }
}

// ---------------------------------------------------------------------------
// GPUParticleSystem — high-level manager
// ---------------------------------------------------------------------------

export class GPUParticleSystem {
  /**
   * @param {THREE.Scene} scene — the scene to add emitter meshes to
   */
  constructor(scene) {
    this._scene = scene;
    this._emitters = new Map();  // id -> { emitter: ParticleEmitter, type: string }
    this._nextId = 0;
    this._time = 0;
    this._windDir = new THREE.Vector3(1, 0, 0);
    this._windStr = 0;
  }

  // ---------- public ----------

  /**
   * Create a particle emitter from a named preset.
   *
   * @param {string} type — preset name (e.g. 'forge-smoke', 'rain')
   * @param {THREE.Vector3|{x,y,z}|number[]} position — world position
   * @param {object} [options={}] — overrides merged onto the preset config
   * @returns {number} emitter ID
   */
  createEmitter(type, position, options = {}) {
    const preset = PRESETS[type];
    if (!preset) {
      throw new Error(`GPUParticleSystem: unknown preset "${type}". Available: ${Object.keys(PRESETS).join(', ')}`);
    }

    // Merge preset with user overrides
    const config = { ...preset, ...options };

    const emitter = new ParticleEmitter(config);

    // Position
    if (position) {
      if (position.isVector3) {
        emitter.setPosition(position);
      } else if (Array.isArray(position)) {
        emitter.setPosition({ x: position[0], y: position[1], z: position[2] });
      } else {
        emitter.setPosition(position);
      }
    }

    // Apply current time so recycling starts from the right offset
    emitter.updateTime(this._time, this._windDir, this._windStr);

    // Add to scene
    this._scene.add(emitter.mesh);

    const id = this._nextId++;
    this._emitters.set(id, { emitter, type });

    // Apply stored particle textures to newly created emitter
    if (this._particleTextures) {
      const u = emitter.mesh?.material?.uniforms;
      if (u && u.uParticleTex) {
        const smokeTypes = new Set(['forge-smoke', 'chimney-smoke', 'mining-dust']);
        const fireTypes = new Set(['torch-fire']);
        if (this._particleTextures.smoke && smokeTypes.has(type)) {
          u.uParticleTex.value = this._particleTextures.smoke;
          u.uHasParticleTex.value = 1.0;
        } else if (this._particleTextures.fire && fireTypes.has(type)) {
          u.uParticleTex.value = this._particleTextures.fire;
          u.uHasParticleTex.value = 1.0;
        }
      }
    }

    return id;
  }

  /**
   * Move an existing emitter to a new position.
   * @param {number} id
   * @param {THREE.Vector3|{x,y,z}|number[]} position
   */
  setEmitterPosition(id, position) {
    const entry = this._emitters.get(id);
    if (!entry) return;
    if (Array.isArray(position)) {
      entry.emitter.setPosition({ x: position[0], y: position[1], z: position[2] });
    } else {
      entry.emitter.setPosition(position);
    }
  }

  /**
   * Enable / disable an emitter without destroying it.
   * @param {number} id
   * @param {boolean} active
   */
  setEmitterActive(id, active) {
    const entry = this._emitters.get(id);
    if (!entry) return;
    entry.emitter.setActive(active);
  }

  /**
   * Remove an emitter entirely (disposes GPU resources).
   * @param {number} id
   */
  removeEmitter(id) {
    const entry = this._emitters.get(id);
    if (!entry) return;
    entry.emitter.dispose();
    this._emitters.delete(id);
  }

  /**
   * Per-frame update. Call once per animation frame.
   *
   * @param {number} deltaTime — seconds since last frame
   * @param {THREE.Vector3|{x,y,z}|number[]} [windDirection] — normalised wind vector
   * @param {number} [windStrength] — scalar wind strength (0 = calm)
   */
  update(deltaTime, windDirection, windStrength) {
    this._time += deltaTime;

    if (windDirection !== undefined) {
      if (windDirection.isVector3) {
        this._windDir.copy(windDirection);
      } else if (Array.isArray(windDirection)) {
        this._windDir.set(windDirection[0], windDirection[1], windDirection[2]);
      } else {
        this._windDir.set(
          windDirection.x ?? 0,
          windDirection.y ?? 0,
          windDirection.z ?? 0,
        );
      }
    }
    if (windStrength !== undefined) {
      this._windStr = windStrength;
    }

    for (const [, entry] of this._emitters) {
      if (!entry.emitter._active) continue;
      entry.emitter.updateTime(this._time, this._windDir, this._windStr);
    }
  }

  /**
   * Set particle textures for smoke and fire emitters.
   * Updates uniform on existing emitter materials that use SMOKE_FRAGMENT or TORCH_FRAGMENT.
   * @param {{ smoke?: THREE.Texture, fire?: THREE.Texture }} textures
   */
  setTextures(textures) {
    if (!textures) return;
    const smokeTypes = new Set(['forge-smoke', 'chimney-smoke', 'mining-dust']);
    const fireTypes = new Set(['torch-fire']);

    for (const [, entry] of this._emitters) {
      const u = entry.emitter.mesh?.material?.uniforms;
      if (!u || !u.uParticleTex) continue;

      if (textures.smoke && smokeTypes.has(entry.type)) {
        u.uParticleTex.value = textures.smoke;
        u.uHasParticleTex.value = 1.0;
      } else if (textures.fire && fireTypes.has(entry.type)) {
        u.uParticleTex.value = textures.fire;
        u.uHasParticleTex.value = 1.0;
      }
    }

    // Store for future emitters
    this._particleTextures = textures;
  }

  /**
   * Dispose all emitters and release GPU resources.
   */
  dispose() {
    for (const [id] of this._emitters) {
      this.removeEmitter(id);
    }
    this._emitters.clear();
  }

  // ---------- convenience / inspection ----------

  /** Number of active emitters. */
  get emitterCount() {
    return this._emitters.size;
  }

  /** Total particle count across all emitters. */
  get totalParticleCount() {
    let n = 0;
    for (const [, entry] of this._emitters) {
      const geo = entry.emitter.mesh?.geometry;
      if (geo) {
        // InstancedMesh uses instanceCount; Points uses attribute count
        if (entry.emitter.mesh.isInstancedMesh) {
          n += entry.emitter.mesh.count;
        } else {
          const attr = geo.getAttribute('birthTime');
          if (attr) n += attr.count;
        }
      }
    }
    return n;
  }

  /** Elapsed simulation time (seconds). */
  get time() {
    return this._time;
  }

  /** Reset simulation clock (particles will re-stagger). */
  resetTime() {
    this._time = 0;
  }

  /** Get the preset names available. */
  static get presetNames() {
    return Object.keys(PRESETS);
  }

  /** Access a preset definition (read-only copy). */
  static getPreset(name) {
    const p = PRESETS[name];
    return p ? { ...p } : null;
  }
}
