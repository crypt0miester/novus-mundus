"use client";

import { RallyTab } from "@/app/(game)/team/_components/rally-tab";
import { ReinforceTab } from "@/app/(game)/team/_components/reinforce-tab";

/**
 * Forces — the in-flight rollup of everything the player has dispatched into
 * the world. Reuses RallyTab + ReinforceTab with their create/send forms
 * hidden (those moved to the EntityPanel composers). Castle garrisons get
 * their own section once the underlying list view is factored out.
 *
 * This is the retirement home for the old /team Rally + Reinforce tabs —
 * everything spatial lives on /map now; /team keeps team administration.
 */
export function ForcesTab() {
  return (
    <div className="space-y-6">
      <RallyTab hideComposer />
      <ReinforceTab hideComposer />
    </div>
  );
}
