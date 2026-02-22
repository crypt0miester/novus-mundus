"use client";

import { useState, useMemo } from "react";
import { usePlayer } from "@/lib/hooks/usePlayer";
import { useTransact } from "@/lib/hooks/useTransact";
import { useNovusMundusClient } from "@/lib/solana/provider";
import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { useGameEngine } from "@/lib/hooks/useGameEngine";
import { GoldNumber } from "@/components/shared/GoldNumber";
import { GoldCountdown } from "@/components/shared/GoldCountdown";
import { SpeedupPanel } from "@/components/shared/SpeedupPanel";
import { TxButton } from "@/components/shared/TxButton";
import type { TxPhase } from "@/components/shared/TxButton";
import {
  derivePlayerPda,
  deriveReinforcementPda,
  createSendReinforcementInstruction,
  createRecallReinforcementInstruction,
  createProcessArrivalInstruction,
  createRelieveReinforcementInstruction,
  createReinforcementSpeedupInstruction,
  isTraveling,
  getCurrentTimeOfDay,
  getTimeOfDayName,
  getActivityMultiplier,
  getTotalDefensiveUnits,
} from "@/lib/sdk";

const REINFORCEMENT_STATUS = ["Traveling", "Active", "Returning", "Completed"];

export function ReinforceTab() {
  const { data: playerData } = usePlayer();
  const player = playerData?.account;
  const { data: geData } = useGameEngine();
  const ge = geData?.account;
  const client = useNovusMundusClient();
  const { publicKey } = useWallet();
  const transact = useTransact();

  const nowSec = Math.floor(Date.now() / 1000);
  const traveling = player ? isTraveling(player) : false;
  const tod = useMemo(() => getCurrentTimeOfDay(nowSec, 0), [nowSec]);
  const todName = getTimeOfDayName(tod);
  const totalDefensive = player ? getTotalDefensiveUnits(player).toNumber() : 0;

  const [targetAddress, setTargetAddress] = useState("");
  const [units, setUnits] = useState(10);

  const isValidAddress = useMemo(() => {
    if (!targetAddress.trim()) return false;
    try {
      new PublicKey(targetAddress.trim());
      return true;
    } catch {
      return false;
    }
  }, [targetAddress]);

  const handleSend = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey || !targetAddress) throw new Error("Missing data");
    const ge = client.gameEngine;
    const [playerPda] = derivePlayerPda(ge, publicKey);
    const targetPubkey = new PublicKey(targetAddress);
    const [receiverPda] = derivePlayerPda(ge, targetPubkey);
    const [reinforcementPda] = deriveReinforcementPda(ge, playerPda, receiverPda);
    const ix = createSendReinforcementInstruction(
      {
        player: playerPda,
        receiver: receiverPda,
        reinforcement: reinforcementPda,
        gameEngine: ge,
        owner: publicKey,
      },
      { units }
    );
    return transact.mutateAsync({
      instructions: [ix],
      invalidateKeys: [["player"]],
      successMessage: `Sent ${units} reinforcements!`,
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  const handleRecall = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey || !targetAddress) throw new Error("Missing data");
    const ge = client.gameEngine;
    const [playerPda] = derivePlayerPda(ge, publicKey);
    const targetPubkey = new PublicKey(targetAddress);
    const [receiverPda] = derivePlayerPda(ge, targetPubkey);
    const [reinforcementPda] = deriveReinforcementPda(ge, playerPda, receiverPda);
    const ix = createRecallReinforcementInstruction({
      player: playerPda,
      reinforcement: reinforcementPda,
      gameEngine: ge,
      owner: publicKey,
    });
    return transact.mutateAsync({
      instructions: [ix],
      invalidateKeys: [["player"]],
      successMessage: "Reinforcements recalled!",
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  const handleReinforcementSpeedup = async (tier: number, reportPhase: (p: TxPhase) => void) => {
    if (!publicKey || !targetAddress) throw new Error("Missing data");
    const geKey = client.gameEngine;
    const ix = createReinforcementSpeedupInstruction(
      {
        sender: publicKey,
        gameEngine: geKey,
        destinationOwner: new PublicKey(targetAddress),
      },
      { speedupTier: tier as 1 | 2 },
    );
    return transact.mutateAsync({
      instructions: [ix],
      invalidateKeys: [["player"]],
      successMessage: "Reinforcement travel sped up!",
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  const handleProcessArrival = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey || !targetAddress) throw new Error("Missing data");
    const ge = client.gameEngine;
    const targetPubkey = new PublicKey(targetAddress);
    const [senderPda] = derivePlayerPda(ge, publicKey);
    const [receiverPda] = derivePlayerPda(ge, targetPubkey);
    const [reinforcementPda] = deriveReinforcementPda(ge, publicKey, targetPubkey);
    const ix = createProcessArrivalInstruction({
      reinforcement: reinforcementPda,
      destinationPlayer: receiverPda,
    });
    return transact.mutateAsync({
      instructions: [ix],
      invalidateKeys: [["player"]],
      successMessage: "Reinforcement arrival processed!",
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  const handleRelieve = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey || !targetAddress) throw new Error("Missing data");
    const ge = client.gameEngine;
    const senderPubkey = new PublicKey(targetAddress);
    const ix = createRelieveReinforcementInstruction({
      destinationOwner: publicKey,
      gameEngine: ge,
      senderOwner: senderPubkey,
      senderCityId: 0,
      destinationCityId: player?.currentCity ?? 0,
    });
    return transact.mutateAsync({
      instructions: [ix],
      invalidateKeys: [["player"]],
      successMessage: "Reinforcements relieved (sent back)!",
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-xs text-text-muted">
        <span>{todName}</span>
      </div>

      {traveling && (
        <div className="rounded-lg border border-amber-800 bg-amber-900/20 px-4 py-3 text-sm text-amber-400">
          You are currently traveling. Reinforcement actions may be restricted.
        </div>
      )}

      {/* Your Forces */}
      {player && (
        <div className="card accent-border">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted">
            Available Forces
          </h3>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <div className="text-xs text-text-muted">Infantry</div>
              <GoldNumber value={player.defensiveUnit1?.toNumber?.() ?? 0} />
            </div>
            <div>
              <div className="text-xs text-text-muted">Cavalry</div>
              <GoldNumber value={player.defensiveUnit2?.toNumber?.() ?? 0} />
            </div>
            <div>
              <div className="text-xs text-text-muted">Siege</div>
              <GoldNumber value={player.defensiveUnit3?.toNumber?.() ?? 0} />
            </div>
          </div>
        </div>
      )}

      {/* Send Reinforcements */}
      <div className="card">
        <h3 className="mb-4 text-xs font-semibold uppercase tracking-wider text-text-muted">
          Send Reinforcements
        </h3>
        <div className="space-y-3">
          <div>
            <label className="text-sm text-text-muted">Target Player Address:
              <input
                type="text"
                value={targetAddress}
                onChange={(e) => setTargetAddress(e.target.value)}
                placeholder="Wallet address..."
                className="mt-1 w-full rounded-lg border border-zinc-800 bg-surface px-3 py-2 text-sm text-text-primary placeholder-text-muted"
              />
            </label>
            {targetAddress.trim() && !isValidAddress && (
              <p className="text-xs text-red-400">Invalid Solana address</p>
            )}
          </div>
          <div className="flex items-center gap-4">
            <label className="text-sm text-text-muted">Units:
              <input
                type="number"
                value={units}
                onChange={(e) => setUnits(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-24 rounded-lg border border-zinc-800 bg-surface px-3 py-2 text-sm text-text-primary"
                min={1}
              />
            </label>
            {units > totalDefensive && totalDefensive > 0 && (
              <p className="text-xs text-red-400">
                Exceeds defensive units ({totalDefensive.toLocaleString()})
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-3">
            <TxButton onClick={handleSend} disabled={!isValidAddress || units > totalDefensive || traveling}>
              Send {units} Units
            </TxButton>
            <TxButton onClick={handleRecall} variant="secondary" disabled={!isValidAddress}>
              Recall
            </TxButton>
            <TxButton onClick={handleProcessArrival} variant="secondary" disabled={!isValidAddress}>
              Process Arrival
            </TxButton>
            <TxButton onClick={handleRelieve} variant="secondary" disabled={!isValidAddress}>
              Relieve
            </TxButton>
          </div>
        </div>
      </div>

      {/* Speedup Active Reinforcement */}
      {targetAddress && (
        <div className="card">
          <h3 className="mb-4 text-xs font-semibold uppercase tracking-wider text-text-muted">
            Speed Up Travel
          </h3>
          <p className="mb-3 text-xs text-text-secondary">
            Speed up reinforcements traveling to or from this player.
          </p>
          <SpeedupPanel
            visible={!!targetAddress}
            remainingSeconds={3600}
            onSpeedup={handleReinforcementSpeedup}
            gemsPerMinute={ge?.gameplayConfig.gemCostPerMinuteSpeedup ?? 1}
            gemBalance={player?.gems?.toNumber?.()}
          />
        </div>
      )}
    </div>
  );
}
