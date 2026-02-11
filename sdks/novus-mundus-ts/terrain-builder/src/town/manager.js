/**
 * Town mode manager — orchestrates town enter/exit, scene construction, layout updates.
 */

import * as THREE from 'three';
import { DEG, DEFAULT_PLOT_POSITIONS } from '../core/constants.js';
import { buildTownSquare, scatterTrees, buildDecorations, buildWalls, buildPlotPad, buildGridOverlay } from './environment.js';
import { placeBuildingMesh, refreshAllBuildings } from './buildings.js';
import { updateTownLighting, applyLayoutLighting } from './lighting.js';
import {
  createTownHUD, destroyTownHUD, townHUDContent, bindTownHUDEvents,
  setupTownInteraction, removeTownInteraction, updateSelectionRings
} from './interaction.js';

export class TownManager {
  /**
   * @param {object} ctx - Shared renderer context
   *   { scene, camera, controls, renderer, labelRenderer, container, fn,
   *     flyCamera, sceneLights, atmosphereMesh, globeMesh, starfield,
   *     cityMarkers, cityLabels, cityGroup }
   */
  constructor(ctx) {
    this._ctx = ctx;

    // Town state
    this._townGroup = null;
    this._terrainConfig = null;
    this._estateState = null;
    this._plotGroups = [];
    this._buildingMeshes = new Map();
    this._townSquareGroup = null;
    this._hud = null;
    this._selectedSlot = null;
    this._selectedType = -1;
    this._dragPlot = null;
    this._townRaycaster = new THREE.Raycaster();
    this._townMouse = new THREE.Vector2();
    this._timeOfDay = 12;
    this._plotPositions = DEFAULT_PLOT_POSITIONS.map(p => ({ ...p }));
    this._labels = [];
    this._handlers = {};
    this._layout = null;
    this._gridOverlay = null;
    this._decorationGroup = null;
    this._wallGroup = null;
  }

  get layout() { return this._layout; }
  get estateState() { return this._estateState; }
  get plotPositions() { return this._plotPositions; }
  get plotGroups() { return this._plotGroups; }
  get buildingMeshes() { return this._buildingMeshes; }
  get townGroup() { return this._townGroup; }

  /**
   * Enter town mode.
   * @param {object} terrain - City terrain config
   * @param {object} options - { plotsOwned, buildings, reset }
   */
  enter(terrain, options = {}) {
    const ctx = this._ctx;

    if (ctx.getMode() === 'city') {
      if (ctx.cityGroup) ctx.cityGroup.visible = false;
    } else if (ctx.getMode() !== 'town') {
      if (ctx.globeMesh) ctx.globeMesh.visible = false;
      if (ctx.starfield) ctx.starfield.visible = false;
      ctx.cityMarkers.visible = false;
      for (const lbl of ctx.cityLabels) lbl.visible = false;
    }

    ctx.setMode('town');
    this._terrainConfig = terrain;
    if (!this._layout) {
      this._plotPositions = DEFAULT_PLOT_POSITIONS.map(p => ({ ...p }));
    }

    if (!this._estateState || options.reset) {
      this._estateState = {
        plotsOwned: options.plotsOwned || 1,
        buildings: new Array(20).fill(null).map(() => ({ type: -1, status: 0, level: 0 })),
      };
      this._estateState.buildings[0] = { type: 0, status: 2, level: 1 };
    }

    ctx.renderer.shadowMap.enabled = true;
    ctx.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    if (ctx.sceneLights) for (const l of ctx.sceneLights) l.visible = false;

    this._buildScene(terrain);
    this._createHUD();
    this._setupInteraction();

    ctx.scene.background = new THREE.Color(0x78b4d4);
    if (ctx.atmosphereMesh) ctx.atmosphereMesh.visible = false;

    const L = this._layout;
    const cam = L ? L.camera : null;
    const targetY = cam ? cam.targetY : 0.1;

    ctx.controls.target.set(0, 0, targetY);
    ctx.controls.minDistance = cam ? cam.minDistance : 1.2;
    ctx.controls.maxDistance = cam ? cam.maxDistance : 7;
    ctx.controls.minPolarAngle = 20 * DEG;
    ctx.controls.maxPolarAngle = 75 * DEG;
    ctx.controls.enablePan = true;
    ctx.controls.panSpeed = 1.0;
    ctx.controls.screenSpacePanning = false;

    const dist = cam ? cam.distance : 4.0;
    const yaw = cam ? cam.yaw : 35;
    const pitch = cam ? cam.pitch : 40;
    const camPos = new THREE.Vector3(
      dist * Math.sin(yaw * DEG) * Math.cos(pitch * DEG),
      dist * Math.sin(pitch * DEG),
      dist * Math.cos(yaw * DEG) * Math.cos(pitch * DEG)
    );
    ctx.flyCamera(camPos, new THREE.Vector3(0, 0, targetY), 0.8);
  }

