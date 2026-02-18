/**
 * AudioManager — Three-layer spatial audio system for the town view.
 *
 * Uses Web Audio API directly (no Three.js dependency). All sounds are
 * procedurally synthesized so no external audio files are required.
 *
 * Layer 1: Base ambience (day/night crossfade)
 * Layer 2: Zone ambience (market, forge, sanctuary, etc.)
 * Layer 3: Point sources (3D-positioned via PannerNode, priority-culled)
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_ACTIVE_SOURCES = 3;
const PRIORITY_UPDATE_INTERVAL = 100; // ms between priority re-sorts
const ZONE_CROSSFADE_DURATION = 1.5;  // seconds
const TIME_CROSSFADE_DURATION = 2.0;  // seconds
const DEFAULT_MAX_DISTANCE = 30;
const SPEED_OF_SOUND = 343;

// Day/night boundary hours
const DAWN_START = 5;
const DAWN_END = 7;
const DUSK_START = 18;
const DUSK_END = 20;

// Zone type identifiers
const ZONES = [
  'market', 'forge', 'sanctuary', 'harbor', 'barracks', 'arena', 'academy',
];

// Sound type identifiers for point sources and one-shots
const SOUND_TYPES = [
  'fountain', 'anvil', 'tavern_music', 'bell', 'construction',
  'levelup', 'wind_chime', 'crowd_cheer', 'fire_crackle',
];

// ---------------------------------------------------------------------------
// Procedural sound synthesis helpers
// ---------------------------------------------------------------------------

/**
 * Fill a Float32Array with white noise samples in [-1, 1].
 */
function fillWhiteNoise(buffer) {
  for (let i = 0; i < buffer.length; i++) {
    buffer[i] = Math.random() * 2 - 1;
  }
}

/**
 * Create an AudioBuffer filled with white noise.
 */
function createNoiseBuffer(ctx, duration = 2, sampleRate) {
  const sr = sampleRate || ctx.sampleRate;
  const length = Math.floor(sr * duration);
  const buffer = ctx.createBuffer(1, length, sr);
  fillWhiteNoise(buffer.getChannelData(0));
  return buffer;
}

/**
 * Create a short noise burst buffer for percussive sounds (hammer, etc.).
 */
function createBurstBuffer(ctx, duration = 0.08) {
  const sr = ctx.sampleRate;
  const length = Math.floor(sr * duration);
  const buffer = ctx.createBuffer(1, length, sr);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) {
    const t = i / length;
    // Exponential decay envelope
    const env = Math.exp(-t * 20);
    data[i] = (Math.random() * 2 - 1) * env;
  }
  return buffer;
}

/**
 * Attempt smoothstep ramp: t in [0,1] -> smooth [0,1].
 */
function smoothstep(t) {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
}

/**
 * Linear interpolation.
 */
function lerp(a, b, t) {
  return a + (b - a) * t;
}

/**
 * Clamp value between min and max.
 */
function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Squared distance between two 3D points.
 */
function distSq3(ax, ay, az, bx, by, bz) {
  const dx = ax - bx;
  const dy = ay - by;
  const dz = az - bz;
  return dx * dx + dy * dy + dz * dz;
}

// ---------------------------------------------------------------------------
// Procedural sound generators — each returns a builder function that creates
// the Web Audio subgraph and returns { node, stop(), playing }
// ---------------------------------------------------------------------------

/**
 * Build a filtered-noise wind layer.
 * lowpass at cutoffHz, gentle volume LFO.
 */
function buildWindGraph(ctx, noiseBuffer, destination, cutoffHz = 400, volume = 0.15) {
  const source = ctx.createBufferSource();
  source.buffer = noiseBuffer;
  source.loop = true;

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = cutoffHz;
  filter.Q.value = 0.7;

  // Slow LFO for volume swell
  const lfo = ctx.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.value = 0.15;

  const lfoGain = ctx.createGain();
  lfoGain.gain.value = volume * 0.3;

  const mainGain = ctx.createGain();
  mainGain.gain.value = volume;

  // LFO modulates gain
  lfo.connect(lfoGain);
  lfoGain.connect(mainGain.gain);

  source.connect(filter);
  filter.connect(mainGain);
  mainGain.connect(destination);

  lfo.start();
  source.start();

  return {
    node: mainGain,
    gain: mainGain,
    stop() {
      try { source.stop(); } catch (_) { /* already stopped */ }
      try { lfo.stop(); } catch (_) { /* already stopped */ }
      source.disconnect();
      filter.disconnect();
      lfo.disconnect();
      lfoGain.disconnect();
      mainGain.disconnect();
    },
  };
}

/**
 * Build a birdsong layer — multiple sine oscillators with FM for chirps
 * triggered at randomized intervals via a ScriptProcessorNode-free approach
 * (we use a cycling gain envelope and slight detuning).
 */
function buildBirdsongGraph(ctx, destination, volume = 0.06) {
  const masterGain = ctx.createGain();
  masterGain.gain.value = volume;
  masterGain.connect(destination);

  const birds = [];
  const birdCount = 4;

  for (let i = 0; i < birdCount; i++) {
    // Carrier oscillator (sine) — the "tweet"
    const carrier = ctx.createOscillator();
    carrier.type = 'sine';
    carrier.frequency.value = 2000 + i * 400 + Math.random() * 600;

    // FM modulator for chirp texture
    const modulator = ctx.createOscillator();
    modulator.type = 'sine';
    modulator.frequency.value = 5 + i * 2 + Math.random() * 4;

    const modGain = ctx.createGain();
    modGain.gain.value = 300 + Math.random() * 200;

    modulator.connect(modGain);
    modGain.connect(carrier.frequency);

    // Tremolo LFO to create rhythmic chirping pattern
    const tremolo = ctx.createOscillator();
    tremolo.type = 'sine';
    tremolo.frequency.value = 1.5 + Math.random() * 2.5; // chirp rate

    const tremoloGain = ctx.createGain();
    tremoloGain.gain.value = 1.0;

    const tremoloDepth = ctx.createGain();
    tremoloDepth.gain.value = 0.0; // will be modulated by tremolo

    tremolo.connect(tremoloDepth.gain);

    carrier.connect(tremoloDepth);

    // Additional gating: slow on/off cycle so each bird doesn't sing nonstop
    const gateLfo = ctx.createOscillator();
    gateLfo.type = 'sine';
    gateLfo.frequency.value = 0.08 + Math.random() * 0.15;

    const gateShaper = ctx.createWaveShaper();
    // Waveshaper to turn sine into a gate (positive half = 1, negative = 0)
    const curveLen = 256;
    const curve = new Float32Array(curveLen);
    for (let j = 0; j < curveLen; j++) {
      const x = (j / (curveLen - 1)) * 2 - 1;
      curve[j] = x > 0.2 ? 1.0 : 0.0;
    }
    gateShaper.curve = curve;

    const gateGain = ctx.createGain();
    gateGain.gain.value = 0.0;

    gateLfo.connect(gateShaper);
    gateShaper.connect(gateGain.gain);

    tremoloDepth.connect(gateGain);
    gateGain.connect(masterGain);

    carrier.start();
    modulator.start();
    tremolo.start();
    gateLfo.start();

    birds.push({ carrier, modulator, modGain, tremolo, tremoloGain, tremoloDepth, gateLfo, gateShaper, gateGain });
  }

  return {
    node: masterGain,
    gain: masterGain,
    stop() {
      for (const b of birds) {
        try { b.carrier.stop(); } catch (_) {}
        try { b.modulator.stop(); } catch (_) {}
        try { b.tremolo.stop(); } catch (_) {}
        try { b.gateLfo.stop(); } catch (_) {}
        b.carrier.disconnect();
        b.modulator.disconnect();
        b.modGain.disconnect();
        b.tremolo.disconnect();
        b.tremoloDepth.disconnect();
        b.gateLfo.disconnect();
        b.gateShaper.disconnect();
        b.gateGain.disconnect();
      }
      masterGain.disconnect();
    },
  };
}

/**
 * Build a cricket layer — high-frequency filtered noise with rhythmic gating.
 */
function buildCricketGraph(ctx, noiseBuffer, destination, volume = 0.04) {
  const masterGain = ctx.createGain();
  masterGain.gain.value = volume;
  masterGain.connect(destination);

  const crickets = [];
  const cricketCount = 3;

  for (let i = 0; i < cricketCount; i++) {
    const source = ctx.createBufferSource();
    source.buffer = noiseBuffer;
    source.loop = true;

    // Bandpass filter for cricket-like chirp
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 4500 + i * 800;
    bp.Q.value = 12 + i * 3;

    // Rhythmic gating via tremolo
    const tremolo = ctx.createOscillator();
    tremolo.type = 'square';
    tremolo.frequency.value = 6 + i * 2 + Math.random() * 3;

    const tremoloShaper = ctx.createWaveShaper();
    const shLen = 256;
    const shCurve = new Float32Array(shLen);
    for (let j = 0; j < shLen; j++) {
      const x = (j / (shLen - 1)) * 2 - 1;
      shCurve[j] = x > 0 ? 1.0 : 0.0;
    }
    tremoloShaper.curve = shCurve;

    const tremoloGain = ctx.createGain();
    tremoloGain.gain.value = 0.0;

    tremolo.connect(tremoloShaper);
    tremoloShaper.connect(tremoloGain.gain);

    source.connect(bp);
    bp.connect(tremoloGain);

    // Slow on/off so crickets alternate
    const gateLfo = ctx.createOscillator();
    gateLfo.type = 'sine';
    gateLfo.frequency.value = 0.1 + Math.random() * 0.2;

    const gateShaper = ctx.createWaveShaper();
    const gCurve = new Float32Array(shLen);
    for (let j = 0; j < shLen; j++) {
      const x = (j / (shLen - 1)) * 2 - 1;
      gCurve[j] = x > -0.1 ? 1.0 : 0.0;
    }
    gateShaper.curve = gCurve;

    const gateGain = ctx.createGain();
    gateGain.gain.value = 0.0;

    gateLfo.connect(gateShaper);
    gateShaper.connect(gateGain.gain);

    tremoloGain.connect(gateGain);
    gateGain.connect(masterGain);

    source.start();
    tremolo.start();
    gateLfo.start();

    crickets.push({ source, bp, tremolo, tremoloShaper, tremoloGain, gateLfo, gateShaper, gateGain });
  }

  return {
    node: masterGain,
    gain: masterGain,
    stop() {
      for (const c of crickets) {
        try { c.source.stop(); } catch (_) {}
        try { c.tremolo.stop(); } catch (_) {}
        try { c.gateLfo.stop(); } catch (_) {}
        c.source.disconnect();
        c.bp.disconnect();
        c.tremolo.disconnect();
        c.tremoloShaper.disconnect();
        c.tremoloGain.disconnect();
        c.gateLfo.disconnect();
        c.gateShaper.disconnect();
        c.gateGain.disconnect();
      }
      masterGain.disconnect();
    },
  };
}

