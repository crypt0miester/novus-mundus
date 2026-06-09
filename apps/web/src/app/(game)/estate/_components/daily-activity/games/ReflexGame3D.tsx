"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { playSfx } from "@/lib/audio/sfx";
import type { MoveResponse } from "@/lib/hooks/useDailyActivity";
import { prefersReducedMotion } from "@/lib/utils";
import { useFx } from "../GameStage";

// 3D rewrite of the Reflex game. The timing engine — the server-held GO, the
// round-start/arm/tap|release move loop, the false-start handling, and the
// server-stamped scoring (with the RTT cap) — is copied verbatim from the DOM
// ReflexGame, so the anti-cheat contract is identical. Only the arena is 3D:
// a flaring orb for `react`, a glowing furnace + heat gauge for `precision`.

export interface ReflexPresentation {
  mode: "react" | "precision";
  rounds: number;
  instruction: string;
}

interface ReflexGame3DProps {
  presentation: ReflexPresentation;
  submitting: boolean;
  sendMove: (move: unknown) => Promise<MoveResponse>;
  onComplete: () => void;
}

type Phase = "intro" | "waiting" | "go" | "sweeping" | "result" | "done";

interface RoundResult {
  kind: "reaction" | "release";
  reactionMs?: number;
  markerPos?: number;
  fraction: number;
  falseStart?: boolean;
}

interface Sweep {
  startedAt: number;
  sweepMs: number;
  bandFrom: number;
  bandTo: number;
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function reactionTag(ms: number): { label: string; tone: string } {
  if (ms <= 220) return { label: "⚡ Razor sharp", tone: "text-text-gold" };
  if (ms <= 320) return { label: "Sharp", tone: "text-gold-300" };
  if (ms <= 470) return { label: "Steady", tone: "text-gold-400" };
  return { label: "Slow off the mark", tone: "text-zinc-400" };
}

function precisionTag(fraction: number): { label: string; tone: string } {
  if (fraction >= 0.95) return { label: "⚒ Optimal heat", tone: "text-text-gold" };
  if (fraction >= 0.6) return { label: "Close", tone: "text-gold-300" };
  if (fraction >= 0.25) return { label: "Off the mark", tone: "text-gold-400" };
  return { label: "Furnace cold", tone: "text-zinc-400" };
}

export default function ReflexGame3D({
  presentation,
  sendMove,
  onComplete,
}: ReflexGame3DProps) {
  const { mode, rounds, instruction } = presentation;
  const fx = useFx();

  const [phase, setPhase] = useState<Phase>("intro");
  const [round, setRound] = useState(1);
  const [result, setResult] = useState<RoundResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reactionMs, setReactionMs] = useState(0);
  const [markerPos, setMarkerPos] = useState(0);
  const [sweep, setSweep] = useState<Sweep | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const startedRef = useRef(false);
  const actingRef = useRef(false);
  const goAtRef = useRef(0);
  const phaseRef = useRef<Phase>("intro");
  phaseRef.current = phase;
  const epochRef = useRef(0);

