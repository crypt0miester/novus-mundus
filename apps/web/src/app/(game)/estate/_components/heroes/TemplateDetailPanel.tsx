"use client";

import { GameIcon, buffStatIcon } from "@/components/shared/GameIcon";
import { TxButton } from "@/components/shared/TxButton";
import type { TxPhase } from "@/components/shared/TxButton";
import { AbilityCard } from "@/components/heroes/AbilityCard";
import {
  canMintHero,
  getActiveBuffs,
  getBuffStatMeta,
  HERO_TIER_NAMES,
  HERO_TYPE_NAMES,
  HERO_CATEGORY_NAMES,
} from "novus-mundus-sdk";
import { burnReward, tierFromMintCost } from "./helpers";
import type { TemplateInfo } from "./types";

interface TemplateDetailPanelProps {
  template: TemplateInfo;
  playerLevel: number;
  traveling: boolean;
  onMint: (templateId: number, rp: (p: TxPhase) => void) => Promise<string>;
}

export function TemplateDetailPanel({
  template: t,
  playerLevel,
  traveling,
  onMint,
}: TemplateDetailPanelProps) {
  const buffs = getActiveBuffs(t.account);
  const meetsLevel = playerLevel >= t.account.requiredPlayerLevel;
  const mintable = canMintHero(t.account) && !t.minted && meetsLevel;
  const supply =
    t.account.supplyCap > 0
      ? `${t.account.mintedCount} / ${t.account.supplyCap}`
      : `${t.account.mintedCount} minted`;
  const mintCostLamports = Number(t.account.mintCostSol);
  const tier = tierFromMintCost(mintCostLamports);
  const costSol = mintCostLamports / 1_000_000_000;

  return (
    <>
      {/* Portrait — last surface before the Mint button, so the user sees the
          composited level-1 hero (halo + silhouette + city sigil + buffs +
          1 bronze ascension knot) rather than text-only stats. Preview mode
          skips the chain fetch; `template-${id}` is a stable placeholder so
          the silhouette flip/rotate fingerprint stays consistent per template. */}
      <div className="relative aspect-square w-full overflow-hidden rounded-lg border border-border-default bg-surface">
        <img
          src={`/heroes/template-${t.account.templateId}/image?preview=1&template=${t.account.templateId}&level=1`}
          alt={t.account.name}
          className="h-full w-full object-cover"
        />
      </div>

      <div className="flex items-center justify-between">
        <div>
          <div className="text-base font-semibold text-text-primary">{t.account.name}</div>
          <div className="text-[10px] text-text-muted">
            #{t.account.templateId} · {HERO_TIER_NAMES[tier]}
          </div>
        </div>
        {t.minted && (
          <span className="shrink-0 rounded-full bg-green-900/30 px-2 py-0.5 text-[10px] font-medium text-green-400">
            Minted
          </span>
        )}
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs">
          <span className="text-text-muted">Mint cost</span>
          <span className="font-mono text-text-primary">{costSol} SOL</span>
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-text-muted">Type</span>
          <span className="text-text-secondary">
            {HERO_TYPE_NAMES[t.account.heroType] ?? "Unknown"}
          </span>
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-text-muted">Category</span>
          <span className="text-text-secondary">
            {HERO_CATEGORY_NAMES[t.account.category] ?? "Unknown"}
          </span>
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-text-muted">Supply</span>
          <span className="font-mono text-text-secondary">{supply}</span>
        </div>
        {t.account.requiredPlayerLevel > 0 && (
          <div className="flex items-center justify-between text-xs">
            <span className="text-text-muted">Required level</span>
            <span className={`font-mono ${meetsLevel ? "text-text-secondary" : "text-red-400"}`}>
              Lv{t.account.requiredPlayerLevel} {!meetsLevel && `(you: ${playerLevel})`}
            </span>
          </div>
        )}
        <div className="flex items-center justify-between text-xs">
          <span className="text-text-muted">Burn value (Lv1)</span>
          <span className="font-mono text-text-secondary">
            {(burnReward(1, tier) / 10).toLocaleString()} NOVI
          </span>
        </div>
      </div>

      {buffs.length > 0 && (
        <div>
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
            Base Buffs
          </div>
          <div className="space-y-1">
            {buffs.map((b) => {
              const icon = buffStatIcon(b.stat);
              return (
                <div
                  key={b.stat}
                  className="flex items-center justify-between rounded bg-surface px-2 py-1"
                >
                  <span className="flex items-center gap-1.5 text-xs text-text-secondary">
                    {icon && <GameIcon id={icon} title={getBuffStatMeta(b.stat)?.name} size={18} />}
                    {getBuffStatMeta(b.stat)?.name ?? `Stat ${b.stat}`}
                  </span>
                  <span className="font-mono text-xs font-semibold text-text-primary">
                    +{(b.baseBps / 100).toFixed(1)}%
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <AbilityCard template={t.account} />

      <div className="hidden border-t border-border-default pt-3 lg:block">
        <TxButton
          onClick={(rp) => onMint(t.account.templateId, rp)}
          disabled={!mintable || traveling}
          className="w-full"
        >
          {t.minted ? "Already Minted" : `Mint`}
        </TxButton>
        {!mintable && !t.minted && (
          <p className="mt-1 text-center text-[10px] text-danger">
            {!meetsLevel
              ? `Requires player level ${t.account.requiredPlayerLevel} (you are ${playerLevel})`
              : t.account.supplyCap > 0 && t.account.mintedCount >= t.account.supplyCap
                ? "Supply exhausted"
                : "Not available"}
          </p>
        )}
      </div>
    </>
  );
}
