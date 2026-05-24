"use client";

import { useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { usePlayer } from "@/lib/hooks/usePlayer";
import { useEstate } from "@/lib/hooks/useEstate";
import { useGameEngine } from "@/lib/hooks/useGameEngine";
import { useTransact } from "@/lib/hooks/useTransact";
import { useNovusMundusClient } from "@/lib/solana/provider";
import { useWallet } from "@solana/wallet-adapter-react";
import { GoldNumber } from "@/components/shared/GoldNumber";
import { GameIcon } from "@/components/shared/GameIcon";
import { TxButton } from "@/components/shared/TxButton";
import { StatBar } from "@/components/shared/StatBar";
import { NumberField } from "@/components/shared/NumberField";
import type { TxPhase } from "@/components/shared/TxButton";
import { FEATURES, useFeatureGate, BuildingId } from "@/lib/hooks/useFeatureGate";
import { NoviGenerator } from "@/components/shared/NoviGenerator";
import { buildingFraming } from "@/lib/narrative";
import { FeatureLayout } from "./feature-layout";
import { ShowcaseBanner } from "./showcase-banner";
import {
  createPurchaseEquipmentInstruction,
  createPurchaseStaminaInstruction,
  EquipmentType,
  findBuilding,
  BuildingType,
  ActivityType,
  getCurrentTimeOfDay,
  getActivityMultiplier,
  formatNoviAmount,
} from "novus-mundus-sdk";

// Equipment offered by the Market caravan. Drays are the lore name for the
// chain's `vehicles` resource — wagons + beasts + salvaged engines. No game
// icon yet (the generated registry has no entry); we fall back to the armor
// icon at the call site, which is a stand-in until an icon ships.
const EQUIPMENT = [
  {
    label: "Melee Weapons",
    field: "meleeWeapons" as const,
    type: EquipmentType.MeleeWeapons,
    icon: "equip-melee" as const,
  },
  {
    label: "Ranged Weapons",
    field: "rangedWeapons" as const,
    type: EquipmentType.RangedWeapons,
    icon: "equip-ranged" as const,
  },
  {
    label: "Siege Weapons",
    field: "siegeWeapons" as const,
    type: EquipmentType.SiegeWeapons,
    icon: "equip-siege" as const,
  },
  {
    label: "Armor Pieces",
    field: "armorPieces" as const,
    type: EquipmentType.Armor,
    icon: "equip-armor" as const,
  },
  {
    label: "Produce",
    field: "produce" as const,
    type: EquipmentType.Produce,
    icon: "resource-produce" as const,
  },
  {
    label: "Drays",
    field: "vehicles" as const,
    type: EquipmentType.Vehicles,
    icon: "equip-drays" as const,
  },
];

type MarketSection = "equip" | "provisions";

const SECTIONS: { key: MarketSection; label: string }[] = [
  { key: "equip", label: "Equip" },
  { key: "provisions", label: "Provisions" },
];

export function MarketTab() {
  const { data: playerData } = usePlayer();
  const { data: estateData } = useEstate();
  const { data: geData } = useGameEngine();
  const client = useNovusMundusClient();
  const { publicKey } = useWallet();
  const transact = useTransact();

  const player = playerData?.account;
  const [section, setSection] = useState<MarketSection>("equip");
  const [equipType, setEquipType] = useState(0);
  const [equipAmount, setEquipAmount] = useState(1);
  const [equipPayCash, setEquipPayCash] = useState(false);

  const equipGate = useFeatureGate(FEATURES.PURCHASE_EQUIPMENT);

  // Per-unit equipment price — mirrors on-chain purchase_equipment:
  //   base × costMultiplier × purchasingMultiplier × marketDiscount.
  // purchasingMultiplier is applied DIRECTLY (Midday 1.618x dear,
  // DeepNight/Evening 0.618x cheap) — calculatePurchaseCost() inverts
  // it, so it is deliberately not used here. Null until config loads.
  const unitPrice = useMemo(() => {
    const ec = geData?.account?.economicConfig;
    const estate = estateData?.account;
    const longitude = playerData?.account?.currentLong;
    if (!ec || !estate || longitude == null) return null;

    // Index aligns with the EQUIPMENT array order: melee, ranged, siege, armor, produce, drays.
    const baseCosts = [
      ec.meleeWeaponCost,
      ec.rangedWeaponCost,
      ec.siegeWeaponCost,
      ec.armorCost,
      ec.produceCost,
      ec.vehicleCost,
    ];
    const baseCost = baseCosts[equipType]?.toNumber?.() ?? 0;
    if (baseCost <= 0) return null;

    const costMultiplierBps = ec.costMultiplier?.toNumber?.() ?? 10000;
    const adjusted = Math.floor((baseCost * costMultiplierBps) / 10000);

    const tod = getCurrentTimeOfDay(Math.floor(Date.now() / 1000), longitude);
    const timeMult = getActivityMultiplier(ActivityType.Purchasing, tod);
    const timeAdjusted = Math.floor(adjusted * timeMult);

    const market = findBuilding(estate, BuildingType.Market);
    const discountBps = market && market.level > 0 ? Math.min(market.level * 100, 2000) : 0;
    const final =
      discountBps > 0 ? Math.floor((timeAdjusted * (10000 - discountBps)) / 10000) : timeAdjusted;

    return final > 0 ? final : null;
  }, [
    geData?.account?.economicConfig,
    estateData?.account,
    playerData?.account?.currentLong,
    equipType,
  ]);

  const handlePurchaseEquipment = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    const ge = client.gameEngine;
    const ix = createPurchaseEquipmentInstruction(
      { owner: publicKey, gameEngine: ge },
      {
        equipmentType: EQUIPMENT[equipType]?.type ?? 0,
        quantity: equipAmount,
        payWithCash: equipPayCash,
      },
    );
    return transact
      .mutateAsync({
        instructions: [ix],
        invalidateKeys: [["player"]],
        successMessage: `Purchased ${equipAmount} ${EQUIPMENT[equipType]?.label}!`,
        onPhase: reportPhase,
      })
      .then((r) => r.signature);
  };

  const handlePurchaseStamina = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    const ge = client.gameEngine;
    const ix = createPurchaseStaminaInstruction(
      { owner: publicKey, gameEngine: ge },
      { amount: 10 },
    );
    return transact
      .mutateAsync({
        instructions: [ix],
        invalidateKeys: [["player"]],
        successMessage: "Stamina purchased!",
        onPhase: reportPhase,
      })
      .then((r) => r.signature);
  };

  if (!estateData?.exists) {
    return (
      <div className="card text-center">
        <p className="text-sm text-text-muted">Create an estate first to access the Market.</p>
      </div>
    );
  }
  if (!player) return null;

  const selectedEquip = EQUIPMENT[equipType] ?? null;
  const noviBalance = player.lockedNovi?.toNumber?.() ?? 0;
  const cashBalance = player.cashOnHand?.toNumber?.() ?? 0;
  const payBalance = equipPayCash ? cashBalance : noviBalance;

  return (
    <FeatureLayout
      main={
        <>
          <p className="text-xs italic text-text-muted">
            {buildingFraming(BuildingId.Market).line}
          </p>

          <NoviGenerator compact />

          {/* Section toggle */}
          <div className="-mx-4 flex gap-1 overflow-x-auto px-4 sm:mx-0 sm:px-0">
            <div className="flex gap-1 rounded-lg bg-surface p-1">
              {SECTIONS.map((s) => (
                <button
                  key={s.key}
                  onClick={() => setSection(s.key)}
                  className={`shrink-0 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                    section === s.key
                      ? "bg-surface-raised text-text-gold"
                      : "text-text-muted hover:text-text-secondary"
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {section === "equip" && (
            <div className="space-y-4">
              <div className="text-xs text-text-muted">
                Buy equipment using locked NOVI or cash. A higher Market level cuts the price.
              </div>
              {!equipGate.allowed && equipGate.missing.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {equipGate.missing.map((m) => (
                    <Link
                      key={m.label}
                      href={m.href}
                      className="inline-flex items-center gap-1 rounded-md border border-border-gold/50 bg-accent/20 px-2.5 py-1 text-xs font-medium text-text-gold hover:bg-accent/40"
                    >
                      {m.label}
                      <ChevronRight className="h-3.5 w-3.5" />
                    </Link>
                  ))}
                </div>
              )}
              <div className="grid gap-2 grid-cols-2">
                {EQUIPMENT.map((eq, i) => {
                  const owned = player[eq.field]?.toNumber?.() ?? 0;
                  const isSelected = equipType === i;
                  const isLocked = !equipGate.allowed;
                  return (
                    <button
                      key={eq.label}
                      onClick={() => !isLocked && setEquipType(i)}
                      disabled={isLocked}
                      className={`rounded-lg border p-3 text-left transition-all ${
                        isLocked
                          ? "cursor-not-allowed border-zinc-800/50 opacity-50"
                          : isSelected
                            ? "border-border-gold bg-accent/20 ring-1 ring-border-gold/30"
                            : "border-zinc-800 hover:border-zinc-700"
                      }`}
                    >
                      <div
                        className={`text-sm font-semibold ${isLocked ? "text-zinc-600" : "text-text-primary"}`}
                      >
                        {eq.label}
                      </div>
                      <div className="mt-1 text-xs text-text-muted">
                        {isLocked ? (
                          <span className="text-zinc-600">Locked</span>
                        ) : (
                          <>
                            Owned: <GoldNumber value={owned} size="sm" glow={false} />
                          </>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>

              {selectedEquip && (
                <ShowcaseBanner
                  image="/img/banners/market-banner.webp"
                  icon={selectedEquip.icon}
                  title={selectedEquip.label}
                >
                  <p className="text-xs italic text-zinc-300">
                    Bought by the crate from the market caravan — or forged yourself, given the
                    tools.
                  </p>
                  <p className="text-xs text-zinc-400">
                    You own{" "}
                    <span className="font-mono tabular-nums text-zinc-100">
                      {(player[selectedEquip.field]?.toNumber?.() ?? 0).toLocaleString()}
                    </span>
                    {unitPrice != null && (
                      <>
                        {" · "}
                        <span className="font-mono tabular-nums text-text-gold">
                          {equipPayCash ? unitPrice.toLocaleString() : formatNoviAmount(unitPrice)}
                        </span>{" "}
                        each
                      </>
                    )}
                  </p>
                </ShowcaseBanner>
              )}

              {selectedEquip && equipGate.allowed && (
                <div className="card">
                  <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted">
                    Buy {selectedEquip.label}
                  </h4>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-zinc-500">Your {equipPayCash ? "Cash" : "NOVI"}</span>
                      <span className="flex items-center gap-1 font-mono tabular-nums text-text-gold">
                        <GameIcon id={equipPayCash ? "resource-cash" : "resource-novi"} size={13} />
                        {equipPayCash ? cashBalance.toLocaleString() : formatNoviAmount(noviBalance)}
                      </span>
                    </div>
                    <div className="flex gap-1 rounded-lg bg-surface p-1">
                      <button
                        onClick={() => setEquipPayCash(true)}
                        className={`flex w-full items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                          equipPayCash
                            ? "bg-surface-raised text-text-gold"
                            : "text-text-muted hover:text-text-secondary"
                        }`}
                      >
                        <GameIcon id="resource-cash" size={14} />
                        Pay with Cash
                      </button>
                      <button
                        onClick={() => setEquipPayCash(false)}
                        className={`flex w-full items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                          !equipPayCash
                            ? "bg-surface-raised text-text-gold"
                            : "text-text-muted hover:text-text-secondary"
                        }`}
                      >
                        <GameIcon id="resource-novi" size={14} />
                        Pay with NOVI
                      </button>
                    </div>
                    <NumberField
                      label="Quantity"
                      value={equipAmount}
                      onChange={setEquipAmount}
                      min={1}
                      max={unitPrice != null ? Math.max(1, Math.floor(payBalance / unitPrice)) : 1}
                    />
                    {unitPrice != null && (
                      <div className="flex items-baseline justify-between text-xs">
                        <span className="text-text-muted">Total Cost</span>
                        <span className="flex items-center gap-1 text-sm font-semibold text-text-gold">
                          <GameIcon
                            id={equipPayCash ? "resource-cash" : "resource-novi"}
                            size={13}
                          />
                          {equipPayCash
                            ? (unitPrice * equipAmount).toLocaleString()
                            : formatNoviAmount(unitPrice * equipAmount)}
                        </span>
                      </div>
                    )}
                    <TxButton onClick={handlePurchaseEquipment}>
                      Buy {equipAmount} {selectedEquip.label}
                    </TxButton>
                  </div>
                </div>
              )}
            </div>
          )}

          {section === "provisions" && (
            <div className="card">
              <h3 className="mb-4 text-xs font-semibold uppercase tracking-wider text-text-muted">
                Provisions for the Road
              </h3>
              <p className="mb-4 text-xs text-text-muted">
                Stamina is what a hero spends to march and fight. The caravan sells it by the pack.
              </p>
              <div className="mb-4 space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs text-text-muted">Current Stamina</div>
                    <GoldNumber
                      value={player.encounterStamina?.toNumber?.() ?? 0}
                      suffix={` / ${player.maxEncounterStamina?.toNumber?.() ?? 0}`}
                    />
                  </div>
                  <div className="text-right text-xs text-text-muted">Regen: 1 per 5 min</div>
                </div>
                <StatBar
                  current={player.encounterStamina?.toNumber?.() ?? 0}
                  max={player.maxEncounterStamina?.toNumber?.() ?? 100}
                  color="gold"
                  showValues={false}
                />
                <div className="text-[10px] text-text-muted sm:text-[11px]">
                  Common 10 &middot; Uncommon 25 &middot; Rare 50 &middot; Epic 100 &middot;
                  Legendary 250
                </div>
              </div>
              <TxButton onClick={handlePurchaseStamina} className="w-full sm:w-auto">
                Buy 10 Stamina
              </TxButton>
            </div>
          )}
        </>
      }
    />
  );
}
