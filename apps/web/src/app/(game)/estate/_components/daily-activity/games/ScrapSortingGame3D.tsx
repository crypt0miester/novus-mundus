"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { playSfx } from "@/lib/audio/sfx";
import { useFx } from "../GameStage";
import type { AssignmentPresentation } from "./AssignmentGame";
import { GameFooter, GameHeader, GameTimer, useFireOnce, useIndexedSelection } from "./_shell";
import { createStage3D, roundRect, srgbTexture, tileTexture } from "./stage3d";

interface ScrapSortingGame3DProps {
  presentation: AssignmentPresentation;
  submitting: boolean;
  onSubmit: (answer: number[]) => void;
}

const MS_PER_ITEM = 4_000;

const scrapUrl = (label: string) =>
  `/minigame/scrap/${label.toLowerCase().replace(/\s+/g, "-")}.png`;

/**
 * A grimy steel salvage tag: the scrap image in a riveted window with a stamped
 * purity reading. Deliberately industrial — no gold frame — so Workshop reads
 * nothing like the Market goods card. The image loads async and pops in.
 */
function scrapTagTexture(imageUrl: string, valueLabel: string, value: number): THREE.CanvasTexture {
  const W = 256;
  const H = 300;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const tex = srgbTexture(new THREE.CanvasTexture(c));
  const g = c.getContext("2d");
  if (!g) return tex;

  roundRect(g, 6, 6, W - 12, H - 12, 10);
  g.fillStyle = "#23211e";
  g.fill();
  g.lineWidth = 3;
  g.strokeStyle = "#4a4640";
  roundRect(g, 14, 14, W - 28, H - 28, 7);
  g.stroke();
  // Corner rivets.
  for (const [rx, ry] of [
    [26, 26],
    [W - 26, 26],
    [26, H - 26],
    [W - 26, H - 26],
  ]) {
    g.beginPath();
    g.arc(rx!, ry!, 5, 0, Math.PI * 2);
    g.fillStyle = "#6b665e";
    g.fill();
    g.beginPath();
    g.arc(rx!, ry!, 2, 0, Math.PI * 2);
    g.fillStyle = "#2a2824";
    g.fill();
  }

  const ix = 24;
  const iy = 22;
  const iw = W - 48;
  const ih = 196;
  g.save();
  roundRect(g, ix, iy, iw, ih, 6);
  g.clip();
  g.fillStyle = "#0a0908";
  g.fillRect(ix, iy, iw, ih);
  g.restore();

  // Stamped purity reading (monospace, etched).
  g.fillStyle = "#a89e8c";
  g.font = "700 30px 'Courier New', monospace";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(`${valueLabel} ${value}`, W / 2, 262);

  const img = new Image();
  img.onload = () => {
    g.save();
    roundRect(g, ix, iy, iw, ih, 6);
    g.clip();
    g.drawImage(img, ix, iy, iw, ih);
    g.restore();
    g.lineWidth = 2;
    g.strokeStyle = "#3a342c";
    roundRect(g, ix, iy, iw, ih, 6);
    g.stroke();
    tex.needsUpdate = true;
  };
  img.src = imageUrl;
  return tex;
}

const CRATE_GOLD = new THREE.Color(0xf0c66b);
const WHITE = new THREE.Color(0xffffff);

/**
 * Workshop "Scrap Sorting" — the bespoke Assignment game. Salvage tags sit on
 * the bench over a forge; tap a piece then tap the grade crate it belongs in and
 * it drops in. The answer (a bin index per item) is the standard assignment
 * shape, so server grading is identical.
 */
