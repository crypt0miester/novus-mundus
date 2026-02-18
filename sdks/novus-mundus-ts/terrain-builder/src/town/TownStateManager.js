/**
 * Town state manager — maps on-chain account state to a visual state object
 * consumed by the TownRenderer and its subsystems.
 *
 * Implements a minimal event emitter (no external deps) so that state changes
 * can trigger animations, audio cues, and UI updates in listeners.
 */

// ---------------------------------------------------------------------------
// Building status enum (mirrors Rust BuildingStatus)
// ---------------------------------------------------------------------------

const BUILDING_STATUS_EMPTY = 0;
const BUILDING_STATUS_BUILDING = 1;
const BUILDING_STATUS_ACTIVE = 2;
const BUILDING_STATUS_UPGRADING = 3;

// ---------------------------------------------------------------------------
// Daily window bitmask constants
// ---------------------------------------------------------------------------

const WINDOW_DAWN = 0b001;    // L — Morning (Dawn)
const WINDOW_MIDDAY = 0b010;  // M — Midday
const WINDOW_DUSK = 0b100;    // D — Dusk

// ---------------------------------------------------------------------------
// Population table: base + per-level
// ---------------------------------------------------------------------------

const BASE_POPULATION = 3;
const POPULATION_PER_LEVEL = 2;

// ---------------------------------------------------------------------------
// Milestone thresholds
// ---------------------------------------------------------------------------

const MILESTONES = [
  { id: 'first-building',     label: 'First Building',      check: (s) => s.buildings.some(b => b.status === BUILDING_STATUS_ACTIVE) },
  { id: 'five-buildings',     label: 'Five Buildings',       check: (s) => s.buildings.filter(b => b.status >= BUILDING_STATUS_ACTIVE).length >= 5 },
  { id: 'ten-buildings',      label: 'Ten Buildings',        check: (s) => s.buildings.filter(b => b.status >= BUILDING_STATUS_ACTIVE).length >= 10 },
  { id: 'level-5',            label: 'Estate Level 5',       check: (s) => s.estateLevel >= 5 },
  { id: 'level-10',           label: 'Estate Level 10',      check: (s) => s.estateLevel >= 10 },
  { id: 'level-20',           label: 'Estate Level 20',      check: (s) => s.estateLevel >= 20 },
  { id: 'all-plots',          label: 'All Plots Owned',      check: (s) => s.plotsOwned >= 5 },
  { id: 'all-windows',        label: 'All Windows Complete', check: (s) => (s.windowsCompleted & 0b111) === 0b111 },
  { id: 'crafting-master',    label: 'Crafting Master',      check: (s) => s.buildings.some(b => b.mastery >= 100) },
  { id: 'meditation-master',  label: 'Meditation Master',    check: (s) => s.meditatingHeroes >= 3 },
  { id: 'subscriber',         label: 'Premium Subscriber',   check: (s) => s.subscriptionTier > 0 },
  { id: 'high-networth',      label: 'High Networth',        check: (s) => s.networth >= 1_000_000n },
];

// ---------------------------------------------------------------------------
// TownStateManager
// ---------------------------------------------------------------------------

export class TownStateManager {
  constructor() {
    // Visual state — the single source of truth consumed by renderers
    this._state = this._createDefaultState();

    // Event listeners: Map<string, Set<Function>>
    this._listeners = new Map();

    // Previous state snapshots for diff detection
    this._prevEstateLevel = 0;
    this._prevPlotsOwned = 0;
    this._prevWindowsCompleted = 0;
  }

  // -----------------------------------------------------------------------
  // Loading
  // -----------------------------------------------------------------------

