/**
 * BuildingAnimator — construction reveal, scaffolding, and active-state animations.
 *
 * Handles Y-clip reveal shader for construction, scaffolding overlays during
 * building/upgrading, and active-state indicators (forge crafting, academy
 * research, sanctuary meditation).
 */

import * as THREE from 'three';

// Noise texture generation (64x64 Perlin-like via canvas)

/** Generate a 64x64 Perlin-style noise DataTexture using canvas. */
function generateNoiseTexture() {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  // Layered random noise with smoothing to approximate Perlin
  const layers = [
    { scale: 4, weight: 0.5 },
    { scale: 8, weight: 0.3 },
    { scale: 16, weight: 0.15 },
    { scale: 32, weight: 0.05 },
  ];

  const buffer = new Float32Array(size * size);

  for (const layer of layers) {
    const gridSize = layer.scale;
    // Generate random grid values
    const grid = new Float32Array((gridSize + 2) * (gridSize + 2));
    for (let i = 0; i < grid.length; i++) grid[i] = Math.random();

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const gx = (x / size) * gridSize;
        const gy = (y / size) * gridSize;
        const ix = Math.floor(gx);
        const iy = Math.floor(gy);
        const fx = gx - ix;
        const fy = gy - iy;
        // Smoothstep interpolation
        const sx = fx * fx * (3 - 2 * fx);
        const sy = fy * fy * (3 - 2 * fy);
        const stride = gridSize + 2;
        const v00 = grid[iy * stride + ix];
        const v10 = grid[iy * stride + ix + 1];
        const v01 = grid[(iy + 1) * stride + ix];
        const v11 = grid[(iy + 1) * stride + ix + 1];
        const top = v00 + (v10 - v00) * sx;
        const bot = v01 + (v11 - v01) * sx;
        const val = top + (bot - top) * sy;
        buffer[y * size + x] += val * layer.weight;
      }
    }
  }

  const imageData = ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const v = Math.min(255, Math.max(0, Math.floor(buffer[i] * 255)));
    imageData.data[i * 4 + 0] = v;
    imageData.data[i * 4 + 1] = v;
    imageData.data[i * 4 + 2] = v;
    imageData.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(imageData, 0, 0);

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return texture;
}

// Y-Clip Reveal Shader (construction)

const CONSTRUCTION_VERTEX = /* glsl */ `
  varying vec3 vWorldPosition;
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vViewDir;

  void main() {
    vUv = uv;
    vNormal = normalize(normalMatrix * normal);
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPos.xyz;
    vViewDir = normalize(cameraPosition - worldPos.xyz);
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const CONSTRUCTION_FRAGMENT = /* glsl */ `
  uniform float progress;
  uniform float buildingHeight;
  uniform float time;
  uniform sampler2D noiseMap;
  uniform vec3 baseColor;
  uniform float roughness;
  uniform float metalness;
  uniform float emissiveIntensity;
  uniform vec3 emissiveColor;

  varying vec3 vWorldPosition;
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vViewDir;

  void main() {
    float edge = buildingHeight * progress;

    // Noise-based dissolve — jagged construction edge, not a flat line
    float noise = texture2D(noiseMap, vUv * 4.0).r;
    float noiseDetail = texture2D(noiseMap, vUv * 12.0 + vec2(0.0, time * 0.05)).r;
    float dissolve = edge + (noise - 0.5) * 0.05 + (noiseDetail - 0.5) * 0.015;
    if (vWorldPosition.y > dissolve) discard;

    // Distance from dissolve edge (drives glow bands)
    float edgeDist = dissolve - vWorldPosition.y;

    // Multi-band glow: white-hot core → warm orange → cool blue aura
    float hotBand  = 1.0 - smoothstep(0.0, 0.008, edgeDist);
    float warmBand = 1.0 - smoothstep(0.0, 0.03, edgeDist);
    float coolBand = 1.0 - smoothstep(0.0, 0.06, edgeDist);

    vec3 hotColor  = vec3(1.0, 0.95, 0.85);
    vec3 warmColor = vec3(1.0, 0.55, 0.1);
    vec3 coolColor = vec3(0.15, 0.35, 0.9);

    // Fresnel rim lighting — adds depth and 3D perception
    float fresnel = pow(1.0 - max(dot(normalize(vNormal), normalize(vViewDir)), 0.0), 3.0);

    // Base lighting with two-light setup
    vec3 sunDir = normalize(vec3(0.5, 1.0, 0.3));
    vec3 fillDir = normalize(vec3(-0.3, 0.6, -0.5));
    float sunDiffuse = max(dot(vNormal, sunDir), 0.0);
    float fillDiffuse = max(dot(vNormal, fillDir), 0.0);
    float ambient = 0.3;
    vec3 lit = baseColor * (ambient + sunDiffuse * 0.55 + fillDiffuse * 0.15);

    // Metalness tint
    lit = mix(lit, lit * vec3(0.9, 0.92, 1.0), metalness * 0.3);

    // Emissive
    lit += emissiveColor * emissiveIntensity;

    // Rim light (silhouette depth)
    lit += fresnel * vec3(0.25, 0.3, 0.5) * 0.35;

    // Construction glow contribution
    vec3 glow = hotBand * hotColor * 2.5
              + warmBand * warmColor * 1.2
              + coolBand * coolColor * 0.25;

    // Animated ember sparkles near the edge
    float sparkleNoise = texture2D(noiseMap, vUv * 25.0 + vec2(time * 1.5, time * 1.1)).r;
    float sparkle = step(0.9, sparkleNoise) * warmBand;
    glow += sparkle * vec3(1.0, 0.85, 0.4) * 2.0;

    // Faint animated scan lines (holographic construction feel)
    float scan = sin(vWorldPosition.y * 180.0 - time * 4.0) * 0.5 + 0.5;
    scan = smoothstep(0.45, 0.55, scan) * coolBand * 0.2;
    glow += scan * coolColor;

    gl_FragColor = vec4(lit + glow, 1.0);
  }
