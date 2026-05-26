"use client";

import { GameIcon, buffStatIcon } from "@/components/shared/GameIcon";
import { getActiveBuffs, getBuffStatMeta } from "novus-mundus-sdk";
import type { TemplateInfo } from "./types";

interface TemplateCardProps {
  template: TemplateInfo;
  isSelected: boolean;
  onClick: () => void;
}

export function TemplateCard({ template: t, isSelected, onClick }: TemplateCardProps) {
  const buffs = getActiveBuffs(t.account);
  const supply =
    t.account.supplyCap > 0
      ? `${t.account.mintedCount}/${t.account.supplyCap}`
      : `${t.account.mintedCount}`;

  return (
    <div
      onClick={onClick}
      className={`card cursor-pointer transition-all ${
        t.minted ? "opacity-50 border-green-900/40" : ""
      } ${isSelected ? "ring-1 ring-[var(--nm-accent)]" : ""}`}
    >
      <div className="flex items-center justify-between">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-text-primary">
            {t.account.name}
          </div>
          <div className="text-[10px] text-text-muted">
            #{t.account.templateId} · {supply}
          </div>
        </div>
        {t.minted && (
          <span className="shrink-0 rounded-full bg-green-900/30 px-2 py-0.5 text-[10px] font-medium text-green-400">
            Minted
          </span>
        )}
      </div>
      {buffs.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {buffs.map((b) => {
            const icon = buffStatIcon(b.stat);
            return (
              <span
                key={b.stat}
                className="flex items-center gap-1 rounded bg-surface px-1 py-0.5 text-[10px] text-text-muted"
              >
                {icon ? (
                  <GameIcon id={icon} title={getBuffStatMeta(b.stat)?.name} size={13} />
                ) : (
                  <>{getBuffStatMeta(b.stat)?.abbr ?? "?"}</>
                )}
                <span className="font-mono text-text-secondary">{b.baseBps}</span>
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
