/**
 * AzimuthalManager — Azimuthal equidistant projection view.
 *
 * Extracted from terrain-renderer.js. Renders the globe texture onto a flat
 * disc using an azimuthal equidistant projection centered on the North Pole,
 * with an orthographic camera, pan/zoom interaction, and 2D city markers.
 */

import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { latLonToVec3 } from '../core/utils.js';
import { DEG } from '../core/constants.js';

export class AzimuthalManager {
  /**
   * @param {{ scene: THREE.Scene, camera: THREE.PerspectiveCamera, controls: OrbitControls, renderer: THREE.WebGLRenderer, container: HTMLElement }} ctx
   * @param {object} globeManager - GlobeManager instance exposing globeTexture, globeMesh, starfield, atmosphereMesh, cityMarkers, cityLabels, cities, clearHoverGlow
   */
  constructor(ctx, globeManager) {
    this._scene = ctx.scene;
    this._camera = ctx.camera;
    this._controls = ctx.controls;
    this._renderer = ctx.renderer;
    this._container = ctx.container;
    this._globe = globeManager;

    // Projection state
    this._globeProjection = 'sphere'; // 'sphere' | 'azimuthal'
    this._azimCenter = { lat: 90, lon: 0 };
    this._azimZoom = 1.0;

    // Disc mesh + material
    this._azimDisc = null;
    this._azimDiscMaterial = null;

    // 2D marker group, dot meshes, CSS2D labels
    this._azimCityMarkers2D = new THREE.Group();
    this._azimOrthoCamera = null;
    this._azimHandlers = {};
    this._azimCityDots = [];
    this._azimLabels = [];

    // Raycaster (shared internally)
    this._raycaster = new THREE.Raycaster();
    this._mouse = new THREE.Vector2(9, 9);

    // Callbacks
    this._onCityFocus = null;
    this._onCityHover = null;
  }

  // ── Getters / Setters ──

  get projection() {
    return this._globeProjection;
  }

  get orthoCamera() {
    return this._azimOrthoCamera;
  }

  set onCityFocus(fn) {
    this._onCityFocus = fn || null;
  }

  get onCityFocus() {
    return this._onCityFocus;
  }

  set onCityHover(fn) {
    this._onCityHover = fn || null;
  }

  get onCityHover() {
    return this._onCityHover;
  }

  // ── Public API ──

  /**
   * Switch between 'sphere' and 'azimuthal' projection while in globe mode.
   * @param {'sphere'|'azimuthal'} proj
   */
  setProjection(proj) {
    if (proj === this._globeProjection) return;
    if (proj === 'azimuthal') {
      this.enter();
    } else {
      this.exit();
    }
  }

  /**
   * Enter azimuthal equidistant view.
   */
  enter() {
    this._globeProjection = 'azimuthal';

    // Fixed center: North Pole (like the UN flag)
    this._azimCenter.lat = 90;
    this._azimCenter.lon = 0;

    // Build lazily
    this.buildDisc();
    this.buildOrthoCamera();
    this._azimZoom = 1.0;
    this.updateOrthoZoom();

    // Set shader center
    if (this._azimDiscMaterial) {
      this._azimDiscMaterial.uniforms.uCenterLat.value = this._azimCenter.lat * DEG;
      this._azimDiscMaterial.uniforms.uCenterLon.value = this._azimCenter.lon * DEG;
    }

    // Match background to ocean edge color (sRGB-corrected)
    this._scene.background = new THREE.Color(0x0a1628);

    // Hide sphere objects
    if (this._globe.globeMesh) this._globe.globeMesh.visible = false;
    if (this._globe.starfield) this._globe.starfield.visible = false;
    if (this._globe.atmosphereMesh) this._globe.atmosphereMesh.visible = false;
    this._globe.cityMarkers.visible = false;
    this._globe.clearHoverGlow();

    // Hide 3D CSS2D labels (we'll use our own 2D labels on the disc)
    for (const lbl of this._globe.cityLabels) lbl.visible = false;

    // Reset camera pan position
    if (this._azimOrthoCamera) {
      this._azimOrthoCamera.position.x = 0;
      this._azimOrthoCamera.position.y = 0;
    }

    // Show disc + 2D markers
    this._scene.add(this._azimDisc);
    this._scene.add(this._azimCityMarkers2D);
    this.updateCityMarkers();

    // Disable OrbitControls, install azimuthal handlers
    this._controls.enabled = false;
    this.setupInteraction();
  }

