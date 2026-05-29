"use client";

import { getBuffStatByAttrKey } from "novus-mundus-sdk";
import { GameIcon, buffStatIcon } from "@/components/shared/GameIcon";
import { useUnlockedHeroes } from "@/lib/hooks/useUnlockedHeroes";
import { useDungeonHeroStore } from "@/lib/store/dungeon-hero";
import { useRightPanelStore } from "@/lib/store/right-panel";

/** Asset attributes that aren't buffs — excluded from the buff chips. */
const META_ATTRS = new Set(["Template", "Serial", "Origin", "Level", "XP"]);

/**
 * Champion picker for a dungeon run — opened in the RightPanel from the
 * Dungeon tab. Lists the wallet's unlocked heroes; choosing one records it in
 * the dungeon-hero store and closes the panel. A locked hero (or one already
 * in a run) isn't wallet-owned, so it never appears here.
 */
export function DungeonHeroPanel() {
  const heroes = useUnlockedHeroes();
  const selectedMint = useDungeonHeroStore((s) => s.selectedMint);
  const setSelectedMint = useDungeonHeroStore((s) => s.setSelectedMint);
  const close = useRightPanelStore((s) => s.close);

  if (heroes.length === 0) {
    return (
      <p className="text-sm text-text-muted">
        No heroes in your wallet. Mint a hero — or unlock a locked one — in the Heroes tab, then it
        can be sent into a dungeon.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-text-muted">
        The chosen hero is escrowed for the run and returns to your wallet when it ends.
      </p>
      {heroes.map((hero) => {
        const mint = hero.mint.toBase58();
        const selected = mint === selectedMint;
        const attrs = hero.asset.attributes;
        const level = attrs.Level ?? null;
        const buffs = Object.entries(attrs).filter(([k]) => !META_ATTRS.has(k));
        return (
          <button
            key={mint}
            onClick={() => {
              setSelectedMint(mint);
              close();
            }}
            className={`flex w-full flex-col gap-1 rounded-lg border px-3 py-2 text-left transition-colors ${
              selected
                ? "border-border-gold-bright bg-accent/20"
                : "border-zinc-800 hover:border-zinc-700"
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-text-primary">
                {selected ? "◆ " : ""}
                {hero.name}
              </span>
              {level != null && <span className="text-xs text-text-muted">Lv {level}</span>}
            </div>
            {buffs.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {buffs.map(([k, v]) => {
                  const meta = getBuffStatByAttrKey(k);
                  const icon = meta ? buffStatIcon(meta.stat) : undefined;
                  return (
                    <span
                      key={k}
                      className="flex items-center gap-1 rounded bg-surface px-1.5 py-0.5 text-[10px] text-text-muted"
                    >
                      {icon ? (
                        <GameIcon id={icon} title={meta?.name} size={15} />
                      ) : (
                        (meta?.abbr ?? k)
                      )}
                      <span className="font-mono">{v}</span>
                    </span>
                  );
                })}
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}
