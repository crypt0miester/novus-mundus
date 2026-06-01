"use client";

import { useState } from "react";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { usePlayer } from "@/lib/hooks/usePlayer";
import { useEstate } from "@/lib/hooks/useEstate";
import { useTransact } from "@/lib/hooks/useTransact";
import { useNovusMundusClient } from "@/lib/solana/provider";
import { useWallet } from "@solana/wallet-adapter-react";
import { GoldNumber } from "@/components/shared/GoldNumber";
import { TxButton } from "@/components/shared/TxButton";
import type { TxPhase } from "@/components/shared/TxButton";
import { NoviGenerator } from "@/components/shared/NoviGenerator";
import { NumberField } from "@/components/shared/NumberField";
import { BuildingId, FEATURES, useFeatureGate } from "@/lib/hooks/useFeatureGate";
import { buildingFraming } from "@/lib/narrative";
import { FeatureLayout } from "./feature-layout";
import { ActivityForecast } from "./activity-forecast";
import { CoverageNote } from "./coverage-note";
import { ShowcaseBanner } from "./showcase-banner";
import { useGameEngine } from "@/lib/hooks/useGameEngine";
import { useTimeOfDay } from "@/lib/estate/useTimeOfDay";
import {
  ActivityType,
  calculateDefensivePower,
  calculateProduceDeficit,
  calculateWeaponDeficit,
  createHireUnitsInstruction,
  deciToNovi,
  forecastHire,
  noviToDeci,
} from "novus-mundus-sdk";
import { GameIcon } from "@/components/shared/GameIcon";

const DEFENSIVE_UNITS = [
  {
    label: "Infantry",
    multiplier: 1,
    field: "defensiveUnit1" as const,
    unitType: 0,
    icon: "unit-infantry" as const,
    lore: "The line that holds, spear and shield, the first thing a raider meets.",
  },
  {
    label: "Cavalry",
    multiplier: 4,
    field: "defensiveUnit2" as const,
    unitType: 1,
    icon: "unit-cavalry" as const,
    lore: "Raised for the counter-charge, four times the weight of a footman on the wall.",
  },
  {
    label: "Siege",
    multiplier: 16,
    field: "defensiveUnit3" as const,
    unitType: 2,
    icon: "unit-siege" as const,
    lore: "Engines, not soldiers, trebuchet and ballista crews, the spine of a fortress.",
  },
];

