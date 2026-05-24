"use client";

import { useRef, useEffect, useState } from "react";
import { cn, formatNumber, formatTime } from "@/lib/utils";
import { useUser } from "@/lib/hooks/useUser";
import { usePlayer } from "@/lib/hooks/usePlayer";
import { useTransact } from "@/lib/hooks/useTransact";
import { useNovusMundusClient } from "@/lib/solana/provider";
import { useWallet } from "@solana/wallet-adapter-react";
import { TxButton } from "./TxButton";
import type { TxPhase } from "./TxButton";
import { GoldNumber } from "./GoldNumber";
import { GameIcon } from "./GameIcon";
import { NumberField } from "./NumberField";
import {
  createReservedToLockedInstruction,
  createWithdrawReservedInstruction,
  deciToNovi,
  noviToDeci,
  RESERVED_NOVI_VESTING_PERIOD,
} from "novus-mundus-sdk";

interface NoviRewardsProps {
  className?: string;
}

export function NoviRewards({ className }: NoviRewardsProps) {
  const { data: userData } = useUser();
  const { data: playerData } = usePlayer();
  const client = useNovusMundusClient();
  const { publicKey } = useWallet();
  const transact = useTransact();

  const user = userData?.account;
  const player = playerData?.account;

  // Refs
  const containerRef = useRef<HTMLDivElement>(null);

  // State
  const [convertAmount, setConvertAmount] = useState(0);
  const [withdrawAmount, setWithdrawAmount] = useState(0);
  const [activeTab, setActiveTab] = useState<"convert" | "withdraw">("convert");
  const [vestingRemaining, setVestingRemaining] = useState(0);

  // Vesting countdown
  useEffect(() => {
    if (!user) return;

    const tick = () => {
      const now = Math.floor(Date.now() / 1000);
      const earnedAt = user.reservedNoviEarnedAt.toNumber();
      if (earnedAt === 0) {
        setVestingRemaining(0);
        return;
      }
      const vestingEnds = earnedAt + RESERVED_NOVI_VESTING_PERIOD;
      setVestingRemaining(Math.max(0, vestingEnds - now));
    };

    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [user]);

  const handleConvert = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    const amount = convertAmount;
    if (!amount || amount <= 0) throw new Error("Invalid amount");

    const geKey = client.gameEngine;
    const ix = createReservedToLockedInstruction(
      { owner: publicKey, gameEngine: geKey },
      { amount: noviToDeci(amount) },
    );
    return transact
      .mutateAsync({
        instructions: [ix],
        invalidateKeys: [["player"]],
        successMessage: `Converted ${formatNumber(amount, "compact")} NOVI to locked!`,
        onPhase: reportPhase,
      })
      .then((r) => {
        setConvertAmount(0);
        return r.signature;
      });
  };

  const handleWithdraw = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    const amount = withdrawAmount;
    if (!amount || amount <= 0) throw new Error("Invalid amount");

    const geKey = client.gameEngine;
    const ix = createWithdrawReservedInstruction(
      { owner: publicKey, gameEngine: geKey },
      { amount: noviToDeci(amount) },
    );
    return transact
      .mutateAsync({
        instructions: [ix],
        invalidateKeys: [["player"]],
        successMessage: `Withdrew ${formatNumber(amount, "compact")} NOVI to wallet!`,
        onPhase: reportPhase,
      })
      .then((r) => {
        setWithdrawAmount(0);
        return r.signature;
      });
  };

  if (!user || !player) return null;

  const reservedBalance = deciToNovi(user.reservedNovi);
  const totalEarned = deciToNovi(user.totalReservedEarned);
  const eventsWon = user.totalEventsWon.toNumber();
  const eventsPlayed = user.totalEventsParticipated.toNumber();
  const isVested = vestingRemaining === 0 && reservedBalance > 0;
  const hasReserved = reservedBalance > 0;

  const convertNum = convertAmount;
  const withdrawNum = withdrawAmount;

  // Vesting progress (0-100)
  const vestingPct =
    hasReserved && user.reservedNoviEarnedAt.toNumber() > 0
      ? Math.min(
          100,
          ((RESERVED_NOVI_VESTING_PERIOD - vestingRemaining) / RESERVED_NOVI_VESTING_PERIOD) * 100,
        )
      : 0;

  return (
    <div ref={containerRef} className={cn("card relative overflow-hidden", className)}>
      {/* Header */}
      <div className="mb-5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-md bg-accent/40">
            <span className="text-sm text-text-gold">★</span>
          </div>
          <span className="text-xs font-semibold uppercase tracking-wider text-text-gold">
            Earned Novi
          </span>
        </div>
        {eventsPlayed > 0 && (
          <div className="text-[10px] text-zinc-500">
            {eventsWon}/{eventsPlayed} events won
          </div>
        )}
      </div>

      {/* Balance Display */}
      <div className="mb-5 flex items-center gap-6">
        <div className="flex-1">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">Reserved NOVI</div>
          <div className="mt-1 flex items-center gap-1.5">
            <GameIcon id="resource-novi" title="NOVI" size={22} />
            <GoldNumber
              value={reservedBalance}
              size="lg"
              format="full"
              className="text-text-gold"
            />
          </div>
          {totalEarned > 0 && (
            <div className="mt-1 text-[10px] text-zinc-600">
              {formatNumber(totalEarned, "compact")} earned lifetime
            </div>
          )}
        </div>

        {/* Vesting Status */}
        {hasReserved && (
          <div className="flex-shrink-0 text-right">
            {isVested ? (
              <div className="flex items-center gap-1.5">
                <div className="h-2 w-2 rounded-full bg-gold-400" />
                <span className="text-xs font-semibold text-text-gold">Fully Vested</span>
              </div>
            ) : (
              <div>
                <div className="text-[10px] text-zinc-500">Vesting</div>
                <div className="font-mono text-sm font-bold tabular-nums text-text-gold">
                  {formatTime(vestingRemaining, "compact")}
                </div>
                {/* Mini vesting bar */}
                <div className="mt-1 h-1 w-20 overflow-hidden rounded-full bg-zinc-800">
                  <div
                    className="h-full rounded-full bg-gold-500 transition-all duration-1000"
                    style={{ width: `${vestingPct}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {!hasReserved && (
        <div className="mb-5 rounded-lg border border-zinc-800 bg-surface/60 px-4 py-6 text-center">
          <div className="text-sm text-zinc-500">No reserved NOVI yet</div>
          <div className="mt-1 text-xs text-zinc-600">
            Purchase novi, or earn from events, tournaments, and prizes
          </div>
        </div>
      )}

      {/* Action Tabs */}
      {hasReserved && (
        <>
          <div className="mb-4 flex gap-1 rounded-lg bg-surface p-1">
            <button
              onClick={() => setActiveTab("convert")}
              className={cn(
                "flex-1 rounded-md px-3 py-2 text-xs font-medium transition-colors",
                activeTab === "convert"
                  ? "bg-surface-raised text-text-gold"
                  : "text-zinc-500 hover:text-zinc-400",
              )}
            >
              Convert to Locked
            </button>
            <button
              onClick={() => setActiveTab("withdraw")}
              className={cn(
                "flex-1 rounded-md px-3 py-2 text-xs font-medium transition-colors",
                activeTab === "withdraw"
                  ? "bg-surface-raised text-text-gold"
                  : "text-zinc-500 hover:text-zinc-400",
              )}
            >
              Withdraw to Wallet
            </button>
          </div>

          {/* Convert Tab */}
          {activeTab === "convert" && (
            <div className="space-y-3">
              <div className="rounded-lg border border-border-gold/30 bg-accent/10 px-4 py-3">
                <div className="flex items-start gap-2">
                  <GameIcon id="resource-novi" title="NOVI" size={14} className="mt-0.5" />
                  <div className="text-xs text-zinc-400">
                    Convert reserved NOVI into{" "}
                    <span className="font-semibold text-text-gold">locked NOVI</span> for gameplay.
                    This is <span className="text-text-gold">permanent</span> and cannot be
                    reversed.
                  </div>
                </div>
              </div>

              <div className="flex flex-col items-center gap-3">
                <NumberField
                  className="w-72"
                  value={convertAmount}
                  onChange={setConvertAmount}
                  min={1}
                  max={reservedBalance}
                  suffix="NOVI"
                />
                <TxButton
                  onClick={handleConvert}
                  disabled={convertNum <= 0 || convertNum > reservedBalance}
                  className="w-auto shrink-0 whitespace-nowrap px-5"
                >
                  Convert
                </TxButton>
              </div>
            </div>
          )}

          {/* Withdraw Tab */}
          {activeTab === "withdraw" && (
            <div className="space-y-3">
              <div className="rounded-lg border border-border-gold/30 bg-accent/10 px-4 py-3">
                <div className="flex items-start gap-2">
                  <span className="mt-0.5 text-text-gold">↗</span>
                  <div className="text-xs text-zinc-400">
                    Withdraw reserved NOVI to your{" "}
                    <span className="font-semibold text-text-gold">wallet</span>. Requires a{" "}
                    <span className="text-text-gold">7-day vesting</span> period after earning.
                  </div>
                </div>
              </div>

              {!isVested ? (
                <div className="flex items-center justify-center gap-3 rounded-lg border border-zinc-800 bg-surface/60 py-4">
                  <svg className="h-4 w-4 text-text-gold" viewBox="0 0 16 16" fill="none">
                    <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
                    <path
                      d="M8 4v4.5l3 1.5"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                    />
                  </svg>
                  <div>
                    <div className="text-xs text-zinc-400">Withdrawal unlocks in</div>
                    <div className="font-mono text-sm font-bold tabular-nums text-text-gold">
                      {formatTime(vestingRemaining, "full")}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex items-end gap-3">
                  <NumberField
                    className="flex-1"
                    value={withdrawAmount}
                    onChange={setWithdrawAmount}
                    min={1}
                    max={reservedBalance}
                    suffix="NOVI"
                  />
                  <TxButton
                    onClick={handleWithdraw}
                    disabled={withdrawNum <= 0 || withdrawNum > reservedBalance}
                    className="w-auto shrink-0 whitespace-nowrap px-5"
                  >
                    Withdraw
                  </TxButton>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
