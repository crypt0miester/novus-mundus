/**
 * globe.js -- Globe rendering manager extracted from terrain-renderer.js
 *
 * Manages the 3D globe sphere with Perlin noise ocean texture, biome-colored
 * land masses from coastline GeoJSON, city markers/labels, starfield backdrop,
 * hover interactions, zoom transitions, and scene lighting.
 *
 * Standalone ES module.
 */

import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { latLonToVec3 } from '../core/utils.js';

export class GlobeManager {
  /**
   * @param {object} ctx
   * @param {THREE.Scene} ctx.scene
   * @param {THREE.Camera} ctx.camera
   * @param {HTMLElement} ctx.container
   * @param {THREE.Raycaster} ctx.raycaster
   * @param {THREE.Vector2} ctx.mouse
   */
  constructor(ctx) {
    this._scene = ctx.scene;
    this._camera = ctx.camera;
    this._container = ctx.container;
    this._raycaster = ctx.raycaster;
    this._mouse = ctx.mouse;

    // Globe state
    this.globeRadius = 1;
    this.globeMesh = null;
    this.atmosphereMesh = null;
    this.atmosphereMaterial = null;
    this.globeTexture = null;
    this.starfield = null;
    this.cityMarkers = new THREE.Group();
    this.cityLabels = [];
    this.cities = [];
    this.sceneLights = [];

    // Hover state
    this.hoveredMarker = null;
    this.hoverRing = null;
    this.hoverPulseTime = 0;
    this.hoverOriginalScale = null;

    // Stored data
    this._worldData = null;
    this._coastlineData = null;

    // Callbacks (settable by consumer)
    this.onCityFocus = null;
    this.onCityHover = null;
  }

  // ════════════════════════════════════════════════
  //  Lighting
  // ════════════════════════════════════════════════

  /**
   * Create ambient + directional lights and add them to the scene.
   * @returns {THREE.Light[]} The array of created lights.
   */
  setupLights() {
    this.sceneLights = [];

    const amb = new THREE.AmbientLight(0x556677, 1.0);
    this._scene.add(amb);
    this.sceneLights.push(amb);

    const sun = new THREE.DirectionalLight(0xffeedd, 2.0);
    sun.position.set(3, 2, 4);
    this._scene.add(sun);
    this.sceneLights.push(sun);

    const fill = new THREE.DirectionalLight(0x8899bb, 0.5);
    fill.position.set(-2, -1, -2);
    this._scene.add(fill);
    this.sceneLights.push(fill);

    return this.sceneLights;
  }

  // ════════════════════════════════════════════════
  //  World loading
  // ════════════════════════════════════════════════

  /**
   * Load (or reload) globe with new world + coastline data.
   * Tears down any existing globe objects before rebuilding.
   */
  loadWorld(worldData, coastlineData) {
    this._worldData = worldData;
    this._coastlineData = coastlineData;
    this.cities = worldData.cities || [];

    // Tear down old globe
    if (this.globeMesh) {
      this._scene.remove(this.globeMesh);
      this.globeMesh.geometry.dispose();
      this.globeMesh.material.dispose();
    }
    if (this.starfield) {
      this._scene.remove(this.starfield);
      this.starfield.geometry.dispose();
      this.starfield.material.dispose();
    }
    // Dispose old globe texture to prevent GPU memory leak on reload
    if (this.globeTexture) {
      this.globeTexture.dispose();
      this.globeTexture = null;
    }
    this._scene.remove(this.cityMarkers);
    this.removeCityLabels();

    this.buildGlobe(coastlineData);
    this.buildCityMarkers();
    this.buildStarfield();
  }

  // ════════════════════════════════════════════════
  //  Globe texture + mesh
  // ════════════════════════════════════════════════

