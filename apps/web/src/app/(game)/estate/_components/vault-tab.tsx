"use client";

import { useState, useMemo } from "react";
import { usePlayer } from "@/lib/hooks/usePlayer";
import { useEstate } from "@/lib/hooks/useEstate";
import { useTeam } from "@/lib/hooks/useTeam";
import { useQuery } from "@tanstack/react-query";
import { PublicKey } from "@solana/web3.js";
import { useTransact } from "@/lib/hooks/useTransact";
import { useNovusMundusClient } from "@/lib/solana/provider";
import { useWallet } from "@solana/wallet-adapter-react";
import { GoldNumber } from "@/components/shared/GoldNumber";
import { TxButton } from "@/components/shared/TxButton";
import type { TxPhase } from "@/components/shared/TxButton";
import { FeatureGate } from "@/components/shared/FeatureGate";
import { NoviGenerator } from "@/components/shared/NoviGenerator";
import { NoviRewards } from "@/components/shared/NoviRewards";
import { BuildingId, FEATURES } from "@/lib/hooks/useFeatureGate";
import { buildingFraming } from "@/lib/narrative";
import {
  createCollectResourcesInstruction,
  createVaultTransferInstruction,
  createUpdateLockedNoviInstruction,
  createTransferCashInstruction,
  derivePlayerPda,
  isNullPubkey,
} from "novus-mundus-sdk";

// Cash collection is collection type 0 on-chain.
const CASH_COLLECTION_TYPE = 0;

