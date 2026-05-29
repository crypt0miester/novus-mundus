"use client";

import { useMemo, useRef, useState } from "react";
import { ChevronRight, Sparkles } from "lucide-react";
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

/** BN | number | undefined to number — used everywhere player fields are read. */
function toNum(v: unknown): number {
  if (v && typeof (v as { toNumber?: () => number }).toNumber === "function") {
    return (v as { toNumber: () => number }).toNumber();
  }
  return Number(v ?? 0);
}

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
  // Anchor the buy form so "Fill" can scroll the user straight to it after
  // pre-selecting the equipment and quantity.
  const buyFormRef = useRef<HTMLDivElement | null>(null);

  const equipGate = useFeatureGate(FEATURES.PURCHASE_EQUIPMENT);

  // Per-equipment pricing inputs — one entry per EQUIPMENT index (melee,
  // ranged, siege, armor, produce, drays). We deliberately keep the on-chain
  // intermediates (`adjustedUnit`, `timeMult`, `discountBps`) rather than
  // pre-multiplying to a per-unit price, because the on-chain formula
  // `floor((qty × adjustedUnit) × timeMult)` does NOT equal
  // `floor(adjustedUnit × timeMult) × qty` — flooring per unit then
  // multiplying loses fractional cents that the chain charges back on the
  // total. Compute total cost via `totalCost(i, qty)` below to stay in lockstep.
  interface Pricing {
    adjustedUnit: number;
    timeMult: number;
    discountBps: number;
  }
  const pricing = useMemo<(Pricing | null)[] | null>(() => {
    const ec = geData?.account?.economicConfig;
    const estate = estateData?.account;
    const longitude = playerData?.account?.currentLong;
    if (!ec || !estate || longitude == null) return null;

    const baseCosts = [
      ec.meleeWeaponCost,
      ec.rangedWeaponCost,
      ec.siegeWeaponCost,
      ec.armorCost,
      ec.produceCost,
      ec.vehicleCost,
    ];
    const costMultiplierBps = ec.costMultiplier?.toNumber?.() ?? 10000;
    const tod = getCurrentTimeOfDay(Math.floor(Date.now() / 1000), longitude);
    const timeMult = getActivityMultiplier(ActivityType.Purchasing, tod);
    const market = findBuilding(estate, BuildingType.Market);
    const discountBps = market && market.level > 0 ? Math.min(market.level * 100, 2000) : 0;

    return baseCosts.map((bc) => {
      const base = bc?.toNumber?.() ?? 0;
      if (base <= 0) return null;
      const adjustedUnit = Math.floor((base * costMultiplierBps) / 10000);
      if (adjustedUnit <= 0) return null;
      return { adjustedUnit, timeMult, discountBps };
    });
  }, [geData?.account?.economicConfig, estateData?.account, playerData?.account?.currentLong]);

  /**
   * Total cost matching the on-chain order of operations:
   *   1. adjustedUnit = floor(base × costMultiplierBps / 10000)   [precomputed]
   *   2. baseTotal    = qty × adjustedUnit
   *   3. timeAdjusted = floor(baseTotal × timeMult)
   *   4. total        = floor(timeAdjusted × (10000 − discountBps) / 10000)
   *
   * Returns 0 when pricing is loading or the type has no base cost.
   */
  const totalCost = (i: number, qty: number): number => {
    const p = pricing?.[i];
    if (!p || qty <= 0) return 0;
    const baseTotal = qty * p.adjustedUnit;
    const timeAdjusted = Math.floor(baseTotal * p.timeMult);
    return p.discountBps > 0
      ? Math.floor((timeAdjusted * (10000 - p.discountBps)) / 10000)
      : timeAdjusted;
  };

  /**
   * Largest qty that satisfies `totalCost(i, qty) ≤ balance`. Starts from a
   * single-unit estimate, then backs off / nudges up to handle the rounding
   * difference between `qty × singleCost` and the chain's `floor(qty × … × mult)`.
   */
  const maxAffordable = (i: number, balance: number): number => {
    const single = totalCost(i, 1);
    if (single <= 0 || balance < single) return 0;
    let qty = Math.floor(balance / single);
    // Back off — accumulated time-multiplier rounding can push the actual
    // total above `qty × single`, so the naïve estimate sometimes overshoots.
    while (qty > 0 && totalCost(i, qty) > balance) qty--;
    // Nudge up — the same rounding can also leave room for one more unit
    // than the estimate gave credit for.
    while (totalCost(i, qty + 1) <= balance && qty < 1_000_000_000) qty++;
    return Math.max(0, qty);
  };

  const unitPrice = pricing?.[equipType] ? totalCost(equipType, 1) : null;

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

  // Per-equipment supply state — what the player has on hand, the army's
  // ideal count for that line, the deficit, and how many of the deficit they
  // can actually afford with the current payment method. Weapons map by tier
  // (T1 → melee / T2 → ranged / T3 → siege) — the chain treats weapons
  // fungibly for damage, but tier-mapped need keeps each row's "fill" honest
  // (otherwise siege-only buyers see a spurious melee deficit). Armor /
  // produce / drays scale with the full roster.
  const u1 = toNum(player.defensiveUnit1) + toNum(player.operativeUnit1);
  const u2 = toNum(player.defensiveUnit2) + toNum(player.operativeUnit2);
  const u3 = toNum(player.defensiveUnit3) + toNum(player.operativeUnit3);
  const totalUnits = u1 + u2 + u3;
  const NEED_PER_INDEX = [u1, u2, u3, totalUnits, totalUnits, totalUnits];

  const supply = EQUIPMENT.map((eq, i) => {
    const owned = toNum(player[eq.field]);
    const need = NEED_PER_INDEX[i] ?? 0;
    const deficit = Math.max(0, need - owned);
    const affordable = maxAffordable(i, payBalance);
    const fillAmount = Math.min(deficit, affordable);
    return { owned, need, deficit, affordable, fillAmount };
  });

  const fillSlot = (i: number, amount: number) => {
    setEquipType(i);
    setEquipAmount(amount);
    requestAnimationFrame(() => {
      buyFormRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

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
                  const s = supply[i];
                  const isSelected = equipType === i;
                  const isLocked = !equipGate.allowed;
                  const hasDeficit = !isLocked && s.deficit > 0;
                  // Stacked: card (selects equipment) + optional Fill button
                  // below it (pre-fills exact affordable deficit). Two siblings
                  // — never nest <button> inside <button>.
                  return (
                    <div key={eq.label} className="flex flex-col gap-1">
                      <button
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
                        <div className="flex items-baseline justify-between gap-2">
                          <span
                            className={`text-sm font-semibold ${isLocked ? "text-zinc-600" : "text-text-primary"}`}
                          >
                            {eq.label}
                          </span>
                          {hasDeficit && (
                            <span className="shrink-0 font-mono text-[10px] tabular-nums text-danger">
                              −{s.deficit.toLocaleString()}
                            </span>
                          )}
                        </div>
                        <div className="mt-1 text-xs text-text-muted">
                          {isLocked ? (
                            <span className="text-zinc-600">Locked</span>
                          ) : (
                            <>
                              <GoldNumber value={s.owned} size="sm" glow={false} />
                              <span className="text-text-muted">
                                {" / "}
                                {s.need.toLocaleString()}
                              </span>
                            </>
                          )}
                        </div>
                      </button>
                      {hasDeficit && (
                        <button
                          onClick={() => fillSlot(i, s.fillAmount)}
                          disabled={s.fillAmount === 0}
                          className="inline-flex items-center justify-center gap-1 rounded-md border border-border-gold bg-surface-raised px-2 py-1 text-[10px] font-semibold text-text-gold transition-colors hover:bg-surface-overlay disabled:cursor-not-allowed disabled:border-zinc-800 disabled:bg-transparent disabled:text-text-muted"
                          title={
                            s.fillAmount === 0
                              ? `Insufficient ${equipPayCash ? "cash" : "NOVI"} to buy any`
                              : s.fillAmount < s.deficit
                                ? `${s.deficit.toLocaleString()} short; affordable ${s.fillAmount.toLocaleString()}`
                                : `Buy the missing ${s.deficit.toLocaleString()}`
                          }
                        >
                          <Sparkles className="h-3 w-3" />
                          {s.fillAmount === 0
                            ? "Insufficient funds"
                            : `Fill ${s.fillAmount.toLocaleString()}`}
                        </button>
                      )}
                    </div>
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
                <div ref={buyFormRef} className="card scroll-mt-4">
                  <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted">
                    Buy {selectedEquip.label}
                  </h4>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-zinc-500">Your {equipPayCash ? "Cash" : "NOVI"}</span>
                      <span className="flex items-center gap-1 font-mono tabular-nums text-text-gold">
                        <GameIcon id={equipPayCash ? "resource-cash" : "resource-novi"} size={13} />
                        {equipPayCash
                          ? cashBalance.toLocaleString()
                          : formatNoviAmount(noviBalance)}
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
                      max={Math.max(1, maxAffordable(equipType, payBalance))}
                    />
                    {unitPrice != null && (
                      <div className="flex items-baseline justify-between text-xs">
                        <span className="text-text-muted">Total Cost</span>
                        <span className="flex items-center gap-1 text-sm font-semibold text-text-gold">
                          <GameIcon
                            id={equipPayCash ? "resource-cash" : "resource-novi"}
                            size={13}
                          />
                          {(() => {
                            const cost = totalCost(equipType, equipAmount);
                            return equipPayCash ? cost.toLocaleString() : formatNoviAmount(cost);
                          })()}
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

          {/* SuppliesCheck declared at module scope; see below. */}

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
