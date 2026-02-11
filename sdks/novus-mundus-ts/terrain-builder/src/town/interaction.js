/**
 * Town mode interaction — HUD overlay, building placement, plot dragging, selection.
 */

import { BUILDING_TYPES } from '../core/constants.js';

/**
 * Generate HUD HTML content for the estate editor.
 * @param {object} ctx - { estateState, selectedSlot, selectedType, timeOfDay }
 * @returns {string} HTML string
 */
export function townHUDContent(ctx) {
  const estate = ctx.estateState;
  const sel = ctx.selectedSlot;

  let html = `<div style="font:bold 14px monospace;color:#7ec8e3;margin-bottom:8px">Estate Editor</div>`;

  // Plots
  html += `<div style="color:#999;font-size:10px;margin-bottom:4px">PLOTS (${estate.plotsOwned}/5 owned)</div>`;
  html += `<div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:8px">`;
  for (let p = 0; p < 5; p++) {
    const owned = p < estate.plotsOwned;
    const tierLabel = p === 0 ? 'S' : p < 2 ? '1' : p < 4 ? '2' : '3';
    html += `<button data-action="toggle-plot" data-plot="${p}" style="
      padding:4px 8px;border:1px solid ${owned ? '#88cc66' : '#444'};border-radius:4px;
      background:${owned ? '#2a4a2a' : '#1a1a2e'};color:${owned ? '#8c8' : '#666'};
      cursor:pointer;font:11px monospace;
    ">P${p + 1}:T${tierLabel} ${owned ? '\u2713' : '\u2717'}</button>`;
  }
  html += `</div>`;

  // Building palette
  html += `<div style="color:#999;font-size:10px;margin-bottom:4px">BUILDING PALETTE (click to select, then click a slot)</div>`;
  html += `<div style="display:grid;grid-template-columns:1fr 1fr;gap:3px;margin-bottom:8px">`;
  for (const bt of BUILDING_TYPES) {
    const selected = ctx.selectedType === bt.id;
    const colorHex = '#' + bt.color.toString(16).padStart(6, '0');
    html += `<button data-action="select-type" data-type="${bt.id}" style="
      padding:3px 6px;border:1px solid ${selected ? '#ffff00' : '#444'};border-radius:3px;
      background:${selected ? '#3a3a1e' : '#1a1a2e'};color:#ccc;cursor:pointer;
      font:10px monospace;text-align:left;display:flex;align-items:center;gap:4px;
    "><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${colorHex}"></span>
    ${bt.name}</button>`;
  }
  const eraseSel = ctx.selectedType === -2;
  html += `<button data-action="select-type" data-type="-2" style="
    padding:3px 6px;border:1px solid ${eraseSel ? '#ff4444' : '#444'};border-radius:3px;
    background:${eraseSel ? '#3a1a1a' : '#1a1a2e'};color:#f88;cursor:pointer;
    font:10px monospace;text-align:left;
  ">\u2716 Erase</button>`;
  html += `</div>`;

  // Selected slot info
  if (sel) {
    const bIdx = sel.plot * 4 + sel.slot;
    const b = estate.buildings[bIdx];
    html += `<div style="border:1px solid #7ec8e3;border-radius:6px;padding:8px;margin-bottom:8px">`;
    html += `<div style="color:#7ec8e3;font-size:11px;margin-bottom:4px">Plot ${sel.plot + 1}, Slot ${sel.slot + 1}</div>`;
    if (b && b.type >= 0) {
      const bt = BUILDING_TYPES[b.type];
      html += `<div style="margin-bottom:4px">${bt.name} (Lv ${b.level})</div>`;
      html += `<label style="font-size:10px;color:#999">Level</label>`;
      html += `<input type="range" data-action="set-level" min="1" max="20" value="${b.level}" style="width:100%;accent-color:#7ec8e3">`;
      html += `<div style="text-align:right;font-size:10px;color:#7ec8e3">${b.level}/20</div>`;
      html += `<button data-action="remove-building" style="margin-top:4px;padding:3px 8px;background:#e74c3c;color:#fff;border:none;border-radius:3px;cursor:pointer;font:10px monospace">Remove</button>`;
    } else {
      html += `<div style="color:#666">Empty slot</div>`;
      if (ctx.selectedType >= 0) {
        html += `<button data-action="place-building" style="margin-top:4px;padding:3px 8px;background:#7ec8e3;color:#000;border:none;border-radius:3px;cursor:pointer;font:10px monospace">Place ${BUILDING_TYPES[ctx.selectedType].name}</button>`;
      }
    }
    html += `</div>`;
  }

  // Time of day
  html += `<div style="color:#999;font-size:10px;margin-bottom:4px">TIME OF DAY</div>`;
  html += `<input type="range" data-action="set-time" min="0" max="24" step="0.5" value="${ctx.timeOfDay}" style="width:100%;accent-color:#7ec8e3">`;
  html += `<div style="text-align:center;font-size:10px;color:#7ec8e3;margin-bottom:8px">${Math.floor(ctx.timeOfDay)}:${((ctx.timeOfDay % 1) * 60).toFixed(0).padStart(2, '0')}</div>`;

  // Export / Back
  html += `<div style="display:flex;gap:4px">`;
  html += `<button data-action="export" style="flex:1;padding:4px;background:#3a3a5e;color:#ccc;border:none;border-radius:3px;cursor:pointer;font:10px monospace">Export State</button>`;
  html += `<button data-action="exit" style="flex:1;padding:4px;background:#3a3a5e;color:#ccc;border:none;border-radius:3px;cursor:pointer;font:10px monospace">Back</button>`;
  html += `</div>`;

  return html;
}