`;

// Quality tier color map

const QUALITY_COLORS = {
  0: new THREE.Color(0xffffff),   // Common: white
  1: new THREE.Color(0x44dd44),   // Refined: green
  2: new THREE.Color(0x4488ff),   // Superior: blue
  3: new THREE.Color(0xaa44ff),   // Elite: purple
  4: new THREE.Color(0xffd700),   // Masterwork: gold
  5: new THREE.Color(0xff8800),   // Legendary: orange
  6: new THREE.Color(0xff44ff),   // Mythic: prismatic (magenta base)
  7: new THREE.Color(0xfff5cc),   // Divine: white-gold
};

// Prismatic color cycle for Mythic tier
const PRISMATIC_COLORS = [
  new THREE.Color(0xff4444),
  new THREE.Color(0xff8800),
  new THREE.Color(0xffff44),
  new THREE.Color(0x44ff44),
  new THREE.Color(0x4488ff),
  new THREE.Color(0xaa44ff),
];

// Scaffolding geometry constants

const SCAFFOLD_POLE_RADIUS = 0.004;
const SCAFFOLD_PLANK_THICKNESS = 0.003;
const SCAFFOLD_PLANK_WIDTH = 0.006;
const SCAFFOLD_WOOD_COLOR = 0x9a7a50;
const SCAFFOLD_OPACITY = 0.8;

// BuildingAnimator

export class BuildingAnimator {
  /**
   * @param {THREE.Scene} scene
   */
  constructor(scene) {
    this._scene = scene;
    this._noiseTexture = null;
    this._time = 0;

    // Track active animations
    this._constructionMeshes = new Map();    // buildingGroup.uuid -> { materials, progress }
    this._scaffoldings = new Map();          // buildingGroup.uuid -> { group, fadeAnim }
    this._craftIndicators = new Map();       // buildingGroup.uuid -> { group, ring, item, particles }
    this._researchIndicators = new Map();    // buildingGroup.uuid -> { group, hologram, ring }
    this._meditationFigures = new Map();     // buildingGroup.uuid -> { group, figures }
    this._levelUpEffects = new Map();        // buildingGroup.uuid -> { group, elapsed, duration }

    // Shared geometries (created lazily)
    this._sharedGeo = null;
  }

  // ---------- Lazy shared resources ----------

  _getNoiseTexture() {
    if (!this._noiseTexture) {
      this._noiseTexture = generateNoiseTexture();
    }
    return this._noiseTexture;
  }

  _getSharedGeo() {
    if (!this._sharedGeo) {
      this._sharedGeo = {
        pole: new THREE.CylinderGeometry(SCAFFOLD_POLE_RADIUS, SCAFFOLD_POLE_RADIUS, 1, 4),
        plank: new THREE.BoxGeometry(1, SCAFFOLD_PLANK_THICKNESS, SCAFFOLD_PLANK_WIDTH),
        brace: new THREE.BoxGeometry(1, SCAFFOLD_PLANK_THICKNESS, SCAFFOLD_PLANK_WIDTH * 0.7),
        ring: new THREE.TorusGeometry(0.03, 0.002, 8, 32),
        sphere: new THREE.SphereGeometry(0.008, 6, 4),
        smallSphere: new THREE.SphereGeometry(0.004, 4, 3),
        box: new THREE.BoxGeometry(0.01, 0.013, 0.008),
        octahedron: new THREE.OctahedronGeometry(0.006),
        cone: new THREE.ConeGeometry(0.005, 0.01, 6),
        cylinder: new THREE.CylinderGeometry(0.003, 0.003, 0.01, 6),
        lotus: new THREE.RingGeometry(0.003, 0.012, 12),
        beam: new THREE.CylinderGeometry(0.001, 0.01, 0.12, 8, 1, true),
        figure: null, // created on demand
      };
    }
    return this._sharedGeo;
  }

  _getFigureGeo() {
    const geo = this._getSharedGeo();
    if (!geo.figure) {
      // Simple seated figure: torso + head
      const group = new THREE.Group();
      const torsoGeo = new THREE.CylinderGeometry(0.005, 0.006, 0.018, 6);
      const headGeo = new THREE.SphereGeometry(0.005, 6, 4);
      geo.figure = { torso: torsoGeo, head: headGeo };
    }
    return geo.figure;
  }

  // ---------- Construction Material ----------

  /**
   * Create a construction reveal material that wraps the building's existing material.
   * @param {THREE.Material} originalMaterial
   * @param {number} buildingHeight
   * @returns {THREE.ShaderMaterial}
   */
  createConstructionMaterial(originalMaterial, buildingHeight) {
    const baseColor = originalMaterial.color
      ? originalMaterial.color.clone()
      : new THREE.Color(0x888888);
    const roughness = originalMaterial.roughness !== undefined ? originalMaterial.roughness : 0.7;
    const metalness = originalMaterial.metalness !== undefined ? originalMaterial.metalness : 0.05;
    const emissiveColor = originalMaterial.emissive
      ? originalMaterial.emissive.clone()
      : new THREE.Color(0x000000);
    const emissiveIntensity = originalMaterial.emissiveIntensity || 0;

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        progress: { value: 0.0 },
        buildingHeight: { value: buildingHeight },
        time: { value: 0.0 },
        noiseMap: { value: this._getNoiseTexture() },
        baseColor: { value: new THREE.Vector3(baseColor.r, baseColor.g, baseColor.b) },
        roughness: { value: roughness },
        metalness: { value: metalness },
        emissiveColor: { value: new THREE.Vector3(emissiveColor.r, emissiveColor.g, emissiveColor.b) },
        emissiveIntensity: { value: emissiveIntensity },
      },
      vertexShader: CONSTRUCTION_VERTEX,
      fragmentShader: CONSTRUCTION_FRAGMENT,
      side: originalMaterial.side || THREE.FrontSide,
    });

    return mat;
  }

  /**
   * Set construction progress on a building group (animates the Y-clip).
   * All meshes with construction materials will be updated.
   * @param {THREE.Group} buildingGroup
   * @param {number} progress - 0.0 to 1.0
   */
  setConstructionProgress(buildingGroup, progress) {
    const entry = this._constructionMeshes.get(buildingGroup.uuid);
    if (!entry) {
      // First time: swap all materials to construction materials
      this._applyConstructionMaterials(buildingGroup, progress);
      return;
    }

    const clamped = Math.max(0, Math.min(1, progress));
    entry.progress = clamped;
    for (const matEntry of entry.materials) {
      matEntry.material.uniforms.progress.value = clamped;
    }

    // If complete, restore original materials
    if (clamped >= 1.0) {
      this._restoreOriginalMaterials(buildingGroup);
    }
  }

  _applyConstructionMaterials(buildingGroup, progress) {
    const materials = [];
    const bounds = new THREE.Box3().setFromObject(buildingGroup);
    const buildingHeight = bounds.max.y - bounds.min.y;

    buildingGroup.traverse((child) => {
      if (child.isMesh && child.material && child.name !== 'select-ring') {
        const originalMaterial = child.material;
        const constructionMat = this.createConstructionMaterial(originalMaterial, buildingHeight);
        constructionMat.uniforms.progress.value = Math.max(0, Math.min(1, progress));
        materials.push({ mesh: child, original: originalMaterial, material: constructionMat });
        child.material = constructionMat;
      }
    });

    this._constructionMeshes.set(buildingGroup.uuid, { materials, progress });
  }

  _restoreOriginalMaterials(buildingGroup) {
    const entry = this._constructionMeshes.get(buildingGroup.uuid);
    if (!entry) return;

    for (const matEntry of entry.materials) {
      matEntry.mesh.material = matEntry.original;
      matEntry.material.dispose();
    }
    this._constructionMeshes.delete(buildingGroup.uuid);
  }

  // ---------- Scaffolding ----------

  /**
   * Create scaffolding around a building.
   * @param {THREE.Group} buildingGroup
   * @param {THREE.Box3|null} buildingBounds - Optional pre-computed bounds
   */
  createScaffolding(buildingGroup, buildingBounds) {
    // Remove existing scaffolding first
    this.removeScaffolding(buildingGroup, false);

    const bounds = buildingBounds || new THREE.Box3().setFromObject(buildingGroup);
    const size = new THREE.Vector3();
    bounds.getSize(size);
    const center = new THREE.Vector3();
    bounds.getCenter(center);

    // Convert world-space center to building-group local space
    // (scaffoldGroup is a child of buildingGroup, so positions are in local coords)
    buildingGroup.worldToLocal(center);

    const bw = size.x;
    const bd = size.z;
    const bh = size.y;
    const margin = 0.015; // Offset from building surface
    const scaffoldH = bh + 0.03; // Extend above building
    const halfW = bw / 2 + margin;
    const halfD = bd / 2 + margin;

    const scaffoldGroup = new THREE.Group();
    scaffoldGroup.name = 'scaffolding';

    const woodMat = new THREE.MeshStandardMaterial({
      color: SCAFFOLD_WOOD_COLOR,
      roughness: 0.8,
      transparent: true,
      opacity: SCAFFOLD_OPACITY,
    });

    const geo = this._getSharedGeo();

    // 4 vertical poles at corners
    const corners = [
      [-halfW, -halfD],
      [halfW, -halfD],
      [-halfW, halfD],
      [halfW, halfD],
    ];

    for (const [cx, cz] of corners) {
      const pole = new THREE.Mesh(geo.pole, woodMat);
      pole.scale.y = scaffoldH;
      pole.position.set(
        center.x + cx,
        scaffoldH / 2,
        center.z + cz
      );
      pole.castShadow = true;
      scaffoldGroup.add(pole);
    }

    // 3 horizontal plank rings at 1/3, 2/3, and top heights
    const ringHeights = [scaffoldH / 3, (scaffoldH * 2) / 3, scaffoldH];

    for (const rh of ringHeights) {
      // Front and back planks (along X)
      for (const dz of [-halfD, halfD]) {
        const plank = new THREE.Mesh(geo.plank, woodMat);
        const plankLen = bw + margin * 2;
        plank.scale.x = plankLen;
        plank.position.set(center.x, rh, center.z + dz);
        scaffoldGroup.add(plank);
      }

      // Left and right planks (along Z)
      for (const dx of [-halfW, halfW]) {
        const plank = new THREE.Mesh(geo.plank, woodMat);
        const plankLen = bd + margin * 2;
        plank.scale.x = plankLen;
        plank.rotation.y = Math.PI / 2;
        plank.position.set(center.x + dx, rh, center.z);
        scaffoldGroup.add(plank);
      }
    }

    // Cross-bracing diagonals on each face
    const faces = [
      // front face
      { start: [-halfW, -halfD], end: [halfW, -halfD], axis: 'x' },
      // back face
      { start: [-halfW, halfD], end: [halfW, halfD], axis: 'x' },
      // left face
      { start: [-halfW, -halfD], end: [-halfW, halfD], axis: 'z' },
      // right face
      { start: [halfW, -halfD], end: [halfW, halfD], axis: 'z' },
    ];

    for (const face of faces) {
      // Diagonal from bottom-left to top-right of each panel section
      for (let section = 0; section < 3; section++) {
        const yBot = section * (scaffoldH / 3);
        const yTop = (section + 1) * (scaffoldH / 3);
        const sectionH = yTop - yBot;

        const brace = new THREE.Mesh(geo.brace, woodMat);

        if (face.axis === 'x') {
          const span = halfW * 2;
          const diagonalLen = Math.sqrt(span * span + sectionH * sectionH);
          const angle = Math.atan2(sectionH, span);
          brace.scale.x = diagonalLen;
          brace.position.set(
            center.x,
            yBot + sectionH / 2,
            center.z + face.start[1]
          );
          // Alternate diagonal direction per section
          const dir = section % 2 === 0 ? 1 : -1;
          brace.rotation.z = dir * angle;
        } else {
          const span = halfD * 2;
          const diagonalLen = Math.sqrt(span * span + sectionH * sectionH);
          const angle = Math.atan2(sectionH, span);
          brace.scale.x = diagonalLen;
          brace.rotation.y = Math.PI / 2;
          brace.position.set(
            center.x + face.start[0],
            yBot + sectionH / 2,
            center.z
          );
          const dir = section % 2 === 0 ? 1 : -1;
          brace.rotation.z = dir * angle;
        }

        scaffoldGroup.add(brace);
      }
    }

    buildingGroup.add(scaffoldGroup);
    this._scaffoldings.set(buildingGroup.uuid, { group: scaffoldGroup, fadeAnim: null, woodMat });
  }

  /**
   * Remove scaffolding from a building.
   * @param {THREE.Group} buildingGroup
   * @param {boolean} fadeOut - If true, animate opacity 1->0 over 0.5s
   */
  removeScaffolding(buildingGroup, fadeOut = true) {
    const entry = this._scaffoldings.get(buildingGroup.uuid);
    if (!entry) return;

    if (fadeOut) {
      entry.fadeAnim = { elapsed: 0, duration: 0.5, startOpacity: entry.woodMat.opacity };
    } else {
      this._disposeScaffolding(buildingGroup.uuid, entry);
    }
  }

  _disposeScaffolding(uuid, entry) {
    if (entry.group.parent) entry.group.parent.remove(entry.group);
    if (entry.woodMat) entry.woodMat.dispose();
    this._scaffoldings.delete(uuid);
  }

  // ---------- Craft Indicator (Forge) ----------

  /**
   * Show a crafting indicator above a forge building.
   * @param {THREE.Group} buildingGroup
   * @param {number} qualityTier - 0-7 (Common through Divine)
   * @param {number} progress - 0.0 to 1.0
   */
  showCraftIndicator(buildingGroup, qualityTier, progress) {
    this.hideCraftIndicator(buildingGroup);

    const bounds = new THREE.Box3().setFromObject(buildingGroup);
    const topY = bounds.max.y + 0.03;
    const centerX = (bounds.min.x + bounds.max.x) / 2;
    const centerZ = (bounds.min.z + bounds.max.z) / 2;

    const group = new THREE.Group();
    group.name = 'craft-indicator';
    group.position.set(centerX, topY, centerZ);

    const geo = this._getSharedGeo();

    // Quality color
    const tier = Math.max(0, Math.min(7, qualityTier));
    const color = QUALITY_COLORS[tier] || QUALITY_COLORS[0];

    // Progress ring
    const ringMat = new THREE.MeshBasicMaterial({
      color: color,
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(geo.ring, ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.005;
    group.add(ring);

    // Progress arc (partial torus)
    const arcGeo = new THREE.TorusGeometry(0.03, 0.003, 8, 32, Math.PI * 2 * Math.max(0.01, progress));
    const arcMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.95,
    });
    const arc = new THREE.Mesh(arcGeo, arcMat);
    arc.rotation.x = Math.PI / 2;
    arc.position.y = 0.005;
    group.add(arc);

    // Materializing item (octahedron)
    const itemMat = new THREE.MeshStandardMaterial({
      color: color,
      emissive: color,
      emissiveIntensity: 0.5,
      transparent: true,
      opacity: Math.max(0.2, progress),
      metalness: 0.5,
      roughness: 0.3,
    });
    const item = new THREE.Mesh(geo.octahedron, itemMat);
    item.position.y = 0.02;
    item.scale.setScalar(0.3 + progress * 0.7);
    group.add(item);

    // Particle sparkles around the item
    const particleCount = 12;
    const particleGeo = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const particleColors = new Float32Array(particleCount * 3);

    for (let i = 0; i < particleCount; i++) {
      const angle = (i / particleCount) * Math.PI * 2;
      const r = 0.015 + Math.random() * 0.01;
      positions[i * 3] = Math.cos(angle) * r;
      positions[i * 3 + 1] = 0.015 + Math.random() * 0.015;
      positions[i * 3 + 2] = Math.sin(angle) * r;

      if (tier === 6) {
        // Prismatic: rainbow colors
        const pc = PRISMATIC_COLORS[i % PRISMATIC_COLORS.length];
        particleColors[i * 3] = pc.r;
        particleColors[i * 3 + 1] = pc.g;
        particleColors[i * 3 + 2] = pc.b;
      } else {
        particleColors[i * 3] = color.r;
        particleColors[i * 3 + 1] = color.g;
        particleColors[i * 3 + 2] = color.b;
      }
    }
    particleGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    particleGeo.setAttribute('color', new THREE.BufferAttribute(particleColors, 3));

    const particleMat = new THREE.PointsMaterial({
      size: 0.004,
      vertexColors: true,
      transparent: true,
      opacity: 0.7,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const particles = new THREE.Points(particleGeo, particleMat);
    group.add(particles);

    buildingGroup.add(group);
    this._craftIndicators.set(buildingGroup.uuid, {
      group,
      ring,
      arc,
      arcGeo,
      arcMat,
      item,
      itemMat,
      particles,
      particleMat,
      ringMat,
      tier,
      progress,
    });
  }

  /**
   * Hide the crafting indicator from a building.
   * @param {THREE.Group} buildingGroup
   */
  hideCraftIndicator(buildingGroup) {
    const entry = this._craftIndicators.get(buildingGroup.uuid);
    if (!entry) return;

    if (entry.group.parent) entry.group.parent.remove(entry.group);
    entry.arcGeo.dispose();
    entry.arcMat.dispose();
    entry.ringMat.dispose();
    entry.itemMat.dispose();
    entry.particleMat.dispose();
    entry.particles.geometry.dispose();
    this._craftIndicators.delete(buildingGroup.uuid);
  }

  // ---------- Research Indicator (Academy) ----------

  /**
   * Show a research indicator above an academy building.
   * @param {THREE.Group} buildingGroup
   * @param {string|number} researchId - Research identifier (for display)
   * @param {number} progress - 0.0 to 1.0
   */
  showResearchIndicator(buildingGroup, researchId, progress) {
    this.hideResearchIndicator(buildingGroup);

    const bounds = new THREE.Box3().setFromObject(buildingGroup);
    const topY = bounds.max.y + 0.03;
    const centerX = (bounds.min.x + bounds.max.x) / 2;
    const centerZ = (bounds.min.z + bounds.max.z) / 2;

    const group = new THREE.Group();
    group.name = 'research-indicator';
    group.position.set(centerX, topY, centerZ);

    const geo = this._getSharedGeo();

    // Hologram effect: wireframe icosahedron
    const hologramGeo = new THREE.IcosahedronGeometry(0.02, 1);
    const hologramMat = new THREE.MeshBasicMaterial({
      color: 0x44aaff,
      wireframe: true,
      transparent: true,
      opacity: 0.6,
    });
    const hologram = new THREE.Mesh(hologramGeo, hologramMat);
    hologram.position.y = 0.025;
    group.add(hologram);

    // Inner glow sphere
    const innerGlowMat = new THREE.MeshBasicMaterial({
      color: 0x88ccff,
      transparent: true,
      opacity: 0.3,
    });
    const innerGlow = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 6), innerGlowMat);
    innerGlow.position.y = 0.025;
    group.add(innerGlow);

    // Progress ring
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x4488ff,
      transparent: true,
      opacity: 0.7,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(geo.ring, ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.005;
    group.add(ring);

    // Progress arc
    const arcGeo = new THREE.TorusGeometry(0.03, 0.003, 8, 32, Math.PI * 2 * Math.max(0.01, progress));
    const arcMat = new THREE.MeshBasicMaterial({
      color: 0xaaddff,
      transparent: true,
      opacity: 0.9,
    });
    const arc = new THREE.Mesh(arcGeo, arcMat);
    arc.rotation.x = Math.PI / 2;
    arc.position.y = 0.005;
    group.add(arc);

    // Floating equation particles (small dots orbiting)
    const dotCount = 8;
    const dots = [];
    for (let i = 0; i < dotCount; i++) {
      const dotMat = new THREE.MeshBasicMaterial({
        color: 0xaaddff,
        transparent: true,
        opacity: 0.5 + Math.random() * 0.3,
      });
      const dot = new THREE.Mesh(geo.smallSphere, dotMat);
      const angle = (i / dotCount) * Math.PI * 2;
      dot.position.set(
        Math.cos(angle) * 0.025,
        0.02 + Math.sin(angle * 2) * 0.008,
        Math.sin(angle) * 0.025
      );
      dot.userData._orbitOffset = angle;
      dot.userData._orbitRadius = 0.025;
      dot.userData._orbitSpeed = 1.5 + Math.random() * 0.5;
      dot.userData._yPhase = Math.random() * Math.PI * 2;
      group.add(dot);
      dots.push({ mesh: dot, mat: dotMat });
    }

    buildingGroup.add(group);
    this._researchIndicators.set(buildingGroup.uuid, {
      group,
      hologram,
      hologramGeo,
      hologramMat,
      innerGlow,
      innerGlowMat,
      ring,
      ringMat,
      arc,
      arcGeo,
      arcMat,
      dots,
      progress,
      researchId,
    });
  }

  /**
   * Hide the research indicator from a building.
   * @param {THREE.Group} buildingGroup
   */
  hideResearchIndicator(buildingGroup) {
    const entry = this._researchIndicators.get(buildingGroup.uuid);
    if (!entry) return;

    if (entry.group.parent) entry.group.parent.remove(entry.group);
    entry.hologramGeo.dispose();
    entry.hologramMat.dispose();
    entry.innerGlowMat.dispose();
    entry.innerGlow.geometry.dispose();
    entry.ringMat.dispose();
    entry.arcGeo.dispose();
    entry.arcMat.dispose();
    for (const dot of entry.dots) {
      dot.mat.dispose();
    }
    this._researchIndicators.delete(buildingGroup.uuid);
  }

  // ---------- Meditation Figures (Sanctuary) ----------

  /**
   * Show meditation figures around a sanctuary building.
   * @param {THREE.Group} buildingGroup
   * @param {number} count - Number of meditating heroes
   */
  showMeditationFigures(buildingGroup, count) {
    this.hideMeditationFigures(buildingGroup);
    if (count <= 0) return;

    const bounds = new THREE.Box3().setFromObject(buildingGroup);
    const baseY = 0.002;
    const centerX = (bounds.min.x + bounds.max.x) / 2;
    const centerZ = (bounds.min.z + bounds.max.z) / 2;
    const radius = Math.max(bounds.max.x - bounds.min.x, bounds.max.z - bounds.min.z) * 0.5 + 0.03;

    const group = new THREE.Group();
    group.name = 'meditation-figures';
    group.position.set(centerX, baseY, centerZ);

    const figureDefs = this._getFigureGeo();
    const figures = [];

    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      const fx = Math.cos(angle) * radius;
      const fz = Math.sin(angle) * radius;

      const figGroup = new THREE.Group();
      figGroup.position.set(fx, 0, fz);
      figGroup.rotation.y = -angle + Math.PI; // Face center

      const figureMat = new THREE.MeshStandardMaterial({
        color: 0xccbbff,
        emissive: 0x8866cc,
        emissiveIntensity: 0.4,
        transparent: true,
        opacity: 0.7,
        roughness: 0.4,
      });

      // Floating lotus mandala beneath figure
      const lotusMat = new THREE.MeshBasicMaterial({
        color: 0xbb88ff,
        transparent: true,
        opacity: 0.35,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const lotus = new THREE.Mesh(geo.lotus, lotusMat);
      lotus.rotation.x = -Math.PI / 2;
      lotus.position.y = 0.001;
      figGroup.add(lotus);

      // Inner lotus ring (smaller, brighter)
      const innerLotusMat = new THREE.MeshBasicMaterial({
        color: 0xddaaff,
        transparent: true,
        opacity: 0.5,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const innerLotusGeo = new THREE.RingGeometry(0.001, 0.005, 8);
      const innerLotus = new THREE.Mesh(innerLotusGeo, innerLotusMat);
      innerLotus.rotation.x = -Math.PI / 2;
      innerLotus.position.y = 0.002;
      figGroup.add(innerLotus);

      // Torso (seated, shorter)
      const torso = new THREE.Mesh(figureDefs.torso, figureMat);
      torso.position.y = 0.009;
      figGroup.add(torso);

      // Head
      const head = new THREE.Mesh(figureDefs.head, figureMat);
      head.position.y = 0.022;
      figGroup.add(head);

      // Glow aura — more visible than before
      const auraMat = new THREE.MeshBasicMaterial({
        color: 0xcc88ff,
        transparent: true,
        opacity: 0.25,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const aura = new THREE.Mesh(new THREE.SphereGeometry(0.016, 8, 6), auraMat);
      aura.position.y = 0.014;
      figGroup.add(aura);

      // Energy tendril toward building center (thin line)
      const tendrilMat = new THREE.MeshBasicMaterial({
        color: 0xaa66ee,
        transparent: true,
        opacity: 0.2,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const tendrilLen = radius * 0.7;
      const tendrilGeo = new THREE.CylinderGeometry(0.001, 0.0005, tendrilLen, 4);
      const tendril = new THREE.Mesh(tendrilGeo, tendrilMat);
      tendril.rotation.z = Math.PI / 2;
      tendril.rotation.y = angle;
      tendril.position.set(-Math.cos(0) * tendrilLen * 0.4, 0.012, -Math.sin(0) * tendrilLen * 0.4);
      figGroup.add(tendril);

      group.add(figGroup);
      figures.push({
        group: figGroup,
        mat: figureMat,
        lotusMat,
        innerLotusMat,
        innerLotusGeo,
        tendrilMat,
        tendrilGeo,
        auraMat,
        auraGeo: aura.geometry,
        phaseOffset: i * 1.3,
      });
    }

    buildingGroup.add(group);
    this._meditationFigures.set(buildingGroup.uuid, { group, figures });
  }

  /**
   * Hide meditation figures from a building.
   * @param {THREE.Group} buildingGroup
   */
  hideMeditationFigures(buildingGroup) {
    const entry = this._meditationFigures.get(buildingGroup.uuid);
    if (!entry) return;

    if (entry.group.parent) entry.group.parent.remove(entry.group);
    for (const fig of entry.figures) {
      fig.mat.dispose();
      fig.lotusMat.dispose();
      fig.innerLotusMat.dispose();
      fig.innerLotusGeo.dispose();
      fig.tendrilMat.dispose();
      fig.tendrilGeo.dispose();
      fig.auraMat.dispose();
      fig.auraGeo.dispose();
    }
    this._meditationFigures.delete(buildingGroup.uuid);
  }

  // ---------- Level-Up Effect ----------

  /**
   * Play a brief golden pulse effect on a building.
   * @param {THREE.Group} buildingGroup
   */
  playLevelUpEffect(buildingGroup) {
    // Remove any existing level-up effect
    const existing = this._levelUpEffects.get(buildingGroup.uuid);
    if (existing) {
      if (existing.group.parent) existing.group.parent.remove(existing.group);
      existing.beamGeo.dispose();
      existing.beamMat.dispose();
      existing.innerBeamGeo.dispose();
      existing.innerBeamMat.dispose();
      existing.ringGeo.dispose();
      existing.ringMat.dispose();
      existing.ring2Geo.dispose();
      existing.ring2Mat.dispose();
      existing.burstGeo.dispose();
      existing.burstMat.dispose();
    }

    const bounds = new THREE.Box3().setFromObject(buildingGroup);
    const center = new THREE.Vector3();
    bounds.getCenter(center);
    const size = new THREE.Vector3();
    bounds.getSize(size);
    const maxDim = Math.max(size.x, size.z) * 0.7;

    const group = new THREE.Group();
    group.name = 'levelup-effect';
    group.position.copy(center);

    // Vertical beam of light
    const beamHeight = size.y * 2.5;
    const beamGeo = new THREE.CylinderGeometry(0.001, maxDim * 0.35, beamHeight, 8, 1, true);
    const beamMat = new THREE.MeshBasicMaterial({
      color: 0xffd700,
      transparent: true,
      opacity: 0.4,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const beam = new THREE.Mesh(beamGeo, beamMat);
    beam.position.y = beamHeight * 0.5;
    group.add(beam);

    // Inner beam (brighter, narrower)
    const innerBeamGeo = new THREE.CylinderGeometry(0.0005, maxDim * 0.15, beamHeight * 0.8, 6, 1, true);
    const innerBeamMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const innerBeam = new THREE.Mesh(innerBeamGeo, innerBeamMat);
    innerBeam.position.y = beamHeight * 0.4;
    group.add(innerBeam);

    // Expanding golden ring
    const ringGeo = new THREE.TorusGeometry(maxDim, 0.004, 8, 32);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xffd700,
      transparent: true,
      opacity: 1.0,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = Math.PI / 2;
    group.add(ring);

    // Second ring (delayed, smaller)
    const ring2Geo = new THREE.TorusGeometry(maxDim * 0.6, 0.003, 8, 24);
    const ring2Mat = new THREE.MeshBasicMaterial({
      color: 0xffeeaa,
      transparent: true,
      opacity: 0.0,
      side: THREE.DoubleSide,
    });
    const ring2 = new THREE.Mesh(ring2Geo, ring2Mat);
    ring2.rotation.x = Math.PI / 2;
    group.add(ring2);

    // Upward burst particles
    const burstCount = 30;
    const burstGeo = new THREE.BufferGeometry();
    const burstPositions = new Float32Array(burstCount * 3);
    const burstVelocities = new Float32Array(burstCount * 3);

    for (let i = 0; i < burstCount; i++) {
      const angle = (i / burstCount) * Math.PI * 2;
      const r = maxDim * 0.3 + Math.random() * maxDim * 0.5;
      burstPositions[i * 3] = Math.cos(angle) * r * 0.2;
      burstPositions[i * 3 + 1] = 0;
      burstPositions[i * 3 + 2] = Math.sin(angle) * r * 0.2;
      burstVelocities[i * 3] = Math.cos(angle) * r;
      burstVelocities[i * 3 + 1] = 0.05 + Math.random() * 0.1;
      burstVelocities[i * 3 + 2] = Math.sin(angle) * r;
    }
    burstGeo.setAttribute('position', new THREE.BufferAttribute(burstPositions, 3));

    const burstMat = new THREE.PointsMaterial({
      color: 0xffd700,
      size: 0.006,
      transparent: true,
      opacity: 1.0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const burst = new THREE.Points(burstGeo, burstMat);
    group.add(burst);

    buildingGroup.add(group);
    this._levelUpEffects.set(buildingGroup.uuid, {
      group,
      beam,
      beamGeo,
      beamMat,
      innerBeam,
      innerBeamGeo,
      innerBeamMat,
      ring,
      ringGeo,
      ringMat,
      ring2,
      ring2Geo,
      ring2Mat,
      burst,
      burstGeo,
      burstMat,
      burstVelocities,
      elapsed: 0,
      duration: 1.5,
      maxDim,
    });
  }

  // ---------- Per-frame update ----------

  /**
   * Update all active animations.
   * @param {number} deltaTime - Seconds since last frame
   */
  update(deltaTime) {
    this._time += deltaTime;

    // Animate construction shader time uniform
    for (const [, entry] of this._constructionMeshes) {
      for (const matEntry of entry.materials) {
        if (matEntry.material.uniforms.time) {
          matEntry.material.uniforms.time.value = this._time;
        }
      }
    }

    // Update scaffolding fade-outs
    for (const [uuid, entry] of this._scaffoldings) {
      if (entry.fadeAnim) {
        entry.fadeAnim.elapsed += deltaTime;
        const t = Math.min(1, entry.fadeAnim.elapsed / entry.fadeAnim.duration);
        const opacity = entry.fadeAnim.startOpacity * (1 - t);
        entry.woodMat.opacity = opacity;
        if (t >= 1) {
          this._disposeScaffolding(uuid, entry);
        }
      }
    }

    // Rotate craft indicator progress rings and animate items
    for (const [, entry] of this._craftIndicators) {
      // Rotate ring
      entry.ring.rotation.z += deltaTime * 0.5;
      entry.arc.rotation.z += deltaTime * 0.5;

      // Bob the item up and down
      entry.item.position.y = 0.02 + Math.sin(this._time * 2) * 0.005;
      entry.item.rotation.y += deltaTime * 1.2;

      // Prismatic color cycling for Mythic tier
      if (entry.tier === 6) {
        const colorIdx = Math.floor(this._time * 2) % PRISMATIC_COLORS.length;
        const nextIdx = (colorIdx + 1) % PRISMATIC_COLORS.length;
        const blend = (this._time * 2) % 1;
        const c = new THREE.Color().lerpColors(PRISMATIC_COLORS[colorIdx], PRISMATIC_COLORS[nextIdx], blend);
        entry.itemMat.color.copy(c);
        entry.itemMat.emissive.copy(c);
      }

      // Animate particles: orbit around item
      const posAttr = entry.particles.geometry.getAttribute('position');
      for (let i = 0; i < posAttr.count; i++) {
        const angle = (i / posAttr.count) * Math.PI * 2 + this._time * 1.5;
        const r = 0.015 + Math.sin(this._time + i) * 0.005;
        posAttr.setX(i, Math.cos(angle) * r);
        posAttr.setY(i, 0.015 + Math.sin(this._time * 3 + i * 0.7) * 0.008);
        posAttr.setZ(i, Math.sin(angle) * r);
      }
      posAttr.needsUpdate = true;

      // Pulse opacity based on progress
      entry.itemMat.opacity = Math.max(0.2, entry.progress) + Math.sin(this._time * 3) * 0.1;
    }

    // Rotate research indicator holograms and dots
    for (const [, entry] of this._researchIndicators) {
      // Rotate hologram
      entry.hologram.rotation.y += deltaTime * 0.8;
      entry.hologram.rotation.x += deltaTime * 0.3;

      // Pulse inner glow
      entry.innerGlowMat.opacity = 0.2 + Math.sin(this._time * 2) * 0.15;

      // Rotate progress ring
      entry.ring.rotation.z += deltaTime * 0.4;
      entry.arc.rotation.z += deltaTime * 0.4;

      // Orbit equation dots
      for (const dot of entry.dots) {
        const d = dot.mesh.userData;
        const angle = d._orbitOffset + this._time * d._orbitSpeed;
        dot.mesh.position.x = Math.cos(angle) * d._orbitRadius;
        dot.mesh.position.z = Math.sin(angle) * d._orbitRadius;
        dot.mesh.position.y = 0.02 + Math.sin(this._time * 2 + d._yPhase) * 0.008;
      }
    }

    // Pulse meditation figures
    for (const [, entry] of this._meditationFigures) {
      for (const fig of entry.figures) {
        const pulse = 0.5 + Math.sin(this._time * 1.5 + fig.phaseOffset) * 0.15;
        fig.mat.opacity = pulse + 0.2;
        fig.mat.emissiveIntensity = 0.3 + Math.sin(this._time * 2 + fig.phaseOffset) * 0.15;

        // Gentle bobbing
        fig.group.position.y = Math.sin(this._time * 0.8 + fig.phaseOffset) * 0.003;

        // Aura pulse (more visible)
        fig.auraMat.opacity = 0.15 + Math.sin(this._time * 1.2 + fig.phaseOffset) * 0.12;

        // Lotus mandala rotation + pulse
        fig.lotusMat.opacity = 0.25 + Math.sin(this._time * 1.0 + fig.phaseOffset) * 0.15;
        fig.innerLotusMat.opacity = 0.35 + Math.sin(this._time * 1.5 + fig.phaseOffset + 1.0) * 0.2;

        // Energy tendril pulse
        fig.tendrilMat.opacity = 0.12 + Math.sin(this._time * 2.0 + fig.phaseOffset) * 0.1;
      }
    }

    // Update level-up effects
    for (const [uuid, entry] of this._levelUpEffects) {
      entry.elapsed += deltaTime;
      const t = entry.elapsed / entry.duration;

      if (t >= 1) {
        // Effect complete, clean up
        if (entry.group.parent) entry.group.parent.remove(entry.group);
        entry.beamGeo.dispose();
        entry.beamMat.dispose();
        entry.innerBeamGeo.dispose();
        entry.innerBeamMat.dispose();
        entry.ringGeo.dispose();
        entry.ringMat.dispose();
        entry.ring2Geo.dispose();
        entry.ring2Mat.dispose();
        entry.burstGeo.dispose();
        entry.burstMat.dispose();
        this._levelUpEffects.delete(uuid);
        continue;
      }

      // Beam: fade out and stretch upward
      const beamFade = 1 - t * t;
      entry.beamMat.opacity = 0.4 * beamFade;
      entry.innerBeamMat.opacity = 0.5 * beamFade;
      entry.beam.scale.y = 1 + t * 0.3;
      entry.innerBeam.scale.y = 1 + t * 0.4;

      // Primary ring: expand and fade
      const ringScale = 1 + t * 2.5;
      entry.ring.scale.set(ringScale, ringScale, 1);
      entry.ringMat.opacity = 1 - t;
      entry.ring.position.y = t * 0.05;

      // Secondary ring: delayed start (appears at t=0.2), expands faster
      const t2 = Math.max(0, (t - 0.2) / 0.8);
      if (t2 > 0) {
        const ring2Scale = 1 + t2 * 3;
        entry.ring2.scale.set(ring2Scale, ring2Scale, 1);
        entry.ring2Mat.opacity = Math.min(0.7, t2 * 3) * (1 - t2);
        entry.ring2.position.y = t2 * 0.08;
      }

      // Move burst particles outward and upward
      const posAttr = entry.burst.geometry.getAttribute('position');
      for (let i = 0; i < posAttr.count; i++) {
        const vx = entry.burstVelocities[i * 3];
        const vy = entry.burstVelocities[i * 3 + 1];
        const vz = entry.burstVelocities[i * 3 + 2];
        posAttr.setX(i, posAttr.getX(i) + vx * deltaTime);
        posAttr.setY(i, posAttr.getY(i) + vy * deltaTime);
        posAttr.setZ(i, posAttr.getZ(i) + vz * deltaTime);
      }
      posAttr.needsUpdate = true;
      entry.burstMat.opacity = 1 - t * t;
    }
  }

  // ---------- Dispose ----------

  /**
   * Dispose all resources.
   */
  dispose() {
    // Clean up all construction materials
    for (const [, entry] of this._constructionMeshes) {
      for (const matEntry of entry.materials) {
        matEntry.mesh.material = matEntry.original;
        matEntry.material.dispose();
      }
    }
    this._constructionMeshes.clear();

    // Clean up all scaffoldings
    for (const [uuid, entry] of this._scaffoldings) {
      this._disposeScaffolding(uuid, entry);
    }

    // Clean up all craft indicators
    for (const [, entry] of this._craftIndicators) {
      if (entry.group.parent) entry.group.parent.remove(entry.group);
      entry.arcGeo.dispose();
      entry.arcMat.dispose();
      entry.ringMat.dispose();
      entry.itemMat.dispose();
      entry.particleMat.dispose();
      entry.particles.geometry.dispose();
    }
    this._craftIndicators.clear();

    // Clean up all research indicators
    for (const [, entry] of this._researchIndicators) {
      if (entry.group.parent) entry.group.parent.remove(entry.group);
      entry.hologramGeo.dispose();
      entry.hologramMat.dispose();
      entry.innerGlowMat.dispose();
      entry.innerGlow.geometry.dispose();
      entry.ringMat.dispose();
      entry.arcGeo.dispose();
      entry.arcMat.dispose();
      for (const dot of entry.dots) dot.mat.dispose();
    }
    this._researchIndicators.clear();

    // Clean up all meditation figures
    for (const [, entry] of this._meditationFigures) {
      if (entry.group.parent) entry.group.parent.remove(entry.group);
      for (const fig of entry.figures) {
        fig.mat.dispose();
        fig.lotusMat.dispose();
        fig.innerLotusMat.dispose();
        fig.innerLotusGeo.dispose();
        fig.tendrilMat.dispose();
        fig.tendrilGeo.dispose();
        fig.auraMat.dispose();
        fig.auraGeo.dispose();
      }
    }
    this._meditationFigures.clear();

    // Clean up all level-up effects
    for (const [, entry] of this._levelUpEffects) {
      if (entry.group.parent) entry.group.parent.remove(entry.group);
      entry.beamGeo.dispose();
      entry.beamMat.dispose();
      entry.innerBeamGeo.dispose();
      entry.innerBeamMat.dispose();
      entry.ringGeo.dispose();
      entry.ringMat.dispose();
      entry.ring2Geo.dispose();
      entry.ring2Mat.dispose();
      entry.burstGeo.dispose();
      entry.burstMat.dispose();
    }
    this._levelUpEffects.clear();

    // Clean up shared resources
    if (this._noiseTexture) {
      this._noiseTexture.dispose();
      this._noiseTexture = null;
    }
    if (this._sharedGeo) {
      for (const key of Object.keys(this._sharedGeo)) {
        const g = this._sharedGeo[key];
        if (g && g.dispose) g.dispose();
        else if (g && typeof g === 'object' && !g.dispose) {
          for (const subKey of Object.keys(g)) {
            if (g[subKey] && g[subKey].dispose) g[subKey].dispose();
          }
        }
      }
      this._sharedGeo = null;
    }
  }
}
