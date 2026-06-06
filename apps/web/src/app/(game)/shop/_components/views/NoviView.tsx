"use client";

import { useState, useMemo, useRef } from "react";
import { useReducedMotion } from "@/lib/hooks/useReducedMotion";
import { useAnimeScope } from "@/lib/hooks/useAnimeScope";
import { usePlayer } from "@/lib/hooks/usePlayer";
import { useUser } from "@/lib/hooks/useUser";
import { useShopGameEngine } from "@/lib/hooks/useShop";
import { useTransact } from "@/lib/hooks/useTransact";
import { useNovusMundusClient } from "@/lib/solana/provider";
import { useWallet } from "@solana/wallet-adapter-react";
import { TxButton } from "@/components/shared/TxButton";
import type { TxPhase } from "@/components/shared/TxButton";
import { DetailPanel } from "@/components/shared/DetailPanel";
import { useMorphActions } from "@/lib/hooks/useMorphActions";
import type { PanelAction } from "@/lib/store/right-panel";
import {
  createPurchaseNoviInstruction,
  calculateNoviPurchasePreview,
  calculateNoviStreak,
  getRemainingDailyAllowance,
  formatNoviAmount,
  formatLamportsAsSol,
  NOVI_PACKAGE_TIERS,
  getEffectiveTier,
} from "novus-mundus-sdk";
import { formatNumber } from "@/lib/utils";
import {
  lamportsToSol,
  selectShopTile,
  floatNoviTiles,
  useShopTileRipple,
} from "./shared";
import { ReservedNoviNote } from "./ReservedNoviNote";
import { useIsDesktop } from "./useIsDesktop";

