/**
 * WeatherSystem -- deterministic weather from terrain seed + day-of-year,
 * with smooth transitions, wind simulation, rain/snow/fog/lightning effects,
 * and global uniforms readable by all visual systems.
 *
 * Weather types: clear, overcast, rain, storm, fog, windy, snow
 *
 * Lightning: random flashes during storms -- briefly increases ambient light
 * intensity for 0.05-0.1s, with 5-15s random intervals.
 *
 * Fog: height-based exponential density.
 *
 * Weather is deterministic from terrain.seed + dayOfYear. The system runs a
 * per-frame update loop that transitions parameters smoothly.
 */

import * as THREE from 'three';

// Deterministic hash (matches terrain calculator's terrainHash)

function rotateLeft(v, n) {
  return ((v << n) | (v >>> (32 - n))) >>> 0;
}

function terrainHash(seed, x, y) {
  let h = (seed ^ (x >>> 0) ^ rotateLeft(y >>> 0, 16)) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0x45D9F3B) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x45D9F3B) >>> 0;
  h ^= h >>> 16;
  return h & 0xFF;
}

// Weather type determination from seed + day

function weatherForDay(seed, dayOfYear) {
  const h = terrainHash(seed, dayOfYear, 0);
  if (h < 40) return 'rain';
  if (h < 55) return 'fog';
  if (h < 65) return 'storm';
  if (h < 80) return 'overcast';
  if (h < 90) return 'windy';
  return 'clear';
}

// Weather parameter presets

const WEATHER_PARAMS = {
  clear: {
    rainIntensity: 0,
    snowIntensity: 0,
    fogDensity: 0.0,
    windStrengthBase: 0.15,
    cloudCover: 0.0,
    ambientMultiplier: 1.0,
    lightningEnabled: false,
    wetTarget: 0,
  },
  overcast: {
    rainIntensity: 0,
    snowIntensity: 0,
    fogDensity: 0.05,
    windStrengthBase: 0.2,
    cloudCover: 0.7,
    ambientMultiplier: 0.75,
    lightningEnabled: false,
    wetTarget: 0,
  },
  rain: {
    rainIntensity: 0.6,
    snowIntensity: 0,
    fogDensity: 0.15,
    windStrengthBase: 0.35,
    cloudCover: 0.85,
    ambientMultiplier: 0.6,
    lightningEnabled: false,
    wetTarget: 1,
  },
  storm: {
    rainIntensity: 1.0,
    snowIntensity: 0,
    fogDensity: 0.2,
    windStrengthBase: 0.7,
    cloudCover: 1.0,
    ambientMultiplier: 0.4,
    lightningEnabled: true,
    wetTarget: 1,
  },
  fog: {
    rainIntensity: 0,
    snowIntensity: 0,
    fogDensity: 0.6,
    windStrengthBase: 0.05,
    cloudCover: 0.5,
    ambientMultiplier: 0.7,
    lightningEnabled: false,
    wetTarget: 0.3,
  },
  windy: {
    rainIntensity: 0,
    snowIntensity: 0,
    fogDensity: 0.02,
    windStrengthBase: 0.8,
    cloudCover: 0.3,
    ambientMultiplier: 0.9,
    lightningEnabled: false,
    wetTarget: 0,
  },
  snow: {
    rainIntensity: 0,
    snowIntensity: 0.8,
    fogDensity: 0.15,
    windStrengthBase: 0.2,
    cloudCover: 0.9,
    ambientMultiplier: 0.65,
    lightningEnabled: false,
    wetTarget: 0,
  },
};

// WeatherSystem

