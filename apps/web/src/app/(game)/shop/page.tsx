"use client";

import { Suspense } from "react";
import { useTabParam } from "@/lib/hooks/useTabParam";
import { TabNav } from "@/components/shared/TabNav";
import { PageTransition } from "@/components/shared/PageTransition";
import { ShopTab } from "./_components/shop-tab";
import { SubscribeTab } from "./_components/subscribe-tab";
import { FeatureGate } from "@/components/shared/FeatureGate";
import { FEATURES } from "@/lib/hooks/useFeatureGate";

const TABS = [
  { key: "shop", label: "Shop" },
  { key: "subscribe", label: "Subscribe" },
];

function ShopContent() {
  const [tab, setTab] = useTabParam("shop");

  return (
    <PageTransition>
      <div className="flex h-full flex-col gap-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between">
          <h1 className="tier-title font-display text-xl font-bold tracking-wide sm:text-2xl">
            SHOP
          </h1>
          <TabNav tabs={TABS} activeTab={tab} onTabChange={setTab} />
        </div>
        <div className="min-h-0 flex-1 overflow-x-clip overflow-y-auto">
          {tab === "shop" && (
            <FeatureGate feature={FEATURES.SHOP_PURCHASE}>
              <ShopTab />
            </FeatureGate>
          )}
          {tab === "subscribe" && (
            <FeatureGate feature={FEATURES.SUBSCRIPTION}>
              <SubscribeTab />
            </FeatureGate>
          )}
        </div>
      </div>
    </PageTransition>
  );
}

export default function ShopPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[60vh] items-center justify-center text-text-muted">
          Loading...
        </div>
      }
    >
      <ShopContent />
    </Suspense>
  );
}