export function BarracksTab() {
  const { data: playerData } = usePlayer();
  const { data: estateData } = useEstate();
  const client = useNovusMundusClient();
  const { publicKey } = useWallet();
  const transact = useTransact();

  const player = playerData?.account;
  const [hireType, setHireType] = useState(0);
  const [hireNoviAmount, setHireNoviAmount] = useState(100);

  const gate = useFeatureGate(FEATURES.HIRE_DEFENSIVE);
  const { data: geData } = useGameEngine();
  const { now } = useTimeOfDay();

  const handleHire = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    const ge = client.gameEngine;
    const ix = await createHireUnitsInstruction(
      { owner: publicKey, gameEngine: ge },
      { unitType: DEFENSIVE_UNITS[hireType]!.unitType, noviAmount: noviToDeci(hireNoviAmount) },
    );
    return transact
      .mutateAsync({
        instructions: [ix],
        invalidateKeys: [["player"]],
        successMessage: `Spent ${hireNoviAmount} NOVI to hire ${DEFENSIVE_UNITS[hireType]?.label}!`,
        onPhase: reportPhase,
      })
      .then((r) => r.signature);
  };

  if (!estateData?.exists) {
    return (
      <div className="card text-center">
        <p className="text-sm text-text-muted">Create an estate first to access the Barracks.</p>
      </div>
    );
  }
  if (!player) return null;

  const selectedUnit = DEFENSIVE_UNITS[hireType]!;
  const noviBalance = deciToNovi(player.lockedNovi ?? 0);

  const ge = geData?.account;
  const hireForecast = ge
    ? forecastHire(noviToDeci(hireNoviAmount), selectedUnit.unitType, player, ge, now)
    : null;

  const du1 = Number(player.defensiveUnit1 ?? 0n);
  const du2 = Number(player.defensiveUnit2 ?? 0n);
  const du3 = Number(player.defensiveUnit3 ?? 0n);
  const defensivePower = calculateDefensivePower(du1, du2, du3);

  // Defenders fight at a loss without a weapon, and lose happiness unfed.
  const defUnits = du1 + du2 + du3;
  const weapons =
    (Number(player.meleeWeapons ?? 0n)) +
    (Number(player.rangedWeapons ?? 0n)) +
    (Number(player.siegeWeapons ?? 0n));
  const weaponDeficit = calculateWeaponDeficit(defUnits, weapons);
  const produceDeficit = calculateProduceDeficit(defUnits, Number(player.produce ?? 0n));

  return (
    <FeatureLayout
      main={
        <>
          <p className="text-xs italic text-text-muted">
            {buildingFraming(BuildingId.Barracks).line}
          </p>

          <NoviGenerator compact />

          {!gate.allowed && gate.missing.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {gate.missing.map((m) => (
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

          <div className="flex items-center justify-between rounded-lg bg-surface-overlay/30 px-3 py-2 text-xs">
            <span className="text-text-muted">Total defensive power</span>
            <span className="font-mono font-semibold tabular-nums text-text-gold">
              {defensivePower.toLocaleString()}
            </span>
          </div>

          <CoverageNote
            items={[
              { count: weaponDeficit, label: "defenders without a weapon" },
              { count: produceDeficit, label: "defenders going hungry" },
            ]}
          />

          <div className="grid gap-2 grid-cols-3">
            {DEFENSIVE_UNITS.map((unit, i) => {
              const count = Number(player[unit.field] ?? 0n);
              const isSelected = hireType === i;
              const isLocked = !gate.allowed;
              return (
                <button
                  key={unit.label}
                  onClick={() => !isLocked && setHireType(i)}
                  disabled={isLocked}
                  className={`rounded-lg border p-3 text-left transition-all ${
                    isLocked
                      ? "cursor-not-allowed border-zinc-800/50 opacity-50"
                      : isSelected
                        ? "border-border-gold bg-accent/20 ring-1 ring-border-gold/30"
                        : "border-zinc-800 hover:border-zinc-700"
                  }`}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span
                      className={`text-sm font-semibold ${isLocked ? "text-zinc-600" : "text-text-primary"}`}
                    >
                      {unit.label}
                    </span>
                    <span className="text-[10px] text-text-muted">{unit.multiplier}x</span>
                  </div>
                  <div className="mt-1 text-xs font-mono tabular-nums">
                    {isLocked ? (
                      <span className="text-zinc-600">Locked</span>
                    ) : (
                      <GoldNumber value={count} size="sm" glow={false} />
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          <ShowcaseBanner
            image="/img/banners/barracks-banner.webp"
            icon={selectedUnit.icon}
            title={selectedUnit.label}
            tag={`${selectedUnit.multiplier}x defensive power`}
          >
            <p className="text-xs italic text-zinc-300">{selectedUnit.lore}</p>
          </ShowcaseBanner>
        </>
      }
      aside={
        gate.allowed ? (
          <div className="card">
            <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted">
              Hire {selectedUnit.label}
            </h4>
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span className="text-zinc-500">Your NOVI</span>
                <span className="font-mono tabular-nums text-text-gold">
                  <GameIcon id="resource-novi" size={14} className="mr-2" />
                  {noviBalance.toLocaleString()}
                </span>
              </div>
              <ActivityForecast
                activity={ActivityType.Consuming}
                verb={`Hiring`}
              >
                {hireForecast ? (
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-text-muted">{hireNoviAmount.toLocaleString()} NOVI</span>
                    <span className="font-mono tabular-nums text-text-gold">
                      ~{hireForecast.units.toLocaleString()} {selectedUnit.label}
                    </span>
                  </span>
                ) : (
                  <span className="text-text-muted">Loading forecast…</span>
                )}
              </ActivityForecast>
              <NumberField
                label="NOVI to spend"
                value={hireNoviAmount}
                onChange={setHireNoviAmount}
                min={100}
                max={noviBalance}
                suffix="NOVI"
                fibonacciCheckValue={noviToDeci(hireNoviAmount)}
              />
              <TxButton onClick={handleHire} disabled={noviBalance < hireNoviAmount}>
                {noviBalance >= hireNoviAmount ? `Hire` : "Insufficient NOVI"}
              </TxButton>
            </div>
          </div>
        ) : undefined
      }
    />
  );
}