/**
 * Build an owl hoot layer — low sine with slow FM and long gaps.
 */
function buildOwlGraph(ctx, destination, volume = 0.05) {
  const masterGain = ctx.createGain();
  masterGain.gain.value = volume;
  masterGain.connect(destination);

  const carrier = ctx.createOscillator();
  carrier.type = 'sine';
  carrier.frequency.value = 320;

  // Slight FM for hoot character
  const mod = ctx.createOscillator();
  mod.type = 'sine';
  mod.frequency.value = 2.5;

  const modGain = ctx.createGain();
  modGain.gain.value = 40;

  mod.connect(modGain);
  modGain.connect(carrier.frequency);

  // Very slow gate — hoot once every ~5-8 seconds
  const gateLfo = ctx.createOscillator();
  gateLfo.type = 'sine';
  gateLfo.frequency.value = 0.08;

  const gateShaper = ctx.createWaveShaper();
  const curveLen = 256;
  const curve = new Float32Array(curveLen);
  for (let i = 0; i < curveLen; i++) {
    const x = (i / (curveLen - 1)) * 2 - 1;
    // Only pass a narrow positive slice -> short hoots with long silence
    curve[i] = x > 0.7 ? smoothstep((x - 0.7) / 0.3) : 0.0;
  }
  gateShaper.curve = curve;

  const gateGain = ctx.createGain();
  gateGain.gain.value = 0.0;

  gateLfo.connect(gateShaper);
  gateShaper.connect(gateGain.gain);

  carrier.connect(gateGain);
  gateGain.connect(masterGain);

  carrier.start();
  mod.start();
  gateLfo.start();

  return {
    node: masterGain,
    gain: masterGain,
    stop() {
      try { carrier.stop(); } catch (_) {}
      try { mod.stop(); } catch (_) {}
      try { gateLfo.stop(); } catch (_) {}
      carrier.disconnect();
      mod.disconnect();
      modGain.disconnect();
      gateLfo.disconnect();
      gateShaper.disconnect();
      gateGain.disconnect();
      masterGain.disconnect();
    },
  };
}

/**
 * Build a distant wolf howl — sine sweep with noise layer.
 */
function buildWolfGraph(ctx, noiseBuffer, destination, volume = 0.025) {
  const masterGain = ctx.createGain();
  masterGain.gain.value = volume;
  masterGain.connect(destination);

  // Sine sweep for the howl tone
  const carrier = ctx.createOscillator();
  carrier.type = 'sine';
  carrier.frequency.value = 400;

  // Slow pitch sweep
  const sweepLfo = ctx.createOscillator();
  sweepLfo.type = 'sine';
  sweepLfo.frequency.value = 0.3;

  const sweepGain = ctx.createGain();
  sweepGain.gain.value = 80;

  sweepLfo.connect(sweepGain);
  sweepGain.connect(carrier.frequency);

  // Very sparse gating — howl once every ~15-20 seconds
  const gateLfo = ctx.createOscillator();
  gateLfo.type = 'sine';
  gateLfo.frequency.value = 0.035;

  const gateShaper = ctx.createWaveShaper();
  const curveLen = 256;
  const curve = new Float32Array(curveLen);
  for (let i = 0; i < curveLen; i++) {
    const x = (i / (curveLen - 1)) * 2 - 1;
    curve[i] = x > 0.85 ? smoothstep((x - 0.85) / 0.15) : 0.0;
  }
  gateShaper.curve = curve;

  const gateGain = ctx.createGain();
  gateGain.gain.value = 0.0;

  gateLfo.connect(gateShaper);
  gateShaper.connect(gateGain.gain);

  carrier.connect(gateGain);

  // Breathy noise layer
  const noiseSrc = ctx.createBufferSource();
  noiseSrc.buffer = noiseBuffer;
  noiseSrc.loop = true;

  const noiseBp = ctx.createBiquadFilter();
  noiseBp.type = 'bandpass';
  noiseBp.frequency.value = 500;
  noiseBp.Q.value = 3;

  const noiseGate = ctx.createGain();
  noiseGate.gain.value = 0.0;

  // Same gate controls noise
  const gateShaper2 = ctx.createWaveShaper();
  gateShaper2.curve = curve;
  gateLfo.connect(gateShaper2);
  gateShaper2.connect(noiseGate.gain);

  noiseSrc.connect(noiseBp);
  noiseBp.connect(noiseGate);

  const mixGain = ctx.createGain();
  mixGain.gain.value = 1.0;

  gateGain.connect(mixGain);
  noiseGate.connect(mixGain);
  mixGain.connect(masterGain);

  carrier.start();
  sweepLfo.start();
  gateLfo.start();
  noiseSrc.start();

  return {
    node: masterGain,
    gain: masterGain,
    stop() {
      try { carrier.stop(); } catch (_) {}
      try { sweepLfo.stop(); } catch (_) {}
      try { gateLfo.stop(); } catch (_) {}
      try { noiseSrc.stop(); } catch (_) {}
      carrier.disconnect();
      sweepLfo.disconnect();
      sweepGain.disconnect();
      gateLfo.disconnect();
      gateShaper.disconnect();
      gateShaper2.disconnect();
      gateGain.disconnect();
      noiseSrc.disconnect();
      noiseBp.disconnect();
      noiseGate.disconnect();
      mixGain.disconnect();
      masterGain.disconnect();
    },
  };
}

/**
 * Build a crowd murmur layer — many filtered noise sources at speech freqs.
 */
function buildCrowdMurmurGraph(ctx, noiseBuffer, destination, volume = 0.12) {
  const masterGain = ctx.createGain();
  masterGain.gain.value = volume;
  masterGain.connect(destination);

  const voices = [];
  const voiceCount = 5;

  for (let i = 0; i < voiceCount; i++) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    src.loop = true;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;

    // Bandpass at speech frequencies
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 200 + i * 150 + Math.random() * 100;
    bp.Q.value = 1.5 + Math.random() * 1.5;

    // Slow amplitude variation to simulate conversational cadence
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.3 + Math.random() * 0.5;

    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.4;

    const voiceGain = ctx.createGain();
    voiceGain.gain.value = 0.5;

    lfo.connect(lfoGain);
    lfoGain.connect(voiceGain.gain);

    src.connect(bp);
    bp.connect(voiceGain);
    voiceGain.connect(masterGain);

    src.start();
    lfo.start();

    voices.push({ src, bp, lfo, lfoGain, voiceGain });
  }

  return {
    node: masterGain,
    gain: masterGain,
    stop() {
      for (const v of voices) {
        try { v.src.stop(); } catch (_) {}
        try { v.lfo.stop(); } catch (_) {}
        v.src.disconnect();
        v.bp.disconnect();
        v.lfo.disconnect();
        v.lfoGain.disconnect();
        v.voiceGain.disconnect();
      }
      masterGain.disconnect();
    },
  };
}

/**
 * Build vendor calls layer — short pitched bursts with speech-like formants.
 */
function buildVendorCallsGraph(ctx, noiseBuffer, destination, volume = 0.04) {
  const masterGain = ctx.createGain();
  masterGain.gain.value = volume;
  masterGain.connect(destination);

  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  src.loop = true;

  // Formant filters
  const f1 = ctx.createBiquadFilter();
  f1.type = 'bandpass';
  f1.frequency.value = 700;
  f1.Q.value = 5;

  const f2 = ctx.createBiquadFilter();
  f2.type = 'bandpass';
  f2.frequency.value = 1200;
  f2.Q.value = 5;

  // Rhythmic gating — occasional shouts
  const gateLfo = ctx.createOscillator();
  gateLfo.type = 'sine';
  gateLfo.frequency.value = 0.25;

  const gateShaper = ctx.createWaveShaper();
  const curveLen = 256;
  const curve = new Float32Array(curveLen);
  for (let i = 0; i < curveLen; i++) {
    const x = (i / (curveLen - 1)) * 2 - 1;
    curve[i] = x > 0.5 ? smoothstep((x - 0.5) / 0.5) : 0.0;
  }
  gateShaper.curve = curve;

  const gateGain = ctx.createGain();
  gateGain.gain.value = 0.0;

  gateLfo.connect(gateShaper);
  gateShaper.connect(gateGain.gain);

  const mixGain = ctx.createGain();
  mixGain.gain.value = 0.5;

  src.connect(f1);
  src.connect(f2);
  f1.connect(mixGain);
  f2.connect(mixGain);
  mixGain.connect(gateGain);
  gateGain.connect(masterGain);

  src.start();
  gateLfo.start();

  return {
    node: masterGain,
    gain: masterGain,
    stop() {
      try { src.stop(); } catch (_) {}
      try { gateLfo.stop(); } catch (_) {}
      src.disconnect();
      f1.disconnect();
      f2.disconnect();
      mixGain.disconnect();
      gateLfo.disconnect();
      gateShaper.disconnect();
      gateGain.disconnect();
      masterGain.disconnect();
    },
  };
}

/**
 * Build hammer strikes layer — periodic short noise bursts with metallic ring.
 */
