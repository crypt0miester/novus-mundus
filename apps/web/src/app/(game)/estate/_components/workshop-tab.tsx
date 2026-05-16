"use client";

import { useState } from "react";
import { usePlayer } from "@/lib/hooks/usePlayer";
import { useEstate } from "@/lib/hooks/useEstate";
import { useTransact } from "@/lib/hooks/useTransact";
import { useNovusMundusClient } from "@/lib/solana/provider";
import { useWallet } from "@solana/wallet-adapter-react";
import { GoldNumber } from "@/components/shared/GoldNumber";
import { TxButton } from "@/components/shared/TxButton";
import type { TxPhase } from "@/components/shared/TxButton";
import { createConvertMaterialsInstruction } from "novus-mundus-sdk";

const MATERIAL_TIERS = [
  { id: 0, name: "Common", field: "commonMaterials" as const },
  { id: 1, name: "Uncommon", field: "uncommonMaterials" as const },
  { id: 2, name: "Rare", field: "rareMaterials" as const },
  { id: 3, name: "Epic", field: "epicMaterials" as const },
];

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

  const handleConvertMaterials = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    const ge = client.gameEngine;
    const ix = createConvertMaterialsInstruction(
      { owner: publicKey, gameEngine: ge },
      { fromTier: convertFromTier, conversions: convertAmount },
    );
    return transact.mutateAsync({
      instructions: [ix],
      invalidateKeys: [["estate"], ["player"]],
      successMessage: `Converted ${convertAmount * 100} ${MATERIAL_TIERS[convertFromTier]?.name} to ${convertAmount * 20} ${MATERIAL_TIERS[convertFromTier + 1]?.name}!`,
      onPhase: reportPhase,
    }).then((r) => r.signature);
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

  return (
    <div className="space-y-4">
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

      {/* Conversion panel */}
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
          <div className="flex gap-2">
            {MATERIAL_TIERS.map((tier) => (
              <button
                key={tier.id}
                onClick={() => setConvertFromTier(tier.id)}
                className={`rounded-lg border px-3 py-2 text-sm transition-all ${
                  convertFromTier === tier.id
                    ? "border-amber-600 bg-amber-900/20 text-text-gold"
                    : "border-border-default text-text-muted hover:border-amber-800/40"
                }`}
              >
                {tier.name}
              </button>
            ))}
          </div>
          <div className="mt-1 text-[11px] text-text-muted">
            {fromMat?.name} &rarr; {toName} &middot; Available: {availableFrom.toLocaleString()} (max {maxConversions} conversions)
          </div>
        </div>

        {/* Amount + action */}
        <div className="flex items-end gap-4">
          <div>
            <label className="mb-1 block text-xs text-text-muted">Conversions</label>
            <input
              type="number"
              value={convertAmount}
              onChange={(e) => setConvertAmount(Math.max(1, parseInt(e.target.value) || 1))}
              className="w-24 rounded-lg border border-border-default bg-surface px-3 py-2 text-sm text-text-primary"
              min={1}
            />
          </div>
          <div className="text-xs text-text-muted">
            = {(convertAmount * 100).toLocaleString()} {fromMat?.name} &rarr; {(convertAmount * 20).toLocaleString()} {toName}
          </div>
          <TxButton
            onClick={handleConvertMaterials}
            disabled={convertAmount > maxConversions}
            className="px-6"
          >
            Convert
          </TxButton>
        </div>
        {convertAmount > maxConversions && maxConversions >= 0 && (
          <div className="mt-2 text-xs text-red-400">
            Not enough {fromMat?.name} materials (need {(convertAmount * 100).toLocaleString()}, have {availableFrom.toLocaleString()})
          </div>
        )}
      </div>
    </div>
  );
}
