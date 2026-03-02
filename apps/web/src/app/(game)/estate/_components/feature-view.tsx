"use client";

import Link from "next/link";
import { BuildingId, BuildingName } from "@/lib/hooks/useFeatureGate";
import { FeatureGate } from "@/components/shared/FeatureGate";
import { FEATURES } from "@/lib/hooks/useFeatureGate";
import { BUILDING_FEATURE_MAP } from "@/lib/config/building-features";
import { ResearchTab } from "./research-tab";
import { ForgeTab } from "./forge-tab";
import { MarketTab } from "./market-tab";
import { SanctuaryTab } from "./sanctuary-tab";
import { InfirmaryTab } from "./infirmary-tab";
import { WorkshopTab } from "./workshop-tab";

/** Map building IDs to their feature tab component and gate feature */
const FEATURE_VIEWS: Record<
  number,
  { component: React.ComponentType; feature?: string; label: string }
> = {
  [BuildingId.Academy]: {
    component: ResearchTab,
    feature: FEATURES.RESEARCH_START,
    label: "Research",
  },
  [BuildingId.Forge]: {
    component: ForgeTab,
    feature: FEATURES.FORGE_CRAFT,
    label: "Forge",
  },
  [BuildingId.Market]: {
    component: MarketTab,
    label: "Market",
  },
  [BuildingId.Sanctuary]: {
    component: SanctuaryTab,
    feature: FEATURES.SANCTUARY_MEDITATE,
    label: "Sanctuary",
  },
  [BuildingId.Infirmary]: {
    component: InfirmaryTab,
    label: "Infirmary",
  },
  [BuildingId.Workshop]: {
    component: WorkshopTab,
    label: "Workshop",
  },
};

interface FeatureViewProps {
  buildingId: number;
}

export function FeatureView({ buildingId }: FeatureViewProps) {
  const view = FEATURE_VIEWS[buildingId];
  const buildingName =
    BUILDING_FEATURE_MAP.get(buildingId)?.name ??
    BuildingName[buildingId] ??
    `Building #${buildingId}`;

  if (!view) {
    return (
      <div className="space-y-4">
        <Breadcrumb buildingName={buildingName} />
        <div className="card text-center">
          <p className="text-sm text-text-muted">
            No feature view available for {buildingName}.
          </p>
        </div>
      </div>
    );
  }

  const { component: Component, feature, label } = view;

  return (
    <div className="flex h-full flex-col gap-3">
      <Breadcrumb buildingName={label} />
      {feature ? (
        <FeatureGate feature={feature}>
          <Component />
        </FeatureGate>
      ) : (
        <Component />
      )}
    </div>
  );
}

function Breadcrumb({ buildingName }: { buildingName: string }) {
  return (
    <nav className="flex items-center gap-1.5 text-xs text-text-muted">
      <Link href="/estate" className="hover:text-text-secondary transition-colors">
        Estate
      </Link>
      <span>&rsaquo;</span>
      <span className="text-text-primary font-medium">{buildingName}</span>
    </nav>
  );
}

/** Check if a building ID has a center feature view */
export function hasCenterView(buildingId: number): boolean {
  return buildingId in FEATURE_VIEWS;
}
