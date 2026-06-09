"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { playSfx } from "@/lib/audio/sfx";
import type { MoveResponse } from "@/lib/hooks/useDailyActivity";
import { prefersReducedMotion } from "@/lib/utils";
import { useFx } from "../GameStage";
import { GameHeader, GameTimer, ResultBadge, celebrate, tierFromMemoryMoves } from "./_shell";
import { srgbTexture, tileTexture } from "./stage3d";

// 3D rewrite of the Memory game (Treasury "Ledger Audit"). The board lives in a
// three.js scene — cards are textured planes the player taps to flip; the game
// logic (each flip is a server `/move`, the server returns that tile's face)
// and the 0-100 scoring are unchanged from the DOM version, so grading and the
// MultiMove contract are identical. React owns the game state; the three.js
// layer is a view driven from refs each frame, and raycast picks feed taps back
// into React.

export interface MemoryPresentation {
  tiles: number;
  pairs: number;
}

interface MemoryMoveResult {
  flipped: number;
  face: number;
  outcome: "first" | "match" | "mismatch";
  pair?: [number, number];
  matched: number[];
  moves: number;
}

interface MemoryGame3DProps {
  presentation: MemoryPresentation;
  submitting: boolean;
  sendMove: (move: unknown) => Promise<MoveResponse>;
  onComplete: () => void;
}

// Bonsai-generated treasury icons (coin, ruby, scroll, key, seal, ingots,
// emerald, chest) are the card faces; the index is the server's `face` value.
// Antique-gold "◇" facedown back.
const FACE_COUNT = 8;
const FACEDOWN_BG = "#171310";
const FACEDOWN_BORDER = "#4a3a22";
const FACEDOWN_MARK = "#6b5836";

const MS_PER_PAIR = 3_000;
const SUMMARY_BEAT_MS = 1_800;

const CARD = 1; // card edge in world units
const GAP = 0.18;

// A single-glyph card face via the shared tile-texture helper.
function glyphTexture(glyph: string, hex: string, bg: string, border: string): THREE.CanvasTexture {
  return tileTexture({
    w: 128,
    h: 128,
    bg,
    border,
    borderW: 7,
    lines: [{ text: glyph, y: 72, size: 72, color: hex, weight: "normal" }],
  });
}

interface Card {
  group: THREE.Group;
  backMat: THREE.MeshBasicMaterial; // the symbol face (revealed)
  rot: number; // current flip rotation (rad)
  shownFace: number | null; // face index currently textured on the back
  pulse: number; // match pulse timer (s, counts down)
  shake: number; // mismatch shake timer (s, counts down)
}

