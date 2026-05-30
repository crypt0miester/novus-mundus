"use client";

import { createScope, type DOMTarget, type Scope } from "animejs";
import { type RefObject, useEffect } from "react";

// The one React cleanup pattern for anime.js. Builds a `createScope` rooted at
// `root.current` once it exists (post-mount, inside the effect), wires a
// `reduce` media query so the builder reads it off `self.matches`, and tears the
// scope down on unmount / dep change. Re-runs when `deps` change (defaults to a
// run-once effect). This folds the same six lines copied into every motion
// effect (scope create + add + reduced-motion gate + revert cleanup) into one
// hook so the ~17 downstream motion units share identical lifecycle semantics.
//
// Teardown:
//   - entrance / celebration animations whose final visible state equals the
//     CSS resting state use the default `scope.revert()` (restores inline
//     styles the animation set).
//   - FLIP / "settle to identity" animations must pass `revertOnCleanup: false`
//     so we only cancel the in-flight tweens and leave the committed inline
//     transform alone (revert would wipe it and flash).
export function useAnimeScope(
  opts: {
    root: RefObject<Element | null>;
    mediaQueries?: Record<string, string>;
    deps?: unknown[];
    revertOnCleanup?: boolean;
  },
  builder: (ctx: { reduce: boolean; scope: Scope }) => void,
): void {
  const { root, mediaQueries, deps, revertOnCleanup } = opts;
  useEffect(() => {
    if (!root.current) return;
    // anime.js narrows its root to HTMLElement | SVGElement; the contract types
    // the ref as the wider Element, which it always is in practice here.
    const scope = createScope({
      root: root.current as DOMTarget,
      mediaQueries: { reduce: "(prefers-reduced-motion: reduce)", ...mediaQueries },
    }).add((self) => {
      // ScopeConstructorCallback types `self` as optional; inside add() it is
      // always the live scope, so guard once and hand it to the builder.
      if (!self) return;
      builder({ reduce: !!self.matches.reduce, scope: self });
    });
    return () => {
      if (revertOnCleanup !== false) {
        scope.revert();
        return;
      }
      // FLIP teardown: cancel the in-flight revertibles without reverting, so
      // the committed inline transform survives unmount (no flash).
      for (const revertible of scope.revertibles) {
        (revertible as { cancel?: () => void }).cancel?.();
      }
    };
    // biome-ignore lint/correctness/useExhaustiveDependencies: re-run is keyed on the caller-supplied deps only; root + builder are stable by contract and intentionally untracked.
  }, deps ?? []);
}
