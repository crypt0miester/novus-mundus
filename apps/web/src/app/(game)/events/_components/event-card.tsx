"use client";

import { useMemo } from "react";
import type { PublicKey } from "@solana/web3.js";
import { useWallet } from "@solana/wallet-adapter-react";
import { usePlayer } from "@/lib/hooks/usePlayer";
import { useTransact } from "@/lib/hooks/useTransact";
import { useNovusMundusClient } from "@/lib/solana/provider";
import { GoldNumber } from "@/components/shared/GoldNumber";
import { GoldCountdown } from "@/components/shared/GoldCountdown";
import { TxButton } from "@/components/shared/TxButton";
import type { TxPhase } from "@/components/shared/TxButton";
import { DomainName } from "@/components/shared/DomainName";
import {
  EventStatus,
  EventPrizeType,
  deriveEventPda,
  getAssociatedTokenAddressSync,
  getAssociatedTokenAddressSyncForPda,
  isNullPubkey,
  createJoinEventInstruction,
  createFinalizeEventInstruction,
  createClaimPrizeInstruction,
  type EventAccount,
  type EventParticipation,
} from "novus-mundus-sdk";
import { eventSplashPath } from "@/lib/events/splash";

const STATUS_LABEL: Record<number, string> = {
  [EventStatus.Pending]: "Upcoming",
  [EventStatus.Active]: "Active",
  [EventStatus.Finalized]: "Finalized",
  [EventStatus.Cancelled]: "Cancelled",
};

const STATUS_STYLE: Record<number, string> = {
  [EventStatus.Pending]: "bg-zinc-800 text-text-muted",
  [EventStatus.Active]: "bg-accent/40 text-text-gold",
  [EventStatus.Finalized]: "bg-emerald-900/40 text-emerald-300",
  [EventStatus.Cancelled]: "bg-red-900/30 text-red-400",
};

const PRIZE_LABEL: Record<number, string> = {
  [EventPrizeType.LockedNovi]: "Locked NOVI",
  [EventPrizeType.Gems]: "Gems",
  [EventPrizeType.Cash]: "Cash",
  [EventPrizeType.SPLToken]: "SPL Token",
};

// Prize distribution by rank (bps of pool): 35%, 20%, 13%, 9%, 6%, 4%, 3%, 2%, 2%, 1%
const PRIZE_BPS = [3500, 2000, 1300, 900, 600, 400, 300, 200, 200, 100];

const INVALIDATE = [["player"]];