  /**
   * Enter town mode with an external layout config.
   */
  enterWithLayout(terrain, layout, options = {}) {
    this._layout = layout;
    if (layout && layout.plots) {
      this._plotPositions = layout.plots.map(p => ({ x: p.x, z: p.z }));
    }
    this.enter(terrain, options);
  }

  /**
   * Live-update the layout (rebuilds scene).
   */
  updateLayout(layout) {
    if (this._ctx.getMode() !== 'town') return;
    this._layout = layout;
    if (layout && layout.plots) {
      this._plotPositions = layout.plots.map(p => ({ x: p.x, z: p.z }));
    }
    if (layout && layout.lighting) {
      applyLayoutLighting(this._townGroup, layout.lighting);
    }
    this._buildScene(this._terrainConfig);
    this._updateLighting();
  }

  /**
   * Exit town mode.
   */
  exit() {
    const ctx = this._ctx;
    this._unloadScene();
    this._destroyHUD();
    this._removeInteraction();
    this._selectedSlot = null;
    this._selectedType = -1;

    ctx.scene.fog = null;
    ctx.renderer.shadowMap.enabled = false;

    if (ctx.sceneLights) for (const l of ctx.sceneLights) l.visible = true;

    ctx.setMode('globe');
    if (ctx.globeMesh) ctx.globeMesh.visible = true;
    if (ctx.starfield) ctx.starfield.visible = true;
    if (ctx.atmosphereMesh) ctx.atmosphereMesh.visible = true;
    ctx.cityMarkers.visible = true;

    ctx.scene.background = new THREE.Color(0x0a0a1a);
    ctx.controls.minDistance = 1.2;
    ctx.controls.maxDistance = 6;
    ctx.controls.minPolarAngle = 0;
    ctx.controls.maxPolarAngle = Math.PI;
    ctx.controls.enablePan = false;
    ctx.controls.screenSpacePanning = true;
    ctx.flyCamera(new THREE.Vector3(0, 0.8, 2.2), new THREE.Vector3(0, 0, 0), 0.6);
  }

  getState() {
    return {
      plotPositions: this._plotPositions.map(p => ({ ...p })),
      estate: JSON.parse(JSON.stringify(this._estateState)),
    };
  }

  getLayout() {
    if (!this._layout) return null;
    const layout = JSON.parse(JSON.stringify(this._layout));
    for (let i = 0; i < layout.plots.length && i < this._plotPositions.length; i++) {
      layout.plots[i].x = Math.round(this._plotPositions[i].x * 100) / 100;
      layout.plots[i].z = Math.round(this._plotPositions[i].z * 100) / 100;
    }
    return layout;
  }

  setTimeOfDay(hour) {
    this._timeOfDay = Math.max(0, Math.min(24, hour));
    this._updateLighting();
  }

  toggleGrid(show) {
    if (show && !this._gridOverlay && this._townGroup) {
      this._gridOverlay = buildGridOverlay(this._townGroup);
    }
    if (this._gridOverlay) this._gridOverlay.visible = !!show;
  }

  // ── Scene Construction ──