export class WeatherSystem {
  /**
   * @param {THREE.Scene} scene
   * @param {object} [options]
   * @param {number} [options.transitionDuration=5]  - Seconds for weather transitions
   * @param {number} [options.wetAccumRate=0.1]      - Wetness accumulation per second during rain
   * @param {number} [options.wetEvapRate=0.02]      - Wetness evaporation per second during clear
   * @param {number} [options.snowAccumRate=0.05]    - Snow accumulation per second during snow
   * @param {number} [options.snowMeltRate=0.01]     - Snow melt per second during non-snow
   */
  constructor(scene, options = {}) {
    this.scene = scene;

    this._transitionDuration = options.transitionDuration || 0.0;
    this._wetAccumRate = options.wetAccumRate || 0.1;
    this._wetEvapRate = options.wetEvapRate || 0.02;
    this._snowAccumRate = options.snowAccumRate || 0.05;
    this._snowMeltRate = options.snowMeltRate || 0.01;

    // Current weather state
    this._currentType = 'clear';
    this._elapsed = 0;

    // Interpolated parameters (current active values)
    this._rainIntensity = 0;
    this._snowIntensity = 0;
    this._fogDensity = 0;
    this._windStrengthBase = 0.15;
    this._cloudCover = 0;
    this._ambientMultiplier = 1.0;
    this._lightningEnabled = false;

    // Derived / accumulated state
    this._wetness = 0;        // 0-1, builds up during rain, evaporates after
    this._snowAmount = 0;     // 0-1, builds up during snow, melts after
    this._windDirection = new THREE.Vector2(1, 0);
    this._windStrength = 0.15;
    this._windAngle = 0;

    // Transition state
    this._transitioning = false;
    this._transitionElapsed = 0;
    this._transitionFrom = { ...WEATHER_PARAMS.clear };
    this._transitionTo = { ...WEATHER_PARAMS.clear };
    this._transitionTargetType = 'clear';

    // Lightning state
    this._lightningTimer = 0;       // Seconds until next flash
    this._lightningFlashTimer = 0;  // Remaining flash duration
    this._lightningActive = false;
    this._lightningNextInterval = 10;

    // Fog uniform (for other systems to sample)
    this._fogColor = new THREE.Color(0.6, 0.65, 0.7);

    // Disposed flag
    this._disposed = false;

    // Initialize lightning timer
    this._resetLightningTimer();
  }

  // Deterministic weather from seed

  /**
   * Set weather deterministically from terrain seed and day-of-year.
   * High moisture biases toward wetter weather.
   *
   * @param {number} seed      - Terrain seed (u32)
   * @param {number} dayOfYear - Day of year (0-365)
   * @param {number} [moisture=128] - Average moisture (0-255), biases weather
   */
  setWeatherFromSeed(seed, dayOfYear, moisture = 128) {
    let type = weatherForDay(seed, dayOfYear);

    // Moisture bias: high moisture (>200) can upgrade clear -> overcast,
    // overcast -> rain; low moisture (<60) can downgrade rain -> overcast
    if (moisture > 200) {
      if (type === 'clear') type = 'overcast';
      else if (type === 'overcast') type = 'rain';
    } else if (moisture < 60) {
      if (type === 'rain') type = 'overcast';
      else if (type === 'storm') type = 'rain';
    }

    // Very high moisture + cold seed hash -> snow instead of rain
    if (moisture > 220) {
      const tempHash = terrainHash(seed, dayOfYear, 1);
      if (tempHash < 80 && (type === 'rain' || type === 'storm')) {
        type = 'snow';
      }
    }

    this.transitionTo(type);
  }

  // Manual weather control

  /**
   * Override weather to a specific type with smooth transition.
   * @param {'clear'|'rain'|'storm'|'fog'|'overcast'|'windy'|'snow'} type
   */
  setWeather(type) {
    this.transitionTo(type);
  }

  /**
   * Transition smoothly from current weather to a new type.
   * @param {'clear'|'rain'|'storm'|'fog'|'overcast'|'windy'|'snow'} type
   * @param {number} [duration] - Transition duration in seconds
   */
  transitionTo(type, duration) {
    const params = WEATHER_PARAMS[type];
    if (!params) return;

    if (type === this._currentType && !this._transitioning) return;

    const dur = duration !== undefined ? duration : this._transitionDuration;

    // Snapshot current interpolated state as the "from"
    this._transitionFrom = {
      rainIntensity: this._rainIntensity,
      snowIntensity: this._snowIntensity,
      fogDensity: this._fogDensity,
      windStrengthBase: this._windStrengthBase,
      cloudCover: this._cloudCover,
      ambientMultiplier: this._ambientMultiplier,
      lightningEnabled: this._lightningEnabled,
      wetTarget: this._currentType === 'rain' || this._currentType === 'storm' ? 1 : 0,
    };

    this._transitionTo = { ...params };
    this._transitionTargetType = type;
    this._transitionElapsed = 0;
    this._transitioning = true;

    // If transitioning to duration 0, apply immediately
    if (dur <= 0) {
      this._applyParams(params);
      this._currentType = type;
      this._transitioning = false;
    }
  }

