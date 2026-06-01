"use client";

import type { HeroData } from "./types";

interface HeroSlotCardProps {
  index: number;
  hero: HeroData | null;
  isEmpty: boolean;
  isDefensive: boolean;
  isMeditating: boolean;
  isSelected: boolean;
  onClick: () => void;
  /** Hint shown on empty cards — names the next action a player can take. */
  emptyHint?: string;
}

export function HeroSlotCard({
  index,
  hero,
  isEmpty,
  isDefensive,
  isMeditating,
  isSelected,
  onClick,
  emptyHint,
}: HeroSlotCardProps) {
  if (isEmpty) {
    return (
      <div className="card flex flex-col items-center justify-center gap-1 py-4 text-center opacity-60">
        <div className="text-[10px] uppercase tracking-wider text-text-muted">
          Slot {index} · Empty
        </div>
        {emptyHint && (
          <div className="px-1 text-[10px] leading-tight text-text-muted">{emptyHint}</div>
        )}
      </div>
    );
  }

  const attrs = hero?.asset?.attributes ?? {};
  const level = attrs.Level ? parseInt(attrs.Level, 10) : null;
  const roleLabel = isDefensive ? "DEF" : isMeditating ? "MED" : "ACT";
  const roleColor = isDefensive
    ? "text-text-secondary"
    : isMeditating
      ? "text-text-muted"
      : "text-text-gold";

  return (
    <div
      onClick={onClick}
      className={`card cursor-pointer transition-all ${
        isSelected ? "ring-1 ring-[var(--nm-accent)]" : ""
      } ${isMeditating ? "accent-border-bright" : "accent-border"}`}
    >
      <div className="flex items-center justify-between">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-text-primary">
            {hero?.asset?.name || `Hero #${index + 1}`}
          </div>
          <div className={`text-[10px] font-medium ${roleColor}`}>
            {roleLabel}
          </div>
        </div>
        {level != null && <div className="ml-2 text-lg font-bold text-text-gold">{level}</div>}
      </div>
    </div>
  );
}
