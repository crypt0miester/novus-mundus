"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { PublicKey } from "@solana/web3.js";
import { GameIcon, buffStatIcon } from "@/components/shared/GameIcon";
import { TxButton } from "@/components/shared/TxButton";
import type { TxPhase } from "@/components/shared/TxButton";
import { AbilityCard } from "@/components/heroes/AbilityCard";
import { getBuffStatByAttrKey } from "novus-mundus-sdk";
import { fragmentCost, IGNORED_ATTRS } from "./helpers";
import type { HeroData, Selection, TemplateInfo } from "./types";

interface Gate {
  allowed: boolean;
  missing: { label: string; narrative: string; href: string }[];
}

interface HeroDetailPanelProps {
  selected: Selection;
  hero: HeroData;
  templates: TemplateInfo[];
  fragments: number;
  levelCap: number;
  sanctuaryLevel: number;
  emptySlots: number;
  defensiveHeroSlot: number;
  traveling: boolean;
  lockGate: Gate;
  levelUpGate: Gate;
  lockSlot: number;
  onLevelUp: (heroMint: PublicKey, templateId: number, rp: (p: TxPhase) => void) => Promise<string>;
  onAssignDefensive: (slot: number, rp: (p: TxPhase) => void) => Promise<string>;
  onUnlock: (slot: number, rp: (p: TxPhase) => void) => Promise<string>;
  onLock: (
    heroAddress: PublicKey,
    slotIndex: number,
    templateId: number,
    rp: (p: TxPhase) => void,
  ) => Promise<string>;
  onBurn: (heroAddress: PublicKey, templateId: number, rp: (p: TxPhase) => void) => Promise<string>;
}