  /**
   * Load initial state from on-chain accounts.
   * @param {object} estateAccount - Deserialized estate account
   * @param {object} playerCore    - Deserialized player core account
   * @param {object} gameEngine    - Deserialized game engine config
   * @param {object} cityTerrain   - City terrain config
   */
  loadState(estateAccount, playerCore, gameEngine, cityTerrain) {
    const s = this._state;

    // Buildings
    if (estateAccount.buildings) {
      s.buildings = estateAccount.buildings.map((b, i) => ({
        type: b.buildingType !== undefined ? b.buildingType : (b.type !== undefined ? b.type : -1),
        status: b.status !== undefined ? b.status : BUILDING_STATUS_EMPTY,
        level: b.level || 0,
        mastery: b.mastery || 0,
        constructionProgress: b.constructionProgress || 0,
        noviInvested: b.noviInvested || 0,
      }));
    }

    // Plots
    s.plotsOwned = estateAccount.plotsOwned !== undefined ? estateAccount.plotsOwned : 1;

    // Computed estate level
    s.estateLevel = this._computeEstateLevel();

    // Player stats
    if (playerCore) {
      s.attackBps = playerCore.attackBps || 0;
      s.defenseBps = playerCore.defenseBps || 0;
      s.resourceGenBps = playerCore.resourceGenBps || 0;
      s.craftSuccessBps = playerCore.craftSuccessBps || 0;
      s.playerLevel = playerCore.level || 1;
      s.networth = typeof playerCore.networth === 'bigint' ? playerCore.networth : BigInt(playerCore.networth || 0);
      s.subscriptionTier = playerCore.subscriptionTier || 0;
    }

    // Daily activity
    if (estateAccount.dailyActivity) {
      s.windowsCompleted = estateAccount.dailyActivity.windowsCompleted || 0;
      s.loginStreak = estateAccount.dailyActivity.loginStreak || 0;
      s.permanentBonus = estateAccount.dailyActivity.permanentBonus || 0;
    } else {
      s.windowsCompleted = estateAccount.windowsCompleted || 0;
      s.loginStreak = estateAccount.loginStreak || 0;
      s.permanentBonus = estateAccount.permanentBonus || 0;
    }

    // Active processes
    s.activeCraft = estateAccount.activeCraft || null;
    s.activeResearch = estateAccount.activeResearch || null;
    s.meditatingHeroes = estateAccount.meditatingHeroes || 0;

    // Terrain
    if (cityTerrain) {
      s.terrain = cityTerrain;
      s.terrainAffinity = cityTerrain.affinity || null;
    }

    // Theme
    s.theme = estateAccount.theme || playerCore?.theme || null;

    // Time
    s.currentTime = Date.now() / 1000;

    // Snapshot for diff
    this._prevEstateLevel = s.estateLevel;
    this._prevPlotsOwned = s.plotsOwned;
    this._prevWindowsCompleted = s.windowsCompleted;

    this._emit('state-loaded', s);
  }

  // -----------------------------------------------------------------------
  // Live updates (from WebSocket / subscription)
  // -----------------------------------------------------------------------

  /**
   * Update a single building slot.
   * @param {number} index
   * @param {object} data - { type, status, level, mastery, constructionProgress, noviInvested }
   */
  updateBuilding(index, data) {
    if (index < 0 || index >= this._state.buildings.length) return;

    const prev = { ...this._state.buildings[index] };
    const b = this._state.buildings[index];

    if (data.type !== undefined) b.type = data.type;
    if (data.status !== undefined) b.status = data.status;
    if (data.level !== undefined) b.level = data.level;
    if (data.mastery !== undefined) b.mastery = data.mastery;
    if (data.constructionProgress !== undefined) b.constructionProgress = data.constructionProgress;
    if (data.noviInvested !== undefined) b.noviInvested = data.noviInvested;

    // Recompute estate level
    const newLevel = this._computeEstateLevel();
    const levelChanged = newLevel !== this._state.estateLevel;
    this._state.estateLevel = newLevel;

    this._emit('building-change', { index, prev, current: { ...b } });

    // Detect construction start/complete
    if (prev.status === BUILDING_STATUS_EMPTY && b.status === BUILDING_STATUS_BUILDING) {
      this._emit('construction-start', { index, type: b.type });
    }
    if (prev.status === BUILDING_STATUS_BUILDING && b.status === BUILDING_STATUS_ACTIVE) {
      this._emit('construction-complete', { index, type: b.type, level: b.level });
    }
    if (prev.status === BUILDING_STATUS_ACTIVE && b.status === BUILDING_STATUS_UPGRADING) {
      this._emit('upgrade-start', { index, type: b.type, level: b.level });
    }
    if (prev.status === BUILDING_STATUS_UPGRADING && b.status === BUILDING_STATUS_ACTIVE && b.level > prev.level) {
      this._emit('upgrade-complete', { index, type: b.type, level: b.level });
    }

    if (levelChanged) {
      this._emit('level-up', { estateLevel: newLevel, prev: this._prevEstateLevel });
      this._prevEstateLevel = newLevel;
    }
  }

  /**
   * Update plot count.
   * @param {number} plotsOwned
   */
  updatePlots(plotsOwned) {
    const prev = this._state.plotsOwned;
    this._state.plotsOwned = plotsOwned;
    if (plotsOwned !== prev) {
      this._emit('plot-unlock', { plotsOwned, prev });
      this._prevPlotsOwned = plotsOwned;
    }
  }

  /**
   * Update buff values.
   * @param {object} buffs - { attackBps, defenseBps, resourceGenBps, craftSuccessBps }
   */
  updateBuffs(buffs) {
    if (buffs.attackBps !== undefined) this._state.attackBps = buffs.attackBps;
    if (buffs.defenseBps !== undefined) this._state.defenseBps = buffs.defenseBps;
    if (buffs.resourceGenBps !== undefined) this._state.resourceGenBps = buffs.resourceGenBps;
    if (buffs.craftSuccessBps !== undefined) this._state.craftSuccessBps = buffs.craftSuccessBps;
    this._emit('buffs-change', { ...buffs });
  }

