/**
 * City terrain mode — heightmap mesh, water, anchors, HUD overlays.
 */

import * as THREE from 'three';
import { DEG, M_PER_GU } from '../core/constants.js';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

export class CityManager {
  /**
   * @param {object} ctx - Shared context
   *   { scene, camera, controls, renderer, container, fn,
   *     raycaster, mouse, flyCamera }
   */
  constructor(ctx) {
    this._ctx = ctx;

    // City terrain objects
    this._cityGroup = null;
    this._terrainMesh = null;
    this._terrainMaterial = null;
    this._waterMesh = null;
    this._anchorGroup = null;
    this._cityNameLabel = null;
    this._oceanFloor = null;
    this._boundaryRing = null;
    this._meshSize = 4;
    this._cityRGU = 0;
    this._baseMaxHeight = 0;

    // Settings
    this._heightScale = 1.0;
    this._waterEnabled = true;
    this._wireframe = false;
    this._anchorMarkersVisible = false;

    // Config
    this._activeCityId = null;
    this._cityTerrainConfig = null;

    // HUD elements
    this._hudEl = null;
    this._scaleBarEl = null;
    this._compassEl = null;
  }

  get cityGroup() { return this._cityGroup; }
  get terrainMesh() { return this._terrainMesh; }
  get activeCityId() { return this._activeCityId; }
  get cityTerrainConfig() { return this._cityTerrainConfig; }

  /**
   * Create HUD overlay elements.
   * @param {HTMLElement} container
   */
  createHUDElements(container) {
    this._hudEl = document.createElement('div');
    this._hudEl.style.cssText =
      'position:absolute;bottom:12px;left:12px;font:12px/1.7 monospace;' +
      'color:#aac;text-shadow:0 1px 3px #000;pointer-events:none;user-select:none;display:none;';
    container.appendChild(this._hudEl);

    this._scaleBarEl = document.createElement('div');
    this._scaleBarEl.style.cssText =
      'position:absolute;bottom:12px;right:12px;font:11px monospace;' +
      'color:#aac;text-shadow:0 1px 3px #000;pointer-events:none;user-select:none;display:none;text-align:right;';
    container.appendChild(this._scaleBarEl);

    this._compassEl = document.createElement('div');
    this._compassEl.style.cssText =
      'position:absolute;top:12px;right:12px;width:52px;height:52px;' +
      'pointer-events:none;user-select:none;display:none;';
    container.appendChild(this._compassEl);
  }

