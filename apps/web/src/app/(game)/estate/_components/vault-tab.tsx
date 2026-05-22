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
import { GameIcon } from "@/components/shared/GameIcon";
import { TxButton } from "@/components/shared/TxButton";
import type { TxPhase } from "@/components/shared/TxButton";
import { FeatureGate } from "@/components/shared/FeatureGate";
import { NoviGenerator } from "@/components/shared/NoviGenerator";
import { NoviRewards } from "@/components/shared/NoviRewards";
import { NumberField } from "@/components/shared/NumberField";
import { BuildingId, FEATURES } from "@/lib/hooks/useFeatureGate";
import { buildingFraming } from "@/lib/narrative";
import { FeatureLayout } from "./feature-layout";
import {
  createCollectResourcesInstruction,
  createVaultTransferInstruction,
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
    return transact
      .mutateAsync({
        instructions: [ix],
        invalidateKeys: [["player"]],
        successMessage: `Vault ${vaultDirection === "deposit" ? "deposit" : "withdrawal"} complete!`,
        onPhase: reportPhase,
      })
      .then((r) => r.signature);
  };

  const handleCollectCash = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    const ge = client.gameEngine;
    const ix = createCollectResourcesInstruction(
      { owner: publicKey, gameEngine: ge },
      { noviAmount: collectNoviAmount, collectionType: CASH_COLLECTION_TYPE },
    );
    return transact
      .mutateAsync({
        instructions: [ix],
        invalidateKeys: [["player"]],
        successMessage: "Converted NOVI into cash!",
        onPhase: reportPhase,
      })
      .then((r) => r.signature);
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
    <FeatureLayout
      main={
        <>
          <p className="text-xs italic text-text-muted">{buildingFraming(BuildingId.Vault).line}</p>

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
                <div
                  className={`rounded-lg bg-surface-overlay px-2.5 py-1.5 text-xs font-semibold ${operativeUnits > 0 ? "tier-accent-text" : "text-text-muted"}`}
                >
                  {operativeUnits > 0
                    ? `Operative Units: ${operativeUnits.toLocaleString()}`
                    : "No operative units"}
                </div>
                <NumberField
                  label="NOVI to spend"
                  value={collectNoviAmount}
                  onChange={setCollectNoviAmount}
                  min={1}
                  max={noviBalance}
                  suffix="NOVI"
                />
                <TxButton
                  onClick={handleCollectCash}
                  disabled={operativeUnits === 0 || !hasEnoughForCollect}
                >
                  {hasEnoughForCollect ? "Collect Cash" : "Insufficient NOVI"}
                </TxButton>
              </div>
            </div>
          </FeatureGate>

          {/* Sending cash to House members. */}
          <SendCashPanel player={player} />
        </>
      }
      aside={
        /* Vault transfer — cash sheltered behind the locked door. */
        <FeatureGate feature={FEATURES.VAULT_TRANSFER}>
          <div className="card">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
              The Locked Door
            </h3>
            <p className="mb-4 text-xs text-text-muted">
              Cash set behind the vault door keeps 75% of its worth through a raid. Cash on hand
              does not.
            </p>
            <div className="mb-4 grid gap-2 grid-cols-2">
              <div className="rounded-lg border border-border-default bg-surface px-3 py-2">
                <div className="text-[10px] uppercase tracking-wider text-text-muted">On Hand</div>
                <span className="inline-flex items-center gap-1">
                  <GameIcon id="resource-cash" size={14} />
                  <GoldNumber value={cashOnHand} format="compact" size="sm" />
                </span>
              </div>
              <div className="rounded-lg border border-border-default bg-surface px-3 py-2">
                <div className="text-[10px] uppercase tracking-wider text-text-muted">In Vault</div>
                <span className="inline-flex items-center gap-1">
                  <GameIcon id="resource-cash" size={14} />
                  <GoldNumber value={cashInVault} format="compact" size="sm" glow={false} />
                </span>
              </div>
            </div>
            <div className="mb-4 flex gap-2">
              <button
                onClick={() => setVaultDirection("deposit")}
                className={`flex-1 rounded-lg px-3 py-2 text-sm sm:flex-none ${
                  vaultDirection === "deposit" ? "bg-accent/30 text-text-gold" : "text-text-muted"
                }`}
              >
                Hand &rarr; Vault
              </button>
              <button
                onClick={() => setVaultDirection("withdraw")}
                className={`flex-1 rounded-lg px-3 py-2 text-sm sm:flex-none ${
                  vaultDirection === "withdraw" ? "bg-accent/30 text-text-gold" : "text-text-muted"
                }`}
              >
                Vault &rarr; Hand
              </button>
            </div>
            <div className="space-y-3">
              <NumberField
                label="Amount"
                value={vaultAmount}
                onChange={setVaultAmount}
                min={0}
                max={vaultDirection === "deposit" ? cashOnHand : cashInVault}
              />
              <TxButton
                onClick={handleVaultTransfer}
                disabled={vaultAmount <= 0 || !!vaultValidation}
                className="w-full"
              >
                {vaultDirection === "deposit" ? "Deposit" : "Withdraw"} $
                {vaultAmount.toLocaleString()}
              </TxButton>
            </div>
            {vaultValidation && <div className="mt-2 text-xs text-red-400">{vaultValidation}</div>}
          </div>
        </FeatureGate>
      }
    />
  );
}

/** Transfer cash on hand to a member of the player's House. Rehomed from /economy. */
function SendCashPanel({ player }: { player: any }) {
  const client = useNovusMundusClient();
  const { publicKey } = useWallet();
  const transact = useTransact();
  const [recipient, setRecipient] = useState<PublicKey | null>(null);
  const [amount, setAmount] = useState(0);

  const teamPubkey = player?.team && !isNullPubkey(player.team) ? player.team : null;
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
        <p className="text-sm text-text-muted">Join a House to send cash to its members.</p>
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
    return transact
      .mutateAsync({
        instructions: [ix],
        invalidateKeys: [["player"]],
        successMessage: "Cash sent!",
        onPhase: reportPhase,
      })
      .then((r) => r.signature);
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
                      ? "border-border-gold bg-accent/20"
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
          <div className="space-y-3">
            <NumberField
              label="Amount"
              value={amount}
              onChange={setAmount}
              min={0}
              max={cashOnHand}
            />
            <TxButton
              onClick={handleSend}
              disabled={!recipient || amount <= 0 || !!amountError}
              className="w-full"
            >
              Send ${amount.toLocaleString()}
            </TxButton>
          </div>
          {amountError && <div className="mt-2 text-xs text-red-400">{amountError}</div>}
        </>
      )}
    </div>
  );
}
