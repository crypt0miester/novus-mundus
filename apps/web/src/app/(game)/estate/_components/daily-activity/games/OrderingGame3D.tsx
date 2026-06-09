"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { playSfx } from "@/lib/audio/sfx";
import { useFx } from "../GameStage";
import { GameFooter, GameHeader, GameTimer, useFireOnce } from "./_shell";
import { createStage3D, srgbTexture, tileTexture } from "./stage3d";

export interface OrderingPresentation {
  instruction: string;
  metricLabel: string;
  items: { label: string; metric: number }[];
}

interface OrderingGame3DProps {
  presentation: OrderingPresentation;
  submitting: boolean;
  onSubmit: (answer: number[]) => void;
}

const MS_PER_ITEM = 6_000;

const COLOR_GOLD = new THREE.Color(0xf0c66b);
const COLOR_IDLE = new THREE.Color(0x4a607f);

// Deterministic GLSL-style hash for stable node scatter.
function hash(n: number): number {
  const s = Math.sin(n * 91.37) * 47453.13;
  return s - Math.floor(s);
}

/** A small numbered badge (gold disc) for a node's place in the route. */
function numberTexture(n: number): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 64;
  const g = c.getContext("2d");
  if (g) {
    g.fillStyle = "#1a1408";
    g.beginPath();
    g.arc(32, 32, 28, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = "#f0c66b";
    g.lineWidth = 4;
    g.stroke();
    g.fillStyle = "#f0c66b";
    g.font = "bold 34px system-ui, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(String(n), 32, 35);
  }
  return srgbTexture(new THREE.CanvasTexture(c));
}

/**
 * 3D rewrite of Ordering as route planning: nodes are scattered on a map and
 * the player taps them in travel order — a glowing line draws the route and
 * each visited node gets its place number. Tap a placed node to rewind the
 * route to before it. The answer is the visit-order permutation (untapped
 * nodes are appended in their original order on submit), so grading is
 * unchanged from the DOM version.
 */
