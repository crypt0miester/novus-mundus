"use client";

import { useWeeklySale, useSeasonalSale, useDaoPromotions } from "@/lib/hooks/useShop";
import { GoldCountdown } from "@/components/shared/GoldCountdown";
import { isWeeklySaleActive, isSeasonalSaleActive, isDaoPromotionActive } from "novus-mundus-sdk";
import { bpsToPercent } from "@/lib/utils";
import { CATEGORY_LABELS } from "./shared";

export function EventsView() {
  const { data: weeklySaleData } = useWeeklySale();
  const { data: seasonalSaleData } = useSeasonalSale();
  const { data: daoPromotions } = useDaoPromotions();

  const nowSec = Math.floor(Date.now() / 1000);

  return (
    <div className="space-y-4">
      {(() => {
        const weekly =
          weeklySaleData && isWeeklySaleActive(weeklySaleData.account, nowSec)
            ? weeklySaleData.account
            : null;
        const seasonal =
          seasonalSaleData && isSeasonalSaleActive(seasonalSaleData.account, nowSec)
            ? seasonalSaleData.account
            : null;
        const promos = daoPromotions.filter((p) => isDaoPromotionActive(p.account, nowSec));

        if (!weekly && !seasonal && promos.length === 0) {
          return (
            <div className="card">
              <p className="text-sm text-text-muted">
                No sitewide events running right now. The caravan keeps its usual prices.
              </p>
            </div>
          );
        }

        return (
          <>
            {weekly && (
              <div className="card accent-border">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-text-primary">Weekly Sale</h3>
                  <GoldCountdown
                    endsAt={Number(weekly.endsAt)}
                    startedAt={Number(weekly.startsAt)}
                    format="compact"
                    size="sm"
                  />
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {weekly.categoryDiscounts.map((bps, i) =>
                    bps > 0 ? (
                      <div key={i} className="rounded bg-surface/60 px-2 py-1.5 text-center">
                        <div className="text-[10px] text-text-muted">
                          {CATEGORY_LABELS[i] ?? `Category ${i}`}
                        </div>
                        <div className="text-sm font-semibold text-text-gold">
                          −{bpsToPercent(bps)}
                        </div>
                      </div>
                    ) : null,
                  )}
                </div>
                {weekly.bonusValueBps > 0 && (
                  <p className="mt-2 text-[11px] text-text-muted">
                    Themed bonus: +{bpsToPercent(weekly.bonusValueBps)}
                  </p>
                )}
              </div>
            )}

            {seasonal && (
              <div className="card accent-border">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-text-primary">
                    {seasonal.name || "Seasonal Sale"}
                  </h3>
                  <GoldCountdown
                    endsAt={Number(seasonal.endsAt)}
                    startedAt={Number(seasonal.startsAt)}
                    format="compact"
                    size="sm"
                  />
                </div>
                <div className="mt-2 space-y-1 text-xs">
                  {seasonal.globalDiscountBps > 0 && (
                    <div className="flex justify-between">
                      <span className="text-text-muted">Storewide discount</span>
                      <span className="text-text-gold">
                        −{bpsToPercent(seasonal.globalDiscountBps)}
                      </span>
                    </div>
                  )}
                  {seasonal.featuredCount > 0 && (
                    <div className="flex justify-between">
                      <span className="text-text-muted">Featured items</span>
                      <span className="text-text-secondary">{seasonal.featuredCount}</span>
                    </div>
                  )}
                  {seasonal.exclusiveCosmeticId > 0 && (
                    <div className="flex justify-between">
                      <span className="text-text-muted">Exclusive cosmetic</span>
                      <span className="text-text-secondary">#{seasonal.exclusiveCosmeticId}</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {promos.map((p) => {
              const d = p.account;
              const rows = (
                [
                  ["Storewide", d.globalDiscountBps],
                  ["Equipment", d.equipmentDiscountBps],
                  ["Consumables", d.consumableDiscountBps],
                  ["Materials", d.materialDiscountBps],
                  ["Cosmetics", d.cosmeticDiscountBps],
                ] as [string, number][]
              ).filter(([, bps]) => bps > 0);
              return (
                <div key={p.pubkey.toBase58()} className="card accent-border">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-text-primary">
                      {d.title || "DAO Promotion"}
                    </h3>
                    <GoldCountdown
                      endsAt={Number(d.endsAt)}
                      startedAt={Number(d.startsAt)}
                      format="compact"
                      size="sm"
                    />
                  </div>
                  <p className="text-[10px] uppercase tracking-wider text-text-muted">
                    Community promotion
                  </p>
                  <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {rows.map(([label, bps]) => (
                      <div key={label} className="rounded bg-surface/60 px-2 py-1.5 text-center">
                        <div className="text-[10px] text-text-muted">{label}</div>
                        <div className="text-sm font-semibold text-text-gold">
                          −{bpsToPercent(bps)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </>
        );
      })()}
    </div>
  );
}