  /**
   * Build globe sphere with a procedural canvas texture:
   *   - Perlin noise ocean with latitude-based depth
   *   - Biome-colored land from coastline GeoJSON polygons
   *   - Coastline darkening pass
   *   - South pole land erasure below -65 deg
   */
  buildGlobe(coastlineData) {
    const R = this.globeRadius;
    const texW = 4096, texH = 2048;

    const tc = document.createElement('canvas');
    tc.width = texW;
    tc.height = texH;
    const tctx = tc.getContext('2d');

    // ── Perlin noise via permutation table ──
    const perm = new Uint8Array(512);
    for (let i = 0; i < 256; i++) perm[i] = i;
    for (let i = 255; i > 0; i--) { const j = (i * 7919 + 31) & 0xFF; const t = perm[i]; perm[i] = perm[j]; perm[j] = t; }
    for (let i = 0; i < 256; i++) perm[i + 256] = perm[i];
    const grad = (h, x, y) => { const u = (h & 1) ? x : -x; const v = (h & 2) ? y : -y; return u + v; };
    const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
    const lerp = (a, b, t) => a + t * (b - a);
    const noise2d = (px, py) => {
      const X = Math.floor(px) & 255, Y = Math.floor(py) & 255;
      const xf = px - Math.floor(px), yf = py - Math.floor(py);
      const u = fade(xf), v = fade(yf);
      const aa = perm[perm[X] + Y], ab = perm[perm[X] + Y + 1];
      const ba = perm[perm[X + 1] + Y], bb = perm[perm[X + 1] + Y + 1];
      return lerp(lerp(grad(aa, xf, yf), grad(ba, xf - 1, yf), u),
                  lerp(grad(ab, xf, yf - 1), grad(bb, xf - 1, yf - 1), u), v);
    };
    // Fractal noise: 3 octaves
    const fbm = (px, py) => {
      return noise2d(px, py) * 0.6 + noise2d(px * 2.1, py * 2.1) * 0.25 + noise2d(px * 4.3, py * 4.3) * 0.15;
    };

    // ── Biome colors [r, g, b] ──
    const BIOME_POLAR      = [225, 230, 235];
    const BIOME_TUNDRA     = [165, 175, 160];
    const BIOME_BOREAL     = [100, 120, 85];
    const BIOME_TEMPERATE  = [80, 115, 60];
    const BIOME_SUBTROPICAL = [120, 130, 65];
    const BIOME_TROPICAL   = [55, 110, 50];

    // Smooth biome lookup: returns [r,g,b] for given absolute latitude
    const biomeColor = (lat) => {
      const zones = [
        { lat: 0,  c: BIOME_TROPICAL },
        { lat: 15, c: BIOME_SUBTROPICAL },
        { lat: 35, c: BIOME_TEMPERATE },
        { lat: 55, c: BIOME_BOREAL },
        { lat: 70, c: BIOME_TUNDRA },
        { lat: 90, c: BIOME_POLAR },
      ];
      if (lat <= 0) return zones[0].c;
      if (lat >= 90) return zones[zones.length - 1].c;
      for (let i = 0; i < zones.length - 1; i++) {
        if (lat <= zones[i + 1].lat) {
          const t = (lat - zones[i].lat) / (zones[i + 1].lat - zones[i].lat);
          const s = t * t * (3 - 2 * t); // smoothstep
          return [
            zones[i].c[0] + s * (zones[i + 1].c[0] - zones[i].c[0]),
            zones[i].c[1] + s * (zones[i + 1].c[1] - zones[i].c[1]),
            zones[i].c[2] + s * (zones[i + 1].c[2] - zones[i].c[2]),
          ];
        }
      }
      return zones[zones.length - 1].c;
    };

    // ── Ocean base + depth variation ──
    const imgData = tctx.createImageData(texW, texH);
    const d = imgData.data;
    for (let y = 0; y < texH; y++) {
      const lat = Math.abs(90 - (y / texH) * 180);
      for (let x = 0; x < texW; x++) {
        const i = (y * texW + x) * 4;
        const n = fbm(x * 0.02, y * 0.02) * 8;
        // Deeper at equator, lighter at poles
        const depthShift = (1 - lat / 90) * 8;
        d[i]     = Math.max(0, Math.min(255, 16 + n));
        d[i + 1] = Math.max(0, Math.min(255, 38 + n + depthShift * 0.5));
        d[i + 2] = Math.max(0, Math.min(255, 78 + n + depthShift));
        d[i + 3] = 255;
      }
    }
    tctx.putImageData(imgData, 0, 0);

    // ── Land polygons: paint white mask, then apply biome tinting ──
    if (coastlineData && coastlineData.features) {
      const paintPolys = (style, alpha) => {
        tctx.globalAlpha = alpha;
        tctx.fillStyle = style;
        for (const feature of coastlineData.features) {
          const geom = feature.geometry;
          const polys = geom.type === 'MultiPolygon' ? geom.coordinates : [geom.coordinates];
          for (const poly of polys) {
            tctx.beginPath();
            for (const ring of poly) {
              for (let i = 0; i < ring.length; i++) {
                const px = ((ring[i][0] + 180) / 360) * texW;
                const py = ((90 - ring[i][1]) / 180) * texH;
                i === 0 ? tctx.moveTo(px, py) : tctx.lineTo(px, py);
              }
              tctx.closePath();
            }
            tctx.fill('evenodd');
          }
        }
      };
      paintPolys('#ffffff', 1.0);
      tctx.globalAlpha = 1.0;

      // Read back and apply smooth biome tinting with fractal noise
      const landData = tctx.getImageData(0, 0, texW, texH);
      const ld = landData.data;
      for (let y = 0; y < texH; y++) {
        const lat = Math.abs(90 - (y / texH) * 180);
        for (let x = 0; x < texW; x++) {
          const i = (y * texW + x) * 4;
          if (ld[i] < 40) continue; // ocean pixel (base ocean R is ~16-24)

          // Fractal noise for natural variation
          const n1 = fbm(x * 0.008, y * 0.008) * 18;
          const n2 = fbm(x * 0.015 + 50, y * 0.015 + 50) * 10;

          // Wobble latitude with noise so biome edges are organic
          const latWobble = lat + fbm(x * 0.005, y * 0.005) * 8;
          const [br, bg, bb] = biomeColor(latWobble);

          ld[i]     = Math.max(0, Math.min(255, br + n1 + n2 * 0.5));
          ld[i + 1] = Math.max(0, Math.min(255, bg + n1 * 0.7 + n2));
          ld[i + 2] = Math.max(0, Math.min(255, bb + n1 * 0.5 + n2 * 0.3));
        }
      }

      // Coastline darkening pass -- darken land pixels adjacent to ocean
      const isOcean = (px, py) => {
        if (px < 0 || px >= texW || py < 0 || py >= texH) return false;
        return ld[(py * texW + px) * 4] < 100; // ocean is dark
      };
      const coastDist = 3;
      for (let y = 0; y < texH; y++) {
        for (let x = 0; x < texW; x++) {
          const i = (y * texW + x) * 4;
          if (ld[i] < 100) continue; // skip ocean
          let nearCoast = false;
          for (let dy = -coastDist; dy <= coastDist && !nearCoast; dy++) {
            for (let dx = -coastDist; dx <= coastDist && !nearCoast; dx++) {
              if (dx === 0 && dy === 0) continue;
              if (isOcean(x + dx, y + dy)) nearCoast = true;
            }
          }
          if (nearCoast) {
            ld[i]     = Math.max(0, ld[i] * 0.82);
            ld[i + 1] = Math.max(0, ld[i + 1] * 0.82);
            ld[i + 2] = Math.max(0, ld[i + 2] * 0.82);
          }
        }
      }

      // Erase south pole land (below -65 deg lat) -- revert to ocean
      const southCutY = Math.floor(((90 + 65) / 180) * texH); // y where lat = -65 deg
      for (let y = southCutY; y < texH; y++) {
        const signedLat = 90 - (y / texH) * 180;
        const absLat = Math.abs(signedLat);
        for (let x = 0; x < texW; x++) {
          const i = (y * texW + x) * 4;
          if (ld[i] < 40) continue; // already ocean
          const n = fbm(x * 0.02, y * 0.02) * 8;
          const depthShift = (1 - absLat / 90) * 8;
          ld[i]     = Math.max(0, Math.min(255, 16 + n));
          ld[i + 1] = Math.max(0, Math.min(255, 38 + n + depthShift * 0.5));
          ld[i + 2] = Math.max(0, Math.min(255, 78 + n + depthShift));
        }
      }

      tctx.putImageData(landData, 0, 0);
    }

    const tex = new THREE.CanvasTexture(tc);
    tex.colorSpace = THREE.SRGBColorSpace;

    const sphereGeom = new THREE.SphereGeometry(R, 128, 64);
    const sphereMat = new THREE.MeshLambertMaterial({ map: tex });
    this.globeMesh = new THREE.Mesh(sphereGeom, sphereMat);
    this._scene.add(this.globeMesh);
    this.globeTexture = tex;
  }

