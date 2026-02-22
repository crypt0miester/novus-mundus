"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useWorldCities, useCitizenStatus } from "@/lib/hooks/world";
import { GoldNumber } from "@/components/shared/GoldNumber";
import { Badge } from "@/components/shared/Badge";
import { cn } from "@/lib/utils";

const CITY_TYPE_LABELS = ["Capital", "Trade", "Combat", "Resource"] as const;
const CITY_TYPE_VARIANTS = ["legendary", "gold", "danger", "success"] as const;

export function CityBrowser() {
  const { data: cities, isLoading } = useWorldCities();
  const citizen = useCitizenStatus();

  const sorted = useMemo(() => {
    if (!cities) return [];
    return [...cities].sort(
      (a, b) => b.account.playersPresent - a.account.playersPresent
    );
  }, [cities]);

  if (isLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-text-muted">
        Loading cities...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {sorted.map((c) => {
          const city = c.account;
          const typeIndex = Math.min(city.cityType, 3);
          const isCurrentCity =
            citizen.isCitizen &&
            citizen.player &&
            citizen.player.currentCity === city.cityId;

          return (
            <Link
              key={c.pubkey.toBase58()}
              href={`/world/cities/${city.cityId}`}
              className={cn(
                "card transition-all",
                isCurrentCity && "accent-border-bright"
              )}
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold text-text-primary">
                    {city.name}
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <Badge variant={CITY_TYPE_VARIANTS[typeIndex] as any}>
                      {CITY_TYPE_LABELS[typeIndex]}
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
                ({city.latitude.toFixed(2)}, {city.longitude.toFixed(2)}) &middot;{" "}
                Lv {city.minEncounterLevel}-{city.maxEncounterLevel} encounters
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
    </div>
  );
}
