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
      <div className="mx-auto max-w-5xl space-y-6">
        <h1 className="tier-title font-display text-3xl font-bold tracking-wide">SHOP</h1>
        <TabNav tabs={TABS} activeTab={tab} onTabChange={setTab} />
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
    </PageTransition>
  );
}

export default function ShopPage() {
  return (
    <Suspense fallback={<div className="flex min-h-[60vh] items-center justify-center text-text-muted">Loading...</div>}>
      <ShopContent />
    </Suspense>
  );
}