  // ════════════════════════════════════════════════
  //  City markers + labels
  // ════════════════════════════════════════════════

  /**
   * Build colored dot markers on the globe surface for each city,
   * plus CSS2DObject text labels floating above them.
   */
  buildCityMarkers() {
    this.cityMarkers = new THREE.Group();
    this.cityMarkers.name = 'city-markers';

    const typeColors = { Capital: 0xffd700, Trade: 0x44aaff, Combat: 0xff4444, Resource: 0x44ff44 };
    const typeSizes  = { Capital: 0.014, Trade: 0.009, Combat: 0.009, Resource: 0.008 };
    const typeCSS    = { Capital: '#ffd700', Trade: '#4af', Combat: '#f44', Resource: '#4f4' };

    // Share SphereGeometry instances per unique marker size
    const geoBySize = new Map();

    for (const city of this.cities) {
      const color = typeColors[city.type] || 0xffffff;
      const size  = typeSizes[city.type]  || 0.008;

      // Dot on globe surface — shared geometry per size
      if (!geoBySize.has(size)) {
        geoBySize.set(size, new THREE.SphereGeometry(size, 12, 8));
      }
      const geom = geoBySize.get(size);
      const mat  = new THREE.MeshBasicMaterial({ color });
      const dot  = new THREE.Mesh(geom, mat);
      dot.position.copy(latLonToVec3(city.lat, city.lon, this.globeRadius + 0.003));
      dot.userData = { cityId: city.id };
      this.cityMarkers.add(dot);

      // CSS label
      const div = document.createElement('div');
      div.textContent = city.name;
      div.style.cssText = `color:${typeCSS[city.type] || '#ccc'};font:bold 11px monospace;text-shadow:0 0 3px #000,0 0 6px #000;white-space:nowrap;user-select:none;`;
      const label = new CSS2DObject(div);
      label.position.copy(latLonToVec3(city.lat, city.lon, this.globeRadius + 0.025));
      label.userData = { cityId: city.id, isLabel: true, _userVisible: true };
      this._scene.add(label);
      this.cityLabels.push(label);
    }

    this._scene.add(this.cityMarkers);
  }