  // ── Timing engine (verbatim from the DOM ReflexGame) ──────────────────────
  const runRound = useCallback(async () => {
    const epoch = ++epochRef.current;
    try {
      setResult(null);
      setReactionMs(0);
      setMarkerPos(0);
      setSweep(null);
      setPhase("intro");
      await wait(850);

      const rs = await sendMove({ kind: "round-start" });
      const token = (rs.result as { token?: string }).token;

      if (mode === "react") {
        setPhase("waiting");
        await sendMove({ kind: "arm", token });
        goAtRef.current = performance.now();
        setPhase("go");
      } else {
        const armed = await sendMove({ kind: "arm", token });
        const s = armed.result as { sweepMs: number; bandFrom: number; bandTo: number };
        setSweep({ startedAt: performance.now(), ...s });
        setPhase("sweeping");
      }
    } catch (e) {
      if (epochRef.current !== epoch) return;
      setError(e instanceof Error ? e.message : "the drill was interrupted");
    }
  }, [mode, sendMove]);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void runRound();
  }, [runRound]);

  const act = useCallback(async () => {
    if (actingRef.current) return;
    const p = phaseRef.current;
    if (mode === "react" && p !== "go" && p !== "waiting") return;
    if (mode === "precision" && p !== "sweeping") return;
    actingRef.current = true;
    if (mode === "react" && p === "waiting") epochRef.current += 1;
    try {
      const res = await sendMove({ kind: mode === "react" ? "tap" : "release" });
      const r = res.result as RoundResult;
      setResult(r);
      setPhase("result");
      const clean =
        !r.falseStart &&
        (r.kind === "reaction" ? (r.reactionMs ?? 9999) <= 470 : (r.fraction ?? 0) >= 0.6);
      if (r.falseStart) playSfx("wrong");
      else if (clean) {
        playSfx("correct");
        fx.burstEl(containerRef.current);
      } else playSfx("flip");
      await wait(1500);
      if (res.done) {
        setPhase("done");
        playSfx("win");
        fx.confetti();
        onComplete();
      } else {
        setRound((n) => n + 1);
        actingRef.current = false;
        void runRound();
        return;
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "the drill was interrupted");
    }
    actingRef.current = false;
  }, [mode, sendMove, onComplete, runRound, fx]);

  // Latest act for the canvas tap + keydown without re-subscribing.
  const actRef = useRef(act);
  actRef.current = act;

  // Live reaction counter while GO shows.
  useEffect(() => {
    if (phase !== "go") return;
    let raf = 0;
    const loop = () => {
      setReactionMs(performance.now() - goAtRef.current);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [phase]);

  // The sweep — auto-releases if the marker runs off the end.
  useEffect(() => {
    if (phase !== "sweeping" || !sweep) return;
    let raf = 0;
    const loop = () => {
      const pos = Math.min(1, (performance.now() - sweep.startedAt) / sweep.sweepMs);
      setMarkerPos(pos);
      if (pos >= 1) {
        void act();
        return;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [phase, sweep, act]);

  // Spacebar / Enter to act.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space" || e.code === "Enter") {
        e.preventDefault();
        void actRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ── 3D arena ──────────────────────────────────────────────────────────────
  const viewRef = useRef({
    mode,
    phase,
    reactionMs,
    markerPos,
    sweep,
    result,
  });
  viewRef.current = { mode, phase, reactionMs, markerPos, sweep, result };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const animate = !prefersReducedMotion();

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    camera.position.set(0, 0, 7);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setClearColor(0x000000, 0);
    container.appendChild(renderer.domElement);
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.display = "block";
    renderer.domElement.style.touchAction = "manipulation";

    const sphereGeo = new THREE.SphereGeometry(1, 32, 32);

    // react: a target orb + a halo.
    const orbMat = new THREE.MeshBasicMaterial({ color: 0x3b4252 });
    const orb = new THREE.Mesh(sphereGeo, orbMat);
    orb.scale.setScalar(1.1);
    const orbHaloMat = new THREE.MeshBasicMaterial({
      color: 0xf5c451,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const orbHalo = new THREE.Mesh(sphereGeo, orbHaloMat);
    orbHalo.scale.setScalar(1.5);

    // precision: a furnace, its halo, a heat gauge (track + band + marker) and embers.
    const furnaceGeo = new THREE.BoxGeometry(2.4, 1.8, 1.6);
    const furnaceMat = new THREE.MeshBasicMaterial({ color: 0x2a1a0e });
    const furnace = new THREE.Mesh(furnaceGeo, furnaceMat);
    furnace.position.y = 0.4;
    const furnaceHaloMat = new THREE.MeshBasicMaterial({
      color: 0xfb923c,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const furnaceHalo = new THREE.Mesh(sphereGeo, furnaceHaloMat);
    furnaceHalo.position.y = 0.4;
    furnaceHalo.scale.setScalar(1.9);

    const GAUGE_W = 5;
    const trackMat = new THREE.MeshBasicMaterial({ color: 0x1f2430 });
    const track = new THREE.Mesh(new THREE.BoxGeometry(GAUGE_W, 0.28, 0.2), trackMat);
    track.position.y = -1.9;
    const bandMat = new THREE.MeshBasicMaterial({
      color: 0xf5c451,
      transparent: true,
      opacity: 0.5,
    });
    const band = new THREE.Mesh(new THREE.BoxGeometry(1, 0.34, 0.22), bandMat);
    band.position.y = -1.9;
    const markerMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const marker = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.6, 0.3), markerMat);
    marker.position.y = -1.9;

    // Embers (rise from the furnace; intensity tracks heat).
    const EMBERS = 40;
    const emberPos = new Float32Array(EMBERS * 3);
    const emberVel = new Float32Array(EMBERS);
    for (let i = 0; i < EMBERS; i++) {
      emberPos[i * 3] = (Math.random() - 0.5) * 2;
      emberPos[i * 3 + 1] = Math.random() * 2 - 0.5;
      emberPos[i * 3 + 2] = (Math.random() - 0.5) * 1.2;
      emberVel[i] = 0.01 + Math.random() * 0.02;
    }
    const emberGeo = new THREE.BufferGeometry();
    emberGeo.setAttribute("position", new THREE.BufferAttribute(emberPos, 3));
    const emberMat = new THREE.PointsMaterial({
      color: 0xfdba74,
      size: 0.12,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const embers = new THREE.Points(emberGeo, emberMat);
    embers.position.y = 0.4;

    if (mode === "react") {
      scene.add(orbHalo, orb);
    } else {
      scene.add(furnaceHalo, furnace, embers, track, band, marker);
    }

    const onPointerDown = () => void actRef.current();
    renderer.domElement.addEventListener("pointerdown", onPointerDown);

    const resize = () => {
      const w = container.clientWidth || 1;
      const h = container.clientHeight || 240;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);

    const distanceToBand = (pos: number, from: number, to: number) => {
      if (pos >= from && pos <= to) return 0;
      const gap = pos < from ? from - pos : pos - to;
      const worst = Math.max(from, 1 - to, 0.0001);
      return Math.min(gap / worst, 1);
    };

    let raf = 0;
    let t = 0;
    // Reusable color temps so the per-frame lerps don't allocate.
    const tmpColor = new THREE.Color();
    const coldColor = new THREE.Color(0x2a1a0e);
    const hotColor = new THREE.Color(0xf59e0b);
    const frame = () => {
      t += 0.016;
      const v = viewRef.current;

      if (v.mode === "react") {
        // STEADY = cool + slow pulse; GO = gold flare + scale pop; result tints.
        const go = v.phase === "go";
        const falseStart = v.phase === "result" && v.result?.falseStart;
        const goodHit =
          v.phase === "result" && v.result?.kind === "reaction" && !v.result.falseStart;
        const targetColor = falseStart ? 0xb91c1c : go ? 0xf5c451 : goodHit ? 0xd4a017 : 0x3b4252;
        orbMat.color.lerp(tmpColor.setHex(targetColor), 0.25);
        const pulse = animate ? 1 + Math.sin(t * 6) * (go ? 0.12 : 0.04) : 1;
        orb.scale.setScalar((go ? 1.35 : 1.1) * pulse);
        orbHaloMat.opacity += ((go ? 0.5 : 0.0) - orbHaloMat.opacity) * 0.2;
        orbHalo.scale.setScalar(orb.scale.x * 1.4);
      } else {
        const sw = v.sweep;
        const pos = v.markerPos;
        const heat = sw ? 1 - distanceToBand(pos, sw.bandFrom, sw.bandTo) : 0;
        // Furnace heats: glow halo + brighten body with heat.
        furnaceMat.color.lerp(tmpColor.copy(coldColor).lerp(hotColor, heat), 0.2);
        furnaceHaloMat.opacity += (heat * 0.6 - furnaceHaloMat.opacity) * 0.2;
        furnaceHalo.scale.setScalar(1.9 + heat * 0.6);
        emberMat.opacity += ((v.phase === "sweeping" ? heat * 0.9 : 0) - emberMat.opacity) * 0.15;
        if (animate) {
          const arr = emberGeo.getAttribute("position") as THREE.BufferAttribute;
          for (let i = 0; i < EMBERS; i++) {
            let y = arr.getY(i) + emberVel[i]! * (0.5 + heat);
            if (y > 2.4) y = -0.5;
            arr.setY(i, y);
          }
          arr.needsUpdate = true;
        }
        // Gauge: marker slides; band segment sits at the optimal zone.
        const toX = (p: number) => (p - 0.5) * GAUGE_W;
        marker.position.x = toX(pos);
        const inBand = sw ? pos >= sw.bandFrom && pos <= sw.bandTo : false;
        markerMat.color.lerp(tmpColor.setHex(inBand ? 0x86efac : 0xffffff), 0.3);
        if (sw) {
          const bw = Math.max(0.2, (sw.bandTo - sw.bandFrom) * GAUGE_W);
          band.scale.x = bw;
          band.position.x = toX((sw.bandFrom + sw.bandTo) / 2);
          band.visible = true;
        } else {
          band.visible = false;
        }
      }

      renderer.render(scene, camera);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      sphereGeo.dispose();
      furnaceGeo.dispose();
      orbMat.dispose();
      orbHaloMat.dispose();
      furnaceMat.dispose();
      furnaceHaloMat.dispose();
      trackMat.dispose();
      bandMat.dispose();
      markerMat.dispose();
      track.geometry.dispose();
      band.geometry.dispose();
      marker.geometry.dispose();
      emberGeo.dispose();
      emberMat.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [mode]);

  if (error) {
    return (
      <div className="card text-center text-sm text-red-400">
        {error} — close this and try again.
      </div>
    );
  }

  const completed = phase === "done" ? rounds : round - 1;
  const tag =
    phase === "result" && result
      ? mode === "react"
        ? result.falseStart
          ? { label: "TOO SOON — round lost", tone: "text-red-400" }
          : reactionTag(result.reactionMs ?? 999)
        : precisionTag(result.fraction ?? 0)
      : null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wider text-text-muted">
          Round {Math.min(round, rounds)} / {rounds}
        </span>
        <div className="flex gap-1.5">
          {Array.from({ length: rounds }, (_, i) => (
            <span
              key={i}
              className={`h-2 w-2 rounded-full ${
                i < completed
                  ? "bg-gold-400"
                  : i === completed
                    ? "bg-gold-400/40 ring-1 ring-gold-400"
                    : "bg-border-default"
              }`}
            />
          ))}
        </div>
      </div>
      <p className="text-xs text-text-muted">{instruction}</p>

      <div ref={containerRef} className="relative h-64 w-full touch-none">
        {/* DOM readouts over the 3D arena. */}
        <div className="pointer-events-none absolute inset-x-0 top-2 text-center">
          {phase === "waiting" && (
            <span className="animate-pulse font-display text-2xl font-bold tracking-[0.3em] text-text-gold">
              STEADY
            </span>
          )}
          {phase === "go" && mode === "react" && (
            <span className="font-mono text-sm tabular-nums text-text-gold">
              {Math.round(reactionMs)} ms
            </span>
          )}
          {phase === "sweeping" && (
            <span className="font-display text-sm font-semibold tracking-wider text-text-gold">
              {sweep && markerPos >= sweep.bandFrom && markerPos <= sweep.bandTo
                ? "RELEASE — NOW"
                : "RELEASE"}
            </span>
          )}
        </div>
        {phase === "result" && tag && (
          <div className="pointer-events-none absolute inset-x-0 bottom-2 text-center">
            {mode === "react" && result?.kind === "reaction" && !result.falseStart && (
              <span className="font-display text-3xl font-black tabular-nums text-text-gold">
                {result.reactionMs}
                <span className="ml-1 text-lg text-text-muted">ms</span>
              </span>
            )}
            <div className={`text-sm font-semibold ${tag.tone}`}>{tag.label}</div>
          </div>
        )}
      </div>

      <p className="text-center text-[11px] text-text-muted">tap the arena or press Space</p>
    </div>
  );
}