function buildHammerStrikesGraph(ctx, burstBuffer, destination, volume = 0.10) {
  const masterGain = ctx.createGain();
  masterGain.gain.value = volume;
  masterGain.connect(destination);

  const strikers = [];
  const strikeCount = 2;

  for (let i = 0; i < strikeCount; i++) {
    const src = ctx.createBufferSource();
    src.buffer = burstBuffer;
    src.loop = true;
    // Looping a short burst creates periodic strikes
    src.playbackRate.value = 0.5 + i * 0.3;

    // Metallic resonance
    const bp = ctx.createBiquadFilter();
    bp.type = 'peaking';
    bp.frequency.value = 800 + i * 600;
    bp.Q.value = 8;
    bp.gain.value = 12;

    // Slow rhythmic gate to avoid continuous striking
    const gateLfo = ctx.createOscillator();
    gateLfo.type = 'sine';
    gateLfo.frequency.value = 0.4 + i * 0.2;

    const gateShaper = ctx.createWaveShaper();
    const curveLen = 256;
    const curve = new Float32Array(curveLen);
    for (let j = 0; j < curveLen; j++) {
      const x = (j / (curveLen - 1)) * 2 - 1;
      curve[j] = x > 0.3 ? 1.0 : 0.0;
    }
    gateShaper.curve = curve;

    const gateGain = ctx.createGain();
    gateGain.gain.value = 0.0;

    gateLfo.connect(gateShaper);
    gateShaper.connect(gateGain.gain);

    src.connect(bp);
    bp.connect(gateGain);
    gateGain.connect(masterGain);

    src.start();
    gateLfo.start();

    strikers.push({ src, bp, gateLfo, gateShaper, gateGain });
  }

  return {
    node: masterGain,
    gain: masterGain,
    stop() {
      for (const s of strikers) {
        try { s.src.stop(); } catch (_) {}
        try { s.gateLfo.stop(); } catch (_) {}
        s.src.disconnect();
        s.bp.disconnect();
        s.gateLfo.disconnect();
        s.gateShaper.disconnect();
        s.gateGain.disconnect();
      }
      masterGain.disconnect();
    },
  };
}

/**
 * Build bellows layer — rhythmic low-frequency wind noise.
 */
function buildBellowsGraph(ctx, noiseBuffer, destination, volume = 0.06) {
  const masterGain = ctx.createGain();
  masterGain.gain.value = volume;
  masterGain.connect(destination);

  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  src.loop = true;

  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 250;
  lp.Q.value = 1.0;

  // Rhythmic breathing
  const lfo = ctx.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.value = 0.5;

  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 0.5;

  const outGain = ctx.createGain();
  outGain.gain.value = 0.5;

  lfo.connect(lfoGain);
  lfoGain.connect(outGain.gain);

  src.connect(lp);
  lp.connect(outGain);
  outGain.connect(masterGain);

  src.start();
  lfo.start();

  return {
    node: masterGain,
    gain: masterGain,
    stop() {
      try { src.stop(); } catch (_) {}
      try { lfo.stop(); } catch (_) {}
      src.disconnect();
      lp.disconnect();
      lfo.disconnect();
      lfoGain.disconnect();
      outGain.disconnect();
      masterGain.disconnect();
    },
  };
}

/**
 * Build choir hum layer — stacked sine oscillators at harmonic intervals.
 */
function buildChoirHumGraph(ctx, destination, volume = 0.07) {
  const masterGain = ctx.createGain();
  masterGain.gain.value = volume;
  masterGain.connect(destination);

  const voices = [];
  // Chord: root, third, fifth, octave — breathy pad
  const freqs = [220, 277.18, 329.63, 440];

  for (let i = 0; i < freqs.length; i++) {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freqs[i];

    // Slight detune for chorus effect
    osc.detune.value = (Math.random() - 0.5) * 10;

    // Slow vibrato
    const vibrato = ctx.createOscillator();
    vibrato.type = 'sine';
    vibrato.frequency.value = 4.5 + Math.random() * 1.5;

    const vibratoGain = ctx.createGain();
    vibratoGain.gain.value = 3;

    vibrato.connect(vibratoGain);
    vibratoGain.connect(osc.frequency);

    // Slow swell
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.08 + Math.random() * 0.05;

    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.3;

    const voiceGain = ctx.createGain();
    voiceGain.gain.value = 0.3;

    lfo.connect(lfoGain);
    lfoGain.connect(voiceGain.gain);

    osc.connect(voiceGain);
    voiceGain.connect(masterGain);

    osc.start();
    vibrato.start();
    lfo.start();

    voices.push({ osc, vibrato, vibratoGain, lfo, lfoGain, voiceGain });
  }

  return {
    node: masterGain,
    gain: masterGain,
    stop() {
      for (const v of voices) {
        try { v.osc.stop(); } catch (_) {}
        try { v.vibrato.stop(); } catch (_) {}
        try { v.lfo.stop(); } catch (_) {}
        v.osc.disconnect();
        v.vibrato.disconnect();
        v.vibratoGain.disconnect();
        v.lfo.disconnect();
        v.lfoGain.disconnect();
        v.voiceGain.disconnect();
      }
      masterGain.disconnect();
    },
  };
}

/**
 * Build wind chimes layer — randomly triggered sine tones with exponential decay.
 */
function buildWindChimesGraph(ctx, destination, volume = 0.05) {
  const masterGain = ctx.createGain();
  masterGain.gain.value = volume;
  masterGain.connect(destination);

  const chimes = [];
  // Pentatonic frequencies for pleasant random chimes
  const noteFreqs = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5, 1174.66];
  const chimeCount = 4;

  for (let i = 0; i < chimeCount; i++) {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = noteFreqs[i % noteFreqs.length];

    // Random triggering via waveshaper on slow noise-like LFO
    const triggerLfo = ctx.createOscillator();
    triggerLfo.type = 'sine';
    triggerLfo.frequency.value = 0.15 + Math.random() * 0.3;

    const triggerShaper = ctx.createWaveShaper();
    const curveLen = 256;
    const curve = new Float32Array(curveLen);
    for (let j = 0; j < curveLen; j++) {
      const x = (j / (curveLen - 1)) * 2 - 1;
      // Very narrow positive gate -> short chime strikes
      curve[j] = x > 0.85 ? Math.pow((x - 0.85) / 0.15, 0.3) : 0.0;
    }
    triggerShaper.curve = curve;

    const chimeGain = ctx.createGain();
    chimeGain.gain.value = 0.0;

    triggerLfo.connect(triggerShaper);
    triggerShaper.connect(chimeGain.gain);

    osc.connect(chimeGain);
    chimeGain.connect(masterGain);

    osc.start();
    triggerLfo.start();

    chimes.push({ osc, triggerLfo, triggerShaper, chimeGain });
  }

  return {
    node: masterGain,
    gain: masterGain,
    stop() {
      for (const c of chimes) {
        try { c.osc.stop(); } catch (_) {}
        try { c.triggerLfo.stop(); } catch (_) {}
        c.osc.disconnect();
        c.triggerLfo.disconnect();
        c.triggerShaper.disconnect();
        c.chimeGain.disconnect();
      }
      masterGain.disconnect();
    },
  };
}

/**
 * Build waves (ocean) layer — filtered noise with slow LFO for wave rhythm.
 */
function buildWavesGraph(ctx, noiseBuffer, destination, volume = 0.10) {
  const masterGain = ctx.createGain();
  masterGain.gain.value = volume;
  masterGain.connect(destination);

  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  src.loop = true;

  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 600;
  lp.Q.value = 0.5;

  // Wave rhythm LFO
  const lfo = ctx.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.value = 0.12;

  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 0.6;

  const outGain = ctx.createGain();
  outGain.gain.value = 0.5;

  lfo.connect(lfoGain);
  lfoGain.connect(outGain.gain);

  // Higher frequency component for wave crash
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 2000;

  const crashLfo = ctx.createOscillator();
  crashLfo.type = 'sine';
  crashLfo.frequency.value = 0.12;
  crashLfo.phase = Math.PI * 0.7; // slightly delayed from main wave

  const crashShaper = ctx.createWaveShaper();
  const curveLen = 256;
  const curve = new Float32Array(curveLen);
  for (let i = 0; i < curveLen; i++) {
    const x = (i / (curveLen - 1)) * 2 - 1;
    curve[i] = x > 0.4 ? smoothstep((x - 0.4) / 0.6) * 0.3 : 0.0;
  }
  crashShaper.curve = curve;

  const crashGain = ctx.createGain();
  crashGain.gain.value = 0.0;

  crashLfo.connect(crashShaper);
  crashShaper.connect(crashGain.gain);

  const src2 = ctx.createBufferSource();
  src2.buffer = noiseBuffer;
  src2.loop = true;

  src2.connect(hp);
  hp.connect(crashGain);
  crashGain.connect(masterGain);

  src.connect(lp);
  lp.connect(outGain);
  outGain.connect(masterGain);

  src.start();
  src2.start();
  lfo.start();
  crashLfo.start();

  return {
    node: masterGain,
    gain: masterGain,
    stop() {
      try { src.stop(); } catch (_) {}
      try { src2.stop(); } catch (_) {}
      try { lfo.stop(); } catch (_) {}
      try { crashLfo.stop(); } catch (_) {}
      src.disconnect();
      src2.disconnect();
      lp.disconnect();
      hp.disconnect();
      lfo.disconnect();
      lfoGain.disconnect();
      outGain.disconnect();
      crashLfo.disconnect();
      crashShaper.disconnect();
      crashGain.disconnect();
      masterGain.disconnect();
    },
  };
}

/**
 * Build seagulls layer — high sine swoops with gaps.
 */
function buildSeagullsGraph(ctx, destination, volume = 0.035) {
  const masterGain = ctx.createGain();
  masterGain.gain.value = volume;
  masterGain.connect(destination);

  const gulls = [];
  const gullCount = 2;

  for (let i = 0; i < gullCount; i++) {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 1800 + i * 400;

    // Pitch sweep for cry
    const sweepLfo = ctx.createOscillator();
    sweepLfo.type = 'sine';
    sweepLfo.frequency.value = 3 + i;

    const sweepGain = ctx.createGain();
    sweepGain.gain.value = 400;

    sweepLfo.connect(sweepGain);
    sweepGain.connect(osc.frequency);

    // Sparse gating
    const gateLfo = ctx.createOscillator();
    gateLfo.type = 'sine';
    gateLfo.frequency.value = 0.06 + Math.random() * 0.08;

    const gateShaper = ctx.createWaveShaper();
    const curveLen = 256;
    const curve = new Float32Array(curveLen);
    for (let j = 0; j < curveLen; j++) {
      const x = (j / (curveLen - 1)) * 2 - 1;
      curve[j] = x > 0.75 ? smoothstep((x - 0.75) / 0.25) : 0.0;
    }
    gateShaper.curve = curve;

    const gateGain = ctx.createGain();
    gateGain.gain.value = 0.0;

    gateLfo.connect(gateShaper);
    gateShaper.connect(gateGain.gain);

    osc.connect(gateGain);
    gateGain.connect(masterGain);

    osc.start();
    sweepLfo.start();
    gateLfo.start();

    gulls.push({ osc, sweepLfo, sweepGain, gateLfo, gateShaper, gateGain });
  }

  return {
    node: masterGain,
    gain: masterGain,
    stop() {
      for (const g of gulls) {
        try { g.osc.stop(); } catch (_) {}
        try { g.sweepLfo.stop(); } catch (_) {}
        try { g.gateLfo.stop(); } catch (_) {}
        g.osc.disconnect();
        g.sweepLfo.disconnect();
        g.sweepGain.disconnect();
        g.gateLfo.disconnect();
        g.gateShaper.disconnect();
        g.gateGain.disconnect();
      }
      masterGain.disconnect();
    },
  };
}

