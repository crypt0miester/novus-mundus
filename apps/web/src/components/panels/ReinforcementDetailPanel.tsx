"use client";

// Detail + actions for a single in-flight reinforcement, hosted inside the map's
// floating panel (opened from the Forces HUD). Mirrors the in-flight rows of
// reinforce-tab but for one reinforcement: shows direction, counterparty, units,
// route, and the live arrive/return countdown, with the permissioned actions
// (Process Arrival / Recall / Relieve) plus a sender-paid travel speedup.

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { PublicKey } from "@solana/web3.js";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import {
  parseReinforcement,
  parsePlayer,
  derivePlayerPda,
  createProcessArrivalInstruction,
  createRecallReinforcementInstruction,
  createRelieveReinforcementInstruction,
  createReinforcementSpeedupInstruction,
} from "novus-mundus-sdk";
import { usePlayer } from "@/lib/hooks/usePlayer";
import { useGameEngine } from "@/lib/hooks/useGameEngine";
import { useTransact } from "@/lib/hooks/useTransact";
import { useNovusMundusClient } from "@/lib/solana/provider";
import { useRightPanelStore } from "@/lib/store/right-panel";
import { GoldCountdown } from "@/components/shared/GoldCountdown";
import { GoldNumber } from "@/components/shared/GoldNumber";
import { SpeedupPanel, maxSpeedupCount } from "@/components/shared/SpeedupPanel";
import { TxButton } from "@/components/shared/TxButton";
import type { TxPhase } from "@/components/shared/TxButton";
import { DomainName } from "@/components/shared/DomainName";

const STATUS_LABEL = ["Traveling", "Active", "Returning", "Completed"];

interface ReinforcementDetailPanelProps {
  reinforcementPubkey: string;
  // Dismiss override; defaults to the global RightPanel closer (see RallyDetailPanel).
  onClose?: () => void;
}

