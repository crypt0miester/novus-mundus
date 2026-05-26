"use client";

import type { HeroData } from "./types";

interface UnlockedHeroCardProps {
  hero: HeroData;
  isSelected: boolean;
  onClick: () => void;
}

export function UnlockedHeroCard({ hero, isSelected, onClick }: UnlockedHeroCardProps) {
  const attrs = hero.asset.attributes;
  const level = attrs["Level"] ? parseInt(attrs["Level"]) : null;

  return (
    <div
      onClick={onClick}
      className={`card cursor-pointer border-dashed transition-all ${
        isSelected ? "ring-1 ring-[var(--nm-accent)]" : "border-zinc-700"
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-text-primary">
            {hero.asset.name || "Hero"}
          </div>
          <div className="text-[10px] font-medium text-text-gold">Unlocked</div>
        </div>
        {level != null && (
          <div className="ml-2 text-lg font-bold text-text-gold">{level}</div>
        )}
      </div>
    </div>
  );
}
