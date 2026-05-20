"use client";
import React, { useRef, useEffect } from 'react';

interface NoiseProps {
  /** Frames between regenerated grain. Higher = calmer and cheaper. */
  patternRefreshInterval?: number;
  /** Per-pixel alpha (0-255) at full strength. Scaled down by the active tier. */
  patternAlpha?: number;
}

const Noise: React.FC<NoiseProps> = ({
  patternRefreshInterval = 2,
  patternAlpha = 15,
}) => {
  const grainRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = grainRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    let frame = 0;
    let animationId: number;

    const canvasSize = 1024;

    // Tier-aware strength: --tier-noise runs 0.04 (tier 0) → 0 (tier 4).
    // 0.04 is treated as full strength; tier 4 disables the grain entirely.
    let strength = 1;
    const readStrength = () => {
      const raw = getComputedStyle(document.body)
        .getPropertyValue('--tier-noise')
        .trim();
      const v = parseFloat(raw);
      strength = Number.isFinite(v) ? Math.min(v / 0.04, 1) : 1;
    };
    readStrength();

    // Re-read when the player's tier changes (body[data-tier] swaps).
    const observer = new MutationObserver(readStrength);
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['data-tier'],
    });

    const resize = () => {
      canvas.width = canvasSize;
      canvas.height = canvasSize;
      canvas.style.width = '100vw';
      canvas.style.height = '100vh';
    };

    const drawGrain = () => {
      const imageData = ctx.createImageData(canvasSize, canvasSize);
      const data = imageData.data;
      const alpha = patternAlpha * strength;

      for (let i = 0; i < data.length; i += 4) {
        const value = Math.random() * 255;
        data[i] = value;
        data[i + 1] = value;
        data[i + 2] = value;
        data[i + 3] = alpha;
      }

      ctx.putImageData(imageData, 0, 0);
    };

    const loop = () => {
      if (frame % patternRefreshInterval === 0) {
        // Skip the expensive redraw when the grain is invisible anyway —
        // a high tier disables it, and a backgrounded tab can't see it.
        if (strength > 0 && !document.hidden) {
          drawGrain();
        } else {
          ctx.clearRect(0, 0, canvasSize, canvasSize);
        }
      }
      frame++;
      animationId = window.requestAnimationFrame(loop);
    };

    window.addEventListener('resize', resize);
    resize();
    loop();

    return () => {
      window.removeEventListener('resize', resize);
      window.cancelAnimationFrame(animationId);
      observer.disconnect();
    };
  }, [patternRefreshInterval, patternAlpha]);

  return (
    <canvas
      className="pointer-events-none fixed top-0 left-0 h-screen w-screen"
      ref={grainRef}
      style={{
        imageRendering: 'pixelated',
        zIndex: 9998,
      }}
    />
  );
};

export default Noise;