export default function MemoryGame3D({
  presentation,
  submitting,
  sendMove,
  onComplete,
}: MemoryGame3DProps) {
  const { tiles, pairs } = presentation;
  const fx = useFx();

  // Game state (mirrors the DOM MemoryGame).
  const [revealed, setRevealed] = useState<Record<number, number>>({});
  const [matched, setMatched] = useState<Set<number>>(() => new Set());
  const [faceUp, setFaceUp] = useState<number | null>(null);
  const [moves, setMoves] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<{ moves: number; pairs: number } | null>(null);
  const [pulse, setPulse] = useState<number[] | null>(null);
  const [mismatch, setMismatch] = useState<number[] | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const summaryCardRef = useRef<HTMLDivElement>(null);
  const summaryNumRef = useRef<HTMLSpanElement>(null);

  // Refs the three.js loop / raycast read so the scene isn't rebuilt per state
  // change (cards built once; the loop syncs visuals from `viewRef`).
  const cardsRef = useRef<Card[]>([]);
  const viewRef = useRef({
    revealed: {} as Record<number, number>,
    matched: new Set<number>(),
    pulse: null as number[] | null,
    mismatch: null as number[] | null,
    submitting: false,
  });
  const flipRef = useRef<(i: number) => void>(() => {});

  const matchedPairs = matched.size / 2;
  const cols = tiles <= 12 ? 4 : 6;
  const rows = Math.ceil(tiles / cols);

  const timersRef = useRef<Set<number>>(new Set());
  useEffect(
    () => () => {
      for (const id of timersRef.current) clearTimeout(id);
      timersRef.current.clear();
    },
    [],
  );
  const trackedTimeout = useCallback((fn: () => void, ms: number) => {
    const id = window.setTimeout(() => {
      timersRef.current.delete(id);
      fn();
    }, ms);
    timersRef.current.add(id);
  }, []);

  const flip = useCallback(
    async (i: number) => {
      if (busy || submitting || matched.has(i) || i === faceUp || revealed[i] !== undefined) return;
      setBusy(true);
      setError(null);
      try {
        const { result, done } = await sendMove({ flip: i });
        const r = result as MemoryMoveResult;
        setMoves(r.moves);
        setRevealed((prev) => ({ ...prev, [r.flipped]: r.face }));
        playSfx("flip");

        if (r.outcome === "first") {
          setFaceUp(r.flipped);
          setBusy(false);
        } else if (r.outcome === "match") {
          setMatched((prev) => new Set([...prev, ...r.matched]));
          setFaceUp(null);
          const pulsePair = r.pair ?? [r.flipped];
          setPulse(pulsePair);
          trackedTimeout(() => setPulse(null), 450);
          setBusy(false);
          playSfx("match");
          fx.shake(0.7);
          if (done) {
            setSummary({ moves: r.moves, pairs });
            trackedTimeout(onComplete, SUMMARY_BEAT_MS);
            playSfx("win");
            fx.confetti();
          }
        } else {
          const pair = r.pair ?? [r.flipped];
          setMismatch(pair);
          playSfx("wrong");
          trackedTimeout(() => {
            setRevealed((prev) => {
              const next = { ...prev };
              for (const t of pair) delete next[t];
              return next;
            });
            setMismatch(null);
            setFaceUp(null);
            setBusy(false);
          }, 900);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "move failed");
        setBusy(false);
      }
    },
    [busy, submitting, matched, faceUp, revealed, sendMove, onComplete, pairs, trackedTimeout, fx],
  );

  // Keep the refs the imperative scene reads current.
  flipRef.current = flip;
  viewRef.current = { revealed, matched, pulse, mismatch, submitting };

  // Build the three.js board once (rebuilt only if the tile count changes).
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const animate = !prefersReducedMotion();

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setClearColor(0x000000, 0);
    container.appendChild(renderer.domElement);
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.display = "block";
    renderer.domElement.style.touchAction = "manipulation";

    // Board tilted slightly back for a 3D-table read.
    const board = new THREE.Group();
    board.rotation.x = -0.32;
    scene.add(board);

    // Pre-build the 8 symbol textures + the shared facedown texture.
    const loader = new THREE.TextureLoader();
    const faceTex = Array.from({ length: FACE_COUNT }, (_, i) =>
      srgbTexture(loader.load(`/minigame/ledger/icon-${i}.png`)),
    );
    const facedownTex = glyphTexture("◇", FACEDOWN_MARK, FACEDOWN_BG, FACEDOWN_BORDER);

    const plane = new THREE.PlaneGeometry(CARD, CARD);
    const cards: Card[] = [];

    const gridW = cols * CARD + (cols - 1) * GAP;
    const gridH = rows * CARD + (rows - 1) * GAP;

    for (let i = 0; i < tiles; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = -gridW / 2 + CARD / 2 + col * (CARD + GAP);
      const y = gridH / 2 - CARD / 2 - row * (CARD + GAP);

      const group = new THREE.Group();
      group.position.set(x, y, 0);

      // Facedown face — visible at rot 0 (faces +Z).
      const frontMat = new THREE.MeshBasicMaterial({ map: facedownTex });
      const front = new THREE.Mesh(plane, frontMat);
      front.position.z = 0.02;
      group.add(front);

      // Symbol face — faces -Z, so it shows the camera once the card flips PI.
      const backMat = new THREE.MeshBasicMaterial({ map: facedownTex });
      const back = new THREE.Mesh(plane, backMat);
      back.position.z = -0.02;
      back.rotation.y = Math.PI;
      group.add(back);

      board.add(group);
      cards.push({ group, backMat, rot: 0, shownFace: null, pulse: 0, shake: 0 });
    }
    cardsRef.current = cards;

    // Frame the grid: pull the camera back to fit the larger board dimension.
    const fitH = Math.max(gridW / camera.aspect, gridH) * 1.18;
    const dist = fitH / 2 / Math.tan((camera.fov * Math.PI) / 360) + 1.2;
    camera.position.set(0, -0.4, dist);
    camera.lookAt(0, 0, 0);

    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();

    const onPointerDown = (ev: PointerEvent) => {
      if (viewRef.current.submitting) return;
      const rect = renderer.domElement.getBoundingClientRect();
      ndc.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      ndc.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(ndc, camera);
      const hits = raycaster.intersectObjects(board.children, true);
      if (hits.length === 0) return;
      // Walk up to the card group to find its index.
      let obj: THREE.Object3D | null = hits[0]!.object;
      while (obj && obj.parent !== board) obj = obj.parent;
      if (!obj) return;
      const idx = board.children.indexOf(obj);
      if (idx >= 0) flipRef.current(idx);
    };
    renderer.domElement.addEventListener("pointerdown", onPointerDown);

    const resize = () => {
      const w = container.clientWidth || 1;
      const h = container.clientHeight || 320;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);

    let raf = 0;
    // Previous-frame pulse/mismatch arrays for edge detection (small arrays, so
    // `includes` beats rebuilding a Set per card per frame).
    let prevPulse: number[] = [];
    let prevMismatch: number[] = [];

    const frame = () => {
      const v = viewRef.current;
      const pulseArr = v.pulse ?? [];
      const mismatchArr = v.mismatch ?? [];
      for (let i = 0; i < cards.length; i++) {
        const card = cards[i]!;
        const isUp = v.matched.has(i) || v.revealed[i] !== undefined;

        // Assign the revealed symbol texture on the face that's about to show.
        const face = v.revealed[i];
        if (isUp && face !== undefined && card.shownFace !== face) {
          card.backMat.map = faceTex[face % faceTex.length]!;
          card.backMat.needsUpdate = true;
          card.shownFace = face;
        }
        if (!isUp && card.shownFace !== null) {
          card.backMat.map = facedownTex;
          card.backMat.needsUpdate = true;
          card.shownFace = null;
        }

        // Flip toward the target rotation (snap when reduced motion).
        const target = isUp ? Math.PI : 0;
        card.rot = animate ? card.rot + (target - card.rot) * 0.22 : target;
        card.group.rotation.y = card.rot;

        // Match pulse + mismatch shake, edge-detected from the view refs.
        if (pulseArr.includes(i) && !prevPulse.includes(i)) card.pulse = 0.45;
        if (mismatchArr.includes(i) && !prevMismatch.includes(i)) card.shake = 0.4;

        let scale = 1;
        if (card.pulse > 0) {
          card.pulse = Math.max(0, card.pulse - 0.016);
          scale = 1 + Math.sin((1 - card.pulse / 0.45) * Math.PI) * 0.18;
        }
        card.group.scale.setScalar(scale);
        if (card.shake > 0) {
          card.shake = Math.max(0, card.shake - 0.016);
          card.group.rotation.z = Math.sin(card.shake * 60) * 0.12 * (card.shake / 0.4);
        } else {
          card.group.rotation.z = 0;
        }

        // Matched cards glow a touch brighter.
        const lit = v.matched.has(i);
        card.backMat.color.setScalar(lit ? 1.15 : 1);
      }
      prevPulse = pulseArr;
      prevMismatch = mismatchArr;

      // Subtle parallax breathing so the board feels alive (skipped if reduced).
      if (animate) board.rotation.y = Math.sin(Date.now() * 0.0004) * 0.05;

      renderer.render(scene, camera);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      plane.dispose();
      for (const c of cards) c.backMat.dispose();
      for (const t of faceTex) t.dispose();
      facedownTex.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
    // Rebuild only when the board shape changes.
  }, [tiles, cols, rows]);

  // Summary slot-roll (DOM overlay), same as the 2D version.
  useEffect(() => {
    if (!summary) return;
    const card = summaryCardRef.current;
    const number = summaryNumRef.current;
    if (!card || !number) return;
    return celebrate({
      card,
      number,
      score: summary.moves,
      format: (v) => `${v} flips`,
      onTick: () => {},
    });
  }, [summary]);

  const summaryTier = summary ? tierFromMemoryMoves(summary.moves, summary.pairs) : null;

  return (
    <div className="space-y-3">
      <GameHeader
        current={summary ? pairs + 1 : Math.min(matchedPairs + 1, pairs)}
        total={pairs}
        noun="Pair"
        trailing={
          <span className="font-mono text-[10px] tabular-nums text-text-muted">{moves} flips</span>
        }
      />
      <GameTimer totalMs={MS_PER_PAIR * pairs} paused={submitting || !!summary} />

      <div ref={containerRef} className="h-72 w-full touch-none sm:h-80" />

      {summary && summaryTier ? (
        <div ref={summaryCardRef} className="card accent-border text-center">
          <div className="text-xs uppercase tracking-wider text-text-muted">Ledger reconciled</div>
          <div className="mt-2 font-display text-3xl font-bold tabular-nums text-text-gold">
            <span ref={summaryNumRef} className="inline-block">
              0 flips
            </span>
          </div>
          <div className="mt-2 flex justify-center">
            <ResultBadge tier={summaryTier} />
          </div>
          <p className="mt-2 text-[11px] text-text-muted">
            Optimal pace is {summary.pairs * 2} flips · you closed in {summary.moves}.
          </p>
        </div>
      ) : (
        <div className="flex items-center justify-between text-xs tabular-nums text-text-muted">
          <span>
            {matchedPairs} / {pairs} pairs matched
          </span>
          {error && <span className="text-red-400">{error}</span>}
        </div>
      )}
    </div>
  );
}
