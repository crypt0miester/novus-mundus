"use client";

import * as THREE from "three";

// Minimal shared three.js stage for the single-shot 3D minigames (set-select,
// assignment, ordering). Centralises the scene/camera/renderer/resize/raycast/
// RAF/dispose boilerplate so each game only describes its objects + per-frame
// sync. Tiles face the camera and carry text via canvas textures so the
// numbers the player reads stay legible; "3D" comes from perspective depth,
// lift/scale on interaction, and subtle parallax rather than heavy rotation.

export interface Stage3D {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  /** Top-level object (direct child of `parent`) under the pointer, or null. */
  pickTop(ev: PointerEvent, parent: THREE.Object3D): THREE.Object3D | null;
  /** Begin the render loop; `frame(t)` runs each frame with seconds elapsed. */
  start(frame: (t: number) => void): void;
  dispose(): void;
}

export function createStage3D(
  container: HTMLElement,
  opts?: { fov?: number; camZ?: number; camY?: number },
): Stage3D {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(opts?.fov ?? 42, 1, 0.1, 100);
  camera.position.set(0, opts?.camY ?? 0, opts?.camZ ?? 7);
  camera.lookAt(0, 0, 0);

  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setClearColor(0x000000, 0);
  container.appendChild(renderer.domElement);
  Object.assign(renderer.domElement.style, {
    width: "100%",
    height: "100%",
    display: "block",
    touchAction: "manipulation",
  });

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let raf = 0;

  const resize = () => {
    const w = container.clientWidth || 1;
    const h = container.clientHeight || 280;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(container);

  return {
    scene,
    camera,
    renderer,
    pickTop(ev, parent) {
      const rect = renderer.domElement.getBoundingClientRect();
      ndc.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      ndc.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(ndc, camera);
      const hits = raycaster.intersectObjects(parent.children, true);
      if (hits.length === 0) return null;
      let obj: THREE.Object3D | null = hits[0]!.object;
      while (obj && obj.parent !== parent) obj = obj.parent;
      return obj;
    },
    start(frame) {
      const loop = (ms: number) => {
        frame(ms * 0.001);
        renderer.render(scene, camera);
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    },
    dispose() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}

export function roundRect(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** A rounded text tile drawn to a canvas and wrapped as a texture. */
export function tileTexture(opts: {
  w?: number;
  h?: number;
  bg: string;
  border: string;
  borderW?: number;
  lines: { text: string; y: number; size: number; color: string; weight?: string }[];
}): THREE.CanvasTexture {
  const W = opts.w ?? 256;
  const H = opts.h ?? 160;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d");
  if (g) {
    g.fillStyle = opts.bg;
    roundRect(g, 4, 4, W - 8, H - 8, 18);
    g.fill();
    g.lineWidth = opts.borderW ?? 5;
    g.strokeStyle = opts.border;
    roundRect(g, 4, 4, W - 8, H - 8, 18);
    g.stroke();
    g.textAlign = "center";
    g.textBaseline = "middle";
    for (const l of opts.lines) {
      g.fillStyle = l.color;
      g.font = `${l.weight ?? "600"} ${l.size}px system-ui, sans-serif`;
      g.fillText(l.text, W / 2, l.y);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

/** Apply the standard color-texture settings (sRGB + anisotropy). */
export function srgbTexture<T extends THREE.Texture>(tex: T): T {
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** A small neutral pill of text (rounded, gold-bordered). */
export function drawPill(g: CanvasRenderingContext2D, cx: number, cy: number, text: string) {
  g.font = "600 22px system-ui, sans-serif";
  const w = g.measureText(text).width + 30;
  const h = 38;
  roundRect(g, cx - w / 2, cy - h / 2, w, h, 19);
  g.fillStyle = "#0e0a06";
  g.fill();
  g.lineWidth = 1.5;
  g.strokeStyle = "#8a6d3b";
  g.stroke();
  g.fillStyle = "#e2d3a8";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, cx, cy + 1);
}

/**
 * An ornate goods/trading card: a warm parchment card in a double gold frame,
 * with an image (or a monogram of the label) in a framed window, the label, and
 * two neutral pills carrying its two numbers. The image loads async and pops
 * into the window over a vignette so it sits in the frame rather than floating.
 * Shared so any 3D minigame can adopt the framed-card look.
 */
export function cardTexture(opts: {
  imageUrl?: string;
  label: string;
  aLabel: string;
  a: number;
  bLabel: string;
  b: number;
}): THREE.CanvasTexture {
  const W = 300;
  const H = 400;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const tex = srgbTexture(new THREE.CanvasTexture(c));
  const g = c.getContext("2d");
  if (!g) return tex;

  // Warm card + double gold frame.
  roundRect(g, 8, 8, W - 16, H - 16, 20);
  g.fillStyle = "#1a1410";
  g.fill();
  g.lineWidth = 6;
  g.strokeStyle = "#c9a04e";
  g.stroke();
  g.lineWidth = 2;
  g.strokeStyle = "#6b4f24";
  roundRect(g, 17, 17, W - 34, H - 34, 13);
  g.stroke();

  // Image window.
  const ix = 28;
  const iy = 28;
  const iw = W - 56;
  const ih = 232;
  g.save();
  roundRect(g, ix, iy, iw, ih, 10);
  g.clip();
  g.fillStyle = "#0c0a06";
  g.fillRect(ix, iy, iw, ih);
  if (!opts.imageUrl) {
    g.fillStyle = "#5a4a2e";
    g.font = "700 140px Georgia, serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(opts.label.charAt(0).toUpperCase(), ix + iw / 2, iy + ih / 2 + 6);
  }
  g.restore();
  g.lineWidth = 2;
  g.strokeStyle = "#3b3020";
  roundRect(g, ix, iy, iw, ih, 10);
  g.stroke();

  // Label + price/value pills.
  g.fillStyle = "#f0e6d0";
  g.font = "700 30px Georgia, serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(opts.label, W / 2, 298);
  drawPill(g, W / 2 - 66, 350, `${opts.aLabel} ${opts.a}`);
  drawPill(g, W / 2 + 66, 350, `${opts.bLabel} ${opts.b}`);

  if (opts.imageUrl) {
    const img = new Image();
    img.onload = () => {
      g.save();
      roundRect(g, ix, iy, iw, ih, 10);
      g.clip();
      g.drawImage(img, ix, iy, iw, ih);
      const grad = g.createRadialGradient(
        ix + iw / 2,
        iy + ih / 2,
        ih * 0.3,
        ix + iw / 2,
        iy + ih / 2,
        ih * 0.72,
      );
      grad.addColorStop(0, "rgba(0,0,0,0)");
      grad.addColorStop(1, "rgba(12,10,6,0.55)");
      g.fillStyle = grad;
      g.fillRect(ix, iy, iw, ih);
      g.restore();
      g.lineWidth = 2;
      g.strokeStyle = "#3b3020";
      roundRect(g, ix, iy, iw, ih, 10);
      g.stroke();
      tex.needsUpdate = true;
    };
    img.src = opts.imageUrl;
  }
  return tex;
}