export default function ScrapSortingGame3D({
  presentation,
  submitting,
  onSubmit,
}: ScrapSortingGame3DProps) {
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
      playSfx("match");
      fx.burst(clientX, clientY, { count: 12, color: "#d9a05a" });
    }
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const stage = createStage3D(container, { fov: 44, camY: 0.8, camZ: 8 });
    const root = new THREE.Group();
    stage.scene.add(root);

    // Forge backdrop.
    const backdropTex = srgbTexture(new THREE.TextureLoader().load("/minigame/scrap/backdrop.png"));
    const backdropMat = new THREE.MeshBasicMaterial({ map: backdropTex, color: 0x7a7a7a });
    const backdrop = new THREE.Mesh(new THREE.PlaneGeometry(22, 14), backdropMat);
    backdrop.position.z = -6;
    stage.scene.add(backdrop);

    // Grade crates along the bench.
    const nb = bins.length;
    const CRATE_W = Math.min(1.7, 6.6 / nb);
    const crateGeo = new THREE.BoxGeometry(CRATE_W, 0.95, 0.85);
    const crateSpan = nb * CRATE_W + (nb - 1) * 0.5;
    const crates: { x: number; glow: THREE.MeshBasicMaterial }[] = [];

    bins.forEach((b, i) => {
      const x = -crateSpan / 2 + CRATE_W / 2 + i * (CRATE_W + 0.5);
      const g = new THREE.Group();
      g.position.set(x, -1.75, 0);
      g.userData = { kind: "bin", index: i };

      const body = new THREE.Mesh(
        crateGeo,
        new THREE.MeshBasicMaterial({ color: 0x4a3420 }),
      );
      g.add(body);

      // Stamped grade plaque on the front face.
      const plaqueTex = tileTexture({
        w: 256,
        h: 96,
        bg: "#241c12",
        border: "#5a4324",
        lines: [{ text: b.label, y: 50, size: 34, color: "#cbb896", weight: "700" }],
      });
      const plaque = new THREE.Mesh(
        new THREE.PlaneGeometry(CRATE_W * 0.9, 0.42),
        new THREE.MeshBasicMaterial({ map: plaqueTex, transparent: true }),
      );
      plaque.position.set(0, -0.05, 0.44);
      g.add(plaque);

      const glow = new THREE.MeshBasicMaterial({
        color: 0xf0c66b,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const glowMesh = new THREE.Mesh(
        new THREE.BoxGeometry(CRATE_W + 0.16, 1.1, 1.0),
        glow,
      );
      g.add(glowMesh);

      root.add(g);
      crates.push({ x, glow });
    });

    // Scrap tags in a tray above the bench.
    const ni = items.length;
    const cols = Math.min(ni, 3);
    const TAG_W = 1.12;
    const TAG_H = 1.31;
    const traySpan = cols * TAG_W + (cols - 1) * 0.28;
    const tagGeo = new THREE.PlaneGeometry(TAG_W, TAG_H);
    const glowGeo = new THREE.PlaneGeometry(TAG_W + 0.16, TAG_H + 0.16);
    const tmpTarget = new THREE.Vector3();
    const tags: {
      group: THREE.Group;
      home: THREE.Vector3;
      glow: THREE.MeshBasicMaterial;
      mat: THREE.MeshBasicMaterial;
      tex: THREE.CanvasTexture;
    }[] = [];

    items.forEach((it, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = -traySpan / 2 + TAG_W / 2 + col * (TAG_W + 0.28);
      const y = 2.35 - row * 1.5;
      const tex = scrapTagTexture(scrapUrl(it.label), valueLabel, it.value);
      const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true });
      const tile = new THREE.Mesh(tagGeo, mat);
      const glow = new THREE.MeshBasicMaterial({
        color: 0xf0c66b,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const glowMesh = new THREE.Mesh(glowGeo, glow);
      glowMesh.position.z = -0.05;
      const group = new THREE.Group();
      const home = new THREE.Vector3(x, y, 0);
      group.position.copy(home);
      group.userData = { kind: "item", index: i };
      group.add(glowMesh, tile);
      root.add(group);
      tags.push({ group, home, glow, mat, tex });
    });

    const onPointerDown = (ev: PointerEvent) => {
      if (viewRef.current.submitting) return;
      const obj = stage.pickTop(ev, root);
      if (!obj) return;
      const { kind, index } = obj.userData as { kind?: string; index?: number };
      if (kind && index !== undefined) tapRef.current(kind, index, ev.clientX, ev.clientY);
    };
    stage.renderer.domElement.addEventListener("pointerdown", onPointerDown);

    stage.start(() => {
      const v = viewRef.current;
      const hot = selectedRef.current !== null;
      for (const cr of crates) cr.glow.opacity += ((hot ? 0.45 : 0) - cr.glow.opacity) * 0.15;

      for (let i = 0; i < tags.length; i++) {
        const tag = tags[i]!;
        const bin = v.assigned[i];
        let target: THREE.Vector3;
        if (bin !== null && bin !== undefined) {
          const cx = crates[bin]?.x ?? 0;
          // Drop into the crate (slight per-item stack so pieces pile up).
          target = tmpTarget.set(cx + ((i % 3) - 1) * 0.12, -1.4 + Math.floor(i / 3) * 0.08, 0.5);
        } else {
          target = tag.home;
        }
        tag.group.position.lerp(target, 0.18);
        const isSel = selectedRef.current === i;
        tag.glow.opacity += ((isSel ? 0.8 : 0) - tag.glow.opacity) * 0.2;
        const s = isSel ? 1.08 : bin !== null && bin !== undefined ? 0.46 : 1;
        tag.group.scale.x += (s - tag.group.scale.x) * 0.2;
        tag.group.scale.y = tag.group.scale.x;
        tag.mat.color.lerp(isSel ? CRATE_GOLD : WHITE, 0.15);
      }
    });

    return () => {
      stage.renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      // Dispose every geometry + material + texture under root (covers the
      // shared + per-crate geometries, plaque/tag/glow materials and their maps).
      root.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of mats) {
            (m as THREE.MeshBasicMaterial).map?.dispose();
            m.dispose();
          }
        }
      });
      backdrop.geometry.dispose();
      backdropMat.dispose();
      backdropTex.dispose();
      stage.dispose();
    };
  }, [items, bins, valueLabel]);

  return (
    <div className="space-y-3">
      <GameHeader current={Math.min(sorted + 1, items.length)} total={items.length} noun="Piece" />
      <GameTimer totalMs={MS_PER_ITEM * items.length} paused={submitting} onExpire={fireSubmit} />
      <p className="text-sm text-text-secondary">{instruction}</p>
      <p className="text-center text-[11px] text-text-muted">tap a piece, then tap its grade crate</p>
      <div ref={containerRef} className="h-80 w-full touch-none sm:h-96" />
      <GameFooter
        progress={{ done: sorted, total: items.length, noun: "sorted" }}
        submitLabel={allSorted ? "Submit haul" : "Submit"}
        submitting={submitting}
        disabled={false}
        onSubmit={fireSubmit}
      />
    </div>
  );
}