  /**
   * Remove and clean up all city labels from the scene.
   */
  removeCityLabels() {
    for (const label of this.cityLabels) {
      this._scene.remove(label);
      if (label.element && label.element.parentNode) {
        label.element.parentNode.removeChild(label.element);
      }
    }
    this.cityLabels = [];
  }

  // ════════════════════════════════════════════════
  //  Starfield
  // ════════════════════════════════════════════════

  /**
   * Build a background starfield of 400 random points at radius 80-100.
   */
  buildStarfield() {
    const count = 400;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      // Random direction on a sphere, radius 80-100
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const r = 80 + Math.random() * 20;
      positions[i * 3]     = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = r * Math.cos(phi);
      // White/blue tint
      const blue = 0.7 + Math.random() * 0.3;
      colors[i * 3]     = 0.85 + Math.random() * 0.15;
      colors[i * 3 + 1] = 0.85 + Math.random() * 0.15;
      colors[i * 3 + 2] = blue;
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.PointsMaterial({
      size: 0.4,
      vertexColors: true,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.8,
      depthWrite: false
    });
    this.starfield = new THREE.Points(geom, mat);
    this.starfield.name = 'starfield';
    this._scene.add(this.starfield);
  }

  // ════════════════════════════════════════════════
  //  Hover interaction
  // ════════════════════════════════════════════════

