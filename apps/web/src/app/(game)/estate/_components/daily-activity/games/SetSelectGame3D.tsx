"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { playSfx } from "@/lib/audio/sfx";
import { useFx } from "../GameStage";
import { GameFooter, GameHeader, GameTimer, useFireOnce, useIndexedSelection } from "./_shell";
import { cardTexture, createStage3D, srgbTexture } from "./stage3d";

export interface SetSelectPresentation {
  instruction: string;
  aLabel: string;
  bLabel: string;
  items: { label: string; a: number; b: number }[];
}

interface SetSelectGame3DProps {
  presentation: SetSelectPresentation;
  submitting: boolean;
  onSubmit: (answer: boolean[]) => void;
}

const MS_PER_ITEM = 3_000;

// Market "Deal Finder" goods → generated images, keyed by lowercased label.
// Other set-select buildings (Dock/Vault/Mine) have no entries → monogram card.
const GOODS: Record<string, string> = {
  iron: "/minigame/deal/iron.png",
  hide: "/minigame/deal/hide.png",
  salt: "/minigame/deal/salt.png",
  rope: "/minigame/deal/rope.png",
  grain: "/minigame/deal/grain.png",
  pelt: "/minigame/deal/pelt.png",
  oil: "/minigame/deal/oil.png",
  cloth: "/minigame/deal/cloth.png",
};

/**
 * 3D SetSelect. Ornate goods cards (shared `cardTexture`) sit over a warm market
 * backdrop; tapping one flags it (it lifts toward you with a gold glow). The
 * answer (a boolean per item) is unchanged, so grading is identical to the DOM
 * version.
 */
export default function SetSelectGame3D({ presentation, submitting, onSubmit }: SetSelectGame3DProps) {
  const { instruction, aLabel, bLabel, items } = presentation;
  const fx = useFx();
  const [selected, setSelectedAt] = useIndexedSelection<boolean>(() => items.map(() => false));
  const containerRef = useRef<HTMLDivElement>(null);

  const flagged = selected.filter(Boolean).length;
  const fireSubmit = useFireOnce(() => {
    playSfx("select");
    onSubmit(items.map((_, i) => selected[i] ?? false));
  });

  const viewRef = useRef({ selected, submitting });
  viewRef.current = { selected, submitting };
  const toggleRef = useRef<(i: number, x: number, y: number) => void>(() => {});
  toggleRef.current = (i, clientX, clientY) => {
    const next = !(selected[i] ?? false);
    setSelectedAt(i, next);
    playSfx(next ? "select" : "flip");
    if (next) fx.burst(clientX, clientY, { count: 10 });
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const n = items.length;
    const cols = n <= 4 ? 2 : 3;
    const rows = Math.ceil(n / cols);

    const stage = createStage3D(container, { fov: 42 });
    const root = new THREE.Group();
    stage.scene.add(root);

    // Warm market backdrop (dimmed) behind the cards for atmosphere + depth.
    const backdropTex = srgbTexture(new THREE.TextureLoader().load("/minigame/deal/backdrop.png"));
    const backdropMat = new THREE.MeshBasicMaterial({ map: backdropTex, color: 0x8a8a8a });
    const backdrop = new THREE.Mesh(new THREE.PlaneGeometry(20, 13), backdropMat);
    backdrop.position.z = -5;
    stage.scene.add(backdrop);

    const TW = 1.32;
    const TH = 1.76;
    const GAP = 0.34;
    const gridW = cols * TW + (cols - 1) * GAP;
    const gridH = rows * TH + (rows - 1) * GAP;

    const plane = new THREE.PlaneGeometry(TW, TH);
    const glowGeo = new THREE.PlaneGeometry(TW + 0.22, TH + 0.22);
    const tiles: {
      group: THREE.Group;
      glow: THREE.MeshBasicMaterial;
      tex: THREE.CanvasTexture;
      tileMat: THREE.MeshBasicMaterial;
    }[] = [];

    items.forEach((it, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = -gridW / 2 + TW / 2 + col * (TW + GAP);
      const y = gridH / 2 - TH / 2 - row * (TH + GAP);

      const tex = cardTexture({
        imageUrl: GOODS[it.label.toLowerCase()],
        label: it.label,
        aLabel,
        a: it.a,
        bLabel,
        b: it.b,
      });
      const tileMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true });
      const tile = new THREE.Mesh(plane, tileMat);

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
      group.position.set(x, y, 0);
      group.add(glowMesh, tile);
      root.add(group);
      tiles.push({ group, glow, tex, tileMat });
    });

    const fitH = Math.max(gridW / stage.camera.aspect, gridH) * 1.18;
    stage.camera.position.z = fitH / 2 / Math.tan((stage.camera.fov * Math.PI) / 360) + 1;

    const onPointerDown = (ev: PointerEvent) => {
      if (viewRef.current.submitting) return;
      const obj = stage.pickTop(ev, root);
      if (!obj) return;
      const i = root.children.indexOf(obj);
      if (i >= 0) toggleRef.current(i, ev.clientX, ev.clientY);
    };
    stage.renderer.domElement.addEventListener("pointerdown", onPointerDown);

    stage.start((t) => {
      const sel = viewRef.current.selected;
      const sway = Math.sin(t * 0.4) * 0.04;
      root.rotation.y = sway;
      backdrop.position.x = -sway * 3; // gentle parallax
      for (let i = 0; i < tiles.length; i++) {
        const on = sel[i] ?? false;
        const tile = tiles[i]!;
        tile.group.position.z += ((on ? 0.7 : 0) - tile.group.position.z) * 0.2;
        const s = on ? 1.08 : 1;
        tile.group.scale.x += (s - tile.group.scale.x) * 0.2;
        tile.group.scale.y = tile.group.scale.x;
        tile.glow.opacity += ((on ? 0.85 : 0) - tile.glow.opacity) * 0.2;
        tile.tileMat.color.setScalar(on ? 1.2 : 1);
      }
    });

    return () => {
      stage.renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      plane.dispose();
      glowGeo.dispose();
      backdrop.geometry.dispose();
      backdropMat.dispose();
      backdropTex.dispose();
      for (const tile of tiles) {
        tile.tileMat.dispose();
        tile.glow.dispose();
        tile.tex.dispose();
      }
      stage.dispose();
    };
  }, [items, aLabel, bLabel]);

  return (
    <div className="space-y-3">
      <GameHeader
        current={flagged}
        total={items.length}
        noun="Item"
        pips={false}
        trailing={
          <span className="font-mono text-[10px] tabular-nums text-text-muted">{flagged} flagged</span>
        }
      />
      <GameTimer totalMs={MS_PER_ITEM * items.length} paused={submitting} onExpire={fireSubmit} />
      <p className="text-sm text-text-secondary">{instruction}</p>
      <div ref={containerRef} className="h-80 w-full touch-none sm:h-96" />
      <GameFooter submitLabel="Submit" submitting={submitting} onSubmit={fireSubmit} />
    </div>
  );
}