export function ReinforcementDetailPanel({
  reinforcementPubkey,
  onClose,
}: ReinforcementDetailPanelProps) {
  const { publicKey } = useWallet();
  const { connection } = useConnection();
  const client = useNovusMundusClient();
  const transact = useTransact();
  const { data: geData } = useGameEngine();
  const ge = geData?.account;
  const { data: playerData } = usePlayer();
  const player = playerData?.account;
  const storeClose = useRightPanelStore((s) => s.close);
  const close = onClose ?? storeClose;

  const key = useMemo(() => new PublicKey(reinforcementPubkey), [reinforcementPubkey]);

  const { data, isLoading } = useQuery({
    queryKey: [
      "reinforcement",
      "detail",
      reinforcementPubkey,
      publicKey?.toBase58() ?? "",
      transact.isPending,
    ],
    enabled: !!publicKey,
    queryFn: async () => {
      const info = await connection.getAccountInfo(key);
      const account = info ? parseReinforcement(info) : null;
      if (!account || !publicKey) return null;
      const [myPlayerPda] = await derivePlayerPda(client.gameEngine, publicKey);
      const direction: "sent" | "received" = account.sender.equals(myPlayerPda)
        ? "sent"
        : "received";
      // Both wallets: the sender wallet drives Relieve, the destination wallet
      // drives Recall + Speedup (they key the reinforcement PDA on the wallet).
      const [sInfo, dInfo] = await connection.getMultipleAccountsInfo([
        account.sender,
        account.destination,
      ]);
      const senderWallet = sInfo ? (parsePlayer(sInfo)?.owner ?? null) : null;
      const destWallet = dInfo ? (parsePlayer(dInfo)?.owner ?? null) : null;
      return { account, direction, senderWallet, destWallet };
    },
    staleTime: 10_000,
  });

  if (isLoading) return <p className="text-sm text-text-muted">Loading reinforcement...</p>;
  if (!data) {
    return <p className="text-sm text-text-muted">This reinforcement is no longer in flight.</p>;
  }

  const { account, direction, senderWallet, destWallet } = data;
  const status = account.status ?? 0;
  const counterparty = direction === "sent" ? account.destination : account.sender;
  const totalUnits =
    (Number(account.unitsDef1 ?? 0n)) +
    (Number(account.unitsDef2 ?? 0n)) +
    (Number(account.unitsDef3 ?? 0n));
  const arrivesAt = Number(account.arrivesAt ?? 0n);
  const returnAt = (Number(account.returnStartedAt ?? 0n)) + (account.returnDuration ?? 0);
  const gemsPerMinute = ge?.gameplayConfig.gemCostPerMinuteSpeedup ?? 1;
  // Seconds left on whichever leg is in flight. The on-chain speedup handles
  // both the outbound (Traveling) and return (Returning) trips via the same
  // instruction, so we surface a remaining clock for each.
  const nowSec = Math.floor(Date.now() / 1000);
  const remaining =
    status === 0 && arrivesAt > 0
      ? Math.max(0, arrivesAt - nowSec)
      : status === 2 && returnAt > 0
        ? Math.max(0, returnAt - nowSec)
        : 0;
  // Hold-to-charge caps for the two tiers (T1 50%/1x, T2 25%/2x), priced the
  // same way the reinforcement processor does so the cap matches the chain.
  const gemBalance = Number(player?.gems ?? 0n);
  const speedupTiers = [
    {
      tier: 1,
      label: "Hasten",
      description: "50% time reduction",
      maxCount: maxSpeedupCount({
        remainingSeconds: remaining,
        timeMultiplier: 0.5,
        costMultiplier: 1,
        gemsPerMinute,
        gemBalance,
      }),
    },
    {
      tier: 2,
      label: "Rush",
      description: "75% time reduction",
      maxCount: maxSpeedupCount({
        remainingSeconds: remaining,
        timeMultiplier: 0.25,
        costMultiplier: 2,
        gemsPerMinute,
        gemBalance,
      }),
    },
  ];

  const handleProcessArrival = async (reportPhase: (p: TxPhase) => void) => {
    const ix = await createProcessArrivalInstruction({
      reinforcement: key,
      destinationPlayer: account.destination,
    });
    return transact
      .mutateAsync({
        instructions: [ix],
        invalidateKeys: [["player"]],
        successMessage: "Reinforcement arrival processed!",
        onPhase: reportPhase,
      })
      .then((r) => r.signature);
  };

  const handleRecall = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey || !destWallet) throw new Error("Destination wallet unresolved");
    const ix = await createRecallReinforcementInstruction({
      sender: publicKey,
      gameEngine: client.gameEngine,
      destinationOwner: destWallet,
      senderCityId: account.senderCity ?? 0,
      destinationCityId: account.destinationCity ?? 0,
    });
    return transact
      .mutateAsync({
        instructions: [ix],
        invalidateKeys: [["player"]],
        successMessage: "Reinforcements recalled!",
        onPhase: reportPhase,
      })
      .then((r) => {
        close();
        return r.signature;
      });
  };

  const handleRelieve = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey || !senderWallet) throw new Error("Sender wallet unresolved");
    const ix = await createRelieveReinforcementInstruction({
      destinationOwner: publicKey,
      gameEngine: client.gameEngine,
      senderOwner: senderWallet,
      senderCityId: account.senderCity ?? 0,
      destinationCityId: account.destinationCity ?? 0,
    });
    return transact
      .mutateAsync({
        instructions: [ix],
        invalidateKeys: [["player"]],
        successMessage: "Reinforcements relieved (sent back)!",
        onPhase: reportPhase,
      })
      .then((r) => {
        close();
        return r.signature;
      });
  };

  const handleSpeedup = async (
    tier: number,
    reportPhase: (p: TxPhase) => void,
    count: number = 1,
  ) => {
    if (!publicKey || !destWallet) throw new Error("Destination wallet unresolved");
    const destinationOwner = destWallet;
    // Hold-to-charge packs `count` speedups into one tx; each reads the live
    // timer, so the in-flight leg collapses step by step.
    const n = Math.max(1, Math.floor(count));
    const instructions = await Promise.all(
      Array.from({ length: n }, () =>
        createReinforcementSpeedupInstruction(
          { sender: publicKey, gameEngine: client.gameEngine, destinationOwner },
          { speedupTier: tier as 1 | 2 },
        ),
      ),
    );
    return transact
      .mutateAsync({
        instructions,
        invalidateKeys: [["player"]],
        successMessage: n > 1 ? `Reinforcement sped up ×${n}!` : "Reinforcement travel sped up!",
        onPhase: reportPhase,
      })
      .then((r) => r.signature);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs text-text-muted">{direction === "sent" ? "Sent to" : "From"}</div>
          <div className="font-mono text-sm text-text-primary">
            <DomainName pubkey={counterparty} chars={4} />
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs text-text-muted">Status</div>
          <div className="text-sm font-semibold text-text-primary">
            {STATUS_LABEL[status] ?? `Status ${status}`}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 rounded-lg border border-zinc-800 bg-surface/60 p-3">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-text-muted">Units</div>
          <GoldNumber value={totalUnits} size="sm" />
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-text-muted">Route</div>
          <div className="text-sm text-text-primary">
            City {account.senderCity} to City {account.destinationCity}
          </div>
        </div>
      </div>

      {status === 0 && arrivesAt > 0 && (
        <div className="rounded-lg border border-zinc-800 bg-surface/60 p-3">
          <GoldCountdown endsAt={arrivesAt} label="Arrives" showProgress format="compact" />
        </div>
      )}
      {status === 2 && returnAt > 0 && (
        <div className="rounded-lg border border-zinc-800 bg-surface/60 p-3">
          <GoldCountdown endsAt={returnAt} label="Returns" showProgress format="compact" />
        </div>
      )}

      <div className="space-y-3">
        {/* Process Arrival is permissionless (no signer on-chain), so either
            side can crank a landed reinforcement to Active. The receiver needs
            it before they can Relieve, so it is not gated to the sender. */}
        {status === 0 && (
          <TxButton onClick={handleProcessArrival} variant="secondary">
            Process Arrival
          </TxButton>
        )}
        {direction === "sent" && (status === 0 || status === 1) && (
          <TxButton onClick={handleRecall} variant="secondary">
            Recall
          </TxButton>
        )}
        {direction === "received" && status === 1 && (
          <TxButton onClick={handleRelieve} variant="secondary">
            Relieve (send back)
          </TxButton>
        )}
      </div>

      {/* Speedup is sender-only on-chain and works on either leg, so the sender
          can hurry both the outbound trip and the return (e.g. after a relief or
          recall). The receiver never sees it. */}
      {direction === "sent" && (status === 0 || status === 2) && remaining > 0 && (
        <SpeedupPanel
          visible={remaining > 0}
          remainingSeconds={remaining}
          tiers={speedupTiers}
          onSpeedup={(tier, rp, count) => handleSpeedup(tier, rp, count)}
          gemsPerMinute={gemsPerMinute}
          gemBalance={gemBalance}
        />
      )}
    </div>
  );
}