  // State queries

  /**
   * @returns {THREE.Vector2} Current wind direction (normalized)
   */
  getWindDirection() {
    return this._windDirection.clone();
  }

  /**
   * @returns {number} Current wind strength (0-1+)
   */
  getWindStrength() {
    return this._windStrength;
  }

  /**
   * @returns {string} Current weather type
   */
  getWeatherType() {
    return this._currentType;
  }

  /**
   * @returns {number} Rain intensity (0-1)
   */
  getRainIntensity() {
    return this._rainIntensity;
  }

  /**
   * @returns {number} Snow accumulation amount (0-1)
   */
  getSnowAmount() {
    return this._snowAmount;
  }

  /**
   * @returns {number} Surface wetness (0-1)
   */
  getWetness() {
    return this._wetness;
  }

  /**
   * @returns {number} Fog density (0-1)
   */
  getFogDensity() {
    return this._fogDensity;
  }

  /**
   * @returns {boolean} True during a lightning flash frame
   */
  isLightningFlash() {
    return this._lightningActive;
  }

  /**
   * @returns {number} Cloud cover (0-1)
   */
  getCloudCover() {
    return this._cloudCover;
  }

  /**
   * @returns {number} Ambient light multiplier (0-1)
   */
  getAmbientMultiplier() {
    return this._ambientMultiplier;
  }

  /**
   * @returns {THREE.Color} Fog color (clone)
   */
  getFogColor() {
    return this._fogColor.clone();
  }

  /**
   * @returns {number} Snow intensity (0-1, current snowfall rate, not accumulated)
   */
  getSnowIntensity() {
    return this._snowIntensity;
  }

  // Per-frame update

  /**
   * Update weather simulation. Call once per frame.
   * @param {number} deltaTime - Seconds since last frame
   */
  update(deltaTime) {
    if (this._disposed) return;
    if (deltaTime <= 0) return;

    this._elapsed += deltaTime;

    // 1. Handle weather transition interpolation
    this._updateTransition(deltaTime);

    // 2. Update wind (slowly varying sine waves)
    this._updateWind(deltaTime);

    // 3. Update wetness (accumulates during rain, evaporates during clear)
    this._updateWetness(deltaTime);

    // 4. Update snow amount (accumulates during snow, melts during non-snow)
    this._updateSnowAccumulation(deltaTime);

    // 5. Update lightning timing (random flashes during storm)
    this._updateLightning(deltaTime);

    // 6. Update fog color based on weather
    this._updateFogColor();
  }

  // Transition handling

  /** @private */
  _updateTransition(deltaTime) {
    if (!this._transitioning) return;

    this._transitionElapsed += deltaTime;
    const t = Math.min(this._transitionElapsed / this._transitionDuration, 1.0);

    // Smoothstep easing
    const s = t * t * (3 - 2 * t);

    const from = this._transitionFrom;
    const to = this._transitionTo;

    this._rainIntensity = from.rainIntensity + (to.rainIntensity - from.rainIntensity) * s;
    this._snowIntensity = from.snowIntensity + (to.snowIntensity - from.snowIntensity) * s;
    this._fogDensity = from.fogDensity + (to.fogDensity - from.fogDensity) * s;
    this._windStrengthBase = from.windStrengthBase + (to.windStrengthBase - from.windStrengthBase) * s;
    this._cloudCover = from.cloudCover + (to.cloudCover - from.cloudCover) * s;
    this._ambientMultiplier = from.ambientMultiplier + (to.ambientMultiplier - from.ambientMultiplier) * s;

    // Lightning enables only when past halfway through the transition
    this._lightningEnabled = s > 0.5 ? to.lightningEnabled : from.lightningEnabled;

    if (t >= 1.0) {
      this._transitioning = false;
      this._currentType = this._transitionTargetType;
      this._applyParams(to);
    }
  }

  /** @private */
  _applyParams(params) {
    this._rainIntensity = params.rainIntensity;
    this._snowIntensity = params.snowIntensity;
    this._fogDensity = params.fogDensity;
    this._windStrengthBase = params.windStrengthBase;
    this._cloudCover = params.cloudCover;
    this._ambientMultiplier = params.ambientMultiplier;
    this._lightningEnabled = params.lightningEnabled;
  }

  // Wind simulation