  /**
   * Exit azimuthal view and restore the 3D globe.
   */
  exit() {
    this._globeProjection = 'sphere';

    // Restore globe background
    this._scene.background = new THREE.Color(0x080818);

    // Hide disc + 2D markers
    if (this._azimDisc) this._scene.remove(this._azimDisc);
    this._scene.remove(this._azimCityMarkers2D);

    // Remove azimuthal labels
    for (const lbl of this._azimLabels) {
      this._scene.remove(lbl);
      if (lbl.element && lbl.element.parentNode) {
        lbl.element.parentNode.removeChild(lbl.element);
      }
    }
    this._azimLabels = [];

    // Show sphere objects
    if (this._globe.globeMesh) this._globe.globeMesh.visible = true;
    if (this._globe.starfield) this._globe.starfield.visible = true;
    if (this._globe.atmosphereMesh) this._globe.atmosphereMesh.visible = true;
    this._globe.cityMarkers.visible = true;

    // Restore 3D CSS2D labels (positions unchanged, just re-show)
    for (const lbl of this._globe.cityLabels) {
      lbl.visible = lbl.userData._userVisible !== false;
    }

    // Re-enable OrbitControls
    this._controls.enabled = true;
    this.removeInteraction();
  }

  // ── Disc Construction ──

  /**
   * Lazily build the azimuthal equidistant disc mesh with a custom shader.
   */
  buildDisc() {
    if (this._azimDisc) return; // already built

    // Large plane so ocean extends seamlessly beyond the disc at any zoom
    const geom = new THREE.PlaneGeometry(20, 20);
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTexture:   { value: this._globe.globeTexture },
        uCenterLat: { value: this._azimCenter.lat * DEG },
        uCenterLon: { value: this._azimCenter.lon * DEG },
      },
      vertexShader: `
        varying vec2 vPos;
        void main() {
          vPos = position.xy;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D uTexture;
        uniform float uCenterLat;
        uniform float uCenterLon;
        varying vec2 vPos;

        #define PI 3.14159265359

        void main() {
          float r = length(vPos);

          // Outside the globe disc: sample south-pole ocean from the texture
          if (r > 1.0) {
            // Sample ocean at south pole (v~0 = bottom of equirect)
            vec3 ocean = texture2D(uTexture, vec2(0.5, 0.02)).rgb;
            gl_FragColor = vec4(ocean, 1.0);
            return;
          }

          // Inverse azimuthal equidistant: disc (x,y) -> (lat, lon)
          float c = r * PI;
          float lat, lon;
          if (r < 0.0001) {
            lat = uCenterLat;
            lon = uCenterLon;
          } else {
            lat = asin(cos(c) * sin(uCenterLat) + (vPos.y * sin(c) * cos(uCenterLat)) / r);
            lon = uCenterLon + atan(
              vPos.x * sin(c),
              r * cos(uCenterLat) * cos(c) - vPos.y * sin(uCenterLat) * sin(c)
            );
          }

          // Wrap longitude to [-PI, PI]
          lon = mod(lon + PI, 2.0 * PI) - PI;

          // Equirectangular UV
          float u = (lon + PI) / (2.0 * PI);
          float v = (lat + PI * 0.5) / PI;

          vec3 texColor = texture2D(uTexture, vec2(u, v)).rgb;
          gl_FragColor = vec4(texColor, 1.0);
        }
      `,
      depthWrite: false,
    });

    this._azimDisc = new THREE.Mesh(geom, mat);
    this._azimDisc.name = 'azim-disc';
    this._azimDiscMaterial = mat;
  }

  // ── Orthographic Camera ──

  /**
   * Lazily build the orthographic camera used to view the azimuthal disc.
   */
  buildOrthoCamera() {
    if (this._azimOrthoCamera) return;
    this._azimOrthoCamera = new THREE.OrthographicCamera(-1.15, 1.15, 1.15, -1.15, 0.1, 10);
    this._azimOrthoCamera.position.set(0, 0, 2);
    this._azimOrthoCamera.lookAt(0, 0, 0);
  }

  /**
   * Update ortho camera frustum based on zoom level and container aspect ratio.
   */
  updateOrthoZoom() {
    if (!this._azimOrthoCamera) return;
    const w = this._container.clientWidth;
    const h = this._container.clientHeight;
    const aspect = w / h || 1;
    const halfH = 1.15 / this._azimZoom;
    const halfW = halfH * aspect;
    const cx = this._azimOrthoCamera.position.x;
    const cy = this._azimOrthoCamera.position.y;
    this._azimOrthoCamera.left = cx - halfW;
    this._azimOrthoCamera.right = cx + halfW;
    this._azimOrthoCamera.top = cy + halfH;
    this._azimOrthoCamera.bottom = cy - halfH;
    this._azimOrthoCamera.updateProjectionMatrix();
  }

  // ── Coordinate Projection ──

  /**
   * Forward azimuthal equidistant projection: (lat, lon) in degrees to disc (x, y).
   * Returns { x, y, visible } where visible is true if the point is within
   * 95% of the disc radius.
   */
  latLonToDisc(lat, lon) {
    const lat1 = this._azimCenter.lat * DEG;
    const lon1 = this._azimCenter.lon * DEG;
    const lat2 = lat * DEG;
    const lon2 = lon * DEG;
    const dlon = lon2 - lon1;

    const cosC = Math.sin(lat1) * Math.sin(lat2) + Math.cos(lat1) * Math.cos(lat2) * Math.cos(dlon);
    const c = Math.acos(Math.max(-1, Math.min(1, cosC)));

    if (c < 0.0001) return { x: 0, y: 0, visible: true };

    // Normalized disc radius (c/PI maps full globe to disc radius 1)
    const r = c / Math.PI;

    const sinC = Math.sin(c);
    const kx = (Math.cos(lat2) * Math.sin(dlon)) / sinC;
    const ky = (Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dlon)) / sinC;

    return { x: r * kx, y: r * ky, visible: r < 0.95 };
  }

  // ── City Markers ──

  /**
   * Rebuild all 2D city dot markers and CSS2D labels on the azimuthal disc.
   */
  updateCityMarkers() {
    // Remove old dots and labels
    for (const dot of this._azimCityDots) {
      this._azimCityMarkers2D.remove(dot);
      dot.geometry.dispose();
      dot.material.dispose();
    }
    this._azimCityDots = [];
    for (const lbl of this._azimLabels) {
      this._scene.remove(lbl);
      if (lbl.element && lbl.element.parentNode) {
        lbl.element.parentNode.removeChild(lbl.element);
      }
    }
    this._azimLabels = [];

    const typeColors = { Capital: 0xffd700, Trade: 0x44aaff, Combat: 0xff4444, Resource: 0x44ff44 };
    const dotRadius  = { Capital: 0.003, Trade: 0.002, Combat: 0.002, Resource: 0.002 };
    const typeCSS    = { Capital: '#ffd700', Trade: '#4af', Combat: '#f44', Resource: '#4f4' };
    const showLabels = document.getElementById('worldShowLabels');
    const labelsOn = !showLabels || showLabels.checked;

    const cities = this._globe.cities;
    for (let i = 0; i < cities.length; i++) {
      const city = cities[i];
      const proj = this.latLonToDisc(city.lat, city.lon);

      // Dot mesh — fixed world-space size (camera zoom handles magnification)
      const r = dotRadius[city.type] || 0.002;
      const geom = new THREE.CircleGeometry(r, 12);
      const mat = new THREE.MeshBasicMaterial({
        color: typeColors[city.type] || 0xffffff,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(geom, mat);
      mesh.position.set(proj.x, proj.y, 0.01);
      mesh.visible = proj.visible;
      mesh.userData = { cityId: city.id };
      this._azimCityMarkers2D.add(mesh);
      this._azimCityDots.push(mesh);

      // CSS2D label (screen-space, doesn't scale with camera zoom)
      if (proj.visible && labelsOn) {
        const div = document.createElement('div');
        const cssCol = typeCSS[city.type] || '#ccc';
        div.textContent = city.name;
        div.style.cssText = `color:${cssCol};font:bold 8px monospace;text-shadow:0 0 2px #000,0 0 4px #000;white-space:nowrap;user-select:none;pointer-events:none;`;
        const label = new CSS2DObject(div);
        label.position.set(proj.x, proj.y + r + 0.004, 0.02);
        this._scene.add(label);
        this._azimLabels.push(label);
      }
    }
  }

  // ── Interaction (Pan / Click / Wheel Zoom) ──

  /**
   * Install pointer and wheel event handlers for panning, clicking cities,
   * and zooming towards cursor position.
   */
  setupInteraction() {
    const dom = this._renderer.domElement;
    let dragging = false;
    let dragStart = null;

    this._azimHandlers._onPointerDown = (e) => {
      if (e.button !== 0) return;
      dragging = false;
      dragStart = {
        x: e.clientX, y: e.clientY,
        camX: this._azimOrthoCamera.position.x,
        camY: this._azimOrthoCamera.position.y,
      };
      dom.setPointerCapture(e.pointerId);
    };

    this._azimHandlers._onPointerMove = (e) => {
      if (!dragStart) return;
      const dx = e.clientX - dragStart.x;
      const dy = e.clientY - dragStart.y;
      if (!dragging && dx * dx + dy * dy > 9) dragging = true;
      if (!dragging) return;

      // Convert px movement to world units based on current ortho view size
      const rect = dom.getBoundingClientRect();
      const viewW = this._azimOrthoCamera.right - this._azimOrthoCamera.left;
      const viewH = this._azimOrthoCamera.top - this._azimOrthoCamera.bottom;
      const worldDx = -(dx / rect.width) * viewW;
      const worldDy = (dy / rect.height) * viewH;

      this._azimOrthoCamera.position.x = dragStart.camX + worldDx;
      this._azimOrthoCamera.position.y = dragStart.camY + worldDy;
      this.updateOrthoZoom();
      this._container.style.cursor = 'grabbing';
    };

    this._azimHandlers._onPointerUp = (e) => {
      if (dragStart && !dragging) {
        // Click — check for city hit
        const rect = dom.getBoundingClientRect();
        const mx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        const my = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        this._raycaster.setFromCamera(new THREE.Vector2(mx, my), this._azimOrthoCamera);
        const hits = this._raycaster.intersectObjects(this._azimCityDots, false);
        if (hits.length > 0) {
          const cityId = hits[0].object.userData.cityId;
          if (cityId != null && this._onCityFocus) {
            this._onCityFocus(cityId);
          }
        }
      }
      dragStart = null;
      dragging = false;
      this._container.style.cursor = '';
    };

    // Scroll zoom — zoom towards cursor position
    this._azimHandlers._onWheel = (e) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      const newZoom = Math.max(0.3, Math.min(20.0, this._azimZoom * factor));
      if (newZoom === this._azimZoom) return;

      // Zoom towards cursor: find world point under cursor, keep it fixed
      const rect = dom.getBoundingClientRect();
      const ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const ndcY = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      const cam = this._azimOrthoCamera;
      const worldX = cam.position.x + ndcX * (cam.right - cam.left) / 2;
      const worldY = cam.position.y + ndcY * (cam.top - cam.bottom) / 2;

      // After zoom, adjust camera so (worldX, worldY) stays under cursor
      this._azimZoom = newZoom;
      const halfH = 1.15 / this._azimZoom;
      const aspect = (this._container.clientWidth / this._container.clientHeight) || 1;
      const halfW = halfH * aspect;
      cam.position.x = worldX - ndcX * halfW;
      cam.position.y = worldY - ndcY * halfH;
      this.updateOrthoZoom();
    };

    dom.addEventListener('pointerdown', this._azimHandlers._onPointerDown);
    dom.addEventListener('pointermove', this._azimHandlers._onPointerMove);
    dom.addEventListener('pointerup', this._azimHandlers._onPointerUp);
    dom.addEventListener('wheel', this._azimHandlers._onWheel, { passive: false });
  }

  /**
   * Remove all azimuthal interaction event listeners from the renderer DOM element.
   */
  removeInteraction() {
    const dom = this._renderer.domElement;
    if (this._azimHandlers._onPointerDown) {
      dom.removeEventListener('pointerdown', this._azimHandlers._onPointerDown);
      dom.removeEventListener('pointermove', this._azimHandlers._onPointerMove);
      dom.removeEventListener('pointerup', this._azimHandlers._onPointerUp);
      dom.removeEventListener('wheel', this._azimHandlers._onWheel);
    }
    this._azimHandlers = {};
  }

  /**
   * Per-frame hover update: raycast against city dots, set cursor, invoke callback.
   * Call this from the render loop when the azimuthal view is active.
   * @param {THREE.Vector2} mouse - normalized device coordinates
   */
  updateHover(mouse) {
    if (!this._azimOrthoCamera) return;
    const m = mouse || this._mouse;
    this._raycaster.setFromCamera(m, this._azimOrthoCamera);
    const hits = this._raycaster.intersectObjects(this._azimCityDots, false);
    if (hits.length > 0) {
      this._container.style.cursor = 'pointer';
      const cityId = hits[0].object.userData.cityId;
      if (this._onCityHover) this._onCityHover(cityId);
    } else {
      this._container.style.cursor = '';
      if (this._onCityHover) this._onCityHover(null);
    }
  }

  // ── Cleanup ──

  /**
   * Fully dispose the azimuthal system: remove interaction, dispose GPU resources,
   * clean up dots, labels, and remove groups from the scene.
   */
  dispose() {
    this.removeInteraction();

    if (this._azimDisc) {
      this._scene.remove(this._azimDisc);
      this._azimDisc.geometry.dispose();
      this._azimDiscMaterial.dispose();
      this._azimDisc = null;
      this._azimDiscMaterial = null;
    }

    // Clean up 2D marker dots
    for (const dot of this._azimCityDots) {
      this._azimCityMarkers2D.remove(dot);
      dot.geometry.dispose();
      dot.material.dispose();
    }
    this._azimCityDots = [];

    // Clean up azimuthal labels
    for (const lbl of this._azimLabels) {
      this._scene.remove(lbl);
      if (lbl.element && lbl.element.parentNode) {
        lbl.element.parentNode.removeChild(lbl.element);
      }
    }
    this._azimLabels = [];

    this._scene.remove(this._azimCityMarkers2D);
    this._azimOrthoCamera = null;
    this._globeProjection = 'sphere';
  }
}
