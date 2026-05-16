"use client";

import { useState } from "react";
import { useAllCities } from "@/lib/hooks/useAllCities";
import { cityType } from "@/lib/narrative";
import { cn } from "@/lib/utils";
import { BeatButton, BeatEyebrow } from "./Beat";
import type { CityChoice } from "./Arrival";

interface ChoiceBeatProps {
  onChoose: (city: CityChoice) => void;
}

/** Beat 2 of the Arrival — where you make your stand. */
export function ChoiceBeat({ onChoose }: ChoiceBeatProps) {
  const { data: cities } = useAllCities();
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const selected = cities.find((c) => c.account.cityId === selectedId) ?? null;
  const framing = selected ? cityType(selected.account.cityType) : null;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col items-center">
      <BeatEyebrow className="mb-2">The Choice</BeatEyebrow>
      <h2 className="tier-title mb-2 font-display text-2xl font-bold tracking-wide">
        Where you make your stand
      </h2>
      <p className="mb-7 max-w-md text-center text-sm leading-relaxed text-text-secondary">
        Every settlement was raised on the bones of an old-world city. The ground
        you choose decides the life you will fight for.
      </p>

      {cities.length === 0 ? (
        <p className="animate-pulse text-sm text-text-muted">Reading the maps…</p>
      ) : (
        <div className="grid w-full grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
          {cities.map((c) => {
            const acc = c.account;
            const active = selectedId === acc.cityId;
            const t = cityType(acc.cityType);
            return (
              <button
                key={acc.cityId}
                onClick={() => setSelectedId(acc.cityId)}
                className={cn(
                  "flex flex-col gap-1 rounded-lg border p-3 text-left transition-all",
                  active
                    ? "border-border-gold-bright bg-surface-overlay ring-1 ring-[var(--nm-accent)]"
                    : "border-border-default bg-surface-raised hover:border-border-gold",
                )}
              >
                <span className="text-sm font-semibold text-text-primary">
                  {t.icon} {acc.name}
                </span>
                <span className="text-[11px] text-text-muted">
                  {t.name} · {acc.playersPresent} here
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* The chosen ground, framed in fiction */}
      <div className="mt-6 flex min-h-[3.75rem] max-w-md items-center text-center">
        {framing ? (
          <p className="text-sm leading-relaxed text-text-secondary">
            <span className="text-text-gold">{framing.name}.</span> {framing.line}
          </p>
        ) : (
          <p className="text-sm text-text-muted">Choose your ground.</p>
        )}
      </div>

      <BeatButton
        disabled={!selected}
        className="mt-5 px-6"
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
        {selected ? `Drive your stakes at ${selected.account.name}` : "Choose your ground"}
      </BeatButton>
    </div>
  );
}
