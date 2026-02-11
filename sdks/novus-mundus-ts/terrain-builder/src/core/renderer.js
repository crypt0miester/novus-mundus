/**
 * TerrainRenderer — Thin facade over modular globe, city, and town subsystems.
 *
 * Three modes:
 *   Globe: orbit a textured sphere with city markers + labels
 *   City:  globe fades out, full-screen tilted heightmap terrain
 *   Town:  close-up estate view with interactive plot/building editor
 *
 * Backward-compatible public API. All heavy logic is delegated to:
 *   - GlobeManager (src/globe/globe.js)
 *   - AzimuthalManager (src/globe/azimuthal.js)
 *   - CityManager (src/city/city.js)
 *   - TownManager (src/town/manager.js)
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';

import { DEG } from './constants.js';
import { easeInOutCubic, latLonToVec3 } from './utils.js';
import { GlobeManager } from '../globe/globe.js';
import { AzimuthalManager } from '../globe/azimuthal.js';
import { CityManager } from '../city/city.js';
import { TownManager } from '../town/manager.js';

export { BUILDING_TYPES } from './constants.js';

export class TerrainRenderer {
  constructor({ container, functions, coastlineData, worldData, onCityFocus, onCityExit, onCityHover }) {
    this._container = container;
    this._fn = functions;
    this._onCityFocus = onCityFocus || null;
    this._onCityExit = onCityExit || null;
    this._onCityHover = onCityHover || null;
    this._disposed = false;

    // Mode
    this._mode = 'globe';
    this._zoomTransitionPending = false;

    // Animation
    this._animating = null;

    // Raycaster
    this._raycaster = new THREE.Raycaster();
    this._mouse = new THREE.Vector2(9, 9);

    // ── Scene ──
    this._scene = new THREE.Scene();
    this._scene.background = new THREE.Color(0x080818);

    // ── Camera ──
    this._camera = new THREE.PerspectiveCamera(50, 1, 0.001, 200);
    this._camera.position.set(0, 0.8, 2.2);

    // ── WebGL Renderer ──
    this._renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this._renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this._renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this._renderer.domElement);

    // ── CSS2D Renderer ──
    this._labelRenderer = new CSS2DRenderer();
    this._labelRenderer.domElement.style.position = 'absolute';
    this._labelRenderer.domElement.style.top = '0';
    this._labelRenderer.domElement.style.left = '0';
    this._labelRenderer.domElement.style.pointerEvents = 'none';
    container.appendChild(this._labelRenderer.domElement);

    // ── Controls ──
    this._controls = new OrbitControls(this._camera, this._renderer.domElement);
    this._controls.enableDamping = true;
    this._controls.dampingFactor = 0.08;
    this._controls.minDistance = 1.08;
    this._controls.maxDistance = 5;
    this._controls.target.set(0, 0, 0);
    this._controls.enablePan = false;

    // ── Shared context for managers ──
    const ctx = {
      scene: this._scene,
      camera: this._camera,
      controls: this._controls,
      renderer: this._renderer,
      labelRenderer: this._labelRenderer,
      container: this._container,
      raycaster: this._raycaster,
      mouse: this._mouse,
      fn: this._fn,
      getMode: () => this._mode,
      setMode: (m) => {
        this._mode = m;
        if (m === 'globe') this._zoomTransitionPending = false;
      },
      flyCamera: (endPos, endTarget, duration) => this._flyCamera(endPos, endTarget, duration),
    };

    // ── Globe Manager ──
    this._globe = new GlobeManager(ctx);
    this._globe.setupLights();
    this._globe.onCityFocus = (cityId) => {
      this._zoomTransitionPending = true;
      if (this._onCityFocus) this._onCityFocus(cityId);
    };
    this._globe.onCityHover = onCityHover;

    // Wire up scene lights so other managers can reference them
    ctx.sceneLights = this._globe.sceneLights;
    ctx.globeMesh = null; // Set after globe is built
    ctx.starfield = null;
    ctx.atmosphereMesh = null;
    ctx.cityMarkers = this._globe.cityMarkers;
    ctx.cityLabels = this._globe.cityLabels;

    // ── Azimuthal Manager ──
    this._azimuthal = new AzimuthalManager(ctx, this._globe);
    this._azimuthal.onCityFocus = (cityId) => {
      if (this._onCityFocus) {
        this._zoomTransitionPending = true;
        this._onCityFocus(cityId);
      }
    };
    this._azimuthal.onCityHover = onCityHover;

    // ── City Manager ──
    this._city = new CityManager(ctx);
    this._city.createHUDElements(container);

    // Wire city group into context
    ctx.cityGroup = null;

    // ── Town Manager ──
    ctx.atmosphereMesh = this._globe.atmosphereMesh;
    ctx.globeMesh = this._globe.globeMesh;
    ctx.starfield = this._globe.starfield;
    this._town = new TownManager(ctx);

    // Store context ref for dynamic property access
    this._ctx = ctx;

    // Build globe if data provided
    if (coastlineData && worldData) {
      this.loadWorld(worldData, coastlineData);
    }

    // Mouse tracking
    this._onMouseMove = (e) => {
      const rect = this._renderer.domElement.getBoundingClientRect();
      this._mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      this._mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    };
    this._renderer.domElement.addEventListener('mousemove', this._onMouseMove);

    // Click on globe city markers
    this._clickStart = null;
    this._onPointerDown = (e) => {
      if (e.button !== 0) return;
      this._clickStart = { x: e.clientX, y: e.clientY, time: performance.now() };
    };
    this._onPointerUp = (e) => {
      if (!this._clickStart || this._mode !== 'globe' || !this._onCityFocus) return;
      if (this._azimuthal.projection === 'azimuthal') return;
      const dx = e.clientX - this._clickStart.x;
      const dy = e.clientY - this._clickStart.y;
      const dt = performance.now() - this._clickStart.time;
      this._clickStart = null;
      if (dx * dx + dy * dy > 16 || dt > 400) return;

      const rect = this._renderer.domElement.getBoundingClientRect();
      const mouse = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
      );
      this._raycaster.setFromCamera(mouse, this._camera);

      const hits = this._raycaster.intersectObjects(this._globe.cityMarkers.children, false);
      if (hits.length > 0) {
        const cityId = hits[0].object.userData.cityId;
        if (cityId != null) {
          this._zoomTransitionPending = true;
          this._onCityFocus(cityId);
          return;
        }
      }

      if (this._globe.globeMesh) {
        const globeHits = this._raycaster.intersectObject(this._globe.globeMesh);
        if (globeHits.length > 0) {
          const hitDir = globeHits[0].point.clone().normalize();
          let bestCity = null, bestDot = -1;
          for (const city of this._globe.cities) {
            const cityDir = latLonToVec3(city.lat, city.lon, 1).normalize();
            const d = hitDir.dot(cityDir);
            if (d > bestDot) { bestDot = d; bestCity = city; }
          }
          if (bestCity && bestDot > 0.99) {
            this._zoomTransitionPending = true;
            this._onCityFocus(bestCity.id);
          }
        }
      }
    };
    this._renderer.domElement.addEventListener('pointerdown', this._onPointerDown);
    this._renderer.domElement.addEventListener('pointerup', this._onPointerUp);

    // Resize + loop
    this.resize();
    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
    this._animate();
  }

  // ════════════════════════════════════════════════
  //  Public API (backward compatible)
  // ════════════════════════════════════════════════

  loadWorld(worldData, coastlineData) {
    this._globe.loadWorld(worldData, coastlineData);
    // Update context references
    this._ctx.globeMesh = this._globe.globeMesh;
    this._ctx.starfield = this._globe.starfield;
    this._ctx.atmosphereMesh = this._globe.atmosphereMesh;
    this._ctx.cityMarkers = this._globe.cityMarkers;
    this._ctx.cityLabels = this._globe.cityLabels;
  }

  loadCityTerrain(cityId, terrain, radiusKm) {
    this._city.loadCityTerrain(cityId, terrain, radiusKm, this._globe.cities, this._globe, this._azimuthal);
    this._ctx.cityGroup = this._city.cityGroup;
  }

  unloadCityTerrain() {
    this._city.unloadCityTerrain(this._globe, this._azimuthal);
  }

  flyToCity(cityId, duration = 1.0) {
    if (this._mode !== 'city' && this._mode !== 'transitioning') {
      const city = this._globe.cities.find(c => c.id === cityId);
      if (city) this._city.enterMode(city, this._globe, this._azimuthal);
    }
  }

  flyToGlobe(duration = 1.0) {
    this._city.exitMode(this._globe, this._azimuthal);
  }

  setCameraTarget(lon, lat, distance) {
    const pos = latLonToVec3(lat, lon, this._globe.globeRadius);
    const normal = pos.clone().normalize();
    this._camera.position.copy(pos.clone().add(normal.clone().multiplyScalar(distance)));
    this._controls.target.copy(pos);
    this._controls.update();
  }

  setHeightScale(scale) { this._city.setHeightScale(scale); }
  setWaterEnabled(enabled) { this._city.setWaterEnabled(enabled); }
  setWireframe(enabled) { this._city.setWireframe(enabled); }
  setAnchorMarkers(visible) { this._city.setAnchorMarkers(visible); }
  setCityLabelsVisible(visible) { this._globe.setCityLabelsVisible(visible); }
  setGlobeProjection(proj) {
    if (this._mode !== 'globe') return;
    this._azimuthal.setProjection(proj);
  }

  resize() {
    if (this._disposed) return;
    const w = this._container.clientWidth;
    const h = this._container.clientHeight;
    if (w === 0 || h === 0) return;
    this._camera.aspect = w / h;
    this._camera.updateProjectionMatrix();
    this._renderer.setSize(w, h);
    this._labelRenderer.setSize(w, h);
    if (this._azimuthal.orthoCamera) this._azimuthal.updateOrthoZoom();
  }

  dispose() {
    this._disposed = true;
    window.removeEventListener('resize', this._onResize);
    this._renderer.domElement.removeEventListener('mousemove', this._onMouseMove);
    this._renderer.domElement.removeEventListener('pointerdown', this._onPointerDown);
    this._renderer.domElement.removeEventListener('pointerup', this._onPointerUp);
    this._controls.dispose();

    this._town.dispose();
    this._city.dispose();
    this._azimuthal.dispose();
    this._globe.dispose();

    this._renderer.dispose();

    const cityHUDs = this._city.getHUDElements();
    for (const el of [this._renderer.domElement, this._labelRenderer.domElement, ...cityHUDs]) {
      if (el && el.parentNode) el.parentNode.removeChild(el);
    }
  }

  get canvas() { return this._renderer.domElement; }
  get scene() { return this._scene; }
  get camera() { return this._camera; }
  get mode() { return this._mode; }

  // ── Town API (delegated) ──

  enterTownMode(terrain, options = {}) { this._town.enter(terrain, options); }
  exitTownMode() { this._town.exit(); }
  enterTownModeWithLayout(terrain, layout, options = {}) { this._town.enterWithLayout(terrain, layout, options); }
  updateTownLayout(layout) { this._town.updateLayout(layout); }
  getTownState() { return this._town.getState(); }
  getTownLayout() { return this._town.getLayout(); }
  setTownTimeOfDay(hour) { this._town.setTimeOfDay(hour); }
  toggleGridOverlay(show) { this._town.toggleGrid(show); }

  // ════════════════════════════════════════════════
  //  Camera animation
  // ════════════════════════════════════════════════

  _flyCamera(endPos, endTarget, duration, onComplete) {
    this._animating = {
      startPos: this._camera.position.clone(),
      startTarget: this._controls.target.clone(),
      endPos: endPos.clone(),
      endTarget: endTarget.clone(),
      startTime: performance.now(),
      durationMs: duration * 1000,
      onComplete: onComplete || null
    };
  }

  _tickAnimation() {
    if (!this._animating) return;
    const elapsed = performance.now() - this._animating.startTime;
    let t = Math.min(elapsed / this._animating.durationMs, 1.0);
    t = easeInOutCubic(t);
    this._camera.position.lerpVectors(this._animating.startPos, this._animating.endPos, t);
    this._controls.target.lerpVectors(this._animating.startTarget, this._animating.endTarget, t);
    if (t >= 1.0) {
      const cb = this._animating.onComplete;
      this._animating = null;
      if (cb) cb();
    }
  }

  // ════════════════════════════════════════════════
  //  Animation loop
  // ════════════════════════════════════════════════

  _animate() {
    if (this._disposed) return;
    requestAnimationFrame(() => this._animate());

    this._tickAnimation();

    const isAzim = this._mode === 'globe' && this._azimuthal.projection === 'azimuthal';

    if (!isAzim) this._controls.update();

    if (this._mode === 'globe') {
      if (isAzim) {
        this._azimuthal.updateHover(this._mouse);
      } else {
        this._globe.updateLabelVisibility();
        if (!this._zoomTransitionPending && !this._animating) {
          this._globe.checkZoomTransition();
        }
        this._globe.updateGlobeHover();
      }
    } else if (this._mode === 'city') {
      this._city.checkZoomOutTransition(this._onCityExit, this._globe, this._azimuthal);
      this._city.updateHUD();
      this._city.updateScaleBar();
      this._city.updateCompass();
    }

    const cam = isAzim ? this._azimuthal.orthoCamera : this._camera;
    this._renderer.render(this._scene, cam);
    this._labelRenderer.render(this._scene, cam);
  }
}