/**
 * Create the HUD DOM element.
 * @param {HTMLElement} container
 * @param {object} ctx
 * @returns {HTMLElement}
 */
export function createTownHUD(container, ctx) {
  const hud = document.createElement('div');
  hud.id = 'town-hud';
  hud.style.cssText = `
    position:absolute;top:10px;right:10px;width:240px;max-height:calc(100% - 20px);
    overflow-y:auto;background:rgba(22,33,62,0.92);border:1px solid #444;
    border-radius:8px;padding:12px;font:12px monospace;color:#e0e0e0;
    pointer-events:auto;user-select:none;z-index:10;
  `;
  hud.innerHTML = townHUDContent(ctx);
  container.appendChild(hud);
  return hud;
}

/**
 * Destroy the HUD DOM element.
 * @param {HTMLElement|null} hud
 */
export function destroyTownHUD(hud) {
  if (hud && hud.parentNode) hud.parentNode.removeChild(hud);
}

/**
 * Bind HUD event handlers.
 * @param {HTMLElement} hud
 * @param {object} callbacks - Event callback functions
 */
export function bindTownHUDEvents(hud, callbacks) {
  if (!hud) return;

  hud.querySelectorAll('[data-action="select-type"]').forEach(btn => {
    btn.onclick = () => callbacks.onSelectType(parseInt(btn.dataset.type));
  });

  hud.querySelectorAll('[data-action="toggle-plot"]').forEach(btn => {
    btn.onclick = () => callbacks.onTogglePlot(parseInt(btn.dataset.plot));
  });

  const levelSlider = hud.querySelector('[data-action="set-level"]');
  if (levelSlider) {
    levelSlider.oninput = () => callbacks.onSetLevel(parseInt(levelSlider.value));
  }

  const removeBtn = hud.querySelector('[data-action="remove-building"]');
  if (removeBtn) {
    removeBtn.onclick = () => callbacks.onRemoveBuilding();
  }

  const placeBtn = hud.querySelector('[data-action="place-building"]');
  if (placeBtn) {
    placeBtn.onclick = () => callbacks.onPlaceBuilding();
  }

  const timeSlider = hud.querySelector('[data-action="set-time"]');
  if (timeSlider) {
    timeSlider.oninput = () => callbacks.onSetTime(parseFloat(timeSlider.value));
  }

  const exportBtn = hud.querySelector('[data-action="export"]');
  if (exportBtn) {
    exportBtn.onclick = () => {
      callbacks.onExport();
      exportBtn.textContent = 'Copied!';
      setTimeout(() => { exportBtn.textContent = 'Export State'; }, 1500);
    };
  }

  const exitBtn = hud.querySelector('[data-action="exit"]');
  if (exitBtn) {
    exitBtn.onclick = () => callbacks.onExit();
  }
}