  /**
   * Build city terrain mesh.
   */
  buildMesh(terrain, radiusKm, city) {
    const group = new THREE.Group();
    group.name = 'city-terrain';
    const fn = this._ctx.fn;

    const ms = this._meshSize;
    const config = {
      seed: terrain.seed,
      waterLine: terrain.waterLine,
      peakLine: terrain.peakLine,
      anchors: terrain.anchors || []
    };
    const rgu = Math.round(radiusKm / 111 * 10000);
    this._cityRGU = rgu;
    const maxH = ms * 0.08;
    this._baseMaxHeight = maxH;

    const res = 512;
    const geom = new THREE.PlaneGeometry(ms, ms, res - 1, res - 1);
    const pos = geom.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const r2 = rgu * rgu;
    const fadeR = rgu * 0.92;
    const fadeR2 = fadeR * fadeR;

    for (let i = 0; i < pos.count; i++) {
      const px = pos.getX(i);
      const py = pos.getY(i);
      const u = px / ms + 0.5;
      const v = py / ms + 0.5;
      const ox = Math.round((u - 0.5) * 2 * rgu);
      const oy = Math.round((v - 0.5) * 2 * rgu);
      const d2 = ox * ox + oy * oy;
      let e, mo;

      if (d2 > r2) {
        e = Math.max(1, config.waterLine - 30);
        mo = 128;
      } else if (d2 > fadeR2) {
        const t = (Math.sqrt(d2) - fadeR) / (rgu * 0.08);
        e = fn.elevation(config, ox, oy) * (1 - t) + (config.waterLine - 30) * t;
        mo = fn.moisture(config, ox, oy);
      } else {
        e = fn.elevation(config, ox, oy);
        mo = fn.moisture(config, ox, oy);
      }

      const h = (e / 255) * maxH;
      pos.setX(i, px);
      pos.setY(i, h);
      pos.setZ(i, -py);

      const [cr, cg, cb] = fn.elevColor(e, config.waterLine, config.peakLine, mo);
      colors[i * 3]     = cr / 255;
      colors[i * 3 + 1] = cg / 255;
      colors[i * 3 + 2] = cb / 255;
    }

    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geom.computeVertexNormals();

    const mat = new THREE.MeshLambertMaterial({
      vertexColors: true,
      wireframe: this._wireframe,
      side: THREE.FrontSide
    });
    this._terrainMaterial = mat;
    this._terrainMesh = new THREE.Mesh(geom, mat);
    group.add(this._terrainMesh);

    // Ocean floor
    const oceanGeom = new THREE.PlaneGeometry(ms * 8, ms * 8);
    const oceanMat = new THREE.MeshLambertMaterial({ color: 0x071428, side: THREE.DoubleSide });
    this._oceanFloor = new THREE.Mesh(oceanGeom, oceanMat);
    this._oceanFloor.rotation.x = -Math.PI / 2;
    this._oceanFloor.position.y = -maxH * 0.02;
    group.add(this._oceanFloor);

    // Water surface
    const waterY = (config.waterLine / 255) * maxH + maxH * 0.004;
    const waterGeom = new THREE.CircleGeometry(ms * 0.5, 128);
    const waterMat = new THREE.MeshPhongMaterial({
      color: 0x1a5088, transparent: true, opacity: 0.5,
      side: THREE.DoubleSide, shininess: 90, specular: 0x446688
    });
    this._waterMesh = new THREE.Mesh(waterGeom, waterMat);
    this._waterMesh.rotation.x = -Math.PI / 2;
    this._waterMesh.position.y = waterY;
    this._waterMesh.visible = this._waterEnabled;
    group.add(this._waterMesh);

    // Boundary ring
    const ringGeom = new THREE.RingGeometry(ms * 0.495, ms * 0.510, 128);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x3366aa, transparent: true, opacity: 0.25, side: THREE.DoubleSide
    });
    this._boundaryRing = new THREE.Mesh(ringGeom, ringMat);
    this._boundaryRing.rotation.x = -Math.PI / 2;
    this._boundaryRing.position.y = maxH * 0.45;
    group.add(this._boundaryRing);

    // Anchor markers
    this._anchorGroup = new THREE.Group();
    this._anchorGroup.name = 'anchors';
    this._anchorGroup.visible = this._anchorMarkersVisible;
    if (config.anchors.length > 0) {
      const dotGeom = new THREE.SphereGeometry(ms * 0.004, 8, 8);
      for (const a of config.anchors) {
        const au = a.x / (2 * rgu) + 0.5;
        const av = a.y / (2 * rgu) + 0.5;
        const ae = fn.elevation(config, a.x, a.y);
        const ah = (ae / 255) * maxH;
        const dotMat = new THREE.MeshBasicMaterial({ color: a.mass > 150 ? 0x44aaff : 0x44ff44 });
        const dot = new THREE.Mesh(dotGeom, dotMat);
        dot.position.set((au - 0.5) * ms, ah + ms * 0.005, -(av - 0.5) * ms);
        this._anchorGroup.add(dot);
      }
    }
    group.add(this._anchorGroup);

    // City name label
    const nameDiv = document.createElement('div');
    nameDiv.innerHTML =
      `<span style="font:bold 14px monospace;color:#fff;text-shadow:0 0 4px #000,0 0 8px #000">${city.name}</span>` +
      `<br><span style="font:11px monospace;color:#7ec8e3;text-shadow:0 0 3px #000">${city.type} \u00b7 ${radiusKm}km \u00b7 ${city.profile}</span>`;
    nameDiv.style.cssText = 'text-align:center;white-space:nowrap;user-select:none;pointer-events:none;';
    this._cityNameLabel = new CSS2DObject(nameDiv);
    this._cityNameLabel.position.set(0, maxH * 1.3 + 0.12, 0);
    group.add(this._cityNameLabel);

    group.visible = false;
    group.scale.y = this._heightScale;
    this._cityGroup = group;
    this._ctx.scene.add(group);
  }

  /**
   * Unload city terrain.
   */
  unload() {
    if (!this._cityGroup) return;
    this._ctx.scene.remove(this._cityGroup);
    this._cityGroup.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
    if (this._cityNameLabel?.element?.parentNode) {
      this._cityNameLabel.element.parentNode.removeChild(this._cityNameLabel.element);
    }
    this._cityGroup = null;
    this._terrainMesh = null;
    this._terrainMaterial = null;
    this._waterMesh = null;
    this._anchorGroup = null;
    this._cityNameLabel = null;
    this._oceanFloor = null;
    this._boundaryRing = null;
  }

  /**
   * Enter city mode.
   */
  enterMode(city, globeManager, azimuthalManager) {
    const ctx = this._ctx;

    // Save and exit azimuthal
    this._savedAzimProj = azimuthalManager.projection;
    if (azimuthalManager.projection === 'azimuthal') {
      azimuthalManager.exit();
    }

    ctx.setMode('transitioning');

    // Save globe camera
    if (!this._savedGlobeCamera) {
      this._savedGlobeCamera = {
        position: ctx.camera.position.clone(),
        target: ctx.controls.target.clone()
      };
    }

    // Hide globe
    if (globeManager.globeMesh) globeManager.globeMesh.visible = false;
    if (globeManager.starfield) globeManager.starfield.visible = false;
    globeManager.clearHoverGlow();
    globeManager.cityMarkers.visible = false;
    for (const lbl of globeManager.cityLabels) lbl.visible = false;

    // Show city terrain
    if (this._cityGroup) this._cityGroup.visible = true;

    ctx.scene.background = new THREE.Color(0x08101e);
    ctx.scene.fog = new THREE.FogExp2(0x08101e, 0.055);

    const rKm = (this._cityTerrainConfig && this._cityTerrainConfig.radiusKm) || 40;
    ctx.controls.target.set(0, 0, 0);
    ctx.controls.minDistance = 20 / rKm;
    ctx.controls.maxDistance = 9;
    ctx.controls.minPolarAngle = 5 * DEG;
    ctx.controls.maxPolarAngle = 82 * DEG;
    ctx.controls.enablePan = true;
    ctx.controls.panSpeed = 0.8;
    ctx.controls.screenSpacePanning = false;
    ctx.controls.zoomSpeed = 1.2;

    this._hudEl.style.display = 'block';
    this._scaleBarEl.style.display = 'block';
    this._compassEl.style.display = 'block';

    const tilt = 40 * DEG;
    const dist = 4.5;
    ctx.camera.position.set(0, dist * Math.sin(tilt), dist * Math.cos(tilt));
    ctx.controls.target.set(0, 0, 0);
    ctx.controls.update();
    ctx.setMode('city');
  }

  /**
   * Exit city mode.
   */
  exitMode(globeManager, azimuthalManager) {
    const ctx = this._ctx;
    if (ctx.getMode() === 'globe') return;
    ctx.setMode('transitioning');

    this._hudEl.style.display = 'none';
    this._scaleBarEl.style.display = 'none';
    this._compassEl.style.display = 'none';

    if (this._cityGroup) this._cityGroup.visible = false;
    if (globeManager.globeMesh) globeManager.globeMesh.visible = true;
    if (globeManager.starfield) globeManager.starfield.visible = true;
    globeManager.cityMarkers.visible = true;

    ctx.scene.background = new THREE.Color(0x080818);
    ctx.scene.fog = null;

    ctx.controls.minDistance = 1.08;
    ctx.controls.maxDistance = 5;
    ctx.controls.minPolarAngle = 0;
    ctx.controls.maxPolarAngle = Math.PI;
    ctx.controls.enablePan = false;
    ctx.controls.screenSpacePanning = true;
    ctx.controls.zoomSpeed = 1.0;

    const saved = this._savedGlobeCamera;
    const restorePos = saved ? saved.position.clone() : new THREE.Vector3(0, 0.8, 2.2);
    const restoreTarget = saved ? saved.target.clone() : new THREE.Vector3(0, 0, 0);

    const dir = restorePos.clone().sub(restoreTarget).normalize();
    const dist = restorePos.distanceTo(restoreTarget);
    restorePos.copy(restoreTarget).add(dir.multiplyScalar(Math.min(dist * 1.15, ctx.controls.maxDistance)));

    ctx.camera.position.copy(restorePos);
    ctx.controls.target.copy(restoreTarget);
    ctx.controls.update();

    ctx.setMode('globe');
    this._activeCityId = null;
    this._cityTerrainConfig = null;
    this._savedGlobeCamera = null;

    if (this._savedAzimProj === 'azimuthal') {
      azimuthalManager.enter();
      const cb = document.getElementById('worldAzimuthal');
      if (cb) cb.checked = true;
    }
    this._savedAzimProj = null;
  }

  /**
   * Load city terrain and enter city mode.
   */
  loadCityTerrain(cityId, terrain, radiusKm, cities, globeManager, azimuthalManager) {
    this.unload();
    const city = cities.find(c => c.id === cityId);
    if (!city) return;
    this._activeCityId = cityId;
    this._cityTerrainConfig = { city, config: terrain, radiusKm };
    this.buildMesh(terrain, radiusKm, city);
    this.enterMode(city, globeManager, azimuthalManager);
  }

  unloadCityTerrain(globeManager, azimuthalManager) {
    if (this._ctx.getMode() === 'city' || this._ctx.getMode() === 'transitioning') {
      this.exitMode(globeManager, azimuthalManager);
    }
    this.unload();
  }

  // ── Settings ──

  setHeightScale(scale) {
    this._heightScale = scale;
    if (this._cityGroup) this._cityGroup.scale.y = scale;
  }

  setWaterEnabled(enabled) {
    this._waterEnabled = enabled;
    if (this._waterMesh) this._waterMesh.visible = enabled;
  }

  setWireframe(enabled) {
    this._wireframe = enabled;
    if (this._terrainMaterial) this._terrainMaterial.wireframe = enabled;
  }

  setAnchorMarkers(visible) {
    this._anchorMarkersVisible = visible;
    if (this._anchorGroup) this._anchorGroup.visible = visible;
  }

  // ── Per-frame updates ──

  checkZoomOutTransition(onCityExit, globeManager, azimuthalManager) {
    if (this._ctx.getMode() !== 'city') return;
    const camDist = this._ctx.camera.position.distanceTo(this._ctx.controls.target);
    if (camDist < 8) return;
    if (onCityExit) {
      onCityExit();
    } else {
      this.exitMode(globeManager, azimuthalManager);
    }
  }

  updateHUD() {
    if (this._ctx.getMode() !== 'city' || !this._terrainMesh || !this._cityTerrainConfig) return;

    const rgu = this._cityRGU;
    const ms = this._meshSize;
    const radiusKm = this._cityTerrainConfig.radiusKm || 40;
    const worldToM = (radiusKm * 1000) / (ms / 2);

    const camAltM = Math.max(0, this._ctx.camera.position.y * this._heightScale) * worldToM;
    const altStr = camAltM >= 1000 ? (camAltM / 1000).toFixed(1) + ' km' : Math.round(camAltM) + ' m';

    this._ctx.raycaster.setFromCamera(this._ctx.mouse, this._ctx.camera);
    const hits = this._ctx.raycaster.intersectObject(this._terrainMesh);
    if (hits.length > 0) {
      const p = hits[0].point;
      const ox = Math.round(p.x * rgu / (ms / 2));
      const oy = Math.round(-p.z * rgu / (ms / 2));
      const distKm = (Math.sqrt(ox * ox + oy * oy) * M_PER_GU / 1000).toFixed(1);
      this._hudEl.innerHTML =
        `<span style="color:#6af">\u2316</span> ${ox}, ${oy}` +
        `  <span style="color:#555">|</span>  ${distKm} km from center<br>` +
        `<span style="color:#6af">\u25B3</span> Alt: ${altStr}`;
    } else {
      this._hudEl.innerHTML = `<span style="color:#6af">\u25B3</span> Alt: ${altStr}`;
    }
  }

  updateScaleBar() {
    if (this._ctx.getMode() !== 'city' || !this._cityTerrainConfig) return;
    const ms = this._meshSize;
    const radiusKm = this._cityTerrainConfig.radiusKm || 40;
    const worldToM = (radiusKm * 1000) / (ms / 2);
    const camDist = this._ctx.camera.position.distanceTo(this._ctx.controls.target);
    const visibleM = 2 * camDist * Math.tan(this._ctx.camera.fov * DEG / 2) * worldToM;
    const containerW = this._ctx.container.clientWidth || 1;
    const mPerPx = visibleM / containerW;
    const targetM = mPerPx * 100;
    const nice = [5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000];
    let scaleM = nice[0];
    for (const v of nice) { if (v >= targetM * 0.5) { scaleM = v; break; } }
    const barPx = Math.round(scaleM / mPerPx);
    const label = scaleM >= 1000 ? (scaleM / 1000) + ' km' : scaleM + ' m';
    this._scaleBarEl.innerHTML =
      `<div style="display:inline-block;width:${barPx}px;height:3px;background:#6af;margin-bottom:3px;border-radius:1px;box-shadow:0 0 6px #246a"></div><br>${label}`;
  }

  updateCompass() {
    if (this._ctx.getMode() !== 'city') return;
    const dx = this._ctx.camera.position.x - this._ctx.controls.target.x;
    const dz = this._ctx.camera.position.z - this._ctx.controls.target.z;
    const rot = -(Math.atan2(dx, dz) * 180 / Math.PI);
    this._compassEl.innerHTML =
      `<svg viewBox="0 0 52 52" width="52" height="52">
        <g transform="rotate(${rot.toFixed(1)} 26 26)">
          <circle cx="26" cy="26" r="24" fill="rgba(0,0,0,0.45)" stroke="#335" stroke-width="1"/>
          <polygon points="26,5 29,22 26,19 23,22" fill="#e44" stroke="none"/>
          <polygon points="26,47 29,30 26,33 23,30" fill="#557" stroke="none"/>
          <text x="26" y="14" text-anchor="middle" font-size="8" font-weight="bold" fill="#faa" font-family="monospace">N</text>
          <text x="26" y="46" text-anchor="middle" font-size="7" fill="#668" font-family="monospace">S</text>
        </g>
      </svg>`;
  }

  /**
   * Get HUD elements for disposal.
   */
  getHUDElements() {
    return [this._hudEl, this._scaleBarEl, this._compassEl].filter(Boolean);
  }

  dispose() {
    this.unload();
  }
}
