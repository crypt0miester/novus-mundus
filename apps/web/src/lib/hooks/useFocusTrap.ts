"use client";

import { useEffect, useRef, type RefObject } from "react";

export interface UseFocusTrapOptions {
  /** While true, focus is contained within the container; idle when false. */
  active: boolean;
  /** Fires when Escape is pressed while the trap is active. */
  onEscape?: () => void;
}

// Tab-focusable elements inside the container. Mirrors the buttons-only sweep
// WalletModal uses, but broadened so links, inputs, and any explicitly
// tabbable node are cycled too.
const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

function getFocusable(node: HTMLElement): HTMLElement[] {
  return Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
}

/**
 * useFocusTrap — while `active`, contains keyboard focus inside `ref`. On
 * activation it remembers the currently-focused element and moves focus into
 * the container (its first focusable child, or the container itself). Tab and
 * Shift+Tab wrap at the ends, Escape calls `onEscape`, and on deactivation the
 * previously-focused element is restored. SSR-safe — does nothing until the
 * effect runs in the browser.
 */
export function useFocusTrap<T extends HTMLElement>(
  ref: RefObject<T | null>,
  { active, onEscape }: UseFocusTrapOptions,
): void {
  // Keep the latest onEscape without re-arming the trap each render.
  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;

  useEffect(() => {
    if (!active) return;
    if (typeof window === "undefined" || typeof document === "undefined") return;
    const node = ref.current;
    if (!node) return;

    // Remember where focus was so it can be restored on deactivation.
    const previouslyFocused = document.activeElement as HTMLElement | null;

    // Move focus in: first focusable child, else the container itself.
    const focusables = getFocusable(node);
    if (focusables.length > 0) {
      focusables[0]!.focus();
    } else {
      if (node.tabIndex < 0) node.tabIndex = -1;
      node.focus();
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onEscapeRef.current?.();
        return;
      }
      if (event.key !== "Tab") return;

      const current = getFocusable(node);
      if (current.length === 0) {
        // Nothing to cycle to — keep focus pinned on the container.
        event.preventDefault();
        node.focus();
        return;
      }

      const firstElement = current[0]!;
      const lastElement = current[current.length - 1]!;

      if (event.shiftKey) {
        if (document.activeElement === firstElement || !node.contains(document.activeElement)) {
          lastElement.focus();
          event.preventDefault();
        }
      } else {
        if (document.activeElement === lastElement || !node.contains(document.activeElement)) {
          firstElement.focus();
          event.preventDefault();
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);

    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      // Restore focus to the element that held it before the trap engaged.
      previouslyFocused?.focus?.();
    };
  }, [active, ref]);
}