export function EventCard({
  eventPubkey,
  event,
  participation,
}: {
  eventPubkey: string;
  event: EventAccount;
  participation: EventParticipation | null;
}) {
  const { publicKey } = useWallet();
  const { data: playerData } = usePlayer();
  const player = playerData?.account;
  const client = useNovusMundusClient();
  const transact = useTransact();

  const nowSec = Math.floor(Date.now() / 1000);
  const eventId = event.id.toNumber();
  const startTime = event.startTime.toNumber();
  const endTime = event.endTime.toNumber();
  const status = event.status;
  const splash = eventSplashPath(eventId, startTime, endTime);

  const leaderboard = useMemo(
    () => event.leaderboard.slice(0, event.leaderboardCount),
    [event.leaderboard, event.leaderboardCount],
  );

  // The current player's leaderboard rank (0-indexed), if on the top-10.
  const myRank = useMemo(() => {
    if (!publicKey) return null;
    for (let i = 0; i < leaderboard.length; i++) {
      if (leaderboard[i]!.player.equals(publicKey)) return i;
    }
    return null;
  }, [leaderboard, publicKey]);

  const isJoined = participation !== null;
  const isSplPrize = event.prizeType === EventPrizeType.SPLToken;
  const ended = nowSec >= endTime;
  const started = nowSec >= startTime;

  // Join — Pending/Active event the player hasn't joined yet.
  const canJoin =
    (status === EventStatus.Pending || status === EventStatus.Active) && !isJoined && !ended;
  // Finalize — permissionless, for events past endTime still in Pending/Active.
  const canFinalize = (status === EventStatus.Pending || status === EventStatus.Active) && ended;
  // Claim — Finalized event where the player is on the top-10 leaderboard.
  const canClaim = status === EventStatus.Finalized && myRank !== null;

  const handleJoin = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    const ge = client.gameEngine;
    const ix = createJoinEventInstruction({
      payer: publicKey,
      gameEngine: ge,
      playerOwner: publicKey,
      eventId,
    });
    return transact
      .mutateAsync({
        instructions: [ix],
        invalidateKeys: INVALIDATE,
        successMessage: `Joined ${event.name}!`,
        onPhase: reportPhase,
      })
      .then((r) => r.signature);
  };

  const handleFinalize = async (reportPhase: (p: TxPhase) => void) => {
    const ge = client.gameEngine;
    const ix = createFinalizeEventInstruction({
      gameEngine: ge,
      eventId,
    });
    return transact
      .mutateAsync({
        instructions: [ix],
        invalidateKeys: INVALIDATE,
        successMessage: "Event finalized — prizes are now claimable.",
        onPhase: reportPhase,
      })
      .then((r) => r.signature);
  };

  const handleClaim = async (reportPhase: (p: TxPhase) => void) => {
    if (!publicKey) throw new Error("Wallet not connected");
    const ge = client.gameEngine;

    // SPLToken prizes need the event vault (ATA owned by the event PDA),
    // the winner's SPL token account, and the prize mint. Non-SPL prizes
    // (LockedNovi / Gems / Cash) use only the base account set.
    let extra: {
      eventVault?: PublicKey;
      winnerSplTokenAccount?: PublicKey;
      prizeTokenMint?: PublicKey;
    } = {};
    if (isSplPrize) {
      if (isNullPubkey(event.prizeTokenMint)) {
        throw new Error("SPL prize event is missing its prize token mint");
      }
      const [eventPda] = deriveEventPda(ge, eventId);
      extra = {
        prizeTokenMint: event.prizeTokenMint,
        // Event vault: ATA of the prize mint owned by the event PDA (off-curve).
        eventVault: getAssociatedTokenAddressSyncForPda(event.prizeTokenMint, eventPda),
        // Winner's SPL token account: ATA of the prize mint owned by the winner.
        winnerSplTokenAccount: getAssociatedTokenAddressSync(event.prizeTokenMint, publicKey),
      };
    }

    const ix = createClaimPrizeInstruction({
      payer: publicKey,
      gameEngine: ge,
      winnerOwner: publicKey,
      eventId,
      ...extra,
    });
    return transact
      .mutateAsync({
        instructions: [ix],
        invalidateKeys: INVALIDATE,
        successMessage: "Prize claimed!",
        onPhase: reportPhase,
      })
      .then((r) => r.signature);
  };

  const prizeAmount = event.prizeAmount.toNumber();
  const prizeRemaining = event.prizeRemaining.toNumber();
  const myEstimatedPrize =
    myRank !== null && prizeAmount > 0
      ? Math.floor((prizeAmount * (PRIZE_BPS[myRank] ?? 0)) / 10000)
      : 0;

  return (
    <div className={`card ${status === EventStatus.Active ? "accent-border" : ""}`}>
      {/* Splash banner with the event name overlaid directly on the art */}
      <div
        className="relative mb-2 aspect-[16/9] w-full overflow-hidden rounded-lg border border-border-default"
        style={{
          backgroundImage: `url(${splash})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      >
        <span
          className={`absolute right-2 top-2 rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${STATUS_STYLE[status] ?? "bg-zinc-800 text-text-muted"}`}
        >
          {STATUS_LABEL[status] ?? `Status ${status}`}
        </span>
        <div className="absolute inset-x-0 bottom-0 p-3">
          <div className="font-display text-lg font-bold tracking-wide text-zinc-50 [text-shadow:0_1px_2px_rgba(0,0,0,0.95),0_2px_10px_rgba(0,0,0,0.85)]">
            {event.name || `Event #${eventId}`}
          </div>
        </div>
      </div>

      {/* Participation meta */}
      <div className="mb-1 text-xs text-text-muted">
        {event.participantCount.toLocaleString()} participant
        {event.participantCount === 1 ? "" : "s"}
        {event.minLevel > 1 && ` · min level ${event.minLevel}`}
      </div>

      {/* Prize + timing */}
      <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-3">
        <div>
          <div className="text-xs text-text-muted">Prize Pool</div>
          <GoldNumber value={prizeAmount} size="sm" />
          <div className="text-[10px] text-text-muted">
            {PRIZE_LABEL[event.prizeType] ?? "Prize"}
          </div>
        </div>
        <div>
          <div className="text-xs text-text-muted">Remaining</div>
          <GoldNumber value={prizeRemaining} size="sm" />
        </div>
        <div>
          <div className="text-xs text-text-muted">
            {status === EventStatus.Pending && !started ? "Starts" : ended ? "Ended" : "Ends"}
          </div>
          {status === EventStatus.Pending && !started ? (
            <GoldCountdown endsAt={startTime} format="compact" size="sm" />
          ) : ended ? (
            <div className="text-sm text-text-secondary">
              {new Date(endTime * 1000).toLocaleDateString()}
            </div>
          ) : (
            <GoldCountdown endsAt={endTime} format="compact" size="sm" />
          )}
        </div>
      </div>

      {/* Your participation */}
      {isJoined && (
        <div className="mt-3 flex items-center justify-between rounded-lg border border-border-gold/60 bg-accent/10 px-3 py-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-text-gold">
            Your Entry
          </span>
          <div className="flex items-center gap-4 text-sm">
            <span className="text-text-secondary">
              Rank{" "}
              <span className="font-semibold text-text-primary">
                {myRank !== null ? `#${myRank + 1}` : "unranked"}
              </span>
            </span>
            <span className="text-text-secondary">
              Score{" "}
              <span className="font-semibold text-text-primary">
                {(participation?.score.toNumber() ?? 0).toLocaleString()}
              </span>
            </span>
          </div>
        </div>
      )}

      {/* Leaderboard */}
      {leaderboard.length > 0 && (
        <div className="mt-3">
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
            Leaderboard
          </h4>
          <div className="space-y-1">
            {leaderboard.map((entry, i) => {
              const isMe = publicKey ? entry.player.equals(publicKey) : false;
              return (
                <div
                  key={`${entry.player.toBase58()}-${i}`}
                  className={`flex items-center justify-between rounded-md px-2 py-1 text-sm ${
                    isMe ? "bg-accent/20" : ""
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-6 text-right text-xs font-semibold ${
                        i === 0 ? "text-text-gold" : i < 3 ? "text-gold-300" : "text-text-muted"
                      }`}
                    >
                      #{i + 1}
                    </span>
                    <span className="font-mono text-text-primary">
                      <DomainName pubkey={entry.player} chars={4} />
                    </span>
                    {isMe && <span className="text-[10px] uppercase text-text-gold">you</span>}
                  </div>
                  <span className="text-text-secondary">
                    {entry.score.toNumber().toLocaleString()}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        {canJoin && (
          <TxButton
            onClick={handleJoin}
            disabled={!!player && event.minLevel > (player.level ?? 0)}
          >
            Join Event
          </TxButton>
        )}
        {canFinalize && (
          <TxButton onClick={handleFinalize} variant="secondary">
            Finalize Event
          </TxButton>
        )}
        {canClaim && (
          <TxButton onClick={handleClaim}>
            Claim Prize
            {myEstimatedPrize > 0 && ` (~${myEstimatedPrize.toLocaleString()})`}
          </TxButton>
        )}
      </div>

      {/* Hints */}
      {canJoin && !!player && event.minLevel > (player.level ?? 0) && (
        <p className="mt-2 text-xs text-red-400">
          Requires level {event.minLevel} — you are level {player.level ?? 0}.
        </p>
      )}
      {canFinalize && (
        <p className="mt-2 text-xs text-text-muted">
          This event has ended. Finalizing is permissionless — it locks the leaderboard so winners
          can claim.
        </p>
      )}
      {canClaim && (
        <p className="mt-2 text-xs text-text-muted">
          Prize claims require an aged, active account. New or low-activity accounts may be rejected
          on-chain by anti-Sybil checks.
        </p>
      )}
    </div>
  );
}
