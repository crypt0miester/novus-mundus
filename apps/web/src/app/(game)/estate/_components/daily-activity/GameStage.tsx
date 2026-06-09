"use client";

import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from "react";
import { useSettings } from "@/lib/store/settings";
import { prefersReducedMotion } from "@/lib/utils";

// Shared "juice" layer for the minigames. One absolutely-positioned 2D canvas
// overlays the game content; an imperative FX bus (exposed via context) lets
// any game fire particle bursts, screenshake, and confetti from one place
// instead of each component reimplementing canvas work. Scoring is untouched
// — this is presentation only.

export interface BurstOpts {
  /** Particle count. Default 14. */
  count?: number;
  /** CSS color (hex/rgb). Default warm gold. */
  color?: string;
  /** Outward speed multiplier. Default 1. */
  spread?: number;
}

export interface FxBus {
  /** Particle burst at viewport coordinates (clientX/clientY). */
  burst(x: number, y: number, opts?: BurstOpts): void;
  /** Particle burst centered on a DOM element. */
  burstEl(el: Element | null | undefined, opts?: BurstOpts): void;
  /** Brief screenshake of the whole stage. `intensity` ~1 default. */
  shake(intensity?: number): void;
  /** Celebratory confetti fall across the stage. */
  confetti(opts?: BurstOpts): void;
}

const NOOP_BUS: FxBus = {
  burst: () => {},
  burstEl: () => {},
  shake: () => {},
  confetti: () => {},
};

const FxContext = createContext<FxBus>(NOOP_BUS);

/** Read the FX bus. Returns a no-op bus outside a `<GameStage>`. */
export function useFx(): FxBus {
  return useContext(FxContext);
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  gravity: number;
}

const GOLD = "#f0c66b";

export function GameStage({ children }: { children: ReactNode }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Live mutable handles the stable bus closures read from.
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const particlesRef = useRef<Particle[]>([]);
  const rafRef = useRef<number | null>(null);
  const sizeRef = useRef<{ w: number; h: number }>({ w: 0, h: 0 });
  const shakeRef = useRef<{ until: number } | null>(null);

  // FX is off under reduced motion or when the user disabled animations —
  // the bus becomes a no-op so no canvas/RAF work happens at all.
  const animationsEnabled = useSettings((s) => s.animationsEnabled);
  const enabledRef = useRef(true);
  enabledRef.current = animationsEnabled && !prefersReducedMotion();

  // Size the canvas to its container at device pixel ratio.
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctxRef.current = ctx;

    const resize = () => {
      const rect = container.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      sizeRef.current = { w: rect.width, h: rect.height };
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);
    return () => {
      ro.disconnect();
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, []);

  // The bus is stable across renders — every method reads refs, so it never
  // needs to be recreated (no stale closures, no re-subscribes downstream).
  const bus = useMemo<FxBus>(() => {
    const tick = () => {
      const ctx = ctxRef.current;
      const { w, h } = sizeRef.current;
      if (!ctx) {
        rafRef.current = null;
        return;
      }
      ctx.clearRect(0, 0, w, h);

      const ps = particlesRef.current;
      for (let i = ps.length - 1; i >= 0; i--) {
        const p = ps[i]!;
        p.life -= 1;
        if (p.life <= 0) {
          ps.splice(i, 1);
          continue;
        }
        p.vy += p.gravity;
        p.x += p.vx;
        p.y += p.vy;
        const alpha = Math.max(0, p.life / p.maxLife);
        ctx.globalAlpha = alpha;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // Screenshake decays toward the shake deadline.
      const container = containerRef.current;
      if (container) {
        const sh = shakeRef.current;
        if (sh && performance.now() < sh.until) {
          const k = (sh.until - performance.now()) / 220;
          const m = 6 * k;
          container.style.transform = `translate(${(Math.random() - 0.5) * m}px, ${(Math.random() - 0.5) * m}px)`;
        } else if (sh) {
          shakeRef.current = null;
          container.style.transform = "";
        }
      }

      // Keep looping only while there's something to draw — idle otherwise.
      if (ps.length > 0 || shakeRef.current) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        rafRef.current = null;
      }
    };

    const ensureLoop = () => {
      if (rafRef.current == null) rafRef.current = requestAnimationFrame(tick);
    };

    const spawn = (x: number, y: number, opts?: BurstOpts) => {
      const count = opts?.count ?? 14;
      const color = opts?.color ?? GOLD;
      const spread = opts?.spread ?? 1;
      const ps = particlesRef.current;
      for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = (1.5 + Math.random() * 3) * spread;
        const maxLife = 28 + Math.random() * 22;
        ps.push({
          x,
          y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 1.5,
          life: maxLife,
          maxLife,
          size: 1.5 + Math.random() * 2.5,
          color,
          gravity: 0.12,
        });
      }
      ensureLoop();
    };

    const toLocal = (clientX: number, clientY: number) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return { x: clientX, y: clientY };
      return { x: clientX - rect.left, y: clientY - rect.top };
    };

    return {
      burst(clientX, clientY, opts) {
        if (!enabledRef.current) return;
        const { x, y } = toLocal(clientX, clientY);
        spawn(x, y, opts);
      },
      burstEl(el, opts) {
        if (!enabledRef.current || !el) return;
        const r = el.getBoundingClientRect();
        const { x, y } = toLocal(r.left + r.width / 2, r.top + r.height / 2);
        spawn(x, y, opts);
      },
      shake(intensity = 1) {
        if (!enabledRef.current) return;
        shakeRef.current = { until: performance.now() + 220 * Math.min(2, intensity) };
        ensureLoop();
      },
      confetti(opts) {
        if (!enabledRef.current) return;
        const { w } = sizeRef.current;
        const colors = ["#f0c66b", "#7dd3fc", "#fda4af", "#a78bfa", "#86efac"];
        const total = opts?.count ?? 90;
        const ps = particlesRef.current;
        for (let i = 0; i < total; i++) {
          const maxLife = 70 + Math.random() * 50;
          ps.push({
            x: Math.random() * w,
            y: -10,
            vx: (Math.random() - 0.5) * 3,
            vy: 1 + Math.random() * 3,
            life: maxLife,
            maxLife,
            size: 2 + Math.random() * 3,
            color: opts?.color ?? colors[i % colors.length]!,
            gravity: 0.08,
          });
        }
        ensureLoop();
      },
    };
  }, []);

  return (
    <FxContext.Provider value={bus}>
      <div ref={containerRef} className="relative">
        {children}
        <canvas
          ref={canvasRef}
          aria-hidden
          className="pointer-events-none absolute inset-0 z-10"
        />
      </div>
    </FxContext.Provider>
  );
}