export default function OrderingGame3D({ presentation, submitting, onSubmit }: OrderingGame3DProps) {
  const { instruction, metricLabel, items } = presentation;
  const fx = useFx();
  const [sequence, setSequence] = useState<number[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);

  const fullOrder = () => {
    const rest = items.map((_, i) => i).filter((i) => !sequence.includes(i));
    return [...sequence, ...rest];
  };
  const fireSubmit = useFireOnce(() => {
    playSfx("select");
    onSubmit(fullOrder());
  });

  const reset = () => {
    setSequence([]);
    playSfx("flip");
  };

  const seqRef = useRef<number[]>([]);
  seqRef.current = sequence;
  const submittingRef = useRef(submitting);
  submittingRef.current = submitting;
  const tapRef = useRef<(i: number, x: number, y: number) => void>(() => {});
  tapRef.current = (i, clientX, clientY) => {
    const seq = [...seqRef.current];
    const pos = seq.indexOf(i);
    if (pos === -1) {
      seq.push(i);
      playSfx("select");
      fx.burst(clientX, clientY, { count: 8 });
    } else {
      seq.splice(pos); // rewind the route to before this node
      playSfx("flip");
    }
    setSequence(seq);
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const n = items.length;
    const stage = createStage3D(container, { fov: 45, camY: 4.6, camZ: 6.2 });
    const root = new THREE.Group();
    stage.scene.add(root);

    // Faint ground plane for "map" grounding.
    const groundMat = new THREE.MeshBasicMaterial({
      color: 0x10141d,
      transparent: true,
      opacity: 0.55,
    });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(12, 12), groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.02;
    root.add(ground);

    const sphereGeo = new THREE.SphereGeometry(1, 24, 24);
    const labelGeo = new THREE.PlaneGeometry(1.7, 0.78);
    const badgeGeo = new THREE.PlaneGeometry(0.5, 0.5);

    const numberTex = Array.from({ length: n }, (_, i) => numberTexture(i + 1));

    // Scatter nodes on a jittered grid over the ground (XZ plane).
    const cols = Math.ceil(Math.sqrt(n));
    const spread = 3.6;
    interface Node {
      pos: THREE.Vector3;
      orb: THREE.Mesh;
      orbMat: THREE.MeshBasicMaterial;
      glow: THREE.MeshBasicMaterial;
      label: THREE.Mesh;
      labelTex: THREE.CanvasTexture;
      badge: THREE.Mesh;
      badgeMat: THREE.MeshBasicMaterial;
    }
    const nodes: Node[] = [];

    items.forEach((it, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const rowsTotal = Math.ceil(n / cols);
      const jx = (hash(i * 1.7 + 1) - 0.5) * 1.1;
      const jz = (hash(i * 2.9 + 3) - 0.5) * 1.1;
      const x = (col - (cols - 1) / 2) * spread + jx;
      const z = (row - (rowsTotal - 1) / 2) * spread + jz;
      const pos = new THREE.Vector3(x, 0.45, z);

      const group = new THREE.Group();
      group.position.copy(pos);
      group.userData = { index: i };

      const orbMat = new THREE.MeshBasicMaterial({ color: 0x4a607f });
      const orb = new THREE.Mesh(sphereGeo, orbMat);
      orb.scale.setScalar(0.3);
      group.add(orb);

      const glow = new THREE.MeshBasicMaterial({
        color: 0xf0c66b,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const glowMesh = new THREE.Mesh(sphereGeo, glow);
      glowMesh.scale.setScalar(0.5);
      group.add(glowMesh);

      const labelTex = tileTexture({
        w: 240,
        h: 110,
        bg: "#161b29",
        border: "#3b4252",
        lines: [
          { text: it.label, y: 42, size: 26, color: "#e5e7eb", weight: "700" },
          { text: `${metricLabel} ${it.metric}`, y: 82, size: 24, color: "#cbd5e1" },
        ],
      });
      const labelMat = new THREE.MeshBasicMaterial({ map: labelTex, transparent: true });
      const label = new THREE.Mesh(labelGeo, labelMat);
      label.position.y = 1.0;
      group.add(label);

      const badgeMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
      const badge = new THREE.Mesh(badgeGeo, badgeMat);
      badge.position.set(0, 0.55, 0.01);
      group.add(badge);

      root.add(group);
      nodes.push({ pos, orb, orbMat, glow, label, labelTex, badge, badgeMat });
    });

    // Glowing route polyline (positions refilled each frame from the sequence).
    const linePos = new Float32Array(Math.max(2, n) * 3);
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute("position", new THREE.BufferAttribute(linePos, 3));
    const lineMat = new THREE.LineBasicMaterial({
      color: 0xf0c66b,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
    });
    const routeLine = new THREE.Line(lineGeo, lineMat);
    root.add(routeLine);

    const onPointerDown = (ev: PointerEvent) => {
      if (submittingRef.current) return;
      const obj = stage.pickTop(ev, root);
      if (!obj) return;
      const idx = (obj.userData as { index?: number }).index;
      if (idx !== undefined) tapRef.current(idx, ev.clientX, ev.clientY);
    };
    stage.renderer.domElement.addEventListener("pointerdown", onPointerDown);

    const lineAttr = lineGeo.getAttribute("position") as THREE.BufferAttribute;

    // The camera is static, so billboard the labels + badges toward it once.
    for (const node of nodes) {
      node.label.quaternion.copy(stage.camera.quaternion);
      node.badge.quaternion.copy(stage.camera.quaternion);
    }

    // Reused node-index → place-in-route lookup (-1 = unvisited), refilled each
    // frame so the node loop doesn't `indexOf` per node (O(n²) → O(n)).
    const placeOf = new Array<number>(nodes.length).fill(-1);
    let prevLen = -1;

    stage.start(() => {
      const seq = seqRef.current;
      placeOf.fill(-1);
      for (let k = 0; k < seq.length; k++) placeOf[seq[k]!] = k;

      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i]!;
        const place = placeOf[i]!;
        const visited = place >= 0;
        node.orbMat.color.lerp(visited ? COLOR_GOLD : COLOR_IDLE, 0.2);
        node.glow.opacity += ((visited ? 0.7 : 0) - node.glow.opacity) * 0.2;
        node.badgeMat.opacity += ((visited ? 1 : 0) - node.badgeMat.opacity) * 0.25;
        if (visited && node.badgeMat.map !== numberTex[place]) {
          node.badgeMat.map = numberTex[place]!;
          node.badgeMat.needsUpdate = true;
        }
      }

      // The route line only changes when the sequence does — and every tap
      // changes its length (add or rewind), so a length check catches it.
      if (seq.length !== prevLen) {
        for (let k = 0; k < seq.length; k++) {
          const p = nodes[seq[k]!]!.pos;
          lineAttr.setXYZ(k, p.x, p.y, p.z);
        }
        lineGeo.setDrawRange(0, seq.length);
        lineAttr.needsUpdate = true;
        lineMat.opacity = seq.length >= 2 ? 0.9 : 0;
        prevLen = seq.length;
      }
    });

    return () => {
      stage.renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      sphereGeo.dispose();
      labelGeo.dispose();
      badgeGeo.dispose();
      ground.geometry.dispose();
      groundMat.dispose();
      lineGeo.dispose();
      lineMat.dispose();
      for (const t of numberTex) t.dispose();
      for (const node of nodes) {
        node.orbMat.dispose();
        node.glow.dispose();
        (node.label.material as THREE.Material).dispose();
        node.labelTex.dispose();
        node.badgeMat.dispose();
      }
      stage.dispose();
    };
  }, [items, metricLabel]);

  return (
    <div className="space-y-3">
      <GameHeader current={sequence.length} total={items.length} noun="Stop" pips={false} />
      <GameTimer totalMs={MS_PER_ITEM * items.length} paused={submitting} onExpire={fireSubmit} />
      <p className="text-sm text-text-secondary">{instruction}</p>
      <p className="text-center text-[11px] text-text-muted">
        tap the stops in order · tap a placed stop to rewind
      </p>
      <div ref={containerRef} className="h-72 w-full touch-none sm:h-80" />
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          disabled={submitting || sequence.length === 0}
          onClick={reset}
          className="rounded-lg border border-border-default px-3 py-1.5 text-xs text-text-secondary transition-colors hover:border-border-gold/50 disabled:opacity-40"
        >
          Reset route
        </button>
        <span className="text-[11px] tabular-nums text-text-muted">
          {sequence.length} / {items.length} placed
        </span>
      </div>
      <GameFooter submitLabel="Submit route" submitting={submitting} onSubmit={fireSubmit} />
    </div>
  );
}
