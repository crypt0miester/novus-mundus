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
import { BuildingId, FEATURES, useFeatureGate } from "@/lib/hooks/useFeatureGate";
import { buildingFraming } from "@/lib/narrative";
import {
  createHireUnitsInstruction,
  createUpdateLockedNoviInstruction,
} from "novus-mundus-sdk";

const DEFENSIVE_UNITS = [
  { label: "Infantry", multiplier: 1, field: "defensiveUnit1" as const, unitType: 0 },
  { label: "Cavalry", multiplier: 4, field: "defensiveUnit2" as const, unitType: 1 },
  { label: "Siege", multiplier: 16, field: "defensiveUnit3" as const, unitType: 2 },
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

  const handleHire = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    const ge = client.gameEngine;
    const ix = createHireUnitsInstruction(
      { owner: publicKey, gameEngine: ge },
      { unitType: DEFENSIVE_UNITS[hireType]!.unitType, noviAmount: hireNoviAmount }
    );
    return transact.mutateAsync({
      instructions: [ix],
      invalidateKeys: [["player"]],
      successMessage: `Spent ${hireNoviAmount} NOVI to hire ${DEFENSIVE_UNITS[hireType]?.label}!`,
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  const handleClaimAndHire = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    const ge = client.gameEngine;
    const claimIx = createUpdateLockedNoviInstruction({ owner: publicKey, gameEngine: ge });
    const hireIx = createHireUnitsInstruction(
      { owner: publicKey, gameEngine: ge },
      { unitType: DEFENSIVE_UNITS[hireType]!.unitType, noviAmount: hireNoviAmount }
    );
    return transact.mutateAsync({
      instructions: [claimIx, hireIx],
      invalidateKeys: [["player"]],
      successMessage: `Claimed NOVI & hired ${DEFENSIVE_UNITS[hireType]?.label}!`,
      onPhase: reportPhase,
    }).then((r) => r.signature);
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
  const noviBalance = player.lockedNovi?.toNumber?.() ?? 0;

  return (
    <div className="space-y-4">
      <p className="text-xs italic text-text-muted">{buildingFraming(BuildingId.Barracks).line}</p>

      <NoviGenerator compact />

      {!gate.allowed && gate.missing.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {gate.missing.map((m) => (
            <Link key={m.label} href={m.href} className="rounded-md border border-amber-800/50 bg-amber-900/20 px-2.5 py-1 text-xs font-medium text-text-gold hover:bg-amber-900/40">
              {m.label} &rarr;
            </Link>
          ))}
        </div>
      )}

      <div className="grid gap-2 grid-cols-3">
        {DEFENSIVE_UNITS.map((unit, i) => {
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
                    ? "border-amber-600 bg-amber-900/20 ring-1 ring-amber-600/30"
                    : "border-zinc-800 hover:border-zinc-700"
              }`}
            >
              <div className="flex items-center justify-between gap-1">
                <span className={`text-sm font-semibold ${isLocked ? "text-zinc-600" : "text-text-primary"}`}>{unit.label}</span>
                <span className="text-[10px] text-text-muted">{unit.multiplier}x</span>
              </div>
              <div className="mt-1 text-xs font-mono tabular-nums">
                {isLocked ? <span className="text-zinc-600">Locked</span> : <GoldNumber value={count} size="sm" glow={false} />}
              </div>
            </button>
          );
        })}
      </div>

      {gate.allowed && (
        <div className="card">
          <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted">
            Hire {selectedUnit.label}
          </h4>
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs">
              <span className="text-zinc-500">Your NOVI</span>
              <span className="font-mono tabular-nums text-text-gold">{noviBalance.toLocaleString()}</span>
            </div>
            <div>
              <label className="mb-1 block text-xs text-text-muted">NOVI to spend</label>
              <input
                type="number"
                value={hireNoviAmount}
                onChange={(e) => setHireNoviAmount(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-full rounded-lg border border-zinc-800 bg-surface px-3 py-2 text-sm font-mono text-text-primary tabular-nums"
                min={1}
              />
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <TxButton onClick={handleHire} className="flex-1" disabled={noviBalance < hireNoviAmount}>
                {noviBalance >= hireNoviAmount ? `Hire ${selectedUnit.label}` : "Insufficient NOVI"}
              </TxButton>
              <TxButton onClick={handleClaimAndHire} variant="secondary" className="flex-1 text-xs">
                Claim NOVI &amp; Hire
              </TxButton>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
