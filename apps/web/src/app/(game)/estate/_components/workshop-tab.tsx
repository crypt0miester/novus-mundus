"use client";

import { useState, useMemo } from "react";
import { usePlayer } from "@/lib/hooks/usePlayer";
import { useEstate } from "@/lib/hooks/useEstate";
import { useTransact } from "@/lib/hooks/useTransact";
import { useNovusMundusClient } from "@/lib/solana/provider";
import { useWallet } from "@solana/wallet-adapter-react";
import { BuildingId } from "@/lib/hooks/useFeatureGate";
import { GoldNumber } from "@/components/shared/GoldNumber";
import { TxButton } from "@/components/shared/TxButton";
import type { TxPhase } from "@/components/shared/TxButton";
import { NumberField } from "@/components/shared/NumberField";
import { FeatureLayout } from "./feature-layout";
import { BuildingShowcase } from "./building-showcase";
import { createConvertMaterialsInstruction } from "novus-mundus-sdk";

const MATERIAL_TIERS = [
  { id: 0, name: "Common", field: "commonMaterials" as const },
  { id: 1, name: "Uncommon", field: "uncommonMaterials" as const },
  { id: 2, name: "Rare", field: "rareMaterials" as const },
  { id: 3, name: "Epic", field: "epicMaterials" as const },
];

// convert_materials.rs gates each conversion on the Workshop's level, indexed
// by the from-tier: Common to 1, Uncommon to 5, Rare to 10, Epic to 15.
const WORKSHOP_LEVEL_REQ = [1, 5, 10, 15];

const ALL_MATERIALS = [
  { name: "Common", field: "commonMaterials" as const },
  { name: "Uncommon", field: "uncommonMaterials" as const },
  { name: "Rare", field: "rareMaterials" as const },
  { name: "Epic", field: "epicMaterials" as const },
  { name: "Legendary", field: "legendaryMaterials" as const },
];

export function WorkshopTab() {
  const { data: playerData } = usePlayer();
  const { data: estateData } = useEstate();
  const client = useNovusMundusClient();
  const { publicKey } = useWallet();
  const transact = useTransact();

  const player = playerData?.account;

  const [convertFromTier, setConvertFromTier] = useState(0);
  const [convertAmount, setConvertAmount] = useState(1);

  // The estate's Workshop level — gates which tiers can be converted.
  const workshopLevel = useMemo(() => {
    const buildings = estateData?.account?.buildings;
    if (!buildings) return 0;
    const ws = buildings.find(
      (b: { buildingType: number; status: number; level: number }) =>
        b.buildingType === BuildingId.Workshop && (b.status === 2 || b.status === 3),
    );
    return ws?.level ?? 0;
  }, [estateData]);

  const handleConvertMaterials = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    const ge = client.gameEngine;
    const ix = createConvertMaterialsInstruction(
      { owner: publicKey, gameEngine: ge },
      { fromTier: convertFromTier, conversions: convertAmount },
    );
    return transact
      .mutateAsync({
        instructions: [ix],
        invalidateKeys: [["estate"], ["player"]],
        successMessage: `Converted ${convertAmount * 100} ${MATERIAL_TIERS[convertFromTier]?.name} to ${convertAmount * 20} ${MATERIAL_TIERS[convertFromTier + 1]?.name}!`,
        onPhase: reportPhase,
      })
      .then((r) => r.signature);
  };

  if (!estateData?.exists) {
    return (
      <div className="card text-center">
        <p className="text-sm text-text-muted">Create an estate first to access the Workshop.</p>
      </div>
    );
  }

  const fromMat = MATERIAL_TIERS[convertFromTier];
  const toName = MATERIAL_TIERS[convertFromTier + 1]?.name ?? "Legendary";
  const availableFrom = player?.[fromMat?.field]?.toNumber?.() ?? 0;
  const maxConversions = Math.floor(availableFrom / 100);
  const requiredWorkshop = WORKSHOP_LEVEL_REQ[convertFromTier] ?? 99;
  const workshopOk = workshopLevel >= requiredWorkshop;

  return (
    <FeatureLayout
      main={
        <>
          <BuildingShowcase buildingId={BuildingId.Workshop} icon="unit-artisan" />
          {/* Material inventory */}
          <div className="grid gap-2 grid-cols-5">
            {ALL_MATERIALS.map((m) => {
              const val = player?.[m.field]?.toNumber?.() ?? 0;
              return (
                <div key={m.name} className="card text-center">
                  <div className="text-[10px] text-text-muted">{m.name}</div>
                  <GoldNumber value={val} size="sm" glow={val > 0} />
                </div>
              );
            })}
          </div>
        </>
      }
      aside={
        /* Conversion panel */
        <div className="card">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted">
            Convert Materials
          </h3>
          <p className="mb-4 text-xs text-text-muted">
            Convert 100 lower-tier materials into 20 higher-tier materials per conversion.
          </p>

          {/* Tier selector */}
          <div className="mb-4">
            <div className="text-xs text-text-muted mb-2">Convert From:</div>
            <div className="flex gap-2 flex-wrap">
              {MATERIAL_TIERS.map((tier) => {
                const locked = workshopLevel < (WORKSHOP_LEVEL_REQ[tier.id] ?? 99);
                return (
                  <button
                    key={tier.id}
                    onClick={() => setConvertFromTier(tier.id)}
                    className={`rounded-lg border px-3 py-2 text-sm transition-all ${
                      convertFromTier === tier.id
                        ? "border-border-gold bg-accent/20 text-text-gold"
                        : "border-border-default text-text-muted hover:border-border-gold/40"
                    }`}
                  >
                    {tier.name}
                    {locked && (
                      <span className="ml-1 text-[10px] text-text-gold">
                        Lv{WORKSHOP_LEVEL_REQ[tier.id]}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            <div className="mt-1 text-[11px] text-text-muted">
              {fromMat?.name} {">"} {toName}
            </div>
            <div className="mt-1 text-[11px] text-text-muted">
              Available: {availableFrom.toLocaleString()}{" "}
              (max {maxConversions} conversions)
            </div>
          </div>

          {/* Amount + action */}
          <div className="space-y-3">
            <NumberField
              label="Conversions"
              value={convertAmount}
              onChange={setConvertAmount}
              min={1}
              max={maxConversions}
            />
            <div className="text-xs text-text-muted">
              = {(convertAmount * 100).toLocaleString()} {fromMat?.name} &rarr;{" "}
              {(convertAmount * 20).toLocaleString()} {toName}
            </div>
            <TxButton
              onClick={handleConvertMaterials}
              disabled={convertAmount > maxConversions || !workshopOk}
              className="w-full"
            >
              Convert
            </TxButton>
          </div>
          {!workshopOk && (
            <div className="mt-2 text-xs text-danger">
              {fromMat?.name} to {toName} needs Workshop Lv {requiredWorkshop}.
            </div>
          )}
          {workshopOk && convertAmount > maxConversions && maxConversions >= 0 && (
            <div className="mt-2 text-xs text-red-400">
              Not enough {fromMat?.name} materials (need {(convertAmount * 100).toLocaleString()},
              have {availableFrom.toLocaleString()})
            </div>
          )}
        </div>
      }
    />
  );
}
