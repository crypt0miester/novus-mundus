"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useAllCities } from "@/lib/hooks/useAllCities";
import { cityType } from "@/lib/narrative";
import { cn } from "@/lib/utils";
import { GameIcon, type GameIconId } from "@/components/shared/GameIcon";
import { BeatButton, BeatEyebrow } from "./Beat";
import type { CityChoice } from "./Arrival";

interface ChoiceBeatProps {
  onChoose: (city: CityChoice) => void;
}

/** City-type icon, indexed by the on-chain CityType enum (SDK):
 *  0 Capital · 1 Resource · 2 Combat · 3 Trade. */
const CITY_TYPE_ICON: readonly GameIconId[] = [
  "map-capital",
  "map-resource",
  "map-combat",
  "map-trade",
];

/**
 * Beat 2 of the Arrival — where you make your stand.
 *
 * 24 cities is too much of a wall for a newcomer, so the picker is a single
 * horizontal strip with one settlement *recommended* and centred. The default
 * needs no thought; scrolling the strip reveals every other ground for those
 * who have a preference.
 */
export function ChoiceBeat({ onChoose }: ChoiceBeatProps) {
  const { data: cities } = useAllCities();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const recRef = useRef<HTMLButtonElement>(null);
  const centeredRef = useRef(false);

  // Recommend the least-crowded settlement — a gentler, less-contested start.
  const recommendedId = useMemo(() => {
    if (cities.length === 0) return null;
    return [...cities].sort(
      (a, b) =>
        a.account.playersPresent - b.account.playersPresent || a.account.cityId - b.account.cityId,
    )[0]!.account.cityId;
  }, [cities]);

  // Order the strip so the recommended city sits dead centre, the rest split
  // around it — every settlement still reachable by scrolling either way.
  const ordered = useMemo(() => {
    if (recommendedId === null) return cities;
    const rec = cities.find((c) => c.account.cityId === recommendedId);
    const rest = cities.filter((c) => c.account.cityId !== recommendedId);
    if (!rec) return cities;
    const half = Math.floor(rest.length / 2);
    return [...rest.slice(0, half), rec, ...rest.slice(half)];
  }, [cities, recommendedId]);

  // Centre the strip on the recommended card once, when the cities first
  // resolve. Guarded so a background city refetch (a new `ordered` identity)
  // can't yank the strip back while the player is scrolling it.
  useEffect(() => {
    if (centeredRef.current || !recRef.current) return;
    centeredRef.current = true;
    recRef.current.scrollIntoView({ inline: "center", block: "nearest" });
  }, [ordered]);

  const effectiveId = selectedId ?? recommendedId;
  const selected = cities.find((c) => c.account.cityId === effectiveId) ?? null;
  const framing = selected ? cityType(selected.account.cityType) : null;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col items-center">
      <BeatEyebrow className="mb-2 lowercase">The Choice</BeatEyebrow>
      <h2 className="tier-title mb-2 font-display text-2xl font-bold tracking-wide lowercase">
        Where you make your stand
      </h2>
      <p className="mb-7 max-w-md text-center text-sm leading-relaxed text-text-secondary lowercase">
        Every settlement was raised on the bones of an old-world city. The ground you choose decides
        the life you will fight for.
      </p>

      {cities.length === 0 ? (
        <p className="animate-pulse text-sm text-text-muted lowercase">Reading the maps…</p>
      ) : (
        <div className="relative w-full">
          {/* Edge fades hint at the settlements that scroll off either side. */}
          <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-12 bg-gradient-to-r from-surface to-transparent" />
          <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-12 bg-gradient-to-l from-surface to-transparent" />
          <div className="flex snap-x snap-mandatory gap-2.5 overflow-x-auto px-12 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {ordered.map((c) => {
              const acc = c.account;
              const active = effectiveId === acc.cityId;
              const isRec = acc.cityId === recommendedId;
              const t = cityType(acc.cityType);
              return (
                <button
                  key={acc.cityId}
                  ref={isRec ? recRef : undefined}
                  onClick={() => setSelectedId(acc.cityId)}
                  className={cn(
                    "flex w-36 shrink-0 snap-center flex-col items-center gap-1 rounded-lg border p-3 text-center transition-all",
                    active
                      ? "border-border-gold-bright bg-surface-overlay ring-1 ring-[var(--nm-accent)]"
                      : isRec
                        ? "border-border-gold bg-surface-raised"
                        : "border-border-default bg-surface-raised hover:border-border-gold",
                  )}
                >
                  <span
                    className={cn(
                      "text-[9px] font-semibold lowercase tracking-wider",
                      isRec ? "text-text-gold" : "text-transparent",
                    )}
                  >
                    recommended
                  </span>
                  <GameIcon
                    id={CITY_TYPE_ICON[acc.cityType] ?? "map-capital"}
                    title={t.name}
                    size={30}
                  />
                  <span className="text-sm font-semibold text-text-primary lowercase">
                    {acc.name}
                  </span>
                  <span className="text-[11px] text-text-muted lowercase">
                    {t.name} · {acc.playersPresent} here
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* The chosen ground, framed in fiction */}
      <div className="mt-6 flex min-h-[3.75rem] max-w-md items-center text-center">
        {framing ? (
          <p className="text-sm leading-relaxed text-text-secondary lowercase">
            <span className="text-text-gold">{framing.name}.</span> {framing.line}
          </p>
        ) : (
          <p className="text-sm text-text-muted lowercase">Choose your ground.</p>
        )}
      </div>

      <BeatButton
        disabled={!selected}
        className="mt-5 px-6 lowercase"
        onClick={() => {
          if (!selected) return;
          const a = selected.account;
          onChoose({
            cityId: a.cityId,
            name: a.name,
            cityType: a.cityType,
            latitude: a.latitude,
            longitude: a.longitude,
          });
        }}
      >
        {selected ? `drive your stakes at ${selected.account.name}` : "choose your ground"}
      </BeatButton>
    </div>
  );
}