  /**
   * Raycast mouse against city markers. Scale up hovered marker,
   * create pulsing ring, and invoke onCityHover callback.
   */
  updateGlobeHover() {
    if (!this.globeMesh) return;

    this._raycaster.setFromCamera(this._mouse, this._camera);

    // Test against city marker spheres
    const hits = this._raycaster.intersectObjects(this.cityMarkers.children, false);
    let hitMarker = null;
    let hitCityId = null;
    if (hits.length > 0) {
      hitMarker = hits[0].object;
      hitCityId = hitMarker.userData.cityId;
    }

    // Unhover previous if different
    if (this.hoveredMarker && this.hoveredMarker !== hitMarker) {
      if (this.hoverOriginalScale) {
        this.hoveredMarker.scale.copy(this.hoverOriginalScale);
      }
      this.hoveredMarker = null;
      this.hoverOriginalScale = null;
      this._container.style.cursor = '';
      if (this.onCityHover) this.onCityHover(null);
    }

    // Hide pooled ring if no hit
    if (!hitMarker) {
      if (this.hoverRing) {
        this.hoverRing.visible = false;
      }
      return;
    }

    // New hover
    if (this.hoveredMarker !== hitMarker) {
      this.hoveredMarker = hitMarker;
      this.hoverOriginalScale = hitMarker.scale.clone();
      this.hoverPulseTime = 0;
      this._container.style.cursor = 'pointer';
      if (this.onCityHover) this.onCityHover(hitCityId);

      // Create pooled ring on first hover, reuse thereafter
      if (!this.hoverRing) {
        const ringGeom = new THREE.RingGeometry(0.018, 0.025, 24);
        const ringMat = new THREE.MeshBasicMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 0.6,
          side: THREE.DoubleSide,
          depthWrite: false,
        });
        this.hoverRing = new THREE.Mesh(ringGeom, ringMat);
        this._scene.add(this.hoverRing);
      }
      this.hoverRing.material.color.copy(hitMarker.material.color);
      this.hoverRing.position.copy(hitMarker.position);
      // Orient ring to face outward from globe center
      this.hoverRing.lookAt(hitMarker.position.clone().multiplyScalar(2));
      this.hoverRing.visible = true;
    }

    // Animate hover: scale marker and pulse ring
    this.hoverPulseTime += 0.03;
    const s = 1.4;
    hitMarker.scale.set(
      this.hoverOriginalScale.x * s,
      this.hoverOriginalScale.y * s,
      this.hoverOriginalScale.z * s
    );
    if (this.hoverRing) {
      const pulse = 1.0 + 0.3 * Math.sin(this.hoverPulseTime * 4);
      this.hoverRing.scale.set(pulse, pulse, pulse);
      this.hoverRing.material.opacity = 0.3 + 0.3 * Math.sin(this.hoverPulseTime * 4);
    }
  }

  /**
   * Reset hovered marker scale and remove ring glow.
   */
  clearHoverGlow() {
    if (this.hoveredMarker && this.hoverOriginalScale) {
      this.hoveredMarker.scale.copy(this.hoverOriginalScale);
    }
    this.hoveredMarker = null;
    this.hoverOriginalScale = null;
    if (this.hoverRing) {
      this.hoverRing.visible = false;
    }
    this._container.style.cursor = '';
  }

  // ════════════════════════════════════════════════
  //  Label visibility (back-face culling)
  // ════════════════════════════════════════════════

  /**
   * Hide labels on the far side of the globe (dot product check)
   * AND respect user visibility toggle (_userVisible).
   */
  updateLabelVisibility() {
    if (!this.cityLabels.length) return;
    const camDir = this._camera.position.clone().normalize();
    for (const label of this.cityLabels) {
      const facing = label.position.clone().normalize().dot(camDir) > -0.15;
      const userWants = label.userData._userVisible !== false;
      label.visible = facing && userWants;
    }
  }

  // ════════════════════════════════════════════════
  //  Zoom transition detection
  // ════════════════════════════════════════════════

  /**
   * When camera is within 0.35 of globe surface, raycast center of screen,
   * find nearest city within ~12 deg (cos > 0.978), and call onCityFocus.
   */
  checkZoomTransition() {
    if (!this.globeMesh) return;

    const camDist = this._camera.position.length();
    if (camDist > this.globeRadius + 0.35) return; // trigger within 0.35 of surface

    // Find point on globe the camera is looking at
    this._raycaster.setFromCamera(new THREE.Vector2(0, 0), this._camera);
    const hits = this._raycaster.intersectObject(this.globeMesh);
    if (hits.length === 0) return;

    const hitDir = hits[0].point.clone().normalize();
    let bestCity = null, bestDot = -1;
    for (const city of this.cities) {
      const cityDir = latLonToVec3(city.lat, city.lon, 1).normalize();
      const dot = hitDir.dot(cityDir);
      if (dot > bestDot) { bestDot = dot; bestCity = city; }
    }

    // cos(12 deg) ~ 0.978 -- city must be within ~12 deg of where camera looks
    if (bestCity && bestDot > 0.978 && this.onCityFocus) {
      this.onCityFocus(bestCity.id);
    }
  }

  // ════════════════════════════════════════════════
  //  Dispose / cleanup
  // ════════════════════════════════════════════════

  /**
   * Clean up all globe resources: meshes, materials, textures, labels, lights.
   */
  dispose() {
    if (this.globeMesh) {
      this._scene.remove(this.globeMesh);
      this.globeMesh.geometry.dispose();
      this.globeMesh.material.dispose();
      if (this.globeTexture) this.globeTexture.dispose();
      this.globeMesh = null;
      this.globeTexture = null;
    }

    if (this.atmosphereMesh) {
      this._scene.remove(this.atmosphereMesh);
      this.atmosphereMesh.geometry.dispose();
      if (this.atmosphereMaterial) this.atmosphereMaterial.dispose();
      this.atmosphereMesh = null;
      this.atmosphereMaterial = null;
    }

    if (this.starfield) {
      this._scene.remove(this.starfield);
      this.starfield.geometry.dispose();
      this.starfield.material.dispose();
      this.starfield = null;
    }

    this.clearHoverGlow();
    // Dispose pooled hover ring on full cleanup
    if (this.hoverRing) {
      this._scene.remove(this.hoverRing);
      this.hoverRing.geometry.dispose();
      this.hoverRing.material.dispose();
      this.hoverRing = null;
    }

    this._scene.remove(this.cityMarkers);
    this.cityMarkers.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
    this.cityMarkers = new THREE.Group();

    this.removeCityLabels();

    for (const light of this.sceneLights) {
      this._scene.remove(light);
      if (light.dispose) light.dispose();
    }
    this.sceneLights = [];

    this.cities = [];
    this._worldData = null;
    this._coastlineData = null;
  }
}
