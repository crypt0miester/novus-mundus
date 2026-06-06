"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useWorldCities, useCitizenStatus } from "@/lib/hooks/world";
import { GoldNumber } from "@/components/shared/GoldNumber";
import { Badge, type BadgeVariant } from "@/components/shared/Badge";
import { ViewToggle } from "@/components/shared/ViewToggle";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { useViewMode } from "@/lib/hooks/useViewMode";
import { cn } from "@/lib/utils";
import { CITY_TYPE_NAMES } from "novus-mundus-sdk";

// Variant order matches the on-chain CityType enum (Capital, Resource, Combat, Trade).
const CITY_TYPE_VARIANTS: readonly BadgeVariant[] = ["legendary", "success", "danger", "gold"];

export function CityBrowser() {
  const { data: cities, isLoading } = useWorldCities();
  const citizen = useCitizenStatus();
  const [view, setView] = useViewMode("cities");

  const sorted = useMemo(() => {
    if (!cities) return [];
    return [...cities].sort((a, b) => b.account.playersPresent - a.account.playersPresent);
  }, [cities]);

  const isHere = (cityId: number) => citizen.isCitizen && citizen.player?.currentCity === cityId;

  const columns: Column<(typeof sorted)[number]>[] = [
    {
      key: "city",
      header: "City",
      cell: (c) => (
        <Link
          href={`/cities/${c.account.cityId}`}
          className="font-medium text-text-primary transition-colors hover:text-text-gold"
        >
          {c.account.name}
          {isHere(c.account.cityId) && (
            <span className="ml-2 text-[10px] font-semibold text-text-gold">You are here</span>
          )}
        </Link>
      ),
    },
    {
      key: "type",
      header: "Type",
      className: "w-28",
      cell: (c) => {
        const i = Math.min(c.account.cityType, 3);
        return <Badge variant={CITY_TYPE_VARIANTS[i]}>{CITY_TYPE_NAMES[i]}</Badge>;
      },
    },
    {
      key: "encounters",
      header: "Encounters",
      className: "hidden w-32 sm:table-cell",
      cell: (c) => `Lv ${c.account.minEncounterLevel}-${c.account.maxEncounterLevel}`,
    },
    {
      key: "players",
      header: "Players",
      align: "right",
      className: "w-24",
      cell: (c) => <GoldNumber value={c.account.playersPresent} size="sm" />,
    },
  ];

  if (isLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-text-muted">
        Loading cities...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-text-muted">
          {sorted.length} cit{sorted.length === 1 ? "y" : "ies"}
        </span>
        <ViewToggle mode={view} onChange={setView} />
      </div>

      {view === "grid" ? (
        <>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {sorted.map((c) => {
              const city = c.account;
              const typeIndex = Math.min(city.cityType, 3);
              const isCurrentCity = isHere(city.cityId);

              return (
                <Link
                  key={c.pubkey.toBase58()}
                  href={`/cities/${city.cityId}`}
                  className={cn("card transition-all", isCurrentCity && "accent-border-bright")}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-semibold text-text-primary">{city.name}</div>
                      <div className="mt-1 flex items-center gap-2">
                        <Badge variant={CITY_TYPE_VARIANTS[typeIndex]}>
                          {CITY_TYPE_NAMES[typeIndex]}
                        </Badge>
                        {isCurrentCity && (
                          <span className="text-[10px] font-semibold text-text-gold">
                            You are here
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-text-muted">Players</div>
                      <GoldNumber value={city.playersPresent} size="sm" />
                    </div>
                  </div>
                  <div className="mt-2 text-[10px] text-text-muted">
                    ({city.latitude.toFixed(2)}, {city.longitude.toFixed(2)}) &middot; Lv{" "}
                    {city.minEncounterLevel}-{city.maxEncounterLevel} encounters
                  </div>
                </Link>
              );
            })}
          </div>

          {sorted.length === 0 && (
            <div className="card">
              <p className="text-sm text-text-muted">No cities found.</p>
            </div>
          )}
        </>
      ) : (
        <DataTable
          columns={columns}
          rows={sorted}
          rowKey={(c) => c.pubkey.toBase58()}
          rowClassName={(c) => (isHere(c.account.cityId) ? "bg-accent/10" : "")}
          empty="No cities found."
        />
      )}
    </div>
  );
}