/**
 * Build marching layer — rhythmic low-frequency thumps.
 */
function buildMarchingGraph(ctx, burstBuffer, destination, volume = 0.08) {
  const masterGain = ctx.createGain();
  masterGain.gain.value = volume;
  masterGain.connect(destination);

  const src = ctx.createBufferSource();
  src.buffer = burstBuffer;
  src.loop = true;
  src.playbackRate.value = 0.3;

  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 200;
  lp.Q.value = 1.5;

  // Boost low end for weight
  const peaking = ctx.createBiquadFilter();
  peaking.type = 'peaking';
  peaking.frequency.value = 80;
  peaking.Q.value = 2;
  peaking.gain.value = 8;

  src.connect(lp);
  lp.connect(peaking);
  peaking.connect(masterGain);

  src.start();

  return {
    node: masterGain,
    gain: masterGain,
    stop() {
      try { src.stop(); } catch (_) {}
      src.disconnect();
      lp.disconnect();
      peaking.disconnect();
      masterGain.disconnect();
    },
  };
}

/**
 * Build metal clanking layer — high-frequency resonant noise bursts.
 */
function buildMetalClankGraph(ctx, burstBuffer, destination, volume = 0.05) {
  const masterGain = ctx.createGain();
  masterGain.gain.value = volume;
  masterGain.connect(destination);

  const src = ctx.createBufferSource();
  src.buffer = burstBuffer;
  src.loop = true;
  src.playbackRate.value = 0.6;

  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 3000;
  bp.Q.value = 10;

  // Rhythmic gating — irregular clanks
  const gateLfo = ctx.createOscillator();
  gateLfo.type = 'sine';
  gateLfo.frequency.value = 0.7;

  const gateShaper = ctx.createWaveShaper();
  const curveLen = 256;
  const curve = new Float32Array(curveLen);
  for (let i = 0; i < curveLen; i++) {
    const x = (i / (curveLen - 1)) * 2 - 1;
    curve[i] = x > 0.4 ? 1.0 : 0.0;
  }
  gateShaper.curve = curve;

  const gateGain = ctx.createGain();
  gateGain.gain.value = 0.0;

  gateLfo.connect(gateShaper);
  gateShaper.connect(gateGain.gain);

  src.connect(bp);
  bp.connect(gateGain);
  gateGain.connect(masterGain);

  src.start();
  gateLfo.start();

  return {
    node: masterGain,
    gain: masterGain,
    stop() {
      try { src.stop(); } catch (_) {}
      try { gateLfo.stop(); } catch (_) {}
      src.disconnect();
      bp.disconnect();
      gateLfo.disconnect();
      gateShaper.disconnect();
      gateGain.disconnect();
      masterGain.disconnect();
    },
  };
}

/**
 * Build crowd cheering layer — louder, more energetic crowd murmur with peaks.
 */
function buildCrowdCheeringGraph(ctx, noiseBuffer, destination, volume = 0.14) {
  const masterGain = ctx.createGain();
  masterGain.gain.value = volume;
  masterGain.connect(destination);

  const voices = [];

  for (let i = 0; i < 6; i++) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    src.loop = true;
    src.playbackRate.value = 0.7 + Math.random() * 0.6;

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 300 + i * 200 + Math.random() * 150;
    bp.Q.value = 1.0 + Math.random();

    // Energetic swell
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.15 + Math.random() * 0.3;

    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.5;

    const voiceGain = ctx.createGain();
    voiceGain.gain.value = 0.4;

    lfo.connect(lfoGain);
    lfoGain.connect(voiceGain.gain);

    src.connect(bp);
    bp.connect(voiceGain);
    voiceGain.connect(masterGain);

    src.start();
    lfo.start();

    voices.push({ src, bp, lfo, lfoGain, voiceGain });
  }

  return {
    node: masterGain,
    gain: masterGain,
    stop() {
      for (const v of voices) {
        try { v.src.stop(); } catch (_) {}
        try { v.lfo.stop(); } catch (_) {}
        v.src.disconnect();
        v.bp.disconnect();
        v.lfo.disconnect();
        v.lfoGain.disconnect();
        v.voiceGain.disconnect();
      }
      masterGain.disconnect();
    },
  };
}

/**
 * Build page turning layer — very soft periodic noise swishes.
 */
function buildPageTurningGraph(ctx, noiseBuffer, destination, volume = 0.02) {
  const masterGain = ctx.createGain();
  masterGain.gain.value = volume;
  masterGain.connect(destination);

  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  src.loop = true;

  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 3000;

  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 8000;

  // Periodic swish
  const gateLfo = ctx.createOscillator();
  gateLfo.type = 'sine';
  gateLfo.frequency.value = 0.15;

  const gateShaper = ctx.createWaveShaper();
  const curveLen = 256;
  const curve = new Float32Array(curveLen);
  for (let i = 0; i < curveLen; i++) {
    const x = (i / (curveLen - 1)) * 2 - 1;
    curve[i] = x > 0.6 ? smoothstep((x - 0.6) / 0.4) : 0.0;
  }
  gateShaper.curve = curve;

  const gateGain = ctx.createGain();
  gateGain.gain.value = 0.0;

  gateLfo.connect(gateShaper);
  gateShaper.connect(gateGain.gain);

  src.connect(hp);
  hp.connect(lp);
  lp.connect(gateGain);
  gateGain.connect(masterGain);

  src.start();
  gateLfo.start();

  return {
    node: masterGain,
    gain: masterGain,
    stop() {
      try { src.stop(); } catch (_) {}
      try { gateLfo.stop(); } catch (_) {}
      src.disconnect();
      hp.disconnect();
      lp.disconnect();
      gateLfo.disconnect();
      gateShaper.disconnect();
      gateGain.disconnect();
      masterGain.disconnect();
    },
  };
}

/**
 * Build quiet murmur layer — very subdued crowd noise for the academy.
 */
function buildQuietMurmurGraph(ctx, noiseBuffer, destination, volume = 0.03) {
  return buildCrowdMurmurGraph(ctx, noiseBuffer, destination, volume);
}

/**
 * Build rain layer — dense high-frequency filtered noise.
 */
function buildRainGraph(ctx, noiseBuffer, destination, volume = 0.15) {
  const masterGain = ctx.createGain();
  masterGain.gain.value = volume;
  masterGain.connect(destination);

  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  src.loop = true;

  // Rain is broadband noise with emphasis on higher frequencies
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 800;

  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 12000;

  // Subtle variation
  const lfo = ctx.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.value = 0.05;

  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 0.15;

  const outGain = ctx.createGain();
  outGain.gain.value = 0.8;

  lfo.connect(lfoGain);
  lfoGain.connect(outGain.gain);

  src.connect(hp);
  hp.connect(lp);
  lp.connect(outGain);
  outGain.connect(masterGain);

  src.start();
  lfo.start();

  return {
    node: masterGain,
    gain: masterGain,
    stop() {
      try { src.stop(); } catch (_) {}
      try { lfo.stop(); } catch (_) {}
      src.disconnect();
      hp.disconnect();
      lp.disconnect();
      lfo.disconnect();
      lfoGain.disconnect();
      outGain.disconnect();
      masterGain.disconnect();
    },
  };
}

/**
 * Build thunder layer — low rumbling bursts.
 */
function buildThunderGraph(ctx, noiseBuffer, destination, volume = 0.20) {
  const masterGain = ctx.createGain();
  masterGain.gain.value = volume;
  masterGain.connect(destination);

  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  src.loop = true;

  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 150;
  lp.Q.value = 1.0;

  // Very sparse rumbles
  const gateLfo = ctx.createOscillator();
  gateLfo.type = 'sine';
  gateLfo.frequency.value = 0.03;

  const gateShaper = ctx.createWaveShaper();
  const curveLen = 256;
  const curve = new Float32Array(curveLen);
  for (let i = 0; i < curveLen; i++) {
    const x = (i / (curveLen - 1)) * 2 - 1;
    curve[i] = x > 0.8 ? smoothstep((x - 0.8) / 0.2) : 0.0;
  }
  gateShaper.curve = curve;

  const gateGain = ctx.createGain();
  gateGain.gain.value = 0.0;

  gateLfo.connect(gateShaper);
  gateShaper.connect(gateGain.gain);

  src.connect(lp);
  lp.connect(gateGain);
  gateGain.connect(masterGain);

  src.start();
  gateLfo.start();

  return {
    node: masterGain,
    gain: masterGain,
    stop() {
      try { src.stop(); } catch (_) {}
      try { gateLfo.stop(); } catch (_) {}
      src.disconnect();
      lp.disconnect();
      gateLfo.disconnect();
      gateShaper.disconnect();
      gateGain.disconnect();
      masterGain.disconnect();
    },
  };
}

// ---------------------------------------------------------------------------
// One-shot sound builders (create, play, auto-cleanup)
// ---------------------------------------------------------------------------

/**
 * Play a one-shot fountain splash at a position.
 */
function playFountainOneShot(ctx, destination, panner) {
  const duration = 0.4;
  const sr = ctx.sampleRate;
  const length = Math.floor(sr * duration);
  const buffer = ctx.createBuffer(1, length, sr);
  const data = buffer.getChannelData(0);

  for (let i = 0; i < length; i++) {
    const t = i / length;
    const env = Math.exp(-t * 8) * (1 - Math.exp(-t * 50));
    data[i] = (Math.random() * 2 - 1) * env * 0.6;
  }

  const src = ctx.createBufferSource();
  src.buffer = buffer;

  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 2000;

  src.connect(lp);
  if (panner) {
    lp.connect(panner);
    panner.connect(destination);
  } else {
    lp.connect(destination);
  }

  src.start();
  src.onended = () => {
    src.disconnect();
    lp.disconnect();
    if (panner) panner.disconnect();
  };
}

