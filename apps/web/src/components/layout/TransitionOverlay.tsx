"use client";

import { useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import anime from "animejs/lib/anime.es.js";
import { useTransitionStore } from "@/lib/store/transition";

const ENTER_MS = 340;
const HOLD_MS = 550;
const EXIT_MS = 340;

export function TransitionOverlay() {
  const router = useRouter();
  const phase = useTransitionStore((s) => s.phase);
  const message = useTransitionStore((s) => s.message);
  const destination = useTransitionStore((s) => s.destination);
  const advance = useTransitionStore((s) => s.advance);
  const reset = useTransitionStore((s) => s.reset);

  const overlayRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const subtitleRef = useRef<HTMLParagraphElement>(null);
  const lineTopRef = useRef<HTMLDivElement>(null);
  const lineBotRef = useRef<HTMLDivElement>(null);

  const runEnter = useCallback(() => {
    const overlay = overlayRef.current;
    const title = titleRef.current;
    const subtitle = subtitleRef.current;
    const lineTop = lineTopRef.current;
    const lineBot = lineBotRef.current;
    if (!overlay || !title || !subtitle || !lineTop || !lineBot) return;

    // Reset initial state
    overlay.style.opacity = "0";
    overlay.style.display = "flex";
    title.style.opacity = "0";
    subtitle.style.opacity = "0";
    lineTop.style.transform = "scaleX(0)";
    lineBot.style.transform = "scaleX(0)";

    const tl = anime.timeline({ easing: "easeOutQuad" });

    tl.add({
      targets: overlay,
      opacity: [0, 1],
      duration: ENTER_MS * 0.6,
    })
      .add(
        {
          targets: [lineTop, lineBot],
          scaleX: [0, 1],
          duration: ENTER_MS,
        },
        0,
      )
      .add(
        {
          targets: title,
          opacity: [0, 1],
          translateY: [8, 0],
          duration: ENTER_MS * 0.7,
        },
        ENTER_MS * 0.3,
      )
      .add(
        {
          targets: subtitle,
          opacity: [0, 0.7],
          duration: ENTER_MS * 0.6,
        },
        ENTER_MS * 0.5,
      );

    tl.finished.then(() => advance("holding"));
  }, [advance]);

  const runHold = useCallback(() => {
    if (destination) {
      router.push(destination);
    }
    setTimeout(() => advance("exiting"), HOLD_MS);
  }, [destination, router, advance]);

  const runExit = useCallback(() => {
    const overlay = overlayRef.current;
    const title = titleRef.current;
    const subtitle = subtitleRef.current;
    const lineTop = lineTopRef.current;
    const lineBot = lineBotRef.current;
    if (!overlay || !title || !subtitle || !lineTop || !lineBot) return;

    const tl = anime.timeline({ easing: "easeInQuad" });

    tl.add({
      targets: [subtitle, title],
      opacity: 0,
      duration: EXIT_MS * 0.5,
    })
      .add(
        {
          targets: [lineTop, lineBot],
          scaleX: 0,
          duration: EXIT_MS * 0.7,
        },
        EXIT_MS * 0.2,
      )
      .add(
        {
          targets: overlay,
          opacity: 0,
          duration: EXIT_MS * 0.6,
        },
        EXIT_MS * 0.4,
      );

    tl.finished.then(() => {
      if (overlay) overlay.style.display = "none";
      reset();
    });
  }, [reset]);

  useEffect(() => {
    if (phase === "entering") runEnter();
    else if (phase === "holding") runHold();
    else if (phase === "exiting") runExit();
  }, [phase, runEnter, runHold, runExit]);

  if (phase === "idle") return null;

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-[10001] flex flex-col items-center justify-center bg-surface"
      style={{ display: "none", opacity: 0 }}
    >
      {/* Top gold line */}
      <div
        ref={lineTopRef}
        className="absolute left-[10%] right-[10%] top-[38%] h-px origin-center"
        style={{
          background:
            "linear-gradient(90deg, transparent, #92400e 20%, #fbbf24 50%, #92400e 80%, transparent)",
          boxShadow: "0 0 8px rgba(251, 191, 36, 0.3)",
          transform: "scaleX(0)",
        }}
      />

      {/* Center content */}
      <h1
        ref={titleRef}
        className="tier-title font-display text-4xl font-bold tracking-wider md:text-5xl"
        style={{ opacity: 0 }}
      >
        NOVUS MUNDUS
      </h1>
      <p
        ref={subtitleRef}
        className="mt-3 font-mono text-sm tracking-widest text-text-muted"
        style={{ opacity: 0 }}
      >
        {message}
      </p>

      {/* Bottom gold line */}
      <div
        ref={lineBotRef}
        className="absolute bottom-[38%] left-[10%] right-[10%] h-px origin-center"
        style={{
          background:
            "linear-gradient(90deg, transparent, #92400e 20%, #fbbf24 50%, #92400e 80%, transparent)",
          boxShadow: "0 0 8px rgba(251, 191, 36, 0.3)",
          transform: "scaleX(0)",
        }}
      />
    </div>
  );
}
