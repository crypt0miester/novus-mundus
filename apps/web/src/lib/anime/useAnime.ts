"use client";

import anime from "animejs/lib/anime.es.js";
import { useRef, useEffect, useCallback } from "react";

export function useAnime() {
  const animations = useRef<anime.AnimeInstance[]>([]);

  const animate = useCallback((params: anime.AnimeParams) => {
    const anim = anime(params);
    animations.current.push(anim);
    return anim;
  }, []);

  const timeline = useCallback((params?: anime.AnimeParams) => {
    const tl = anime.timeline(params);
    animations.current.push(tl);
    return tl;
  }, []);

  // Cleanup all running animations on unmount
  useEffect(() => {
    return () => {
      animations.current.forEach((a) => a.pause());
      animations.current = [];
    };
  }, []);

  return { animate, timeline };
}