export function HeroDetailPanel({
  selected,
  hero,
  templates,
  fragments,
  levelCap,
  sanctuaryLevel,
  emptySlots,
  defensiveHeroSlot,
  traveling,
  lockGate,
  levelUpGate,
  lockSlot,
  onLevelUp,
  onAssignDefensive,
  onUnlock,
  onLock,
  onBurn,
}: HeroDetailPanelProps) {
  const attrs = hero.asset?.attributes ?? {};
  const level = attrs["Level"] ? parseInt(attrs["Level"]) : null;
  const xp = attrs["XP"] ? parseInt(attrs["XP"]) : null;
  const heroTemplateId = parseInt(attrs["Template"] || "0");
  const buffs = Object.entries(attrs).filter(
    ([key]) => !IGNORED_ATTRS.has(key) && key !== "Level" && key !== "XP",
  );

  const currentLevel = level ?? 0;
  const cost = fragmentCost(currentLevel);
  const canLevel =
    levelUpGate.allowed && fragments >= cost && currentLevel < levelCap && levelCap > 0;
  const atCap = currentLevel >= levelCap && levelCap > 0;

  const tpl = templates.find((e) => String(e.account.templateId) === attrs["Template"])?.account;
  const interactive =
    selected?.type === "locked"
      ? { heroMint: hero.address, slotIndex: (selected as { slot: number }).slot }
      : undefined;

  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <div className="text-base font-semibold text-text-primary">
            {hero.asset.name || "Hero"}
          </div>
          <div className="text-[10px] text-text-muted">
            {selected?.type === "locked"
              ? `Locked · Slot ${(selected as { slot: number }).slot}`
              : "Unlocked · In Wallet"}
          </div>
        </div>
        {level != null && (
          <div className="text-right">
            <div className="text-2xl font-bold text-text-gold">{level}</div>
            <div className="text-[9px] text-text-muted">LEVEL</div>
          </div>
        )}
      </div>

      {xp != null && (
        <div className="text-xs text-text-muted">
          XP: <span className="font-mono">{xp.toLocaleString()}</span>
        </div>
      )}

      {buffs.length > 0 && (
        <div>
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
            Buffs
          </div>
          <div className="space-y-1">
            {buffs.map(([key, value]) => {
              const meta = getBuffStatByAttrKey(key);
              const icon = meta ? buffStatIcon(meta.stat) : undefined;
              return (
                <div
                  key={key}
                  className="flex items-center justify-between rounded bg-surface px-2 py-1"
                >
                  <span className="flex items-center gap-1.5 text-xs text-text-secondary">
                    {icon && <GameIcon id={icon} title={meta?.name} size={18} />}
                    {meta?.name ?? key}
                  </span>
                  <span className="font-mono text-xs font-semibold text-text-primary">
                    {value}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="space-y-1 text-[10px] text-text-muted">
        {attrs["Template"] && (
          <div>
            Template: <span className="font-mono">{attrs["Template"]}</span>
          </div>
        )}
        {attrs["Serial"] && (
          <div>
            Serial: <span className="font-mono">{attrs["Serial"]}</span>
          </div>
        )}
        {attrs["Origin"] && (
          <div>
            Origin: <span className="font-mono">{attrs["Origin"]}</span>
          </div>
        )}
      </div>

      {tpl && <AbilityCard template={tpl} interactive={interactive} />}

      {/* Level Up panel */}
      <div className="rounded-md border border-zinc-800 bg-surface px-3 py-2">
        <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
          Level Up
        </div>
        {!levelUpGate.allowed ? (
          <div className="space-y-2">
            {levelUpGate.missing.map((m) => (
              <div key={m.label}>
                <p className="text-[10px] leading-relaxed text-text-muted">{m.narrative}</p>
                <Link
                  href={m.href}
                  className="mt-1 inline-flex items-center gap-1 rounded border border-border-gold/50 bg-accent/20 px-2 py-1 text-[10px] font-medium text-text-gold transition-colors hover:bg-accent/40"
                >
                  {m.label}
                  <ChevronRight className="h-3 w-3" />
                </Link>
              </div>
            ))}
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between text-xs">
              <span className="text-text-muted">Cost</span>
              <span
                className={`font-mono ${fragments >= cost ? "text-text-primary" : "text-red-400"}`}
              >
                {cost === Infinity ? "MAX" : cost.toLocaleString()} fragments
              </span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-text-muted">Level cap</span>
              <span className="font-mono text-text-secondary">
                {levelCap > 0
                  ? `Lv${levelCap} (Sanctuary Lv${sanctuaryLevel})`
                  : "No Sanctuary"}
              </span>
            </div>
            {atCap && (
              <p className="mt-1 text-[10px] text-danger">
                At cap. Upgrade Sanctuary for higher cap.
              </p>
            )}
            <TxButton
              onClick={(rp) => onLevelUp(hero.address, heroTemplateId, rp)}
              disabled={!canLevel || traveling}
              variant="secondary"
              className="mt-2 hidden w-full text-xs lg:block"
            >
              Level Up
            </TxButton>
          </>
        )}
      </div>

      {/* Actions — desktop sticky footer. Mobile uses MorphTabBar. */}
      <div className="sticky bottom-0 z-10 -mx-4 -mb-4 hidden border-t border-border-default bg-surface-raised px-4 pb-4 pt-3 lg:block">
        {selected?.type === "locked" ? (
          <div className="space-y-2">
            {defensiveHeroSlot !== (selected as { slot: number }).slot && (
              <TxButton
                onClick={(rp) => onAssignDefensive((selected as { slot: number }).slot, rp)}
                variant="secondary"
                className="w-full text-xs"
              >
                Assign as Defender
              </TxButton>
            )}
            <TxButton
              onClick={(rp) => onUnlock((selected as { slot: number }).slot, rp)}
              variant="secondary"
              className="w-full text-xs"
            >
              Unlock from Slot
            </TxButton>
          </div>
        ) : (
          <div className="space-y-2">
            {lockGate.allowed ? (
              <>
                <div className="flex items-end gap-2">
                  <TxButton
                    onClick={(rp) => onLock(hero.address, lockSlot, heroTemplateId, rp)}
                    disabled={emptySlots === 0}
                    className="flex-1 text-xs"
                  >
                    Lock to Slot
                  </TxButton>
                </div>
                {emptySlots === 0 && (
                  <p className="text-[10px] text-danger">Unlock a slot first</p>
                )}
              </>
            ) : (
              <div className="space-y-2 rounded-md border border-border-gold/40 bg-surface px-3 py-2">
                {lockGate.missing.map((m) => (
                  <div key={m.label}>
                    <p className="text-[10px] leading-relaxed text-text-muted">{m.narrative}</p>
                    <Link
                      href={m.href}
                      className="mt-1 inline-flex items-center gap-1 rounded border border-border-gold/50 bg-accent/20 px-2 py-1 text-[10px] font-medium text-text-gold transition-colors hover:bg-accent/40"
                    >
                      {m.label}
                      <ChevronRight className="h-3 w-3" />
                    </Link>
                  </div>
                ))}
              </div>
            )}
            <TxButton
              onClick={(rp) => onBurn(hero.address, heroTemplateId, rp)}
              variant="danger"
              className="w-full text-xs"
            >
              Burn Hero
            </TxButton>
          </div>
        )}
      </div>
    </>
  );
}