  /**
   * Update daily activity state.
   * @param {object} activity - { windowsCompleted, loginStreak, permanentBonus }
   */
  updateActivity(activity) {
    const prevWindows = this._state.windowsCompleted;

    if (activity.windowsCompleted !== undefined) this._state.windowsCompleted = activity.windowsCompleted;
    if (activity.loginStreak !== undefined) this._state.loginStreak = activity.loginStreak;
    if (activity.permanentBonus !== undefined) this._state.permanentBonus = activity.permanentBonus;

    // Detect newly completed windows
    if (this._state.windowsCompleted !== prevWindows) {
      const newlyCompleted = this._state.windowsCompleted & ~prevWindows;
      if (newlyCompleted & WINDOW_DAWN) this._emit('window-complete', { window: 'dawn' });
      if (newlyCompleted & WINDOW_MIDDAY) this._emit('window-complete', { window: 'midday' });
      if (newlyCompleted & WINDOW_DUSK) this._emit('window-complete', { window: 'dusk' });

      if ((this._state.windowsCompleted & 0b111) === 0b111 && (prevWindows & 0b111) !== 0b111) {
        this._emit('all-windows-complete', {});
      }

      this._prevWindowsCompleted = this._state.windowsCompleted;
    }

    this._emit('activity-change', { ...activity });
  }

  /**
   * Update active craft state.
   * @param {{ qualityTier: number, progress: number } | null} craft
   */
  updateCraft(craft) {
    const prev = this._state.activeCraft;
    this._state.activeCraft = craft;

    if (!prev && craft) {
      this._emit('craft-start', { ...craft });
    } else if (prev && !craft) {
      this._emit('craft-complete', { qualityTier: prev.qualityTier });
    } else if (craft) {
      this._emit('craft-progress', { ...craft });
    }
  }

  /**
   * Update active research state.
   * @param {{ researchId: number, progress: number } | null} research
   */
  updateResearch(research) {
    const prev = this._state.activeResearch;
    this._state.activeResearch = research;

    if (!prev && research) {
      this._emit('research-start', { ...research });
    } else if (prev && !research) {
      this._emit('research-complete', { researchId: prev.researchId });
    } else if (research) {
      this._emit('research-progress', { ...research });
    }
  }

  // -----------------------------------------------------------------------
  // Queries
  // -----------------------------------------------------------------------

  /**
   * Get the current visual state.
   * @returns {object}
   */
  getVisualState() {
    this._state.currentTime = Date.now() / 1000;
    return this._state;
  }

  /**
   * Compute estate level as the sum of all active building levels.
   * @returns {number}
   */
  getEstateLevel() {
    return this._computeEstateLevel();
  }

  /**
   * Get population count based on estate level.
   * @returns {number}
   */
  getPopulationCount() {
    return BASE_POPULATION + this._state.estateLevel * POPULATION_PER_LEVEL;
  }

  /**
   * Get achievement milestones with their completion status.
   * @returns {{ id: string, label: string, completed: boolean }[]}
   */
  getMilestones() {
    const s = this._state;
    return MILESTONES.map((m) => ({
      id: m.id,
      label: m.label,
      completed: m.check(s),
    }));
  }

  // -----------------------------------------------------------------------
  // Event emitter
  // -----------------------------------------------------------------------

  /**
   * Subscribe to a state change event.
   * @param {string} event
   * @param {Function} callback
   */
  on(event, callback) {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, new Set());
    }
    this._listeners.get(event).add(callback);
  }

  /**
   * Unsubscribe from a state change event.
   * @param {string} event
   * @param {Function} callback
   */
  off(event, callback) {
    const set = this._listeners.get(event);
    if (set) set.delete(callback);
  }

  // -----------------------------------------------------------------------
  // Internals
  // -----------------------------------------------------------------------

  /** @private */
  _emit(event, data) {
    const set = this._listeners.get(event);
    if (!set || set.size === 0) return;
    for (const fn of set) {
      try {
        fn(data);
      } catch (err) {
        console.error(`[TownStateManager] Error in '${event}' listener:`, err);
      }
    }
  }

  /** @private */
  _computeEstateLevel() {
    let total = 0;
    for (let i = 0; i < this._state.buildings.length; i++) {
      const b = this._state.buildings[i];
      if (b.status >= BUILDING_STATUS_ACTIVE) {
        total += b.level;
      }
    }
    return total;
  }

  /** @private */
  _createDefaultState() {
    return {
      buildings: new Array(20).fill(null).map(() => ({
        type: -1,
        status: BUILDING_STATUS_EMPTY,
        level: 0,
        mastery: 0,
        constructionProgress: 0,
        noviInvested: 0,
      })),
      plotsOwned: 1,
      estateLevel: 0,
      attackBps: 0,
      defenseBps: 0,
      resourceGenBps: 0,
      craftSuccessBps: 0,
      windowsCompleted: 0,
      loginStreak: 0,
      permanentBonus: 0,
      activeCraft: null,
      activeResearch: null,
      meditatingHeroes: 0,
      playerLevel: 1,
      subscriptionTier: 0,
      networth: 0n,
      terrain: null,
      terrainAffinity: null,
      theme: null,
      currentTime: Date.now() / 1000,
    };
  }
}
