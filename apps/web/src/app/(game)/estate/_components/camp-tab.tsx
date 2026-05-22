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
import { forecastHire } from "@/lib/estate/forecast";
import {
  ActivityType,
  calculateOperativePower,
  calculateProduceDeficit,
  createHireUnitsInstruction,
} from "novus-mundus-sdk";
import { GameIcon } from "@/components/shared/GameIcon";

const OPERATIVE_UNITS = [
  {
    label: "Laborer",
    multiplier: 1,
    field: "operativeUnit1" as const,
    unitType: 3,
    icon: "unit-laborer" as const,
    lore: "The hands that haul and dig, plain work and the most of it.",
  },
  {
    label: "Artisan",
    multiplier: 4,
    field: "operativeUnit2" as const,
    unitType: 4,
    icon: "unit-artisan" as const,
    lore: "Skilled work, four laborers' worth of craft in a single pair of hands.",
  },
  {
    label: "Engineer",
    multiplier: 16,
    field: "operativeUnit3" as const,
    unitType: 5,
    icon: "unit-engineer" as const,
    lore: "Plans, gears and leverage, the rare mind that moves what muscle cannot.",
  },
];

export function CampTab() {
  const { data: playerData } = usePlayer();
  const { data: estateData } = useEstate();
  const client = useNovusMundusClient();
  const { publicKey } = useWallet();
  const transact = useTransact();

  const player = playerData?.account;
  const [hireType, setHireType] = useState(0);
  const [hireNoviAmount, setHireNoviAmount] = useState(100);

  const gate = useFeatureGate(FEATURES.HIRE_OPERATIVE);
  const { data: geData } = useGameEngine();
  const { now } = useTimeOfDay();

  const handleHire = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    const ge = client.gameEngine;
    const ix = createHireUnitsInstruction(
      { owner: publicKey, gameEngine: ge },
      { unitType: OPERATIVE_UNITS[hireType]!.unitType, noviAmount: hireNoviAmount },
    );
    return transact
      .mutateAsync({
        instructions: [ix],
        invalidateKeys: [["player"]],
        successMessage: `Spent ${hireNoviAmount} NOVI to hire ${OPERATIVE_UNITS[hireType]?.label}!`,
        onPhase: reportPhase,
      })
      .then((r) => r.signature);
  };

  if (!estateData?.exists) {
    return (
      <div className="card text-center">
        <p className="text-sm text-text-muted">Create an estate first to access the Camp.</p>
      </div>
    );
  }
  if (!player) return null;

  const selectedUnit = OPERATIVE_UNITS[hireType]!;
  const noviBalance = player.lockedNovi?.toNumber?.() ?? 0;

  const ge = geData?.account;
  const hireForecast = ge
    ? forecastHire(hireNoviAmount, selectedUnit.unitType, player, ge, now)
    : null;

  const op1 = player.operativeUnit1?.toNumber?.() ?? 0;
  const op2 = player.operativeUnit2?.toNumber?.() ?? 0;
  const op3 = player.operativeUnit3?.toNumber?.() ?? 0;
  const operativePower = calculateOperativePower(op1, op2, op3);

  // Operatives lose happiness — and start abandoning — when there's no food.
  const produceDeficit = calculateProduceDeficit(
    op1 + op2 + op3,
    player.produce?.toNumber?.() ?? 0,
  );

  return (
    <FeatureLayout
      main={
        <>
          <p className="text-xs italic text-text-muted">{buildingFraming(BuildingId.Camp).line}</p>

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
            <span className="text-text-muted">Total operative power</span>
            <span className="font-mono font-semibold tabular-nums text-text-gold">
              {operativePower.toLocaleString()}
            </span>
          </div>

          <CoverageNote items={[{ count: produceDeficit, label: "operatives going hungry" }]} />

          <div className="grid gap-2 grid-cols-3">
            {OPERATIVE_UNITS.map((unit, i) => {
              const count = player[unit.field]?.toNumber?.() ?? 0;
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
            image="/img/banners/camp-banner.webp"
            icon={selectedUnit.icon}
            title={selectedUnit.label}
            tag={`${selectedUnit.multiplier}x operative power`}
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
              <NumberField
                label="NOVI to spend"
                value={hireNoviAmount}
                onChange={setHireNoviAmount}
                min={1}
                max={noviBalance}
                suffix="NOVI"
              />
              <ActivityForecast
                activity={ActivityType.Consuming}
                verb={`Hiring ${selectedUnit.label}`}
              >
                {hireForecast ? (
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-text-muted">
                      {hireNoviAmount.toLocaleString()} NOVI →
                    </span>
                    <span className="font-mono tabular-nums text-text-gold">
                      ~{hireForecast.units.toLocaleString()} {selectedUnit.label}
                    </span>
                  </span>
                ) : (
                  <span className="text-text-muted">Loading forecast…</span>
                )}
              </ActivityForecast>
              <TxButton onClick={handleHire} disabled={noviBalance < hireNoviAmount}>
                {noviBalance >= hireNoviAmount ? `Hire ${selectedUnit.label}` : "Insufficient NOVI"}
              </TxButton>
            </div>
          </div>
        ) : undefined
      }
    />
  );
}
