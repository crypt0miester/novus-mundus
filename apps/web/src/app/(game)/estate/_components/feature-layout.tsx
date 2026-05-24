import type { ReactNode } from "react";

interface FeatureLayoutProps {
  /** The bulk of the view — selection, roster, status. Fills the column. */
  main: ReactNode;
  /**
   * The action panel — what the player *does* here (hire, craft, claim…).
   * On desktop it sits in a fixed-width right rail and stays in view while
   * `main` scrolls; on mobile it stacks underneath, where the views were
   * designed to put it. Omit for views with no single action surface.
   */
  aside?: ReactNode;
}

/**
 * Shared desktop layout for a building's feature view. Mobile keeps the single
 * vertical column the views were designed around; at `lg` the content splits
 * into `main` + a pinned `aside`, so a wide screen reads left-to-right (what
 * you have to what you do) instead of stretching the mobile stack across the
 * whole column. Each slot lays its children out with the views' usual 1rem
 * vertical rhythm, so a tab just passes loose cards.
 */
export function FeatureLayout({ main, aside }: FeatureLayoutProps) {
  if (!aside) {
    return <div className="space-y-4">{main}</div>;
  }
  return (
    <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start lg:gap-4">
      <div className="space-y-4">{main}</div>
      <div className="mt-4 space-y-4 lg:sticky lg:top-0 lg:mt-8">{aside}</div>
    </div>
  );
}
