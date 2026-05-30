"use client";

// Detail + actions for the player's garrison at a castle, hosted inside the map's
// floating panel (opened from the Forces HUD). The HUD hands the CASTLE pubkey;
// this resolves the castle and the caller's own GarrisonContribution at it, then
// surfaces the contributed units, captured loot, and the Claim / Leave actions.

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { PublicKey } from "@solana/web3.js";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import {
  parseCastle,
  parseGarrisonContribution,
  derivePlayerPda,
  deriveGarrisonPda,
  createClaimGarrisonLootInstruction,
  createLeaveGarrisonInstruction,
} from "novus-mundus-sdk";
import { useTransact } from "@/lib/hooks/useTransact";
import { useNovusMundusClient } from "@/lib/solana/provider";
import { useRightPanelStore } from "@/lib/store/right-panel";
import { GoldNumber } from "@/components/shared/GoldNumber";
import { TxButton } from "@/components/shared/TxButton";
import type { TxPhase } from "@/components/shared/TxButton";
import { CASTLE_TIER_NAMES, CASTLE_STATUS_NAMES } from "@/lib/world/castles";

interface GarrisonDetailPanelProps {
  // The CASTLE pubkey the garrison sits at (the Forces HUD passes account.castle).
  castlePubkey: string;
  // Dismiss override; defaults to the global RightPanel closer (see RallyDetailPanel).
  onClose?: () => void;
}

export function GarrisonDetailPanel({ castlePubkey, onClose }: GarrisonDetailPanelProps) {
  const { publicKey } = useWallet();
  const { connection } = useConnection();
  const client = useNovusMundusClient();
  const transact = useTransact();
  const storeClose = useRightPanelStore((s) => s.close);
  const close = onClose ?? storeClose;

  const key = useMemo(() => new PublicKey(castlePubkey), [castlePubkey]);

  const { data, isLoading } = useQuery({
    queryKey: ["garrison", "detail", castlePubkey, publicKey?.toBase58() ?? "", transact.isPending],
    enabled: !!publicKey,
    queryFn: async () => {
      const cInfo = await connection.getAccountInfo(key);
      const castle = cInfo ? parseCastle(cInfo) : null;
      if (!castle || !publicKey) return null;
      const [myPlayerPda] = derivePlayerPda(client.gameEngine, publicKey);
      const [garrisonPda] = deriveGarrisonPda(key, myPlayerPda);
      const gInfo = await connection.getAccountInfo(garrisonPda);
      const garrison = gInfo ? parseGarrisonContribution(gInfo) : null;
      return { castle, garrison };
    },
    staleTime: 10_000,
  });

  if (isLoading) return <p className="text-sm text-text-muted">Loading garrison...</p>;
  if (!data) return <p className="text-sm text-text-muted">Castle not found.</p>;

  const { castle, garrison } = data;
  const units = garrison
    ? (garrison.du1?.toNumber?.() ?? 0) +
      (garrison.du2?.toNumber?.() ?? 0) +
      (garrison.du3?.toNumber?.() ?? 0)
    : 0;
  const loot = garrison
    ? (garrison.lootMelee?.toNumber?.() ?? 0) +
      (garrison.lootRanged?.toNumber?.() ?? 0) +
      (garrison.lootSiege?.toNumber?.() ?? 0)
    : 0;
  const hasUnclaimedLoot = !!garrison && !garrison.lootClaimed && loot > 0;
  const statusLine = castle.isVacant
    ? "Vacant"
    : (CASTLE_STATUS_NAMES[castle.status] ?? `S${castle.status}`);

  const handleClaim = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    return transact
      .mutateAsync({
        instructions: [
          createClaimGarrisonLootInstruction({
            owner: publicKey,
            gameEngine: client.gameEngine,
            cityId: castle.cityId,
            castleId: castle.castleId,
          }),
        ],
        invalidateKeys: [["castle"], ["player"]],
        successMessage: "Garrison loot claimed!",
        onPhase: reportPhase,
      })
      .then((r) => r.signature);
  };

  const handleLeave = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    return transact
      .mutateAsync({
        instructions: [
          createLeaveGarrisonInstruction({
            owner: publicKey,
            gameEngine: client.gameEngine,
            cityId: castle.cityId,
            castleId: castle.castleId,
          }),
        ],
        invalidateKeys: [["castle"], ["player"]],
        successMessage: "Left the garrison.",
        onPhase: reportPhase,
      })
      .then((r) => {
        close();
        return r.signature;
      });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs text-text-muted">Garrison at</div>
          <div className="text-sm font-semibold text-text-primary">
            {castle.name?.trim() || `Castle ${castle.castleId}`}
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs text-text-muted">City {castle.cityId}</div>
          <div className="text-sm text-text-primary">
            {CASTLE_TIER_NAMES[castle.tier] ?? `T${castle.tier}`} · {statusLine}
          </div>
        </div>
      </div>

      {garrison ? (
        <>
          <div className="grid grid-cols-2 gap-3 rounded-lg border border-zinc-800 bg-surface/60 p-3">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-text-muted">Your units</div>
              <GoldNumber value={units} size="sm" />
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-text-muted">
                Captured loot
              </div>
              <GoldNumber value={loot} size="sm" />
            </div>
          </div>

          <div className="space-y-3">
            {hasUnclaimedLoot && <TxButton onClick={handleClaim}>Claim Loot</TxButton>}
            <TxButton onClick={handleLeave} variant="danger">
              Leave Garrison
            </TxButton>
          </div>
        </>
      ) : (
        <p className="text-sm text-text-muted">You do not have a garrison at this castle.</p>
      )}
    </div>
  );
}
