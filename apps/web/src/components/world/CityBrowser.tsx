"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Users, Skull, MapPin, Map as MapIcon } from "lucide-react";
import { useWorldCities, useCitizenStatus } from "@/lib/hooks/world";
import { GoldNumber } from "@/components/shared/GoldNumber";
import { ViewToggle } from "@/components/shared/ViewToggle";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { CityTypeTag } from "./CityTypeTag";
import { useViewMode } from "@/lib/hooks/useViewMode";
import { cn } from "@/lib/utils";

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
      cell: (c) => <CityTypeTag type={c.account.cityType} />,
    },
    {
      key: "encounters",
      header: "Encounters",
      className: "hidden w-32 sm:table-cell",
      cell: (c) => (
        <span className="inline-flex items-center gap-1 text-text-secondary">
          <Skull className="h-3.5 w-3.5 text-text-muted" aria-hidden />
          Lv {c.account.minEncounterLevel}-{c.account.maxEncounterLevel}
        </span>
      ),
    },
    {
      key: "players",
      header: "Players",
      align: "right",
      className: "w-24",
      cell: (c) => (
        <span className="inline-flex items-center justify-end gap-1">
          <Users className="h-3.5 w-3.5 text-text-muted" aria-hidden />
          <GoldNumber value={c.account.playersPresent} size="sm" />
        </span>
      ),
    },
    {
      key: "map",
      header: "",
      align: "right",
      className: "w-12",
      cell: (c) => (
        <Link
          href={`/map?city=${c.account.cityId}`}
          aria-label={`View ${c.account.name} on the map`}
          title="View on map"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-raised hover:text-text-gold"
        >
          <MapIcon className="h-4 w-4" aria-hidden />
        </Link>
      ),
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
        <div className="flex items-center gap-2">
          <Link
            href="/map"
            className="inline-flex items-center gap-1 rounded-lg border border-border-default px-2.5 py-1.5 text-xs text-text-secondary transition-colors hover:border-border-gold hover:text-text-primary"
          >
            <MapIcon className="h-3.5 w-3.5" aria-hidden />
            Map
          </Link>
          <ViewToggle mode={view} onChange={setView} />
        </div>
      </div>

      {view === "grid" ? (
        <>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {sorted.map((c) => {
              const city = c.account;
              const isCurrentCity = isHere(city.cityId);

              return (
                <div
                  key={c.pubkey.toBase58()}
                  className={cn("card", isCurrentCity && "accent-border-bright")}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <Link
                        href={`/cities/${city.cityId}`}
                        className="text-sm font-semibold text-text-primary transition-colors hover:text-text-gold"
                      >
                        {city.name}
                      </Link>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <CityTypeTag type={city.cityType} />
                        {isCurrentCity && (
                          <span className="text-[10px] font-semibold text-text-gold">
                            You are here
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="inline-flex items-center gap-1 text-text-secondary">
                        <Users className="h-3.5 w-3.5 text-text-muted" aria-hidden />
                        <GoldNumber value={city.playersPresent} size="sm" />
                      </span>
                      <Link
                        href={`/map?city=${city.cityId}`}
                        aria-label={`View ${city.name} on the map`}
                        title="View on map"
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-raised hover:text-text-gold"
                      >
                        <MapIcon className="h-4 w-4" aria-hidden />
                      </Link>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-text-muted">
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="h-3 w-3" aria-hidden />
                      {city.latitude.toFixed(2)}, {city.longitude.toFixed(2)}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Skull className="h-3 w-3" aria-hidden />
                      Lv {city.minEncounterLevel}-{city.maxEncounterLevel}
                    </span>
                  </div>
                </div>
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
