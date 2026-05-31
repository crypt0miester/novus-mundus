"use client";

import { useQuery } from "@tanstack/react-query";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import {
  createClaimDungeonInstruction,
  derivePlayerPda,
  deriveDungeonRunPda,
  parseDungeonRun,
  DungeonStatus,
  type DungeonRunAccount,
} from "novus-mundus-sdk";
import { useNovusMundusClient } from "@/lib/solana/provider";
import { useTransact } from "@/lib/hooks/useTransact";
import { useCoSign } from "@/lib/cosign";
import { useRightPanelStore } from "@/lib/store/right-panel";
import { TxButton } from "@/components/shared/TxButton";
import type { TxPhase } from "@/components/shared/TxButton";
import { useMorphActions } from "@/lib/hooks/useMorphActions";

function n(v: bigint | number | null | undefined): number {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  return Number(v);
}
const fmt = (x: number) => x.toLocaleString();

/**
 * The dungeon run recap — shown in the RightPanel once a run ends. Self-derives
 * the run off the shared `dungeonRun` query; Claim closes the run on-chain.
 */
export function DungeonClaimPanel() {
  const { publicKey } = useWallet();
  const { connection } = useConnection();
  const client = useNovusMundusClient();
  const transact = useTransact();
  const { requestCoSign } = useCoSign();
  const close = useRightPanelStore((s) => s.close);

  const { data: runData } = useQuery({
    queryKey: ["dungeonRun", publicKey?.toBase58()],
    queryFn: async () => {
      const ge = client.gameEngine;
      const [playerPda] = await derivePlayerPda(ge, publicKey!);
      const [runPda] = await deriveDungeonRunPda(playerPda);
      const info = await connection.getAccountInfo(runPda);
      if (!info) return { pubkey: runPda, account: null, exists: false };
      return { pubkey: runPda, account: parseDungeonRun(info), exists: true };
    },
    enabled: !!publicKey,
    staleTime: 2_000,
  });

  const run = runData?.account as DungeonRunAccount | null | undefined;

  const handleClaim = async (rp: (p: TxPhase) => void) => {
    if (!publicKey || !run) throw new Error("No run");
    const ix = await createClaimDungeonInstruction({
      gameEngine: client.gameEngine,
      owner: publicKey,
      heroMint: run.heroMint,
    });
    return transact
      .mutateAsync({
        instructions: [ix],
        invalidateKeys: [["dungeonRun"], ["player"]],
        successMessage: "Rewards claimed.",
        onPhase: rp,
      })
      .then((r) => {
        close();
        return r.signature;
      });
  };

  const handleResume = async (rp: (p: TxPhase) => void) => {
    const vtx = await requestCoSign("/api/cosign/dungeon/resume");
    return transact
      .mutateAsync({
        versionedTx: vtx,
        invalidateKeys: [["dungeonRun"], ["player"]],
        successMessage: "Run resumed.",
        onPhase: rp,
      })
      .then((r) => {
        close();
        return r.signature;
      });
  };

  const won = run?.status === DungeonStatus.Completed;
  const failed = run?.status === DungeonStatus.Failed;
  const morphActions = !run
    ? null
    : won
      ? [
          {
            id: "claim-rewards",
            label: "Claim Rewards",
            variant: "primary" as const,
            onClick: handleClaim,
          },
        ]
      : failed
        ? [
            {
              id: "resume-checkpoint",
              label: "Resume from Checkpoint",
              variant: "primary" as const,
              onClick: handleResume,
            },
            {
              id: "claim-exit",
              label: "Claim & Exit",
              onClick: handleClaim,
            },
          ]
        : null;
  useMorphActions(morphActions);

  if (!run) {
    return <p className="text-sm text-text-muted">No dungeon run to claim.</p>;
  }
  const score = run.currentFloor * 10000 + run.enemiesKilled * 100 + run.relicsCollected * 500;
  const stats = [
    { label: "Floors", value: fmt(run.currentFloor) },
    { label: "Rooms cleared", value: fmt(run.roomsCleared) },
    { label: "Foes felled", value: fmt(run.enemiesKilled) },
    { label: "Relics", value: fmt(run.relicsCollected) },
    { label: "Damage dealt", value: fmt(n(run.totalDamageDealt)) },
    { label: "Damage taken", value: fmt(n(run.totalDamageTaken)) },
  ];

  return (
    <div className="space-y-4">
      <div
        className={`rounded-lg border p-3 ${
          won ? "border-emerald-700/50 bg-emerald-950/20" : "border-red-800/50 bg-red-950/20"
        }`}
      >
        <div className={`text-base font-bold ${won ? "text-emerald-400" : "text-red-400"}`}>
          {won ? "Dungeon Cleared" : "Run Ended"}
        </div>
        <div className="mt-0.5 text-xs text-text-muted">Run score: {fmt(score)}</div>
        <div className="mt-3 grid grid-cols-2 gap-3">
          {stats.map((s) => (
            <div key={s.label}>
              <div className="text-[10px] uppercase tracking-wider text-text-muted">{s.label}</div>
              <div className="text-sm font-semibold text-text-primary">{s.value}</div>
            </div>
          ))}
        </div>
      </div>

      {won && (
        <TxButton onClick={handleClaim} className="hidden w-full lg:block">
          Claim Rewards
        </TxButton>
      )}

      {failed && (
        <div className="space-y-2">
          <p className="text-xs text-text-muted">
            Resume from the last checkpoint (floor {run.lastCheckpoint ?? 0}) — costs gems — or
            claim what you carried.
          </p>
          <TxButton onClick={handleResume} className="hidden w-full lg:block">
            Resume from Checkpoint
          </TxButton>
          <TxButton onClick={handleClaim} variant="secondary" className="hidden w-full lg:block">
            Claim &amp; Exit
          </TxButton>
        </div>
      )}
    </div>
  );
}