  _buildScene(terrain) {
    this._unloadScene();
    const group = new THREE.Group();
    group.name = 'town';
    const L = this._layout;
    const lt = L ? L.lighting : null;
    const tt = L ? L.terrain : null;
    const ctx = this._ctx;

    const config = {
      seed: terrain.seed, waterLine: terrain.waterLine,
      peakLine: terrain.peakLine, anchors: terrain.anchors || [],
    };

    // Sun light
    const sunColor = lt ? lt.sunColor : 0xffeedd;
    const sunIntensity = lt ? lt.sunIntensity : 2.0;
    const sunPos = lt ? lt.sunPosition : [3, 4, 2];
    const shadowSize = lt ? lt.shadowMapSize : 2048;
    const shadowBias = lt ? lt.shadowBias : -0.002;
    const townSun = new THREE.DirectionalLight(sunColor, sunIntensity);
    townSun.position.set(sunPos[0], sunPos[1], sunPos[2]);
    townSun.castShadow = true;
    townSun.shadow.mapSize.width = shadowSize;
    townSun.shadow.mapSize.height = shadowSize;
    townSun.shadow.camera.left = -4; townSun.shadow.camera.right = 4;
    townSun.shadow.camera.top = 4; townSun.shadow.camera.bottom = -4;
    townSun.shadow.camera.near = 0.1; townSun.shadow.camera.far = 15;
    townSun.shadow.bias = shadowBias;
    townSun.name = 'town-sun';
    group.add(townSun);

    const ambColor = lt ? lt.ambientColor : 0x607090;
    const ambIntensity = lt ? lt.ambientIntensity : 0.8;
    const townAmbient = new THREE.AmbientLight(ambColor, ambIntensity);
    townAmbient.name = 'town-ambient';
    group.add(townAmbient);

    // Terrain heightmap
    const meshSize = tt ? tt.meshSize : 5;
    const res = tt ? tt.resolution : 96;
    const patchR = tt ? tt.patchRadius : 120;
    const maxH = tt ? tt.maxHeight : 0.15;
    const geom = new THREE.PlaneGeometry(meshSize, meshSize, res - 1, res - 1);
    const pos = geom.attributes.position;
    const colors = new Float32Array(pos.count * 3);

    for (let i = 0; i < pos.count; i++) {
      const px = pos.getX(i), py = pos.getY(i);
      const ox = Math.round((px / meshSize) * 2 * patchR);
      const oy = Math.round((py / meshSize) * 2 * patchR);
      const e = ctx.fn.elevation(config, ox, oy);
      const mo = ctx.fn.moisture ? ctx.fn.moisture(config, ox, oy) : 128;
      const h = ((e - config.waterLine) / 255) * maxH;
      pos.setX(i, px);
      pos.setY(i, Math.max(h, -0.03));
      pos.setZ(i, -py);
      const [cr, cg, cb] = ctx.fn.elevColor(e, config.waterLine, config.peakLine, mo);
      colors[i * 3] = cr / 255; colors[i * 3 + 1] = cg / 255; colors[i * 3 + 2] = cb / 255;
    }
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geom.computeVertexNormals();
    const tMesh = new THREE.Mesh(geom, new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.9, metalness: 0, side: THREE.FrontSide
    }));
    tMesh.receiveShadow = true;
    group.add(tMesh);

    // Water plane
    const waterColor = tt ? tt.waterColor : 0x2266aa;
    const waterOpacity = tt ? tt.waterOpacity : 0.55;
    const wMat = new THREE.MeshStandardMaterial({
      color: waterColor, transparent: true, opacity: waterOpacity,
      roughness: 0.1, metalness: 0.3, side: THREE.DoubleSide
    });
    const water = new THREE.Mesh(new THREE.PlaneGeometry(meshSize * 1.5, meshSize * 1.5), wMat);
    water.rotation.x = -Math.PI / 2; water.position.y = 0.003;
    group.add(water);

    // Ground skirt
    const skirtColor = tt ? tt.skirtColor : 0x4a6b35;
    const skirtMat = new THREE.MeshStandardMaterial({ color: skirtColor, roughness: 1 });
    const skirt = new THREE.Mesh(new THREE.PlaneGeometry(meshSize * 3, meshSize * 3), skirtMat);
    skirt.rotation.x = -Math.PI / 2; skirt.position.y = -0.01;
    skirt.receiveShadow = true;
    group.add(skirt);

    // Town square
    const envCtx = { layout: L, plotPositions: this._plotPositions };
    this._townSquareGroup = buildTownSquare(group, envCtx);

    // Trees
    const treeCtx = { layout: L, plotPositions: this._plotPositions, fn: ctx.fn };
    scatterTrees(group, config, patchR, meshSize, maxH, treeCtx);

    // Decorations
    if (L && L.decorations && L.decorations.length > 0) {
      this._decorationGroup = buildDecorations(group, L);
    }

    // Walls
    if (L && L.walls && L.walls.enabled) {
      this._wallGroup = buildWalls(group, L);
    }

    // Plots
    this._plotGroups = [];
    const plotCount = L ? L.plots.length : 5;
    const plotCtx = {
      layout: L, plotPositions: this._plotPositions,
      estateState: this._estateState, labels: this._labels
    };
    for (let p = 0; p < plotCount; p++) {
      this._plotGroups[p] = buildPlotPad(group, p, plotCtx);
    }

    // Buildings
    this._buildingMeshes.clear();
    const bCtx = {
      plotGroups: this._plotGroups,
      buildingMeshes: this._buildingMeshes,
      estateState: this._estateState,
      layout: L
    };
    refreshAllBuildings(bCtx);

    this._townGroup = group;
    ctx.scene.add(group);
    this._updateLighting();
  }

  _unloadScene() {
    if (this._townGroup) {
      this._ctx.scene.remove(this._townGroup);
      this._townGroup.traverse(o => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          if (Array.isArray(o.material)) o.material.forEach(m => m.dispose());
          else o.material.dispose();
        }
      });
      this._townGroup = null;
    }
    for (const lbl of this._labels) {
      this._ctx.scene.remove(lbl);
      if (lbl.element?.parentNode) lbl.element.parentNode.removeChild(lbl.element);
    }
    this._labels = [];
    this._plotGroups = [];
    this._buildingMeshes.clear();
    this._townSquareGroup = null;
    this._decorationGroup = null;
    this._wallGroup = null;
    this._gridOverlay = null;
  }

  _updateLighting() {
    updateTownLighting(this._townGroup, this._ctx.scene, this._layout, this._timeOfDay);
  }

  // ── HUD ──

  _createHUD() {
    this._destroyHUD();
    const hudCtx = {
      estateState: this._estateState,
      selectedSlot: this._selectedSlot,
      selectedType: this._selectedType,
      timeOfDay: this._timeOfDay,
    };
    this._hud = createTownHUD(this._ctx.container, hudCtx);
    this._bindHUDEvents();
  }

  _destroyHUD() {
    destroyTownHUD(this._hud);
    this._hud = null;
  }

  _updateHUD() {
    if (!this._hud) return;
    const hudCtx = {
      estateState: this._estateState,
      selectedSlot: this._selectedSlot,
      selectedType: this._selectedType,
      timeOfDay: this._timeOfDay,
    };
    this._hud.innerHTML = townHUDContent(hudCtx);
    this._bindHUDEvents();
  }

  _bindHUDEvents() {
    bindTownHUDEvents(this._hud, {
      onSelectType: (type) => {
        this._selectedType = type;
        this._updateHUD();
      },
      onTogglePlot: (p) => {
        const estate = this._estateState;
        if (p < estate.plotsOwned) {
          if (p === estate.plotsOwned - 1 && p > 0) estate.plotsOwned--;
        } else if (p === estate.plotsOwned) {
          estate.plotsOwned++;
        }
        this._rebuildPlots();
        this._updateHUD();
      },
      onSetLevel: (level) => {
        const sel = this._selectedSlot;
        if (!sel) return;
        const idx = sel.plot * 4 + sel.slot;
        this._estateState.buildings[idx].level = level;
        const bCtx = { plotGroups: this._plotGroups, buildingMeshes: this._buildingMeshes, layout: this._layout };
        placeBuildingMesh(bCtx, sel.plot, sel.slot, this._estateState.buildings[idx].type, level);
        // Update level display text
        const display = this._hud?.querySelector('[data-action="set-level"]')?.nextElementSibling;
        if (display) display.textContent = `${level}/20`;
      },
      onRemoveBuilding: () => {
        const sel = this._selectedSlot;
        if (!sel) return;
        const idx = sel.plot * 4 + sel.slot;
        this._estateState.buildings[idx] = { type: -1, status: 0, level: 0 };
        const key = `${sel.plot}_${sel.slot}`;
        const mesh = this._buildingMeshes.get(key);
        if (mesh) {
          this._plotGroups[sel.plot]?.remove(mesh);
          mesh.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
          this._buildingMeshes.delete(key);
        }
        this._updateHUD();
      },
      onPlaceBuilding: () => {
        const sel = this._selectedSlot;
        if (!sel || this._selectedType < 0) return;
        const idx = sel.plot * 4 + sel.slot;
        this._estateState.buildings[idx] = { type: this._selectedType, status: 2, level: 1 };
        const bCtx = { plotGroups: this._plotGroups, buildingMeshes: this._buildingMeshes, layout: this._layout };
        placeBuildingMesh(bCtx, sel.plot, sel.slot, this._selectedType, 1);
        this._updateHUD();
      },
      onSetTime: (value) => {
        this.setTimeOfDay(value);
        const display = this._hud?.querySelector('[data-action="set-time"]')?.nextElementSibling;
        if (display) {
          const h = Math.floor(this._timeOfDay);
          const m = ((this._timeOfDay % 1) * 60).toFixed(0).padStart(2, '0');
          display.textContent = `${h}:${m}`;
        }
      },
      onExport: () => {
        const state = this.getState();
        console.log('Town State:', JSON.stringify(state, null, 2));
        navigator.clipboard?.writeText(JSON.stringify(state, null, 2));
      },
      onExit: () => this.exit(),
    });
  }

  // ── Interaction ──

  _setupInteraction() {
    this._removeInteraction();
    const canvas = this._ctx.renderer.domElement;

    const interactionCtx = {
      townMouse: this._townMouse,
      townRaycaster: this._townRaycaster,
      camera: this._ctx.camera,
      plotGroups: this._plotGroups,
      buildingMeshes: this._buildingMeshes,
      plotPositions: this._plotPositions,
      controls: this._ctx.controls,
      dragPlot: null,
      callbacks: {
        onSlotClick: (plotIdx, slotIdx) => {
          // Eraser mode
          if (this._selectedType === -2) {
            const idx = plotIdx * 4 + slotIdx;
            if (this._estateState.buildings[idx].type >= 0) {
              this._estateState.buildings[idx] = { type: -1, status: 0, level: 0 };
              const key = `${plotIdx}_${slotIdx}`;
              const m = this._buildingMeshes.get(key);
              if (m) {
                this._plotGroups[plotIdx]?.remove(m);
                m.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
                this._buildingMeshes.delete(key);
              }
              this._selectedSlot = { plot: plotIdx, slot: slotIdx };
              updateSelectionRings(this._buildingMeshes, this._selectedSlot);
              this._updateHUD();
              return;
            }
          }

          // Place building
          const idx = plotIdx * 4 + slotIdx;
          if (this._selectedType >= 0 && this._estateState.buildings[idx].type < 0) {
            this._estateState.buildings[idx] = { type: this._selectedType, status: 2, level: 1 };
            const bCtx = { plotGroups: this._plotGroups, buildingMeshes: this._buildingMeshes, layout: this._layout };
            placeBuildingMesh(bCtx, plotIdx, slotIdx, this._selectedType, 1);
          }

          this._selectedSlot = { plot: plotIdx, slot: slotIdx };
          updateSelectionRings(this._buildingMeshes, this._selectedSlot);
          this._updateHUD();
        },
        onDeselectAll: () => {
          this._selectedSlot = null;
          updateSelectionRings(this._buildingMeshes, null);
          this._updateHUD();
        }
      }
    };

    this._handlers = setupTownInteraction(canvas, interactionCtx);
    // Keep reference for pointer move/up to update dragPlot
    this._interactionCtx = interactionCtx;
  }

  _removeInteraction() {
    removeTownInteraction(this._ctx.renderer.domElement, this._handlers);
    this._handlers = {};
  }

  _rebuildPlots() {
    if (!this._townGroup) return;
    for (const lbl of this._labels) {
      if (lbl.element?.parentNode) lbl.element.parentNode.removeChild(lbl.element);
    }
    this._labels = [];
    for (const pg of this._plotGroups) {
      if (pg) {
        this._townGroup.remove(pg);
        pg.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
      }
    }
    for (const [key, mesh] of this._buildingMeshes) {
      const p = parseInt(key.split('_')[0]);
      if (p >= this._estateState.plotsOwned) {
        this._plotGroups[p]?.remove(mesh);
        mesh.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
        this._buildingMeshes.delete(key);
      }
    }
    this._plotGroups = [];
    const plotCtx = {
      layout: this._layout, plotPositions: this._plotPositions,
      estateState: this._estateState, labels: this._labels
    };
    for (let p = 0; p < 5; p++) {
      this._plotGroups[p] = buildPlotPad(this._townGroup, p, plotCtx);
    }
    const bCtx = {
      plotGroups: this._plotGroups, buildingMeshes: this._buildingMeshes,
      estateState: this._estateState, layout: this._layout
    };
    refreshAllBuildings(bCtx);
  }

  /**
   * Clean up all town resources.
   */
  dispose() {
    this._unloadScene();
    this._destroyHUD();
    this._removeInteraction();
  }
}
