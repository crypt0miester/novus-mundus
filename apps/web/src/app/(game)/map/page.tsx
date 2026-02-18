"use client";

import { usePlayer } from "@/lib/hooks/usePlayer";
import { useAllCities } from "@/lib/hooks/useAllCities";
import { PageTransition } from "@/components/shared/PageTransition";
import Link from "next/link";

const CITY_TYPE_LABELS = ["Capital", "Resource", "Combat", "Trade"];

export default function MapPage() {
  const { data: playerData } = usePlayer();
  const { data: cities, isLoading: citiesLoading } = useAllCities();

  const player = playerData?.account;
  const currentCity = player?.currentCity;

  return (
    <PageTransition>
      <div className="mx-auto max-w-5xl space-y-6">
        <h1 className="tier-title font-display text-3xl font-bold tracking-wide">WORLD MAP</h1>

        {/* Current Location */}
        {player && (
          <div className="card accent-border">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs text-text-muted">Your Location</div>
                <div className="text-lg font-semibold text-text-gold">
                  {cities?.find((c) => c.account.cityId === currentCity)?.account.name || `City ${currentCity}`}
                </div>
              </div>
              <Link
                href="/travel"
                className="accent-border rounded-lg bg-surface-raised px-4 py-2 text-sm font-medium text-text-gold transition-all"
              >
                Travel
              </Link>
            </div>
          </div>
        )}

        {/* City Grid */}
        <div>
          <h2 className="mb-3 text-lg font-semibold text-text-primary">Cities</h2>
          {citiesLoading ? (
            <div className="card">
              <p className="text-sm text-text-muted">Loading cities...</p>
            </div>
          ) : !cities || cities.length === 0 ? (
            <div className="card">
              <p className="text-sm text-text-muted">No cities initialized yet.</p>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-3">
              {cities.map((city) => {
                const isHere = city.account.cityId === currentCity;
                return (
                  <div
                    key={city.account.cityId}
                    className={`card transition-all ${
                      isHere ? "accent-border-bright" : "hover:"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="text-lg font-semibold text-text-primary">
                        {city.account.name || `City ${city.account.cityId}`}
                      </div>
                      {isHere && (
                        <span className="text-xs text-amber-400">You are here</span>
                      )}
                    </div>
                    <div className="mt-1 text-xs text-text-muted">
                      {CITY_TYPE_LABELS[city.account.cityType] || "Unknown"} &middot; {city.account.playersPresent} players
                    </div>
                    <div className="mt-1 text-xs text-text-muted">
                      Encounters Lv {city.account.minEncounterLevel}–{city.account.maxEncounterLevel}
                    </div>
                    {!isHere && (
                      <Link
                        href="/travel"
                        className="mt-2 block text-center text-xs font-semibold text-text-gold"
                      >
                        Travel here
                      </Link>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="card text-center">
          <p className="text-sm text-text-muted">
            Full interactive map with terrain data coming soon. Use the terrain builder for preview.
          </p>
        </div>
      </div>
    </PageTransition>
  );
}
