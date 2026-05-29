"use client";

import { useState, useEffect } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { findBuilding, formatNoviAmount } from "novus-mundus-sdk";
import { BuildingId, BuildingName, FEATURES } from "@/lib/hooks/useFeatureGate";
import { FeatureGate } from "@/components/shared/FeatureGate";
import { TxButton } from "@/components/shared/TxButton";
import { BUILDING_FEATURE_MAP, CATEGORY_COLORS } from "@/lib/config/building-features";
import { useEstate } from "@/lib/hooks/useEstate";
import { useEstateActions } from "@/lib/hooks/useEstateActions";
import { useRightPanelStore } from "@/lib/store/right-panel";
import { buildingPhase } from "@/lib/narrative";
import { formatTime } from "@/lib/utils";
import { ResearchTab } from "./research-tab";
import { ForgeTab } from "./forge-tab";
import { MarketTab } from "./market-tab";
import { SanctuaryTab } from "./sanctuary-tab";
import { InfirmaryTab } from "./infirmary-tab";
import { WorkshopTab } from "./workshop-tab";
import { BarracksTab } from "./barracks-tab";
import { CampTab } from "./camp-tab";
import { MineTab } from "./mine-tab";
import { FarmTab } from "./farm-tab";
import { DockTab } from "./dock-tab";
import { VaultTab } from "./vault-tab";
import { MansionTab } from "./mansion-tab";
import { ArenaTab } from "./arena-tab";
import { CatacombsTab } from "./catacombs-tab";
import { DailyActivityPanel } from "./daily-activity/DailyActivityPanel";

/** Map building IDs to their feature tab component and gate feature. */
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
  // The Market-unbundled views (§6.0–6.4, §6.8). Each gates itself internally —
  // leading with the Cairn's framing and inline requirement links — so no
  // registry-level `feature` key, mirroring Infirmary/Workshop.
  [BuildingId.Barracks]: {
    component: BarracksTab,
    label: "Barracks",
  },
  [BuildingId.Camp]: {
    component: CampTab,
    label: "Camp",
  },
  [BuildingId.Mine]: {
    component: MineTab,
    label: "Mine",
  },
  [BuildingId.Farm]: {
    component: FarmTab,
    label: "Farm",
  },
  [BuildingId.Dock]: {
    component: DockTab,
    label: "Dock",
  },
  [BuildingId.Vault]: {
    component: VaultTab,
    label: "Vault",
  },
  [BuildingId.Mansion]: {
    component: MansionTab,
    label: "Mansion",
  },
  [BuildingId.Arena]: {
    component: ArenaTab,
    feature: FEATURES.ARENA_JOIN,
    label: "Arena",
  },
  [BuildingId.Catacombs]: {
    component: CatacombsTab,
    feature: FEATURES.DUNGEON_ENTER,
    label: "Dungeon",
  },
  [BuildingId.Observatory]: {
    component: ObservatoryActivity,
    label: "Star Reading",
  },
  [BuildingId.Treasury]: {
    component: TreasuryActivity,
    label: "Ledger Audit",
  },
};

/** The estate daily-activity mini-game, framed as a building's center view. */
function DailyActivityFeature({ building }: { building: number }) {
  return (
    <div className="mx-auto w-full max-w-2xl">
      <DailyActivityPanel building={building} />
    </div>
  );
}

function ObservatoryActivity() {
  return <DailyActivityFeature building={BuildingId.Observatory} />;
}

function TreasuryActivity() {
  return <DailyActivityFeature building={BuildingId.Treasury} />;
}

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
      <div className="mx-auto flex h-full w-full max-w-5xl flex-col gap-3">
        <BuildingStrip buildingId={buildingId} />
        <div className="min-h-0 flex-1 overflow-y-auto pb-18 md:pb-0">
          <div className="card text-center">
            <p className="text-sm text-text-muted">No feature view available for {buildingName}.</p>
          </div>
        </div>
      </div>
    );
  }

  const { component: Component, feature } = view;

  return (
    <div className="mx-auto flex h-full w-full max-w-5xl flex-col gap-3">
      <BuildingStrip buildingId={buildingId} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {feature ? (
          <FeatureGate feature={feature}>
            <Component />
          </FeatureGate>
        ) : (
          <Component />
        )}
      </div>
    </div>
  );
}

/**
 * The building strip — a building's header inside its feature view. It names
 * the building and surfaces the one action its lifecycle phase allows, so a
 * player uses a building and manages its upgrade from the same place.
 */