export function NoviView() {
  const { data: playerData } = usePlayer();
  const { data: userData } = useUser();
  const { data: geData } = useShopGameEngine();
  const client = useNovusMundusClient();
  const { publicKey } = useWallet();
  const transact = useTransact();

  const player = playerData?.account;
  const user = userData?.account;
  const gameEngine = geData?.account;
  const ge = client.gameEngine;

  const [selectedPackage, setSelectedPackage] = useState<number | null>(null);

  const isDesktop = useIsDesktop();
  const effectivePackage = selectedPackage ?? (isDesktop ? 0 : null);
  const reduce = useReducedMotion();
  // Tile-ripple grid root. grid-cols-3 md:grid-cols-5 -> read live breakpoint.
  const gridRef = useRef<HTMLDivElement>(null);

  const nowSec = Math.floor(Date.now() / 1000);

  // NOVI purchase preview for selected package
  const noviPreview = useMemo(() => {
    if (!gameEngine || !player || effectivePackage == null) return null;
    const config = gameEngine.noviPurchaseConfig;
    const tier = getEffectiveTier(player, nowSec);
    const streakDay = user ? user.noviPurchaseStreak : 1;
    try {
      return calculateNoviPurchasePreview(effectivePackage, tier, streakDay, config);
    } catch {
      return null;
    }
  }, [gameEngine, player, user, effectivePackage, nowSec]);

  // Streak info
  const streakInfo = useMemo(() => {
    if (!user) return null;
    return calculateNoviStreak(user.noviLastPurchaseDay, user.noviPurchaseStreak, nowSec);
  }, [user, nowSec]);

  // Remaining daily allowance
  const dailyAllowance = useMemo(() => {
    if (!gameEngine || !player || !user) return null;
    const config = gameEngine.noviPurchaseConfig;
    const tier = getEffectiveTier(player, nowSec);
    return getRemainingDailyAllowance(user.noviPurchasedToday, tier, config);
  }, [gameEngine, player, user, nowSec]);

  const handlePurchaseNovi = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey || !gameEngine || effectivePackage == null) throw new Error("Not ready");
    const noviConfig = gameEngine.noviPurchaseConfig;
    const maxLamports =
      (noviConfig.noviBasePriceLamports *
        noviConfig.noviPurchaseAmounts[effectivePackage]! *
        15n) /
      10n;
    const ix = await createPurchaseNoviInstruction(
      {
        buyer: publicKey,
        gameEngine: ge,
        treasury: gameEngine.treasuryWallet,
        noviMint: gameEngine.noviMint,
      },
      { packageIndex: effectivePackage, maxLamports },
    );
    const amount = Number(noviConfig.noviPurchaseAmounts[effectivePackage]!) / 10;
    return transact
      .mutateAsync({
        instructions: [ix],
        invalidateKeys: [["player"]],
        successMessage: `Purchased ${amount} NOVI — credited to your Reserved balance.`,
        onPhase: reportPhase,
      })
      .then((r) => r.signature);
  };

  const morphActions = useMemo<PanelAction[] | null>(() => {
    if (selectedPackage != null) {
      const limitReached = dailyAllowance === 0n;
      return [
        {
          id: `buy-novi-${selectedPackage}`,
          label: limitReached ? "Daily limit reached" : "Buy NOVI",
          variant: "primary",
          disabled: limitReached,
          onClick: handlePurchaseNovi,
        },
      ];
    }
    return null;
  }, [selectedPackage, dailyAllowance, handlePurchaseNovi]);
  useMorphActions(morphActions);

  // Rarity-aware tile ripple over the NOVI package grid. Each package climbs the
  // bloom ladder by its bulk tier index, so larger packs flare brighter. Keyed
  // on the package count so the wash-in replays once the config loads.
  const packageCount = gameEngine?.noviPurchaseConfig.noviPurchaseAmounts.length ?? 0;
  useShopTileRipple(gridRef, [packageCount], { base: 3, md: 5 });

  // Selected package floats higher on an outElastic physics lift (replacing the
  // old hard md:-translate-y-3 jump). revertOnCleanup:false so cancelling an
  // in-flight float on re-select does not wipe the committed translateY.
  useAnimeScope(
    { root: gridRef, deps: [effectivePackage, packageCount], revertOnCleanup: false },
    ({ reduce: r }) => {
      const root = gridRef.current;
      if (!root) return;
      floatNoviTiles(root, effectivePackage ?? -1, r);
    },
  );

  return (
    <div className="space-y-4">
      {/* Streak & Allowance Banner */}
      {(streakInfo || dailyAllowance) && (
        <div className="flex flex-wrap items-center gap-4 text-xs">
          {streakInfo && (
            <div className="flex items-center gap-2">
              <span className="text-text-muted">Streak:</span>
              <span
                className={`text-sm font-semibold ${streakInfo.streakDay >= 3 ? "text-text-gold" : "text-text-secondary"}`}
              >
                Day {streakInfo.streakDay}/7
              </span>
              {streakInfo.bonusBps > 0 && (
                <span className="text-[11px] text-green-400">
                  +{(streakInfo.bonusBps / 100).toFixed(0)}% bonus
                </span>
              )}
              {streakInfo.isResetting && (
                <span className="text-[11px] text-danger">Streak reset</span>
              )}
            </div>
          )}
          {dailyAllowance !== null && (
            <div className="flex items-center gap-2">
              <span className="text-text-muted">Daily limit:</span>
              <span
                className={`text-sm font-semibold ${dailyAllowance === 0n ? "text-red-400" : "text-text-gold"}`}
              >
                {dailyAllowance === 0n
                  ? "Reached"
                  : `${formatNoviAmount(dailyAllowance)} NOVI left`}
              </span>
            </div>
          )}
        </div>
      )}

      {!gameEngine ? (
        <div className="card">
          <p className="text-sm text-text-muted">Loading...</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <div ref={gridRef} className="grid gap-2 grid-cols-3 md:grid-cols-5">
              {gameEngine.noviPurchaseConfig.noviPurchaseAmounts.map((amount, idx) => {
                const tierInfo = NOVI_PACKAGE_TIERS[idx];
                const noviAmount = Number(amount) / 10;
                const bonusBps = gameEngine.noviPurchaseConfig.noviBulkBonusBps[idx] ?? 0;
                const isSelected = effectivePackage === idx;
                return (
                  <button
                    key={amount.toString()}
                    data-shop-tile
                    onClick={(e) => {
                      selectShopTile(e.currentTarget, reduce);
                      setSelectedPackage(idx);
                    }}
                    className={`rounded-lg border p-3 text-center opacity-0 transition-colors ${
                      isSelected
                        ? "border-border-gold bg-accent/20 ring-1 ring-border-gold/30"
                        : "border-zinc-800 hover:border-zinc-700"
                    }`}
                  >
                    {tierInfo && (
                      <div className="truncate text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                        {tierInfo.name}
                      </div>
                    )}
                    <div
                      className="font-semibold tabular-nums text-text-gold text-base sm:text-lg"
                      title={noviAmount.toLocaleString()}
                    >
                      {formatNumber(noviAmount, "compact")}
                    </div>
                    <div className="text-[10px] text-text-muted">NOVI</div>
                    {bonusBps > 0 && (
                      <div className="mt-1 text-[10px] text-text-gold">
                        +{(bonusBps / 100).toFixed(0)}%
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <DetailPanel open={effectivePackage != null} onClose={() => setSelectedPackage(null)}>
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                Purchase Preview
              </h3>
              <button
                onClick={() => setSelectedPackage(null)}
                className="hidden lg:block text-xs text-text-muted hover:text-text-secondary"
              >
                Close
              </button>
            </div>

            {noviPreview && (
              <div className="rounded-lg bg-surface/60 px-3 py-2 space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-zinc-500">Base amount</span>
                  <span className="text-text-secondary">
                    {formatNoviAmount(noviPreview.baseAmount)} NOVI
                  </span>
                </div>
                {noviPreview.bulkBonus !== 0n && (
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-zinc-500">Bulk bonus</span>
                    <span className="text-text-gold">
                      +{formatNoviAmount(noviPreview.bulkBonus)} NOVI
                    </span>
                  </div>
                )}
                {noviPreview.subscriptionBonus !== 0n && (
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-zinc-500">Subscription bonus</span>
                    <span className="text-text-gold">
                      +{formatNoviAmount(noviPreview.subscriptionBonus)} NOVI
                    </span>
                  </div>
                )}
                {noviPreview.streakBonus !== 0n && (
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-zinc-500">Streak (Day {streakInfo?.streakDay ?? 1})</span>
                    <span className="text-text-gold">
                      +{formatNoviAmount(noviPreview.streakBonus)} NOVI
                    </span>
                  </div>
                )}
                {noviPreview.totalBonusBps > 0 && (
                  <div className="flex items-center justify-between text-xs border-t border-zinc-800 pt-1">
                    <span className="text-zinc-500">Total bonus</span>
                    <span className="text-text-gold">
                      +{(noviPreview.totalBonusBps / 100).toFixed(1)}%
                    </span>
                  </div>
                )}
              </div>
            )}

            {noviPreview && (
              <div className="rounded-lg bg-surface/60 px-3 py-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-zinc-500">You receive</span>
                  <span className="font-mono tabular-nums text-text-gold font-semibold">
                    {formatNoviAmount(noviPreview.totalNovi)} NOVI
                  </span>
                </div>
                <div className="mt-1 flex items-center justify-between text-xs">
                  <span className="text-zinc-500">Cost</span>
                  <span className="font-mono tabular-nums text-text-muted">
                    {formatLamportsAsSol(noviPreview.costLamports)}
                  </span>
                </div>
              </div>
            )}

            <div className="text-[10px] text-text-muted">
              Base: {lamportsToSol(Number(gameEngine.noviPurchaseConfig.noviBasePriceLamports))}{" "}
              SOL/NOVI
            </div>

            <TxButton
              onClick={handlePurchaseNovi}
              className="hidden w-full lg:block"
              disabled={dailyAllowance === 0n}
            >
              {dailyAllowance === 0n
                ? "Daily limit reached"
                : `Buy ${noviPreview ? formatNoviAmount(noviPreview.totalNovi) : "NOVI"}`}
            </TxButton>
          </DetailPanel>

          <ReservedNoviNote className="lg:hidden" />
        </div>
      )}
    </div>
  );
}
