"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

// Observatory "Star Reading" marquee renderer: the constellation drawn as an
// actual 3D field of twinkling stars instead of a flat ★/☆ text row. Bright
// stars (★) glow gold with a halo; dim stars (☆) are small and faint. The
// field drifts and the stars twinkle, so the player reads depth, but the
// answer is still the option index chosen below — this is pure backdrop.
//
// Self-contained three.js (no examples/controls), mounted lazily by McqGame
// only when WebGL2 is available and motion is allowed; the flat text row is
// the fallback. Default export so it can be `React.lazy`-loaded, keeping
// three.js out of the estate route bundle until a star-reading game opens.

// Deterministic GLSL-style hash so star positions are stable across renders
// (no Math.random jitter that would jump every re-render).
function hash(n: number): number {
  const s = Math.sin(n * 127.1) * 43758.5453;
  return s - Math.floor(s);
}

function parseStars(display: string): boolean[] {
  return display
    .split(" ")
    .filter(Boolean)
    .map((g) => g === "★");
}

// Dim ("☆") stars vary in tint so the field reads richer; bright ("★") stars
// stay uniform gold so they remain the clearly-countable ones.
const DIM_HEX = [0x9ca3af, 0x8aa6c9, 0xc9b89c, 0xa89ac4, 0x86b5a8];

export default function StarField3D({
  display,
  animate = true,
}: {
  display: string;
  /** When false (reduced motion), render a single static frame — no drift/twinkle. */
  animate?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const stars = parseStars(display);
    if (stars.length === 0) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    camera.position.z = 8;

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setClearColor(0x000000, 0);
    container.appendChild(renderer.domElement);
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.display = "block";

    const group = new THREE.Group();
    scene.add(group);

    // One unit sphere shared by every star (cores + halos are scaled copies).
    const sphereGeo = new THREE.SphereGeometry(1, 16, 16);

    interface StarMesh {
      core: THREE.Mesh;
      halo: THREE.Mesh | null;
      bright: boolean;
      phase: number;
      baseOpacity: number;
    }
    const built: StarMesh[] = [];

    const n = stars.length;
    const spanX = Math.min(n, 9) * 0.7; // half-width of the band

    stars.forEach((bright, i) => {
      const fx = n > 1 ? i / (n - 1) - 0.5 : 0;
      const x = fx * spanX * 2;
      const y = (hash(i * 1.3 + 1) - 0.5) * 2.6;
      const z = (hash(i * 2.7 + 5) - 0.5) * 3.8; // wide depth so the swing reads as 3D

      const coreMat = new THREE.MeshBasicMaterial({
        color: bright ? 0xf5c451 : DIM_HEX[(hash(i * 3.3 + 2) * DIM_HEX.length) | 0]!,
        transparent: true,
        opacity: bright ? 1 : 0.5,
      });
      const core = new THREE.Mesh(sphereGeo, coreMat);
      core.scale.setScalar(bright ? 0.5 : 0.2);
      core.position.set(x, y, z);
      group.add(core);

      let halo: THREE.Mesh | null = null;
      if (bright) {
        const haloMat = new THREE.MeshBasicMaterial({
          color: 0xf5c451,
          transparent: true,
          opacity: 0.22,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        });
        halo = new THREE.Mesh(sphereGeo, haloMat);
        halo.scale.setScalar(1.05);
        halo.position.set(x, y, z);
        group.add(halo);
      }

      built.push({
        core,
        halo,
        bright,
        phase: hash(i * 5.1 + 3) * Math.PI * 2,
        baseOpacity: bright ? 1 : 0.5,
      });
    });

    // Background dust — many faint motes for depth, clearly not the stars.
    const DUST = 70;
    const dustPos = new Float32Array(DUST * 3);
    for (let i = 0; i < DUST; i++) {
      dustPos[i * 3] = (hash(i * 2.1 + 11) - 0.5) * spanX * 3;
      dustPos[i * 3 + 1] = (hash(i * 3.7 + 13) - 0.5) * 5;
      dustPos[i * 3 + 2] = (hash(i * 1.9 + 17) - 0.5) * 6 - 2;
    }
    const dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute("position", new THREE.BufferAttribute(dustPos, 3));
    const dustMat = new THREE.PointsMaterial({
      color: 0xaab4d0,
      size: 0.06,
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    group.add(new THREE.Points(dustGeo, dustMat));

    // Soft nebula glows well behind the stars for atmosphere.
    const nebulaDefs = [
      { color: 0x6d4bd1, x: -1.6, y: 0.9, z: -4, s: 3.2, o: 0.1 },
      { color: 0x2f7fb0, x: 1.9, y: -0.6, z: -5, s: 3.6, o: 0.08 },
    ];
    const nebulas = nebulaDefs.map((nb) => {
      const mat = new THREE.MeshBasicMaterial({
        color: nb.color,
        transparent: true,
        opacity: nb.o,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(sphereGeo, mat);
      mesh.position.set(nb.x, nb.y, nb.z);
      mesh.scale.setScalar(nb.s);
      group.add(mesh);
      return { mat, base: nb.o };
    });

    let raf = 0;
    let lastT = 0;
    // Draw one frame at time `t`. A wide yaw swing (±~40°) makes the depth read
    // clearly as 3D while keeping the stars countable; reduced motion freezes it
    // at a fixed flattering angle (drawn once, no loop).
    const drawFrame = (t: number) => {
      group.rotation.y = animate ? Math.sin(t * 0.35) * 0.7 : 0.55;
      group.rotation.x = animate ? Math.cos(t * 0.28) * 0.18 : 0.18;
      for (const m of built) {
        const tw = animate ? 0.5 + 0.5 * Math.sin(t * (m.bright ? 2.2 : 1.4) + m.phase) : 0.9;
        (m.core.material as THREE.MeshBasicMaterial).opacity = m.baseOpacity * (0.6 + 0.4 * tw);
        if (m.halo) (m.halo.material as THREE.MeshBasicMaterial).opacity = 0.18 * tw;
      }
      for (let k = 0; k < nebulas.length; k++) {
        nebulas[k]!.mat.opacity = nebulas[k]!.base * (animate ? 0.7 + 0.3 * Math.sin(t * 0.25 + k * 2) : 1);
      }
      renderer.render(scene, camera);
    };

    const resize = () => {
      const w = container.clientWidth || 1;
      const h = container.clientHeight || 144;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      drawFrame(lastT); // re-render after a resize (also paints the static frame)
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);

    if (animate) {
      const tick = () => {
        lastT += 0.016;
        drawFrame(lastT);
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      for (const m of built) {
        (m.core.material as THREE.Material).dispose();
        if (m.halo) (m.halo.material as THREE.Material).dispose();
      }
      dustGeo.dispose();
      dustMat.dispose();
      for (const nb of nebulas) nb.mat.dispose();
      sphereGeo.dispose();
      renderer.dispose();
      // Promptly free the GL context (not just its resources) so several
      // constellations + reopens don't creep toward the iOS context cap.
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }, [display, animate]);

  return <div ref={containerRef} aria-hidden className="mb-2 h-36 w-full" />;
}