export function VaultTab() {
  const { data: playerData } = usePlayer();
  const { data: estateData } = useEstate();
  const client = useNovusMundusClient();
  const { publicKey } = useWallet();
  const transact = useTransact();

  const player = playerData?.account;
  const [vaultAmount, setVaultAmount] = useState(0);
  const [vaultDirection, setVaultDirection] = useState<"deposit" | "withdraw">("deposit");
  const [collectNoviAmount, setCollectNoviAmount] = useState(100);

  const vaultValidation = useMemo(() => {
    if (!player || vaultAmount <= 0) return null;
    if (vaultDirection === "deposit") {
      const cash = player.cashOnHand.toNumber();
      if (vaultAmount > cash) return `Insufficient cash on hand (have $${cash.toLocaleString()})`;
    } else {
      const vault = player.cashInVault.toNumber();
      if (vaultAmount > vault) return `Insufficient vault cash (have $${vault.toLocaleString()})`;
    }
    return null;
  }, [player, vaultAmount, vaultDirection]);

  const handleVaultTransfer = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    const ge = client.gameEngine;
    const ix = createVaultTransferInstruction(
      { owner: publicKey, gameEngine: ge },
      { amount: vaultAmount, toVault: vaultDirection === "deposit" },
    );
    return transact.mutateAsync({
      instructions: [ix],
      invalidateKeys: [["player"]],
      successMessage: `Vault ${vaultDirection === "deposit" ? "deposit" : "withdrawal"} complete!`,
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  const handleCollectCash = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    const ge = client.gameEngine;
    const ix = createCollectResourcesInstruction(
      { owner: publicKey, gameEngine: ge },
      { noviAmount: collectNoviAmount, collectionType: CASH_COLLECTION_TYPE }
    );
    return transact.mutateAsync({
      instructions: [ix],
      invalidateKeys: [["player"]],
      successMessage: "Converted NOVI into cash!",
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  const handleClaimAndCollectCash = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    const ge = client.gameEngine;
    const claimIx = createUpdateLockedNoviInstruction({ owner: publicKey, gameEngine: ge });
    const collectIx = createCollectResourcesInstruction(
      { owner: publicKey, gameEngine: ge },
      { noviAmount: collectNoviAmount, collectionType: CASH_COLLECTION_TYPE }
    );
    return transact.mutateAsync({
      instructions: [claimIx, collectIx],
      invalidateKeys: [["player"]],
      successMessage: "Claimed NOVI & converted to cash!",
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  if (!estateData?.exists) {
    return (
      <div className="card text-center">
        <p className="text-sm text-text-muted">Create an estate first to access the Vault.</p>
      </div>
    );
  }
  if (!player) return null;

  const cashOnHand = player.cashOnHand?.toNumber?.() ?? 0;
  const cashInVault = player.cashInVault?.toNumber?.() ?? 0;
  const noviBalance = player.lockedNovi?.toNumber?.() ?? 0;
  const operativeUnits =
    (player.operativeUnit1?.toNumber?.() ?? 0) +
    (player.operativeUnit2?.toNumber?.() ?? 0) +
    (player.operativeUnit3?.toNumber?.() ?? 0);
  const hasEnoughForCollect = noviBalance >= collectNoviAmount;

  return (
    <div className="space-y-4">
      <p className="text-xs italic text-text-muted">{buildingFraming(BuildingId.Vault).line}</p>

      {/* §6.8 — the two NOVIs, kept distinct and never summed. Locked NOVI is the
          fuel that runs the holding; Reserved NOVI is earned treasure that vests. */}
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
          Locked NOVI &mdash; the holding&rsquo;s fuel
        </h3>
        <NoviGenerator />
      </div>
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
          Reserved NOVI &mdash; treasure that vests
        </h3>
        <NoviRewards />
      </div>

      {/* Vault transfer — cash sheltered behind the locked door. */}
      <FeatureGate feature={FEATURES.VAULT_TRANSFER}>
        <div className="card">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
            The Locked Door
          </h3>
          <p className="mb-4 text-xs text-text-muted">
            Cash set behind the vault door keeps 75% of its worth through a raid. Cash on hand does not.
          </p>
          <div className="mb-4 grid gap-2 grid-cols-2">
            <div className="rounded-lg border border-border-default bg-surface px-3 py-2">
              <div className="text-[10px] uppercase tracking-wider text-text-muted">On Hand</div>
              <GoldNumber value={cashOnHand} prefix="$ " format="compact" size="sm" />
            </div>
            <div className="rounded-lg border border-border-default bg-surface px-3 py-2">
              <div className="text-[10px] uppercase tracking-wider text-text-muted">In Vault</div>
              <GoldNumber value={cashInVault} prefix="$ " format="compact" size="sm" glow={false} />
            </div>
          </div>
          <div className="mb-4 flex gap-2">
            <button
              onClick={() => setVaultDirection("deposit")}
              className={`flex-1 rounded-lg px-3 py-2 text-sm sm:flex-none ${
                vaultDirection === "deposit" ? "bg-amber-900/30 text-text-gold" : "text-text-muted"
              }`}
            >
              Hand &rarr; Vault
            </button>
            <button
              onClick={() => setVaultDirection("withdraw")}
              className={`flex-1 rounded-lg px-3 py-2 text-sm sm:flex-none ${
                vaultDirection === "withdraw" ? "bg-amber-900/30 text-text-gold" : "text-text-muted"
              }`}
            >
              Vault &rarr; Hand
            </button>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
            <input
              type="number"
              value={vaultAmount}
              onChange={(e) => setVaultAmount(Math.max(0, parseInt(e.target.value) || 0))}
              className="w-full rounded-lg border border-zinc-800 bg-surface px-3 py-2 text-sm text-text-primary sm:w-32"
              placeholder="Amount"
            />
            <TxButton
              onClick={handleVaultTransfer}
              disabled={vaultAmount <= 0 || !!vaultValidation}
              className="w-full sm:w-auto"
            >
              {vaultDirection === "deposit" ? "Deposit" : "Withdraw"} ${vaultAmount.toLocaleString()}
            </TxButton>
          </div>
          {vaultValidation && (
            <div className="mt-2 text-xs text-red-400">{vaultValidation}</div>
          )}
        </div>
      </FeatureGate>

      {/* Cash collection — turning locked NOVI into spendable cash. */}
      <FeatureGate feature={FEATURES.COLLECT_CASH}>
        <div className="card">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
            Coin the NOVI
          </h3>
          <p className="mb-4 text-xs text-text-muted">
            Set your operative workforce to turn locked NOVI into cash on hand.
          </p>
          <div className="space-y-3">
            <div className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold ${operativeUnits > 0 ? "bg-amber-900/30 text-amber-400" : "bg-red-900/20 text-red-400"}`}>
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
              <TxButton onClick={handleCollectCash} disabled={operativeUnits === 0 || !hasEnoughForCollect} className="flex-1">
                {hasEnoughForCollect ? "Collect Cash" : "Insufficient NOVI"}
              </TxButton>
              <TxButton onClick={handleClaimAndCollectCash} variant="secondary" className="flex-1 text-xs" disabled={operativeUnits === 0}>
                Claim NOVI &amp; Collect
              </TxButton>
            </div>
          </div>
        </div>
      </FeatureGate>

      {/* Sending cash to House members. */}
      <SendCashPanel player={player} />
    </div>
  );
}

/** Transfer cash on hand to a member of the player's House. Rehomed from /economy. */
function SendCashPanel({ player }: { player: any }) {
  const client = useNovusMundusClient();
  const { publicKey } = useWallet();
  const transact = useTransact();
  const [recipient, setRecipient] = useState<PublicKey | null>(null);
  const [amount, setAmount] = useState(0);

  const teamPubkey =
    player?.team && !isNullPubkey(player.team) ? player.team : null;
  const { data: teamData } = useTeam(teamPubkey);
  const teamId = teamData?.account?.id;

  const { data: members } = useQuery({
    queryKey: ["teamMembers", teamPubkey?.toBase58()],
    queryFn: async () => {
      if (!teamPubkey) return [];
      return client.fetchTeamMembers(teamPubkey);
    },
    enabled: !!teamPubkey,
    staleTime: 30_000,
  });

  if (!teamPubkey) {
    return (
      <div className="card text-center">
        <p className="text-sm text-text-muted">
          Join a House to send cash to its members.
        </p>
      </div>
    );
  }

  const myPlayerPda = publicKey
    ? derivePlayerPda(client.gameEngine, publicKey)[0].toBase58()
    : null;
  const recipients = (members ?? []).filter(
    (m: any) => m.account.player.toBase58() !== myPlayerPda,
  );

  const cashOnHand = player?.cashOnHand?.toNumber?.() ?? 0;
  const amountError =
    amount > 0 && amount > cashOnHand
      ? `Insufficient cash (have $${cashOnHand.toLocaleString()})`
      : null;

  const handleSend = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    if (!recipient) throw new Error("Select a recipient");
    if (teamId == null) throw new Error("House not loaded");
    const ix = createTransferCashInstruction(
      {
        sender: publicKey,
        gameEngine: client.gameEngine,
        receiverPlayer: recipient,
        team: teamPubkey,
        teamId: teamId.toNumber(),
      },
      { amount },
    );
    return transact.mutateAsync({
      instructions: [ix],
      invalidateKeys: [["player"]],
      successMessage: "Cash sent!",
      onPhase: reportPhase,
    }).then((r) => r.signature);
  };

  return (
    <div className="card">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
        Send Cash to a House Member
      </h3>
      <p className="mb-4 text-xs text-text-muted">
        Pass cash on hand to a sworn member of your House. Cash on hand: $
        {cashOnHand.toLocaleString()}.
      </p>

      {recipients.length === 0 ? (
        <p className="text-sm text-text-muted">No other House members to send to.</p>
      ) : (
        <>
          <div className="mb-4 space-y-2">
            {recipients.map((m: any) => {
              const pda = m.account.player.toBase58();
              const isSelected = recipient?.toBase58() === pda;
              return (
                <button
                  key={pda}
                  onClick={() => setRecipient(m.account.player)}
                  className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left transition-all ${
                    isSelected
                      ? "border-amber-600 bg-amber-900/20"
                      : "border-zinc-800 hover:border-zinc-700"
                  }`}
                >
                  <span className="font-mono text-sm text-text-primary">
                    {pda.slice(0, 4)}&hellip;{pda.slice(-4)}
                  </span>
                  <span className="text-xs text-text-muted">Slot {m.account.slotIndex}</span>
                </button>
              );
            })}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(Math.max(0, parseInt(e.target.value) || 0))}
              className="w-full rounded-lg border border-zinc-800 bg-surface px-3 py-2 text-sm text-text-primary sm:w-40"
              placeholder="Amount"
            />
            <TxButton
              onClick={handleSend}
              disabled={!recipient || amount <= 0 || !!amountError}
              className="w-full sm:w-auto"
            >
              Send ${amount.toLocaleString()}
            </TxButton>
          </div>
          {amountError && (
            <div className="mt-2 text-xs text-red-400">{amountError}</div>
          )}
        </>
      )}
    </div>
  );
}