/**
 * Play a one-shot bell sound (sine + harmonics with exponential decay).
 */
function playBellOneShot(ctx, destination, panner) {
  const now = ctx.currentTime;
  const duration = 3.0;
  const fundamentalHz = 440;
  const harmonics = [1, 2.0, 3.0, 4.2, 5.4];
  const amplitudes = [1.0, 0.6, 0.3, 0.15, 0.08];

  const mixGain = ctx.createGain();
  mixGain.gain.value = 0.15;

  if (panner) {
    mixGain.connect(panner);
    panner.connect(destination);
  } else {
    mixGain.connect(destination);
  }

  const sources = [];

  for (let i = 0; i < harmonics.length; i++) {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = fundamentalHz * harmonics[i];

    const envGain = ctx.createGain();
    envGain.gain.setValueAtTime(amplitudes[i], now);
    envGain.gain.exponentialRampToValueAtTime(0.001, now + duration * (1 - i * 0.1));

    osc.connect(envGain);
    envGain.connect(mixGain);
    osc.start(now);
    osc.stop(now + duration);

    sources.push({ osc, envGain });
  }

  // Cleanup after done
  setTimeout(() => {
    for (const s of sources) {
      s.osc.disconnect();
      s.envGain.disconnect();
    }
    mixGain.disconnect();
    if (panner) panner.disconnect();
  }, duration * 1000 + 100);
}

/**
 * Play a one-shot anvil strike (short metallic hit).
 */
function playAnvilOneShot(ctx, destination, panner) {
  const now = ctx.currentTime;
  const duration = 0.5;

  // Noise burst for impact
  const burstLen = Math.floor(ctx.sampleRate * 0.05);
  const burstBuf = ctx.createBuffer(1, burstLen, ctx.sampleRate);
  const burstData = burstBuf.getChannelData(0);
  for (let i = 0; i < burstLen; i++) {
    burstData[i] = (Math.random() * 2 - 1) * Math.exp(-(i / burstLen) * 15);
  }

  const burstSrc = ctx.createBufferSource();
  burstSrc.buffer = burstBuf;

  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 2500;
  bp.Q.value = 12;

  // Metallic ring
  const ring = ctx.createOscillator();
  ring.type = 'sine';
  ring.frequency.value = 1800;

  const ringEnv = ctx.createGain();
  ringEnv.gain.setValueAtTime(0.3, now);
  ringEnv.gain.exponentialRampToValueAtTime(0.001, now + duration);

  const mixGain = ctx.createGain();
  mixGain.gain.value = 0.2;

  burstSrc.connect(bp);
  bp.connect(mixGain);
  ring.connect(ringEnv);
  ringEnv.connect(mixGain);

  if (panner) {
    mixGain.connect(panner);
    panner.connect(destination);
  } else {
    mixGain.connect(destination);
  }

  burstSrc.start(now);
  ring.start(now);
  ring.stop(now + duration);

  setTimeout(() => {
    burstSrc.disconnect();
    bp.disconnect();
    ring.disconnect();
    ringEnv.disconnect();
    mixGain.disconnect();
    if (panner) panner.disconnect();
  }, duration * 1000 + 100);
}

/**
 * Play a one-shot construction sound (hammering with wood resonance).
 */
function playConstructionOneShot(ctx, destination, panner) {
  const now = ctx.currentTime;
  const duration = 0.3;

  const burstLen = Math.floor(ctx.sampleRate * 0.04);
  const burstBuf = ctx.createBuffer(1, burstLen, ctx.sampleRate);
  const burstData = burstBuf.getChannelData(0);
  for (let i = 0; i < burstLen; i++) {
    burstData[i] = (Math.random() * 2 - 1) * Math.exp(-(i / burstLen) * 20);
  }

  const burstSrc = ctx.createBufferSource();
  burstSrc.buffer = burstBuf;

  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 1500;

  const peaking = ctx.createBiquadFilter();
  peaking.type = 'peaking';
  peaking.frequency.value = 300;
  peaking.Q.value = 3;
  peaking.gain.value = 8;

  const outGain = ctx.createGain();
  outGain.gain.value = 0.25;

  burstSrc.connect(lp);
  lp.connect(peaking);
  peaking.connect(outGain);

  if (panner) {
    outGain.connect(panner);
    panner.connect(destination);
  } else {
    outGain.connect(destination);
  }

  burstSrc.start(now);

  setTimeout(() => {
    burstSrc.disconnect();
    lp.disconnect();
    peaking.disconnect();
    outGain.disconnect();
    if (panner) panner.disconnect();
  }, duration * 1000 + 100);
}

/**
 * Play a one-shot level-up sound (ascending harmonics with shimmer).
 */
function playLevelUpOneShot(ctx, destination, panner) {
  const now = ctx.currentTime;
  const duration = 1.5;

  const mixGain = ctx.createGain();
  mixGain.gain.value = 0.12;

  if (panner) {
    mixGain.connect(panner);
    panner.connect(destination);
  } else {
    mixGain.connect(destination);
  }

  // Ascending arpeggio: C5, E5, G5, C6
  const notes = [523.25, 659.25, 783.99, 1046.5];
  const sources = [];

  for (let i = 0; i < notes.length; i++) {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = notes[i];

    const envGain = ctx.createGain();
    const startTime = now + i * 0.12;
    envGain.gain.setValueAtTime(0.001, now);
    envGain.gain.setValueAtTime(0.001, startTime);
    envGain.gain.linearRampToValueAtTime(0.8 - i * 0.1, startTime + 0.05);
    envGain.gain.exponentialRampToValueAtTime(0.001, startTime + duration - i * 0.12);

    osc.connect(envGain);
    envGain.connect(mixGain);
    osc.start(startTime);
    osc.stop(startTime + duration);

    sources.push({ osc, envGain });
  }

  // Shimmer noise burst at end
  const shimmerLen = Math.floor(ctx.sampleRate * 0.3);
  const shimmerBuf = ctx.createBuffer(1, shimmerLen, ctx.sampleRate);
  const shimmerData = shimmerBuf.getChannelData(0);
  for (let i = 0; i < shimmerLen; i++) {
    shimmerData[i] = (Math.random() * 2 - 1) * Math.exp(-(i / shimmerLen) * 5) * 0.15;
  }

  const shimmerSrc = ctx.createBufferSource();
  shimmerSrc.buffer = shimmerBuf;

  const shimmerHp = ctx.createBiquadFilter();
  shimmerHp.type = 'highpass';
  shimmerHp.frequency.value = 5000;

  shimmerSrc.connect(shimmerHp);
  shimmerHp.connect(mixGain);
  shimmerSrc.start(now + 0.3);

  setTimeout(() => {
    for (const s of sources) {
      s.osc.disconnect();
      s.envGain.disconnect();
    }
    shimmerSrc.disconnect();
    shimmerHp.disconnect();
    mixGain.disconnect();
    if (panner) panner.disconnect();
  }, (duration + 0.5) * 1000 + 100);
}

// ---------------------------------------------------------------------------
// AudioManager class
// ---------------------------------------------------------------------------

export class AudioManager {
  /**
   * @param {object} [options]
   * @param {number} [options.masterVolume=0.8]
   * @param {number} [options.musicVolume=0.6]
   * @param {number} [options.sfxVolume=0.7]
   * @param {boolean} [options.enabled=true]
   */
  constructor(options = {}) {
    this._masterVolume = options.masterVolume !== undefined ? options.masterVolume : 0.8;
    this._musicVolume = options.musicVolume !== undefined ? options.musicVolume : 0.6;
    this._sfxVolume = options.sfxVolume !== undefined ? options.sfxVolume : 0.7;
    this._enabled = options.enabled !== undefined ? options.enabled : true;

    /** @type {AudioContext|null} */
    this._ctx = null;
    this._initialized = false;
    this._disposed = false;

    // Master gain chain: source -> music/sfx bus -> master -> destination
    this._masterGain = null;
    this._musicBus = null;
    this._sfxBus = null;

    // Layer 1: Base ambience
    this._dayAmbience = null;   // { components: [...], gain: GainNode }
    this._nightAmbience = null; // { components: [...], gain: GainNode }
    this._ambienceGain = null;
    this._currentHour = 12;

    // Layer 2: Zone ambience
    this._zones = new Map();          // zoneName -> { components, gain }
    this._activeZone = null;
    this._zoneBlendState = null;      // { zone1, zone2, blend }
    this._zoneFadeTimers = new Map(); // zoneName -> { start, duration, fromVol, toVol }

    // Layer 3: Point sources
    this._sources = new Map();        // id -> { position, soundType, options, panner, gain, components, active }
    this._listenerPos = { x: 0, y: 0, z: 0 };
    this._listenerForward = { x: 0, y: 0, z: -1 };
    this._listenerUp = { x: 0, y: 1, z: 0 };
    this._activeSources = new Set();  // ids of currently playing sources

    // Weather
    this._weatherType = 'clear';
    this._weatherLayers = null;       // { components: [...], gain: GainNode }

    // Shared buffers (created once)
    this._noiseBuffer = null;
    this._burstBuffer = null;

    // Priority update throttle
    this._lastPriorityUpdate = 0;

    // Pending fade operations for smooth transitions
    this._fades = [];
  }

  // -----------------------------------------------------------------------
  // Initialization
  // -----------------------------------------------------------------------

  /**
   * Initialize the audio system. Must be called after a user gesture to
   * unlock the AudioContext on browsers that require it.
   * @returns {Promise<void>}
   */
  async initialize() {
    if (this._initialized || this._disposed) return;

    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) {
        console.warn('AudioManager: Web Audio API not available');
        return;
      }

      this._ctx = new AC();

      // Resume if suspended (required by many browsers after construction)
      if (this._ctx.state === 'suspended') {
        await this._ctx.resume();
      }

      // Build master gain chain
      this._masterGain = this._ctx.createGain();
      this._masterGain.gain.value = this._enabled ? this._masterVolume : 0;
      this._masterGain.connect(this._ctx.destination);

      this._musicBus = this._ctx.createGain();
      this._musicBus.gain.value = this._musicVolume;
      this._musicBus.connect(this._masterGain);