/**
 * Setup town interaction (raycasting, building placement, plot dragging).
 * @param {HTMLCanvasElement} canvas
 * @param {object} ctx - Interaction context
 * @returns {object} Handler references for cleanup
 */
export function setupTownInteraction(canvas, ctx) {
  const handlers = {};

  handlers.onPointerDown = (e) => {
    if (e.button !== 0) return;
    const rect = canvas.getBoundingClientRect();
    ctx.townMouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    ctx.townMouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    ctx.townRaycaster.setFromCamera(ctx.townMouse, ctx.camera);

    const targets = [];
    for (const pg of ctx.plotGroups) {
      if (pg) pg.traverse(o => { if (o.isMesh && o.userData.type) targets.push(o); });
    }
    for (const [, mesh] of ctx.buildingMeshes) {
      mesh.traverse(o => { if (o.isMesh) { o.userData._parentBldg = mesh.userData; targets.push(o); } });
    }

    const hits = ctx.townRaycaster.intersectObjects(targets, false);
    if (hits.length > 0) {
      const hit = hits[0].object;
      const ud = hit.userData._parentBldg || hit.userData;

      if (ud.type === 'slot' || ud.type === 'building') {
        ctx.callbacks.onSlotClick(ud.plotIdx, ud.slotIdx != null ? ud.slotIdx : 0);
        return;
      }

      if (ud.type === 'plot-pad') {
        ctx.dragPlot = {
          plotIdx: ud.plotIdx,
          startX: ctx.plotPositions[ud.plotIdx].x,
          startZ: ctx.plotPositions[ud.plotIdx].z,
          startMouseX: e.clientX,
          startMouseY: e.clientY,
        };
        ctx.controls.enabled = false;
        return;
      }
    }

    ctx.callbacks.onDeselectAll();
  };

  handlers.onPointerMove = (e) => {
    if (!ctx.dragPlot) return;
    const dp = ctx.dragPlot;
    const dx = (e.clientX - dp.startMouseX) * 0.003;
    const dz = (e.clientY - dp.startMouseY) * 0.003;
    ctx.plotPositions[dp.plotIdx].x = dp.startX + dx;
    ctx.plotPositions[dp.plotIdx].z = dp.startZ + dz;
    const pg = ctx.plotGroups[dp.plotIdx];
    if (pg) pg.position.set(ctx.plotPositions[dp.plotIdx].x, 0, ctx.plotPositions[dp.plotIdx].z);
  };

  handlers.onPointerUp = () => {
    if (ctx.dragPlot) {
      ctx.dragPlot = null;
      ctx.controls.enabled = true;
    }
  };

  canvas.addEventListener('pointerdown', handlers.onPointerDown);
  canvas.addEventListener('pointermove', handlers.onPointerMove);
  canvas.addEventListener('pointerup', handlers.onPointerUp);

  return handlers;
}

/**
 * Remove town interaction handlers.
 * @param {HTMLCanvasElement} canvas
 * @param {object} handlers
 */
export function removeTownInteraction(canvas, handlers) {
  if (handlers.onPointerDown) canvas.removeEventListener('pointerdown', handlers.onPointerDown);
  if (handlers.onPointerMove) canvas.removeEventListener('pointermove', handlers.onPointerMove);
  if (handlers.onPointerUp) canvas.removeEventListener('pointerup', handlers.onPointerUp);
}

/**
 * Update selection rings on building meshes.
 * @param {Map} buildingMeshes
 * @param {object|null} selectedSlot - { plot, slot } or null
 */
export function updateSelectionRings(buildingMeshes, selectedSlot) {
  const sel = selectedSlot;
  for (const [key, mesh] of buildingMeshes) {
    const ring = mesh.getObjectByName('select-ring');
    if (ring) {
      const [p, s] = key.split('_').map(Number);
      ring.visible = sel != null && sel.plot === p && sel.slot === s;
    }
  }
}
