"use client";

import { useState, useMemo } from "react";
import { usePlayer } from "@/lib/hooks/usePlayer";
import { useEstate } from "@/lib/hooks/useEstate";
import { useGameEngine } from "@/lib/hooks/useGameEngine";
import { useTransact } from "@/lib/hooks/useTransact";
import { useNovusMundusClient } from "@/lib/solana/provider";
import { useWallet } from "@solana/wallet-adapter-react";
import { TxButton } from "@/components/shared/TxButton";
import type { TxPhase } from "@/components/shared/TxButton";
import { NumberField } from "@/components/shared/NumberField";
import { bpsToPercent } from "@/lib/utils";
import {
  createRecoverTroopsInstruction,
  calculateRecoveryCost,
  findBuilding,
} from "novus-mundus-sdk";

const WOUNDED_UNITS = [
  { type: 0, label: "Infantry", field: "woundedDef1" as const },
  { type: 1, label: "Cavalry", field: "woundedDef2" as const },
  { type: 2, label: "Siege", field: "woundedDef3" as const },
  { type: 3, label: "Laborer", field: "woundedOp1" as const },
  { type: 4, label: "Artisan", field: "woundedOp2" as const },
  { type: 5, label: "Engineer", field: "woundedOp3" as const },
];

export function InfirmaryTab() {
  const { data: playerData } = usePlayer();
  const { data: estateData } = useEstate();
  const { data: geData } = useGameEngine();
  const client = useNovusMundusClient();
  const { publicKey } = useWallet();
  const transact = useTransact();

  const estate = estateData?.account;

  const [recoverUnitType, setRecoverUnitType] = useState(0);
  const [recoverAmount, setRecoverAmount] = useState(1);

  const woundedCounts = useMemo(() => {
    if (!estate) return WOUNDED_UNITS.map((u) => ({ ...u, count: 0 }));
    return WOUNDED_UNITS.map((u) => ({ ...u, count: estate[u.field] ?? 0 }));
  }, [estate]);

  const totalWounded = woundedCounts.reduce((sum, u) => sum + u.count, 0);
  const selectedWoundedMax = woundedCounts[recoverUnitType]?.count ?? 0;

  const infirmaryLevel = useMemo(() => {
    if (!estate) return 0;
    const b = findBuilding(estate, 18);
    return b?.level ?? 0;
  }, [estate]);

  const recoveryCostPreview = useMemo(() => {
    if (!geData?.account || recoverAmount <= 0) return null;
    const ec = geData.account.economicConfig;
    const baseCosts = [
      ec.defensiveUnit1Cost, ec.defensiveUnit2Cost, ec.defensiveUnit3Cost,
      ec.operativeUnit1Cost, ec.operativeUnit2Cost, ec.operativeUnit3Cost,
    ];
    const baseCost = baseCosts[recoverUnitType]?.toNumber() ?? 0;
    const infirmaryLevelDiscount = infirmaryLevel * 25;
    const dailyBps = estate?.infirmaryRecoveryDailyBps ?? 0;
    return calculateRecoveryCost(baseCost, infirmaryLevelDiscount, dailyBps, recoverAmount);
  }, [geData, recoverUnitType, recoverAmount, estate, infirmaryLevel]);

  const handleRecoverTroops = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    if (recoverAmount <= 0 || recoverAmount > selectedWoundedMax) {
      throw new Error("Invalid recovery amount");
    }
    const ge = client.gameEngine;
    const ix = createRecoverTroopsInstruction(
      { owner: publicKey, gameEngine: ge },
      { unitType: recoverUnitType, amount: recoverAmount }
    );
    return transact.mutateAsync({
      instructions: [ix],
      invalidateKeys: [["estate"], ["player"]],
      successMessage: `Recovered ${recoverAmount} ${WOUNDED_UNITS[recoverUnitType]?.label}!`,
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  if (!estateData?.exists) {
    return (
      <div className="card text-center">
        <p className="text-sm text-text-muted">Create an estate first to access the Infirmary.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Infirmary status */}
      <div className="flex items-center gap-4 text-sm">
        <div>
          <span className="text-text-muted">Infirmary Level </span>
          <span className="font-semibold text-text-primary">{infirmaryLevel}</span>
        </div>
        {infirmaryLevel > 0 && (
          <div>
            <span className="text-text-muted">Discount </span>
            <span className="font-semibold text-green-600">{(infirmaryLevel * 25 / 100).toFixed(1)}%</span>
          </div>
        )}
        <div>
          <span className="text-text-muted">Total Wounded </span>
          <span className={`font-semibold ${totalWounded > 0 ? "text-red-400" : "text-text-primary"}`}>
            {totalWounded.toLocaleString()}
          </span>
        </div>
      </div>

      {totalWounded === 0 ? (
        <div className="card">
          <p className="text-sm text-text-muted">No wounded units to recover. Your troops are in good health.</p>
        </div>
      ) : (
        <>
          {/* Wounded unit grid */}
          <div className="grid gap-2 grid-cols-3 md:grid-cols-6">
            {woundedCounts.map((u) => (
              <button
                key={u.type}
                onClick={() => {
                  setRecoverUnitType(u.type);
                  setRecoverAmount(Math.min(recoverAmount, u.count || 1));
                }}
                disabled={u.count === 0}
                className={`rounded-lg border p-3 text-center transition-all ${
                  recoverUnitType === u.type && u.count > 0
                    ? "border-red-600 bg-red-900/20"
                    : u.count > 0
                      ? "border-border-default hover:border-red-800/40"
                      : "border-border-default opacity-40"
                }`}
              >
                <div className="text-xs text-text-muted">{u.label}</div>
                <div className={`text-lg font-semibold ${u.count > 0 ? "text-red-400" : "text-text-muted"}`}>
                  {u.count.toLocaleString()}
                </div>
              </button>
            ))}
          </div>

          {/* Recovery controls */}
          {selectedWoundedMax > 0 && (
            <div className="card">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted">
                Recover {woundedCounts[recoverUnitType]?.label}
              </h3>
              <NumberField
                label="Amount"
                value={recoverAmount}
                onChange={setRecoverAmount}
                min={1}
                max={selectedWoundedMax}
              />
              <div className="mt-3 flex items-baseline justify-between text-xs">
                <span className="text-text-muted">Estimated Cost</span>
                <span className="text-sm font-semibold text-text-gold">
                  {recoveryCostPreview != null ? recoveryCostPreview.toLocaleString() : "—"} NOVI
                </span>
              </div>
              <div className="mt-1 text-[11px] text-text-muted">
                50% of hire cost{estate?.infirmaryRecoveryDailyBps ? ` + ${bpsToPercent(estate.infirmaryRecoveryDailyBps)} daily buff` : ""}
              </div>
              <div className="mt-4">
                <TxButton
                  onClick={handleRecoverTroops}
                  disabled={recoverAmount <= 0 || recoverAmount > selectedWoundedMax}
                  className="px-6"
                >
                  Recover {recoverAmount} {woundedCounts[recoverUnitType]?.label}
                </TxButton>
              </div>
            </div>
          )}
        </>
      )}

      {infirmaryLevel === 0 && (
        <div className="card border-amber-800/30">
          <p className="text-sm text-text-muted">
            Build or upgrade the <span className="text-text-gold">Infirmary</span> to reduce recovery costs.
            Each level gives a 0.25% discount.
          </p>
        </div>
      )}
    </div>
  );
}