  /** @private */
  _updateWind(deltaTime) {
    const time = this._elapsed;

    // Layered sine waves for slowly varying wind direction
    this._windAngle = 0.0
      + 0.4 * Math.sin(time * 0.07)
      + 0.2 * Math.sin(time * 0.19 + 1.3)
      + 0.1 * Math.sin(time * 0.43 + 2.7);

    this._windDirection.set(
      Math.cos(this._windAngle),
      Math.sin(this._windAngle)
    ).normalize();

    // Wind strength: base + oscillation
    const oscillation = 0.15 * Math.sin(time * 0.12)
                      + 0.08 * Math.sin(time * 0.31 + 0.7)
                      + 0.05 * Math.sin(time * 0.73 + 1.9);

    this._windStrength = Math.max(0, this._windStrengthBase + oscillation);

    // Storm gusts: occasional spikes
    if (this._currentType === 'storm' || this._transitionTargetType === 'storm') {
      const gustPhase = Math.sin(time * 0.5) * Math.sin(time * 1.3);
      if (gustPhase > 0.8) {
        this._windStrength += 0.3 * (gustPhase - 0.8) / 0.2;
      }
    }
  }

  // Wetness accumulation / evaporation

  /** @private */
  _updateWetness(deltaTime) {
    if (this._rainIntensity > 0.05) {
      // Accumulate wetness proportional to rain intensity
      this._wetness += this._wetAccumRate * this._rainIntensity * deltaTime;
    } else {
      // Evaporate
      this._wetness -= this._wetEvapRate * deltaTime;
    }
    this._wetness = Math.max(0, Math.min(1, this._wetness));
  }

  // Snow accumulation / melting

  /** @private */
  _updateSnowAccumulation(deltaTime) {
    if (this._snowIntensity > 0.05) {
      this._snowAmount += this._snowAccumRate * this._snowIntensity * deltaTime;
    } else {
      this._snowAmount -= this._snowMeltRate * deltaTime;
    }
    this._snowAmount = Math.max(0, Math.min(1, this._snowAmount));
  }

  // Lightning

  /** @private */
  _resetLightningTimer() {
    // Random interval between 5-15 seconds
    this._lightningNextInterval = 5 + Math.random() * 10;
    this._lightningTimer = 0;
  }

  /** @private */
  _updateLightning(deltaTime) {
    // Reset flash state
    this._lightningActive = false;

    if (!this._lightningEnabled) {
      this._lightningTimer = 0;
      this._lightningFlashTimer = 0;
      return;
    }

    // Handle active flash
    if (this._lightningFlashTimer > 0) {
      this._lightningFlashTimer -= deltaTime;
      if (this._lightningFlashTimer > 0) {
        this._lightningActive = true;
      } else {
        this._lightningFlashTimer = 0;
      }
      return;
    }

    // Count down to next flash
    this._lightningTimer += deltaTime;
    if (this._lightningTimer >= this._lightningNextInterval) {
      // Trigger a flash
      this._lightningFlashTimer = 0.05 + Math.random() * 0.05; // 0.05-0.1s
      this._lightningActive = true;

      // Increase ambient light briefly (caller reads isLightningFlash())
      // The actual light intensity change is handled by the ambient system
      // reading our isLightningFlash() method.

      // Schedule next flash
      this._resetLightningTimer();

      // Storms can have rapid double-flashes
      if (Math.random() < 0.3) {
        this._lightningNextInterval = 0.3 + Math.random() * 0.5; // Quick follow-up
      }
    }
  }

  // Fog color

  /** @private */
  _updateFogColor() {
    // Fog color shifts based on weather
    const type = this._currentType;

    if (type === 'storm') {
      this._fogColor.setRGB(0.35, 0.38, 0.42);
    } else if (type === 'rain') {
      this._fogColor.setRGB(0.50, 0.53, 0.58);
    } else if (type === 'fog') {
      this._fogColor.setRGB(0.70, 0.72, 0.74);
    } else if (type === 'overcast') {
      this._fogColor.setRGB(0.60, 0.63, 0.68);
    } else if (type === 'snow') {
      this._fogColor.setRGB(0.75, 0.78, 0.82);
    } else {
      // clear, windy
      this._fogColor.setRGB(0.60, 0.65, 0.70);
    }
  }

  // Dispose

  /**
   * Release all resources.
   */
  dispose() {
    this._disposed = true;
  }
}
