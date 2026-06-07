"use client";

import { useMemo } from "react";
import { useEstate } from "@/lib/hooks/useEstate";
import { useRightPanelStore } from "@/lib/store/right-panel";
import { InfoButton } from "@/components/shared/InfoButton";
import { BUILDING_FEATURES, CATEGORY_COLORS, CATEGORY_ORDER, tierColor } from "@/lib/config/building-features";
import { deriveBuildingInfo } from "@/app/(game)/estate/_components/estate-layout";

/**
 * The global build picker, opened from a break-ground site. Lists every
 * building the holding has not yet raised, grouped by category, and routes a
 * choice to the existing build detail view. The picker is global by design: the
 * chain auto-places into the next free slot (find_empty_slot), so tapping any
 * site shows all unbuilt types, not a per-square binding.
 */
export function BuildingPickerPanel() {
  const { data: estateData } = useEstate();
  const estate = estateData?.account;
  const show = useRightPanelStore((s) => s.show);

  // The unbuilt set is time-independent (a building is unbuilt only while its
  // slot is Empty), so a zero tick is enough; the estate query re-renders this
  // when a build lands. Keyed on estate alone to avoid per-render rederivation.
  const grouped = useMemo(() => {
    const unbuilt = deriveBuildingInfo(estate, 0).filter((b) => b.phase === "unbuilt");
    return CATEGORY_ORDER.map((category) => ({
      category,
      items: unbuilt.filter((b) => b.config.category === category),
    })).filter((g) => g.items.length > 0);
  }, [estate]);

  if (grouped.length === 0) {
    return (
      <div className="rounded-lg border border-border-gold/50 bg-accent/10 px-4 py-6 text-center">
        <p className="text-sm font-semibold text-text-gold">Every building raised</p>
        <p className="mt-1 text-xs text-text-muted">
          Your holding has broken ground on all {BUILDING_FEATURES.length} building types. Upgrade
          what stands.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="flex items-center gap-1 text-xs text-text-muted">
        Choose your next building.
        <InfoButton>
          Your holding raises one of each building type. Picking here opens the build view; the
          chain raises it in the next free slot on a plot you own.
        </InfoButton>
      </p>

      {grouped.map(({ category, items }) => (
        <div key={category}>
          <h4
            className={`mb-1.5 text-[10px] font-semibold uppercase tracking-wider ${CATEGORY_COLORS[category]}`}
          >
            {category}
          </h4>
          <div className="flex flex-col gap-1.5">
            {items.map((b) => (
              <button
                key={b.config.id}
                type="button"
                onClick={() => show(b.config.name, "building-detail", { buildingId: b.config.id })}
                className="flex items-start justify-between gap-3 rounded-lg border border-border-default bg-surface-raised px-3 py-2 text-left transition-colors hover:border-border-gold/60 hover:bg-accent/10"
              >
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-text-primary">
                    {b.config.name}
                  </span>
                  <span className="block text-[11px] text-text-muted">{b.config.desc}</span>
                </span>
                <span className={`shrink-0 text-[11px] font-bold ${tierColor(b.config.tier)}`}>
                  T{b.config.tier}
                </span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
