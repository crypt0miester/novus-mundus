"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { playSfx } from "@/lib/audio/sfx";
import { useFx } from "../GameStage";
import { GameFooter, GameHeader, GameTimer, useFireOnce, useIndexedSelection } from "./_shell";
import { createStage3D, tileTexture } from "./stage3d";

export interface AssignmentPresentation {
  instruction: string;
  valueLabel: string;
  bins: { label: string; from: number; to: number }[];
  items: { label: string; value: number }[];
}

interface AssignmentGame3DProps {
  presentation: AssignmentPresentation;
  submitting: boolean;
  onSubmit: (answer: number[]) => void;
}

const MS_PER_ITEM = 4_000;
const BIN_HEX = ["#7dd3fc", "#fcd34d", "#fda4af", "#86efac", "#c4b5fd"];

/**
 * 3D rewrite of Assignment. Items sit in a tray; tap an item to pick it up,
 * then tap a bin and it flies into that bin's slot. The answer (a bin index
 * per item) is unchanged, so grading is identical.
 */
export default function AssignmentGame3D({ presentation, submitting, onSubmit }: AssignmentGame3DProps) {
  const { instruction, valueLabel, bins, items } = presentation;
  const fx = useFx();
  const [assigned, setAssignedAt] = useIndexedSelection<number | null>(() => items.map(() => null));
  const selectedRef = useRef<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const sorted = assigned.filter((a) => a !== null).length;
  const allSorted = sorted === items.length;
  const fireSubmit = useFireOnce(() => {
    playSfx("select");
    onSubmit(assigned.map((a) => a ?? -1));
  });

  const viewRef = useRef({ assigned, submitting });
  viewRef.current = { assigned, submitting };
  const tapRef = useRef<(kind: string, idx: number, x: number, y: number) => void>(() => {});
  tapRef.current = (kind, idx, clientX, clientY) => {
    if (kind === "item") {
      selectedRef.current = idx;
      playSfx("flip");
    } else if (kind === "bin") {
      const sel = selectedRef.current;
      if (sel === null) return;
      setAssignedAt(sel, idx);
      selectedRef.current = null;
      playSfx("select");
      fx.burst(clientX, clientY, { count: 10, color: BIN_HEX[idx % BIN_HEX.length] });
    }
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const stage = createStage3D(container, { fov: 44 });
    const root = new THREE.Group();
    stage.scene.add(root);

    const nb = bins.length;
    const BIN_W = Math.min(2.0, 6.4 / nb);
    const binGeo = new THREE.PlaneGeometry(BIN_W, 0.8);
    const binGlowGeo = new THREE.PlaneGeometry(BIN_W + 0.18, 0.98);
    const binSpan = nb * BIN_W + (nb - 1) * 0.3;
    const binMeshes: { x: number; glow: THREE.MeshBasicMaterial }[] = [];

    bins.forEach((b, i) => {
      const x = -binSpan / 2 + BIN_W / 2 + i * (BIN_W + 0.3);
      const hex = BIN_HEX[i % BIN_HEX.length]!;
      const tex = tileTexture({
        w: 256,
        h: 110,
        bg: "#10151f",
        border: hex,
        lines: [
          { text: b.label, y: 40, size: 28, color: hex, weight: "700" },
          { text: `${b.from}–${b.to}`, y: 78, size: 22, color: "#9ca3af" },
        ],
      });
      const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true });
      const mesh = new THREE.Mesh(binGeo, mat);
      const glow = new THREE.MeshBasicMaterial({
        color: new THREE.Color(hex),
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const glowMesh = new THREE.Mesh(binGlowGeo, glow);
      glowMesh.position.z = -0.05;
      const g = new THREE.Group();
      g.position.set(x, -2.0, 0);
      g.userData = { kind: "bin", index: i };
      g.add(glowMesh, mesh);
      root.add(g);
      binMeshes.push({ x, glow });
    });

    // Item tray (top), wrapping rows.
    const ni = items.length;
    const trayCols = Math.min(ni, 4);
    const ITEM_W = 1.4;
    const traySpan = trayCols * ITEM_W + (trayCols - 1) * 0.25;
    const itemGeo = new THREE.PlaneGeometry(ITEM_W, 0.85);
    const itemGlowGeo = new THREE.PlaneGeometry(ITEM_W + 0.16, 1.0);
    const itemObjs: {
      group: THREE.Group;
      home: THREE.Vector3;
      glow: THREE.MeshBasicMaterial;
      mat: THREE.MeshBasicMaterial;
      tex: THREE.CanvasTexture;
    }[] = [];

    items.forEach((it, i) => {
      const col = i % trayCols;
      const row = Math.floor(i / trayCols);
      const x = -traySpan / 2 + ITEM_W / 2 + col * (ITEM_W + 0.25);
      const y = 2.3 - row * 1.0;
      const tex = tileTexture({
        w: 224,
        h: 136,
        bg: "#1a2030",
        border: "#3b4252",
        lines: [
          { text: it.label, y: 52, size: 28, color: "#e5e7eb", weight: "700" },
          { text: `${valueLabel} ${it.value}`, y: 100, size: 24, color: "#cbd5e1" },
        ],
      });
      const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true });
      const tile = new THREE.Mesh(itemGeo, mat);
      const glow = new THREE.MeshBasicMaterial({
        color: 0xf0c66b,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const glowMesh = new THREE.Mesh(itemGlowGeo, glow);
      glowMesh.position.z = -0.05;
      const group = new THREE.Group();
      const home = new THREE.Vector3(x, y, 0);
      group.position.copy(home);
      group.userData = { kind: "item", index: i };
      group.add(glowMesh, tile);
      root.add(group);
      itemObjs.push({ group, home, glow, mat, tex });
    });

    stage.camera.position.set(0, -0.1, 8.4);
    stage.camera.lookAt(0, 0, 0);

    const onPointerDown = (ev: PointerEvent) => {
      if (viewRef.current.submitting) return;
      const obj = stage.pickTop(ev, root);
      if (!obj) return;
      const { kind, index } = obj.userData as { kind?: string; index?: number };
      if (kind && index !== undefined) tapRef.current(kind, index, ev.clientX, ev.clientY);
    };
    stage.renderer.domElement.addEventListener("pointerdown", onPointerDown);

    const tmpTarget = new THREE.Vector3(); // reused each frame — no per-item alloc
    stage.start(() => {
      const v = viewRef.current;
      const sel = selectedRef.current;
      const hot = sel !== null;
      for (const b of binMeshes) b.glow.opacity += ((hot ? 0.5 : 0) - b.glow.opacity) * 0.15;

      for (let i = 0; i < itemObjs.length; i++) {
        const it = itemObjs[i]!;
        const bin = v.assigned[i];
        const target =
          bin !== null && bin !== undefined
            ? tmpTarget.set(
                (binMeshes[bin]?.x ?? 0) + ((i % 3) - 1) * 0.14,
                -1.1 + Math.floor(i / 3) * 0.06,
                0.3,
              )
            : it.home;
        it.group.position.lerp(target, 0.18);
        const isSel = sel === i;
        it.glow.opacity += ((isSel ? 0.7 : 0) - it.glow.opacity) * 0.2;
        const s = isSel ? 1.08 : bin !== null && bin !== undefined ? 0.8 : 1;
        it.group.scale.x += (s - it.group.scale.x) * 0.2;
        it.group.scale.y = it.group.scale.x;
      }
    });

    return () => {
      stage.renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      binGeo.dispose();
      binGlowGeo.dispose();
      itemGeo.dispose();
      itemGlowGeo.dispose();
      for (const b of binMeshes) b.glow.dispose();
      for (const it of itemObjs) {
        it.mat.dispose();
        it.glow.dispose();
        it.tex.dispose();
      }
      stage.dispose();
    };
  }, [items, bins, valueLabel]);

  return (
    <div className="space-y-3">
      <GameHeader current={Math.min(sorted + 1, items.length)} total={items.length} noun="Sort" />
      <GameTimer totalMs={MS_PER_ITEM * items.length} paused={submitting} onExpire={fireSubmit} />
      <p className="text-sm text-text-secondary">{instruction}</p>
      <div ref={containerRef} className="h-80 w-full touch-none sm:h-96" />
      <GameFooter
        progress={{ done: sorted, total: items.length, noun: "sorted" }}
        submitLabel={allSorted ? "Submit roll" : "Submit"}
        submitting={submitting}
        disabled={false}
        onSubmit={fireSubmit}
      />
    </div>
  );
}