function BuildingStrip({ buildingId }: { buildingId: number }) {
  const { data: estateData } = useEstate();
  const show = useRightPanelStore((s) => s.show);
  const { handleCompleteBuilding, getBuildCostInfo } = useEstateActions();

  const config = BUILDING_FEATURE_MAP.get(buildingId);
  const slot = estateData?.account ? findBuilding(estateData.account, buildingId) : null;

  const [tick, setTick] = useState(() => Math.floor(Date.now() / 1000));
  const phase = buildingPhase(slot, tick);
  useEffect(() => {
    if (phase !== "improving") return;
    const t = setInterval(() => setTick(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, [phase]);

  const name = config?.name ?? BuildingName[buildingId] ?? `Building #${buildingId}`;
  const level = slot?.level ?? 0;
  const categoryColor = config ? CATEGORY_COLORS[config.category] : "text-text-muted";

  const startedAt = slot?.constructionStarted?.toNumber?.() ?? 0;
  const endsAt = slot?.constructionEnds?.toNumber?.() ?? 0;
  const span = endsAt - startedAt;
  const pct = span > 0 ? Math.min(100, Math.max(0, ((tick - startedAt) / span) * 100)) : 0;
  const remaining = Math.max(0, endsAt - tick);

  const status =
    phase === "improving" ? (
      <>
        Level {level} <ChevronRight className="inline-block h-3 w-3 align-middle" /> {level + 1} ·{" "}
        {formatTime(remaining, "compact")} left
      </>
    ) : phase === "improved" ? (
      <>
        Level {level} <ChevronRight className="inline-block h-3 w-3 align-middle" /> {level + 1} ·{" "}
        ready
      </>
    ) : (
      `Level ${level}`
    );

  // Surface the next upgrade's NOVI cost on the standing-phase button, read
  // live from the building template — no need to open the panel to see it.
  const costInfo = phase === "standing" ? getBuildCostInfo(buildingId) : null;
  const upgradeLabel =
    costInfo && !costInfo.atMaxLevel
      ? `Upgrade · ${formatNoviAmount(costInfo.baseCost)} NOVI`
      : "Upgrade";

  return (
    <header className="relative shrink-0 overflow-hidden rounded-lg border border-border-default bg-surface-raised px-4 py-3 animate-in fade-in duration-300">
      <Link
        href="/estate"
        className="inline-flex items-center gap-1 text-[11px] text-text-muted transition-colors hover:text-text-gold"
      >
        <ChevronLeft className="h-3 w-3" />
        Estate
      </Link>

      <div className="mt-1 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <h2 className="tier-title font-display text-xl font-bold tracking-wide">{name}</h2>
          <p
            className={`mt-0.5 flex items-baseline justify-between gap-3 font-mono text-[11px] tabular-nums ${
              phase === "improved" ? "text-text-gold" : "text-text-muted"
            }`}
          >
            <span>{status}</span>
            {config && (
              <span
                className={`shrink-0 text-[10px] font-medium uppercase tracking-[0.18em] ${categoryColor} opacity-70`}
              >
                {config.category}
              </span>
            )}
          </p>
        </div>

        {phase === "standing" && (
          <button
            onClick={() => show(name, "building-detail", { buildingId })}
            className="w-full shrink-0 rounded-md border border-border-gold bg-surface-raised px-4 py-2 text-xs font-semibold text-text-gold transition-colors hover:bg-surface-overlay sm:w-auto sm:py-1.5"
          >
            {upgradeLabel}
          </button>
        )}
        {phase === "improving" && (
          <button
            onClick={() => show(name, "building-detail", { buildingId })}
            className="w-full shrink-0 rounded-md border border-border-default px-3.5 py-2 text-xs font-medium text-text-secondary transition-colors hover:border-border-gold hover:text-text-gold sm:w-auto sm:py-1.5"
          >
            Speed up
          </button>
        )}
        {phase === "improved" && (
          <div className="w-full shrink-0 sm:w-auto">
            <TxButton
              onClick={(rp) => handleCompleteBuilding(buildingId, rp)}
              className="w-full px-4 py-2 text-xs sm:w-auto sm:py-1.5"
            >
              Complete upgrade
            </TxButton>
          </div>
        )}
      </div>

      {phase === "improving" && (
        <div
          className="absolute bottom-0 left-0 h-[2px]"
          style={{
            width: `${pct}%`,
            background: "linear-gradient(90deg, var(--nm-accent), var(--nm-accent-bright))",
            transition: "width 1s linear",
          }}
        />
      )}
    </header>
  );
}

/** Check if a building ID has a center feature view. */
export function hasCenterView(buildingId: number): boolean {
  return buildingId in FEATURE_VIEWS;
}