      this._sfxBus = this._ctx.createGain();
      this._sfxBus.gain.value = this._sfxVolume;
      this._sfxBus.connect(this._masterGain);

      // Create shared buffers
      this._noiseBuffer = createNoiseBuffer(this._ctx, 4);
      this._burstBuffer = createBurstBuffer(this._ctx, 0.08);

      // Build Layer 1: Base ambience
      this._ambienceGain = this._ctx.createGain();
      this._ambienceGain.gain.value = 1.0;
      this._ambienceGain.connect(this._musicBus);

      this._buildDayAmbience();
      this._buildNightAmbience();

      // Apply initial time of day
      this._applyTimeOfDay(this._currentHour);

      this._initialized = true;
    } catch (err) {
      console.warn('AudioManager: Failed to initialize:', err);
    }
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  /**
   * Enable or disable all audio output.
   * @param {boolean} enabled
   */
  setEnabled(enabled) {
    this._enabled = enabled;
    if (this._masterGain) {
      this._smoothParam(this._masterGain.gain, enabled ? this._masterVolume : 0, 0.3);
    }
  }

  /**
   * Set master volume (0-1).
   * @param {number} vol
   */
  setMasterVolume(vol) {
    this._masterVolume = clamp(vol, 0, 1);
    if (this._masterGain && this._enabled) {
      this._smoothParam(this._masterGain.gain, this._masterVolume, 0.1);
    }
  }

  /**
   * Set music/ambience volume (0-1).
   * @param {number} vol
   */
  setMusicVolume(vol) {
    this._musicVolume = clamp(vol, 0, 1);
    if (this._musicBus) {
      this._smoothParam(this._musicBus.gain, this._musicVolume, 0.1);
    }
  }

  /**
   * Set sound effects volume (0-1).
   * @param {number} vol
   */
  setSFXVolume(vol) {
    this._sfxVolume = clamp(vol, 0, 1);
    if (this._sfxBus) {
      this._smoothParam(this._sfxBus.gain, this._sfxVolume, 0.1);
    }
  }

  // -----------------------------------------------------------------------
  // Layer 1: Base Ambience
  // -----------------------------------------------------------------------

  /**
   * Set the current time of day and crossfade between day/night ambience.
   * @param {number} hour - 0 to 24 (float)
   */
  setTimeOfDay(hour) {
    this._currentHour = ((hour % 24) + 24) % 24;
    if (!this._initialized) return;
    this._applyTimeOfDay(this._currentHour);
  }

  // -----------------------------------------------------------------------
  // Layer 2: Zone Ambience
  // -----------------------------------------------------------------------

  /**
   * Crossfade to a new zone ambience. Fades out the old zone and fades in
   * the new one over ZONE_CROSSFADE_DURATION seconds.
   * @param {string} zoneName - One of: 'market', 'forge', 'sanctuary',
   *   'harbor', 'barracks', 'arena', 'academy'
   */
  setActiveZone(zoneName) {
    if (!this._initialized) return;

    const prevZone = this._activeZone;
    if (prevZone === zoneName) return;

    this._zoneBlendState = null;

    // Fade out previous
    if (prevZone && this._zones.has(prevZone)) {
      const prev = this._zones.get(prevZone);
      this._smoothParam(prev.gain.gain, 0, ZONE_CROSSFADE_DURATION);
    }

    // Ensure zone is built
    if (!this._zones.has(zoneName)) {
      this._buildZone(zoneName);
    }

    // Fade in new
    const zone = this._zones.get(zoneName);
    if (zone) {
      this._smoothParam(zone.gain.gain, 1.0, ZONE_CROSSFADE_DURATION);
    }

    this._activeZone = zoneName;
  }

  /**
   * Smoothly blend between two zones. Use this when the camera is between
   * two zone boundaries.
   * @param {string} zone1 - First zone name
   * @param {string} zone2 - Second zone name
   * @param {number} blend - 0 = fully zone1, 1 = fully zone2
   */
  setZoneBlend(zone1, zone2, blend) {
    if (!this._initialized) return;

    blend = clamp(blend, 0, 1);

    // Ensure both zones are built
    if (!this._zones.has(zone1)) this._buildZone(zone1);
    if (!this._zones.has(zone2)) this._buildZone(zone2);

    // Silence any other active zone
    if (this._activeZone && this._activeZone !== zone1 && this._activeZone !== zone2) {
      const prev = this._zones.get(this._activeZone);
      if (prev) this._smoothParam(prev.gain.gain, 0, ZONE_CROSSFADE_DURATION);
    }

    const z1 = this._zones.get(zone1);
    const z2 = this._zones.get(zone2);

    if (z1) this._smoothParam(z1.gain.gain, 1.0 - blend, 0.1);
    if (z2) this._smoothParam(z2.gain.gain, blend, 0.1);

    this._zoneBlendState = { zone1, zone2, blend };
    this._activeZone = null;
  }

  // -----------------------------------------------------------------------
  // Layer 3: Point Sources
  // -----------------------------------------------------------------------

  /**
   * Register a 3D point source in the scene.
   * @param {string} id - Unique identifier
   * @param {{ x: number, y: number, z: number }} position - World position
   * @param {string} soundType - 'fountain', 'anvil', 'tavern_music',
   *   'fire_crackle', 'wind_chime', 'bell'
   * @param {object} [options]
   * @param {boolean} [options.loop=true]
   * @param {number} [options.volume=0.5]
   * @param {number} [options.maxDistance=30]
   * @param {number} [options.refDistance=1]
   * @param {number} [options.rolloffFactor=1]
   */
  registerSource(id, position, soundType, options = {}) {
    if (!this._initialized) return;

    // Unregister existing source with same id
    if (this._sources.has(id)) {
      this.unregisterSource(id);
    }

    const loop = options.loop !== undefined ? options.loop : true;
    const volume = options.volume !== undefined ? options.volume : 0.5;
    const maxDistance = options.maxDistance !== undefined ? options.maxDistance : DEFAULT_MAX_DISTANCE;
    const refDistance = options.refDistance !== undefined ? options.refDistance : 1;
    const rolloffFactor = options.rolloffFactor !== undefined ? options.rolloffFactor : 1;

    // Create PannerNode for 3D positioning
    const panner = this._ctx.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = refDistance;
    panner.maxDistance = maxDistance;
    panner.rolloffFactor = rolloffFactor;
    panner.coneInnerAngle = 360;
    panner.coneOuterAngle = 360;
    panner.coneOuterGain = 0;
    panner.positionX.value = position.x;
    panner.positionY.value = position.y;
    panner.positionZ.value = position.z;

    // Volume control for this source
    const gain = this._ctx.createGain();
    gain.gain.value = 0; // start muted; priority system will activate
    gain.connect(panner);
    panner.connect(this._sfxBus);

    // Build sound graph for this type
    const components = this._buildPointSourceGraph(soundType, gain, loop);

    const record = {
      id,
      position: { x: position.x, y: position.y, z: position.z },
      soundType,
      loop,
      volume,
      maxDistance,
      panner,
      gain,
      components,
      active: false,
    };

    this._sources.set(id, record);
  }

  /**
   * Unregister and clean up a point source.
   * @param {string} id
   */
  unregisterSource(id) {
    const rec = this._sources.get(id);
    if (!rec) return;

    this._activeSources.delete(id);

    // Stop components
    if (rec.components && rec.components.stop) {
      rec.components.stop();
    }

    rec.gain.disconnect();
    rec.panner.disconnect();

    this._sources.delete(id);
  }

  /**
   * Update the AudioContext listener position (camera position).
   * @param {number} x
   * @param {number} y
   * @param {number} z
   */
  setListenerPosition(x, y, z) {
    this._listenerPos.x = x;
    this._listenerPos.y = y;
    this._listenerPos.z = z;

    if (!this._ctx) return;

    const listener = this._ctx.listener;
    if (listener.positionX) {
      listener.positionX.value = x;
      listener.positionY.value = y;
      listener.positionZ.value = z;
    } else if (listener.setPosition) {
      listener.setPosition(x, y, z);
    }
  }

  /**
   * Update the AudioContext listener orientation.
   * @param {{ x: number, y: number, z: number }} forward
   * @param {{ x: number, y: number, z: number }} up
   */
  setListenerOrientation(forward, up) {
    this._listenerForward = { x: forward.x, y: forward.y, z: forward.z };
    this._listenerUp = { x: up.x, y: up.y, z: up.z };

    if (!this._ctx) return;

    const listener = this._ctx.listener;
    if (listener.forwardX) {
      listener.forwardX.value = forward.x;
      listener.forwardY.value = forward.y;
      listener.forwardZ.value = forward.z;
      listener.upX.value = up.x;
      listener.upY.value = up.y;
      listener.upZ.value = up.z;
    } else if (listener.setOrientation) {
      listener.setOrientation(
        forward.x, forward.y, forward.z,
        up.x, up.y, up.z
      );
    }
  }

  // -----------------------------------------------------------------------
  // Weather
  // -----------------------------------------------------------------------

  /**
   * Set weather type. Adds or removes rain/thunder ambient layers.
   * @param {string} type - 'clear', 'rain', 'storm'
   */
  setWeather(type) {
    if (!this._initialized) return;
    if (this._weatherType === type) return;

    // Remove old weather layers
    this._disposeWeatherLayers();

    this._weatherType = type;

    if (type === 'clear') return;

    const weatherGain = this._ctx.createGain();
    weatherGain.gain.value = 0;
    weatherGain.connect(this._musicBus);

    const components = [];

    if (type === 'rain' || type === 'storm') {
      const rain = buildRainGraph(this._ctx, this._noiseBuffer, weatherGain, 0.12);
      components.push(rain);
    }

    if (type === 'storm') {
      const thunder = buildThunderGraph(this._ctx, this._noiseBuffer, weatherGain, 0.18);
      components.push(thunder);

      // Increase wind for storm
      // (existing wind in day ambience will be supplemented)
    }

    this._weatherLayers = {
      components,
      gain: weatherGain,
    };

    // Fade in
    this._smoothParam(weatherGain.gain, 1.0, 2.0);
  }

  // -----------------------------------------------------------------------
  // One-shot Sounds
  // -----------------------------------------------------------------------

  /**
   * Play a one-shot (non-looping) sound, optionally at a 3D position.
   * @param {string} soundType - 'bell', 'anvil', 'construction',
   *   'levelup', 'fountain'
   * @param {{ x: number, y: number, z: number }} [position] - If provided,
   *   sound is spatialized at this position
   * @param {object} [options]
   * @param {number} [options.volume=0.5]
   */
  playOneShot(soundType, position, options = {}) {
    if (!this._initialized) return;

    let panner = null;
    const dest = this._sfxBus;

    if (position) {
      panner = this._ctx.createPanner();
      panner.panningModel = 'HRTF';
      panner.distanceModel = 'inverse';
      panner.refDistance = 1;
      panner.maxDistance = 50;
      panner.rolloffFactor = 1;
      panner.positionX.value = position.x;
      panner.positionY.value = position.y;
      panner.positionZ.value = position.z;
    }

    switch (soundType) {
      case 'bell':
        playBellOneShot(this._ctx, dest, panner);
        break;
      case 'anvil':
        playAnvilOneShot(this._ctx, dest, panner);
        break;
      case 'construction':
        playConstructionOneShot(this._ctx, dest, panner);
        break;
      case 'levelup':
        playLevelUpOneShot(this._ctx, dest, panner);
        break;
      case 'fountain':
        playFountainOneShot(this._ctx, dest, panner);
        break;
      default:
        // Generic click/tap sound
        this._playGenericOneShot(dest, panner);
        break;
    }
  }

  // -----------------------------------------------------------------------
  // Per-frame Update
  // -----------------------------------------------------------------------

  /**
   * Call once per frame (or at your preferred update rate).
   * @param {number} deltaTime - Seconds since last frame
   * @param {{ x: number, y: number, z: number }} [cameraPosition]
   */
  update(deltaTime, cameraPosition) {
    if (!this._initialized || this._disposed) return;

    // 1. Update listener position if camera position provided
    if (cameraPosition) {
      this.setListenerPosition(cameraPosition.x, cameraPosition.y, cameraPosition.z);
    }

    // 2. Process pending fades
    this._processFades(deltaTime);

    // 3. Point source priority culling (throttled)
    const now = performance.now();
    if (now - this._lastPriorityUpdate >= PRIORITY_UPDATE_INTERVAL) {
      this._lastPriorityUpdate = now;
      this._updateSourcePriority();
    }
  }

  // -----------------------------------------------------------------------
  // Dispose
  // -----------------------------------------------------------------------

  /**
   * Dispose all audio resources and close the AudioContext.
   */
  dispose() {
    if (this._disposed) return;
    this._disposed = true;

    // Dispose day/night ambience
    this._disposeDayAmbience();
    this._disposeNightAmbience();

    // Dispose all zones
    for (const [, zone] of this._zones) {
      this._disposeZoneRecord(zone);
    }
    this._zones.clear();

    // Dispose all point sources
    for (const [id] of this._sources) {
      this.unregisterSource(id);
    }
    this._sources.clear();

    // Dispose weather
    this._disposeWeatherLayers();

    // Disconnect buses
    if (this._ambienceGain) {
      this._ambienceGain.disconnect();
      this._ambienceGain = null;
    }
    if (this._musicBus) {
      this._musicBus.disconnect();
      this._musicBus = null;
    }
    if (this._sfxBus) {
      this._sfxBus.disconnect();
      this._sfxBus = null;
    }
    if (this._masterGain) {
      this._masterGain.disconnect();
      this._masterGain = null;
    }

    // Close context
    if (this._ctx && this._ctx.state !== 'closed') {
      this._ctx.close().catch(() => {});
    }
    this._ctx = null;
    this._initialized = false;
  }

  // -----------------------------------------------------------------------
  // Private: Build Layer 1 ambience
  // -----------------------------------------------------------------------

  _buildDayAmbience() {
    const ctx = this._ctx;

    const dayGain = ctx.createGain();
    dayGain.gain.value = 0;
    dayGain.connect(this._ambienceGain);

    const components = [];

    // Gentle wind
    const wind = buildWindGraph(ctx, this._noiseBuffer, dayGain, 400, 0.12);
    components.push(wind);

    // Birdsong
    const birds = buildBirdsongGraph(ctx, dayGain, 0.05);
    components.push(birds);

    this._dayAmbience = {
      components,
      gain: dayGain,
    };
  }

  _buildNightAmbience() {
    const ctx = this._ctx;

    const nightGain = ctx.createGain();
    nightGain.gain.value = 0;
    nightGain.connect(this._ambienceGain);

    const components = [];

    // Crickets
    const crickets = buildCricketGraph(ctx, this._noiseBuffer, nightGain, 0.04);
    components.push(crickets);

    // Owls
    const owls = buildOwlGraph(ctx, nightGain, 0.04);
    components.push(owls);

    // Distant wolf
    const wolf = buildWolfGraph(ctx, this._noiseBuffer, nightGain, 0.02);
    components.push(wolf);

    // Subtle night wind (quieter, deeper)
    const wind = buildWindGraph(ctx, this._noiseBuffer, nightGain, 250, 0.06);
    components.push(wind);

    this._nightAmbience = {
      components,
      gain: nightGain,
    };
  }

  _disposeDayAmbience() {
    if (!this._dayAmbience) return;
    for (const c of this._dayAmbience.components) {
      if (c.stop) c.stop();
    }
    this._dayAmbience.gain.disconnect();
    this._dayAmbience = null;
  }

  _disposeNightAmbience() {
    if (!this._nightAmbience) return;
    for (const c of this._nightAmbience.components) {
      if (c.stop) c.stop();
    }
    this._nightAmbience.gain.disconnect();
    this._nightAmbience = null;
  }

  /**
   * Compute day/night blend and apply to gains.
   * Day = 1.0 between DAWN_END and DUSK_START
   * Night = 1.0 between DUSK_END and DAWN_START (wrapping past midnight)
   * Crossfade linearly during dawn and dusk.
   */
  _applyTimeOfDay(hour) {
    let dayBlend = 0;

    if (hour >= DAWN_END && hour <= DUSK_START) {
      // Full day
      dayBlend = 1.0;
    } else if (hour >= DAWN_START && hour < DAWN_END) {
      // Dawn transition
      dayBlend = (hour - DAWN_START) / (DAWN_END - DAWN_START);
    } else if (hour > DUSK_START && hour <= DUSK_END) {
      // Dusk transition
      dayBlend = 1.0 - (hour - DUSK_START) / (DUSK_END - DUSK_START);
    } else {
      // Night
      dayBlend = 0;
    }

    dayBlend = smoothstep(dayBlend);

    if (this._dayAmbience) {
      this._smoothParam(this._dayAmbience.gain.gain, dayBlend, TIME_CROSSFADE_DURATION);
    }
    if (this._nightAmbience) {
      this._smoothParam(this._nightAmbience.gain.gain, 1.0 - dayBlend, TIME_CROSSFADE_DURATION);
    }
  }

  // -----------------------------------------------------------------------
  // Private: Build Layer 2 zone ambience
  // -----------------------------------------------------------------------

  _buildZone(zoneName) {
    if (this._zones.has(zoneName)) return;

    const ctx = this._ctx;

    const zoneGain = ctx.createGain();
    zoneGain.gain.value = 0; // start silent
    zoneGain.connect(this._musicBus);

    const components = [];

    switch (zoneName) {
      case 'market': {
        const murmur = buildCrowdMurmurGraph(ctx, this._noiseBuffer, zoneGain, 0.10);
        components.push(murmur);
        const calls = buildVendorCallsGraph(ctx, this._noiseBuffer, zoneGain, 0.03);
        components.push(calls);
        break;
      }

      case 'forge': {
        const hammer = buildHammerStrikesGraph(ctx, this._burstBuffer, zoneGain, 0.08);
        components.push(hammer);
        const bellows = buildBellowsGraph(ctx, this._noiseBuffer, zoneGain, 0.05);
        components.push(bellows);
        break;
      }

      case 'sanctuary': {
        const choir = buildChoirHumGraph(ctx, zoneGain, 0.06);
        components.push(choir);
        const chimes = buildWindChimesGraph(ctx, zoneGain, 0.04);
        components.push(chimes);
        break;
      }

      case 'harbor': {
        const waves = buildWavesGraph(ctx, this._noiseBuffer, zoneGain, 0.09);
        components.push(waves);
        const gulls = buildSeagullsGraph(ctx, zoneGain, 0.03);
        components.push(gulls);
        break;
      }

      case 'barracks': {
        const march = buildMarchingGraph(ctx, this._burstBuffer, zoneGain, 0.07);
        components.push(march);
        const clank = buildMetalClankGraph(ctx, this._burstBuffer, zoneGain, 0.04);
        components.push(clank);
        break;
      }

      case 'arena': {
        const cheer = buildCrowdCheeringGraph(ctx, this._noiseBuffer, zoneGain, 0.12);
        components.push(cheer);
        break;
      }

      case 'academy': {
        const pages = buildPageTurningGraph(ctx, this._noiseBuffer, zoneGain, 0.02);
        components.push(pages);
        const quiet = buildQuietMurmurGraph(ctx, this._noiseBuffer, zoneGain, 0.025);
        components.push(quiet);
        break;
      }

      default:
        // Unknown zone — no sound
        break;
    }

    this._zones.set(zoneName, {
      components,
      gain: zoneGain,
    });
  }

  _disposeZoneRecord(zone) {
    if (!zone) return;
    for (const c of zone.components) {
      if (c.stop) c.stop();
    }
    zone.gain.disconnect();
  }

  // -----------------------------------------------------------------------
  // Private: Build Layer 3 point source graphs
  // -----------------------------------------------------------------------

  _buildPointSourceGraph(soundType, destination, loop) {
    const ctx = this._ctx;

    switch (soundType) {
      case 'fountain':
        return buildWavesGraph(ctx, this._noiseBuffer, destination, 0.15);

      case 'anvil':
        return buildHammerStrikesGraph(ctx, this._burstBuffer, destination, 0.12);

      case 'tavern_music': {
        // Simple pentatonic melody loop on sine oscillators
        const masterGain = ctx.createGain();
        masterGain.gain.value = 0.08;
        masterGain.connect(destination);

        const notes = [392, 440, 523.25, 587.33, 659.25]; // G4 A4 C5 D5 E5
        const oscs = [];

        for (let i = 0; i < 3; i++) {
          const osc = ctx.createOscillator();
          osc.type = i === 0 ? 'triangle' : 'sine';
          osc.frequency.value = notes[i % notes.length] * (i === 2 ? 0.5 : 1);

          // Slow random-ish movement
          const lfo = ctx.createOscillator();
          lfo.type = 'sine';
          lfo.frequency.value = 0.8 + i * 0.3;

          const lfoGain = ctx.createGain();
          lfoGain.gain.value = notes[i % notes.length] * 0.02;

          lfo.connect(lfoGain);
          lfoGain.connect(osc.frequency);

          // Volume tremolo for rhythm
          const trem = ctx.createOscillator();
          trem.type = 'sine';
          trem.frequency.value = 2 + i * 0.5;

          const tremGain = ctx.createGain();
          tremGain.gain.value = 0.4;

          const voiceGain = ctx.createGain();
          voiceGain.gain.value = 0.3;

          trem.connect(tremGain);
          tremGain.connect(voiceGain.gain);

          osc.connect(voiceGain);
          voiceGain.connect(masterGain);

          osc.start();
          lfo.start();
          trem.start();

          oscs.push({ osc, lfo, lfoGain, trem, tremGain, voiceGain });
        }

        return {
          node: masterGain,
          gain: masterGain,
          stop() {
            for (const o of oscs) {
              try { o.osc.stop(); } catch (_) {}
              try { o.lfo.stop(); } catch (_) {}
              try { o.trem.stop(); } catch (_) {}
              o.osc.disconnect();
              o.lfo.disconnect();
              o.lfoGain.disconnect();
              o.trem.disconnect();
              o.tremGain.disconnect();
              o.voiceGain.disconnect();
            }
            masterGain.disconnect();
          },
        };
      }

      case 'fire_crackle': {
        const masterGain = ctx.createGain();
        masterGain.gain.value = 0.1;
        masterGain.connect(destination);

        const src = ctx.createBufferSource();
        src.buffer = this._noiseBuffer;
        src.loop = true;

        // Bandpass for crackle character
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = 1500;
        bp.Q.value = 3;

        // Random crackle gating
        const gateLfo = ctx.createOscillator();
        gateLfo.type = 'sawtooth';
        gateLfo.frequency.value = 8;

        const gateShaper = ctx.createWaveShaper();
        const curveLen = 256;
        const curve = new Float32Array(curveLen);
        for (let j = 0; j < curveLen; j++) {
          const x = (j / (curveLen - 1)) * 2 - 1;
          curve[j] = x > 0.6 ? 1.0 : 0.0;
        }
        gateShaper.curve = curve;

        const gateGain = ctx.createGain();
        gateGain.gain.value = 0.0;

        gateLfo.connect(gateShaper);
        gateShaper.connect(gateGain.gain);

        // Low rumble
        const rumbleSrc = ctx.createBufferSource();
        rumbleSrc.buffer = this._noiseBuffer;
        rumbleSrc.loop = true;

        const rumbleLp = ctx.createBiquadFilter();
        rumbleLp.type = 'lowpass';
        rumbleLp.frequency.value = 200;

        const rumbleGain = ctx.createGain();
        rumbleGain.gain.value = 0.3;

        src.connect(bp);
        bp.connect(gateGain);
        gateGain.connect(masterGain);

        rumbleSrc.connect(rumbleLp);
        rumbleLp.connect(rumbleGain);
        rumbleGain.connect(masterGain);

        src.start();
        gateLfo.start();
        rumbleSrc.start();

        return {
          node: masterGain,
          gain: masterGain,
          stop() {
            try { src.stop(); } catch (_) {}
            try { gateLfo.stop(); } catch (_) {}
            try { rumbleSrc.stop(); } catch (_) {}
            src.disconnect();
            bp.disconnect();
            gateLfo.disconnect();
            gateShaper.disconnect();
            gateGain.disconnect();
            rumbleSrc.disconnect();
            rumbleLp.disconnect();
            rumbleGain.disconnect();
            masterGain.disconnect();
          },
        };
      }

      case 'wind_chime':
        return buildWindChimesGraph(ctx, destination, 0.06);

      case 'bell': {
        // Periodic bell tolling — sine with slow trigger
        const masterGain = ctx.createGain();
        masterGain.gain.value = 0.08;
        masterGain.connect(destination);

        const fundamentalHz = 440;
        const harmonics = [1, 2.0, 3.0, 4.2];
        const amps = [1.0, 0.5, 0.25, 0.12];

        const oscs = [];

        for (let i = 0; i < harmonics.length; i++) {
          const osc = ctx.createOscillator();
          osc.type = 'sine';
          osc.frequency.value = fundamentalHz * harmonics[i];

          const voiceGain = ctx.createGain();
          voiceGain.gain.value = amps[i];

          osc.connect(voiceGain);
          voiceGain.connect(masterGain);
          osc.start();

          oscs.push({ osc, voiceGain });
        }

        // Slow gate for periodic toll
        const gateLfo = ctx.createOscillator();
        gateLfo.type = 'sine';
        gateLfo.frequency.value = 0.05; // toll every ~20s

        const gateShaper = ctx.createWaveShaper();
        const curveLen = 256;
        const curve = new Float32Array(curveLen);
        for (let j = 0; j < curveLen; j++) {
          const x = (j / (curveLen - 1)) * 2 - 1;
          // Very narrow spike -> short ring
          curve[j] = x > 0.9 ? Math.pow((x - 0.9) / 0.1, 0.5) : 0.0;
        }
        gateShaper.curve = curve;

        // Apply gate to master
        const gateModGain = ctx.createGain();
        gateModGain.gain.value = 0.0;

        gateLfo.connect(gateShaper);
        gateShaper.connect(gateModGain.gain);

        // Reconnect: insert gate between oscs and output
        masterGain.disconnect();
        const postGateGain = ctx.createGain();
        postGateGain.gain.value = 0.0;

        // Each osc voice -> masterGain -> postGateGain -> destination
        gateLfo.connect(gateShaper);
        gateShaper.connect(postGateGain.gain);

        masterGain.connect(postGateGain);
        postGateGain.connect(destination);

        gateLfo.start();

        return {
          node: postGateGain,
          gain: postGateGain,
          stop() {
            for (const o of oscs) {
              try { o.osc.stop(); } catch (_) {}
              o.osc.disconnect();
              o.voiceGain.disconnect();
            }
            try { gateLfo.stop(); } catch (_) {}
            gateLfo.disconnect();
            gateShaper.disconnect();
            gateModGain.disconnect();
            masterGain.disconnect();
            postGateGain.disconnect();
          },
        };
      }

      default:
        // Generic ambient hum
        return buildWindGraph(ctx, this._noiseBuffer, destination, 600, 0.05);
    }
  }

  // -----------------------------------------------------------------------
  // Private: Point source priority system
  // -----------------------------------------------------------------------

  _updateSourcePriority() {
    if (this._sources.size === 0) return;

    const lx = this._listenerPos.x;
    const ly = this._listenerPos.y;
    const lz = this._listenerPos.z;

    // Build distance-sorted list
    const sorted = [];
    for (const [id, rec] of this._sources) {
      const ds = distSq3(lx, ly, lz, rec.position.x, rec.position.y, rec.position.z);
      sorted.push({ id, rec, distSq: ds });
    }
    sorted.sort((a, b) => a.distSq - b.distSq);

    // Determine top N to activate
    const newActive = new Set();
    for (let i = 0; i < Math.min(sorted.length, MAX_ACTIVE_SOURCES); i++) {
      // Only activate if within max distance
      const entry = sorted[i];
      if (entry.distSq <= entry.rec.maxDistance * entry.rec.maxDistance) {
        newActive.add(entry.id);
      }
    }

    // Deactivate sources that are no longer in the active set
    for (const id of this._activeSources) {
      if (!newActive.has(id)) {
        const rec = this._sources.get(id);
        if (rec) {
          this._smoothParam(rec.gain.gain, 0, 0.3);
          rec.active = false;
        }
      }
    }

    // Activate new sources
    for (const id of newActive) {
      if (!this._activeSources.has(id)) {
        const rec = this._sources.get(id);
        if (rec) {
          this._smoothParam(rec.gain.gain, rec.volume, 0.3);
          rec.active = true;
        }
      }
    }

    this._activeSources = newActive;
  }

  // -----------------------------------------------------------------------
  // Private: Weather layer disposal
  // -----------------------------------------------------------------------

  _disposeWeatherLayers() {
    if (!this._weatherLayers) return;

    for (const c of this._weatherLayers.components) {
      if (c.stop) c.stop();
    }
    this._weatherLayers.gain.disconnect();
    this._weatherLayers = null;
  }

  // -----------------------------------------------------------------------
  // Private: Smooth parameter transitions
  // -----------------------------------------------------------------------

  /**
   * Smoothly ramp an AudioParam to a target value over the given duration.
   * Uses linearRampToValueAtTime for glitch-free transitions.
   * @param {AudioParam} param
   * @param {number} targetValue
   * @param {number} duration - Seconds
   */
  _smoothParam(param, targetValue, duration) {
    if (!this._ctx) return;

    const now = this._ctx.currentTime;
    // Cancel any scheduled changes and set from current value
    param.cancelScheduledValues(now);
    param.setValueAtTime(param.value, now);
    param.linearRampToValueAtTime(targetValue, now + duration);
  }

  // -----------------------------------------------------------------------
  // Private: Fade processing (unused if _smoothParam handles everything,
  // but kept for manual fade logic if needed)
  // -----------------------------------------------------------------------

  _processFades(deltaTime) {
    // Currently all fades use Web Audio scheduling via _smoothParam.
    // This method is a hook for any future manual fade processing.
  }

  // -----------------------------------------------------------------------
  // Private: Generic one-shot for unknown types
  // -----------------------------------------------------------------------

  _playGenericOneShot(destination, panner) {
    const ctx = this._ctx;
    const now = ctx.currentTime;
    const duration = 0.15;

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 800;

    const envGain = ctx.createGain();
    envGain.gain.setValueAtTime(0.2, now);
    envGain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    osc.connect(envGain);

    if (panner) {
      envGain.connect(panner);
      panner.connect(destination);
    } else {
      envGain.connect(destination);
    }

    osc.start(now);
    osc.stop(now + duration);

    setTimeout(() => {
      osc.disconnect();
      envGain.disconnect();
      if (panner) panner.disconnect();
    }, duration * 1000 + 100);
  }
}
