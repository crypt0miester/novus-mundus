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
  createCollectResourcesInstruction,
  createUpdateLockedNoviInstruction,
} from "novus-mundus-sdk";

// Gem mining is collection type 1 on-chain.
const COLLECTION_TYPE = 1;

export function MineTab() {
  const { data: playerData } = usePlayer();
  const { data: estateData } = useEstate();
  const client = useNovusMundusClient();
  const { publicKey } = useWallet();
  const transact = useTransact();

  const player = playerData?.account;
  const [collectNoviAmount, setCollectNoviAmount] = useState(100);

  const gate = useFeatureGate(FEATURES.COLLECT_MINING);

  const handleCollect = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    const ge = client.gameEngine;
    const ix = createCollectResourcesInstruction(
      { owner: publicKey, gameEngine: ge },
      { noviAmount: collectNoviAmount, collectionType: COLLECTION_TYPE }
    );
    return transact.mutateAsync({
      instructions: [ix],
      invalidateKeys: [["player"]],
      successMessage: "Mined gems from the veins!",
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  const handleClaimAndCollect = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    const ge = client.gameEngine;
    const claimIx = createUpdateLockedNoviInstruction({ owner: publicKey, gameEngine: ge });
    const collectIx = createCollectResourcesInstruction(
      { owner: publicKey, gameEngine: ge },
      { noviAmount: collectNoviAmount, collectionType: COLLECTION_TYPE }
    );
    return transact.mutateAsync({
      instructions: [claimIx, collectIx],
      invalidateKeys: [["player"]],
      successMessage: "Claimed NOVI & mined gems!",
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  if (!estateData?.exists) {
    return (
      <div className="card text-center">
        <p className="text-sm text-text-muted">Create an estate first to access the Mine.</p>
      </div>
    );
  }
  if (!player) return null;

  const noviBalance = player.lockedNovi?.toNumber?.() ?? 0;
  const gems = player.gems?.toNumber?.() ?? 0;
  const operativeUnits =
    (player.operativeUnit1?.toNumber?.() ?? 0) +
    (player.operativeUnit2?.toNumber?.() ?? 0) +
    (player.operativeUnit3?.toNumber?.() ?? 0);
  const hasEnough = noviBalance >= collectNoviAmount;

  return (
    <div className="space-y-4">
      <p className="text-xs italic text-text-muted">{buildingFraming(BuildingId.Mine).line}</p>

      <NoviGenerator compact />

      {!gate.allowed && gate.missing.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {gate.missing.map((m) => (
            <Link key={m.label} href={m.href} className="inline-flex items-center gap-1 rounded-md border border-amber-800/50 bg-amber-900/20 px-2.5 py-1 text-xs font-medium text-text-gold hover:bg-amber-900/40">
              {m.label}<ChevronRight className="h-3.5 w-3.5" />
            </Link>
          ))}
        </div>
      )}

      {/* The ledger: NOVI spent down the shaft, gems carried back up. */}
      <div className="grid gap-2 grid-cols-2">
        <div className="card">
          <div className="text-[10px] uppercase tracking-wider text-text-muted">Sent Down</div>
          <div className="mt-1 font-mono text-sm tabular-nums text-text-gold">
            {noviBalance.toLocaleString()} NOVI on hand
          </div>
        </div>
        <div className="card">
          <div className="text-[10px] uppercase tracking-wider text-text-muted">Brought Up</div>
          <div className="mt-1">
            <GoldNumber value={gems} prefix="✦ " size="sm" glow={gems > 0} />
          </div>
        </div>
      </div>

      {gate.allowed && (
        <div className="card">
          <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted">
            Work the Veins
          </h4>
          <div className="space-y-3">
            <div className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold ${operativeUnits > 0 ? "bg-purple-900/30 text-fuchsia-400" : "bg-red-900/20 text-red-400"}`}>
              {operativeUnits > 0 ? `Operative Units: ${operativeUnits.toLocaleString()}` : "No operative units"}
            </div>
            <div>
              <label className="mb-1 block text-xs text-text-muted">NOVI to spend</label>
              <input
                type="number"
                value={collectNoviAmount}
                onChange={(e) => setCollectNoviAmount(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-full rounded-lg border border-zinc-800 bg-surface px-3 py-2 text-sm font-mono text-text-primary tabular-nums"
                min={1}
              />
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <TxButton onClick={handleCollect} disabled={operativeUnits === 0 || !hasEnough} className="flex-1">
                {hasEnough ? "Mine Gems" : "Insufficient NOVI"}
              </TxButton>
              <TxButton onClick={handleClaimAndCollect} variant="secondary" className="flex-1 text-xs" disabled={operativeUnits === 0}>
                Claim NOVI &amp; Mine
              </TxButton>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
